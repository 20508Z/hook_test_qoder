import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adaptHook } from "../src/adapters/index.js";
import { AttributionCompanion } from "../src/diff/attribution.js";
import { aggregateMetrics, metricCatalog } from "../src/metrics.js";

const exec = promisify(execFile);
const key = "synthetic-enterprise-hmac-key-2026";
const results = [];
const root = await mkdtemp(path.join(tmpdir(), "qoder-operational-loop-"));
const remote = path.join(root, "remote.git");
const workspace = path.join(root, "workspace");
await mkdir(workspace);
await exec("git", ["init", "--bare", remote]);
await exec("git", ["-C", workspace, "init"]);
await exec("git", ["-C", workspace, "config", "user.name", "Synthetic Employee"]);
await exec("git", ["-C", workspace, "config", "user.email", "synthetic@example.invalid"]);
const companion = new AttributionCompanion({ workspaceRoot: workspace, hmacKey: key, spoolDir: path.join(workspace, ".spool"), employeeIdHmac: "a".repeat(64) });
await companion.initializeWorkspaceBaseline();

function hook(native, id, tool, surface, extra = {}) { return { ide_product: "qoder", hook_event_name: native, session_id: extra.session ?? "session-1", tool_use_id: id, tool_name: tool, client_surface: surface, tool_input: extra.input ?? {} }; }
async function scenario(name, fn) { try { const detail = await fn(); results.push({ name, status: "passed", detail }); } catch (error) { results.push({ name, status: "failed", detail: error.message }); } }

for (const surface of ["ide", "cli", "qoderwork", "idea_plugin"]) await scenario(`surface/${surface}`, async () => { const e = adaptHook(hook("PreToolUse", `s-${surface}`, "Write", surface), { ideProduct: "qoder" }); if (e.surface !== surface) throw new Error(`surface=${e.surface}`); return "adapter normalized"; });
for (const shell of ["bash", "powershell", "cmd"]) await scenario(`shell/${shell}-multi-file`, async () => { const pre = hook("PreToolUse", `cmd-${shell}`, shell, "cli", { input: {} }); await companion.handleHook(pre); const dir = path.join(workspace, shell); await mkdir(dir); await writeFile(path.join(dir, "generated.ts"), `const ${shell} = 1;\nconst second = 2;\n`); await writeFile(path.join(dir, "notes.md"), "synthetic documentation\n"); const post = await companion.handleHook({ ...pre, hook_event_name: "PostToolUse" }); if (post.diffs.length !== 2) throw new Error("expected two files"); return `${post.diffs.length} files/${post.diffs.reduce((n, x) => n + x.event.added, 0)} lines`; });
await scenario("Write/Edit AI then human", async () => { const file = path.join(workspace, "src.ts"); const pre = hook("PreToolUse", "write-1", "Write", "ide", { input: { path: file } }); await companion.handleHook(pre); await writeFile(file, "ai line\nsecond line\n"); const ai = await companion.handleHook({ ...pre, hook_event_name: "PostToolUse" }); await writeFile(file, "human rewrite\nsecond line\n"); const manual = await companion.recordSave({ filePath: file, ideSaveEvidence: true }); return `ai=${ai.event.final_retained_ai_lines}, modified=${manual.event.ai_then_human_modified_lines}`; });
await scenario("Speckit/OpenSpec documentation+code", async () => { const pre = hook("PreToolUse", "spec-1", "bash", "qoderwork", { input: {} }); await companion.handleHook(pre); await mkdir(path.join(workspace, "spec")); await writeFile(path.join(workspace, "spec", "plan.md"), "spec plan\n"); await writeFile(path.join(workspace, "spec", "feature.py"), "print('synthetic')\n"); const post = await companion.handleHook({ ...pre, hook_event_name: "PostToolUse" }); return `${post.diffs.length} files/${post.diffs.map((x) => x.event.file_type).sort().join(",")}`; });
await scenario("pure human artifact", async () => { const file = path.join(workspace, "human.txt"); await writeFile(file, "human-only\n"); const event = await companion.recordSave({ filePath: file, ideSaveEvidence: false }); if (event !== null) throw new Error("unlinked human save was attributed"); return "null (no AI source chain)"; });
await scenario("experiment to core project", async () => { const pre = hook("PreToolUse", "exp-1", "Write", "idea_plugin", { input: { path: path.join(workspace, "experiment.js") } }); await companion.handleHook(pre); await writeFile(path.join(workspace, "experiment.js"), "export const experiment = true;\n"); return (await companion.handleHook({ ...pre, hook_event_name: "PostToolUse" })).event.file_type; });
await scenario("cross-session model/credits missing", async () => { const e = adaptHook({ ...hook("PreToolUse", "cross", "Write", "cli", { session: "session-2", input: { path: "x.ts" } }), usage: { model_id: "auto", credits_used: null } }, { ideProduct: "qoder" }); if (e.usage.creditsUsed !== null) throw new Error("missing credits was not null"); return "auto/null preserved"; });
await scenario("commit/push/rename/rollback", async () => { await exec("git", ["-C", workspace, "add", "."]); await exec("git", ["-C", workspace, "commit", "-m", "synthetic checkpoint"]); await exec("git", ["-C", workspace, "branch", "core"]); await exec("git", ["-C", workspace, "mv", "human.txt", "renamed.txt"]); await exec("git", ["-C", workspace, "commit", "-m", "rename"]); await exec("git", ["-C", workspace, "remote", "add", "origin", remote]); await exec("git", ["-C", workspace, "push", "-u", "origin", "core"]); await exec("git", ["-C", workspace, "reset", "--hard", "HEAD~1"]); return "local commits, branch, push, rename and rollback executed"; });

const spool = await readFile(path.join(workspace, ".spool", "attribution.jsonl"), "utf8").catch(() => "");
const events = spool.trim() ? spool.trim().split(/\r?\n/).map(JSON.parse) : [];
const metrics = aggregateMetrics(events, { dimensions: ["surface", "file_type"] });
const report = [`# Synthetic Operational Loop Report`, ``, `Generated: ${new Date().toISOString()}`, ``, `Safety: temporary workspace=${root}; synthetic HMAC/body; local bare remote; no employee data, real spool, logs, settings, or GitHub; current repo not committed.`, ``, `## Results`, ``, `| Scenario | Status | Actual result |`, `| --- | --- | --- |`, ...results.map((r) => `| ${r.name} | ${r.status} | ${r.detail} |`), ``, `## Metric smoke output`, ``, `\`aggregateMetrics\` groups: ${metrics.length}; missing model calls remain null.`, ``, `## Evidence boundary`, ``, `- Synthetic loops exercise all four surfaces, Write/Edit, bash/PowerShell/cmd, multi-file Speckit/OpenSpec-like output, documentation/data/code, human saves, cross-session fields, credits null handling, Git commit/branch/push/rename/rollback.`, `- Real Qoder CLI evidence remains the repository's existing six-event evidence. QoderWork and IDEA plugin are adapter/synthetic only; server-side Members, Usage Events and AI Code Metrics reconciliation is not performed.`].join("\n");
const output = path.resolve("docs/OPERATIONAL_LOOP_REPORT.md");
await writeFile(output, report);
console.log(JSON.stringify({ workspace: root, scenarios: results.length, passed: results.filter((r) => r.status === "passed").length, failed: results.filter((r) => r.status === "failed").length, report: output, metricCatalog: metricCatalog().length }, null, 2));
await rm(root, { recursive: true, force: true });
