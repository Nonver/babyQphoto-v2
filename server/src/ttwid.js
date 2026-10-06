/**
 * ttwid 会话凭证 —— 抖音详情接口的唯一门槛
 *
 * ===================================================================
 * 【以下结论全部来自 2026-09-30 的实测，不是推断，也不是抄教程】
 *
 *   实验                        结果
 *   ─────────────────────────── ─────────────────────────────────────
 *   不带任何 Cookie 请求详情接口  HTTP 200，body 长度 0        ← 空壳
 *   带完整浏览器 Cookie          HTTP 200，body 70KB，含 play_addr
 *   只带 ttwid 这一个 Cookie     HTTP 200，body 70KB，含 play_addr  ← 等价
 *   全带但唯独去掉 ttwid          HTTP 200，body 长度 0
 *   全带但去掉 UIFID / msToken   仍然 200 + 完整数据
 *
 *   ⇒ **ttwid 是唯一必要的凭证**。a_bogus（动态签名）对「作品详情」
 *     这个接口并非必需 —— 这就是为什么市面上一大批 PHP 去水印接口
 *     能「贴链接就出结果」：它们只是持有了一个有效的 ttwid。
 *
 *   （网上大量教程说必须算 a_bogus / 必须开浏览器，实测已不适用于
 *     该接口；本项目早期版本也正是因此绕了远路。）
 * ===================================================================
 *
 * ttwid 可以纯 HTTP 获取，完全不需要浏览器：
 *   主途径：POST https://ttwid.bytedance.com/ttwid/union/register/
 *   兜    底：GET  https://www.douyin.com/light/{aweme_id}
 */
import { config } from './config.js';

const REGISTER_URL = 'https://ttwid.bytedance.com/ttwid/union/register/';
const REGISTER_BODY = JSON.stringify({
  region: 'cn',
  aid: 1768,
  needFid: false,
  service: 'www.ixigua.com',
  migrate_info: { ticket: '', migrate_priority: 1 },
  cbUrlProtocol: 'https',
  union: true,
});

/**
 * 兼容读取 Set-Cookie。
 * Node 20+ 有 headers.getSetCookie()；更早的版本只有 get('set-cookie')。
 * @param {Headers} headers
 * @returns {string[]}
 */
function readSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

/** 从一组 Set-Cookie 里挑出 ttwid（只要 name=value 部分） */
function pickTtwid(setCookies) {
  for (const sc of setCookies) {
    if (/^\s*ttwid=/i.test(sc)) return sc.split(';')[0].trim();
  }
  return null;
}

async function withTimeout(fn, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(timer);
  }
}

/** 主途径：官方 ttwid 注册接口 */
async function fromRegister() {
  return withTimeout(async (signal) => {
    const r = await fetch(REGISTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': config.userAgent,
        'Accept': '*/*',
      },
      body: REGISTER_BODY,
      signal,
    });
    return pickTtwid(readSetCookies(r.headers));
  }, config.ttwidTimeoutMs);
}

/**
 * 兜底途径：访问抖音轻量页，从 Set-Cookie 里取 ttwid。
 * 需要一个作品 ID；调用方通常已经拿到了。
 */
async function fromLightPage(awemeId) {
  if (!awemeId) return null;
  return withTimeout(async (signal) => {
    const r = await fetch(`https://www.douyin.com/light/${awemeId}`, {
      headers: {
        'User-Agent': config.userAgent,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      redirect: 'follow',
      signal,
    });
    // 拿到 ttwid 就够了，不必读 body
    try { await r.body?.cancel(); } catch { /* ignore */ }
    return pickTtwid(readSetCookies(r.headers));
  }, config.ttwidTimeoutMs);
}

/** 内存缓存 */
let cache = { value: '', at: 0 };

/** 正在进行的获取（避免并发请求同时去注册） */
let inflight = null;

/**
 * 获取可用的 ttwid（带缓存）。
 * @param {{force?: boolean, awemeId?: string}} [opts]
 * @returns {Promise<string>} 形如 `ttwid=1%7C...`
 */
export async function getTtwid(opts = {}) {
  const { force = false, awemeId = '' } = opts;
  const now = Date.now();

  if (!force && cache.value && now - cache.at < config.ttwidTtlMs) {
    return cache.value;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    let value = null;
    let via = '';

    try {
      value = await fromRegister();
      if (value) via = 'register';
    } catch { /* 落到兜底 */ }

    if (!value) {
      try {
        value = await fromLightPage(awemeId);
        if (value) via = 'light-page';
      } catch { /* ignore */ }
    }

    if (!value) {
      const e = new Error('无法获取抖音会话凭证（ttwid），请检查网络后重试');
      e.code = 'TTWID_FAILED';
      throw e;
    }

    cache = { value, at: Date.now(), via };
    return value;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** 作废当前缓存（下一次 getTtwid 会重新获取） */
export function invalidateTtwid() {
  cache = { value: '', at: 0 };
}

/** 供健康检查使用 */
export function describeTtwid() {
  if (!cache.value) return { cached: false };
  return {
    cached: true,
    via: cache.via || '',
    age_s: Math.round((Date.now() - cache.at) / 1000),
    ttl_s: Math.round(config.ttwidTtlMs / 1000),
    /** 只暴露前 24 个字符，不泄露完整凭证 */
    prefix: cache.value.slice(0, 24) + '…',
  };
}
