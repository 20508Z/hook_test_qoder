# Qoder Hook 威胁模型

核心资产是 HMAC key、伪匿名 ID、事件关联和本地 spool 可用性。正文、Prompt、回复、命令正文、输出、错误和 diff patch 不属于持久化资产。

| 风险 | 当前控制 |
| --- | --- |
| 正文泄露 | schema 无正文字段；写前敏感 guard；错误不回显 |
| 标识/路径反查 | HMAC，不保存原值 |
| 员工跨设备错配 | 企业端预生成稳定伪匿名 ID |
| usage 重复/缺失 | 按 `model_call_id` 去重；缺失保留为 `null` |
| Hook 阻塞 Qoder | 有界 stdin、短 timeout、fail-open、无网络 |
| spool 增长/损坏 | 幂等、并发锁和结构化错误；企业部署前仍需补保留期与轮转 |
| workspace 越界 | `realpath` / symlink 检查 |
| 人工归因误判 | 只保留候选证据，不包装成事实 |
| push 伪成功 | 本地事件明确标记 `local_remote_tracking_ref`；企业统计以后端 Git 事实为准 |

不得在法律、隐私、RBAC、审计、保留删除和密钥管理未完成前采集员工数据。
