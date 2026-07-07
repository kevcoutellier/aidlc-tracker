import { execFile } from "node:child_process";

/** Run a git command in `cwd`; resolves stdout (trimmed), rejects on failure. */
export function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd, windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr?.trim() || err.message));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}
