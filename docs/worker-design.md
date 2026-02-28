# Worker Design（别名管理与规则引擎）

## 目标

- 提供一个管理 API：创建/吊销/查询别名
- 规则引擎：决定某个 alias 是否允许（allow/deny/temporary）
- 反滥用：速率限制、审计日志

## 数据模型（建议）

使用 Cloudflare D1（SQLite）或 KV。

### aliases
- alias: string（例如 `amazon-202602@domain.com` 的 local-part `amazon-202602`）
- status: active|revoked
- created_at
- note

### rules
- type: allow_prefix | deny_prefix | allow_exact | deny_exact
- value
- created_at

### audit
- ts
- alias
- action
- ip（如果有）

## API（示例）

- `POST /api/aliases` → 创建别名
- `DELETE /api/aliases/:alias` → 吊销
- `GET /api/aliases` → 列表
- `POST /api/rules` → 新增规则

## 与 Email Routing 的关系

Email Routing 负责邮件转发。
Worker 不一定能直接拦截入站邮件（取决于 Cloudflare 产品能力），但可以：
- 通过管理面板来启用/禁用某些别名（例如把被滥用 alias 规则加入 deny）
- 生成规范化 alias，让你在注册时使用

如果需要“入站实时拦截/改写”，需要进一步确认 Cloudflare Email Workers 支持程度。