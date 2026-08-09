const SENSITIVE_FIELD_KEYS = new Set([
  "agentresponse", "code", "command", "content", "diff", "error", "errormessage",
  "filetext", "fullcommand", "input", "lastassistantmessage", "message", "newstring",
  "output", "patch", "prompt", "prompttext", "reply", "response", "sourcecode",
  "stderr", "stdout", "text", "toolinput", "tooloutput", "toolresponse", "userprompt",
]);

function normalizedKey(key) {
  return key.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

export class SensitiveContentError extends Error {
  constructor(path) {
    super(`Refusing to persist possible raw sensitive content at: ${path}`);
    this.name = "SensitiveContentError";
    this.code = "ERR_RAW_SENSITIVE_CONTENT";
    this.failOpen = true;
  }
}

export function createPrivacyPolicy() {
  return Object.freeze({
    content_stored: false,
    redaction_version: "2.0",
  });
}

export function assertNoRawSensitiveContent(value, path = "$", ancestors = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (ancestors.has(value)) throw new SensitiveContentError(path);

  ancestors.add(value);
  try {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (SENSITIVE_FIELD_KEYS.has(normalizedKey(key))) throw new SensitiveContentError(childPath);
      assertNoRawSensitiveContent(child, childPath, ancestors);
    }
  } finally {
    ancestors.delete(value);
  }
}
