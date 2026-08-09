# Qoder 官方 API 集成边界

本项目不直接调用 Qoder 企业 OpenAPI，也不在员工本机保存 API Key。企业侧只用官方 API 做成员、用量和 AI code metrics 的对账。

## 成员 API

官方成员 API 的入口是 `GET /v1/organizations/{organization_id}/members`。它支持游标分页，`maxResults` 最大 100，`member_id` 是稳定成员主键，`email` 可能为空。成员详情和配额接口也都以 `member_id` 为锚点。

企业端做法：

1. 用组织 API Key 拉成员列表；
2. 将 `organization_id + member_id` 映射到企业自己的稳定伪匿名员工 ID；
3. 把该伪匿名 ID 下发到受管 Qoder 进程；
4. 只把映射表留在企业侧，不下发姓名、邮箱或工号。

## 用量 API

官方用量 API 的入口是 `GET /v1/organizations/{organization_id}/members/{member_id}/usage-events`。它返回聚合 Credits 记录和金额信息，适合做账单对齐和用量核对。

注意：

- 它不是模型调用唯一 ID 的来源；
- 不能用返回记录数冒充模型调用次数；
- `credits` 和 `cost` 是官方事实源，本地 Hook 只在 payload 明确给出时落 `credits_used`。

## AI Code Metrics API

官方 AI Code Metrics API 提供组织级 AI 代码统计，包含总览、趋势、成员排行、仓库、文件类型和 commit 级归因。重点入口包括：

- `GET /v1/organizations/{organization_id}/ai-code/stats/overview`
- `GET /v1/organizations/{organization_id}/ai-code-tracking/commits`
- `POST /v1/organizations/{organization_id}/ai-code-tracking/commits/detail`

官方页面说明它会返回 `committedTotalLinesEdit`、`committedAiLinesEdit`、`acceptedLinesEdit`、`aiShareRate` 等字段，并支持 file-level line range annotations。

## 本地 Hook 的职责

本地 Hook 只补官方 API 看不到的窗口：

- Qoder CLI / IDE / QoderWork / IDEA 插件的本地事件；
- bash、PowerShell、`cmd` 等命令落盘前后的文件变化；
- `path_hmac`、`file_name_hmac`、`file_extension`、`file_type` 这类隐私化文件追溯字段；
- `model_call_id`、`credits_used` 等 payload 明确提供的结构化字段。

它不保存 API Key，不重放官方 API，不拿本地计数去覆盖官方账单和 commit 统计。
