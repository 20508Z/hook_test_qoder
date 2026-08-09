# Qoder-only 架构

```text
Qoder Hook
  -> bounded stdin receiver
  -> metadata adapter + HMAC + surface
  -> local JSONL spool
  -> managed diff companion (workspace-local pipe)
  -> command workspace baseline
  -> commit/push checkpoint
  -> admin-side reconciliation
```

Receiver 不访问网络，只解析必要字段并快速返回。任何解析、I/O、锁或 pipe 错误都 fail-open，不改变 Qoder 的执行结果。

| 组件 | 只负责 |
| --- | --- |
| `hook-receiver` | stdin 上限、surface、HMAC、spool |
| `adapters` | `PreToolUse`、`PostToolUse`、`PostToolUseFailure` 到稳定事件 |
| `core/crypto` | canonicalization、HMAC、source fingerprint |
| `core/spool` | 幂等、并发锁、敏感字段 guard、fail-open |
| `secrets/dpapi` | 当前用户 DPAPI blob 与 HMAC key 注入 |
| `diff/attribution` | Write/Edit/command 变化归因、bounded workspace baseline 和文件级 HMAC 关联 |
| `diff/launcher` | 为单个 workspace 启动 companion、写 health 文件并优雅关闭 |
| `git/repository` | 读取本地 commit 和 remote-tracking ref，不访问网络 |

当前只保留必要元数据：`command_family`、`shell`、`model_id`、`model_call_id`、`credits_used`、文件 HMAC、文件名 HMAC、路径 HMAC、文件类型、commit/push HMAC 和行数。正文、输出、错误和 patch 不进入 spool。企业成员、用量和 AI code metrics 由管理员端官方 API 对账，见 [`ADMIN_API_INTEGRATION.md`](ADMIN_API_INTEGRATION.md)。

companion 启动时建立最多 1000 文件、16 MiB 文本的 workspace baseline。Write/Edit 使用单文件前后快照；command 的 PreToolUse 复制内存 baseline，PostToolUse 执行一次有界复扫。人工 watcher 变化只标记 `manual_candidate_diff`，不能证明编辑者身份。commit 匹配在内存中完成，spool 只接收行数、状态和 HMAC。

`src/metrics.js` 是无数据库、无 UI、无网络的管理员侧纯函数层，只消费已脱敏事件。维度缺失时保留 `null`，调用方必须同时报告分母、时间窗、字段覆盖和扫描完整性。
