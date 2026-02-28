# Setup: 域名 + Cloudflare 实现 catch-all（无限别名）

## 0. 前置

- 一个你拥有并可管理 DNS 的域名
- 一个真实收件邮箱（Gmail/Outlook/Fastmail/企业邮箱）
- Cloudflare 账号

## 1. 把域名托管到 Cloudflare

1. 在 Cloudflare 添加站点
2. 按提示把域名 NS 改到 Cloudflare
3. 等待生效（通常 5-30 分钟）

## 2. 开启 Cloudflare Email Routing

1. Cloudflare Dashboard → Email → Email Routing
2. 选择你的域名 → Enable
3. 添加 Destination address（你的真实邮箱）并完成验证
4. 打开 Catch-all address（接住所有未匹配的别名）

现在你就拥有了：
- 任意别名 `anything@yourdomain.com` 都能被转发到真实邮箱

## 3. 进阶：规则化管理（Workers）

Cloudflare Email Routing 负责收件转发。
Workers 负责：
- 生成别名（比如一次性别名）
- 管理 allow/deny 列表
- 记录使用审计（KV/D1）

见 docs/worker-design.md。