/**
 * Minimal YAML-frontmatter reader (no dependency). Handles the flat scalar keys
 * used by Claude asset files (name, description, model, …). Non-scalar values
 * (lists/maps) are ignored gracefully rather than parsed.
 */

export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

export function parseFrontmatter(text: string): Frontmatter {
  const match = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!match) {
    return { data: {}, body: text };
  }
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    // Skip blank lines, comments, and list/indented continuation lines.
    if (idx === -1 || /^\s/.test(line) || line.trimStart().startsWith("#")) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value) {
      data[key] = value;
    }
  }
  return { data, body: text.slice(match[0].length) };
}

/** First markdown heading (`# …`) in a body, if any — a description fallback. */
export function firstHeading(body: string): string | undefined {
  const m = /^#{1,6}\s+(.+?)\s*$/m.exec(body);
  return m?.[1];
}
