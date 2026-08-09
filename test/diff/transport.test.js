import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createDiffServer, sendDiffSignal } from "../../src/diff/transport.js";

test("local pipe carries a bounded reduced Qoder signal", async (t) => {
  const pipeName = `qoder-hook-test-${process.pid}-${Date.now()}`;
  let resolveMessage;
  const received = new Promise((resolve) => { resolveMessage = resolve; });
  const { server, address } = createDiffServer({
    pipeName,
    onSignal: (message) => resolveMessage(message),
  });
  server.listen(address);
  await once(server, "listening");
  t.after(() => server.close());
  const signal = { hook_event_name: "PreToolUse", tool_input: { path: "中文/file.txt" } };
  await sendDiffSignal({ pipeName, signal, timeoutMs: 500 });
  assert.deepEqual(await received, signal);
});
