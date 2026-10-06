# 🛠️ 洛克农场 — 抖音去水印 · 王者战力查询

> 基于 uni-app (Vue 3) 的跨平台多端工具应用，当前包含 **抖音去水印** 与 **王者荣耀战力查询** 两个独立功能。

[![Platform](https://img.shields.io/badge/platform-WeChat%20%7C%20Douyin%20%7C%20APP-brightgreen)](https://github.com/Nonver/babyQphoto-v2)
[![Framework](https://img.shields.io/badge/framework-uni--app%20Vue3-007AFF)](https://uniapp.dcloud.net.cn/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

---

> ### ⚠️ 2026-09-30 重大变更
>
> 原 **「头像壁纸素材图库」** 业务线（首页 / 素材浏览 / 搜索 / 收藏 / 浏览历史 / 用户登录注册 / 后台管理 / 素材编辑 / 全部分类）因其依赖的后端域名已失效，已 **整体删除**，共移除 12 个页面目录、13 个 `.vue` 页面、2 个工具文件与 6 张 tabBar 图标。
>
> 当前版本只保留两个功能模块，应用结构由「16 页面 + 5 TabBar」精简为 **「3 页面 + 2 TabBar」**。

---

## 📋 目录

- [项目概述](#项目概述)
- [技术栈](#技术栈)
- [功能特性](#功能特性)
- [项目结构](#项目结构)
- [页面路由](#页面路由)
- [接口说明](#接口说明)
- [已知依赖与限制](#已知依赖与限制)
- [编译与部署](#编译与部署)

---

## 项目概述

**洛克农场** 是一款面向 **微信小程序、抖音小程序及 Android/iOS APP** 的多端跨平台工具应用，提供两个互不耦合的能力：

1. **🎬 抖音去水印** —— 粘贴抖音分享口令，解析出无水印视频 / 图集并保存到相册。
2. **⚔️ 王者荣耀战力查询** —— 按战区查询各英雄的最低上榜战力（省级 / 市级 / 区级 / 国标）。

### 支持的平台

| 平台 | AppID | 说明 |
|------|-------|------|
| 🟢 微信小程序 | `wx727a9e58496c2012` | `manifest.json` → `mp-weixin` |
| 🔴 抖音小程序 | `tte6c4907978a0fd0501` | `manifest.json` → `mp-toutiao` |
| 📱 Android / iOS APP | `__UNI__F1829B9` | 5+App 原生打包 |

---

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | uni-app (Vue 3) | 一套代码多端运行（同时保留 Vue 2 兼容分支） |
| **构建工具** | HBuilderX 自带的 uni-app 编译链 | 本项目**无 npm 工程**；命令行编译用 `build-mp-weixin.mjs`（见 [编译与部署](#编译与部署)） |
| **网络层** | `uni.request` 封装 | `utils/api.js` |
| **战力数据源** | `api.xxoo.team` | 第三方公开接口，前端直连，不经过自有后端 |
| **去水印数据源** | **本项目自带 Node 服务** | `server/` 目录，`POST /api/parse`，纯本地运行，**无需 PHP、无需第三方接口** |
| **去水印解析内核** | Node.js 内置 `fetch` | 纯 HTTP + `ttwid` 会话凭证，**不需要浏览器、零 npm 依赖**（原理见 `server/README.md`） |

---

## 功能特性

### 🎬 抖音去水印

- 粘贴抖音分享口令全文，正则自动提取 `v.douyin.com` 短链
- 输入框聚焦时自动读取剪贴板
- **视频结果**：封面、时长、作者（昵称/抖音号/头像）、音乐信息、无水印地址
- **图集结果**：九宫格缩略图、张数统计、单张保存、批量下载
- 保存到相册：微信 `wx.getSetting/authorize/openSetting` 与抖音 `tt.*` 完整权限申请链
- 复制无水印链接 / 复制全部信息（标题·作者·音乐·地址）
- 微信 / 抖音分享（好友 + 朋友圈）

### ⚔️ 王者战力查询

- 四战区切换：安卓QQ(`aqq`) / 安卓微信(`awx`) / 苹果QQ(`iqq`) / 苹果微信(`iwx`)
- 英雄名输入查询；支持从英雄列表页回填（`pickedHero` 本地传递）
- 结果展示：国标 / 省标 / 市标 / 区标 + 数据更新时间
- 战力数字千分位格式化、一键复制战力、分享
- **英雄列表页**：全量拉取 + 前端关键字过滤 + 分页器（30 条/页，含省略号页码逻辑）
- 第三方接口异常时降级为内置英雄名列表（`getMockHeroes()`），保证页面可用

---

## 项目结构

```
babyQphoto-main/
├── App.vue                       # 应用入口（全局样式 + 主题变量）
├── main.js                       # 主入口（Vue3 createSSRApp / Vue2 分支）
├── manifest.json                 # 多端配置（AppID / 权限 / 图标）
├── pages.json                    # 路由注册：3 页面 + 2 个 tabBar
├── index.html                    # H5 模板
├── uni.scss                      # uni-app 默认 scss 变量
├── uni.promisify.adaptor.js      # uni API Promise 化拦截器
├── .htaccess-for-bt              # 后端伪静态片段（遗留）
├── LICENSE                       # MIT
│
├── pages/                        # 页面（3 个）
│   ├── douyin/douyin.vue         # 🎬 抖音去水印（TabBar）
│   ├── power-query/power-query.vue # ⚔️ 王者战力查询（TabBar）
│   └── hero-list/hero-list.vue   # 🦸 选择英雄（子页面）
│
├── utils/                        # 工具层（3 个）
│   ├── config.js                 # 全局配置（baseUrl / timeout）
│   ├── request.js                # 通用 HTTP 封装（当前无调用方，保留备用）
│   └── api.js                    # 接口封装（抖音解析 2 个 + 战力查询 2 个方法）
│
├── build-mp-weixin.mjs           # 🔨 命令行编译微信小程序（复用 HBuilderX 自带编译链）
│
├── unpackage/                    # 编译产物（自动生成，可随时删）
│   └── dist/build/mp-weixin/     #   → 微信开发者工具导入这个目录
│
├── server/                       # 🎬 抖音去水印解析服务（Node.js）
│   ├── package.json              # 零依赖（dependencies 为空）
│   ├── README.md                 # 原理 / 接口 / 部署说明
│   ├── Dockerfile                # 部署：Docker 镜像
│   ├── docker-compose.yml        #   一条命令启动
│   └── src/
│       ├── server.js             # HTTP 服务入口（自带在线试用页）
│       ├── parser.js             # 解析核心：短链跳转 + 详情请求 + 归一化
│       ├── ttwid.js              # ttwid 会话凭证：获取 / 缓存 / 自动刷新
│       ├── download.js           # 下载中转（Range 透传 + 域名白名单）
│       ├── config.js             # 配置
│       └── cli.js                # 命令行解析工具
│
└── static/
    ├── logo.png                  # 未引用（保留）
    ├── qrcode.png                # 未引用（保留）
    └── tabbar/                   # 4 张：douyin(+active)、power(+active)
```

## 页面路由

| # | 路由 | 标题 | 类型 | 说明 |
|---|------|------|------|------|
| 1 | `pages/douyin/douyin` | 抖音去水印 | TabBar（首页） | 链接解析 · 无水印下载 |
| 2 | `pages/power-query/power-query` | 王者战力查询 | TabBar | 英雄战力数据查询 |
| 3 | `pages/hero-list/hero-list` | 选择英雄 | 子页面 | 战力查询的英雄选列表 |

> tabBar 配色：未选中 `#999999` / 选中 `#FF6B8A`；导航栏为深色 `#1A1A2E` + 白字。

---

## 接口说明

### 🎬 抖音去水印（本项目自带 Node 服务，见 `server/`）

| 方法 | 路由 | 入参 | 返回 |
|------|------|------|------|
| `POST` | `/api/parse` | `{ url }`（完整分享文案或链接均可） | `{ ok:true, data:{ type:'video'\|'images', title, author{nickname,uid,avatar}, cover, duration_ms, create_time, statistics{}, music{title,author,url}, has_animated, video{no_watermark,watermark,size,width,height,gears[]}\|null, images[{url,backup,width,height,animated}] } }` |
| `GET` | `/api/download` | `src=<encoded url>&name=<文件名>` | 二进制流（**下载中转**，支持 Range，绕过小程序域名白名单） |
| `GET` | `/api/health` | — | 服务状态与 `ttwid` 凭证缓存情况 |

> 逐字段含义、完整响应示例、解析原理见 [`server/README.md`](./server/README.md)。

### ⚔️ 王者战力查询（第三方直连，绕过 `request.js`）

| 用途 | 地址 | 备注 |
|------|------|------|
| 英雄列表 | `https://api.xxoo.team/hero/getHeroList.php` | 兼容裸数组 / `{data:[]}` 两种返回 |
| 英雄战力 | `https://api.xxoo.team/hero/getHeroInfo.php?hero=&type=` | 期望 `{ code:200, data:{...} }`，字段：`name/alias/photo/guobiao/province/provincePower/city/cityPower/area/areaPower/updateTime` |

---

## 已知依赖与限制

> 以下均为**已核实**的现状，非推测。

| # | 项 | 现状 | 影响 |
|---|----|------|------|
| 1 | 抖音去水印 | ✅ **已本地打通**：`server/` 服务，纯 HTTP + `ttwid` 会话凭证；视频/图文/动图三种类型实测 25 项断言全通过、HTTP 接口 23 项全通过 | 使用前只需启动 `server/`（零依赖，**不需要安装任何东西**） |
| 2 | `utils/config.js` 的 `baseUrl` | 已指向线上服务 **`https://dyapi.stuckapi.icu`** | 本地调试时改回 `http://127.0.0.1:3000` |
| 3 | 下载代理 | 走线上服务 `https://dyapi.stuckapi.icu/api/download`，支持 Range | 小程序后台需把该域名加入 **downloadFile 合法域名** 白名单 |
| 4 | 王者战力第三方接口 | `api.xxoo.team`，前端直连 | 不依赖自有后端，**当前可直接使用**；接口若变动需同步调整 `utils/api.js` |
| 5 | `utils/request.js` | 已无调用方（原图库上传用） | 无害的死代码，保留作通用能力 |
| 6 | 无水印链接时效 | 抖音 CDN 直链通常**几十分钟内**失效 | 需即时下载/转存，前端已给提示 |
| 7 | 解析耗时 | **0.6~2.4 秒**（纯 HTTP，无浏览器启动开销） | 前端 `timeout` 已收紧为 20 秒 |

> 📄 **相关文档**
>
> - [`server/README.md`](./server/README.md) —— 本地服务的原理、接口、配置与部署
>
> ⚠️ **必须提前知道**：抖音小程序官方明文禁止「去水印」类小程序上架，微信小程序审核亦属敏感类目。
> 本功能当前定位为 **本地/自用 + App 端**；若要上微信小程序，请自行评估审核风险。

---

## 编译与部署

### 1. 编译微信小程序

在项目根目录的终端里执行：

```bash
node build-mp-weixin.mjs
```

产物在 `unpackage/dist/build/mp-weixin/`，用 **微信开发者工具 → 导入项目** 选中该目录即可预览 / 上传
（AppID 已配好：`wx727a9e58496c2012`）。

> 脚本复用**本机 HBuilderX 自带的 uni-app(Vue3) 编译链**，不需要给项目装 npm 依赖，
> 也不会改动 HBuilderX 安装目录 —— 它只在 `.workbuddy/hxroot/` 下建软链接，
> 并自备一份 dart-sass（HBuilderX 默认不带 sass 编译器，而 `App.vue` 用了 scss）。首次运行需联网下载 sass。
>
> **也可以直接用 HBuilderX 图形界面**：菜单 → 发行 → 小程序-微信。
> 若 HBuilderX 未装 sass 编译插件，会提示「未安装相应的编译器插件」，按提示一键安装即可。

### 2. 部署后端（去水印功能必需）

线上地址：**`https://dyapi.stuckapi.icu`**

两种方式任选其一（细节见 [`server/README.md`](./server/README.md) 第六节）：

| 方式 | 在服务器上执行 | 服务器需要装什么 |
|------|----------------|------------------|
| **A · Docker**（推荐） | `cd server && docker compose up -d` | 只要 Docker |
| **B · 手工 pm2** | `PORT=3000 pm2 start src/server.js` | Node.js 18+ 和 pm2 |

两种方式都还要接一次 Nginx 反代，上游指向 `127.0.0.1:3000`。
**别漏掉 `proxy_buffering off;`**，否则下载中转会把整个视频先缓存下来，大文件直接卡死。

> ℹ️ 本仓库只发布源码。部署脚本（一键 systemd 脚本、WinSW 服务包装器、
> Windows bat/ps1 工具包、Nginx 示例配置）与交付打包件**未随仓库发布**。

### 3. 本地调试

```bash
cd server && npm start          # → http://127.0.0.1:3000（零依赖，无需 npm install）
```

然后把 `utils/config.js` 的 `baseUrl` 临时改回 `http://127.0.0.1:3000`，
并在微信开发者工具「详情 → 本地设置」勾选 **不校验合法域名**。

- **H5 调试**：HBuilderX → 运行 → 运行到浏览器
- **APP**：HBuilderX → 发行 → 原生App-云打包
- **真机调试**：把 `baseUrl` 改成电脑局域网 IP，如 `http://192.168.1.100:3000`

### 4. 发布前必做

1. 微信小程序后台 → 开发设置 → 服务器域名：把 `dyapi.stuckapi.icu` **同时**加入
   **request 合法域名** 与 **downloadFile 合法域名**（下载中转走后者）。
2. 确认 `utils/config.js` 的 `baseUrl` 为 `https://dyapi.stuckapi.icu`。
3. 补齐 `manifest.json` 中各平台 AppID（若与现有不同）。
4. 注意：抖音小程序**不允许**去水印类目上架，不要在抖音端投入精力。

---

## 许可证

Copyright (c) 2026 远道 (Nonevy) · MIT License

---

## 联系方式

- 📧 Email: canvasr@163.com
- 🐙 GitHub: [https://github.com/Nonver/babyQphoto-v2](https://github.com/Nonver/babyQphoto-v2)
