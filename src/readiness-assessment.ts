import crypto from "node:crypto";

export const READINESS_SCHEMA_VERSION = "1.0.0" as const;
export const READINESS_RULESET_VERSION = "2026-09-01.1" as const;

export const readinessDomains = [
  "machine_discovery",
  "payment_challenge_and_receipt",
  "idempotency",
  "webhook_verification",
  "durable_fulfillment",
  "user_authentication",
  "wallet_ownership",
  "onramp_provider_handoff",
  "delivery_evidence",
  "recovery_and_reconciliation"
] as const;

export type ReadinessDomain = typeof readinessDomains[number];
export type DeclaredCapabilityStatus = "implemented" | "partial" | "missing" | "unknown";

export type ReadinessAssessmentInput = {
  workflow: {
    name: string;
    intendedUsers: "humans" | "agents" | "both";
    targetEnvironment: "sandbox" | "production";
  };
  capabilities: Record<ReadinessDomain, {
    status: DeclaredCapabilityStatus;
    evidence?: string[];
  }>;
};

export type ReadinessFinding = {
  domain: ReadinessDomain;
  classification: "user_reported" | "unknown";
  status: DeclaredCapabilityStatus;
  summary: string;
  evidence: string[];
};

export type ReadinessAssessmentArtifact = {
  type: "agentic_commerce_readiness_assessment";
  executionAuthorized: false;
  assessmentId: string;
  schemaVersion: typeof READINESS_SCHEMA_VERSION;
  rulesetVersion: typeof READINESS_RULESET_VERSION;
  normalizedInput: ReadinessAssessmentInput;
  findings: {
    verified: ReadinessFinding[];
    userReported: ReadinessFinding[];
    inferred: Array<{ classification: "inferred"; summary: string }>;
    unknown: ReadinessFinding[];
  };
  readinessDisposition: "not_ready" | "sandbox_activation" | "production_review";
  blockingControls: Array<{ domain: ReadinessDomain; reason: string }>;
  prioritizedActivationSequence: Array<{ priority: number; domain: ReadinessDomain; action: string }>;
  receiptReference: string;
  fulfillmentTimestamp: string;
  artifactHash: string;
};

export type AssessmentValidation =
  | { ok: true; input: ReadinessAssessmentInput }
  | { ok: false; error: string };

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length >= 1 && normalized.length <= maximum ? normalized : null;
}

export function validateReadinessAssessmentInput(value: unknown): AssessmentValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "The request body must be an object." };
  }
  const body = value as Record<string, unknown>;
  const workflow = body.workflow;
  const capabilities = body.capabilities;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    return { ok: false, error: "workflow is required." };
  }
  if (!capabilities || typeof capabilities !== "object" || Array.isArray(capabilities)) {
    return { ok: false, error: "capabilities is required." };
  }
  const workflowRecord = workflow as Record<string, unknown>;
  const name = boundedText(workflowRecord.name, 120);
  const intendedUsers = workflowRecord.intendedUsers;
  const targetEnvironment = workflowRecord.targetEnvironment;
  if (!name) return { ok: false, error: "workflow.name must contain 1 to 120 characters." };
  if (!(["humans", "agents", "both"] as unknown[]).includes(intendedUsers)) {
    return { ok: false, error: "workflow.intendedUsers must be humans, agents, or both." };
  }
  if (!(["sandbox", "production"] as unknown[]).includes(targetEnvironment)) {
    return { ok: false, error: "workflow.targetEnvironment must be sandbox or production." };
  }

  const capabilityRecord = capabilities as Record<string, unknown>;
  const unknownDomains = Object.keys(capabilityRecord).filter((key) => !readinessDomains.includes(key as ReadinessDomain));
  if (unknownDomains.length > 0) return { ok: false, error: `Unsupported capability domain: ${unknownDomains[0]}.` };

  const normalizedCapabilities = {} as ReadinessAssessmentInput["capabilities"];
  for (const domain of readinessDomains) {
    const candidate = capabilityRecord[domain];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, error: `capabilities.${domain} is required.` };
    }
    const record = candidate as Record<string, unknown>;
    const status = record.status;
    if (!(["implemented", "partial", "missing", "unknown"] as unknown[]).includes(status)) {
      return { ok: false, error: `capabilities.${domain}.status is invalid.` };
    }
    const rawEvidence = record.evidence ?? [];
    if (!Array.isArray(rawEvidence) || rawEvidence.length > 5) {
      return { ok: false, error: `capabilities.${domain}.evidence must contain at most 5 items.` };
    }
    const evidence: string[] = [];
    for (const item of rawEvidence) {
      const normalized = boundedText(item, 240);
      if (!normalized) return { ok: false, error: `capabilities.${domain}.evidence items must contain 1 to 240 characters.` };
      evidence.push(normalized);
    }
    normalizedCapabilities[domain] = { status: status as DeclaredCapabilityStatus, ...(evidence.length ? { evidence } : {}) };
  }

  return {
    ok: true,
    input: {
      workflow: {
        name,
        intendedUsers: intendedUsers as ReadinessAssessmentInput["workflow"]["intendedUsers"],
        targetEnvironment: targetEnvironment as ReadinessAssessmentInput["workflow"]["targetEnvironment"]
      },
      capabilities: normalizedCapabilities
    }
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function readinessRequestHash(input: ReadinessAssessmentInput): string {
  return crypto.createHash("sha256").update(canonicalJson(input)).digest("hex");
}

const actions: Record<ReadinessDomain, string> = {
  machine_discovery: "Publish and validate a machine-readable service and paid-route contract.",
  payment_challenge_and_receipt: "Verify the payment challenge and retain a provider-verifiable receipt.",
  idempotency: "Bind retries to one stable logical request and prevent duplicate fulfillment.",
  webhook_verification: "Verify signed provider events before changing fulfillment state.",
  durable_fulfillment: "Persist payment and fulfillment state across process restarts.",
  user_authentication: "Authenticate the intended user before releasing user-bound capabilities.",
  wallet_ownership: "Record and verify who controls each destination wallet.",
  onramp_provider_handoff: "Validate provider eligibility and require explicit authorization before handoff.",
  delivery_evidence: "Record independently reconcilable delivery evidence before entitlement release.",
  recovery_and_reconciliation: "Reconcile ambiguous outcomes before accepting another payment or provider action."
};

export function buildReadinessAssessment(
  input: ReadinessAssessmentInput,
  idempotencyKey: string,
  receiptReference: string,
  fulfillmentTimestamp: string
): ReadinessAssessmentArtifact {
  const findings = readinessDomains.map((domain): ReadinessFinding => {
    const capability = input.capabilities[domain];
    return {
      domain,
      classification: capability.status === "unknown" ? "unknown" : "user_reported",
      status: capability.status,
      summary: capability.status === "implemented"
        ? `${domain} is declared implemented; independent verification was not performed by this assessment.`
        : `${domain} is declared ${capability.status}.`,
      evidence: capability.evidence ?? []
    };
  });
  const blocking = findings.filter((finding) => finding.status !== "implemented");
  const readinessDisposition: ReadinessAssessmentArtifact["readinessDisposition"] = blocking.some((finding) =>
    finding.status === "missing" || finding.status === "unknown")
    ? "not_ready"
    : "sandbox_activation";
  const requestHash = readinessRequestHash(input);
  const assessmentId = `ara_${crypto.createHash("sha256").update(`${idempotencyKey}:${requestHash}`).digest("hex").slice(0, 24)}`;
  const artifactCore = {
    type: "agentic_commerce_readiness_assessment" as const,
    executionAuthorized: false as const,
    assessmentId,
    schemaVersion: READINESS_SCHEMA_VERSION,
    rulesetVersion: READINESS_RULESET_VERSION,
    normalizedInput: input,
    findings: {
      verified: [] as ReadinessFinding[],
      userReported: findings.filter((finding) => finding.classification === "user_reported"),
      inferred: [{ classification: "inferred" as const, summary: `The deterministic ruleset assigned ${readinessDisposition} from buyer-declared capability states. Declaration-only evidence cannot produce production_review.` }],
      unknown: findings.filter((finding) => finding.classification === "unknown")
    },
    readinessDisposition,
    blockingControls: blocking.map((finding) => ({ domain: finding.domain, reason: actions[finding.domain] })),
    prioritizedActivationSequence: blocking.map((finding, index) => ({ priority: index + 1, domain: finding.domain, action: actions[finding.domain] })),
    receiptReference,
    fulfillmentTimestamp
  };
  return {
    ...artifactCore,
    artifactHash: crypto.createHash("sha256").update(canonicalJson(artifactCore)).digest("hex")
  };
}
