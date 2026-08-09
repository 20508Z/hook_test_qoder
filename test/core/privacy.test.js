import assert from "node:assert/strict";
import { test } from "node:test";

import { assertNoRawSensitiveContent, createPrivacyPolicy, SensitiveContentError } from "../../src/core/index.js";

test("privacy policy permanently records no content", () => {
  assert.deepEqual(createPrivacyPolicy(), { content_stored: false, redaction_version: "2.0" });
});

test("persistence guard rejects every raw content-shaped field", () => {
  for (const field of ["prompt", "response", "code", "command", "output", "error_message", "patch", "tool_response"]) {
    assert.throws(() => assertNoRawSensitiveContent({ [field]: `SYNTHETIC_RAW_${field}` }), SensitiveContentError);
  }
  assert.doesNotThrow(() => assertNoRawSensitiveContent({ event: "tool_start", tool: { name: "edit" }, privacy: createPrivacyPolicy() }));
});
