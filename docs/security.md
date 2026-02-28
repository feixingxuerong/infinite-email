# Security & Anti-Abuse Guidelines

> **⚠️ 重要声明：本项目仅供个人/团队正规使用，禁止用于垃圾邮件、钓鱼、绕过平台风控等任何滥用行为。**

---

## 1. 限流策略（Rate Limiting）

### 1.1 为什么需要限流？

- 防止恶意用户短时间内大量创建别名
- 保护 Cloudflare Workers 配额和 Email Routing 额度
- 避免被上游服务商标记为滥用源

### 1.2 实现建议

| 场景 | 限制策略 |
|------|----------|
| 同一 IP 创建别名 | 10 次/小时 |
| 同一 IP 创建别名 | 50 次/天 |
| 同一域名别名总数 | 无硬性限制，但建议监控异常 |
| API 调用频率 | 100 次/分钟 |

### 1.3 Cloudflare Workers 实现示例

```typescript
// 简单的内存限流（生产环境建议用 KV）
const RATE_LIMIT_WINDOW = 3600; // 1小时
const RATE_LIMIT_MAX = 10;

async function checkRateLimit(ip: string): Promise<boolean> {
  const key = `ratelimit:${ip}`;
  const count = await RATE_LIMIT_KV.get(key);
  
  if (count && parseInt(count) >= RATE_LIMIT_MAX) {
    return false; // 超过限制
  }
  
  // 原子递增（简化版，实际使用需加锁）
  const newCount = count ? parseInt(count) + 1 : 1;
  await RATE_LIMIT_KV.put(key, newCount.toString(), { expirationTtl: RATE_LIMIT_WINDOW });
  
  return true;
}
```

---

## 2. 别名生成策略（Alias Generation）

### 2.1 别名格式规范

建议采用结构化前缀 + 随机后缀：

```
{服务名}-{日期或随机串}@yourdomain.com
```

示例：
- `amazon-20260228@yourdomain.com`
- `netflix-a7f3@yourdomain.com`
- `github-xy9z@yourdomain.com`

### 2.2 生成算法

```typescript
function generateAlias(service: string, options: {
  useDate?: boolean;
  randomLength?: number;
} = {}): string {
  const { useDate = false, randomLength = 6 } = options;
  
  const dateStr = useDate 
    ? new Date().toISOString().slice(0, 10).replace(/-/g, '')
    : '';
  
  const random = Math.random().toString(36).substring(2, 2 + randomLength);
  
  const parts = [service, dateStr || random].filter(Boolean);
  return parts.join('-');
}
```

### 2.3 别名长度限制

- 总长度：不超过 64 字符（RFC 5321 建议）
- 前缀（服务名）：3-30 字符，仅字母/数字/连字符
- 后缀：4-10 字符，字母+数字

---

## 3. 日志与隐私（Logging & Privacy）

### 3.1 记录的日志

| 数据 | 用途 | 保留时间 |
|------|------|----------|
| 别名创建/撤销操作 | 审计追溯 | 90 天 |
| API 请求 IP（可选） | 限流、安全分析 | 30 天 |
| 别名使用时间戳 | 活跃度分析 | 180 天 |

### 3.2 不记录的内容

- ❌ 邮件内容（仅转发，不解析）
- ❌ 邮件附件
- ❌ 收件人其他邮箱地址
- ❌ 密码或敏感凭证

### 3.3 隐私保护措施

```typescript
// 审计日志示例（不包含敏感信息）
interface AuditLog {
  timestamp: string;
  action: 'create' | 'revoke' | 'query';
  alias: string;
  ip?: string;          // 可选，仅用于限流
  userAgent?: string;   // 可选，用于分析
}

// 禁止记录的内容
const SENSITIVE_FIELDS = ['password', 'token', 'secret', 'body', 'attachments'];
```

### 3.4 数据存储建议

- **D1（推荐）**：SQLite，支持结构化查询
- **KV**：高性能计数器、限流状态
- **R2（可选）**：需要长期存档时的选择

---

## 4. 被滥用Alias的处理（Abuse Handling）

### 4.1 滥用场景识别

| 特征 | 可能表明滥用 |
|------|--------------|
| 同一别名被大量注册 | 机器人批量注册 |
| 别名发送垃圾邮件 | 被用于发件别名 |
| 收到大量举报 | 别名被用于钓鱼 |
| 短时间内创建数千个别名 | 自动化脚本攻击 |

### 4.2 处理措施

#### 4.2.1 立即响应

```typescript
// 吊销被滥用别名
async function revokeAbusedAlias(alias: string, reason: string) {
  await db.prepare(`
    UPDATE aliases 
    SET status = 'revoked', 
        revoked_at = datetime('now'),
        revocation_reason = ?
    WHERE alias = ?
  `).bind(reason, alias);
  
  // 记录到滥用日志
  await addAuditLog({
    action: 'revoke',
    alias: alias,
    reason: reason
  });
}
```

#### 4.2.2 规则层面封禁

```typescript
// 添加拒绝规则
async function addDenyRule(pattern: string) {
  await db.prepare(`
    INSERT INTO rules (type, value, created_at)
    VALUES ('deny_prefix', ?, datetime('now'))
  `).bind(pattern);
}
```

#### 4.2.3 限流强化

```typescript
// 检测到异常时临时提升限流等级
const ABUSE_DETECTION_THRESHOLD = 100; // 1小时内的请求数
const ABUSE_LOCKOUT_DURATION = 3600;    // 锁定1小时

async function detectAndLockAbuse(ip: string): Promise<boolean> {
  const count = await getRequestCount(ip, 3600);
  
  if (count > ABUSE_DETECTION_THRESHOLD) {
    await RATE_LIMIT_KV.put(`lockout:${ip}`, '1', { 
      expirationTtl: ABUSE_LOCKOUT_DURATION 
    });
    return true;
  }
  return false;
}
```

### 4.4 上游举报处理

- **Cloudflare Email Routing 举报**：如收到举报，及时调查并吊销相关别名
- **ISP 退信**：监控退信率，过高时自动暂停相关别名
- **黑名单检查**：定期检查域名是否进入黑名单

---

## 5. 合规声明（Compliance）

### 5.1 使用限制

本项目**明确禁止**用于：

- ❌ 发送垃圾邮件（Spam）
- ❌ 钓鱼攻击（Phishing）
- ❌ 绕过平台风控或验证
- ❌ 批量注册账号（自动化滥用）
- ❌ 任何违法用途

### 5.2 合规建议

1. **仅用于正规收件**：别名用于保护个人隐私、隔离第三方数据泄露
2. **记录审计日志**：至少保留 90 天，以备合规审查
3. **及时响应举报**：建立滥用举报处理流程
4. **定期审查别名**：清理长期不活跃的别名
5. **遵守当地法规**：如 GDPR、CCPA 等数据保护法规

### 5.3 责任声明

- 使用者应对其创建的别名负全部责任
- 项目维护者不对任何滥用行为负责
- 如发现滥用，有权终止服务并上报

---

## 6. 快速检查清单

- [ ] 已配置 IP 限流（10/小时）
- [ ] 别名格式包含服务前缀+随机后缀
- [ ] 审计日志排除敏感字段
- [ ] 保留 90 天日志
- [ ] 实现了别名吊销 API
- [ ] 建立了举报处理流程
- [ ] 在 README 中明确禁止滥用

---

## 参考资料

- [Cloudflare Workers Rate Limiting](https://developers.cloudflare.com/workers/learning/concepts/rate-limiting/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [RFC 5321 - SMTP 协议](https://tools.ietf.org/html/rfc5321)
- [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/)
