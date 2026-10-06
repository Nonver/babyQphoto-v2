/**
 * 抖音解析核心
 *
 * 流程（全部为纯 HTTP，不需要浏览器）：
 *   1. 从分享文案里抠出链接
 *   2. 短链 302 跳转 → 取 aweme_id
 *   3. 带 ttwid 请求 /aweme/v1/web/aweme/detail/ → 拿到原始 JSON
 *   4. 归一化为统一结构（视频 / 图集）
 *
 * ⚠️ 第 3 步是整个方案的关键：该接口在「无 ttwid」时返回 200 但 body 为空，
 *    带上 ttwid 才返回真实数据。详见 src/ttwid.js 顶部的实测记录。
 */
import { config } from './config.js';
import { getTtwid, invalidateTtwid } from './ttwid.js';

/** 分享文案里的链接（兼容无协议、全角标点、表情） */
const URL_RE = /(https?:\/\/[^\s"'<>，。、）】\u200b]+)|((?:v|www|m)\.douyin\.com\/[^\s"'<>，。、）】\u200b]+)/gi;

/** aweme_id 的各种出现形式 */
const ID_PATTERNS = [
  /\/video\/(\d{10,25})/,
  /\/note\/(\d{10,25})/,
  /\/slides\/(\d{10,25})/,
  /\/share\/video\/(\d{10,25})/,
  /[?&]modal_id=(\d{10,25})/,
  /[?&]aweme_id=(\d{10,25})/,
  /\/discover\/(\d{10,25})/,
  /(\d{18,20})/, // 兜底：分享参数里的 mid/did 也可能命中，故放到最后
];

/* ------------------------------------------------------------------ */
/* 1. 文本 → URL                                                       */
/* ------------------------------------------------------------------ */

/**
 * 从一段分享文案中提取抖音链接
 * @param {string} text 分享文本（可含中文、表情、口令）
 * @returns {string|null} 规范化后的 http(s) 链接
 */
export function extractShareUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.trim();
  // 本身就是一个纯链接
  if (/^(https?:\/\/)?(v|www|m)\.douyin\.com\//i.test(t) && !/\s/.test(t)) {
    return t.startsWith('http') ? t : `https://${t}`;
  }
  URL_RE.lastIndex = 0;
  const m = t.match(URL_RE);
  if (!m || !m.length) return null;
  let u = m[0].trim();
  // 去掉尾部可能粘连的标点
  u = u.replace(/[，。、,.;!！?？"'）)】\]]+$/g, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/* ------------------------------------------------------------------ */
/* 2. URL → aweme_id                                                   */
/* ------------------------------------------------------------------ */

/**
 * 从（已展开的）URL 中提取作品 ID
 * @param {string} url
 * @returns {string|null}
 */
export function extractAwemeId(url) {
  if (!url) return null;
  for (const re of ID_PATTERNS) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 3. 短链跳转                                                          */
/* ------------------------------------------------------------------ */

/**
 * 跟随 302 跳转，拿到最终 URL 与作品 ID。
 * v.douyin.com/xxxx 会跳到 www.douyin.com/video/{id} 或 /note/{id}。
 * @param {string} url
 * @returns {Promise<{finalUrl:string, awemeId:string|null, via:string}>}
 */
export async function resolveShortLink(url) {
  // 已经是 /video/123 形式，无需跳转
  const direct = extractAwemeId(url);
  if (direct && !/v\.douyin\.com\/[A-Za-z0-9_-]+\/?$/.test(url)) {
    return { finalUrl: url, awemeId: direct, via: 'direct' };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.shortlinkTimeoutMs);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': config.userAgent,
        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    });
    const finalUrl = r.url || url;
    // 只需要 URL，不必读 body
    try { await r.body?.cancel(); } catch { /* ignore */ }
    return { finalUrl, awemeId: extractAwemeId(finalUrl), via: 'fetch' };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 4. 详情接口（带 ttwid，纯 HTTP）                                     */
/* ------------------------------------------------------------------ */

/**
 * 拼装详情接口的查询参数。
 * 用桌面版 Chrome 的完整参数集，与抖音 PC 网页保持一致，成功率最高。
 */
function buildDetailQuery(awemeId) {
  const q = new URLSearchParams({
    device_platform: 'webapp',
    aid: '6383',
    channel: 'channel_pc_web',
    aweme_id: awemeId,
    request_source: '600',
    origin_type: 'video_page',
    update_version_code: '170400',
    pc_client_type: '1',
    pc_libra_divert: 'Windows',
    support_h265: '0',
    support_dash: '0',
    cpu_core_num: '12',
    version_code: '190500',
    version_name: '19.5.0',
    cookie_enabled: 'true',
    screen_width: '1440',
    screen_height: '900',
    browser_language: 'zh-CN',
    browser_platform: 'Win32',
    browser_name: 'Chrome',
    browser_version: '138.0.0.0',
    browser_online: 'true',
    engine_name: 'Blink',
    engine_version: '138.0.0.0',
    os_name: 'Windows',
    os_version: '10',
    device_memory: '16',
    platform: 'PC',
    downlink: '10',
    effective_type: '4g',
    round_trip_time: '50',
  });
  return q.toString();
}

/**
 * 发一次详情请求。
 * @returns {Promise<{empty:boolean, status:number, json:object|null}>}
 */
async function requestDetail(awemeId, ttwid) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.parseTimeoutMs);
  try {
    const r = await fetch(`https://www.douyin.com/aweme/v1/web/aweme/detail/?${buildDetailQuery(awemeId)}`, {
      headers: {
        'User-Agent': config.userAgent,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': `https://www.douyin.com/video/${awemeId}`,
        'Cookie': ttwid,
      },
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!text) return { empty: true, status: r.status, json: null };
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { empty: false, status: r.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 获取作品原始数据。
 *
 * 首次为空响应时，会强制刷新 ttwid 再重试一次 —— 这是应对凭证过期的标准姿势，
 * 也让服务可以长期无人值守运行。
 *
 * @param {string} awemeId
 * @returns {Promise<object>} 原始 aweme_detail 对象
 */
export async function fetchAwemeDetail(awemeId) {
  let ttwid = await getTtwid({ awemeId });
  let res = await requestDetail(awemeId, ttwid);

  if (res.empty) {
    invalidateTtwid();
    ttwid = await getTtwid({ force: true, awemeId });
    res = await requestDetail(awemeId, ttwid);
  }

  if (res.empty) {
    const e = new Error('抖音接口没有返回数据（可能被限流或凭证失效），请稍后重试');
    e.code = 'EMPTY_RESPONSE';
    throw e;
  }

  const j = res.json;
  if (!j) {
    const e = new Error('抖音接口返回了非 JSON 内容，可能被风控拦截');
    e.code = 'BAD_RESPONSE';
    throw e;
  }

  if (j.aweme_detail) return j.aweme_detail;

  const e = new Error('该作品不存在、已被删除或设为私密');
  e.code = 'AWEME_NOT_FOUND';
  e.status_code = j.status_code;
  throw e;
}

/* ------------------------------------------------------------------ */
/* 5. 归一化                                                            */
/* ------------------------------------------------------------------ */

const firstUrl = (node) => (node?.url_list && node.url_list[0]) || '';
const restUrls = (node) => (node?.url_list || []).slice(1);

/**
 * 把 aweme_detail 转成前端友好的统一结构
 * @param {object} d 原始 aweme_detail
 */
export function normalizeDetail(d) {
  const images = (d.images || []).map((im) => ({
    url: firstUrl(im),
    backup: restUrls(im),
    width: im.width || 0,
    height: im.height || 0,
    /**
     * 是否为动图。
     * 抖音的「动态壁纸」本质是 animated WebP，在图集结构里会额外挂一个 video 子对象，
     * 这是比「看 URL 后缀是不是 .webp」更可靠的判据。
     */
    animated: !!(im.video && (im.video.play_addr || im.video.bit_rate)),
    /** 动图的视频形态地址（部分机型保存静态帧时可用它兜底） */
    animated_video: im.video ? firstUrl(im.video.play_addr) : '',
  })).filter((x) => x.url);

  const isImages = images.length > 0;
  const v = d.video || {};

  return {
    aweme_id: String(d.aweme_id || ''),
    type: isImages ? 'images' : 'video',
    title: d.desc || '',
    author: {
      nickname: d.author?.nickname || '',
      uid: String(d.author?.uid || ''),
      avatar: firstUrl(d.author?.avatar_thumb),
    },
    cover: firstUrl(v.cover) || firstUrl(v.origin_cover) || images[0]?.url || '',
    duration_ms: v.duration || 0,
    create_time: d.create_time || 0,
    statistics: {
      digg: d.statistics?.digg_count || 0,
      comment: d.statistics?.comment_count || 0,
      share: d.statistics?.share_count || 0,
      collect: d.statistics?.collect_count || 0,
    },
    music: {
      title: d.music?.title || '',
      author: d.music?.author || '',
      url: firstUrl(d.music?.play_url),
    },
    /** 图集里是否含动图（服务端判定，比前端按后缀猜更准） */
    has_animated: images.some((im) => im.animated),
    images,
    video: isImages ? null : {
      /** ✅ 无水印直链（抖音 CDN，有时效） */
      no_watermark: firstUrl(v.play_addr),
      no_watermark_backup: restUrls(v.play_addr),
      /** ⚠️ 带水印（download_addr，URL 里带 watermark=1，不可用于去水印） */
      watermark: firstUrl(v.download_addr),
      size: v.play_addr?.data_size || 0,
      width: v.width || 0,
      height: v.height || 0,
      uri: v.play_addr?.uri || '',
      gears: (v.bit_rate || []).map((b) => ({
        gear: b.gear_name || '',
        quality: b.quality_type ?? null,
        bit_rate: b.bit_rate || 0,
        url: firstUrl(b.play_addr),
      })).filter((g) => g.url),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 6. 并发闸门 + 主入口                                                 */
/* ------------------------------------------------------------------ */

let running = 0;
const waiters = [];
function acquire() {
  if (running < config.maxConcurrent) { running++; return Promise.resolve(); }
  return new Promise((res) => waiters.push(res));
}
function release() {
  running = Math.max(0, running - 1);
  const next = waiters.shift();
  if (next) { running++; next(); }
}

/**
 * 完整解析：分享文案 / 链接 → 归一化结果
 * @param {string} input 分享文案或链接
 * @param {{withUrl?:boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function parse(input, opts = {}) {
  const started = Date.now();
  const url = extractShareUrl(input);
  if (!url) {
    const e = new Error('没有识别到抖音链接，请把完整的分享文案或链接发过来');
    e.code = 'NO_URL';
    throw e;
  }

  await acquire();
  try {
    const { finalUrl, awemeId, via } = await resolveShortLink(url);
    if (!awemeId) {
      const e = new Error('无法从链接中解析出作品 ID，请确认链接有效');
      e.code = 'NO_AWEME_ID';
      throw e;
    }

    const detail = await fetchAwemeDetail(awemeId);
    const data = normalizeDetail(detail);

    if (opts.withUrl !== false) {
      data.source = { input, url, final_url: finalUrl, via, aweme_id: awemeId };
    }
    data.elapsed_ms = Date.now() - started;
    data.notice = '无水印链接为抖音 CDN 临时地址，通常几十分钟内有效，请尽快下载或转存。';
    return data;
  } finally {
    release();
  }
}
