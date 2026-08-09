# Qoder 验证说明

更新日期：2026-08-09。所有验证均使用临时隔离 workspace、合成正文和本地 bare Git remote，不使用员工数据，不读取真实 IDE 日志，不修改用户 Qoder settings，也不访问 GitHub。

## 自动化基线

- `npm ci`：成功；
- `npm test`：40/40 通过；
- `npm audit --audit-level=high`：0 vulnerabilities；
- 产品代码和当前文档无 Qoder CN、Lingma、TRAE 或完整正文采集分支。

自动化覆盖 Qoder mutating events、四种 surface、敏感字段 guard、HMAC/幂等 spool、stdin 上限、fail-open、无网络 receiver、DPAPI wrapper、workspace/symlink 边界、managed pipe、command 多文件归因、commit 和 local push checkpoint。

## 接线验证

receiver 使用 `--diff-pipe` 向 managed companion 发送精简的 `PreToolUse` / `PostToolUse` signal。companion 启动时建立 workspace baseline 并写只包含 workspace HMAC 的 health 文件。Qoder `Write` 创建 1 行后产生 1 个 `ai_diff`；正文 canary 未进入 spool。

## Shell 多文件场景

一个 Qoder bash 工具窗口创建 TypeScript 2 行和 Markdown 1 行，共产生 2 个 `ai_command_diff`、3 行 AI 生成量。事件只含文件/路径 HMAC、扩展名、文件类型和行数，`workspace_scan_complete=true`，不包含命令或文件正文。

## Commit 与 push 场景

| 场景 | 提交行 | AI 采纳 | AI 后人工修改 | 纯人工 | AI 占比 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 首次提交两行 AI | 2 | 2 | 0 | 0 | 100% |
| 人工改写一行并新增一行 | 2 | 0 | 1 | 1 | 0% |

随后 push 到临时本地 bare remote，产生 `push_checkpoint`，`confirmation=local_remote_tracking_ref`。事件保存 commit、branch、remote ref 和文件 HMAC，不保存 remote URL。该结论只证明本地 tracking ref 已更新，不等同于 GitHub 或企业 Git 服务端 API 已确认。

## 来源面状态

| Surface | 当前证据 |
| --- | --- |
| `ide` | 有真实 Hook 调用证据和合成接线测试 |
| `cli` | 有真实 Qoder CLI 小场景证据 |
| `qoderwork` | 已验证 adapter/桥接，事件仍为合成 payload |
| `idea_plugin` | 已验证 adapter/桥接，事件仍为合成 payload |

QoderWork 和 IDEA plugin 仍需在管理员下发环境完成一次无正文验收。正式企业统计还必须由管理员侧官方 API 对账。

## 2026-08-09 auto 入口复验

备份 settings 后，三类 Qoder Hook 被临时改到测试专用 workspace、spool、DPAPI key 和 pipe，managed companion health 为 `ready`。执行 `qoder chat -m agent -n` 后 CLI 成功返回并启动 Qoder 进程，但观察期内没有生成文件或 Hook JSONL，因此不能确认模型调用完成。该轮 `model_id`、`model_call_id`、`credits_used`、完成时间、完成 surface 和结果均为 `null`/未观测。隔离合成 operational loop 为 13/13 通过；QoderWork 和 IDEA plugin 仍未做真实验收。恢复命令见 `OPERATIONAL_LOOP_REPORT.md`。
