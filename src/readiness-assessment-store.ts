import { Pool } from "pg";
import type { Receipt } from "mppx";
import {
  buildReadinessAssessment,
  readinessRequestHash,
  type ReadinessAssessmentArtifact,
  type ReadinessAssessmentInput
} from "./readiness-assessment.js";

export class AssessmentConflictError extends Error {}
export class AssessmentReceiptPendingError extends Error {}

export type ReadinessAssessmentStore = {
  prepare(idempotencyKey: string, input: ReadinessAssessmentInput): Promise<void>;
  recordPayment(idempotencyKey: string, receipt: Receipt.Receipt): Promise<void>;
  fulfill(idempotencyKey: string, input: ReadinessAssessmentInput): Promise<ReadinessAssessmentArtifact>;
  recover(idempotencyKey: string): Promise<ReadinessAssessmentArtifact>;
};

type AssessmentRow = {
  request_hash: string;
  normalized_input: ReadinessAssessmentInput;
  payment_receipt: Receipt.Receipt | null;
  receipt_reference: string | null;
  artifact: ReadinessAssessmentArtifact | null;
};

type AssessmentDatabase = {
  query: (text: string, values?: readonly unknown[]) => Promise<{ rowCount: number | null; rows: readonly AssessmentRow[] }>;
};

function assertIdempotencyKey(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value)) {
    throw new AssessmentConflictError("Idempotency-Key must contain 8 to 128 safe characters.");
  }
}

export class PostgresReadinessAssessmentStore implements ReadinessAssessmentStore {
  private readonly database: AssessmentDatabase;

  constructor(connectionStringOrDatabase: string | AssessmentDatabase) {
    this.database = typeof connectionStringOrDatabase === "string"
      ? new Pool({ connectionString: connectionStringOrDatabase, max: 5 }) as unknown as AssessmentDatabase
      : connectionStringOrDatabase;
  }

  async prepare(idempotencyKey: string, input: ReadinessAssessmentInput): Promise<void> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = readinessRequestHash(input);
    const result = await this.database.query(
      `INSERT INTO agentic_readiness_assessments (idempotency_key, request_hash, normalized_input)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (idempotency_key) DO UPDATE SET retry_count = agentic_readiness_assessments.retry_count + 1, updated_at = NOW()
       RETURNING request_hash, normalized_input, payment_receipt, receipt_reference, artifact`,
      [idempotencyKey, requestHash, JSON.stringify(input)]
    );
    if (result.rows[0]?.request_hash !== requestHash) {
      throw new AssessmentConflictError("The Idempotency-Key is already bound to a different readiness request.");
    }
  }

  async recordPayment(idempotencyKey: string, receipt: Receipt.Receipt): Promise<void> {
    assertIdempotencyKey(idempotencyKey);
    const result = await this.database.query(
      `UPDATE agentic_readiness_assessments
       SET payment_receipt = COALESCE(payment_receipt, $2::jsonb),
           receipt_reference = COALESCE(receipt_reference, $3),
           fulfillment_status = CASE WHEN artifact IS NULL THEN 'paid' ELSE fulfillment_status END,
           updated_at = NOW()
       WHERE idempotency_key = $1
         AND (receipt_reference IS NULL OR receipt_reference = $3)
       RETURNING request_hash, normalized_input, payment_receipt, receipt_reference, artifact`,
      [idempotencyKey, JSON.stringify(receipt), receipt.reference]
    );
    if (!result.rows[0]) throw new AssessmentConflictError("The payment receipt does not match the prepared request.");
  }

  async fulfill(idempotencyKey: string, input: ReadinessAssessmentInput): Promise<ReadinessAssessmentArtifact> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = readinessRequestHash(input);
    const result = await this.database.query(
      `SELECT request_hash, normalized_input, payment_receipt, receipt_reference, artifact
       FROM agentic_readiness_assessments WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    const record = result.rows[0];
    if (!record || record.request_hash !== requestHash) throw new AssessmentConflictError("The request does not match its prepared idempotency record.");
    if (record.artifact) return record.artifact;
    if (!record.payment_receipt || !record.receipt_reference) {
      throw new AssessmentReceiptPendingError("Payment receipt persistence is incomplete. Reconcile this same Idempotency-Key before another payment.");
    }
    const artifact = buildReadinessAssessment(input, idempotencyKey, record.receipt_reference, new Date().toISOString());
    const written = await this.database.query(
      `UPDATE agentic_readiness_assessments
       SET artifact = COALESCE(artifact, $2::jsonb), artifact_hash = COALESCE(artifact_hash, $3),
           fulfillment_status = 'fulfilled', fulfilled_at = COALESCE(fulfilled_at, NOW()), updated_at = NOW()
       WHERE idempotency_key = $1
       RETURNING request_hash, normalized_input, payment_receipt, receipt_reference, artifact`,
      [idempotencyKey, JSON.stringify(artifact), artifact.artifactHash]
    );
    if (!written.rows[0]?.artifact) throw new Error("The readiness artifact could not be persisted.");
    return written.rows[0].artifact;
  }

  async recover(idempotencyKey: string): Promise<ReadinessAssessmentArtifact> {
    assertIdempotencyKey(idempotencyKey);
    const result = await this.database.query(
      `SELECT request_hash, normalized_input, payment_receipt, receipt_reference, artifact
       FROM agentic_readiness_assessments WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    const record = result.rows[0];
    if (!record) throw new AssessmentConflictError("No readiness request exists for this Idempotency-Key.");
    return this.fulfill(idempotencyKey, record.normalized_input);
  }
}

type MemoryRecord = AssessmentRow & { retryCount: number };

export class InMemoryReadinessAssessmentStore implements ReadinessAssessmentStore {
  readonly records = new Map<string, MemoryRecord>();

  async prepare(idempotencyKey: string, input: ReadinessAssessmentInput): Promise<void> {
    assertIdempotencyKey(idempotencyKey);
    const requestHash = readinessRequestHash(input);
    const current = this.records.get(idempotencyKey);
    if (current && current.request_hash !== requestHash) throw new AssessmentConflictError("The Idempotency-Key is already bound to a different readiness request.");
    this.records.set(idempotencyKey, current ? { ...current, retryCount: current.retryCount + 1 } : {
      request_hash: requestHash,
      normalized_input: input,
      payment_receipt: null,
      receipt_reference: null,
      artifact: null,
      retryCount: 0
    });
  }

  async recordPayment(idempotencyKey: string, receipt: Receipt.Receipt): Promise<void> {
    const current = this.records.get(idempotencyKey);
    if (!current || (current.receipt_reference && current.receipt_reference !== receipt.reference)) {
      throw new AssessmentConflictError("The payment receipt does not match the prepared request.");
    }
    this.records.set(idempotencyKey, { ...current, payment_receipt: current.payment_receipt ?? receipt, receipt_reference: current.receipt_reference ?? receipt.reference });
  }

  async fulfill(idempotencyKey: string, input: ReadinessAssessmentInput): Promise<ReadinessAssessmentArtifact> {
    const current = this.records.get(idempotencyKey);
    if (!current || current.request_hash !== readinessRequestHash(input)) throw new AssessmentConflictError("The request does not match its prepared idempotency record.");
    if (current.artifact) return current.artifact;
    if (!current.receipt_reference) throw new AssessmentReceiptPendingError("Payment receipt persistence is incomplete. Reconcile this same Idempotency-Key before another payment.");
    const artifact = buildReadinessAssessment(input, idempotencyKey, current.receipt_reference, new Date().toISOString());
    this.records.set(idempotencyKey, { ...current, artifact });
    return artifact;
  }

  async recover(idempotencyKey: string): Promise<ReadinessAssessmentArtifact> {
    assertIdempotencyKey(idempotencyKey);
    const current = this.records.get(idempotencyKey);
    if (!current) throw new AssessmentConflictError("No readiness request exists for this Idempotency-Key.");
    return this.fulfill(idempotencyKey, current.normalized_input);
  }
}
