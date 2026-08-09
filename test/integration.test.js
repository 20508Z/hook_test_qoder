import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";

import { canonicalizeHook } from "../src/canonicalize.js";
import { loadConfig } from "../src/config.js";
import { receivePayload, runHookReceiver } from "../src/receiver.js";

const fixtureNames = ["02-agent-operation.json", "03-tool-result.json"];

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/demo/${name}`, import.meta.url), "utf8"));
}

async function tempConfig(overrides = {}) {
  const spoolDir = await mkdtemp(path.join(tmpdir(), "qoder-attribution-"));
  return loadConfig({ spoolDir, hmacKey: "integration-test-hmac-key", ...overrides });
}

test("mutating Qoder hooks persist only attribution metadata", async () => {
  const config = await tempConfig();
  const results = [];
  for (const name of fixtureNames) results.push(await receivePayload(await fixture(name), { config }));

  const persisted = await readFile(path.join(config.spoolDir, "events.jsonl"), "utf8");
  assert.equal(persisted.includes("MUST_NOT_PERSIST"), false);
  assert.deepEqual(results.map(({ event }) => event.event), ["tool_start", "tool_end"]);
  assert.equal(results[0].event.tool.name, "write");
  assert.equal(results[1].event.result.status, "success");
  assert.equal(results[0].event.source.surface, "unknown");
  assert.equal(results[0].event.privacy.content_stored, false);
  assert.deepEqual(Object.keys(results[0].event.privacy), ["content_stored", "redaction_version"]);
});

test("canonical fields match the reduced versioned schema contract", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/canonical-event.schema.json", import.meta.url)));
  const event = canonicalizeHook(await fixture(fixtureNames[0]), {
    config: await tempConfig(),
    hints: { surface: "cli" },
    now: () => new Date("2026-08-04T05:00:00.000Z"),
  });
  assert.deepEqual(Object.keys(event).sort(), Object.keys(schema.properties).sort());
  assert.ok(schema.required.every((field) => Object.hasOwn(event, field)));
  assert.equal(event.schema_version, "2.1");
  assert.equal(event.source.input_fingerprint, event.source_fingerprint);
  assert.equal(event.source.surface, "cli");
  assert.equal(event.tool.command_family, null);
  assert.equal(event.tool.shell, null);
  assert.deepEqual(event.usage, { model_id: null, model_call_id: null, credits_used: null });
});

test("enterprise identity, model usage, and file identifiers are pseudonymized and joinable", async () => {
  const managedEmployeeId = "b".repeat(64);
  const config = await tempConfig({ enterpriseUserHmac: managedEmployeeId });
  const payload = {
    ide_product: "qoder",
    hook_event_name: "PostToolUse",
    employee_id: "untrusted-payload-user",
    session_id: "session-usage",
    tool_call_id: "tool-usage",
    tool_name: "Write",
    tool_input: { path: "C:/synthetic/project/quarterly-report.ts" },
    tool_response: { success: true },
    model_id: "model-catalog-7",
    model_call_id: "model-call-9",
    credits_used: 1.5,
  };
  const first = (await receivePayload(payload, { config })).event;
  const second = (await receivePayload({ ...payload, event_id: "second-delivery" }, { config })).event;

  assert.match(first.employee_id, /^[a-f0-9]{64}$/);
  assert.equal(first.employee_id, managedEmployeeId);
  assert.equal(first.employee_id, second.employee_id);
  assert.notEqual(first.employee_id, payload.employee_id);
  assert.equal(first.tool.file_extension, ".ts");
  assert.equal(first.tool.file_type, "source_code");
  assert.match(first.tool.file_name_hmac, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(first).includes("quarterly-report.ts"), false);
  assert.match(first.usage.model_id, /^[a-f0-9]{64}$/);
  assert.match(first.usage.model_call_id, /^[a-f0-9]{64}$/);
  assert.equal(first.usage.credits_used, 1.5);
  assert.equal(JSON.stringify(first).includes("model-catalog-7"), false);
});

test("duplicate Hook delivery is idempotent across spool instances", async () => {
  const config = await tempConfig();
  const payload = await fixture(fixtureNames[0]);
  const first = await receivePayload(payload, { config });
  const second = await receivePayload(payload, { config });
  const lines = (await readFile(path.join(config.spoolDir, "events.jsonl"), "utf8")).trim().split(/\r?\n/);
  assert.deepEqual({ stored: first.stored, duplicate: first.duplicate }, { stored: true, duplicate: false });
  assert.deepEqual({ stored: second.stored, duplicate: second.duplicate }, { stored: false, duplicate: true });
  assert.equal(lines.length, 1);
});

test("receiver uses no network and still works with an unreachable proxy", async () => {
  const config = await tempConfig();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network disabled by test"); };
  try {
    assert.equal((await receivePayload(await fixture(fixtureNames[1]), { config })).stored, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invalid stdin fails open without echoing input", async () => {
  let diagnostic = "";
  const stderr = new Writable({ write(chunk, _encoding, callback) { diagnostic += chunk.toString(); callback(); } });
  const result = await runHookReceiver({
    argv: [],
    stdin: Readable.from(["{SECRET_INVALID_BODY"]),
    stderr,
    env: { QODER_HOOK_HMAC_KEY: "synthetic-test-key", QODER_HOOK_SPOOL_DIR: await mkdtemp(path.join(tmpdir(), "qoder-invalid-")) },
  });
  assert.equal(result.ok, false);
  assert.equal(result.failOpen, true);
  assert.equal(diagnostic.includes("SECRET_INVALID_BODY"), false);
});

test("untrusted labels and raw bodies cannot enter canonical output", async () => {
  const event = canonicalizeHook({
    ide_product: "qoder",
    hook_event_name: "PostToolUse",
    tool_name: "SECRET BODY WITH SPACES",
    tool_response: { success: true, output: "SECRET_OUTPUT" },
    prompt: "SECRET_PROMPT",
  }, { config: await tempConfig() });
  assert.equal(event.tool.name, "other");
  assert.doesNotMatch(JSON.stringify(event), /SECRET/);
});

test("non-mutating tools are skipped without creating a spool", async () => {
  const config = await tempConfig();
  const result = await receivePayload({
    ide_product: "qoder",
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { path: "C:/synthetic/read-only.ts" },
  }, { config });
  assert.equal(result.skipped, true);
  await assert.rejects(() => readFile(path.join(config.spoolDir, "events.jsonl")), { code: "ENOENT" });
});

test("shell commands are captured as reduced metadata and still persist", async () => {
  const config = await tempConfig();
  const result = await receivePayload({
    ide_product: "qoder",
    hook_event_name: "PostToolUse",
    tool_name: "bash",
    tool_response: { success: true },
  }, { config, hints: { surface: "idea-plugin" } });

  assert.equal(result.stored, true);
  assert.equal(result.event.tool.name, "command");
  assert.equal(result.event.tool.command_family, "shell");
  assert.equal(result.event.tool.shell, "bash");
  assert.equal(result.event.source.surface, "idea_plugin");
});
