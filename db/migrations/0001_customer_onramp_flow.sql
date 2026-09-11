CREATE TABLE IF NOT EXISTS customer_onramp_requests (
  request_id TEXT PRIMARY KEY,
  owner_privy_user_id TEXT,
  state TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  exact_answers JSONB NOT NULL,
  normalized_intake JSONB NOT NULL,
  privy_wallet_id TEXT,
  wallet_address TEXT,
  wallet_chain_type TEXT,
  destination_asset TEXT NOT NULL,
  destination_network TEXT NOT NULL,
  source_currency TEXT NOT NULL,
  source_amount TEXT,
  destination_amount TEXT,
  quote_id TEXT,
  quote_expires_at TIMESTAMPTZ,
  quote_snapshot JSONB,
  quote_fees JSONB,
  quote_expiry_source TEXT,
  approval_digest TEXT,
  approval_nonce_hash TEXT,
  approval_consumed_at TIMESTAMPTZ,
  onramp_session_id TEXT UNIQUE,
  onramp_mode TEXT NOT NULL CHECK (onramp_mode IN ('sandbox', 'live')),
  provider_status TEXT,
  delivered_amount TEXT,
  transaction_id TEXT,
  entitlement_status TEXT NOT NULL DEFAULT 'locked' CHECK (entitlement_status IN ('locked', 'released')),
  entitlement_type TEXT NOT NULL DEFAULT 'verified_crypto_delivery',
  entitlement_released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_onramp_events (
  event_id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES customer_onramp_requests(request_id),
  event_type TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL,
  provider_status TEXT,
  safe_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wallet_confirmations (
  request_id TEXT NOT NULL REFERENCES customer_onramp_requests(request_id),
  version INTEGER NOT NULL,
  privy_user_id TEXT NOT NULL,
  privy_wallet_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  network TEXT NOT NULL,
  asset TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated_at TIMESTAMPTZ,
  PRIMARY KEY (request_id, version)
);

CREATE TABLE IF NOT EXISTS customer_onramp_recovery_queue (
  request_id TEXT PRIMARY KEY REFERENCES customer_onramp_requests(request_id),
  reason TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agentic_readiness_assessments (
  idempotency_key TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  normalized_input JSONB NOT NULL,
  payment_receipt JSONB,
  receipt_reference TEXT UNIQUE,
  artifact JSONB,
  artifact_hash TEXT,
  fulfillment_status TEXT NOT NULL DEFAULT 'prepared' CHECK (fulfillment_status IN ('prepared', 'paid', 'fulfilled', 'recovery_required')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fulfilled_at TIMESTAMPTZ
);

-- Durable direct-payment lifecycle. Only Stripe identifiers and offer
-- metadata are retained; raw provider payloads and payment method details are
-- intentionally excluded.
CREATE TABLE IF NOT EXISTS stripe_paid_orders (
  payment_intent_id TEXT PRIMARY KEY,
  offer_id TEXT,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL,
  customer_email TEXT,
  customer_id TEXT,
  livemode BOOLEAN NOT NULL,
  payment_status TEXT NOT NULL CHECK (payment_status IN ('created', 'requires_action', 'processing', 'paid', 'failed', 'canceled', 'quarantined')),
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'quarantined')),
  validation_reason TEXT,
  metadata JSONB NOT NULL,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_paid_order_events (
  event_id TEXT PRIMARY KEY,
  payment_intent_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  validation_status TEXT NOT NULL CHECK (validation_status IN ('valid', 'quarantined')),
  validation_reason TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_retainer_subscriptions (
  subscription_id TEXT PRIMARY KEY,
  customer_id TEXT,
  customer_email TEXT,
  status TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'failed')),
  paid_through BIGINT,
  price_amount BIGINT NOT NULL DEFAULT 19500,
  currency TEXT NOT NULL DEFAULT 'usd',
  scope TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  last_event_id TEXT NOT NULL,
  last_event_created BIGINT NOT NULL DEFAULT 0,
  last_invoice_event_created BIGINT NOT NULL DEFAULT 0,
  last_subscription_event_created BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stripe_retainer_events (
  event_id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_created BIGINT NOT NULL DEFAULT 0,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep upgrades from an earlier version of this migration safe. CREATE TABLE
-- IF NOT EXISTS does not add columns to an already-existing table.
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS source_amount TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS destination_amount TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS quote_id TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS quote_expires_at TIMESTAMPTZ;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS quote_snapshot JSONB;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS quote_fees JSONB;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS quote_expiry_source TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS approval_digest TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS approval_nonce_hash TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS approval_consumed_at TIMESTAMPTZ;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS delivered_amount TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS transaction_id TEXT;
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS entitlement_status TEXT NOT NULL DEFAULT 'locked';
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS entitlement_type TEXT NOT NULL DEFAULT 'verified_crypto_delivery';
ALTER TABLE customer_onramp_requests ADD COLUMN IF NOT EXISTS entitlement_released_at TIMESTAMPTZ;
ALTER TABLE customer_onramp_recovery_queue ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE customer_onramp_recovery_queue ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE customer_onramp_recovery_queue ADD COLUMN IF NOT EXISTS lease_owner TEXT;
ALTER TABLE customer_onramp_recovery_queue ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE stripe_retainer_subscriptions ADD COLUMN IF NOT EXISTS last_event_created BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stripe_retainer_events ADD COLUMN IF NOT EXISTS event_created BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stripe_retainer_subscriptions ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid';
ALTER TABLE stripe_retainer_subscriptions ADD COLUMN IF NOT EXISTS paid_through BIGINT;
ALTER TABLE stripe_retainer_subscriptions ADD COLUMN IF NOT EXISTS last_invoice_event_created BIGINT NOT NULL DEFAULT 0;
ALTER TABLE stripe_retainer_subscriptions ADD COLUMN IF NOT EXISTS last_subscription_event_created BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_customer_onramp_owner ON customer_onramp_requests(owner_privy_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_onramp_state ON customer_onramp_requests(state) WHERE state <> 'fulfillment_complete';
CREATE INDEX IF NOT EXISTS idx_customer_onramp_events_request ON customer_onramp_events(request_id, received_at);
CREATE INDEX IF NOT EXISTS idx_customer_onramp_session ON customer_onramp_requests(onramp_session_id) WHERE onramp_session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_onramp_recovery_due ON customer_onramp_recovery_queue(next_attempt_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customer_onramp_recovery_claim ON customer_onramp_recovery_queue(next_attempt_at, lease_expires_at)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_agentic_readiness_recovery ON agentic_readiness_assessments(updated_at)
  WHERE fulfillment_status IN ('paid', 'recovery_required');
CREATE INDEX IF NOT EXISTS idx_stripe_paid_order_events_intent ON stripe_paid_order_events(payment_intent_id, received_at);
CREATE INDEX IF NOT EXISTS idx_stripe_retainer_status ON stripe_retainer_subscriptions(status, updated_at);
