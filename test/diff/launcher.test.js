import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { startManagedCompanion } from "../../src/diff/launcher.js";
import { runHookReceiver } from "../../src/receiver.js";

test("managed companion publishes privacy-safe health and removes it on close", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qoder-launcher-"));
  const spoolDir = path.join(root, "spool");
  const healthFile = path.join(spoolDir, "health.json");
  const managed = await startManagedCompanion({
    workspaceRoot: root,
    pipeName: `qoder-managed-${process.pid}-${Date.now()}`,
    spoolDir,
    healthFile,
    hmacKey: "synthetic-managed-hmac-key",
    watchWorkspace: false,
  });
  const healthText = await readFile(healthFile, "utf8");
  const health = JSON.parse(healthText);
  assert.equal(health.status, "ready");
  assert.match(health.workspace_id, /^[a-f0-9]{64}$/);
  assert.equal(healthText.includes(root), false);
  await managed.close();
  await assert.rejects(() => readFile(healthFile), { code: "ENOENT" });
});

test("receiver diff-pipe reaches the managed companion without blocking Qoder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "qoder-wire-"));
  const spoolDir = path.join(root, "spool");
  const pipeName = `qoder-wire-${process.pid}-${Date.now()}`;
  const managed = await startManagedCompanion({
    workspaceRoot: root,
    pipeName,
    spoolDir,
    hmacKey: "synthetic-managed-hmac-key",
    watchWorkspace: false,
  });
  try {
    const file = path.join(root, "wired.ts");
    const env = {
      QODER_HOOK_HMAC_KEY: "synthetic-managed-hmac-key",
      QODER_HOOK_SPOOL_DIR: spoolDir,
    };
    const payload = {
      ide_product: "qoder",
      hook_event_name: "PreToolUse",
      session_id: "wire-session",
      tool_use_id: "wire-call",
      tool_name: "Write",
      tool_input: { path: file },
    };
    const pre = await runHookReceiver({
      argv: ["--ide", "qoder", "--surface", "ide", "--diff-pipe", pipeName, "--spool-dir", spoolDir],
      stdin: Readable.from([JSON.stringify(payload)]),
      env,
    });
    assert.equal(pre.ok, true);
    await writeFile(file, "wired\n");
    const post = await runHookReceiver({
      argv: ["--ide", "qoder", "--surface", "ide", "--diff-pipe", pipeName, "--spool-dir", spoolDir],
      stdin: Readable.from([JSON.stringify({ ...payload, hook_event_name: "PostToolUse" })]),
      env,
    });
    assert.equal(post.ok, true);
    const attributionPath = path.join(spoolDir, "attribution.jsonl");
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await access(attributionPath);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    const attribution = await readFile(attributionPath, "utf8");
    assert.match(attribution, /"event":"ai_diff"/);
    assert.equal(attribution.includes("wired\\n"), false);
  } finally {
    await managed.close();
  }
});
