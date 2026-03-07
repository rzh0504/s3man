# S3Man

一个跨平台的 S3 对象存储管理客户端，支持 iOS、Android 和 Web。基于 React Native + Expo 构建。

## 功能

- 多连接管理 -- 同时管理多个 S3 兼容存储服务
- 支持主流服务商 -- Cloudflare R2、Backblaze B2、Amazon S3 及任何 S3 兼容服务
- 文件浏览 -- 文件夹导航、面包屑路径、图片缩略图预览
- 文件操作 -- 上传、下载、删除文件/文件夹，支持批量操作
- 文件预览 -- 图片缩放查看、视频播放、代码/文本高亮、PDF 浏览器打开
- 传输管理 -- 实时进度展示，支持暂停/取消
- 分享上传 -- 从系统分享菜单直接上传文件到指定存储桶
- 链接分享 -- 生成预签名 URL 或通过 Worker 代理生成短链接
- 存储桶管理 -- 创建/删除存储桶，按连接分组展示
- 深色模式 -- 跟随系统或手动切换
- 多语言 -- 中文 / English
- Cloudflare Worker 代理 -- 可选部署，用于加速访问和生成自定义域名链接

## 截图

|                                 存储桶列表                                 |                                文件浏览                                |                                  文件预览                                  |
| :------------------------------------------------------------------------: | :--------------------------------------------------------------------: | :------------------------------------------------------------------------: |
| ![buckets](https://s3.hi168.com/hi168-25959-33617kcp/s3man/bucketlist.jpg) | ![files](https://s3.hi168.com/hi168-25959-33617kcp/s3man/filelist.jpg) | ![preview](https://s3.hi168.com/hi168-25959-33617kcp/s3man/previewimg.jpg) |


## 技术栈

- [Expo](https://expo.dev/) + [React Native](https://reactnative.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction/) -- 文件系统路由
- [Zustand](https://zustand.docs.pmnd.rs/) -- 状态管理
- [AWS SDK v3](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/) -- S3 操作
- [Reanimated](https://docs.swmansion.com/react-native-reanimated/) -- 动画
- [Tailwind CSS](https://tailwindcss.com/) + [Uniwind](https://uniwind.dev/) -- 样式
- [Cloudflare Workers](https://workers.cloudflare.com/) -- 可选代理服务

## 开始使用

### 环境要求

- Node.js >= 18
- pnpm（推荐）

### 安装

```bash
git clone https://github.com/your-username/s3man.git
cd s3man
pnpm install
```

### 开发

```bash
pnpm dev
```

启动后按提示选择平台：

- `i` -- iOS 模拟器（仅 macOS）
- `a` -- Android 模拟器
- `w` -- 浏览器

### 构建

```bash
# Android APK（预览版）
eas build --platform android --profile preview

# iOS / Android 生产版
eas build --platform all --profile production
```

## Worker 代理（可选）

项目包含一个 Cloudflare Worker 代理服务（`worker/` 目录），用于：

- 隐藏 S3 凭证，通过自定义域名访问文件
- 生成简短的分享链接

部署方式：

```bash
cd worker
pnpm install
npx wrangler deploy
```

详见 [worker/README.md](worker/README.md)。

## 项目结构

```
app/                  # 页面路由
  (tabs)/             # 底部 Tab 页面（存储桶、传输、设置）
  bucket/             # 文件浏览页
components/           # 通用组件
  ui/                 # 基础 UI 组件
lib/                  # 核心逻辑
  stores/             # Zustand 状态管理
  i18n/               # 国际化
  s3-service.ts       # S3 操作封装
  types.ts            # 类型定义
worker/               # Cloudflare Worker 代理
```

## 许可证

MIT
