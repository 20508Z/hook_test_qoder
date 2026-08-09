import assert from "node:assert/strict";
import { test } from "node:test";

import { createEventIdentity, hmacValue, stableCanonicalize } from "../../src/core/index.js";

const KEY = "synthetic-test-key-that-is-not-a-production-secret";

test("stable canonicalization and HMAC ignore object insertion order", () => {
  const first = { z: 2, nested: { b: true, a: "value" } };
  const second = { nested: { a: "value", b: true }, z: 2 };
  assert.equal(stableCanonicalize(first), stableCanonicalize(second));
  assert.equal(hmacValue(first, KEY), hmacValue(second, KEY));
  assert.match(hmacValue(first, KEY), /^[a-f0-9]{64}$/);
});

test("event identity separates random event IDs from deterministic fingerprints", () => {
  const source = { ide: "qoder", native_event: "PreToolUse", native_id: "fixture-1" };
  const first = createEventIdentity(source, KEY);
  const second = createEventIdentity(source, KEY);
  assert.notEqual(first.event_id, second.event_id);
  assert.equal(first.source_fingerprint, second.source_fingerprint);
});

test("canonicalization rejects non-finite and cyclic input", () => {
  assert.throws(() => stableCanonicalize(Number.NaN), /finite/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => stableCanonicalize(cyclic), /cyclic/);
});
