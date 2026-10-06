/**
 * 微信公众平台能力封装（内容安全 / 登录 / 消息推送）
 *
 * 为什么必须放在服务端：
 *   微信要求 access_token、code2Session、msgSecCheck、mediaCheckAsync 只能由服务器调用，
 *   AppSecret 绝不能下发到小程序端。
 *
 * 零第三方依赖：只用 Node 内置 fetch / crypto（Node >= 18）。
 *
 * 接口来源（2026-09-30 逐条从官方文档核对，不是凭印象）：
 *   稳定版 token        POST https://api.weixin.qq.com/cgi-bin/stable_token
 *   登录凭证校验        GET  https://api.weixin.qq.com/sns/jscode2session
 *   文本内容安全识别    POST https://api.weixin.qq.com/wxa/msg_sec_check        （v2需要 openid）
 *   多媒体内容安全识别  POST https://api.weixin.qq.com/wxa/media_check_async    （v2需要 openid）
 *   消息推送验签        sha1(sort([Token, timestamp, nonce]).join(''))
 *
 * 实测约束（写进代码里，避免踩坑）：
 *   - msgSecCheck 的 content 上限 2500 字 → 超长自动分片；
 *   - msgSecCheck 对**未上架**小程序只有 100 次/天 → 调用方必须做缓存；
 *   - msgSecCheck/mediaCheckAsync 的 openid 必须「近两小时访问过小程序」，否则报 61010；
 *   - mediaCheckAsync 结果是 30 分钟内**异步推送**到消息推送 URL，不会同步返回。
 */
import crypto from 'node:crypto';
import { config } from './config.js';

const API = 'https://api.weixin.qq.com';

/** 文本分片大小：官方上限 2500，留点余量 */
const TEXT_CHUNK = 2400;
/** 一次最多检查几片，避免超长文案把配额打光 */
const TEXT_MAX_CHUNKS = 3;

/** access_token 内存缓存（进程内） */
let tokenCache = { token: '', expireAt: 0 };

export class WeChatError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'WeChatError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** 配置是否齐全（AppID + AppSecret） */
export function isConfigured() {
  return !!(config.wechat.appid && config.wechat.secret);
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new WeChatError(
      'WX_NOT_CONFIGURED',
      '服务端未配置微信 AppID / AppSecret（在 wechat.json 里填 secret，或用环境变量 WX_SECRET）'
    );
  }
}

function wxErrorOf(json, fallbackCode) {
  return new WeChatError(
    fallbackCode || ('WX_' + (json && json.errcode)),
    (json && json.errmsg) || '微信接口返回错误',
    { wx: json }
  );
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { errcode: -2, errmsg: `微信返回的不是 JSON（HTTP ${res.status}）：${text.slice(0, 200)}` };
  }
}

function postJson(url, body, timeoutMs) {
  return fetchJson(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs
  );
}

// ============================================================================
// 1. 接口调用凭证（稳定版）
// ============================================================================

/**
 * 获取稳定版 access_token。
 *
 * 用 stable_token 而不是 /cgi-bin/token：
 *   两者互相隔离，stable_token 在有效期内重复调用**不会**让旧 token 失效，
 *   而 /cgi-bin/token 每次调用都会刷新，多进程部署时容易互相踢掉。
 *
 * @param {boolean} [forceRefresh] 强制刷新（慎用，官方限制每天 20 次且间隔 30 秒）
 * @returns {Promise<string>}
 */
export async function getAccessToken(forceRefresh = false) {
  assertConfigured();
  const now = Date.now();
  if (!forceRefresh && tokenCache.token && tokenCache.expireAt > now) return tokenCache.token;

  const body = {
    grant_type: 'client_credential',
    appid: config.wechat.appid,
    secret: config.wechat.secret,
  };
  if (forceRefresh) body.force_refresh = true;

  const json = await postJson(`${API}/cgi-bin/stable_token`, body, 15000);
  if (!json.access_token) throw wxErrorOf(json, 'WX_TOKEN_FAILED');

  // 官方会提前 5 分钟更新 token，我们也留 5 分钟余量；至少保留 60 秒避免反复请求
  const ttl = Math.max(60, Number(json.expires_in || 7200) - 300);
  tokenCache = { token: json.access_token, expireAt: now + ttl * 1000 };
  return tokenCache.token;
}

/** 清掉本地 token 缓存（收到 40001 时用） */
export function clearTokenCache() {
  tokenCache = { token: '', expireAt: 0 };
}

/** 带 token 的 POST，遇到 40001（token 失效）自动重取一次 */
async function callWithToken(apiPath, body, timeoutMs = 15000) {
  const token = await getAccessToken();
  const url = `${API}${apiPath}?access_token=${encodeURIComponent(token)}`;
  let json = await postJson(url, body, timeoutMs);
  if (json.errcode === 40001) {
    clearTokenCache();
    const token2 = await getAccessToken();
    json = await postJson(`${API}${apiPath}?access_token=${encodeURIComponent(token2)}`, body, timeoutMs);
  }
  return json;
}

// ============================================================================
// 2. 小程序登录（拿 openid，内容安全接口必须要它）
// ============================================================================

/**
 * 登录凭证校验：js_code → openid
 * @param {string} jsCode wx.login() 拿到的 code
 */
export async function code2Session(jsCode) {
  assertConfigured();
  const u = new URL(`${API}/sns/jscode2session`);
  u.searchParams.set('appid', config.wechat.appid);
  u.searchParams.set('secret', config.wechat.secret);
  u.searchParams.set('js_code', jsCode);
  u.searchParams.set('grant_type', 'authorization_code');

  const json = await fetchJson(u.toString(), {}, 10000);
  if (!json.openid) throw wxErrorOf(json, 'WX_LOGIN_FAILED');
  return json; // { openid, session_key, unionid? }
}

// ============================================================================
// 3. 文本内容安全识别（msgSecCheck v2）
// ============================================================================

/** 把综合结果归一化成好用的样子 */
function normalizeTextResult(json, chunkCount) {
  const r = json.result || {};
  return {
    errcode: json.errcode,
    errmsg: json.errmsg,
    suggest: r.suggest || '',       // pass / review / risky
    label: r.label,                 // 100 正常；10001 广告；20001 时政；20002 色情；20003 辱骂；…
    traceId: json.trace_id || '',
    detail: json.detail || [],
    chunks: chunkCount,
    raw: json,
  };
}

/** risky 比 review 严重；分片取最坏的那一片 */
function worse(a, b) {
  const rank = (s) => (s === 'risky' ? 3 : s === 'review' ? 2 : s === 'pass' ? 1 : 0);
  return rank(b.suggest) > rank(a.suggest) ? b : a;
}

/**
 * 文本内容安全识别
 * @param {{content:string, openid:string, scene?:number, title?:string, nickname?:string}} p
 */
export async function msgSecCheck(p) {
  const content = String(p.content || '');
  if (!content.trim()) {
    return { errcode: 0, errmsg: 'ok', suggest: 'pass', label: 100, traceId: '', detail: [], chunks: 0, skipped: true };
  }
  if (!p.openid) {
    throw new WeChatError('WX_NO_OPENID', '缺少 openid：请先在小程序端调用 /api/login 换取');
  }

  // 超长文本分片送检，避免被 2500 字上限截断后漏检
  const chunks = [];
  for (let i = 0; i < content.length && chunks.length < TEXT_MAX_CHUNKS; i += TEXT_CHUNK) {
    chunks.push(content.slice(i, i + TEXT_CHUNK));
  }

  let worst = null;
  let firstErr = null;
  for (let i = 0; i < chunks.length; i++) {
    const body = {
      content: chunks[i],
      version: 2,
      scene: Number(p.scene || config.wechat.scene || 2),
      openid: p.openid,
    };
    // title / nickname 只在第一片带上（官方字段，用于资料类场景）
    if (i === 0 && p.title) body.title = String(p.title).slice(0, 200);
    if (i === 0 && p.nickname) body.nickname = String(p.nickname).slice(0, 100);

    const json = await callWithToken('/wxa/msg_sec_check', body);
    if (json.errcode !== 0) {
      if (!firstErr) firstErr = json;
      continue;
    }
    const cur = normalizeTextResult(json, chunks.length);
    worst = worst ? worse(worst, cur) : cur;
  }

  if (!worst) throw wxErrorOf(firstErr || {}, 'WX_SEC_CHECK_FAILED');
  return worst;
}

// ============================================================================
// 4. 多媒体内容安全识别（mediaCheckAsync v2，图片/音频）
// ============================================================================

/**
 * 异步送检图片/音频。结果不会同步返回，而是 30 分钟内推送到消息推送 URL。
 * 返回的 trace_id 用于和推送结果对上号。
 *
 * @param {{mediaUrl:string, mediaType?:1|2, openid:string, scene?:number}} p
 */
export async function mediaCheckAsync(p) {
  if (!p.openid) {
    throw new WeChatError('WX_NO_OPENID', '缺少 openid：请先在小程序端调用 /api/login 换取');
  }
  const body = {
    media_url: p.mediaUrl,
    media_type: Number(p.mediaType || 2), // 1 音频；2 图片
    version: 2,
    scene: Number(p.scene || config.wechat.scene || 2),
    openid: p.openid,
  };
  const json = await callWithToken('/wxa/media_check_async', body, 15000);
  if (json.errcode !== 0) throw wxErrorOf(json, 'WX_MEDIA_CHECK_FAILED');
  return json; // { errcode:0, errmsg:'ok', trace_id }
}

// ============================================================================
// 5. 消息推送（接收 mediaCheckAsync 的异步结果）
// ============================================================================

/** 官方算法：Token、timestamp、nonce 三参数字典序排序后拼接，取 sha1 */
export function verifySignature(signature, timestamp, nonce, token) {
  if (!signature || !timestamp || !nonce || !token) return false;
  const mine = crypto
    .createHash('sha1')
    .update([String(token), String(timestamp), String(nonce)].sort().join(''))
    .digest('hex');
  if (String(signature).length !== mine.length) return false;
  return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(String(signature)));
}

/** 安全模式解密：AES-256-CBC + PKCS7，明文格式为 16字节随机 + 4字节长度 + 内容 + appid */
export function decryptMessage(encryptedBase64, encodingAesKey) {
  const key = Buffer.from(String(encodingAesKey) + '=', 'base64');
  if (key.length !== 32) {
    throw new Error('EncodingAESKey 不合法（应为 43 位 Base64，解出 32 字节）');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const buf = Buffer.concat([
    decipher.update(Buffer.from(String(encryptedBase64), 'base64')),
    decipher.final(),
  ]);
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) throw new Error('PKCS7 填充异常');
  const data = buf.subarray(0, buf.length - pad);
  const len = data.readUInt32BE(16);
  return data.subarray(20, 20 + len).toString('utf8');
}

/** 极简 XML 取值（消息推送 XML 是扁平结构，不值得引入 xml 库） */
export function xmlPick(xml, tag) {
  const re = new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, 'i');
  const m = String(xml).match(re);
  return m ? m[1] : '';
}

/** 从推送体里取出密文（JSON 的 Encrypt 字段或 XML 的 <Encrypt>） */
function pickEncrypt(raw) {
  const s = String(raw || '');
  const t = s.trim();
  if (t.startsWith('{')) {
    try {
      const j = JSON.parse(t);
      return j.Encrypt || '';
    } catch {
      return '';
    }
  }
  return xmlPick(s, 'Encrypt');
}

/**
 * 解析并验签消息推送请求
 * @param {string} rawBody 原始请求体
 * @param {URLSearchParams} query 查询参数
 * @returns {{ok:boolean, code?:string, event?:object, error?:string}}
 */
export function parsePushEvent(rawBody, query) {
  const { token, encodingAesKey } = config.wechat;
  if (!token) {
    return { ok: false, code: 'NO_TOKEN', error: '服务端未配置消息推送 Token（wechat.json 的 token）' };
  }
  const signature = query.get('signature') || '';
  const timestamp = query.get('timestamp') || '';
  const nonce = query.get('nonce') || '';
  if (!verifySignature(signature, timestamp, nonce, token)) {
    return { ok: false, code: 'BAD_SIGNATURE', error: '签名校验不通过' };
  }

  let body = String(rawBody || '');
  const enc = pickEncrypt(body);
  if (enc) {
    if (!encodingAesKey) {
      return { ok: false, code: 'NO_AES_KEY', error: '收到加密推送但未配置 EncodingAESKey' };
    }
    try {
      body = decryptMessage(enc, encodingAesKey);
    } catch (e) {
      return { ok: false, code: 'DECRYPT_FAILED', error: e.message };
    }
  }

  const event = {};
  const t = body.trim();
  if (t.startsWith('{')) {
    try {
      Object.assign(event, JSON.parse(t));
    } catch (e) {
      return { ok: false, code: 'BAD_JSON', error: e.message };
    }
  } else {
    for (const k of ['ToUserName', 'FromUserName', 'CreateTime', 'MsgType', 'Event', 'appid', 'trace_id', 'version', 'errcode', 'errmsg']) {
      event[k] = xmlPick(t, k);
    }
    const resultBlock = xmlPick(t, 'result');
    event.result = { suggest: xmlPick(resultBlock, 'suggest'), label: Number(xmlPick(resultBlock, 'label')) || undefined };
  }
  return { ok: true, event, plaintext: body };
}

/** 明文推送时，判断是不是我们关心的内容安全事件 */
export function isMediaCheckEvent(event) {
  return event && event.Event === 'wxa_media_check';
}

/** 供 /api/health 显示配置状态（绝不返回 secret 本体） */
export function describeWeChat() {
  const { appid, secret, token, encodingAesKey, publicBaseUrl } = config.wechat;
  return {
    configured: !!(appid && secret),
    appid: appid || '',
    secret_set: !!secret,
    push_token_set: !!token,
    aes_key_set: !!encodingAesKey,
    publicBaseUrl,
    config_file: config.wechat.file,
    config_error: config.wechat.configError || null,
  };
}
