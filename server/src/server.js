/**
 * 洛克农场 —— 抖音去水印服务
 *
 *   POST /api/parse            解析抖音分享链接 / 文案
 *   GET  /api/parse?url=...    同上（便于浏览器直接测试）
 *   GET  /api/download?src=&name=   下载中转（转发抖音 CDN）
 *   GET  /api/health           健康检查
 *   GET  /                     使用说明
 *
 * 内容安全（微信小程序审核要求，2026-09-30 补齐）：
 *   POST /api/login            wx.login 的 code 换 openid（内容安全接口必须要 openid）
 *   POST /api/sec-check        文本内容安全识别（msgSecCheck v2）
 *   POST /api/media-check      图片内容安全识别（mediaCheckAsync v2，异步）
 *   GET  /api/wx-push          微信消息推送 URL 验证
 *   POST /api/wx-push          接收 mediaCheckAsync 的异步结果
 *   GET  /api/sec-check/demo   本机演示接口（给审核录屏取证用）
 *   GET  /api/sec-check/log    本机查看最近的接口调用记录（取证用）
 *
 * 零第三方依赖：只用 Node 18+ 内置模块。
 */
import http from 'node:http';
import { config, describeEnv } from './config.js';
import { parse, extractShareUrl } from './parser.js';
import { proxyDownload, guessExt, isAllowedSource } from './download.js';
import { describeTtwid } from './ttwid.js';
import {
  WeChatError,
  isConfigured,
  code2Session,
  msgSecCheck,
  mediaCheckAsync,
  parsePushEvent,
  isMediaCheckEvent,
  verifySignature,
  describeWeChat,
} from './wechat.js';
import {
  audit,
  recentAudit,
  stats as secStats,
  getLastOpenid,
  setLastOpenid,
  getTextCache,
  setTextCache,
  isMediaBlocked,
  blockMedia,
  addTrace,
  takeTrace,
  flush as flushSecStore,
} from './secstore.js';

const LOG = (level, ...args) => {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${ts}] ${level}`, ...args);
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 1e6) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return resolve({});
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({ __raw: raw }); }
    });
    req.on('error', () => resolve({}));
  });
}

/** 读取原始请求体（消息推送是 XML/JSON 原文，不能当 JSON 解析） */
async function readRawBody(req, limit = 1e6) {
  return new Promise((resolve) => {
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => {
      raw += c;
      if (raw.length > limit) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => resolve(tooBig ? raw.slice(0, limit) : raw));
    req.on('error', () => resolve(raw));
  });
}

/** openid / 敏感串打码后再写日志 */
function mask(s) {
  const t = String(s || '');
  if (t.length <= 8) return t ? '***' : '';
  return t.slice(0, 6) + '***' + t.slice(-2);
}

/** 送检文本的日志摘要（不整段落盘，避免日志里堆用户内容） */
function preview(s, n = 60) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + `…(${t.length}字)` : t;
}

/** 请求是否来自本机（演示/取证接口只对本机开放） */
function isLocalRequest(req) {
  const ip = (req.socket && req.socket.remoteAddress) || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/** 演示接口是否放行：本机，或带对了 demoKey */
function allowDemo(req, query) {
  if (isLocalRequest(req)) return true;
  const k = config.wechat.demoKey;
  return !!(k && query.get('key') === k);
}

/** 调用微信接口失败时，统一决定 HTTP 状态码与给前端的错误码 */
function secErrorReply(res, kind, e, requestInfo) {
  const wx = e instanceof WeChatError ? e.wx : null;
  const errcode = wx && wx.errcode;
  // 61010 用户访问记录超时 / 40003 openid 不合法 → 让小程序重新 wx.login 再试一次
  const needRelogin = errcode === 61010 || errcode === 40003;
  const code = e.code === 'WX_NOT_CONFIGURED'
    ? 'WX_NOT_CONFIGURED'
    : (needRelogin ? 'OPENID_EXPIRED' : (e.code || 'SEC_CHECK_FAILED'));
  audit({ kind, ok: false, request: requestInfo, response: { code, errcode, error: e.message } });
  sendJson(res, e.code === 'WX_NOT_CONFIGURED' ? 503 : 502, {
    ok: false,
    code,
    errcode,
    error: e.code === 'WX_NOT_CONFIGURED'
      ? '服务端还没配置微信 AppID/AppSecret，请先在服务器上配置 wechat.json'
      : e.message,
  });
}

const HTML_HOME = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>洛克农场 · 抖音去水印服务</title>
<style>
 body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#f5f6f8;color:#1f2329;margin:0;padding:32px;line-height:1.7}
 .box{max-width:760px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;box-shadow:0 2px 14px rgba(0,0,0,.06)}
 h1{font-size:22px;margin:0 0 6px}
 .sub{color:#8a9099;font-size:13px;margin-bottom:22px}
 h2{font-size:15px;margin:24px 0 8px;padding-left:9px;border-left:3px solid #ff4d6a}
 code{background:#f2f3f5;padding:2px 6px;border-radius:4px;font-size:13px;color:#c7254e}
 .row{display:flex;gap:8px;margin-top:10px}
 input{flex:1;padding:10px 12px;border:1px solid #dcdfe6;border-radius:8px;font-size:14px;outline:none}
 input:focus{border-color:#ff4d6a}
 button{padding:10px 18px;background:#ff4d6a;color:#fff;border:0;border-radius:8px;font-size:14px;cursor:pointer}
 button:hover{opacity:.9}
 pre{background:#1f2329;color:#c8e1ff;padding:14px;border-radius:8px;overflow:auto;font-size:12px;max-height:420px}
 .ok{color:#12a150}.bad{color:#d93025}
 table{border-collapse:collapse;width:100%;font-size:13px;margin-top:8px}
 td,th{border:1px solid #eaecef;padding:7px 10px;text-align:left}th{background:#fafafa}
</style></head><body><div class="box">
<h1>洛克农场 · 抖音去水印服务</h1>
<div class="sub">纯 Node 运行 · 零第三方依赖 · 不需要浏览器 · <span id="hb">检测中…</span></div>

<h2>在线试用（本机）</h2>
<div class="row"><input id="u" placeholder="粘贴抖音分享文案或链接，例如 https://v.douyin.com/xxxxx/"><button onclick="go()">解析</button></div>
<pre id="out">等待输入…</pre>

<h2>内容安全（微信小程序审核要求）</h2>
<p class="sub" id="secState">检测中…</p>
<div class="row"><input id="c" placeholder="要检测的文本（留空则用默认示例文本）"><button onclick="demoSec()">调用 msgSecCheck（演示）</button></div>
<pre id="secOut">点上面的按钮，这里会显示微信接口的原始返回 —— 审核要求提交的「接口返回值」就是它。</pre>
<p class="sub">该演示按钮只在<strong>服务器本机</strong>（127.0.0.1）可用，调用的就是线上同一套代码。</p>

<h2>接口</h2>
<table>
<tr><th>方法</th><th>路径</th><th>说明</th></tr>
<tr><td>POST</td><td>/api/parse</td><td>body: <code>{"url":"分享文案或链接"}</code></td></tr>
<tr><td>GET</td><td>/api/parse?url=</td><td>同上，便于浏览器调试</td></tr>
<tr><td>GET</td><td>/api/download?src=&name=</td><td>流式转发抖音 CDN（支持 Range）</td></tr>
<tr><td>POST</td><td>/api/login</td><td>body: <code>{"code":"wx.login 的 code"}</code> → openid</td></tr>
<tr><td>POST</td><td>/api/sec-check</td><td>body: <code>{"content":"文本","openid":"...","scene":2}</code>（msgSecCheck v2）</td></tr>
<tr><td>POST</td><td>/api/media-check</td><td>body: <code>{"mediaUrl":"...","mediaType":2,"openid":"..."}</code>（mediaCheckAsync v2）</td></tr>
<tr><td>GET/POST</td><td>/api/wx-push</td><td>微信消息推送：URL 验证 + 接收异步检测结果</td></tr>
<tr><td>GET</td><td>/api/sec-check/log</td><td>最近的接口调用记录（仅本机）</td></tr>
<tr><td>GET</td><td>/api/health</td><td>健康检查</td></tr>
</table>

<script>
async function go(){
  const v=document.getElementById('u').value.trim();
  const out=document.getElementById('out');
  if(!v){out.textContent='请先粘贴链接';return}
  out.textContent='解析中…';
  const t=Date.now();
  try{
    const r=await fetch('/api/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:v})});
    const j=await r.json();
    out.textContent=(r.ok?'✅ 成功':'❌ 失败')+'  '+(Date.now()-t)+'ms\\n\\n'+JSON.stringify(j,null,2);
  }catch(e){out.textContent='请求出错：'+e.message}
}
async function demoSec(){
  const out=document.getElementById('secOut');
  const v=document.getElementById('c').value.trim();
  out.textContent='调用中…';
  try{
    const r=await fetch('/api/sec-check/demo?content='+encodeURIComponent(v));
    const j=await r.json();
    out.textContent=(r.ok?'✅ 微信接口调用成功':'❌ 调用失败')+'\\n\\n'+JSON.stringify(j,null,2);
  }catch(e){out.textContent='请求出错：'+e.message}
}
fetch('/api/health').then(r=>r.json()).then(j=>{
  document.getElementById('hb').innerHTML=j.ok
    ? '<span class="ok">服务正常</span>' : '<span class="bad">异常</span>';
  const w=j.wechat||{};const s=j.security_store||{};
  document.getElementById('secState').innerHTML = w.configured
    ? '<span class="ok">✅ 已接入微信内容安全</span>　AppID '+w.appid
      +'　文本结果缓存 '+s.text_cache+' 条　违规图片黑名单 '+s.media_blacklist+' 条'
    : '<span class="bad">❌ 未配置 AppSecret</span>　请编辑 '+(w.config_file||'wechat.json')+' 后重启服务';
}).catch(()=>{});
</script>
</div></body></html>`;

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let pathname = '/';
  let query = new URLSearchParams();
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = u.pathname;
    query = u.searchParams;
  } catch { /* ignore */ }

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  try {
    // ---- 首页 ----
    if (pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
      res.end(HTML_HOME);
      return;
    }

    // ---- 健康检查 ----
    if (pathname === '/api/health' && req.method === 'GET') {
      const env = describeEnv();
      sendJson(res, 200, {
        ok: true,
        ...env,
        ttwid: describeTtwid(),
        wechat: describeWeChat(),
        security_store: secStats(),
        uptime_s: Math.round(process.uptime()),
      });
      return;
    }

    // ========================================================================
    // 内容安全（微信小程序审核要求）
    // ========================================================================

    // ---- 小程序登录：code → openid ----
    if (pathname === '/api/login' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const code = String(body.code || '').trim();
      if (!code) { sendJson(res, 400, { ok: false, code: 'EMPTY_CODE', error: '请提供 code' }); return; }
      const reqInfo = { js_code: mask(code) };
      try {
        const r = await code2Session(code);
        setLastOpenid(r.openid);
        audit({ kind: 'code2session', ok: true, request: reqInfo, response: { errcode: r.errcode || 0, openid: mask(r.openid) } });
        // 只回 openid，session_key 留在服务端（下发到端上会泄密）
        sendJson(res, 200, { ok: true, openid: r.openid });
      } catch (e) {
        secErrorReply(res, 'code2session', e, reqInfo);
      }
      return;
    }

    // ---- 文本内容安全识别 ----
    if (pathname === '/api/sec-check' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const content = String(body.content || body.text || '');
      const scene = Number(body.scene || config.wechat.scene);
      const openid = String(body.openid || getLastOpenid() || '');
      const reqInfo = { content: preview(content), len: content.length, scene, openid: mask(openid) };

      if (!content.trim()) {
        sendJson(res, 400, { ok: false, code: 'EMPTY_CONTENT', error: '请提供 content' });
        return;
      }
      if (config.wechat.skipCheck) {
        audit({ kind: 'msgSecCheck', ok: true, request: { ...reqInfo, skipped: true }, response: { skipped: true, suggest: 'pass' } });
        sendJson(res, 200, { ok: true, suggest: 'pass', label: 100, trace_id: '', skipped: true });
        return;
      }
      // 先报「未配置」，再报参数问题 —— 配置缺失时这条提示最有用
      if (!isConfigured()) {
        audit({ kind: 'msgSecCheck', ok: false, request: reqInfo, response: { code: 'WX_NOT_CONFIGURED' } });
        sendJson(res, 503, { ok: false, code: 'WX_NOT_CONFIGURED', error: '服务端还没配置微信 AppID/AppSecret，请先在服务器上配置 wechat.json' });
        return;
      }
      if (!openid) {
        sendJson(res, 400, { ok: false, code: 'WX_NO_OPENID', error: '缺少 openid，请先调用 /api/login' });
        return;
      }

      // 命中缓存直接返回 —— msgSecCheck 对未上架小程序只有 100 次/天配额
      const hit = getTextCache(content, scene);
      if (hit) {
        audit({ kind: 'msgSecCheck', ok: true, request: { ...reqInfo, cached: true }, response: { suggest: hit.suggest, label: hit.label, trace_id: hit.traceId } });
        sendJson(res, 200, { ok: true, suggest: hit.suggest, label: hit.label, trace_id: hit.traceId, cached: true });
        return;
      }

      try {
        const r = await msgSecCheck({ content, openid, scene, title: body.title, nickname: body.nickname });
        setTextCache(content, scene, r);
        audit({
          kind: 'msgSecCheck',
          ok: true,
          request: reqInfo,
          response: { errcode: r.errcode, errmsg: r.errmsg, suggest: r.suggest, label: r.label, trace_id: r.traceId, chunks: r.chunks, detail: r.detail },
        });
        sendJson(res, 200, { ok: true, suggest: r.suggest, label: r.label, trace_id: r.traceId, chunks: r.chunks });
      } catch (e) {
        secErrorReply(res, 'msgSecCheck', e, reqInfo);
      }
      return;
    }

    // ---- 图片/音频内容安全识别（异步）----
    if (pathname === '/api/media-check' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const src = String(body.mediaUrl || body.url || '').trim();
      const mediaType = Number(body.mediaType || 2);
      const scene = Number(body.scene || config.wechat.scene);
      const openid = String(body.openid || getLastOpenid() || '');
      const reqInfo = { src: preview(src, 90), media_type: mediaType, scene, openid: mask(openid) };

      if (!src) { sendJson(res, 400, { ok: false, code: 'EMPTY_MEDIA_URL', error: '请提供 mediaUrl' }); return; }
      if (!isAllowedSource(src)) { sendJson(res, 403, { ok: false, code: 'SRC_NOT_ALLOWED', error: '该地址不在允许中转的范围内' }); return; }
      if (config.wechat.skipCheck) {
        audit({ kind: 'mediaCheckAsync', ok: true, request: { ...reqInfo, skipped: true }, response: { skipped: true } });
        sendJson(res, 200, { ok: true, trace_id: '', skipped: true });
        return;
      }
      if (!isConfigured()) {
        audit({ kind: 'mediaCheckAsync', ok: false, request: reqInfo, response: { code: 'WX_NOT_CONFIGURED' } });
        sendJson(res, 503, { ok: false, code: 'WX_NOT_CONFIGURED', error: '服务端还没配置微信 AppID/AppSecret，请先在服务器上配置 wechat.json' });
        return;
      }
      if (!openid) { sendJson(res, 400, { ok: false, code: 'WX_NO_OPENID', error: '缺少 openid，请先调用 /api/login' }); return; }
      if (isMediaBlocked(src)) {
        sendJson(res, 200, { ok: true, blocked: true, trace_id: '', note: '该媒体此前已被判定违规，未重复送检' });
        return;
      }
      // mediaCheckAsync 要求 media_url 能被「微信的检测服务器」下载到，
      // 所以转成我们的公网地址（本服务再流式转发抖音 CDN）。
      if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/i.test(config.wechat.publicBaseUrl)) {
        sendJson(res, 503, {
          ok: false,
          code: 'BAD_PUBLIC_BASE_URL',
          error: 'wechat.json 里的 publicBaseUrl 是本机地址，微信的检测服务器下载不到，请填公网域名',
        });
        return;
      }
      const ext = guessExt(src, mediaType === 1 ? 'mp3' : 'jpg');
      const mediaUrl = `${config.wechat.publicBaseUrl}/api/download?src=${encodeURIComponent(src)}&name=wx_check.${ext}`;

      try {
        const r = await mediaCheckAsync({ mediaUrl, mediaType, openid, scene });
        addTrace(r.trace_id, { url: src, mediaType, scene });
        audit({ kind: 'mediaCheckAsync', ok: true, request: reqInfo, response: { errcode: r.errcode, errmsg: r.errmsg, trace_id: r.trace_id, media_url: mediaUrl } });
        sendJson(res, 200, { ok: true, trace_id: r.trace_id, media_url: mediaUrl });
      } catch (e) {
        secErrorReply(res, 'mediaCheckAsync', e, reqInfo);
      }
      return;
    }

    // ---- 微信消息推送：URL 验证 + 接收异步检测结果 ----
    if (pathname === '/api/wx-push' && (req.method === 'GET' || req.method === 'POST')) {
      if (req.method === 'GET') {
        const signature = query.get('signature') || '';
        const timestamp = query.get('timestamp') || '';
        const nonce = query.get('nonce') || '';
        const echostr = query.get('echostr') || '';
        const ok = !!config.wechat.token && verifySignature(signature, timestamp, nonce, config.wechat.token);
        audit({
          kind: 'wx-push-verify',
          ok,
          request: { timestamp, nonce, has_token: !!config.wechat.token },
          response: { verified: ok },
        });
        res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS });
        res.end(ok ? echostr : 'signature check failed');
        return;
      }

      const raw = await readRawBody(req);
      const parsed = parsePushEvent(raw, query);
      if (!parsed.ok) {
        audit({ kind: 'wx-push-event', ok: false, request: { len: raw.length }, response: { code: parsed.code, error: parsed.error } });
      } else {
        const ev = parsed.event || {};
        audit({
          kind: 'wx-push-event',
          ok: true,
          request: { event: ev.Event, trace_id: ev.trace_id, msgtype: ev.MsgType },
          response: { errcode: ev.errcode, result: ev.result || null, detail: ev.detail || null },
        });
        if (isMediaCheckEvent(ev)) {
          const t = takeTrace(ev.trace_id);
          const suggest = ev.result && ev.result.suggest;
          if (t && (suggest === 'risky' || suggest === 'review')) {
            blockMedia(t.url, { suggest, label: ev.result.label, traceId: ev.trace_id });
            LOG('SEC ', `图片判违规已拉黑 suggest=${suggest} label=${ev.result.label}`);
          }
        }
      }
      // 微信要求及时回包，无特殊要求时空串或 success 均可
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...CORS });
      res.end('success');
      return;
    }

    // ---- 内容安全演示（只允许本机访问；给审核录屏取证）----
    if (pathname === '/api/sec-check/demo' && req.method === 'GET') {
      if (!allowDemo(req, query)) {
        sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '该演示接口只允许在服务器本机（127.0.0.1）访问' });
        return;
      }
      const content = query.get('content') || '洛克农场内容安全检测演示';
      const openid = query.get('openid') || getLastOpenid();
      if (!openid) {
        sendJson(res, 409, {
          ok: false,
          code: 'NO_OPENID',
          error: '还没有可用 openid：请先在微信开发者工具里打开一次小程序（会自动触发 /api/login），再回到本页点演示',
        });
        return;
      }
      try {
        const r = await msgSecCheck({ content, openid, scene: config.wechat.scene });
        audit({ kind: 'demo-msgSecCheck', ok: true, request: { content: preview(content), openid: mask(openid) }, response: r.raw });
        sendJson(res, 200, {
          ok: true,
          note: 'wx 字段为微信接口的原始返回，即审核要求提交的「接口返回值」',
          request_body: { content, version: 2, scene: config.wechat.scene, openid: mask(openid) },
          wx: r.raw,
        });
      } catch (e) {
        secErrorReply(res, 'demo-msgSecCheck', e, { content: preview(content), openid: mask(openid) });
      }
      return;
    }

    // ---- 最近的调用记录（只允许本机访问；取证用）----
    if (pathname === '/api/sec-check/log' && req.method === 'GET') {
      if (!allowDemo(req, query)) {
        sendJson(res, 403, { ok: false, code: 'FORBIDDEN', error: '该接口只允许在服务器本机（127.0.0.1）访问' });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        wechat: describeWeChat(),
        store: secStats(),
        items: recentAudit(query.get('n') || 20),
      });
      return;
    }

    // ---- 解析 ----
    if (pathname === '/api/parse' && (req.method === 'POST' || req.method === 'GET')) {
      let input = '';
      if (req.method === 'POST') {
        const body = await readJsonBody(req);
        input = body.url || body.text || body.link || body.__raw || '';
      } else {
        input = query.get('url') || query.get('text') || '';
      }
      if (!input) { sendJson(res, 400, { ok: false, code: 'EMPTY_INPUT', error: '请提供 url 或 text' }); return; }

      LOG('REQ ', `parse ← ${String(input).slice(0, 70)}`);
      try {
        const data = await parse(input);

        // 内容安全：剔除已被判定违规的图片（黑名单由 mediaCheckAsync 的异步推送结果写入）
        const blockedUrls = [];
        if (data.cover && isMediaBlocked(data.cover)) {
          blockedUrls.push(data.cover);
          data.cover = '';
        }
        if (Array.isArray(data.images)) {
          data.images = data.images.filter((im) => {
            if (im && im.url && isMediaBlocked(im.url)) { blockedUrls.push(im.url); return false; }
            return true;
          });
        }
        if (blockedUrls.length) {
          data.blocked_count = blockedUrls.length;
          LOG('SEC ', `parse 剔除 ${blockedUrls.length} 个已被判定违规的媒体`);
        }
        if (data.type === 'images' && (!data.images || data.images.length === 0)) {
          LOG('SEC ', `parse 图集已被全部拦截 ${data.aweme_id}`);
          sendJson(res, 451, { ok: false, code: 'CONTENT_BLOCKED', error: '该内容未通过内容安全策略，已拦截' });
          return;
        }

        LOG('OK  ', `parse ${data.type} ${data.aweme_id} ${Date.now() - started}ms`);
        sendJson(res, 200, { ok: true, data });
      } catch (e) {
        LOG('FAIL', `parse ${e.code || ''} ${e.message} ${Date.now() - started}ms`);
        const status =
          e.code === 'NO_URL' ? 400
            : e.code === 'AWEME_NOT_FOUND' ? 404
              : e.code === 'TTWID_FAILED' ? 503
                : 502;
        sendJson(res, status, { ok: false, code: e.code || 'PARSE_FAILED', error: e.message });
      }
      return;
    }

    // ---- 下载中转 ----
    if (pathname === '/api/download' && req.method === 'GET') {
      const src = query.get('src') || query.get('url');
      if (!src) { sendJson(res, 400, { ok: false, error: '缺少 src 参数' }); return; }
      let name = query.get('name') || '';
      if (!name) {
        const ext = guessExt(src, 'mp4');
        name = `douyin_${Date.now()}.${ext}`;
      }
      LOG('REQ ', `download ← ${String(src).slice(0, 80)}`);
      await proxyDownload(req, res, src, name);
      return;
    }

    sendJson(res, 404, { ok: false, error: '未知路径 ' + pathname });
  } catch (e) {
    LOG('ERR ', e.stack || e.message);
    if (!res.headersSent) {
      sendJson(res, 500, { ok: false, error: e.message });
    } else {
      try { res.end(); } catch { /* ignore */ }
    }
  }
});

server.listen(config.port, config.host, () => {
  const env = describeEnv();
  const w = describeWeChat();
  console.log('');
  console.log('  🎬  洛克农场 · 抖音去水印服务已启动');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  监听地址   http://127.0.0.1:${config.port}`);
  console.log(`  Node       ${env.node}  (${env.platform}/${env.arch})`);
  console.log(`  运行方式   纯 HTTP，不需要浏览器、无第三方依赖`);
  console.log(`  并发上限   ${config.maxConcurrent}   解析超时 ${config.parseTimeoutMs}ms`);
  console.log('  ─────────────────────────────────────────────');
  console.log('  内容安全（微信审核要求）');
  if (config.wechat.skipCheck) {
    console.log('    状态     ⚠️ 已关闭（SEC_SKIP_CHECK=1），仅供本地调试，正式环境必须关掉这个开关');
  } else if (w.configured) {
    console.log(`    状态     ✅ 已配置    AppID ${w.appid}`);
    console.log(`    送检地址 ${w.publicBaseUrl}（mediaCheckAsync 的 media_url 用它）`);
    console.log(`    推送Token ${w.push_token_set ? '已配置' : '未配置（mediaCheckAsync 结果收不到，不影响文本检测）'}`);
  } else {
    console.log('    状态     ❌ 未配置！文本/图片检测会直接拒绝请求');
    console.log(`    请编辑   ${w.file}`);
    console.log('             把 "secret" 填成小程序后台的 AppSecret（32 位），然后重启服务');
  }
  if (w.config_error) console.log(`    配置错误 ${w.config_error}`);
  console.log(`  审计日志   ${config.secLogFile}`);
  console.log('  ─────────────────────────────────────────────');
  console.log(`  内容安全演示（仅本机）： http://127.0.0.1:${config.port}/api/sec-check/demo`);
  console.log('  浏览器打开 http://127.0.0.1:' + config.port + ' 可直接试用');
  console.log('');
});

async function shutdown(sig) {
  LOG('EXIT', `收到 ${sig}，正在关闭…`);
  try { flushSecStore(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  // 兜底：1.5 秒内没关干净就强退
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export { server };
