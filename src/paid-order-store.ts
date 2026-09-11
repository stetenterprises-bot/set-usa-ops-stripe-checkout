import { Pool } from "pg";
import Stripe from "stripe";
import { getCheckoutOffer } from "./checkout-offers.js";

export const PAYMENT_INTENT_EVENT_TYPES = new Set([
  "payment_intent.created",
  "payment_intent.requires_action",
  "payment_intent.processing",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled"
]);

export type PaidOrderStatus = "created" | "requires_action" | "processing" | "paid" | "failed" | "canceled" | "quarantined";
export type PaidOrderRecord = {
  paymentIntentId: string;
  offerId: string | null;
  amount: number;
  currency: string;
  customerEmail: string | null;
  customerId: string | null;
  livemode: boolean;
  paymentStatus: PaidOrderStatus;
  validationStatus: "valid" | "quarantined";
  validationReason: string | null;
  metadata: Record<string, string>;
  firstEventId: string;
  lastEventId: string;
};

export type PaidOrderEventResult = { duplicate: boolean; order: PaidOrderRecord | null };

type QueryResult<Row = Record<string, unknown>> = { rowCount: number | null; rows: readonly Row[] };
type Database = {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  connect?: () => Promise<DatabaseClient>;
};
type DatabaseClient = Database & { release(): void };

type PaidOrderRow = {
  payment_intent_id: string;
  offer_id: string | null;
  amount: number | string;
  currency: string;
  customer_email: string | null;
  customer_id: string | null;
  livemode: boolean;
  payment_status: PaidOrderStatus;
  validation_status: "valid" | "quarantined";
  validation_reason: string | null;
  metadata: Record<string, string>;
  first_event_id: string;
  last_event_id: string;
};

function rowToRecord(row: PaidOrderRow | undefined): PaidOrderRecord | null {
  if (!row) return null;
  return {
    paymentIntentId: row.payment_intent_id,
    offerId: row.offer_id,
    amount: Number(row.amount),
    currency: row.currency,
    customerEmail: row.customer_email,
    customerId: row.customer_id,
    livemode: row.livemode,
    paymentStatus: row.payment_status,
    validationStatus: row.validation_status,
    validationReason: row.validation_reason,
    metadata: row.metadata,
    firstEventId: row.first_event_id,
    lastEventId: row.last_event_id,
  };
}

function statusForEvent(type: string): PaidOrderStatus {
  switch (type) {
    case "payment_intent.requires_action": return "requires_action";
    case "payment_intent.processing": return "processing";
    case "payment_intent.succeeded": return "paid";
    case "payment_intent.payment_failed": return "failed";
    case "payment_intent.canceled": return "canceled";
    default: return "created";
  }
}

const statusRank: Record<PaidOrderStatus, number> = {
  created: 1, requires_action: 2, processing: 3, failed: 4, canceled: 4, paid: 5, quarantined: 0
};

function validMetadata(paymentIntent: Stripe.PaymentIntent): { offerId: string | null; reason: string | null } {
  if (paymentIntent.metadata?.seller !== "SET Business Consults") return { offerId: null, reason: "seller_metadata_mismatch" };
  const offerId = typeof paymentIntent.metadata?.offer === "string" ? paymentIntent.metadata.offer : null;
  const offer = getCheckoutOffer(offerId ?? "");
  if (!offer) return { offerId: null, reason: "unknown_offer" };
  if (offer.openAmount) {
    if (!Number.isInteger(paymentIntent.amount) || paymentIntent.amount < 100 || paymentIntent.amount > 1_000_000) return { offerId, reason: "open_amount_out_of_range" };
    if (paymentIntent.currency !== "usd" && paymentIntent.currency !== "eur") return { offerId, reason: "open_currency_mismatch" };
    return { offerId, reason: null };
  }
  if (paymentIntent.amount !== offer.amount) return { offerId, reason: "amount_mismatch" };
  if (paymentIntent.currency !== offer.currency) return { offerId, reason: "currency_mismatch" };
  return { offerId, reason: null };
}

export interface PaidOrderStore {
  recordPaymentIntentEvent(event: Stripe.Event): Promise<PaidOrderEventResult>;
}

export class PostgresPaidOrderStore implements PaidOrderStore {
  private readonly database: Database;

  constructor(connectionStringOrDatabase: string | Database) {
    this.database = typeof connectionStringOrDatabase === "string"
      ? new Pool({ connectionString: connectionStringOrDatabase, max: 5 }) as unknown as Database
      : connectionStringOrDatabase;
  }

  async recordPaymentIntentEvent(event: Stripe.Event): Promise<PaidOrderEventResult> {
    if (!PAYMENT_INTENT_EVENT_TYPES.has(event.type)) return { duplicate: false, order: null };
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const validation = validMetadata(paymentIntent);
    const validationStatus = validation.reason ? "quarantined" : "valid";
    const client = this.database.connect ? await this.database.connect() : null;
    const database = client ?? this.database;
    try {
      await database.query("BEGIN");
      const eventInsert = await database.query(
        `INSERT INTO stripe_paid_order_events (event_id, payment_intent_id, event_type, validation_status, validation_reason)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, paymentIntent.id, event.type, validationStatus, validation.reason]
      );
      if (eventInsert.rowCount !== 1) {
        await database.query("COMMIT");
        return { duplicate: true, order: await this.get(paymentIntent.id) };
      }

      const status = validation.reason ? "quarantined" : statusForEvent(event.type);
      const currentResult = await database.query(
        `SELECT payment_intent_id, offer_id, amount, currency, customer_email, customer_id, livemode,
                payment_status, validation_status, validation_reason, metadata,
                first_event_id, last_event_id
           FROM stripe_paid_orders WHERE payment_intent_id = $1 FOR UPDATE`, [paymentIntent.id]
      );
      const current = rowToRecord(currentResult.rows[0] as PaidOrderRow | undefined);
      const nextStatus = current && current.validationStatus === "valid" && status === "quarantined"
        ? current.paymentStatus
        : current && statusRank[current.paymentStatus] > statusRank[status] ? current.paymentStatus : status;
      await database.query(
      `INSERT INTO stripe_paid_orders
         (payment_intent_id, offer_id, amount, currency, customer_email, customer_id, livemode,
         payment_status, validation_status, validation_reason, metadata,
         first_event_id, last_event_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $12)
       ON CONFLICT (payment_intent_id) DO UPDATE SET
         offer_id = COALESCE(stripe_paid_orders.offer_id, EXCLUDED.offer_id),
         customer_email = COALESCE(stripe_paid_orders.customer_email, EXCLUDED.customer_email),
         customer_id = COALESCE(stripe_paid_orders.customer_id, EXCLUDED.customer_id),
         payment_status = $13,
         validation_status = CASE WHEN stripe_paid_orders.validation_status = 'valid' THEN 'valid' ELSE EXCLUDED.validation_status END,
         validation_reason = CASE WHEN stripe_paid_orders.validation_status = 'valid' THEN NULL ELSE EXCLUDED.validation_reason END,
         metadata = EXCLUDED.metadata,
         last_event_id = EXCLUDED.last_event_id,
         updated_at = NOW()`,
        [
        paymentIntent.id, validation.offerId, paymentIntent.amount, paymentIntent.currency,
        paymentIntent.receipt_email ?? null, typeof paymentIntent.customer === "string" ? paymentIntent.customer : null,
        event.livemode, status, validationStatus,
        validation.reason, JSON.stringify(paymentIntent.metadata ?? {}), event.id, nextStatus
        ]
      );
      await database.query("COMMIT");
      return { duplicate: false, order: await this.get(paymentIntent.id) };
    } catch (error) {
      try { await database.query("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client?.release();
    }
  }

  private async get(paymentIntentId: string): Promise<PaidOrderRecord | null> {
    const result = await this.database.query(
      `SELECT payment_intent_id, offer_id, amount, currency, customer_email, customer_id, livemode,
              payment_status, validation_status, validation_reason, metadata,
              first_event_id, last_event_id
         FROM stripe_paid_orders WHERE payment_intent_id = $1`, [paymentIntentId]
    );
    return rowToRecord(result.rows[0] as PaidOrderRow | undefined);
  }
}

export const RETAINER_SCOPE = "maintenance of a working on-ramp link" as const;
export const RETAINER_OFFER_ID = "operations-assurance-retainer-195-usd-monthly" as const;
export const RETAINER_SITE_URL = "https://ledgerline-compliance.sthomas935.chatgpt.site" as const;
export const RETAINER_PRICE_AMOUNT = 19_500 as const;
export const RETAINER_CURRENCY = "usd" as const;
export const RETAINER_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted"
]);

export interface RetainerStore {
  recordEvent(event: Stripe.Event): Promise<void>;
}

type RetainerDatabase = Database;

type RetainerObject = Record<string, unknown>;

function objectValue(value: unknown): RetainerObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RetainerObject : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function metadataValue(value: unknown): Record<string, string> {
  const object = objectValue(value);
  if (!object) return {};
  return Object.fromEntries(Object.entries(object).filter(([, item]) => typeof item === "string")) as Record<string, string>;
}

function firstLine(object: RetainerObject): RetainerObject | null {
  for (const collection of [object.lines, object.line_items, object.items]) {
    const data = objectValue(collection)?.data;
    if (Array.isArray(data)) {
      const first = objectValue(data[0]);
      if (first) return first;
    }
  }
  return null;
}

function priceDetails(line: RetainerObject | null): { amount: number | null; currency: string | null; interval: string | null } {
  const price = objectValue(line?.price) ?? objectValue(objectValue(line?.pricing)?.price_details);
  const recurring = objectValue(price?.recurring);
  return {
    amount: typeof price?.unit_amount === "number" ? price.unit_amount : null,
    currency: stringValue(price?.currency),
    interval: stringValue(recurring?.interval)
  };
}

function subscriptionDetails(object: RetainerObject): RetainerObject | null {
  return objectValue(objectValue(object.parent)?.subscription_details);
}

function retainerEventDetails(event: Stripe.Event): {
  subscriptionId: string | null;
  metadata: Record<string, string>;
  customerId: string | null;
  customerEmail: string | null;
  amount: number | null;
  currency: string | null;
  interval: string | null;
  subscriptionMode: string | null;
} {
  const object = event.data.object as unknown as RetainerObject;
  const parentSubscription = subscriptionDetails(object);
  const directSubscription = stringValue(object.subscription);
  const subscriptionId = directSubscription
    ?? stringValue(parentSubscription?.subscription)
    ?? (event.type.startsWith("customer.subscription.") ? stringValue(object.id) : null);
  const metadata = Object.keys(metadataValue(object.metadata)).length > 0
    ? metadataValue(object.metadata)
    : metadataValue(parentSubscription?.metadata);
  const customerDetails = objectValue(object.customer_details);
  const customerId = stringValue(object.customer) ?? stringValue(customerDetails?.id);
  const customerEmail = stringValue(object.customer_email) ?? stringValue(customerDetails?.email);
  const line = firstLine(object);
  const price = priceDetails(line);
  const amount = event.type === "invoice.paid"
    ? (typeof object.amount_paid === "number" ? object.amount_paid : typeof object.amount_due === "number" ? object.amount_due : price.amount)
    : event.type === "invoice.payment_failed"
      ? (typeof object.amount_due === "number" ? object.amount_due : price.amount)
      : event.type === "checkout.session.completed"
        ? (typeof object.amount_total === "number" ? object.amount_total : price.amount)
        : price.amount;
  const currency = stringValue(object.currency) ?? price.currency;
  const interval = price.interval;
  return {
    subscriptionId,
    metadata,
    customerId,
    customerEmail,
    amount,
    currency,
    interval,
    subscriptionMode: stringValue(object.mode)
  };
}

function isValidRetainerEvent(event: Stripe.Event, details: ReturnType<typeof retainerEventDetails>): boolean {
  if (details.metadata.seller !== "SET Business Consults" || details.metadata.offer !== RETAINER_OFFER_ID) return false;
  if (details.amount !== RETAINER_PRICE_AMOUNT || details.currency !== RETAINER_CURRENCY) return false;
  if (details.interval !== null && details.interval !== "month") return false;
  if (event.type === "checkout.session.completed" && details.subscriptionMode !== "subscription") return false;
  return Boolean(details.subscriptionId);
}

function retainerStatus(event: Stripe.Event, object: RetainerObject): string {
  if (event.type === "invoice.payment_failed") return "past_due";
  if (event.type === "invoice.paid") return "paid";
  if (event.type === "customer.subscription.deleted") return "canceled";
  if (event.type === "customer.subscription.updated") return stringValue(object.status) ?? "active";
  return "checkout_completed";
}

export class PostgresRetainerStore implements RetainerStore {
  private readonly database: RetainerDatabase;

  constructor(connectionStringOrDatabase: string | RetainerDatabase) {
    this.database = typeof connectionStringOrDatabase === "string"
      ? new Pool({ connectionString: connectionStringOrDatabase, max: 5 }) as unknown as RetainerDatabase
      : connectionStringOrDatabase;
  }

  async recordEvent(event: Stripe.Event): Promise<void> {
    if (!RETAINER_EVENT_TYPES.has(event.type)) return;
    const details = retainerEventDetails(event);
    if (!isValidRetainerEvent(event, details)) return;
    const subscriptionId = details.subscriptionId!;
    const object = event.data.object as unknown as RetainerObject;
    const invoicePeriodEnd = typeof objectValue(firstLine(object)?.period)?.end === "number"
      ? objectValue(firstLine(object)?.period)!.end as number
      : event.created;
    const client = this.database.connect ? await this.database.connect() : null;
    const database = client ?? this.database;
    try {
      await database.query("BEGIN");
      const eventResult = await database.query(
        `INSERT INTO stripe_retainer_events (event_id, subscription_id, event_type, event_created)
         VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [event.id, subscriptionId, event.type, event.created]
      );
      if (eventResult.rowCount !== 1) {
        await database.query("COMMIT");
        return;
      }
      await database.query(
        `INSERT INTO stripe_retainer_subscriptions
           (subscription_id, customer_id, customer_email, status, payment_status, paid_through,
            price_amount, currency, scope, livemode, last_event_id, last_event_created,
            last_invoice_event_created, last_subscription_event_created)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (subscription_id) DO UPDATE SET
           customer_id = COALESCE(stripe_retainer_subscriptions.customer_id, EXCLUDED.customer_id),
           customer_email = COALESCE(stripe_retainer_subscriptions.customer_email, EXCLUDED.customer_email),
           status = CASE
             WHEN stripe_retainer_subscriptions.status = 'canceled' THEN stripe_retainer_subscriptions.status
             WHEN stripe_retainer_subscriptions.last_event_created < EXCLUDED.last_event_created THEN EXCLUDED.status
             ELSE stripe_retainer_subscriptions.status
           END,
           payment_status = CASE
             WHEN EXCLUDED.last_invoice_event_created > 0
               AND stripe_retainer_subscriptions.last_invoice_event_created <= EXCLUDED.last_invoice_event_created
             THEN EXCLUDED.payment_status
             ELSE stripe_retainer_subscriptions.payment_status
           END,
           paid_through = CASE
             WHEN EXCLUDED.payment_status = 'paid'
               AND stripe_retainer_subscriptions.last_invoice_event_created <= EXCLUDED.last_invoice_event_created
             THEN EXCLUDED.paid_through
             ELSE stripe_retainer_subscriptions.paid_through
           END,
           price_amount = EXCLUDED.price_amount,
           currency = EXCLUDED.currency,
           last_event_id = CASE WHEN stripe_retainer_subscriptions.last_event_created < EXCLUDED.last_event_created THEN EXCLUDED.last_event_id ELSE stripe_retainer_subscriptions.last_event_id END,
           last_event_created = GREATEST(stripe_retainer_subscriptions.last_event_created, EXCLUDED.last_event_created),
           last_invoice_event_created = GREATEST(stripe_retainer_subscriptions.last_invoice_event_created, EXCLUDED.last_invoice_event_created),
           last_subscription_event_created = GREATEST(stripe_retainer_subscriptions.last_subscription_event_created, EXCLUDED.last_subscription_event_created),
           updated_at = NOW()`,
        [
          subscriptionId,
          details.customerId,
          details.customerEmail,
          retainerStatus(event, object),
          event.type === "invoice.paid" ? "paid" : event.type === "invoice.payment_failed" ? "failed" : "unpaid",
          event.type === "invoice.paid" ? invoicePeriodEnd : null,
          RETAINER_PRICE_AMOUNT,
          RETAINER_CURRENCY,
          RETAINER_SCOPE,
          event.livemode,
          event.id,
          event.created,
          event.type.startsWith("invoice.") ? event.created : 0,
          event.type === "checkout.session.completed" || event.type.startsWith("customer.subscription.") ? event.created : 0
        ]
      );
      await database.query("COMMIT");
    } catch (error) {
      try { await database.query("ROLLBACK"); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client?.release();
    }
  }
}
