// Pure administrator-side metric helpers. They consume already privacy-safe events.
const DIMENSIONS = ["employee_id", "team_id", "surface", "model_id", "model_call_id", "credits_used", "event_time", "project_id", "importance", "file_type", "commit_hmac", "push_hmac", "coverage", "privacy", "health"];

function valueAt(event, dimension) {
  if (dimension === "surface") return event.source?.surface ?? event.source?.surface_type ?? null;
  if (dimension === "model_id") return event.usage?.model_id ?? event.model_id ?? null;
  if (dimension === "model_call_id") return event.usage?.model_call_id ?? event.model_call_id ?? null;
  if (dimension === "credits_used") return event.usage?.credits_used ?? event.credits_used ?? null;
  if (dimension === "event_time") return event.event_time ?? event.observed_at ?? null;
  if (dimension === "commit_hmac") return event.commit_hmac ?? null;
  if (dimension === "push_hmac") return event.event === "push_checkpoint" ? event.commit_hmac ?? null : null;
  if (dimension === "coverage") return event.workspace_scan_complete ?? event.coverage ?? null;
  if (dimension === "privacy") return event.privacy?.content_stored === false ? "metadata_only" : null;
  if (dimension === "health") return event.health?.status ?? event.status ?? null;
  return event[dimension] ?? null;
}

function inWindow(event, window) {
  if (!window?.from && !window?.to) return true;
  const value = Date.parse(valueAt(event, "event_time") ?? "");
  if (!Number.isFinite(value)) return false;
  if (window.from && value < Date.parse(window.from)) return false;
  if (window.to && value >= Date.parse(window.to)) return false;
  return true;
}

function add(group, key, value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
  group[key] = (group[key] ?? 0) + Number(value);
}

export function aggregateMetrics(events = [], { dimensions = [], window = null } = {}) {
  const dims = dimensions.filter((item) => DIMENSIONS.includes(item));
  const groups = new Map();
  for (const event of events) {
    if (!inWindow(event, window)) continue;
    const key = JSON.stringify(dims.map((dimension) => valueAt(event, dimension)));
    if (!groups.has(key)) groups.set(key, { dimensions: Object.fromEntries(dims.map((d) => [d, valueAt(event, d)])), event_count: 0, model_call_ids: new Set(), credits_used: null, ai_generated_lines: 0, ai_accepted_lines: 0, ai_then_human_modified_lines: 0, human_authored_lines: 0, committed_lines: 0, diff_events: 0, commit_events: 0, push_events: 0, complete_scans: 0, incomplete_scans: 0 });
    const group = groups.get(key);
    group.event_count += 1;
    if (event.usage?.model_call_id) group.model_call_ids.add(event.usage.model_call_id);
    if (event.usage?.credits_used !== null && event.usage?.credits_used !== undefined) group.credits_used = (group.credits_used ?? 0) + Number(event.usage.credits_used);
    if (event.event === "ai_diff" || event.event === "ai_command_diff") { group.diff_events += 1; add(group, "ai_generated_lines", Number(event.added ?? 0) + Number(event.modified ?? 0)); }
    if (event.event === "commit_checkpoint" || event.event === "push_checkpoint") {
      if (event.event === "commit_checkpoint") group.commit_events += 1; else group.push_events += 1;
      add(group, "ai_accepted_lines", event.ai_accepted_lines); add(group, "ai_then_human_modified_lines", event.ai_then_human_modified_lines); add(group, "human_authored_lines", event.human_authored_lines); add(group, "committed_lines", event.committed_lines);
    }
    if (event.workspace_scan_complete === true) group.complete_scans += 1;
    if (event.workspace_scan_complete === false) group.incomplete_scans += 1;
  }
  return [...groups.values()].map((group) => ({ ...group, model_call_count: group.model_call_ids.size || null, commit_ai_ratio: group.committed_lines ? group.ai_accepted_lines / group.committed_lines : null, scan_completeness: (group.complete_scans + group.incomplete_scans) ? group.complete_scans / (group.complete_scans + group.incomplete_scans) : null, model_call_ids: undefined }));
}

export function metricCatalog() {
  return [
    ["ai_acceptance_rate", "AI 产出有多少进入提交", "ai_accepted_lines / committed_lines", "committed_lines", "rolling 7d/30d", "employee/project/file_type/surface", "local git + AI metrics API", "null when denominator missing", "compare same window and scope", "small denominators exaggerate"],
    ["human_revision_rate", "AI 代码需多少人工修改", "ai_then_human_modified_lines / (ai_accepted_lines + ai_then_human_modified_lines)", "AI-attributed committed lines", "rolling 30d", "employee/project/model", "diff attribution + commits", "null", "exclude incomplete scans", "does not measure quality"],
    ["active_employee_rate", "团队实际使用覆盖", "active employees / eligible employees", "eligible roster", "monthly", "team/role/surface", "Members API + events", "null, never zero", "freeze roster snapshot", "privacy risk for tiny teams"],
    ["model_call_count", "真实模型调用次数", "count distinct non-null model_call_id", "distinct IDs", "daily/monthly", "model/employee/surface", "usage API + explicit payload IDs", "null when IDs absent", "deduplicate IDs", "tool events are not calls"],
    ["credits_reconciliation_gap", "本地提示 credits 与官方账单差异", "local credits - official credits", "official credits", "billing period", "employee/model", "Usage Events API + local events", "null if either side missing", "same IDs/window", "local value is not source of truth"],
    ["scan_completeness", "归因扫描是否完整", "complete scans / all scans", "all scans", "daily", "project/surface", "companion events", "null if no scans", "report incomplete separately", "high score can hide excluded files"],
    ["push_confirmation_rate", "本地 push checkpoint 覆盖", "confirmed push checkpoints / push attempts", "push attempts", "rolling 30d", "project/employee", "local git + server reconciliation", "null", "local confirmation != server acceptance", "cannot imply deployment"],
    ["metadata_coverage", "可用字段覆盖", "non-null observed fields / applicable fields", "applicable fields", "daily/weekly", "employee/team/surface/model/project/importance", "local metadata events", "report numerator and denominator; never impute", "same event families and time window", "coverage is not activity or quality"],
    ["high_importance_acceptance", "高重要性项目的 AI 采纳", "ai_accepted_lines / committed_lines", "committed_lines", "rolling 30d", "project/importance/model/team", "commit checkpoints + project labels", "null when no commits", "do not compare with normal projects without stratifying", "not a delivery-risk measure"],
    ["privacy_guard_rate", "隐私保护事件覆盖", "metadata_only events / all events", "all persisted events", "daily", "surface/project/employee", "spool validation", "null when no events", "same schema version", "does not establish legal compliance"],
    ["hook_health_rate", "Hook 健康度", "successful observed hooks / attempted hooks", "attempted hooks", "daily", "surface/project/health", "receiver health summaries", "null when attempts are unknown", "fail-open losses must be reported separately", "not a model success rate"],
  ].map(([name, business_question, formula, denominator, time_window, dimensions, data_source, missing_value, comparability, misuse_risk]) => ({ name, business_question, formula, denominator, time_window, dimensions, data_source, missing_value, comparability, misuse_risk }));
}

export { DIMENSIONS };
