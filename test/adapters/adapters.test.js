import assert from "node:assert/strict";
import test from "node:test";

import { adaptHook, createDiffSignal, mapToolName } from "../../src/adapters/index.js";

test("Qoder mutating hooks map to the attribution contract", () => {
  const start = adaptHook({
    ide_product: "qoder",
    hook_event_name: "PreToolUse",
    client_surface: "idea-plugin",
    session_id: "synthetic-session",
    tool_use_id: "synthetic-tool",
    tool_name: "search_replace",
    tool_input: { path: "C:/synthetic/project/src/example.ts", new_string: "IGNORED_BODY" },
  });
  const end = adaptHook({
    ide_product: "Qoder",
    hook_event_name: "PostToolUse",
    client_surface: "cli",
    tool_name: "Write",
    tool_response: { success: true },
  });

  assert.equal(start.ideProduct, "qoder");
  assert.equal(start.surface, "idea_plugin");
  assert.equal(start.eventType, "tool_start");
  assert.equal(start.tool.name, "edit");
  assert.equal(start.pathSource, "C:/synthetic/project/src/example.ts");
  assert.equal(end.surface, "cli");
  assert.equal(end.eventType, "tool_end");
  assert.equal(end.result.status, "success");
});

test("only Qoder mutating tool aliases are retained", () => {
  assert.equal(mapToolName("Write"), "write");
  assert.equal(mapToolName("create_file"), "write");
  assert.equal(mapToolName("Edit"), "edit");
  assert.equal(mapToolName("search_replace"), "edit");
  assert.equal(mapToolName("Bash"), "command");
});

test("payload bodies are ignored and non-Qoder or non-tool events fail", () => {
  const adapted = adaptHook({
    ide_product: "qoder",
    hook_event_name: "PostToolUseFailure",
    tool_name: "Edit",
    error_message: "SYNTHETIC_ERROR_BODY",
  });
  assert.equal(adapted.result.status, "failure");
  assert.equal("content" in adapted, false);
  assert.throws(() => adaptHook({ ide_product: "unsupported", hook_event_name: "PreToolUse" }), /Qoder/);
  assert.throws(() => adaptHook({ ide_product: "qoder", hook_event_name: "Stop" }), /Unsupported/);
});

test("shell command metadata is reduced to family and shell only", () => {
  const adapted = adaptHook({
    ide_product: "qoder",
    hook_event_name: "PostToolUse",
    tool_name: "bash",
    tool_response: { success: true },
  }, { surface: "qoderwork" });

  assert.equal(adapted.tool.name, "command");
  assert.equal(adapted.tool.commandFamily, "shell");
  assert.equal(adapted.tool.shell, "bash");
  assert.equal(adapted.surface, "qoderwork");
});

test("explicit model usage metadata is extracted without prompt or response bodies", () => {
  const adapted = adaptHook({
    ide_product: "qoder",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    model_id: "qoder-model-catalog-id",
    model_call_id: "model-call-17",
    credits_used: 2.75,
    prompt: "MUST_NOT_LEAVE_ADAPTER",
    tool_response: { success: true, output: "MUST_NOT_LEAVE_ADAPTER" },
  });

  assert.deepEqual(adapted.usage, {
    modelSource: "qoder-model-catalog-id",
    modelCallSource: "model-call-17",
    creditsUsed: 2.75,
  });
  assert.doesNotMatch(JSON.stringify(adapted), /MUST_NOT_LEAVE_ADAPTER/);
});

test("diff signal contains only the fields required for local attribution", () => {
  const signal = createDiffSignal({
    ide_product: "qoder",
    hook_event_name: "PreToolUse",
    session_id: "session-1",
    tool_use_id: "tool-1",
    tool_name: "Write",
    tool_input: {
      path: "C:/synthetic/report.ts",
      content: "MUST_NOT_ENTER_DIFF_PIPE",
    },
    prompt: "MUST_NOT_ENTER_DIFF_PIPE",
  }, { surface: "cli" });

  assert.deepEqual(signal, {
    ide_product: "qoder",
    hook_event_name: "PreToolUse",
    client_surface: "cli",
    session_id: "session-1",
    tool_use_id: "tool-1",
    tool_name: "write",
    tool_input: { path: "C:/synthetic/report.ts" },
  });
  assert.doesNotMatch(JSON.stringify(signal), /MUST_NOT_ENTER_DIFF_PIPE/);
});
