import path from "node:path";

import { adaptHook } from "./adapters/index.js";
import { createEventIdentity, createPrivacyPolicy, hmacValue } from "./core/index.js";

const RECEIVER_VERSION = "0.2.0";

function pseudonymize(value, key) {
  return value === null || value === undefined || value === "" ? null : hmacValue(value, key);
}

function safeLabel(value, maxLength = 128) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+\-]*$/.test(value) ? value : null;
}

function fileMetadata(pathSource, key) {
  if (typeof pathSource !== "string" || pathSource === "") {
    return { file_extension: null, file_name_hmac: null, file_type: null, path_hmac: null };
  }
  const extension = path.extname(pathSource).toLowerCase();
  const safeExtension = /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : null;
  const sourceCode = new Set([".c", ".cc", ".cpp", ".cs", ".go", ".java", ".js", ".jsx", ".kt", ".php", ".py", ".rb", ".rs", ".swift", ".ts", ".tsx"]);
  const documentation = new Set([".adoc", ".docx", ".md", ".pdf", ".pptx", ".rst", ".txt"]);
  const configuration = new Set([".ini", ".json", ".toml", ".xml", ".yaml", ".yml"]);
  const data = new Set([".csv", ".parquet", ".sql", ".tsv", ".xlsx"]);
  const fileType = sourceCode.has(safeExtension) ? "source_code"
    : documentation.has(safeExtension) ? "documentation"
      : configuration.has(safeExtension) ? "configuration"
        : data.has(safeExtension) ? "data"
          : safeExtension === ".ipynb" ? "notebook"
            : "other";
  return {
    file_extension: safeExtension,
    file_name_hmac: hmacValue(path.basename(pathSource), key),
    file_type: fileType,
    path_hmac: hmacValue(pathSource, key),
  };
}

export function canonicalizeHook(payload, { config, hints = {}, now = () => new Date() }) {
  const adapted = adaptHook(payload, hints);
  const identity = createEventIdentity({
    payload,
    hints: { ideProduct: hints.ideProduct ?? null, surface: adapted.surface },
  }, config.hmacKey);
  const file = fileMetadata(adapted.pathSource, config.hmacKey);

  return {
    schema_version: config.schemaVersion,
    event_id: identity.event_id,
    source_fingerprint: identity.source_fingerprint,
    event_time: adapted.eventTime,
    observed_at: now().toISOString(),
    ide: { product: "qoder" },
    event: adapted.eventType,
    native_event: safeLabel(adapted.nativeEvent),
    employee_id: config.enterpriseUserHmac ?? pseudonymize(adapted.employeeSource, config.hmacKey),
    device_id: pseudonymize(adapted.deviceId, config.hmacKey),
    session_id: pseudonymize(adapted.sessionSource, config.hmacKey),
    workspace_id: pseudonymize(adapted.workspaceSource, config.hmacKey),
    correlation: {
      tool_call_id: pseudonymize(adapted.toolCallSource, config.hmacKey),
    },
    tool: {
      name: adapted.tool?.name ?? null,
      file_extension: file.file_extension,
      file_name_hmac: file.file_name_hmac,
      file_type: file.file_type,
      path_hmac: file.path_hmac,
      command_family: adapted.tool?.commandFamily ?? null,
      shell: adapted.tool?.shell ?? null,
    },
    result: {
      status: adapted.result?.status ?? null,
    },
    usage: {
      model_id: pseudonymize(adapted.usage.modelSource, config.hmacKey),
      model_call_id: pseudonymize(adapted.usage.modelCallSource, config.hmacKey),
      credits_used: adapted.usage.creditsUsed,
    },
    privacy: createPrivacyPolicy(),
    source: {
      receiver_version: RECEIVER_VERSION,
      input_fingerprint: identity.source_fingerprint,
      native_schema_version: safeLabel(payload.schema_version),
      surface: adapted.surface,
    },
  };
}
