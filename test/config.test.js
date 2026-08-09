import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../src/config.js";

test("configuration contains only bounded local attribution settings", () => {
  const config = loadConfig({ hmacKey: "synthetic-test-key" }, {});
  assert.deepEqual(Object.keys(config).sort(), ["diffPipe", "enterpriseUserHmac", "hmacKey", "maxStdinBytes", "schemaVersion", "spoolDir"]);
  assert.equal(config.schemaVersion, "2.1");
  assert.equal(config.enterpriseUserHmac, null);
  assert.equal(config.maxStdinBytes, 1024 * 1024);
});

test("managed enterprise user pseudonym can be injected without exposing the raw identity", () => {
  const employeeId = "a".repeat(64);
  const config = loadConfig({ hmacKey: "synthetic-test-key" }, {
    QODER_ENTERPRISE_USER_HMAC: employeeId,
  });
  assert.equal(config.enterpriseUserHmac, employeeId);
  assert.throws(() => loadConfig({ hmacKey: "synthetic-test-key" }, {
    QODER_ENTERPRISE_USER_HMAC: "raw-employee-id",
  }), /64-character/);
});

test("receiver configuration requires an explicit HMAC key", () => {
  assert.throws(() => loadConfig({}, {}), { code: "ERR_HMAC_KEY_REQUIRED" });
});
