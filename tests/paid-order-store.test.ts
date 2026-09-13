import { describe, expect, it, vi } from "vitest";
import { PostgresRetainerStore, RETAINER_OFFER_ID, RETAINER_SCOPE } from "../src/paid-order-store.js";

type QueryReply = { rowCount: number; rows?: readonly Record<string, unknown>[] };

function databaseReturning(...replies: QueryReply[]) {
  const query = vi.fn(async (text: string, _values?: readonly unknown[]) => {
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected query: ${text}`);
    return { rowCount: reply.rowCount, rows: reply.rows ?? [] };
  });
  return { query, calls: query };
}

function event(type: string, object: Record<string, unknown>, created = 1_700_000_000) {
  return {
    id: `evt_${type.replaceAll(".", "_")}_${created}`,
    object: "event",
    type,
    created,
    livemode: false,
    data: { object }
  } as never;
}

const checkoutMetadata = {
  seller: "SET Business Consults",
  offer: RETAINER_OFFER_ID,
  scope: RETAINER_SCOPE
};

describe("durable retainer billing store", () => {
  it("records a valid modern invoice with parent subscription metadata and customer email", async () => {
    const db = databaseReturning({ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 });
    const store = new PostgresRetainerStore(db);
    await store.recordEvent(event("invoice.paid", {
      id: "in_1",
      customer: "cus_1",
      customer_email: "buyer@example.com",
      currency: "usd",
      amount_paid: 19_500,
      parent: {
        subscription_details: {
          subscription: "sub_1",
          metadata: checkoutMetadata
        }
      },
      lines: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 200));

    expect(db.calls.mock.calls.map(([text]) => text)).toEqual([
      "BEGIN",
      expect.stringContaining("stripe_retainer_events"),
      expect.stringContaining("stripe_retainer_subscriptions"),
      "COMMIT"
    ]);
    expect(db.calls.mock.calls[1]?.[0]).toContain("event_created");
    expect(db.calls.mock.calls[1]?.[1]).toEqual(["evt_invoice_paid_200", "sub_1", "invoice.paid", 200]);
    expect(db.calls.mock.calls[2]?.[1]).toEqual([
      "sub_1", "cus_1", "buyer@example.com", "paid", "paid", 200, 19_500, "usd", RETAINER_SCOPE, false, "evt_invoice_paid_200", 200, 200, 0
    ]);
  });

  it("uses checkout customer_details.email and validates the exact monthly offer", async () => {
    const db = databaseReturning({ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 });
    const store = new PostgresRetainerStore(db);
    await store.recordEvent(event("checkout.session.completed", {
      id: "cs_1",
      subscription: "sub_checkout",
      customer: "cus_checkout",
      customer_details: { email: "checkout@example.com" },
      mode: "subscription",
      amount_total: 19_500,
      currency: "usd",
      metadata: checkoutMetadata,
      line_items: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 210));

    expect(db.calls.mock.calls[2]?.[1]).toEqual([
      "sub_checkout", "cus_checkout", "checkout@example.com", "checkout_completed", "unpaid", null, 19_500, "usd", RETAINER_SCOPE, false, "evt_checkout_session_completed_210", 210, 0, 210
    ]);
  });

  it("records a paid asynchronous Checkout completion as paid retainer evidence", async () => {
    const db = databaseReturning({ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 });
    const store = new PostgresRetainerStore(db);
    await store.recordEvent(event("checkout.session.async_payment_succeeded", {
      id: "cs_async_paid",
      subscription: "sub_async_paid",
      customer: "cus_async_paid",
      mode: "subscription",
      payment_status: "paid",
      amount_total: 19_500,
      currency: "usd",
      metadata: checkoutMetadata,
      line_items: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 215));

    expect(db.calls.mock.calls[2]?.[1]).toEqual([
      "sub_async_paid", "cus_async_paid", null, "paid", "paid", 215, 19_500, "usd", RETAINER_SCOPE, false, "evt_checkout_session_async_payment_succeeded_215", 215, 0, 215
    ]);
  });

  it("does not treat an unpaid asynchronous Checkout completion as paid evidence", async () => {
    const query = vi.fn();
    const store = new PostgresRetainerStore({ query });
    await store.recordEvent(event("checkout.session.async_payment_succeeded", {
      id: "cs_async_unpaid",
      subscription: "sub_async_unpaid",
      mode: "subscription",
      payment_status: "unpaid",
      amount_total: 19_500,
      currency: "usd",
      metadata: checkoutMetadata
    }, 216));

    expect(query).not.toHaveBeenCalled();
  });

  it("does not treat an active subscription event as payment evidence", async () => {
    const db = databaseReturning({ rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 });
    const store = new PostgresRetainerStore(db);
    await store.recordEvent(event("customer.subscription.updated", {
      id: "sub_active",
      customer: "cus_active",
      status: "active",
      metadata: checkoutMetadata,
      items: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 220));

    expect(db.calls.mock.calls[2]?.[1]?.[3]).toBe("active");
    expect(db.calls.mock.calls[2]?.[1]?.[3]).not.toBe("paid");
    expect(db.calls.mock.calls[2]?.[1]?.[4]).toBe("unpaid");
  });

  it("claims duplicate events atomically and does not write the subscription twice", async () => {
    const db = databaseReturning(
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
      { rowCount: 1 }, { rowCount: 0 }, { rowCount: 1 }
    );
    const store = new PostgresRetainerStore(db);
    const input = event("invoice.paid", {
      customer: "cus_1", customer_email: "buyer@example.com", currency: "usd", amount_paid: 19_500,
      parent: { subscription_details: { subscription: "sub_1", metadata: checkoutMetadata } },
      lines: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    });
    await store.recordEvent(input);
    await store.recordEvent(input);

    expect(db.calls.mock.calls.map(([text]) => text)).toEqual([
      "BEGIN", expect.stringContaining("INSERT INTO stripe_retainer_events"), expect.stringContaining("INSERT INTO stripe_retainer_subscriptions"), "COMMIT",
      "BEGIN", expect.stringContaining("INSERT INTO stripe_retainer_events"), "COMMIT"
    ]);
  });

  it("keeps a newer event state when an older event is delivered later", async () => {
    const db = databaseReturning(
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 0 }, { rowCount: 1 }
    );
    const store = new PostgresRetainerStore(db);
    const newer = event("invoice.paid", {
      customer: "cus_1", customer_email: "buyer@example.com", currency: "usd", amount_paid: 19_500,
      parent: { subscription_details: { subscription: "sub_1", metadata: checkoutMetadata } },
      lines: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 300);
    const older = event("checkout.session.completed", {
      subscription: "sub_1", customer: "cus_1", customer_details: { email: "buyer@example.com" }, mode: "subscription",
      amount_total: 19_500, currency: "usd", metadata: checkoutMetadata
    }, 200);
    await store.recordEvent(newer);
    await store.recordEvent(older);

    expect(db.calls.mock.calls[6]?.[0]).toContain("stripe_retainer_subscriptions");
    expect(db.calls.mock.calls[6]?.[0]).toContain("last_event_created < EXCLUDED.last_event_created");
    expect((db.calls.mock.calls[6]?.[1] as readonly unknown[] | undefined)?.at(-1)).toBe(200);
  });

  it("retains a delayed invoice payment independently of a newer subscription update", async () => {
    const db = databaseReturning(
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }
    );
    const store = new PostgresRetainerStore(db);
    await store.recordEvent(event("customer.subscription.updated", {
      id: "sub_delayed_invoice", customer: "cus_1", status: "active", metadata: checkoutMetadata,
      items: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 300));
    await store.recordEvent(event("invoice.paid", {
      customer: "cus_1", customer_email: "buyer@example.com", currency: "usd", amount_paid: 19_500,
      parent: { subscription_details: { subscription: "sub_delayed_invoice", metadata: checkoutMetadata } },
      lines: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }, 200));

    const delayedInvoiceParams = db.calls.mock.calls[6]?.[1] as readonly unknown[];
    expect(delayedInvoiceParams[4]).toBe("paid");
    expect(delayedInvoiceParams[5]).toBe(200);
    expect(db.calls.mock.calls[6]?.[0]).toContain("last_invoice_event_created");
  });

  it("keeps cancellation terminal even when a newer active update arrives", async () => {
    const db = databaseReturning(
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 },
      { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }, { rowCount: 1 }
    );
    const store = new PostgresRetainerStore(db);
    const canceled = {
      id: "sub_terminal", customer: "cus_1", status: "canceled", metadata: checkoutMetadata,
      items: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    };
    const active = { ...canceled, status: "active" };
    await store.recordEvent(event("customer.subscription.deleted", canceled, 300));
    await store.recordEvent(event("customer.subscription.updated", active, 400));

    expect(db.calls.mock.calls[6]?.[0]).toContain("status = CASE");
    expect(db.calls.mock.calls[6]?.[0]).toContain("status = 'canceled'");
  });

  it("rolls back the event claim when the subscription write fails", async () => {
    const db = databaseReturning({ rowCount: 1 }, { rowCount: 1 });
    db.calls.mockImplementationOnce(async () => ({ rowCount: 1, rows: [] }));
    db.calls.mockImplementationOnce(async () => ({ rowCount: 1, rows: [] }));
    db.calls.mockImplementationOnce(async () => { throw new Error("database unavailable"); });
    db.calls.mockImplementationOnce(async (text: string) => {
      expect(text).toBe("ROLLBACK");
      return { rowCount: 1, rows: [] };
    });
    const store = new PostgresRetainerStore(db);
    await expect(store.recordEvent(event("invoice.paid", {
      currency: "usd", amount_paid: 19_500,
      parent: { subscription_details: { subscription: "sub_rollback", metadata: checkoutMetadata } },
      lines: { data: [{ price: { unit_amount: 19_500, currency: "usd", recurring: { interval: "month" } } }] }
    }))).rejects.toThrow("database unavailable");
    expect(db.calls.mock.calls.map(([text]) => text)).toEqual(["BEGIN", expect.stringContaining("stripe_retainer_events"), expect.stringContaining("stripe_retainer_subscriptions"), "ROLLBACK"]);
  });

  it("ignores a mismatched amount before claiming the event", async () => {
    const query = vi.fn();
    const store = new PostgresRetainerStore({ query });
    await store.recordEvent(event("invoice.paid", {
      currency: "usd", amount_paid: 19_499,
      parent: { subscription_details: { subscription: "sub_wrong", metadata: checkoutMetadata } },
      lines: { data: [{ price: { unit_amount: 19_499, currency: "usd", recurring: { interval: "month" } } }] }
    }));
    expect(query).not.toHaveBeenCalled();
  });
});
