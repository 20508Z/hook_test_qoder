import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;

async function git(root, args, { encoding = "utf8" } = {}) {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding,
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
  });
  return result.stdout;
}

async function optionalGit(root, args) {
  try {
    return String(await git(root, args)).trim() || null;
  } catch {
    return null;
  }
}

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function captureGitState(workspaceRoot) {
  const repositoryRoot = await optionalGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (!repositoryRoot || !samePath(repositoryRoot, workspaceRoot)) return null;
  return {
    repositoryRoot: path.resolve(repositoryRoot),
    head: await optionalGit(repositoryRoot, ["rev-parse", "HEAD"]),
    branch: await optionalGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    upstreamRef: await optionalGit(repositoryRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    upstreamHead: await optionalGit(repositoryRoot, ["rev-parse", "@{upstream}"]),
  };
}

export async function changedRevisionFiles(repositoryRoot, beforeRevision, afterRevision) {
  if (!afterRevision) return [];
  const args = beforeRevision
    ? ["diff", "--name-only", "-z", "--diff-filter=ACMRT", beforeRevision, afterRevision, "--"]
    : ["diff-tree", "--root", "--no-commit-id", "--name-only", "-z", "-r", afterRevision];
  const output = await git(repositoryRoot, args, { encoding: "buffer" });
  return output.toString("utf8").split("\0").filter(Boolean);
}

export async function readRevisionText(repositoryRoot, revision, relativePath, maxFileBytes) {
  if (!revision) return "";
  const gitPath = relativePath.split(path.sep).join("/");
  let output;
  try {
    output = await git(repositoryRoot, ["show", `${revision}:${gitPath}`], { encoding: "buffer" });
  } catch {
    return "";
  }
  if (output.length > maxFileBytes || output.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(output);
  } catch {
    return null;
  }
}
