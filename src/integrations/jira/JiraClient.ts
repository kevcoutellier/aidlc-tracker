/** Minimal Jira Cloud REST v3 client using Basic auth (email + API token). */

export interface JiraConfig {
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
  epicIssueType: string;
  unitIssueType: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
  };
}

export interface JiraSearchIssue {
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    issuetype?: { name?: string };
    status?: { name?: string };
    parent?: { key?: string; fields?: { summary?: string } };
  };
}

/** Best-effort ADF (Atlassian Document Format) → plain markdown-ish text. */
export function adfToText(node: unknown): string {
  if (node === null || typeof node !== "object") {
    return "";
  }
  const n = node as {
    type?: string;
    text?: string;
    attrs?: { level?: number };
    content?: unknown[];
  };
  if (n.type === "text") {
    return typeof n.text === "string" ? n.text : "";
  }
  const inner = Array.isArray(n.content) ? n.content.map(adfToText).join("") : "";
  switch (n.type) {
    case "paragraph":
      return `${inner}\n\n`;
    case "heading":
      return `${"#".repeat(n.attrs?.level ?? 2)} ${inner}\n\n`;
    case "listItem":
      return `- ${inner.trim()}\n`;
    case "hardBreak":
      return "\n";
    default:
      return inner;
  }
}

export interface JiraTransition {
  id: string;
  name?: string;
  to?: { name?: string; statusCategory?: { key?: string } };
}

/** The transition that lands in the "done" status category, if any. */
export function pickDoneTransition(
  transitions: JiraTransition[]
): JiraTransition | undefined {
  return transitions.find((t) => t.to?.statusCategory?.key === "done");
}

export class JiraError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "JiraError";
  }
}

/** Build an Atlassian Document Format (ADF) doc from plain markdown-ish text. */
export function adf(text: string): unknown {
  const paragraphs = text.split(/\n{2,}/).map((block) => ({
    type: "paragraph",
    content: [{ type: "text", text: block.trim() || " " }],
  }));
  return { type: "doc", version: 1, content: paragraphs };
}

export class JiraClient {
  constructor(private readonly config: JiraConfig) {}

  private get authHeader(): string {
    const basic = Buffer.from(
      `${this.config.email}:${this.config.token}`
    ).toString("base64");
    return `Basic ${basic}`;
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new JiraError(
        `Network error contacting Jira: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new JiraError(
        `Jira ${method} ${path} failed (${res.status}): ${truncate(detail)}`,
        res.status
      );
    }
    if (res.status === 204) {
      return undefined as T;
    }
    return (await res.json()) as T;
  }

  /** Verify credentials; returns the display name of the authenticated user. */
  async verify(): Promise<string> {
    const me = await this.request<{ displayName?: string }>(
      "GET",
      "/rest/api/3/myself"
    );
    return me.displayName ?? "unknown user";
  }

  async createIssue(fields: Record<string, unknown>): Promise<string> {
    const res = await this.request<{ key: string }>("POST", "/rest/api/3/issue", {
      fields,
    });
    return res.key;
  }

  async updateIssue(
    key: string,
    fields: Record<string, unknown>
  ): Promise<void> {
    await this.request<void>("PUT", `/rest/api/3/issue/${key}`, { fields });
  }

  async getIssue(key: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(
      "GET",
      `/rest/api/3/issue/${key}?fields=summary,status`
    );
  }

  async listTransitions(key: string): Promise<JiraTransition[]> {
    const res = await this.request<{ transitions?: JiraTransition[] }>(
      "GET",
      `/rest/api/3/issue/${key}/transitions`
    );
    return res.transitions ?? [];
  }

  async doTransition(key: string, transitionId: string): Promise<void> {
    await this.request<void>("POST", `/rest/api/3/issue/${key}/transitions`, {
      transition: { id: transitionId },
    });
  }

  /** Run a JQL search. Uses the enhanced endpoint, falling back to the classic. */
  async search(
    jql: string,
    fields: string[],
    maxResults = 100
  ): Promise<JiraSearchIssue[]> {
    try {
      const res = await this.request<{ issues?: JiraSearchIssue[] }>(
        "POST",
        "/rest/api/3/search/jql",
        { jql, maxResults, fields }
      );
      return res.issues ?? [];
    } catch (err) {
      if (
        err instanceof JiraError &&
        (err.status === 404 || err.status === 410 || err.status === 400)
      ) {
        const params = new URLSearchParams({
          jql,
          maxResults: String(maxResults),
          fields: fields.join(","),
        });
        const res = await this.request<{ issues?: JiraSearchIssue[] }>(
          "GET",
          `/rest/api/3/search?${params.toString()}`
        );
        return res.issues ?? [];
      }
      throw err;
    }
  }

  baseFields(summary: string, description: string, issueType: string) {
    return {
      project: { key: this.config.projectKey },
      summary,
      description: adf(description),
      issuetype: { name: issueType },
    };
  }
}

function truncate(s: string, max = 300): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
