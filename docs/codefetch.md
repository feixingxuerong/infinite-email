# Codefetch - 本地验证码抓取 CLI 工具

> 通过 IMAP 读取邮箱，快速获取 6/8 位验证码和验证链接

## 功能特性

- **轻量级**：仅使用 `imap` + `mailparser` 两个核心依赖
- **多服务商支持**：支持 Gmail、Fastmail、Outlook 等所有 IMAP 协议邮箱
- **智能解析**：自动识别 6/8 位验证码和验证链接
- **灵活搜索**：支持按服务/别名筛选最近 N 封邮件

## 快速开始

### 1. 安装依赖

```bash
cd tools/codefetch
npm install
```

### 2. 配置 IMAP

复制 `.env.local.example` 为 `.env.local`，填入你的 IMAP 凭证：

```bash
cp .env.local.example .env.local
```

### 3. 使用

```bash
# 搜索最近 50 封邮件中的验证码
npm start

# 按服务筛选（如 Google、Amazon）
npm start -- --service google
npm start -- --service amazon

# 搜索最近 20 封邮件
npm start -- --limit 20

# 输出包含验证链接
npm start -- --links

# 静默模式（只输出验证码）
npm start -- --quiet
```

## 配置说明

### 环境变量

| 变量 | 必填 | 说明 | 示例 |
|------|------|------|------|
| IMAP_HOST | 是 | IMAP 服务器地址 | `imap.gmail.com` |
| IMAP_PORT | 否 | IMAP 端口，默认 `993` | `993` |
| IMAP_USER | 是 | 邮箱地址 | `your-email@gmail.com` |
| IMAP_PASS | 是 | App Password 或邮箱密码 | `xxxx xxxx xxxx xxxx` |
| IMAP_TLS | 否 | 是否使用 TLS，默认 `true` | `true` |

---

## 各邮箱服务商 IMAP 设置

### Gmail

#### 1. 开启 IMAP 访问

1. 打开 [Gmail 设置](https://mail.google.com/mail/u/0/#settings)
2. 转到 **转发和 POP/IMAP** 选项卡
3. 选择 **启用 IMAP**

#### 2. 生成 App Password

> 注意：Gmail 已不再支持直接使用邮箱密码登录 IMAP，必须使用 App Password

1. 打开 [Google 账号安全页面](https://myaccount.google.com/signinprintouts)
2. 如未开启两步验证，先 **开启两步验证**
3. 搜索「应用密码」或访问 [应用密码页面](https://myaccount.google.com/apppasswords)
4. 生成新的应用密码：
   - 选择应用：**邮件**
   - 选择设备：**Windows 计算机**（或自定义名称）
5. 复制生成的 16 位密码

#### 3. 配置

```bash
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=your-email@gmail.com
IMAP_PASS=xxxx xxxx xxxx xxxx  # 生成的 App Password
```

---

### Fastmail

#### 1. 开启 IMAP 访问

1. 登录 [Fastmail 设置](https://www.fastmail.com/settings/)
2. 转到 **Password & Security** → **App passwords**
3. 点击 **Create app password**
4. 选择 **IMAP** 并创建密码

#### 2. 配置

```bash
IMAP_HOST=imap.fastmail.com
IMAP_PORT=993
IMAP_USER=your-email@fastmail.com
IMAP_PASS=your-app-password
```

#### 或使用别名格式

```bash
IMAP_USER=your-alias@fastmail.com
```

---

### Outlook (Hotmail)

#### 1. 开启 IMAP 访问

Outlook 默认开启 IMAP，但可能需要：

1. 登录 [Outlook 账户](https://outlook.live.com/mail/options)
2. 转到 **邮件** → **同步电子邮件**
3. 确认 **IMAP** 已启用

#### 2. 生成 App Password（如开启了两步验证）

1. 访问 [Microsoft 账号安全页面](https://account.microsoft.com/security)
2. 找到 **密码** 部分，选择 **了解详细信息**
3. 在「两步验证」下，开启两步验证
4. 创建应用密码：
   - 访问 [应用密码页面](https://account.microsoft.com/security/mfa-services)
   - 点击「创建新的应用密码」

#### 3. 配置

```bash
IMAP_HOST=outlook.office365.com
IMAP_PORT=993
IMAP_USER=your-email@outlook.com
IMAP_PASS=your-password-or-app-password
```

---

### 其他服务商

| 服务商 | IMAP Host | 端口 |
|--------|-----------|------|
| iCloud | `imap.mail.me.com` | 993 |
| Yahoo | `imap.mail.yahoo.com` | 993 |
| ProtonMail | `127.0.0.1` (需要 Bridge) | 1143 |
| QQ 邮箱 | `imap.qq.com` | 993 |
| 网易邮箱 | `imap.163.com` | 993 |

---

## 使用示例

### 基本用法

```bash
# 获取所有验证码
$ npm start
Code: 123456
Subject: Verify your Google account
Date: 2026-02-28
---
Code: 789012
Subject: Amazon: Your verification code
Date: 2026-02-27
---

# 按服务筛选
$ npm start -- --service amazon
Code: 456789
Subject: Amazon: Sign-in verification
Date: 2026-02-28
---

# 只输出验证码（适合脚本）
$ npm start -- --quiet
123456
789012
```

### 集成到脚本

```bash
#!/bin/bash
# 获取最新验证码
CODE=$(npm start -- --quiet | head -1)
echo "Latest code: $CODE"
```

---

## 注意事项

1. **安全**：`.env.local` 包含敏感信息，请勿提交到 Git
2. **频率**：IMAP 请求有频率限制，勿频繁调用
3. **隐私**：验证码仅本地处理，不上传任何服务器
4. **App Password**：大多数现代邮箱需要使用 App Password 而非登录密码

---

## 依赖说明

| 依赖 | 用途 |
|------|------|
| `imap` | IMAP 协议客户端（轻量） |
| `mailparser` | 邮件解析（支持 plain text + HTML） |
| `dotenv` | 环境变量加载 |
| `yargs` | CLI 参数解析 |
