import path from "node:path";

const DEFAULT_MAX_STDIN_BYTES = 1024 * 1024;

export function loadConfig(overrides = {}, env = process.env) {
  const hmacKey = overrides.hmacKey ?? env.QODER_HOOK_HMAC_KEY;
  if (typeof hmacKey !== "string" || hmacKey.length < 16) {
    const error = new Error("QODER_HOOK_HMAC_KEY must contain at least 16 characters");
    error.code = "ERR_HMAC_KEY_REQUIRED";
    error.failOpen = true;
    throw error;
  }

  const maxStdinBytes = Number(
    overrides.maxStdinBytes ?? env.QODER_HOOK_MAX_STDIN_BYTES ?? DEFAULT_MAX_STDIN_BYTES,
  );
  if (!Number.isSafeInteger(maxStdinBytes) || maxStdinBytes <= 0) {
    throw new TypeError("maxStdinBytes must be a positive safe integer");
  }

  const enterpriseUserHmac = overrides.enterpriseUserHmac ?? env.QODER_ENTERPRISE_USER_HMAC ?? null;
  if (enterpriseUserHmac !== null && !/^[a-f0-9]{64}$/.test(enterpriseUserHmac)) {
    throw new TypeError("QODER_ENTERPRISE_USER_HMAC must be a 64-character lowercase hex digest");
  }

  return Object.freeze({
    schemaVersion: "2.1",
    hmacKey,
    enterpriseUserHmac,
    spoolDir: path.resolve(
      overrides.spoolDir ?? env.QODER_HOOK_SPOOL_DIR ?? path.join(process.cwd(), ".spool"),
    ),
    maxStdinBytes,
    diffPipe: overrides.diffPipe ?? env.QODER_HOOK_DIFF_PIPE ?? null,
  });
}
