# Security Policy (安全策略)

## Supported Versions (支持的版本)

目前我们优先维护当前开发分支及生产环境部署的版本。

| Version | Supported          |
| ------- | ------------------ |
| Main    | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability (报告漏洞)

我们非常重视 **checkin-app** 的安全性。如果您发现任何可能影响住户隐私、Passkey 认证安全或服务器稳定性的漏洞，请按照以下流程操作：

1. **请勿直接公开：** 请不要在 GitHub Issue 中公开披露安全漏洞。
2. **私下联系：** 请通过邮件联系开发者或通过 Telegram 私信反馈。
   - **Email:** github@ox.ci
3. **响应时间：** 我们会在收到报告后的 48 小时内给予初步答复，并视问题的严重程度提供后续的修复计划。

## Security Precautions (安全注意事项)

针对本项目，请开发者注意：
- **环境变量：** 严禁将 `.env` 文件提交至 Git 仓库。请确保 `server/.env.development` 已被加入 `.gitignore`。
- **Passkey 认证：** 任何涉及 `WebAuthn` 逻辑的修改需经过严格测试，确保 `challenge` 和 `origin` 的校验逻辑正确。
- **敏感信息：** 鉴于应用涉及客人的护照信息和入住记录，在传输和存储过程中均需要经过加密。

## Disclosure Policy (披露政策)

一旦漏洞被修复，我们会根据实际情况在版本更新说明（Release Notes）中提及修复内容，但在确认所有受影响实例均已更新前，不会披露漏洞细节。
