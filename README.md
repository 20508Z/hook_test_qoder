# Qoder Code Attribution Hook

这是一个面向 Qoder 企业下发场景的轻量本地代码归因 Hook。它把 Qoder 直接写文件、通过 shell 生成文件、人工后续修改、Git commit 和本地 push checkpoint 串成同一条文件级归因链，同时避免保存业务正文。

## 可以统计什么

- Qoder 直接或通过 bash、PowerShell、`cmd` 生成的代码行；
- 最终保留并进入 commit 的 AI 行；
- AI 生成后被人工修改的行；
- 没有 AI 来源链的人工提交行；
- 每个 commit 的提交行数、AI 采纳行数和 AI 占比；
- push 涉及的 commit 和文件 HMAC；
- 文件类型、扩展名、文件名/路径 HMAC；
- payload 明确提供的模型 ID、模型调用 ID 和 credits；
- 企业下发的稳定伪匿名员工 ID。

`model_call_id` 或 `credits_used` 缺失时保持 `null`。系统不会用工具事件数冒充模型调用次数，也不会用本地 credits 覆盖 Qoder 官方账单。

## 隐私和性能边界

- 不持久化 Prompt、AI 回复、代码或文档正文、命令、stdout/stderr、错误正文、diff patch、commit message、Git 作者、邮箱或 remote URL；
- HMAC key 通过 Windows DPAPI wrapper 注入，不写入 Hook JSON；
- receiver 不访问网络，pipe 失败、解析失败或落盘失败均 fail-open；
- command baseline 最多处理 1000 个文件、16 MiB UTF-8 文本，单文件最多 2 MiB；
- 超限时记录 `workspace_scan_complete=false`，不会把不完整结果包装成完整统计；
- 发布包当前约 20 kB，不包含 UI、数据库、上传器或常驻网络客户端。

## 数据流

```text
Qoder IDE / CLI / QoderWork / IDEA plugin
  -> bounded Hook receiver
  -> metadata spool + local pipe
  -> managed workspace companion
  -> file line attribution
  -> local commit/push checkpoint
  -> admin-side official API reconciliation
```

员工端只负责本地隐私化归因。Qoder Members、Usage Events 和 AI Code Metrics API 的调用、API Key 和员工主数据映射全部留在管理员侧，详见 [`docs/ADMIN_API_INTEGRATION.md`](docs/ADMIN_API_INTEGRATION.md)。

## 当前接线

配置示例位于 [`config/examples/qoder.settings.fragment.json`](config/examples/qoder.settings.fragment.json)。它是 merge fragment，不是完整 settings，使用前必须替换安装、密钥和 spool 路径，并先启动同一 workspace 的 companion：

```powershell
qoder-diff-companion --workspace "<WORKSPACE>" --pipe qoder-attribution-v1 --spool-dir "<SPOOL_DIR>/qoder" --health-file "<SPOOL_DIR>/qoder/companion-health.json"
```

fragment 当前标记 `surface=ide`。CLI、QoderWork 和 IDEA plugin 需要各自的受管启动入口传入对应 surface。本仓库不会自动修改 `C:\Users\Tzhang\.qoder\settings.json`。

## 验证

需要 Node.js 22+：

```powershell
npm ci
npm test
npm audit --audit-level=high
```

当前基线为 42/42 tests、0 vulnerabilities；`npm pack --dry-run` 为 23,365 bytes。接线和指标实测见 [`docs/QODER_VALIDATION.md`](docs/QODER_VALIDATION.md)。架构、字段、威胁边界和后续工作分别见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)、[`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md)、[`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) 和 [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)。迁移历史仅保留在 [`MIGRATION.md`](MIGRATION.md)。

运营指标纯函数位于 `src/metrics.js`，支持 employee、team、surface、model/model_call、credits、time、project、importance、file_type、commit/push、coverage、privacy 和 health 维度。真实与合成证据边界统一记录在 [`docs/OPERATIONAL_LOOP_REPORT.md`](docs/OPERATIONAL_LOOP_REPORT.md)。
