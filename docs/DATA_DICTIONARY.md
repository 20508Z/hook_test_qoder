# Qoder 代码归因数据字典

canonical schema 为 `2.1`。缺失值一律保留为 `null`，不回填推断值。

## Hook event

| Qoder Hook | canonical event |
| --- | --- |
| `PreToolUse` | `tool_start` |
| `PostToolUse` | `tool_end` |
| `PostToolUseFailure` | `tool_error` |

## Canonical event

保存的核心字段：

- `event_id`、`source_fingerprint`
- `event_time`、`observed_at`
- `employee_id`、`device_id`、`session_id`、`workspace_id`、`tool_call_id`
- `tool.name`
- `tool.file_extension`、`tool.file_name_hmac`、`tool.file_type`、`tool.path_hmac`
- `tool.command_family`、`tool.shell`
- `result.status`
- `usage.model_id`、`usage.model_call_id`、`usage.credits_used`
- `source.surface`
- `privacy.content_stored=false`

不保存 Prompt、回复、正文、命令正文、输出、错误正文或 patch。

## 企业对齐

管理员端用官方成员 API 拉取 `organization_id` 下的 `member_id`，再用内部映射把成员绑定到企业员工主数据。员工本机只接收伪匿名 HMAC，不接收姓名、邮箱或工号。未配置企业映射时，Hook 只能在本地密钥范围内稳定，不保证跨设备一致。

## 统计口径

- `ai_generated_lines`：Qoder 工具产生的 AI 行毛量；
- `ai_accepted_lines`：进入 commit 的 AI 行；
- `human_authored_lines`：没有 AI 来源链的 commit 行；
- `ai_then_human_modified_lines`：先 AI、后人工修改的行；
- `commit_ai_ratio = ai_accepted_lines / committed_lines`；
- `credits_used` 只在 Hook 明确给出时记录，不得把缺失值记成 0；
- `model_call_id` 只在明确提供时用于去重计数，不用 `tool_start` / `tool_end` 数量冒充模型调用次数。

Git checkpoint 额外保存 commit HMAC、remote ref HMAC、提交文件数量、提交新增/修改行数及每个文件的 AI、人工修改和人工行数。push 事件只表示本地 remote-tracking ref 已更新，不等同于管理员侧服务端 API 确认。

## 文件和命令

文件追溯只靠 `path_hmac`、`file_name_hmac`、`file_extension` 和 `file_type`。如果 Qoder 通过 bash、PowerShell 或 `cmd` 生成文件，companion 会在有界 workspace 集合上记录 `ai_command_diff` 行数，并仍然不记录命令正文、stdout 或 stderr。

## Diff attribution event

- `ai_diff`：Write/Edit 前后实际文件变化；
- `ai_command_diff`：command 窗口内有界 workspace 文件变化；
- `manual_candidate_diff`：checkpoint 后 watcher 或显式保存观察到的候选人工变化；
- `added`、`deleted`、`modified`：本次文件变化行数；
- `final_retained_ai_lines`：当前文件仍保留的 AI 行；
- `ai_then_human_modified_lines`：当前文件保留的 AI 后人工修改行；
- `workspace_scan_complete`：command baseline 是否覆盖配置上限内的完整工作区集合。

## Git checkpoint event

- `commit_checkpoint`：本地 Git object 从旧 HEAD 变化到新 HEAD；
- `push_checkpoint`：本地 upstream remote-tracking ref 更新到当前 HEAD；
- `confirmation`：仅允许 `local_git_object` 或 `local_remote_tracking_ref`；
- `commit_hmac`、`parent_commit_hmac`、`branch_hmac`、`remote_ref_hmac`：Git 标识的 HMAC；
- `files[]`：每个提交文件的 HMAC、类型以及 AI/人工/混合行数。

## 运营维度与缺失值

指标接口支持 `employee_id`、`team_id`、`surface`、`model_id`、`model_call_id`、`credits_used`、`event_time`、`project_id`、`importance`、`file_type`、`commit_hmac`、`push_hmac`、`coverage`、`privacy` 和 `health`。来源未明确提供的字段为 `null`；不得用 `auto`、工具事件数或本地 checkpoint 补写具体模型、模型调用次数、官方 credits 或服务端 push 成功。
