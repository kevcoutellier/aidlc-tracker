import * as vscode from "vscode";
import { exists, listDirectories, readText, statOrUndefined } from "./fsUtil";
import { chooseDocsRoot, DocsRootCandidate } from "../model/awsLayouts";

export const STATE_FILE = "aidlc-state.md";
/**
 * Tracker-owned state file used when `aidlc-state.md` belongs to a foreign
 * tool (AWS aidlc-workflows). The foreign file is read, never rewritten.
 */
export const TRACKER_STATE_FILE = "aidlc-tracker-state.md";
export const DEFAULT_DOCS_FOLDER = "aidlc-docs";
/** Workspace root of AWS aidlc-workflows v2 (`aidlc/spaces/…/intents/…`). */
export const V2_ROOT = "aidlc";

/**
 * Auto-detected docs folder for the open workspace, set by
 * {@link refreshDocsFolderDetection}. Used only when the user has not
 * explicitly configured `aidlc.docsPath`.
 */
let detectedDocsFolder: string | undefined;

/** The first workspace folder, or undefined when no folder is open. */
export function workspaceRoot(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Effective docs folder name (workspace-relative, may contain `/`). An
 * explicit `aidlc.docsPath` setting wins; otherwise the auto-detected layout
 * (native `aidlc-docs/`, or an AWS v2 intent record dir) is used.
 */
export function docsFolderName(): string {
  const config = vscode.workspace.getConfiguration("aidlc");
  const info = config.inspect<string>("docsPath");
  const explicit =
    info?.workspaceFolderValue ?? info?.workspaceValue ?? info?.globalValue;
  if (explicit && explicit.trim()) {
    return explicit;
  }
  return detectedDocsFolder ?? config.get<string>("docsPath", DEFAULT_DOCS_FOLDER);
}

/**
 * Re-detect where AI-DLC docs live: `aidlc-docs/` when present, else the most
 * recently touched AWS v2 record dir `aidlc/spaces/<space>/intents/<intent>/`
 * (identified by its `aidlc-state.md`). Returns true when the effective docs
 * folder changed (callers should rebuild watchers).
 */
export async function refreshDocsFolderDetection(): Promise<boolean> {
  const before = docsFolderName();
  const root = workspaceRoot();
  detectedDocsFolder = root ? await detectDocsFolder(root) : undefined;
  return docsFolderName() !== before;
}

async function detectDocsFolder(
  root: vscode.WorkspaceFolder
): Promise<string | undefined> {
  const flatUri = vscode.Uri.joinPath(root.uri, DEFAULT_DOCS_FOLDER);
  let flat: DocsRootCandidate | undefined;
  if (await exists(flatUri)) {
    const stat = await statOrUndefined(
      vscode.Uri.joinPath(flatUri, STATE_FILE)
    );
    flat = { rel: DEFAULT_DOCS_FOLDER, stateMtime: stat?.mtime };
  }
  // A stale aidlc-docs/ (the v2 engine's migration source) must not shadow
  // the live record — the choice goes to the cursor-designated or freshest.
  return chooseDocsRoot(flat, await detectV2Record(root));
}

/** First non-empty line of a v2 cursor file, or undefined. */
async function readPointer(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const first = (await readText(uri)).split(/\r?\n/)[0].trim();
    return first.length > 0 ? first : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Locate the most relevant v2 intent record. The `aidlc/active-space` and
 * `intents/active-intent` cursor files are authoritative when they resolve to
 * a record with a state file; otherwise the newest state file wins.
 */
async function detectV2Record(
  root: vscode.WorkspaceFolder
): Promise<DocsRootCandidate | undefined> {
  const roofUri = vscode.Uri.joinPath(root.uri, V2_ROOT);
  const spacesUri = vscode.Uri.joinPath(roofUri, "spaces");
  const spaces = await listDirectories(spacesUri);
  if (spaces.length === 0) {
    return undefined;
  }
  const activeSpace = await readPointer(
    vscode.Uri.joinPath(roofUri, "active-space")
  );

  let best: DocsRootCandidate | undefined;
  for (const space of spaces) {
    const intentsUri = vscode.Uri.joinPath(spacesUri, space, "intents");
    const intents = await listDirectories(intentsUri);
    if (intents.length === 0) {
      continue;
    }
    const cursorApplies = space === activeSpace || spaces.length === 1;
    const activeIntent = cursorApplies
      ? await readPointer(vscode.Uri.joinPath(intentsUri, "active-intent"))
      : undefined;
    for (const intent of intents) {
      const stat = await statOrUndefined(
        vscode.Uri.joinPath(intentsUri, intent, STATE_FILE)
      );
      if (!stat) {
        continue;
      }
      const candidate: DocsRootCandidate = {
        rel: `${V2_ROOT}/spaces/${space}/intents/${intent}`,
        stateMtime: stat.mtime,
        active: cursorApplies && intent === activeIntent,
      };
      if (candidate.active) {
        return candidate;
      }
      if (!best || stat.mtime > (best.stateMtime ?? 0)) {
        best = candidate;
      }
    }
  }
  return best;
}

/** Absolute URI of the AI-DLC docs folder for the open workspace. */
export function docsUri(root = workspaceRoot()): vscode.Uri | undefined {
  if (!root) {
    return undefined;
  }
  return vscode.Uri.joinPath(root.uri, ...docsFolderName().split("/"));
}

/** Absolute URI of the persisted state file. */
export function stateUri(root = workspaceRoot()): vscode.Uri | undefined {
  const docs = docsUri(root);
  return docs ? vscode.Uri.joinPath(docs, STATE_FILE) : undefined;
}

/** Absolute URI of the tracker-owned fallback state file. */
export function trackerStateUri(root = workspaceRoot()): vscode.Uri | undefined {
  const docs = docsUri(root);
  return docs ? vscode.Uri.joinPath(docs, TRACKER_STATE_FILE) : undefined;
}

/** Join a docs-relative path (may contain `/`) onto the docs folder. */
export function docsChildUri(
  relative: string,
  root = workspaceRoot()
): vscode.Uri | undefined {
  const docs = docsUri(root);
  if (!docs) {
    return undefined;
  }
  return vscode.Uri.joinPath(docs, ...relative.split("/"));
}
