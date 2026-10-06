/**
 * 内容安全本地存储
 *
 * 三个作用：
 *   1. 文本检测结果缓存 —— msgSecCheck 对**未上架**小程序只有 100 次/天配额，
 *      同一段文字重复送检毫无意义，必须命中缓存；
 *   2. 图片违规黑名单 —— mediaCheckAsync 是异步的，结果 30 分钟内才推回来，
 *      判违规的 URL 记进黑名单，之后解析时直接从结果里剔除；
 *   3. 审计日志 —— 每次调用微信接口都把「请求要点 + 微信原始返回」落盘，
 *      审核要求提交「接口调用成功录屏/截图」，这份日志就是证据。
 *
 * 零第三方依赖，落盘失败不影响主流程（比如目录只读时降级为纯内存）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const TEXT_TTL_MS = 24 * 60 * 60 * 1000;      // 文本结果缓存 24 小时
const TRACE_TTL_MS = 2 * 60 * 60 * 1000;      // trace 映射留 2 小时足够（推送 30 分钟内到）
const BLACKLIST_MAX = 5000;                    // 黑名单上限，超出丢最旧的
const AUDIT_MEM_MAX = 200;                     // 内存里保留最近多少条审计记录

/** @type {{text:{}, traces:{}, blacklist:{}, lastOpenid:string, lastOpenidAt:number}} */
let db = { text: {}, traces: {}, blacklist: {}, lastOpenid: '', lastOpenidAt: 0 };
let dirty = false;
let saveTimer = null;
let persistOk = true;
let persistError = '';

const auditMem = [];

export function sha1(s) {
  return crypto.createHash('sha1').update(String(s)).digest('hex');
}

// ---------------------------------------------------------------- 落盘

function load() {
  const file = config.secStoreFile;
  if (!file) return;
  try {
    if (!fs.existsSync(file)) return;
    const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(txt);
    db = {
      text: j.text && typeof j.text === 'object' ? j.text : {},
      traces: j.traces && typeof j.traces === 'object' ? j.traces : {},
      blacklist: j.blacklist && typeof j.blacklist === 'object' ? j.blacklist : {},
      lastOpenid: typeof j.lastOpenid === 'string' ? j.lastOpenid : '',
      lastOpenidAt: Number(j.lastOpenidAt) || 0,
    };
  } catch (e) {
    persistOk = false;
    persistError = '读取 ' + file + ' 失败：' + e.message;
  }
}

function saveNow() {
  if (!dirty || !config.secStoreFile) return;
  try {
    fs.mkdirSync(path.dirname(config.secStoreFile), { recursive: true });
    const tmp = config.secStoreFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), 'utf8');
    fs.renameSync(tmp, config.secStoreFile);
    dirty = false;
    persistOk = true;
    persistError = '';
  } catch (e) {
    persistOk = false;
    persistError = '写入 ' + config.secStoreFile + ' 失败：' + e.message;
  }
}

function markDirty() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, 800);
  if (saveTimer.unref) saveTimer.unref();
}

function prune() {
  const now = Date.now();
  for (const [k, v] of Object.entries(db.text)) {
    if (!v || now - v.ts > TEXT_TTL_MS) delete db.text[k];
  }
  for (const [k, v] of Object.entries(db.traces)) {
    if (!v || now - v.ts > TRACE_TTL_MS) delete db.traces[k];
  }
  const keys = Object.keys(db.blacklist);
  if (keys.length > BLACKLIST_MAX) {
    keys
      .sort((a, b) => (db.blacklist[a].ts || 0) - (db.blacklist[b].ts || 0))
      .slice(0, keys.length - BLACKLIST_MAX)
      .forEach((k) => delete db.blacklist[k]);
  }
}

// ---------------------------------------------------------------- 文本缓存

export function getTextCache(content, scene) {
  const k = sha1(scene + '\n' + String(content));
  const v = db.text[k];
  if (!v) return null;
  if (Date.now() - v.ts > TEXT_TTL_MS) {
    delete db.text[k];
    markDirty();
    return null;
  }
  return { ...v, cached: true };
}

export function setTextCache(content, scene, result) {
  const k = sha1(scene + '\n' + String(content));
  db.text[k] = {
    ts: Date.now(),
    suggest: result.suggest,
    label: result.label,
    traceId: result.traceId || '',
  };
  prune();
  markDirty();
}

// ---------------------------------------------------------------- 图片黑名单

export function isMediaBlocked(url) {
  const v = db.blacklist[sha1(url)];
  return !!(v && (v.suggest === 'risky' || v.suggest === 'review'));
}

export function blockMedia(url, info) {
  db.blacklist[sha1(url)] = {
    ts: Date.now(),
    url: String(url).slice(0, 500),
    suggest: info.suggest || 'risky',
    label: info.label,
    traceId: info.traceId || '',
  };
  prune();
  markDirty();
}

/** 把一组媒体 URL 里已被判违规的剔除 */
export function filterBlocked(urls) {
  return (urls || []).filter((u) => !isMediaBlocked(u));
}

// ---------------------------------------------------------------- trace 映射

export function addTrace(traceId, info) {
  if (!traceId) return;
  db.traces[traceId] = { ts: Date.now(), ...info };
  prune();
  markDirty();
}

export function takeTrace(traceId) {
  const v = db.traces[traceId];
  if (v) {
    delete db.traces[traceId];
    markDirty();
  }
  return v || null;
}

// ---------------------------------------------------------------- openid

export function setLastOpenid(openid) {
  db.lastOpenid = String(openid || '');
  db.lastOpenidAt = Date.now();
  markDirty();
}

export function getLastOpenid() {
  return db.lastOpenid;
}

// ---------------------------------------------------------------- 审计日志

/**
 * 记一条调用记录：内存 + 日志文件 + 控制台
 * @param {{kind:string, ok:boolean, request:object, response:object, note?:string}} rec
 */
export function audit(rec) {
  const entry = { ts: new Date().toISOString(), ...rec };
  auditMem.push(entry);
  if (auditMem.length > AUDIT_MEM_MAX) auditMem.shift();

  const line = JSON.stringify(entry);
  if (config.secLogFile) {
    try {
      fs.mkdirSync(path.dirname(config.secLogFile), { recursive: true });
      fs.appendFileSync(config.secLogFile, line + '\n', 'utf8');
    } catch (e) {
      persistError = '写审计日志失败：' + e.message;
    }
  }
  // 控制台也打一份：WinSW 会把 stdout 落到 logs\*.out.log，方便直接截图取证
  const tag = entry.ok ? 'WX-OK ' : 'WX-ERR';
  console.log(`[${new Date().toLocaleTimeString('zh-CN', { hour12: false })}] ${tag} ${entry.kind} ${JSON.stringify(entry.response)}`);
  return entry;
}

export function recentAudit(n = 20) {
  const k = Math.max(1, Math.min(200, Number(n) || 20));
  return auditMem.slice(-k);
}

export function stats() {
  return {
    text_cache: Object.keys(db.text).length,
    media_blacklist: Object.keys(db.blacklist).length,
    pending_traces: Object.keys(db.traces).length,
    last_openid: db.lastOpenid ? db.lastOpenid.slice(0, 6) + '***' : '',
    store_file: config.secStoreFile,
    log_file: config.secLogFile,
    persist_ok: persistOk,
    persist_error: persistError || null,
  };
}

/** 进程退出前落盘 */
export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveNow();
}

load();
