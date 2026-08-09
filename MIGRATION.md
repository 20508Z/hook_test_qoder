# Qoder-only migration

## Scope

This directory is the new authoritative workspace for the Qoder international edition only.
Qoder CN and TRAE are out of scope. They remain in parts of the copied snapshot only so the
pre-migration test baseline can be reproduced before product branches are removed.

Source snapshot:

`C:\Users\Tzhang\Desktop\实习_国金\0804\ai-ide-observability`

Migration date: 2026-08-07.

The migration intentionally excludes source `.git`, `node_modules`, local spool data, DPAPI
secret blobs, real IDE evidence, user IDE settings, and settings backups. Do not copy those into
this repository.

## Verified Qoder status

- The real Qoder command/stdin Hook produced 6 canonical events in one session.
- Events covered Prompt, two tool starts, two tool results, and Stop.
- All six events used `encrypted-full`; four contained encrypted content envelopes.
- The canary plaintext scan returned zero matches.
- The Hook payload did not provide an IDE version. Local registry and executable file versions
  disagreed (`1.106.3` versus `1.19.2`), so neither may be reported as a Hook-observed version.
- Real Qoder diff attribution is not yet verified. The real Hook configuration started only the
  receiver; it did not start `diff-companion` or provide `AI_IDE_OBS_DIFF_PIPE`, so no diff event
  was expected or produced.
- The copied automated suite passed 42 tests before the product split. It includes Qoder diff,
  DPAPI, encryption, path-boundary, pipe transport, and canonical event coverage.

Real spool and secrets remain outside this workspace and must not be imported. Their former
locations are documented in the source project's `docs/QODER_VALIDATION.md` only for authorized
local verification.

## First cleanup milestone

1. Rename package and public descriptions to Qoder-only.
2. Remove Qoder CN and TRAE config fragments, fixtures, adapter branches, schema enum values,
   tests, and documentation claims.
3. Preserve Qoder command/stdin receiver, AES-256-GCM encrypted-full mode, metadata mode, HMAC
   pseudonymization, DPAPI wrapper, local spool, and fail-open semantics.
4. Keep the diff attribution PoC, but clearly mark real IDE diff as unverified until the companion
   is installed, started, and connected to the Hook receiver.
5. Make the reduced suite pass and record the new test count; do not retain tests solely to inflate
   the count.
6. Do not modify `C:\Users\Tzhang\.qoder\settings.json` until the Qoder-only configuration has
   passed synthetic, CLI, DPAPI, and isolated real-IDE acceptance tests.

## Later scope decision

The active Qoder-only product scope no longer keeps full Prompt / response / command / diff plaintext capture, even if earlier migration notes mention `encrypted-full`. The current implementation keeps metadata, HMAC, DPAPI wrapper, local spool, fail-open, and diff companion only.

## Next implementation milestone

- Add a managed companion launcher for one Qoder workspace. **Completed 2026-08-09.**
- Inject a non-secret pipe name into the receiver without placing HMAC/content keys in Hook JSON. **Completed 2026-08-09.**
- Generate real `ai_diff`, then a saved `manual_candidate_diff`, and verify final retained AI lines. **Completed in isolated synthetic tests; real employee collection remains prohibited.**
- Add command workspace attribution and local commit/remote-tracking checkpoints. **Completed 2026-08-09.**
- Keep diff plaintext out of spool/stdout/logs; verify canary scans and sensitive-field guards.
- Add install, backup, merge, health-check, and restore commands for Qoder only.

## Safety constraints

- Never store Prompt, response, code, command, tool output, error, or diff as plaintext.
- Never place HMAC/content keys in source control, Hook JSON, command arguments, URLs, or logs.
- Treat filesystem-watcher changes as `manual_candidate`, not proven human edits.
- Do not collect employee data until legal/privacy approval, notice, RBAC, audit, retention, and
  key-management controls are in place.
