import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AttributionCompanion } from "../../src/diff/attribution.js";

const HMAC_KEY = "synthetic-diff-hmac-key";
const execFileAsync = promisify(execFile);

async function setup(options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "qoder-attribution-"));
  const spoolDir = path.join(root, ".spool");
  const companion = new AttributionCompanion({
    workspaceRoot: root,
    hmacKey: HMAC_KEY,
    spoolDir,
    ...options,
  });
  return { root, spoolDir, companion };
}

function hook(event, toolCall, filePath, toolName = "Write") {
  return {
    ide_product: "qoder",
    hook_event_name: event,
    session_id: "qoder-session",
    tool_use_id: toolCall,
    tool_name: toolName,
    tool_input: { path: filePath },
  };
}

test("Qoder captures create, modify, and delete operations as ai_diff", async () => {
  const { root, companion } = await setup();
  const file = path.join(root, "中文路径", "example.txt");
  await mkdir(path.dirname(file));

  await companion.handleHook(hook("PreToolUse", "one", file, "Write"));
  await writeFile(file, "alpha\nbeta\n");
  const created = await companion.handleHook(hook("PostToolUse", "one", file, "Write"));
  assert.deepEqual([created.event.added, created.event.deleted, created.event.modified], [2, 0, 0]);
  assert.equal(created.event.ide.product, "qoder");
  assert.match(created.event.path_hmac, /^[a-f0-9]{64}$/);
  assert.match(created.event.file_name_hmac, /^[a-f0-9]{64}$/);
  assert.equal(created.event.file_extension, ".txt");

  await companion.handleHook(hook("PreToolUse", "two", file, "Edit"));
  await writeFile(file, "alpha\ngamma\n");
  const modified = await companion.handleHook(hook("PostToolUse", "two", file, "Edit"));
  assert.deepEqual([modified.event.added, modified.event.deleted, modified.event.modified], [0, 0, 1]);

  await companion.handleHook(hook("PreToolUse", "three", file, "Edit"));
  await rm(file);
  const deleted = await companion.handleHook(hook("PostToolUse", "three", file, "Edit"));
  assert.equal(deleted.event.deleted + deleted.event.modified, 2);
});

test("diff events retain the managed employee pseudonym across manual saves", async () => {
  const managedEmployeeId = "c".repeat(64);
  const { root, companion } = await setup({ employeeIdHmac: managedEmployeeId });
  const file = path.join(root, "joined.ts");
  await companion.handleHook(hook("PreToolUse", "employee-ai", file, "Write"));
  await writeFile(file, "ai-line\n");
  const ai = await companion.handleHook(hook("PostToolUse", "employee-ai", file, "Write"));
  await writeFile(file, "human-line\n");
  const manual = await companion.recordSave({ filePath: file, ideSaveEvidence: true });

  assert.match(ai.event.employee_id, /^[a-f0-9]{64}$/);
  assert.equal(ai.event.employee_id, managedEmployeeId);
  assert.equal(manual.event.employee_id, ai.event.employee_id);
  assert.equal(ai.event.schema_version, "diff-attribution/2.1");
});

test("multiple tool calls, duplicate post, and manual rewrite retain only surviving AI lines", async () => {
  const { root, spoolDir, companion } = await setup();
  const first = path.join(root, "first.js");
  const second = path.join(root, "second.js");
  await writeFile(first, "base\n");
  await writeFile(second, "start\n");
  await companion.handleHook(hook("PreToolUse", "a", first, "Edit"));
  await companion.handleHook(hook("PreToolUse", "b", second, "Write"));
  await writeFile(first, "base\nai-one\n");
  await writeFile(second, "start\nai-two\n");
  const a = await companion.handleHook(hook("PostToolUse", "a", first, "Edit"));
  const b = await companion.handleHook(hook("PostToolUse", "b", second, "Write"));
  assert.equal(a.event.final_retained_ai_lines, 1);
  assert.equal(b.event.final_retained_ai_lines, 1);
  assert.equal(await companion.handleHook(hook("PostToolUse", "a", first, "Edit")), null);

  await writeFile(first, "base\nhuman-rewrite\n");
  const manual = await companion.recordSave({ filePath: first, sessionId: "qoder-session", ideSaveEvidence: true });
  assert.equal(manual.event.event, "manual_candidate_diff");
  assert.equal(manual.event.attribution_confidence, "medium");
  assert.equal(manual.event.final_retained_ai_lines, 0);
  assert.equal((await readFile(path.join(spoolDir, "attribution.jsonl"), "utf8")).trim().split(/\r?\n/).length, 3);
});

test("diff events persist counts and HMACs but never patch content", async () => {
  const canary = "DIFF_PLAINTEXT_CANARY";
  const { root, spoolDir, companion } = await setup();
  const file = path.join(root, "secret.txt");
  await companion.handleHook(hook("PreToolUse", "secret", file, "Edit"));
  await writeFile(file, `${canary}\n`);
  const result = await companion.handleHook(hook("PostToolUse", "secret", file, "Edit"));
  const persisted = await readFile(path.join(spoolDir, "attribution.jsonl"), "utf8");
  assert.equal(persisted.includes(canary), false);
  assert.equal("diff" in result.event, false);
  assert.equal("diff_metric" in result.event, false);
  assert.equal(result.event.privacy.content_stored, false);
});

test("path escape, binary, oversized files, and symlink escape are handled safely", async (t) => {
  const { root, companion } = await setup({ maxFileBytes: 8 });
  await assert.rejects(
    companion.handleHook(hook("PreToolUse", "escape", path.join(root, "..", "outside.txt"))),
    { code: "ERR_DIFF_PATH_OUTSIDE_WORKSPACE" },
  );

  const binary = path.join(root, "binary.bin");
  await writeFile(binary, Buffer.from([0, 1, 2]));
  await companion.handleHook(hook("PreToolUse", "binary", binary));
  const binaryResult = await companion.handleHook(hook("PostToolUse", "binary", binary));
  assert.equal(binaryResult.event.capture_status, "unsupported");
  assert.equal(binaryResult.event.skip_reason, "binary_file");

  const large = path.join(root, "large.txt");
  await writeFile(large, "123456789");
  await companion.handleHook(hook("PreToolUse", "large", large));
  const largeResult = await companion.handleHook(hook("PostToolUse", "large", large));
  assert.equal(largeResult.event.skip_reason, "file_too_large");

  if (process.platform === "win32") {
    const outside = await mkdtemp(path.join(tmpdir(), "outside-"));
    const link = path.join(root, "outside-link");
    try {
      await symlink(outside, link, "junction");
      await assert.rejects(
        companion.handleHook(hook("PreToolUse", "link", path.join(link, "file.txt"))),
        { code: "ERR_DIFF_PATH_OUTSIDE_WORKSPACE" },
      );
    } catch (error) {
      if (error.code === "EPERM") t.diagnostic("symlink test skipped: Windows privilege unavailable");
      else throw error;
    }
  }
});

test("Qoder shell commands attribute bounded workspace file changes", async () => {
  const { root, companion } = await setup();
  const command = hook("PreToolUse", "shell-one", null, "bash");
  delete command.tool_input;
  await companion.handleHook(command);
  await mkdir(path.join(root, "generated"));
  await writeFile(path.join(root, "generated", "one.ts"), "const one = 1;\nconst two = 2;\n");
  await writeFile(path.join(root, "generated", "notes.md"), "generated note\n");
  const post = { ...command, hook_event_name: "PostToolUse" };
  const result = await companion.handleHook(post);

  assert.equal(result.diffs.length, 2);
  assert.equal(result.diffs.reduce((sum, item) => sum + item.event.added, 0), 3);
  assert.ok(result.diffs.every((item) => item.event.event === "ai_command_diff"));
  assert.ok(result.diffs.every((item) => item.event.workspace_scan_complete === true));
  assert.deepEqual(result.diffs.map((item) => item.event.file_type).sort(), ["documentation", "source_code"]);
});

test("commit and local push checkpoints report AI, human-modified, and human lines", async () => {
  const { root, spoolDir, companion } = await setup();
  const remote = await mkdtemp(path.join(tmpdir(), "qoder-remote-"));
  await execFileAsync("git", ["init", "--bare", remote], { windowsHide: true });
  await execFileAsync("git", ["init", root], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "config", "user.name", "Synthetic Test"], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "config", "user.email", "synthetic@example.invalid"], { windowsHide: true });
  await writeFile(path.join(root, "base.txt"), "base\n");
  await execFileAsync("git", ["-C", root, "add", "."], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "commit", "-m", "base"], { windowsHide: true });

  const generatePre = hook("PreToolUse", "generate-commit", null, "bash");
  delete generatePre.tool_input;
  await companion.handleHook(generatePre);
  const generated = path.join(root, "generated.ts");
  await writeFile(generated, "const ai = 1;\nconst rewrite = 2;\n");
  await execFileAsync("git", ["-C", root, "add", "."], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "commit", "-m", "generated"], { windowsHide: true });
  const generatedPost = await companion.handleHook({ ...generatePre, hook_event_name: "PostToolUse" });
  const firstCommit = generatedPost.git.find((item) => item.event.event === "commit_checkpoint").event;
  assert.equal(firstCommit.committed_lines, 2);
  assert.equal(firstCommit.ai_accepted_lines, 2);
  assert.equal(firstCommit.human_authored_lines, 0);
  assert.equal(firstCommit.commit_ai_ratio, 1);

  await writeFile(generated, "const ai = 1;\nconst rewrite = 3;\nconst human = 4;\n");
  const manual = await companion.recordSave({ filePath: generated, ideSaveEvidence: true });
  assert.equal(manual.event.ai_then_human_modified_lines, 1);

  const commitPre = hook("PreToolUse", "manual-commit", null, "bash");
  delete commitPre.tool_input;
  await companion.handleHook(commitPre);
  await execFileAsync("git", ["-C", root, "add", "."], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "commit", "-m", "manual"], { windowsHide: true });
  const commitPost = await companion.handleHook({ ...commitPre, hook_event_name: "PostToolUse" });
  const secondCommit = commitPost.git.find((item) => item.event.event === "commit_checkpoint").event;
  assert.equal(secondCommit.committed_lines, 2);
  assert.equal(secondCommit.ai_accepted_lines, 0);
  assert.equal(secondCommit.ai_then_human_modified_lines, 1);
  assert.equal(secondCommit.human_authored_lines, 1);

  const pushPre = hook("PreToolUse", "push", null, "bash");
  delete pushPre.tool_input;
  await companion.handleHook(pushPre);
  await execFileAsync("git", ["-C", root, "remote", "add", "origin", remote], { windowsHide: true });
  await execFileAsync("git", ["-C", root, "push", "-u", "origin", "HEAD"], { windowsHide: true });
  const pushPost = await companion.handleHook({ ...pushPre, hook_event_name: "PostToolUse" });
  const pushed = pushPost.git.find((item) => item.event.event === "push_checkpoint").event;
  assert.equal(pushed.confirmation, "local_remote_tracking_ref");
  assert.match(pushed.commit_hmac, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(pushed).includes(remote), false);

  const persisted = await readFile(path.join(spoolDir, "git-checkpoints.jsonl"), "utf8");
  assert.equal(persisted.includes("Synthetic Test"), false);
  assert.equal(persisted.includes("synthetic@example.invalid"), false);
});
