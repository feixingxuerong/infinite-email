# Codefetch

本地验证码抓取 CLI 工具 - 通过 IMAP 快速获取邮箱验证码

## 安装

```bash
cd tools/codefetch
npm install
```

## 配置

1. 复制 `.env.local.example` 为 `.env.local`
2. 填入 IMAP 配置（详见 `../../docs/codefetch.md`）

## 使用

```bash
# 基本用法
npm start

# 按服务筛选
npm start -- --service google

# 搜索最近 20 封邮件
npm start -- --limit 20

# 输出包含验证链接
npm start -- --links
```

## 详细文档

详见 `../../docs/codefetch.md`
