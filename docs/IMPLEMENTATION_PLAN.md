# Qoder 代码归因状态与后续计划

## 目标

在不打断 Qoder 的前提下，把文件修改和命令落盘追踪到 commit，再追踪到实际 push。

## 重点指标

| 指标 | 定义 |
| --- | --- |
| `ai_generated_lines` | Qoder 变更造成的 AI 行毛量 |
| `ai_command_generated_lines` | 由命令或脚本落盘的 AI 行毛量 |
| `ai_accepted_lines` | 进入 Git commit 的 AI 行 |
| `human_authored_lines` | 进入 commit 且没有 AI 来源链的行 |
| `ai_then_human_modified_lines` | 先 AI、后人工修改的行 |
| `committed_lines` | commit 相对父提交的新增和修改行 |
| `commit_ai_ratio` | `ai_accepted_lines / committed_lines` |
| `pushed_ai_lines` | Git 服务端确认已 push 的 AI 行 |

## 已完成

```text
Qoder hooks
  -> bounded stdin receiver
  -> local metadata spool
  -> managed diff companion
  -> commit checkpoint
  -> local remote-tracking push checkpoint
```

Hook 主路径只解析必要字段并快速返回。受管 companion 已能处理 Write/Edit、command workspace 变化、人工候选修改、本地 commit 和 remote-tracking push checkpoint。服务端事实仍由管理员 API 对账。

## 下一步

1. 增加 Qoder-only 安装、备份、原子 merge、health-check 和 restore 命令，默认 dry-run；
2. 在管理员下发环境验收 QoderWork 和 IDEA plugin 的真实无正文事件；
3. 在管理员后台实现 Members、Usage Events、AI Code Metrics 和企业 Git 服务端对账；
4. 完成法律告知、RBAC、审计、保留删除和密钥轮换后，再进行员工试点。
5. 为 Qoder CLI 增加可审计的非交互完成状态与明确模型选择后，再运行真实多轮模型场景；当前 `chat` 只能证明 UI 入口启动。

## 约束

- Hook 失败始终 fail-open。
- 不访问网络，不等待后台上传。
- stdin、pipe 和 spool 都有上限。
- 不引入 UI、大型数据库或全盘扫描。
- 只看实际文件变化、命令元数据和 commit SHA，不靠 session 名称猜来源。
- workspace baseline 最多 1000 个文件、16 MiB 文本；超出时标记 `workspace_scan_complete=false`，不伪造完整统计。
