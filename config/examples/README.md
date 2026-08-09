# Qoder Hook merge fragment

`qoder.settings.fragment.json` 只启用 `PreToolUse`、`PostToolUse` 和 `PostToolUseFailure`。它是 merge fragment，不是完整 settings；安装时要保留现有配置、避免重复命令，并原子写入。

命令只通过 DPAPI wrapper 注入 HMAC key。没有 content key、正文模式或解密命令。fragment 通过非敏感的 `qoder-attribution-v1` pipe 名称把 Hook signal 送给受管 companion；companion 必须由管理员 launcher 在对应 workspace 启动。

启动 companion 的示例：

```powershell
qoder-diff-companion --workspace "<WORKSPACE>" --pipe qoder-attribution-v1 --spool-dir "<SPOOL_DIR>/qoder" --health-file "<SPOOL_DIR>/qoder/companion-health.json"
```

企业部署时还应由管理员 launcher 注入 `QODER_ENTERPRISE_USER_HMAC`。它必须是企业后台为员工预生成的 64 位小写十六进制伪匿名 ID，不能直接填写工号、邮箱或姓名。fragment 不硬编码该值，以免身份进入 settings 文件或进程命令行。
