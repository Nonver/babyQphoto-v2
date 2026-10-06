/**
 * 配置
 * 洛克农场 —— 抖音去水印服务
 *
 * ⚠️ 本服务是「零第三方依赖」的：不需要浏览器、不需要 npm install 任何包，
 *    只用 Node 18+ 内置的 fetch。
 *
 * 为什么不需要浏览器，见 src/ttwid.js 顶部的实测结论。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const bool = (v, d = false) => {
  if (v === undefined || v === null || v === '') return d;
  if (typeof v === 'boolean') return v;
  return /^(1|true|yes|on)$/i.test(String(v));
};

/**
 * 读取微信配置。
 *
 * 优先级：环境变量 > wechat.json > 默认值。
 * 用 `import.meta.url` 定位，所以**和进程的工作目录无关**，
 * 不管从哪个目录启动都能找到服务目录下的 wechat.json。
 */
function loadWeChatConfig() {
  const file = process.env.WECHAT_CONFIG_FILE
    || fileURLToPath(new URL('../wechat.json', import.meta.url));

  let j = {};
  let configError = null;
  if (file && fs.existsSync(file)) {
    try {
      j = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
      if (!j || typeof j !== 'object') throw new Error('内容不是对象');
    } catch (e) {
      configError = '解析 ' + file + ' 失败：' + e.message;
      j = {};
    }
  }

  return {
    file,
    configError,
    appid: process.env.WX_APPID || j.appid || '',
    secret: process.env.WX_SECRET || j.secret || '',
    /** 消息推送配置里的 Token，用于校验推送来源 */
    token: process.env.WX_TOKEN || j.token || '',
    /** 消息推送配置里的 EncodingAESKey（仅「安全模式」需要） */
    encodingAesKey: process.env.WX_AES_KEY || j.encodingAesKey || '',
    /**
     * 对外可访问的基础地址。
     * mediaCheckAsync 的 media_url 必须能被**微信的检测服务器**下载，
     * 所以这里给的是公网地址（本机地址微信够不着）。
     */
    publicBaseUrl: String(process.env.PUBLIC_BASE_URL || j.publicBaseUrl || '').replace(/\/+$/, ''),
    /** 内容安全场景：1 资料；2 评论；3 论坛；4 社交日志 */
    scene: num(process.env.SEC_SCENE || j.scene, 2),
    /** 一条解析结果里最多送检几张图片，防止图集把配额打光 */
    maxImagesPerResult: num(process.env.SEC_MAX_IMAGES || j.maxImagesPerResult, 10),
    /** 仅本机可访问的演示接口额外放行口令（留空则只允许 127.0.0.1 访问） */
    demoKey: process.env.SEC_DEMO_KEY || j.demoKey || '',
    /** 调试开关：跳过内容安全检测（仅本地开发用，正式环境务必为 false） */
    skipCheck: bool(process.env.SEC_SKIP_CHECK, bool(j.skipCheck, false)),
  };
}

export const config = {
  /** 服务监听端口 */
  port: num(process.env.PORT, 3000),
  /** 监听地址：默认 0.0.0.0 便于手机/模拟器访问；上线时按需改 */
  host: process.env.HOST || '0.0.0.0',

  /** 单次解析总超时（毫秒）—— 纯 HTTP 请求，通常 1 秒内完成 */
  parseTimeoutMs: num(process.env.PARSE_TIMEOUT_MS, 20000),
  /** 短链跳转解析超时 */
  shortlinkTimeoutMs: num(process.env.SHORTLINK_TIMEOUT_MS, 15000),
  /** 获取 ttwid 的超时 */
  ttwidTimeoutMs: num(process.env.TTWID_TIMEOUT_MS, 10000),
  /** ttwid 缓存时长（毫秒），默认 1 小时；失效时会自动刷新重试 */
  ttwidTtlMs: num(process.env.TTWID_TTL_MS, 60 * 60 * 1000),

  /**
   * 解析并发上限。
   * 抖音对单 IP 有频率限制（社区经验值约每分钟 10 次），
   * 这里默认保守取 8；服务器带宽小或遇到限流时可调到 2~3。
   */
  maxConcurrent: num(process.env.MAX_CONCURRENT, 8),

  /** 解析时使用的 UA（桌面版 Chrome，与抖音 PC 网页匹配） */
  userAgent: process.env.USER_AGENT ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',

  /** 下载中转时向抖音 CDN 声明的 Referer */
  cdnReferer: 'https://www.douyin.com/',

  /** ttwid 缓存文件（留空则不落盘）；用于重启后免去重新注册 */
  ttwidCacheFile: process.env.TTWID_CACHE_FILE ?? '',

  /** 微信能力配置（AppID / AppSecret / 消息推送 Token 等） */
  wechat: loadWeChatConfig(),

  /**
   * 内容安全本地存储文件（文本结果缓存 + 图片违规黑名单 + trace 映射）。
   * 默认落在 <启动目录>/data 下；WinSW 服务的 WorkingDirectory 就是安装目录，
   * 所以服务方式运行时是 <安装目录>\data\sec-store.json。
   */
  secStoreFile: process.env.SEC_STORE_FILE
    || (process.env.TTWID_CACHE_FILE
      ? path.join(path.dirname(process.env.TTWID_CACHE_FILE), 'sec-store.json')
      : path.join(process.cwd(), 'data', 'sec-store.json')),

  /**
   * 内容安全审计日志（每次调用微信接口都记一行 JSON）。
   * 审核要求的「接口调用成功」证据之一就是它，也同步打到 stdout。
   */
  secLogFile: process.env.SEC_LOG_FILE
    || (process.env.TTWID_CACHE_FILE
      ? path.join(path.dirname(process.env.TTWID_CACHE_FILE), 'sec-check.log')
      : path.join(process.cwd(), 'logs', 'sec-check.log')),
};

export function describeEnv() {
  const w = config.wechat;
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    /** 刻意保留这个字段：老版本用浏览器，现版本不需要，便于日志对比 */
    browser: '不需要（纯 HTTP）',
    port: config.port,
    host: config.host,
    /** 内容安全（审核要求）——只暴露状态，绝不返回 secret 本体 */
    security: {
      enabled: !w.skipCheck,
      wechat_configured: !!(w.appid && w.secret),
      appid: w.appid || '',
      public_base_url: w.publicBaseUrl,
      config_file: w.file,
      config_error: w.configError || null,
    },
  };
}
