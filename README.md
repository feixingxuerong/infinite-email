# infinite-email

目标：用 **自有域名** + **Cloudflare** 实现「无限邮箱」体验：

- 绑定域名后，支持 `anything@yourdomain.com` 这种 **catch-all** 收件（无限别名）
- 可选：用 **Cloudflare Workers** 做更精细的路由规则（白名单/黑名单、一次性别名、前缀规则、速率限制、记录审计）

> 合规提示：本项目只用于个人/团队的正规收件、隔离第三方注册、减少隐私泄露。
> 禁止用于垃圾邮件、钓鱼、绕过平台风控等。

## 推荐架构（简单可靠）

### A. 最简（90% 需求）
- Cloudflare **Email Routing**：
  - 开启 catch-all（接住任意别名）
  - 转发到你的真实邮箱（Gmail/Outlook/Fastmail 等）

优点：基本不需要代码，成本低、稳定。

### B. 进阶（加 Workers）
- Cloudflare Email Routing 负责收件
- Cloudflare Workers：
  - 管理别名规则（允许/拒绝/一次性）
  - 生成/撤销别名
  - 记录审计日志（KV/D1）

注意：Cloudflare 的入站邮件路由能力以 Email Routing 为主，Workers 更适合做 **规则管理与配套服务**。

## 交付清单

- [ ] docs/setup.md：从买域名到 Cloudflare 开通 Email Routing 的完整步骤
- [ ] worker/：Workers 代码（别名管理 API + 规则引擎）
- [ ] infra/：可选 IaC（Wrangler config、示例 secrets）
- [ ] docs/security.md：反滥用/限流/可观测性建议

## 需要你做的决策（最少）

1) 你想用的域名（或让我给出 3 个可用备选）
2) 转发到哪个“真实收件箱”（一个或多个）

其余我都可以自动化准备好。