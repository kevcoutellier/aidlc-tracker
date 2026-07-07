import { promises as fs } from "node:fs";
import { docsChildUri } from "./paths";
import { AUDIT_HEADER, formatAuditEntry } from "./auditFormat";

/**
 * Append-only audit journal at `<docs>/audit.md` (per awslabs/aidlc-workflows:
 * every interaction logged with an ISO-8601 timestamp; raw inputs verbatim;
 * never overwrite). Failures are swallowed — auditing must never break the
 * workflow it documents.
 */
export class AuditLog {
  async append(
    event: string,
    fields: Record<string, string | number | undefined> = {},
    rawInput?: string
  ): Promise<void> {
    try {
      const uri = docsChildUri("audit.md");
      if (!uri) {
        return;
      }
      const path = uri.fsPath;
      const entry = formatAuditEntry(
        new Date().toISOString(),
        event,
        fields,
        rawInput
      );
      try {
        await fs.access(path);
      } catch {
        await fs.writeFile(path, AUDIT_HEADER, "utf8");
      }
      await fs.appendFile(path, entry, "utf8");
    } catch {
      /* never block the flow on audit I/O */
    }
  }
}
