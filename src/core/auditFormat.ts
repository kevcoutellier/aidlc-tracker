/** Pure (vscode-free) formatting for append-only audit entries. */

export const AUDIT_HEADER = `# AI-DLC Audit Log

_Append-only — managed by the AIDLC Tracker extension. Entries are never
rewritten or summarized (per awslabs/aidlc-workflows audit requirements)._
`;

/**
 * Format one audit entry: ISO-8601 timestamp, event id, structured fields, and
 * (when present) the user's raw input quoted verbatim — never summarized.
 */
export function formatAuditEntry(
  at: string,
  event: string,
  fields: Record<string, string | number | undefined>,
  rawInput?: string
): string {
  const lines = [``, `## ${at} — ${event}`, ``];
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== "") {
      lines.push(`- **${key}**: ${value}`);
    }
  }
  if (rawInput !== undefined) {
    lines.push(``, `**User input (raw):**`, ``);
    for (const line of rawInput.split(/\r?\n/)) {
      lines.push(`> ${line}`);
    }
  }
  lines.push(``);
  return lines.join("\n");
}
