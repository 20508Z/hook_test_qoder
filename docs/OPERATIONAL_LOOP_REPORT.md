# Qoder Operational Loop Report

Generated: 2026-08-09T09:25:21.868Z

## Real Qoder auto attempt

`qoder chat -m agent -n` was invoked in the isolated `.qoder-test` workspace after a Qoder-only Hook and managed companion were configured. The CLI returned successfully and started Qoder processes, but no generated files and no Hook JSONL events appeared during observation. This proves CLI-to-UI entrypoint activation only, not a completed model call. Model name, model-call ID, credits, event time, surface, and result for a completed call are `null`/unobserved. The local CLI has no model-selection flag; the user requested `auto`, so no Qwen3.7 claim is made.

QoderWork and IDEA plugin were unavailable as real source surfaces and remain synthetic adapter coverage only. Companion health was `ready`; the health record contains a workspace HMAC and pipe name, not workspace plaintext.

## Configuration and recovery

- Settings backup: `C:\Users\Tzhang\.qoder\settings.json.backup-hook-test-20260809`.
- Test-only spool and DPAPI secret were under `.qoder-test`; the companion was stopped and the directory was deleted after validation.
- Restore: `Copy-Item -LiteralPath 'C:\Users\Tzhang\.qoder\settings.json.backup-hook-test-20260809' -Destination 'C:\Users\Tzhang\.qoder\settings.json' -Force`.
- Only Qoder `PreToolUse`, `PostToolUse`, and `PostToolUseFailure` hooks were changed. Prompt, response, code, command, stdout, stderr, and error text were not persisted.
- Recovery status: settings restored from the backup; test workspace/spool/secret removed.

## Verification summary

- Focused metrics tests: 2/2 passed.
- Full suite: 42/42 passed.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm pack --dry-run`: 23,365 bytes packed, 86,254 bytes unpacked, 24 files.

Safety: the loop used a temporary workspace, synthetic HMAC/body, and a local bare remote; it did not use employee data, real spool, logs, settings, or GitHub. The repository was committed and pushed only after validation and sensitive-data review.

## Isolated synthetic results

| Scenario | Status | Actual result |
| --- | --- | --- |
| surface/ide | passed | adapter normalized |
| surface/cli | passed | adapter normalized |
| surface/qoderwork | passed | adapter normalized |
| surface/idea_plugin | passed | adapter normalized |
| shell/bash-multi-file | passed | 2 files/3 lines |
| shell/powershell-multi-file | passed | 2 files/3 lines |
| shell/cmd-multi-file | passed | 2 files/3 lines |
| Write/Edit AI then human | passed | ai=2, modified=1 |
| Speckit/OpenSpec documentation+code | passed | 2 files/documentation,source_code |
| pure human artifact | passed | null (no AI source chain) |
| experiment to core project | passed | source_code |
| cross-session model/credits missing | passed | auto/null preserved |
| commit/push/rename/rollback | passed | local commits, branch, push, rename and rollback executed |

## Metric smoke output

`aggregateMetrics` groups: 2; missing model calls remain null.

## Evidence boundary

- Synthetic loops exercise all four surfaces, Write/Edit, bash/PowerShell/cmd, multi-file Speckit/OpenSpec-like output, documentation/data/code, human saves, cross-session fields, credits null handling, Git commit/branch/push/rename/rollback.
- Real Qoder CLI evidence remains the repository's existing six-event evidence. QoderWork and IDEA plugin are adapter/synthetic only; server-side Members, Usage Events and AI Code Metrics reconciliation is not performed.
