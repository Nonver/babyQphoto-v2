/**
 * 下载中转
 *
 * 为什么必须有这一层？
 * 小程序的 downloadFile 只能访问「已备案且在后台白名单里」的域名，
 * 而抖音视频 CDN（douyinvod.com 等）你无法加进白名单。
 * 所以由本服务把抖音 CDN 的内容流式转发给前端，前端只需访问本服务。
 *
 * 同时透传 Range，保证视频可以拖动进度条 / 断点续传。
 */
import { Readable } from 'node:stream';
import { config } from './config.js';

/** 允许被中转的域名后缀（防止本服务变成开放代理） */
const ALLOWED_HOST_SUFFIX = [
  '.douyinvod.com',
  '.douyin.com',
  '.iesdouyin.com',
  '.douyinpic.com',
  '.douyinstatic.com',
  '.douyincdn.com',
  '.byteimg.com',
  '.bytimg.com',
  '.zjcdn.com',
  '.snssdk.com',
  '.amemv.com',
  '.ixigua.com',
  '.pstatp.com',
  '.bytecdn.cn',
  '.bytedance.com',
  '.bytegoofy.com',
  '.ibytedtos.com',
];

/**
 * 判断目标地址是否允许中转
 * @param {string} raw
 * @returns {boolean}
 */
export function isAllowedSource(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  // 精确域名或子域匹配
  return ALLOWED_HOST_SUFFIX.some((s) => host === s.slice(1) || host.endsWith(s));
}

/** 从 URL 猜一个靠谱的扩展名 */
export function guessExt(srcUrl, fallback = 'bin') {
  try {
    const u = new URL(srcUrl);
    const m = u.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (m) return m[1].toLowerCase();
    // 抖音 CDN 路径通常没有扩展名，靠 mime 判断，这里给常见默认
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * 把远端内容流式转发给客户端
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {string} srcUrl 抖音 CDN 地址
 * @param {string} [filename] 下载文件名
 */
export async function proxyDownload(req, res, srcUrl, filename) {
  if (!isAllowedSource(srcUrl)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: '该地址不在允许中转的范围内' }));
    return;
  }

  /** @type {Record<string,string>} */
  const headers = {
    'User-Agent': config.userAgent,
    'Referer': config.cdnReferer,
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
  };
  // 透传 Range，支持拖动与续传
  if (req.headers.range) headers['Range'] = String(req.headers.range);

  let upstream;
  try {
    upstream = await fetch(srcUrl, { headers, redirect: 'follow' });
  } catch (e) {
    res.statusCode = 502;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: '拉取源文件失败：' + e.message }));
    return;
  }

  res.statusCode = upstream.status;

  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');
  res.setHeader('Cache-Control', 'no-store');

  if (filename) {
    // 兼容中文名：同时给 ASCII 兜底与 RFC 5987 形式
    const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${ascii || 'download'}"; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
  }

  if (!upstream.body) { res.end(); return; }

  const nodeStream = Readable.fromWeb(upstream.body);
  nodeStream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
  req.on('close', () => { try { nodeStream.destroy(); } catch { /* ignore */ } });
  nodeStream.pipe(res);
}
