# Setup: 域名 + Cloudflare 实现 catch-all（无限别名）

> ⏱️ **快速导航**
> - [最简版（3 步）](#最简版3-步)
> - [详细版（完整步骤）](#详细版完整步骤)
> - [DNS 记录清单](#dns-记录清单)
> - [常见问题排查](#常见问题排查)

---

## ⏩ 最简版（3 步）

如果你只想最快用起来，看这 3 步：

1. **买域名** → 选一个你喜欢的域名服务商购买
2. **托管到 Cloudflare** → 把域名的 NS 改成 Cloudflare 提供的两个地址
3. **开启 Email Routing** → 
   - Cloudflare Dashboard → Email → Email Routing → Enable
   - 添加你的真实邮箱（比如 Gmail）作为 Destination 并验证
   - 开启 **Catch-all address**

完成！`任意别名@你的域名.com` 都会转发到你的真实邮箱。

---

## 📖 详细版（完整步骤）

### 0. 前置准备

- 一个你拥有并可管理 DNS 的域名
- 一个真实收件邮箱（Gmail/Outlook/Fastmail/企业邮箱）
- Cloudflare 账号

### 1. 购买域名

可选服务商（推荐）：
- Namesilo（便宜、稳定）
- Cloudflare Registrar（直接在 Cloudflare 买，管理最方便）
- Gandi、Namecheap

### 2. 把域名托管到 Cloudflare

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击「添加站点」→ 输入你的域名
3. 选择免费计划（Personal 免费）
4. **重要**：按提示把域名 NS 记录改到 Cloudflare 提供的两个地址：
   - `ns1.cloudflare.com`
   - `ns2.cloudflare.com`
5. 等待生效（通常 5-30 分钟，复杂域名可能 24-48 小时）

> 💡 **验证 NS 生效**：`whois 你的域名.com` 或使用 https://www.whatsmydns.net 查看 NS 是否已更新

### 3. 开启 Cloudflare Email Routing

1. Cloudflare Dashboard → **Email** → **Email Routing**
2. 选择你的域名 → 点击 **Enable Email Routing**
3. **添加 Destination address**（你的真实收件邮箱）
   - 输入你的邮箱地址（比如 `yourname@gmail.com`）
   - 点击发送验证码
   - 去真实邮箱收验证邮件，输入验证码完成验证
4. **开启 Catch-all address**
   - 点击「创建 Catch-all」
   - 选择转发到已验证的 Destination address

### 4. 测试 Catch-all

用任意邮箱给 `test123@你的域名.com` 发邮件，应该能收到转发。

---

## 📋 DNS 记录清单

配置完 Email Routing 后，你的 DNS 应该有以下记录：

### MX 记录（邮件接收）

Cloudflare Email Routing 会自动添加，**通常不需要手动配置**：

| 类型 | 名称 | 优先级 | 值 |
|------|------|--------|-----|
| MX | @ (或留空) | 10 | `inbound-smtp.us-west-2.amazonaws.com`（或你所在区域的地址）|

> ⚠️ Cloudflare Email Routing 使用 AWS SES 作为底层，实际 MX 记录由 Cloudflare 自动管理。**不要手动添加 MX**，否则可能冲突。

### SPF 记录（发件授权）

**强烈建议添加**，防止你发出的邮件被识别为垃圾邮件：

| 类型 | 名称 | 值 |
|------|------|-----|
| TXT | @ | `v=spf1 include:_spf.cloudflare.com ~all` |

如果你的域名已经有其他 SPF 记录（比如发件服务商），可以合并：
```
v=spf1 include:_spf.google.com include:_spf.cloudflare.com ~all
```

### DKIM 记录（邮件签名）

Cloudflare Email Routing **不支持自定义 DKIM**，因为它只负责转发（收件），不负责签名（发件）。

如果你需要**用自己的域名发件**（比如用 Gmail/Outlook 发送显示为 @yourdomain.com），需要在对应服务商那里获取 DKIM 记录添加。

### DMARC 记录（策略声明）

建议添加，防止域名被滥用发垃圾邮件：

| 类型 | 名称 | 值 |
|------|------|-----|
| TXT | _dmarc | `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@yourdomain.com` |

- `p=quarantine` = 可疑邮件标记为垃圾邮件（推荐）
- `p=reject` = 直接拒绝可疑邮件（严格，可能误伤）
- `rua` = 聚合报告接收地址（可选）

---

## 🔧 常见问题排查

### Q1: 邮件收不到

**检查步骤**：
1. 确认 Catch-all 已开启（Email Routing 仪表板状态为 Active）
2. 检查 Destination address 已验证 ✓
3. 查看 Cloudflare Email Routing 的「Email Activity」日志
4. 检查垃圾邮件文件夹
5. 确认你的真实邮箱没有设置过滤规则拦截

### Q2: Cloudflare 提示域名不在 Cloudflare

- 确保 NS 记录已正确修改
- 等待生效（可能需要 5 分钟-24 小时）
- 在 Cloudflare 刷新页面

### Q3: Destination 邮箱收不到验证邮件

- 检查垃圾邮件文件夹
- 确认邮箱地址拼写正确
- 尝试换一个邮箱作为 Destination

### Q4: MX 记录冲突

- **不要手动添加 MX 记录**，Cloudflare Email Routing 会自动配置
- 如果之前有旧的 MX 记录，删除它

### Q5: 发件被识别为垃圾邮件

- 添加 SPF 记录
- 如需自定义 DKIM，在发件服务商（ Gmail / SendGrid / AWS SES 等）获取记录并添加
- 添加 DMARC 记录

### Q6: 域名转移后 Email Routing 失效

- 确认域名 NS 已指向 Cloudflare
- 重新启用 Email Routing

---

## 🛡️ 安全建议

1. **启用双因素认证** - 保护 Cloudflare 账号
2. **定期查看邮件活动日志** - 监控异常收件
3. **DMARC 报告** - 定期检查 rua 收到的报告，了解邮件发送情况

---

## 📚 进阶：规则化管理（Workers）

Cloudflare Email Routing 负责收件转发。
Workers 负责：
- 生成别名（比如一次性别名）
- 管理 allow/deny 列表
- 记录使用审计（KV/D1）

见 docs/worker-design.md。
