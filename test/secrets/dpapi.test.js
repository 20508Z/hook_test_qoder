import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readProtectedSecret, spawnWithDpapiEnv, writeProtectedSecret } from "../../src/secrets/dpapi.js";

test("DPAPI protects the HMAC secret without storing plaintext", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qoder-dpapi-"));
  const secretFile = path.join(dir, "hmac.dpapi");
  const secret = "dpapi-hmac-secret-for-test";
  await writeProtectedSecret(secretFile, secret);
  assert.ok(!(await readFile(secretFile, "utf8")).includes(secret));
  assert.equal(await readProtectedSecret(secretFile), secret);
});

test("DPAPI wrapper injects only HMAC key into the child environment", { skip: process.platform !== "win32" }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "qoder-dpapi-env-"));
  const hmacFile = path.join(dir, "hmac.dpapi");
  await writeProtectedSecret(hmacFile, "wrapper-hmac-secret");
  const output = [];
  const child = await spawnWithDpapiEnv({
    command: process.execPath,
    args: ["-e", "process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith('QODER_HOOK_')))))"],
    hmacSecretFile: hmacFile,
    stdio: ["ignore", "pipe", "pipe"],
    env: {},
  });
  child.stdout.on("data", (chunk) => output.push(chunk));
  const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", resolve); });
  assert.equal(code, 0);
  const parsed = JSON.parse(Buffer.concat(output).toString("utf8"));
  assert.deepEqual(parsed, { QODER_HOOK_HMAC_KEY: "wrapper-hmac-secret" });
});
