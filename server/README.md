# 洛克农场 · 抖音去水印服务

纯本地运行的抖音解析服务。**零第三方依赖、零 npm 包、不需要浏览器** —— 只要机器上有 **Node.js 18+** 就能跑。

---

## 一、它是怎么工作的

```
你粘贴分享链接
      │
      ▼
① 从分享文案里抠出链接 ──► ② 短链 302 跳转，拿到作品 ID
                                   │
                                   ▼
                     ③ POST ttwid.bytedance.com 取会话凭证 ttwid
                                   │
                                   ▼
                     ④ 带上 ttwid 请求 /aweme/v1/web/aweme/detail/
                                   │
                                   ▼
                     ⑤ 取出无水印地址 → 归一化返回
```

**全程都是普通 HTTP 请求，实测 0.6 ~ 2.4 秒完成，不启动任何浏览器。**

---

## 二、为什么不需要浏览器（重要，也是这份文档最该看的一段）

网上（以及本项目早期版本）普遍认为：抖音把数据藏在**动态签名接口**后面，必须开一个真实浏览器、
让页面自己去算 `a_bogus` 签名，再从旁边把响应截下来。

**这个结论对「作品详情」这个接口是不成立的。** 2026-09-30 用真实链接做了对照实验：

| 实验 | 结果 |
|---|---|
| 不带任何 Cookie 请求详情接口 | HTTP 200，**body 长度 0** ← 空壳 |
| 带完整浏览器 Cookie | HTTP 200，body 70KB，**含 `play_addr`** |
| **只带 `ttwid` 这一个 Cookie** | HTTP 200，body 70KB，**含 `play_addr`** ← 与上一行等价 |
| 其余 Cookie 全带、唯独去掉 `ttwid` | HTTP 200，**body 长度 0** |
| 全带但去掉 `UIFID` / `msToken` | 仍然 200 + 完整数据（这两个不是必需） |

**结论：`ttwid` 是唯一的门槛，`a_bogus` 对本接口并非必需。**

这也解释了为什么市面上大量 PHP 去水印接口能「贴链接就出结果」—— 它们只是持有了一个有效的 `ttwid`。
门槛从来不是语言，也不是浏览器。

而 `ttwid` 可以**纯 HTTP 获取**，两条途径（本服务两条都实现了，互为备份）：

| 途径 | 请求 | 说明 |
|---|---|---|
| 主 | `POST https://ttwid.bytedance.com/ttwid/union/register/` | 官方注册接口，返回 `Set-Cookie: ttwid=...` |
| 兜底 | `GET https://www.douyin.com/light/{aweme_id}` | 轻量页的 `Set-Cookie` 里带 `ttwid` |

> 顺带记录几条已被实测淘汰的路子，省得以后再走一遍：
> `iesdouyin` 的 `iteminfo` 接口（已废弃，返回 `status_code` 错误体）、
> `aweme.snssdk.com` 详情接口（200 空 body）、
> 分享页 / `light` 页 / SEO 页里的 `RENDER_DATA`（只有站点配置，`play_addr` 出现 0 次）。

---

## 三、快速开始

```bash
cd server
npm start          # 无需 npm install，本项目没有任何依赖
```

看到下面这段就是成功了：

```
  🎬  洛克农场 · 抖音去水印服务已启动
  ─────────────────────────────────────────────
  监听地址   http://127.0.0.1:3000
  Node       v22.x.x  (win32/x64)
  运行方式   纯 HTTP，不需要浏览器、无第三方依赖
  ─────────────────────────────────────────────
```

然后浏览器打开 **http://127.0.0.1:3000**，页面上有输入框，可直接粘贴链接试。

### 命令行快速测一条

```bash
node src/cli.js "【分享文案】https://v.douyin.com/xxxxx/"
```

---

## 四、接口

### 1. 解析

```
POST /api/parse
Content-Type: application/json

{ "url": "完整分享文案或链接" }
```

也支持 `GET /api/parse?url=...`，方便浏览器地址栏直接调试。

**返回（视频）：**

```json
{
  "ok": true,
  "data": {
    "aweme_id": "7668531585298211044",
    "type": "video",
    "title": "你守护长安，我守护你#赵怀真#云缨",
    "author": { "nickname": "远道", "uid": "4388897327181272", "avatar": "..." },
    "cover": "https://...",
    "duration_ms": 70937,
    "create_time": 1785469146,
    "statistics": { "digg": 3, "comment": 4, "share": 0, "collect": 0 },
    "music": { "title": "偏爱", "author": "张芸京", "url": "..." },
    "has_animated": false,
    "video": {
      "no_watermark": "https://...douyinvod.com/...",   // ✅ 无水印直链
      "no_watermark_backup": ["..."],
      "watermark": "https://...watermark=1...",         // ⚠️ 带水印（对照用）
      "size": 22759710,
      "width": 1920, "height": 1080,
      "gears": [ { "gear": "normal_720_0", "bit_rate": 2566751, "url": "..." } ]
    },
    "images": [],
    "notice": "无水印链接为抖音 CDN 临时地址…"
  }
}
```

**返回（图集 / 动图）：** `type` 为 `"images"`，`video` 为 `null`，图片在 `images` 数组里：

```json
{
  "has_animated": true,
  "images": [
    {
      "url": "https://...webp",
      "backup": ["...", "..."],
      "width": 1152, "height": 720,
      "animated": true,
      "animated_video": "https://..."
    }
  ]
}
```

> **关于「动图」**：抖音的「动态壁纸」实际是 **animated WebP**，走的是图集通道。
> 服务端直接判定（图集项若挂有 `video` 子对象即为动图），比「看 URL 后缀是不是 `.webp`」更可靠，
> 结果通过 `animated` / `has_animated` 返回。

### 2. 下载中转

```
GET /api/download?src=<抖音CDN地址>&name=<文件名>
```

**为什么需要它**：小程序的 `downloadFile` 只能访问「已备案 + 后台白名单」的域名，
而抖音 CDN（`douyinvod.com`）**无法**加进你的白名单。本接口把内容**流式转发**给前端，
前端只需访问你自己的域名。

- 支持 **Range**（视频可拖动进度条、断点续传）
- 带**域名白名单校验**，不是开放代理（非抖音域名返回 403）
- 不落地存储，纯转发

> 如果不需要小程序端下载、只让用户「复制链接」自己去浏览器下载，这个接口可以不用。

### 3. 健康检查

```
GET /api/health
→ { ok, node, platform, arch, port, host, ttwid:{cached,via,age_s,ttl_s,prefix}, uptime_s }
```

`ttwid` 字段能看到凭证是否已缓存、来源、已存活多久，排查问题时很有用。

---

## 五、配置项（环境变量，全部可选）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `MAX_CONCURRENT` | `8` | 最大并发解析数 |
| `PARSE_TIMEOUT_MS` | `20000` | 单次解析超时 |
| `SHORTLINK_TIMEOUT_MS` | `15000` | 短链跳转超时 |
| `TTWID_TIMEOUT_MS` | `10000` | 获取 ttwid 超时 |
| `TTWID_TTL_MS` | `3600000` | ttwid 缓存时长（默认 1 小时） |
| `USER_AGENT` | 桌面版 Chrome | 请求 UA |

`ttwid` 会在内存中缓存，过期或解析失败时**自动刷新并重试一次**，可以长期无人值守运行。

---

## 六、部署到公网服务器

**本项目零依赖，部署 = 传文件 + 起服务 + 接 Nginx。**

现网信息（本仓库当前配置）：

| 项 | 值 |
|---|---|
| 域名 | `https://dyapi.stuckapi.icu` |
| 后端监听 | `127.0.0.1:3000`（只对本机开放，由 Nginx 反代） |
| 前端引用 | `utils/config.js` 的 `baseUrl` |

### 方式 A · 手工 systemd

```bash
# 1) 把整个 server/ 目录上传到服务器，例如宝塔面板 →
#    文件 → 上传并解压到 /www/wwwroot/dyapi.stuckapi.icu/
#    （里面只有源码，没有任何 node_modules）

# 2) 在服务器终端前台试跑，确认能起来
cd /www/wwwroot/dyapi.stuckapi.icu/server
PORT=3000 node src/server.js
```

确认无误后，按需自行写一个 systemd 单元指向 `node src/server.js`，
并建状态目录 `/var/lib/locke-farm` 用于 ttwid 落盘。

> 若服务器上没有 Node，宝塔用户走「软件商店 → Node.js 版本管理器 → 安装 v20 LTS」最省事。

> ℹ️ 本仓库只发布源码。原先的一键部署脚本（`install.sh`、systemd 单元模板、
> Nginx 示例配置）与 Windows 部署工具包（bat / ps1 / WinSW 服务包装器）**未随仓库发布**。

### 方式 B · Docker

```bash
cd server
docker compose up -d          # 镜像自带 Node，宿主机什么都不用装
```

详见 `docker-compose.yml` 顶部注释（含 Nginx 也在 Docker 里时的端口改法）。

### 方式 C · 手工（pm2）

```bash
cd server
PORT=3000 pm2 start src/server.js --name douyin
pm2 save
```

### 接上 Nginx（选哪种方式都要做这一步）

自行准备一个 Nginx 反代（示例配置未随仓库发布），上游指向 `127.0.0.1:3000`。
**最关键的是别漏掉这两行**：

```nginx
proxy_buffering off;        # 下载中转是流式转发；开缓冲会先把整个视频缓存下来，大文件会卡死
proxy_read_timeout 300s;    # 大视频转发耗时长，默认 60s 不够
```

### 上线后必做

1. 浏览器访问 `https://dyapi.stuckapi.icu/api/health`，应返回 `{"ok":true,...}`
2. 微信小程序后台 → 开发设置 → 服务器域名：把 `dyapi.stuckapi.icu` **同时**加入
   **request 合法域名** 与 **downloadFile 合法域名**（下载中转要用后者）
3. 前端 `utils/config.js` 的 `baseUrl` 指向 `https://dyapi.stuckapi.icu`（仓库内已配好）

**资源占用**：纯 HTTP 请求，内存占用极低（几十 MB），1 核 1G 的机器带得动。
需要注意的不是内存，而是**抖音对单 IP 有频率限制**（社区经验值约每分钟 10 次），
访问量大时建议加缓存或错峰（可下调 `MAX_CONCURRENT`）。

---

## 七、已知限制

| 限制 | 说明 |
|---|---|
| 无水印链接有时效 | 抖音 CDN 直链通常 **几十分钟内**失效，请尽快下载或转存 |
| 单条作品 | 不支持批量 / 主页批量下载 |
| 单 IP 频率限制 | 抖音对同一 IP 的请求有频控，高并发可能被限流 |
| 抖音改版风险 | 若抖音调整接口或提高风控，`ttwid` 可能失效；本服务已做自动刷新重试，但极端情况下需更新参数 |
| 不存内容 | 本服务只转发直链，不缓存任何视频文件 |

---

## 八、目录结构

```
server/
├── package.json                    # 无任何 dependencies
├── README.md                       # 本文档
├── Dockerfile                      # 方式 B：Docker 镜像（基于 node:22-alpine）
├── docker-compose.yml              # 方式 B：一条命令启动
├── .dockerignore
└── src/
    ├── server.js                   # HTTP 服务入口（自带在线试用页）
    ├── parser.js                   # 解析核心：短链跳转 + 详情请求 + 归一化
    ├── ttwid.js                    # ttwid 获取、缓存与自动刷新（核心机制）
    ├── download.js                 # 下载中转（Range 透传 + 域名白名单）
    ├── config.js                   # 配置
    └── cli.js                      # 命令行解析工具
```

---

## 九、免责声明

本服务仅供个人学习与技术研究使用。请勿用于商业用途或大规模抓取，
下载的内容版权归原作者所有，请勿二次传播或用于侵权用途。

此外请注意：**抖音小程序官方明文禁止「去水印」类小程序上架**，
微信小程序审核亦属敏感类目。若打算上架，请自行评估审核风险。
