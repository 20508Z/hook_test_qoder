import { createHmac, randomUUID } from "node:crypto";

const HMAC_DOMAIN = "qoder-code-attribution:v2\0";

function canonicalize(value, ancestors) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Only finite numbers can be canonicalized");
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "undefined":
      return undefined;
    case "object":
      break;
    default:
      throw new TypeError(`Unsupported value type: ${typeof value}`);
  }

  if (ancestors.has(value)) throw new TypeError("Cannot canonicalize a cyclic value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors) ?? "null").join(",")}]`;
    }
    const entries = [];
    for (const key of Object.keys(value).sort()) {
      const encoded = canonicalize(value[key], ancestors);
      if (encoded !== undefined) entries.push(`${JSON.stringify(key)}:${encoded}`);
    }
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

export function stableCanonicalize(value) {
  const encoded = canonicalize(value, new Set());
  if (encoded === undefined) throw new TypeError("A top-level undefined value cannot be canonicalized");
  return encoded;
}

export function hmacValue(value, key) {
  if ((typeof key !== "string" && !Buffer.isBuffer(key)) || key.length === 0) {
    throw new TypeError("A non-empty HMAC key is required");
  }
  return createHmac("sha256", key)
    .update(HMAC_DOMAIN)
    .update(stableCanonicalize(value))
    .digest("hex");
}

export function createEventIdentity(normalizedSource, key) {
  return Object.freeze({
    event_id: randomUUID(),
    source_fingerprint: hmacValue(normalizedSource, key),
  });
}
