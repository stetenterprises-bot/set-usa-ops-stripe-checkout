import { describe, expect, it } from "vitest";
import type { Receipt } from "mppx";
import {
  buildReadinessAssessment,
  readinessDomains,
  validateReadinessAssessmentInput,
  type ReadinessAssessmentInput
} from "../src/readiness-assessment.js";
import {
  AssessmentConflictError,
  AssessmentReceiptPendingError,
  InMemoryReadinessAssessmentStore
} from "../src/readiness-assessment-store.js";

const completeInput = (status: "implemented" | "partial" | "missing" | "unknown" = "implemented"): ReadinessAssessmentInput => ({
  workflow: { name: "Agent checkout", intendedUsers: "agents", targetEnvironment: "production" },
  capabilities: Object.fromEntries(readinessDomains.map((domain) => [domain, { status }])) as ReadinessAssessmentInput["capabilities"]
});

describe("agentic commerce readiness assessment", () => {
  it("requires every bounded capability and rejects unknown domains", () => {
    expect(validateReadinessAssessmentInput({})).toMatchObject({ ok: false });
    expect(validateReadinessAssessmentInput({
      ...completeInput(),
      capabilities: { ...completeInput().capabilities, invented: { status: "implemented" } }
    })).toMatchObject({ ok: false, error: expect.stringContaining("Unsupported") });
    expect(validateReadinessAssessmentInput(completeInput())).toEqual({ ok: true, input: completeInput() });
  });

  it("keeps declared evidence separate from verification and derives a deterministic disposition", () => {
    const input = completeInput();
    input.capabilities.wallet_ownership = { status: "unknown" };
    const artifact = buildReadinessAssessment(input, "assessment-key-123", "mpp_receipt_1", "2026-09-01T00:00:00.000Z");

    expect(artifact.findings.verified).toEqual([]);
    expect(artifact.findings.unknown).toHaveLength(1);
    expect(artifact.findings.unknown[0]?.domain).toBe("wallet_ownership");
    expect(artifact.readinessDisposition).toBe("not_ready");
    expect(artifact.prioritizedActivationSequence[0]).toMatchObject({ priority: 1, domain: "wallet_ownership" });
    expect(artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not promote declaration-only evidence to production review", () => {
    const artifact = buildReadinessAssessment(completeInput(), "assessment-key-456", "mpp_receipt_2", "2026-09-01T00:00:00.000Z");
    expect(artifact.readinessDisposition).toBe("sandbox_activation");
    expect(artifact.findings.verified).toEqual([]);
    expect(artifact.executionAuthorized).toBe(false);
  });

  it("binds one request and receipt to one idempotency key and replays the stored artifact", async () => {
    const store = new InMemoryReadinessAssessmentStore();
    const input = completeInput();
    const receipt: Receipt.Receipt = {
      method: "stripe",
      reference: "mpp_receipt_1",
      status: "success",
      timestamp: "2026-09-01T00:00:00.000Z"
    };

    await store.prepare("assessment-key-123", input);
    await expect(store.fulfill("assessment-key-123", input)).rejects.toBeInstanceOf(AssessmentReceiptPendingError);
    await store.recordPayment("assessment-key-123", receipt);
    const first = await store.fulfill("assessment-key-123", input);
    const replay = await store.fulfill("assessment-key-123", input);
    const recovered = await store.recover("assessment-key-123");

    expect(replay).toEqual(first);
    expect(recovered).toEqual(first);
    expect(replay.receiptReference).toBe("mpp_receipt_1");
    await expect(store.prepare("assessment-key-123", { ...input, workflow: { ...input.workflow, name: "Different" } }))
      .rejects.toBeInstanceOf(AssessmentConflictError);
    await expect(store.recordPayment("assessment-key-123", { ...receipt, reference: "different_receipt" }))
      .rejects.toBeInstanceOf(AssessmentConflictError);
  });
});
