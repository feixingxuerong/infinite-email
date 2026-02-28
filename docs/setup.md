# Setup: 域名 + Cloudflare 实现 catch-all（无限别名）

## 0. 前置

- 一个你拥有并可管理 DNS 的域名
- 一个真实收件邮箱（Gmail/Outlook/Fastmail/企业邮箱）
- Cloudflare 账号
- Wrangler CLI (`npm install -g wrangler`)

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

### 3.1 初始化 D1 数据库

```bash
cd worker

# 创建 D1 数据库
wrangler d1 create infinite_email

# 把 database_id 填入 wrangler.toml

# 运行 migrations（创建表）
wrangler d1 migrations apply infinite-email
```

### 3.2 配置环境变量

在 Cloudflare Dashboard → Workers → infinite-email → Settings → Variables 添加：

- `DOMAIN`: 你的域名（如 `example.com`）
- `ADMIN_TOKEN`: 管理 API 的密钥（请使用强随机字符串）

### 3.3 部署 Worker

```bash
wrangler deploy
```

### 3.4 API 使用方法

所有 API 需要在请求头中添加 `X-Admin-Token` 进行认证。

```bash
TOKEN="你的ADMIN_TOKEN"

# 创建别名
curl -X POST https://your-worker.subdomain.workers.dev/api/aliases \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $TOKEN" \
  -d '{"prefix": "amazon", "note": "用于亚马逊注册"}'

# 查询所有别名
curl https://your-worker.subdomain.workers.dev/api/aliases \
  -H "X-Admin-Token: $TOKEN"

# 吊销别名
curl -X DELETE https://your-worker.subdomain.workers.dev/api/aliases/amazon-20260228-abc123 \
  -H "X-Admin-Token: $TOKEN"

# 创建规则
curl -X POST https://your-worker.subdomain.workers.dev/api/rules \
  -H "Content-Type: application/json" \
  -H "X-Admin-Token: $TOKEN" \
  -d '{"type": "deny_prefix", "value": "spam"}'

# 查询规则
curl https://your-worker.subdomain.workers.dev/api/rules \
  -H "X-Admin-Token: $TOKEN"

# 查看审计日志
curl https://your-worker.subdomain.workers.dev/api/audit?limit=20 \
  -H "X-Admin-Token: $TOKEN"
```

### 3.5 规则类型说明

| 类型 | 说明 | 示例 |
|------|------|------|
| `allow_prefix` | 允许此前缀的别名 | `allow_prefix: "amazon"` 允许 `amazon-xxx` |
| `deny_prefix` | 拒绝此前缀的别名 | `deny_prefix: "spam"` 拒绝 `spam-xxx` |
| `allow_exact` | 精确允许 | `allow_exact: "newsletter"` |
| `deny_exact` | 精确拒绝 | `deny_exact: "unsubscribe"` |

### 3.6 本地开发

```bash
# 启动本地 Worker（会自动创建本地 D1）
wrangler dev

# 运行 migration（本地）
wrangler d1 migrations apply infinite-email --local
```

## 4. 与 Email Routing 的关系

- Email Routing 负责邮件转发
- Worker 负责别名生成、规则管理、审计日志
- 通过管理面板启用/禁用某些别名（将滥用 alias 加入 deny）

## 5. 安全注意

- `ADMIN_TOKEN` 必须保密，不要提交到 GitHub
- 生产环境使用 Cloudflare Secrets: `wrangler secret put ADMIN_TOKEN`
