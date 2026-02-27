# S3Man — S3 文件管理器 实现文档

## 1. 项目概述

S3Man 是一个基于 Expo SDK 55 + React Native Reusables (Uniwind) 构建的跨平台 S3 文件管理器应用。
用户可以配置 S3 凭据连接到兼容 S3 的存储服务，浏览 Bucket 列表、管理对象文件、并监控上传/下载传输进度。

### 设计原型（4屏）

| 屏幕 | 名称              | 描述                                                                  |
| ---- | ----------------- | --------------------------------------------------------------------- |
| 01   | Connection Config | S3 凭据配置（Endpoint URL、Access Key ID、Secret Access Key、Region） |
| 02   | Bucket Index      | Bucket 列表浏览、筛选、创建                                           |
| 03   | Object Browser    | 对象浏览器（文件夹导航、文件选择、上传/下载）                         |
| 04   | Transfer Monitor  | 传输监控（上传/下载进度、暂停/恢复/取消）                             |

---

## 2. 技术栈

| 项目      | 选型                                     |
| --------- | ---------------------------------------- |
| Framework | Expo SDK 55 (expo ~55)                   |
| Router    | expo-router v4                           |
| Styling   | Uniwind (Tailwind CSS v4 for RN)         |
| UI 组件   | React Native Reusables (shadcn/ui style) |
| 状态管理  | Zustand v5                               |
| S3 客户端 | @aws-sdk/client-s3 (v3)                  |
| 安全存储  | expo-secure-store                        |
| 文件系统  | expo-file-system                         |
| 文件选择  | expo-document-picker                     |
| 动画      | react-native-reanimated                  |
| 图标      | lucide-react-native                      |

---

## 3. 路由结构

```
app/
  _layout.tsx              ← Root Layout (ThemeProvider + PortalHost)
  (tabs)/
    _layout.tsx            ← Tab Navigator (3 tabs: Index, Transfer, Config)
    index.tsx              ← Bucket Index 列表 (Tab 1)
    transfers.tsx          ← Transfer Monitor (Tab 2)
    config.tsx             ← Connection Config (Tab 3)
  bucket/
    [name].tsx             ← Object Browser (Stack push from bucket list)
```

### 导航流程

1. 用户首次启动 → Config Tab → 输入 S3 凭据 → "Establish Uplink"
2. 连接成功 → 自动切换到 Index Tab → 显示 Bucket 列表
3. 点击 Bucket → Push 到 `bucket/[name]` 页面 → Object Browser
4. Object Browser 支持文件夹导航、文件选择、上传/下载
5. Transfer Tab → 查看所有传输任务的进度

---

## 4. 使用的 React Native Reusables 组件

| 组件                  | 用途                                                         |
| --------------------- | ------------------------------------------------------------ |
| **Button**            | 所有按钮（Establish Uplink, Create Bucket, Pull, Upload 等） |
| **Text**              | 所有文本显示                                                 |
| **Icon**              | Lucide 图标封装                                              |
| **Card**              | Bucket 列表卡片、Transfer 任务卡片                           |
| **Input**             | 表单输入（Endpoint, Key, Secret, Region）                    |
| **Label**             | 表单标签                                                     |
| **Separator**         | 列表分隔线                                                   |
| **Badge**             | 状态徽章（ONLINE, Region tags, Limit Reached）               |
| **Progress**          | 传输进度条                                                   |
| **Dialog**            | 创建 Bucket 对话框、确认删除对话框                           |
| **Alert Dialog**      | 危险操作确认                                                 |
| **Checkbox**          | 对象选择复选框                                               |
| **Tabs (Primitives)** | Transfer Monitor 的 All/Uploading/Downloading/Completed 切换 |
| **Select**            | Region 选择器                                                |
| **Switch**            | 设置开关                                                     |
| **Tooltip**           | 操作提示                                                     |

### 需要通过 CLI 添加的组件

```bash
npx @react-native-reusables/cli@latest add card input label separator badge progress dialog alert-dialog checkbox select switch tabs
```

---

## 5. 数据层设计

### 5.1 类型定义 (`lib/types.ts`)

```typescript
// S3 连接配置
interface S3Config {
  endpointUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

// Bucket 信息
interface BucketInfo {
  name: string;
  creationDate: Date;
  region?: string;
}

// S3 对象
interface S3Object {
  key: string;
  size?: number;
  lastModified?: Date;
  isFolder: boolean;
}

// 传输任务
interface TransferTask {
  id: string;
  fileName: string;
  type: 'upload' | 'download';
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
  progress: number; // 0-100
  totalBytes: number;
  transferredBytes: number;
  bucket: string;
  key: string;
  localPath?: string;
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}
```

### 5.2 Zustand Store (`lib/stores/`)

#### `connection-store.ts`

- S3Config 持久化到 SecureStore
- 连接状态 (disconnected | connecting | connected | error)
- S3Client 实例管理

#### `bucket-store.ts`

- Bucket 列表
- 刷新/加载状态
- 筛选（region filter）

#### `object-store.ts`

- 当前路径
- 对象列表
- 选中对象集合
- 面包屑导航

#### `transfer-store.ts`

- 传输任务列表
- 添加/暂停/恢复/取消任务
- 进度更新

### 5.3 S3 服务 (`lib/s3-service.ts`)

封装 @aws-sdk/client-s3 操作：

- `testConnection()` - 测试连接
- `listBuckets()` - 列出全部 Bucket
- `createBucket(name, region)` - 创建 Bucket
- `listObjects(bucket, prefix)` - 列出对象
- `uploadObject(bucket, key, file)` - 上传
- `downloadObject(bucket, key)` - 下载
- `deleteObjects(bucket, keys)` - 删除

---

## 6. 屏幕实现详细设计

### 6.1 Connection Config (`(tabs)/config.tsx`)

**UI 布局：**

- 顶部：状态指示器（ONLINE/OFFLINE + region 信息）
- 标题："Uplink Configuration"
- 副标题说明文字
- 表单字段：
  - Endpoint URL (带 `https://` 前缀标签)
  - Access Key ID
  - Secret Access Key (密码输入 + 显示/隐藏切换)
  - Region (Select 下拉选择)
- 底部：
  - "Establish Uplink" 主按钮
  - "Import Profile" / "Help Center" 链接

**交互逻辑：**

1. 从 SecureStore 加载已保存的配置
2. 输入凭据 → 点击 "Establish Uplink"
3. 显示 loading → 调用 `testConnection()`
4. 成功 → 保存配置到 SecureStore → 更新连接状态 → 切换到 Index Tab
5. 失败 → 显示错误提示

### 6.2 Bucket Index (`(tabs)/index.tsx`)

**UI 布局：**

- Header："Bucket Index" + "Manage your S3 storage containers"
- 筛选栏：Bucket 数量 + "All Regions" 筛选按钮
- Bucket 列表（FlatList）：
  - 每项：文件夹图标 + Bucket 名 + 创建日期 + Region Badge
  - 特殊状态：⚠️ Limit Reached 警告
- 底部 FAB："+ Create Bucket" 按钮

**交互逻辑：**

1. 连接成功后自动加载 Bucket 列表
2. 下拉刷新
3. 点击 Bucket → router.push(`/bucket/${name}`)
4. "Create Bucket" → 弹出 Dialog 表单
5. 未连接时显示提示，引导至 Config Tab

### 6.3 Object Browser (`bucket/[name].tsx`)

**UI 布局：**

- Header：Bucket 名 + Region + 更多操作按钮
- 面包屑导航：root / assets / images / v2_release
- 列头：NAME + SIZE
- 对象列表（FlatList）：
  - `..` 返回上级
  - 文件夹项：文件夹图标 + 名称 + `/`
  - 文件项：Checkbox + 文件类型图标 + 名称 + 大小
- 底部操作栏：
  - 选中计数 + "X Objects"
  - "Pull" 下载按钮 + "Upload" 上传按钮

**交互逻辑：**

1. 根据 prefix 参数加载对象
2. 点击文件夹 → 更新 prefix → 重新加载
3. 点击 `..` → 返回上级目录
4. Checkbox 选择文件 → 启用 Pull 按钮
5. Pull → 创建下载任务到 Transfer Store
6. Upload → expo-document-picker 选择文件 → 创建上传任务

### 6.4 Transfer Monitor (`(tabs)/transfers.tsx`)

**UI 布局：**

- Header："Transfers" + 返回/更多按钮
- 分段标签：All / Uploading / Downloading / Completed
- 传输任务列表（FlatList）：
  - 每项（Card）：
    - 文件类型图标 + 文件名
    - 进度信息（1.2 GB of 2.0 GB • 2 mins remaining）
    - Progress 进度条
    - 操作按钮：Pause / Cancel（活跃） | Resume / Remove（暂停）
    - 完成状态：✓ Completed + 大小

**交互逻辑：**

1. 实时更新传输进度
2. Pause → 暂停传输
3. Resume → 恢复传输
4. Cancel/Remove → 取消/移除任务

---

## 7. 实现步骤

### Step 1: 安装依赖

```bash
pnpm add zustand @aws-sdk/client-s3 expo-secure-store expo-file-system expo-document-picker
```

### Step 2: 添加 RNR 组件

```bash
npx @react-native-reusables/cli@latest add card input label separator badge progress dialog alert-dialog checkbox select switch tabs
```

### Step 3: 创建类型定义和工具

- `lib/types.ts`
- `lib/constants.ts` (AWS regions 列表等)

### Step 4: 实现 Zustand Stores

- `lib/stores/connection-store.ts`
- `lib/stores/bucket-store.ts`
- `lib/stores/object-store.ts`
- `lib/stores/transfer-store.ts`

### Step 5: 实现 S3 服务层

- `lib/s3-service.ts`

### Step 6: 实现路由布局

- `app/_layout.tsx` (更新 Root Layout)
- `app/(tabs)/_layout.tsx` (Tab Navigator)

### Step 7: 实现各屏幕

- `app/(tabs)/config.tsx`
- `app/(tabs)/index.tsx`
- `app/(tabs)/transfers.tsx`
- `app/bucket/[name].tsx`

### Step 8: 辅助组件

- `components/bucket-item.tsx`
- `components/object-item.tsx`
- `components/transfer-item.tsx`
- `components/breadcrumb.tsx`
- `components/empty-state.tsx`
- `components/status-badge.tsx`

---

## 8. 文件大小格式化

```typescript
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
```

---

## 9. 注意事项

1. **expo SDK 55**: 确保所有 expo-\* 依赖使用 SDK 55 兼容版本
2. **Uniwind**: 项目使用 Uniwind 而非 NativeWind，class-based styling
3. **SecureStore**: Secret Access Key 必须安全存储
4. **AWS SDK Bundle Size**: 仅引入 @aws-sdk/client-s3，避免引入完整 AWS SDK
5. **FlatList**: 所有列表使用 FlatList + memo 优化性能
6. **PortalHost**: Dialog/Select 等组件需要 PortalHost 支持
7. **Platform 差异**: 部分 UI 在 Web 和 Native 可能需要 Platform.select 处理
