/**
 * Opt-in AI-DLC extensions, mirroring awslabs/aidlc-workflows
 * (aidlc-rules/aws-aidlc-rule-details/extensions/**): each enabled extension
 * injects a rule directive into applicable stages and mandates a compliance
 * section in the artifact; non-compliant rules are blocking findings that must
 * also be logged to aidlc-docs/audit.md.
 */

export interface ExtensionDef {
  id: string;
  name: string;
  description: string;
  /** Stage ids the directive applies to. */
  stages: string[];
  /** Prompt directive injected when enabled and the stage matches. */
  directive: string;
}

export const EXTENSIONS: ExtensionDef[] = [
  {
    id: "security-baseline",
    name: "Security Baseline",
    description:
      "15 mandatory security rules (encryption, IAM, input validation, hardening…) with a compliance section per artifact.",
    stages: [
      "requirements-analysis",
      "application-design",
      "functional-design",
      "nfr-requirements",
      "nfr-design",
      "infrastructure-design",
      "code-generation",
      "build-test",
      "deployment",
      "monitoring",
    ],
    directive: `Security Baseline extension (enabled — mandatory cross-cutting rules):
SECURITY-01 encryption at rest + TLS 1.2+ in transit for all data stores · SECURITY-02 access logging on LB/API gateways/CDN · SECURITY-03 structured centralized logging, no secrets/PII · SECURITY-04 HTTP security headers (CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy) · SECURITY-05 input validation (types, bounds, allowlists, sanitization, parameterized queries) · SECURITY-06 least-privilege IAM, no wildcards · SECURITY-07 deny-by-default networking, no 0.0.0.0/0, private endpoints · SECURITY-08 app-layer authorization (deny-by-default, object-level checks, token validation) · SECURITY-09 hardening (no defaults, minimal install, generic errors, no public storage) · SECURITY-10 pinned dependencies + lockfiles + vulnerability scanning + SBOM · SECURITY-11 security-critical logic isolation, defense in depth, rate limiting · SECURITY-12 password policy, adaptive hashing, MFA for admins, secure cookies · SECURITY-13 safe deserialization, artifact checksums, CI/CD access control, SRI · SECURITY-14 security alerts, append-only logs, 90-day retention · SECURITY-15 explicit error handling on external calls, fail-closed, resource cleanup.
End the artifact with a "Security Compliance" section listing EVERY rule as compliant / non-compliant / N/A with a one-line justification. Non-compliant rules are BLOCKING findings — call them out explicitly at the top of that section.`,
  },
  {
    id: "resiliency-baseline",
    name: "Resiliency Baseline",
    description:
      "15 resiliency rules (SLA/RTO/RPO, observability, HA, DR…) with a compliance section per artifact.",
    stages: [
      "requirements-analysis",
      "application-design",
      "nfr-requirements",
      "nfr-design",
      "infrastructure-design",
      "deployment",
      "monitoring",
    ],
    directive: `Resiliency Baseline extension (enabled — mandatory rules by pillar):
RESILIENCY-01 workload criticality + dependency maps · RESILIENCY-02 SLA/RTO/RPO targets (user decision) · RESILIENCY-03 change-management integration · RESILIENCY-04 CI/CD rollback mechanism (user decision) · RESILIENCY-05 metrics/logs/traces/dashboards for all components · RESILIENCY-06 shallow + deep health checks wired to load balancers · RESILIENCY-07 resiliency posture monitoring (degradation, capacity, scaling limits) · RESILIENCY-08 multi-AZ required for production; multi-region is a user decision · RESILIENCY-09 auto-scaling with limits + service-quota monitoring · RESILIENCY-10 timeouts, circuit breakers, bulkheads, graceful degradation · RESILIENCY-11 DR strategy aligned to RTO/RPO · RESILIENCY-12 automated encrypted validated backups, cross-region for critical data · RESILIENCY-13 documented automated failover/failback runbooks · RESILIENCY-14 resiliency testing approach · RESILIENCY-15 incident-response integration.
End the artifact with a "Resiliency Compliance" section listing EVERY rule as compliant / non-compliant / N/A with a one-line justification. Non-compliant rules are BLOCKING findings — call them out explicitly. Where a rule requires a user decision, record it as an open decision, not an assumption.`,
  },
  {
    id: "property-based-testing",
    name: "Property-Based Testing",
    description:
      "Mandates property identification and PBT (fast-check, Hypothesis…) alongside example-based tests.",
    stages: [
      "functional-design",
      "nfr-requirements",
      "code-generation",
      "build-test",
    ],
    directive: `Property-Based Testing extension (enabled):
PBT-01 every unit containing business logic, data transformations or algorithmic operations gets identified properties · properties to cover: round-trips (serialize/deserialize), invariants (size/order/business rules), idempotency, comparison against reference implementations, stateful sequences for mutable components · select a language-appropriate framework with generators + shrinking + reproducible seeds (fast-check for TS/JS, Hypothesis for Python, jqwik for Java) · PBT complements, never replaces, example-based tests · PBT lives in clearly labeled separate test files · Build & Test must log seeds and run PBT in CI.
End the artifact with a "PBT Compliance" section listing each rule as compliant / non-compliant / N/A. Non-compliant rules are BLOCKING findings — call them out explicitly.`,
  },
];

export function extensionById(id: string): ExtensionDef | undefined {
  return EXTENSIONS.find((e) => e.id === id);
}

/** Names of the enabled extensions, in registry order. */
export function enabledExtensionNames(
  enabled: Record<string, boolean> | undefined
): string[] {
  return EXTENSIONS.filter((e) => enabled?.[e.id]).map((e) => e.name);
}

/** Directives of enabled extensions applicable to the given stage. */
export function directivesFor(
  stageId: string,
  enabled: Record<string, boolean> | undefined
): string[] {
  return EXTENSIONS.filter(
    (e) => enabled?.[e.id] && e.stages.includes(stageId)
  ).map((e) => e.directive);
}
