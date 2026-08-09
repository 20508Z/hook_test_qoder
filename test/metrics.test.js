import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMetrics, DIMENSIONS, metricCatalog } from "../src/metrics.js";

test("metric aggregation keeps missing values null and deduplicates model calls", () => {
  const rows = aggregateMetrics([
    { event: "ai_diff", source: { surface: "ide" }, file_type: "source_code", added: 2, modified: 1, event_time: "2026-08-01T00:00:00Z", usage: { model_call_id: "m1", credits_used: null } },
    { event: "commit_checkpoint", source: { surface: "ide" }, file_type: "source_code", committed_lines: 3, ai_accepted_lines: 2, ai_then_human_modified_lines: 1, human_authored_lines: 0, event_time: "2026-08-01T00:01:00Z" },
    { event: "tool_end", source: { surface: "ide" }, event_time: "2026-08-02T00:00:00Z", usage: { model_call_id: "m1" } },
  ], { dimensions: ["surface", "file_type"], window: { from: "2026-08-01", to: "2026-08-02" } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].model_call_count, 1);
  assert.equal(rows[0].credits_used, null);
  assert.equal(rows[0].commit_ai_ratio, 2 / 3);
});

test("metric catalog covers administrator dimensions and misuse warnings", () => {
  const catalog = metricCatalog();
  assert.ok(catalog.length >= 7);
  assert.ok(catalog.every((metric) => metric.formula && metric.denominator && metric.missing_value && metric.misuse_risk));
  for (const dimension of ["employee_id", "team_id", "surface", "model_id", "model_call_id", "credits_used", "event_time", "project_id", "importance", "file_type", "commit_hmac", "push_hmac", "coverage", "privacy", "health"]) assert.ok(DIMENSIONS.includes(dimension));
});
