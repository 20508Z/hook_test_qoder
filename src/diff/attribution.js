import { watch } from "node:fs";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { diffLines } from "diff";

import {
  hmacValue,
  JsonlSpool,
} from "../core/index.js";
import { adaptHook } from "../adapters/index.js";
import { captureGitState, changedRevisionFiles, readRevisionText } from "../git/repository.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_FILES = 1000;
const MAX_COMMAND_BYTES = 16 * 1024 * 1024;
const MUTATING_TOOLS = new Set(["write", "edit", "command"]);
const IGNORED_DIRECTORIES = new Set([".git", ".spool", "node_modules"]);

function compact(value) {
  return typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function lineValues(value) {
  const lines = value.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function retainValues(candidates, currentText) {
  const available = new Map();
  for (const line of lineValues(currentText)) available.set(line, (available.get(line) ?? 0) + 1);
  return candidates.filter((line) => {
    const count = available.get(line) ?? 0;
    if (count === 0) return false;
    available.set(line, count - 1);
    return true;
  });
}

function countMatches(candidates, values) {
  const available = new Map();
  for (const value of values) available.set(value, (available.get(value) ?? 0) + 1);
  let count = 0;
  for (const candidate of candidates) {
    const remaining = available.get(candidate) ?? 0;
    if (remaining === 0) continue;
    available.set(candidate, remaining - 1);
    count += 1;
  }
  return count;
}

function analyzeLines(before, after) {
  const changes = diffLines(before, after, { newlineIsToken: false });
  let rawAdded = 0;
  let rawDeleted = 0;
  const addedValues = [];
  for (const change of changes) {
    if (change.added) {
      const values = lineValues(change.value);
      rawAdded += values.length;
      addedValues.push(...values);
    } else if (change.removed) {
      rawDeleted += lineValues(change.value).length;
    }
  }
  const modified = Math.min(rawAdded, rawDeleted);
  return {
    added: rawAdded - modified,
    deleted: rawDeleted - modified,
    modified,
    addedValues,
  };
}

function sourcePath(payload) {
  const input = payload.tool_input ?? payload.toolInput ?? payload.input ?? {};
  return input.path ?? input.file_path ?? input.filePath ?? payload.path ?? payload.file_path ?? null;
}

function fileMetadata(filePath, key) {
  const extension = path.extname(filePath).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : null;
  const sourceCode = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".php", ".py", ".rb", ".rs", ".swift", ".ts", ".tsx"]);
  const documentation = new Set([".adoc", ".docx", ".md", ".pdf", ".pptx", ".rst", ".txt"]);
  const configuration = new Set([".ini", ".json", ".toml", ".xml", ".yaml", ".yml"]);
  const data = new Set([".csv", ".parquet", ".sql", ".tsv", ".xlsx"]);
  return {
    file_extension: safeExtension,
    file_name_hmac: hmacValue(path.basename(filePath), key),
    file_type: sourceCode.has(safeExtension) ? "source_code"
      : documentation.has(safeExtension) ? "documentation"
        : configuration.has(safeExtension) ? "configuration"
          : data.has(safeExtension) ? "data"
            : safeExtension === ".ipynb" ? "notebook" : "other",
  };
}

async function nearestExisting(candidate) {
  let current = candidate;
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export class AttributionCompanion {
  constructor({
    workspaceRoot,
    hmacKey,
    spoolDir,
    employeeIdHmac = null,
    maxFileBytes = MAX_FILE_BYTES,
    maxCommandFiles = MAX_COMMAND_FILES,
    maxCommandBytes = MAX_COMMAND_BYTES,
  } = {}) {
    if (typeof hmacKey !== "string" || hmacKey.length < 16) throw new TypeError("hmacKey is required");
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.product = "qoder";
    this.hmacKey = hmacKey;
    this.employeeIdHmac = employeeIdHmac;
    this.maxFileBytes = maxFileBytes;
    this.maxCommandFiles = maxCommandFiles;
    this.maxCommandBytes = maxCommandBytes;
    this.pending = new Map();
    this.checkpoints = new Map();
    this.watchTimers = new Map();
    this.watcher = null;
    this.workspaceBaseline = null;
    this.gitBaseline = null;
    this.activeCommands = 0;
    this.commitSummaries = new Map();
    this.spool = new JsonlSpool(spoolDir, {
      eventsFile: "attribution.jsonl",
      indexFile: "attribution-idempotency.jsonl",
    });
    this.gitSpool = new JsonlSpool(spoolDir, {
      eventsFile: "git-checkpoints.jsonl",
      indexFile: "git-checkpoint-idempotency.jsonl",
    });
  }

  startWatcher({ debounceMs = 150 } = {}) {
    if (this.watcher) return this.watcher;
    this.watcher = watch(this.workspaceRoot, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const rawPath = String(filename);
      const pathKey = hmacValue(path.resolve(this.workspaceRoot, rawPath), this.hmacKey);
      clearTimeout(this.watchTimers.get(pathKey));
      this.watchTimers.set(pathKey, setTimeout(() => {
        this.watchTimers.delete(pathKey);
        this.refreshWatchedPath(rawPath, pathKey).catch(() => undefined);
      }, debounceMs));
    });
    return this.watcher;
  }

  async initializeWorkspaceBaseline() {
    const [workspaceBaseline, gitBaseline] = await Promise.all([
      this.scanWorkspace(),
      captureGitState(this.workspaceRoot),
    ]);
    this.workspaceBaseline = workspaceBaseline;
    this.gitBaseline = gitBaseline;
    return { workspaceBaseline, gitBaseline };
  }

  async refreshWatchedPath(rawPath, pathKey) {
    if (this.activeCommands > 0) return;
    const filePath = await this.resolveFile(rawPath);
    const snapshot = await this.snapshot(filePath);
    if (this.workspaceBaseline) {
      if (snapshot.status === "missing") this.workspaceBaseline.snapshots.delete(filePath);
      else this.workspaceBaseline.snapshots.set(filePath, snapshot);
    }
    if (this.checkpoints.has(pathKey)) {
      await this.recordSave({ filePath, ideSaveEvidence: false });
    }
  }

  closeWatcher() {
    for (const timer of this.watchTimers.values()) clearTimeout(timer);
    this.watchTimers.clear();
    this.watcher?.close();
    this.watcher = null;
  }

  async resolveFile(rawPath) {
    if (typeof rawPath !== "string" || rawPath.trim() === "") {
      const error = new Error("A tool file path is required");
      error.code = "ERR_DIFF_PATH_REQUIRED";
      throw error;
    }
    const candidate = path.resolve(this.workspaceRoot, rawPath);
    if (!inside(this.workspaceRoot, candidate)) {
      const error = new Error("File path escapes the configured workspace");
      error.code = "ERR_DIFF_PATH_OUTSIDE_WORKSPACE";
      throw error;
    }
    const existing = await nearestExisting(candidate);
    const [realRoot, realExisting] = await Promise.all([realpath(this.workspaceRoot), realpath(existing)]);
    if (!inside(realRoot, realExisting)) {
      const error = new Error("File path resolves outside the configured workspace");
      error.code = "ERR_DIFF_PATH_OUTSIDE_WORKSPACE";
      throw error;
    }
    return candidate;
  }

  async snapshot(filePath) {
    try {
      const stats = await lstat(filePath);
      if (stats.isSymbolicLink()) {
        const target = await realpath(filePath);
        const root = await realpath(this.workspaceRoot);
        if (!inside(root, target)) {
          return { status: "unsupported", reason: "symlink_outside_workspace", text: null };
        }
      }
      if (!stats.isFile()) return { status: "unsupported", reason: "not_regular_file", text: null };
      if (stats.size > this.maxFileBytes) return { status: "unsupported", reason: "file_too_large", text: null };
      const bytes = await readFile(filePath);
      if (bytes.includes(0)) return { status: "unsupported", reason: "binary_file", text: null };
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return { status: "unsupported", reason: "non_utf8_file", text: null };
      }
      return { status: "captured", reason: null, text };
    } catch (error) {
      if (error.code === "ENOENT") return { status: "missing", reason: null, text: "" };
      throw error;
    }
  }

  async scanWorkspace() {
    const snapshots = new Map();
    const directories = [this.workspaceRoot];
    let capturedBytes = 0;
    let complete = true;

    while (directories.length > 0) {
      const directory = directories.pop();
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        complete = false;
        continue;
      }
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (snapshots.size >= this.maxCommandFiles || capturedBytes >= this.maxCommandBytes) {
          complete = false;
          break;
        }
        if (entry.isSymbolicLink()) continue;
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name) && !this.isSpoolPath(candidate)) {
            directories.push(candidate);
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const snapshot = await this.snapshot(candidate);
        if (snapshot.status === "captured") {
          const bytes = Buffer.byteLength(snapshot.text, "utf8");
          if (capturedBytes + bytes > this.maxCommandBytes) {
            complete = false;
            continue;
          }
          capturedBytes += bytes;
        }
        snapshots.set(candidate, snapshot);
      }
      if (!complete && (snapshots.size >= this.maxCommandFiles || capturedBytes >= this.maxCommandBytes)) break;
    }
    return { snapshots, complete };
  }

  isSpoolPath(candidate) {
    return inside(this.workspaceRoot, this.spool.directory)
      && inside(this.spool.directory, candidate);
  }

  stateKey(adapted, filePath) {
    return hmacValue({
      product: this.product,
      session: adapted.sessionSource,
      toolCall: adapted.toolCallSource,
      filePath,
    }, this.hmacKey);
  }

  async handleHook(payload) {
    const adapted = adaptHook(payload, { ideProduct: this.product });
    if (adapted.ideProduct !== this.product || !MUTATING_TOOLS.has(adapted.tool?.name)) return null;
    if (adapted.tool.name === "command") return this.handleCommand(adapted);
    const filePath = await this.resolveFile(sourcePath(payload));
    const key = this.stateKey(adapted, filePath);
    if (adapted.nativeEvent === "PreToolUse") {
      this.pending.set(key, { adapted, filePath, before: await this.snapshot(filePath) });
      return null;
    }
    if (!adapted.nativeEvent.startsWith("PostToolUse")) return null;
    const pending = this.pending.get(key);
    if (!pending) return null;
    this.pending.delete(key);
    const after = await this.snapshot(filePath);
    return this.recordDiff({
      kind: "ai_diff",
      adapted,
      filePath,
      before: pending.before,
      after,
      confidence: "high",
      saveEvidence: false,
      scanComplete: true,
    });
  }

  async handleCommand(adapted) {
    const key = this.stateKey(adapted, null);
    if (adapted.nativeEvent === "PreToolUse") {
      let commandScan = this.workspaceBaseline;
      let gitState = this.gitBaseline;
      if (!commandScan) {
        [commandScan, gitState] = await Promise.all([
          this.scanWorkspace(),
          captureGitState(this.workspaceRoot),
        ]);
        this.workspaceBaseline = commandScan;
        this.gitBaseline = gitState;
      }
      commandScan = {
        snapshots: new Map(commandScan.snapshots),
        complete: commandScan.complete,
      };
      this.activeCommands += 1;
      this.pending.set(key, { adapted, commandScan, gitState });
      return null;
    }
    if (!adapted.nativeEvent.startsWith("PostToolUse")) return null;
    const pending = this.pending.get(key);
    if (!pending?.commandScan) return null;
    this.pending.delete(key);
    let afterScan;
    let afterGitState;
    try {
      [afterScan, afterGitState] = await Promise.all([
        this.scanWorkspace(),
        captureGitState(this.workspaceRoot),
      ]);
    } finally {
      this.activeCommands = Math.max(0, this.activeCommands - 1);
    }
    this.workspaceBaseline = afterScan;
    this.gitBaseline = afterGitState;
    const paths = new Set([...pending.commandScan.snapshots.keys(), ...afterScan.snapshots.keys()]);
    const results = [];
    for (const filePath of [...paths].sort()) {
      const before = pending.commandScan.snapshots.get(filePath)
        ?? { status: "missing", reason: null, text: "" };
      const after = afterScan.snapshots.get(filePath)
        ?? { status: "missing", reason: null, text: "" };
      if (before.status === after.status && before.text === after.text) continue;
      results.push(await this.recordDiff({
        kind: "ai_command_diff",
        adapted,
        filePath,
        before,
        after,
        confidence: "high",
        saveEvidence: false,
        scanComplete: pending.commandScan.complete && afterScan.complete,
      }));
    }
    const git = await this.recordGitTransitions(pending.gitState, afterGitState, adapted);
    return { diffs: results, git };
  }

  employeeId(adapted) {
    return this.employeeIdHmac
      ?? (adapted.employeeSource ? hmacValue(adapted.employeeSource, this.hmacKey) : null);
  }

  async recordGitTransitions(before, after, adapted) {
    if (!before || !after) return [];
    const results = [];
    if (after.head && before.head !== after.head) {
      results.push(await this.recordCommitCheckpoint(before.head, after, adapted));
    }
    if (after.head && after.upstreamHead === after.head && before.upstreamHead !== after.upstreamHead) {
      results.push(await this.recordPushCheckpoint(after, adapted));
    }
    return results.filter(Boolean);
  }

  async recordCommitCheckpoint(beforeHead, after, adapted) {
    const relativePaths = await changedRevisionFiles(after.repositoryRoot, beforeHead, after.head);
    const files = [];
    let committedLines = 0;
    let aiAcceptedLines = 0;
    let aiThenHumanModifiedLines = 0;

    for (const relativePath of relativePaths) {
      const filePath = path.resolve(after.repositoryRoot, relativePath);
      if (!inside(this.workspaceRoot, filePath)) continue;
      if (this.isSpoolPath(filePath)) continue;
      const [beforeText, afterText] = await Promise.all([
        readRevisionText(after.repositoryRoot, beforeHead, relativePath, this.maxFileBytes),
        readRevisionText(after.repositoryRoot, after.head, relativePath, this.maxFileBytes),
      ]);
      if (beforeText === null || afterText === null) continue;
      const analysis = analyzeLines(beforeText, afterText);
      const fileCommittedLines = analysis.added + analysis.modified;
      if (fileCommittedLines === 0) continue;
      const pathHmac = hmacValue(filePath, this.hmacKey);
      const checkpoint = this.checkpoints.get(pathHmac);
      const retainedAi = retainValues(checkpoint?.aiLines ?? [], afterText);
      const retainedHumanModified = retainValues(checkpoint?.humanModifiedLines ?? [], afterText);
      const fileAiLines = countMatches(retainedAi, analysis.addedValues);
      const fileHumanModifiedLines = countMatches(retainedHumanModified, analysis.addedValues);
      const fileHumanLines = Math.max(0, fileCommittedLines - fileAiLines - fileHumanModifiedLines);
      const metadata = fileMetadata(filePath, this.hmacKey);
      files.push({
        path_hmac: pathHmac,
        file_name_hmac: metadata.file_name_hmac,
        file_extension: metadata.file_extension,
        file_type: metadata.file_type,
        committed_lines: fileCommittedLines,
        ai_accepted_lines: fileAiLines,
        ai_then_human_modified_lines: fileHumanModifiedLines,
        human_authored_lines: fileHumanLines,
      });
      committedLines += fileCommittedLines;
      aiAcceptedLines += fileAiLines;
      aiThenHumanModifiedLines += fileHumanModifiedLines;
    }

    const humanAuthoredLines = Math.max(0, committedLines - aiAcceptedLines - aiThenHumanModifiedLines);
    const sourceFingerprint = hmacValue({
      event: "commit_checkpoint",
      beforeHead,
      head: after.head,
      files,
    }, this.hmacKey);
    const event = {
      schema_version: "git-checkpoint/1.0",
      event_id: randomUUID(),
      source_fingerprint: sourceFingerprint,
      event: "commit_checkpoint",
      ide: { product: this.product },
      employee_id: this.employeeId(adapted),
      workspace_id: hmacValue(this.workspaceRoot, this.hmacKey),
      commit_hmac: hmacValue(after.head, this.hmacKey),
      parent_commit_hmac: beforeHead ? hmacValue(beforeHead, this.hmacKey) : null,
      branch_hmac: after.branch ? hmacValue(after.branch, this.hmacKey) : null,
      remote_ref_hmac: after.upstreamRef ? hmacValue(after.upstreamRef, this.hmacKey) : null,
      file_count: files.length,
      committed_lines: committedLines,
      ai_accepted_lines: aiAcceptedLines,
      ai_then_human_modified_lines: aiThenHumanModifiedLines,
      human_authored_lines: humanAuthoredLines,
      commit_ai_ratio: committedLines === 0 ? 0 : aiAcceptedLines / committedLines,
      files,
      confirmation: "local_git_object",
      privacy: { content_stored: false },
      source: { input_fingerprint: sourceFingerprint },
    };
    const persistence = await this.gitSpool.append(event);
    this.commitSummaries.set(after.head, event);
    return { event, ...persistence };
  }

  async recordPushCheckpoint(after, adapted) {
    const commit = this.commitSummaries.get(after.head) ?? null;
    const sourceFingerprint = hmacValue({
      event: "push_checkpoint",
      head: after.head,
      upstreamRef: after.upstreamRef,
      upstreamHead: after.upstreamHead,
    }, this.hmacKey);
    const event = {
      schema_version: "git-checkpoint/1.0",
      event_id: randomUUID(),
      source_fingerprint: sourceFingerprint,
      event: "push_checkpoint",
      ide: { product: this.product },
      employee_id: this.employeeId(adapted),
      workspace_id: hmacValue(this.workspaceRoot, this.hmacKey),
      commit_hmac: hmacValue(after.head, this.hmacKey),
      parent_commit_hmac: null,
      branch_hmac: after.branch ? hmacValue(after.branch, this.hmacKey) : null,
      remote_ref_hmac: after.upstreamRef ? hmacValue(after.upstreamRef, this.hmacKey) : null,
      file_count: commit?.file_count ?? 0,
      committed_lines: commit?.committed_lines ?? 0,
      ai_accepted_lines: commit?.ai_accepted_lines ?? 0,
      ai_then_human_modified_lines: commit?.ai_then_human_modified_lines ?? 0,
      human_authored_lines: commit?.human_authored_lines ?? 0,
      commit_ai_ratio: commit?.commit_ai_ratio ?? 0,
      files: commit?.files ?? [],
      confirmation: "local_remote_tracking_ref",
      privacy: { content_stored: false },
      source: { input_fingerprint: sourceFingerprint },
    };
    const persistence = await this.gitSpool.append(event);
    return { event, ...persistence };
  }

  async recordSave({ filePath: rawPath, sessionId = null, toolCallId = null, ideSaveEvidence = false } = {}) {
    const filePath = await this.resolveFile(rawPath);
    const pathKey = hmacValue(filePath, this.hmacKey);
    const checkpoint = this.checkpoints.get(pathKey);
    if (!checkpoint) return null;
    const after = await this.snapshot(filePath);
    if (after.status === checkpoint.snapshot.status && after.text === checkpoint.snapshot.text) return null;
    const adapted = {
      sessionSource: sessionId ?? checkpoint.sessionSource,
      toolCallSource: toolCallId,
      employeeSource: checkpoint.employeeSource,
    };
    return this.recordDiff({
      kind: "manual_candidate_diff",
      adapted,
      filePath,
      before: checkpoint.snapshot,
      after,
      confidence: ideSaveEvidence ? "medium" : "low",
      saveEvidence: Boolean(ideSaveEvidence),
      scanComplete: true,
    });
  }

  async recordDiff({ kind, adapted, filePath, before, after, confidence, saveEvidence, scanComplete }) {
    const pathHmac = hmacValue(filePath, this.hmacKey);
    const file = fileMetadata(filePath, this.hmacKey);
    const beforeText = before.text ?? "";
    const afterText = after.text ?? "";
    const supported = new Set(["captured", "missing"]);
    const captureStatus = supported.has(before.status) && supported.has(after.status) ? "captured" : "unsupported";
    const analysis = captureStatus === "captured"
      ? analyzeLines(beforeText, afterText)
      : { added: 0, deleted: 0, modified: 0, addedValues: [] };
    const previous = this.checkpoints.get(pathHmac);
    const beforeAiLines = retainValues(previous?.aiLines ?? [], beforeText);
    let aiLines = beforeAiLines;
    let humanModifiedLines = retainValues(previous?.humanModifiedLines ?? [], beforeText);
    if ((kind === "ai_diff" || kind === "ai_command_diff") && captureStatus === "captured") {
      aiLines = [...aiLines, ...analysis.addedValues];
    }
    aiLines = retainValues(aiLines, afterText);
    if (kind === "manual_candidate_diff" && captureStatus === "captured") {
      const removedAiLines = Math.max(0, beforeAiLines.length - aiLines.length);
      humanModifiedLines = [
        ...humanModifiedLines,
        ...analysis.addedValues.slice(0, Math.min(removedAiLines, analysis.addedValues.length)),
      ];
    }
    humanModifiedLines = retainValues(humanModifiedLines, afterText);

    const sessionId = adapted.sessionSource ? hmacValue(adapted.sessionSource, this.hmacKey) : null;
    const toolCallId = adapted.toolCallSource ? hmacValue(adapted.toolCallSource, this.hmacKey) : null;
    const employeeId = this.employeeId(adapted);
    const workspaceId = hmacValue(this.workspaceRoot, this.hmacKey);
    const beforeDigest = before.text === null ? null : hmacValue(beforeText, this.hmacKey);
    const afterDigest = after.text === null ? null : hmacValue(afterText, this.hmacKey);
    const sourceFingerprint = hmacValue({
      kind, product: this.product, sessionId, toolCallId, pathHmac, beforeDigest, afterDigest,
    }, this.hmacKey);
    const event = {
      schema_version: "diff-attribution/2.1",
      event_id: randomUUID(),
      source_fingerprint: sourceFingerprint,
      event: kind,
      ide: { product: this.product },
      employee_id: employeeId,
      session_id: sessionId,
      tool_call_id: toolCallId,
      workspace_id: workspaceId,
      path_hmac: pathHmac,
      file_name_hmac: file.file_name_hmac,
      file_extension: file.file_extension,
      file_type: file.file_type,
      before_digest: beforeDigest,
      after_digest: afterDigest,
      added: analysis.added,
      deleted: analysis.deleted,
      modified: analysis.modified,
      final_retained_ai_lines: aiLines.length,
      ai_then_human_modified_lines: humanModifiedLines.length,
      attribution_confidence: confidence,
      ide_save_evidence: saveEvidence,
      capture_status: captureStatus,
      skip_reason: captureStatus === "unsupported" ? (after.reason ?? before.reason) : null,
      workspace_scan_complete: Boolean(scanComplete),
      privacy: { content_stored: false },
      source: { input_fingerprint: sourceFingerprint },
    };
    const persistence = await this.spool.append(event);
    if (captureStatus === "captured") {
      this.checkpoints.set(pathHmac, {
        snapshot: after,
        aiLines,
        humanModifiedLines,
        sessionSource: adapted.sessionSource,
        employeeSource: adapted.employeeSource,
      });
      if (this.workspaceBaseline) {
        if (after.status === "missing") this.workspaceBaseline.snapshots.delete(filePath);
        else this.workspaceBaseline.snapshots.set(filePath, after);
      }
    }
    return { event, ...persistence };
  }
}
