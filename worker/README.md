# s3man-proxy — Cloudflare Worker 部署指南

S3 反向代理，支持 B2 / R2 / AWS S3 / 任意 S3 兼容存储。

## 特性

- **零流量费用** — Cloudflare 出站流量免费，B2 回源流量通过带宽联盟免费
- **干净分享链接** — `https://proxy.example.com/b2/bucket/image.png`（无凭证暴露）
- **多存储商** — 一个 Worker 服务所有 S3 提供商，无需为每个配置环境变量
- **CDN 缓存** — GET 请求自动缓存（客户端 1h / 边缘 24h）

## 前置要求

- [Node.js](https://nodejs.org/) >= 18
- Cloudflare 账号（免费计划即可）

## 1. 安装 Wrangler

```bash
npm install -g wrangler
```

## 2. 登录 Cloudflare

```bash
wrangler login
```

浏览器会弹出授权页面，确认即可。

## 3. 创建 KV 命名空间

```bash
cd worker
wrangler kv namespace create S3_CONFIGS
```

命令输出类似：

```
⛅ Created namespace "s3man-proxy-S3_CONFIGS" with id "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

复制 `id` 值，填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "S3_CONFIGS"
id = "这里粘贴你的 KV namespace id"
```

## 4. 部署 Worker

```bash
wrangler deploy
```

部署成功后会显示 Worker URL，类似：

```
https://s3man-proxy.<你的子域>.workers.dev
```

## 5. 设置 AUTH_TOKEN

```bash
wrangler secret put AUTH_TOKEN
```

输入一个自定义的密码/Token（如 `mySecretToken123`），用于：

- App 内部的代理请求鉴权
- 管理 API（注册/删除别名）的鉴权

> ⚠️ 请使用强密码，不要使用简单字符串。

## 6.（可选）绑定自定义域名

编辑 `wrangler.toml`，取消注释并修改：

```toml
routes = [
  { pattern = "files.yourdomain.com", custom_domain = true }
]
```

然后重新部署：

```bash
wrangler deploy
```

Cloudflare 会自动配置 DNS 和 SSL 证书。

## 7. App 端配置

在 s3man App 的连接设置（Settings → Connections）中：

| 字段            | 说明                       | 示例                           |
| --------------- | -------------------------- | ------------------------------ |
| **Proxy URL**   | Worker 的 URL              | `https://files.yourdomain.com` |
| **Proxy Token** | 步骤 5 中设置的 AUTH_TOKEN | `mySecretToken123`             |
| **Proxy Alias** | 分享链接的短别名           | `b2`                           |

保存后，App 会自动将 S3 配置注册到 Worker KV。

## 两种访问模式

### 模式 1：App 内部请求（需鉴权）

用于 Image/Video 组件预览和 fetch 下载，凭证随请求传递：

```
GET /{bucket}/{key}?token=AUTH_TOKEN&s3cfg=<base64url>
```

或通过请求头传递：

```
GET /{bucket}/{key}
Headers:
  Authorization: Bearer AUTH_TOKEN
  X-S3-Endpoint: https://s3.us-west-004.backblazeb2.com
  X-S3-Region: us-west-004
  X-S3-Access-Key: your-access-key
  X-S3-Secret-Key: your-secret-key
```

### 模式 2：分享链接（免鉴权）

S3 配置已存储在 KV 中，通过别名访问：

```
GET /{alias}/{bucket}/{key}
```

示例：`https://files.yourdomain.com/b2/my-bucket/photos/cat.jpg`

## 管理 API

需要 AUTH_TOKEN 鉴权。

### 注册别名

```bash
curl -X PUT https://files.yourdomain.com/api/configs/b2 \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://s3.us-west-004.backblazeb2.com",
    "region": "us-west-004",
    "accessKey": "your-access-key",
    "secretKey": "your-secret-key"
  }'
```

> App 保存连接时会自动调用此 API，通常无需手动操作。

### 删除别名

```bash
curl -X DELETE https://files.yourdomain.com/api/configs/b2 \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"
```

## 免费额度

| 资源        | 免费额度      | 说明                    |
| ----------- | ------------- | ----------------------- |
| Worker 请求 | 100,000 次/天 | 每次文件访问 = 1 次请求 |
| KV 读取     | 100,000 次/天 | 每次别名访问 = 1 次读取 |
| KV 写入     | 1,000 次/天   | 仅注册/更新别名时消耗   |
| KV 存储     | 1 GB          | 每个别名 ~200 字节      |
| 出站流量    | **无限**      | 传多大文件都免费        |

个人和小团队使用完全在免费额度内。

## 故障排查

### Worker 返回 401 Unauthorized

- 检查 App 中的 Proxy Token 是否与 `wrangler secret put AUTH_TOKEN` 设置的一致

### Worker 返回 404 Unknown alias

- 检查 Proxy Alias 是否已填写并保存
- 在 App 中重新保存连接以触发别名注册

### 分享链接无法访问

- 确认别名已注册（保存连接时自动注册）
- 确认 S3 存储桶策略允许读取

### 查看实时日志

```bash
wrangler tail
```
