const ADAPTER_VERSION = "2.0";

const EVENT_TYPES = new Map([
  ["pretooluse", "tool_start"],
  ["posttooluse", "tool_end"],
  ["posttoolusefailure", "tool_error"],
]);

const MUTATING_TOOLS = new Map([
  ["write", "write"],
  ["createfile", "write"],
  ["edit", "edit"],
  ["searchreplace", "edit"],
  ["applypatch", "edit"],
  ["bash", "command"],
  ["shell", "command"],
  ["powershell", "command"],
  ["cmd", "command"],
  ["executecommand", "command"],
  ["runcommand", "command"],
  ["terminal", "command"],
  ["command", "command"],
]);

const SURFACES = new Set(["ide", "cli", "qoderwork", "idea_plugin"]);

function compactName(value) {
  return typeof value === "string" ? value.replace(/[^a-z0-9]/gi, "").toLowerCase() : "";
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function firstString(...values) {
  return values.find((value) => typeof value === "string") ?? null;
}

function scalarString(value) {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function nonNegativeNumber(...values) {
  const value = values.find((candidate) => typeof candidate === "number");
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeTime(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function normalizeIde(value) {
  return compactName(value) === "qoder" ? "qoder" : null;
}

function detectIde(payload, hints) {
  const candidates = [
    payload.ide_product,
    payload.ideProduct,
    payload.product,
    payload.client_name,
    payload.ide?.product,
    payload.ide?.name,
    payload.client?.name,
  ];
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null) return normalizeIde(candidate);
  }
  return normalizeIde(hints.ideProduct) ?? normalizeIde(hints.ide);
}

function detectNativeEvent(payload, hints) {
  return firstString(
    hints.nativeEvent,
    hints.event,
    payload.hook_event_name,
    payload.hookEventName,
    payload.hook_event,
    payload.event_name,
    payload.eventName,
    payload.event,
    payload.type,
  );
}

function canonicalNativeEvent(value) {
  const names = {
    pretooluse: "PreToolUse",
    posttooluse: "PostToolUse",
    posttoolusefailure: "PostToolUseFailure",
  };
  return names[compactName(value)] ?? value;
}

function nativeToolName(payload) {
  return firstString(
    payload.tool_name,
    payload.toolName,
    payload.tool,
    payload.tool?.name,
    payload.tool_input?.tool_name,
    payload.input?.tool_name,
  );
}

export function mapToolName(name) {
  if (!name) return null;
  return MUTATING_TOOLS.get(compactName(name)) ?? "other";
}

function normalizeSurface(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase().replace(/-/g, "_") : "";
  return SURFACES.has(normalized) ? normalized : "unknown";
}

function commandMetadata(nativeName, toolName) {
  if (toolName !== "command") return { family: null, shell: null };
  const compacted = compactName(nativeName);
  const shell = compacted === "bash" ? "bash"
    : compacted === "powershell" ? "powershell"
      : compacted === "cmd" ? "cmd"
        : null;
  return { family: "shell", shell };
}

function inferStatus(payload, nativeEvent) {
  if (nativeEvent === "PostToolUseFailure") return "failure";
  const response = firstDefined(payload.tool_response, payload.toolResponse, payload.result) ?? {};
  const explicit = firstDefined(
    payload.status,
    response.status,
    payload.success,
    response.success,
    response.is_error === true ? false : null,
  );
  if (String(explicit).toLowerCase() === "blocked") return "blocked";
  if (explicit === false || String(explicit).toLowerCase() === "failure") return "failure";
  if (explicit === true || String(explicit).toLowerCase() === "success" || nativeEvent === "PostToolUse") {
    return "success";
  }
  return "unknown";
}

function extractPathSource(payload) {
  const input = firstDefined(payload.tool_input, payload.toolInput, payload.input) ?? {};
  return firstString(input.path, input.file_path, input.filePath);
}

export function adaptHook(payload, hints = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Hook payload must be a JSON object");
  }

  const detectedEvent = detectNativeEvent(payload, hints);
  if (!detectedEvent) throw new Error("Unable to identify Hook event");
  const nativeEvent = canonicalNativeEvent(detectedEvent);
  const eventType = EVENT_TYPES.get(compactName(nativeEvent));
  if (!eventType) throw new Error(`Unsupported Hook event: ${nativeEvent}`);

  const ideProduct = detectIde(payload, hints);
  if (!ideProduct) throw new Error("Unable to identify Qoder; pass hints.ideProduct");
  const nativeName = nativeToolName(payload);
  const toolName = nativeName ? mapToolName(nativeName) : null;
  const command = commandMetadata(nativeName, toolName);

  return {
    adapterVersion: ADAPTER_VERSION,
    ideProduct,
    surface: normalizeSurface(hints.surface ?? payload.client_surface ?? payload.clientSurface),
    nativeEvent,
    eventType,
    eventTime: normalizeTime(firstDefined(payload.timestamp, payload.event_time, payload.eventTime, payload.created_at)),
    nativeEventId: scalarString(firstDefined(payload.event_id, payload.eventId, payload.id)),
    sessionSource: scalarString(firstDefined(payload.session_id, payload.sessionId, payload.conversation_id, payload.conversationId)),
    workspaceSource: firstString(payload.cwd, payload.workspace, payload.workspace_path, payload.project_path),
    employeeSource: scalarString(firstDefined(hints.employeeSource, payload.employee_id, payload.employeeId)),
    deviceId: scalarString(firstDefined(payload.device_id, payload.deviceId, hints.deviceId)),
    pathSource: extractPathSource(payload),
    toolCallSource: scalarString(firstDefined(
      payload.tool_use_id,
      payload.toolUseId,
      payload.tool_call_id,
      payload.toolCallId,
      payload.tool_input?.tool_use_id,
    )),
    tool: nativeName ? { name: toolName, commandFamily: command.family, shell: command.shell } : null,
    result: nativeEvent.startsWith("PostToolUse") ? { status: inferStatus(payload, nativeEvent) } : null,
    usage: {
      modelSource: firstString(
        payload.model_id,
        payload.modelId,
        payload.usage?.model_id,
        payload.usage?.modelId,
        payload.usage?.model,
      ),
      modelCallSource: scalarString(firstDefined(
        payload.model_call_id,
        payload.modelCallId,
        payload.usage?.model_call_id,
        payload.usage?.modelCallId,
      )),
      creditsUsed: nonNegativeNumber(
        payload.credits_used,
        payload.creditsUsed,
        payload.usage?.credits_used,
        payload.usage?.creditsUsed,
        payload.usage?.credits,
      ),
    },
  };
}

export function createDiffSignal(payload, hints = {}) {
  const adapted = adaptHook(payload, hints);
  const signal = {
    ide_product: "qoder",
    hook_event_name: adapted.nativeEvent,
    client_surface: adapted.surface,
    session_id: adapted.sessionSource,
    tool_use_id: adapted.toolCallSource,
    tool_name: adapted.tool?.name ?? null,
  };
  if (adapted.pathSource) signal.tool_input = { path: adapted.pathSource };
  return signal;
}
