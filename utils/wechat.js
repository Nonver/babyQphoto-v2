/**
 * 微信内容安全（小程序端封装）
 *
 * 背景：微信小程序审核要求 UGC 类小程序接入内容安全能力，否则会以
 *      《微信小程序平台运营规范 5.18》驳回。本文件负责：
 *        1. wx.login 拿 code → 调后端 /api/login 换 openid
 *           （官方要求：msgSecCheck / mediaCheckAsync 的 openid 必须是
 *            「近两小时访问过小程序」的用户）
 *        2. 文本检测：msgSecCheck v2（同步，能立刻判断拦不拦）
 *        3. 图片检测：mediaCheckAsync v2（异步，结果稍后由微信推回服务端）
 *
 * 设计原则：这两个封装**不抛异常**，统一返回 { status }，让页面自己决定怎么处理：
 *         status = 'pass' | 'risky' | 'review' | 'error'
 *   AppSecret 只在服务端，这里永远碰不到。
 */
import api from './api'

const K_OPENID = 'sec_openid'
const K_TIME = 'sec_openid_time'

/** openid 缓存 90 分钟：官方要求近两小时访问过小程序，留点余量提前重登 */
const OPENID_TTL = 90 * 60 * 1000

let _openid = ''
let _pending = null

function readCache() {
  try {
    const id = uni.getStorageSync(K_OPENID)
    const t = Number(uni.getStorageSync(K_TIME)) || 0
    if (id && Date.now() - t < OPENID_TTL) {
      _openid = id
      return id
    }
  } catch (e) { /* 忽略存储异常 */ }
  return ''
}

/** 取当前缓存的 openid（可能为空） */
export function getOpenid() {
  return _openid || readCache()
}

/** 清掉缓存的 openid（检测接口报 openid 失效时用） */
export function resetOpenid() {
  _openid = ''
  try {
    uni.removeStorageSync(K_OPENID)
    uni.removeStorageSync(K_TIME)
  } catch (e) { /* 忽略 */ }
}

/** wx.login 取临时登录凭证 code */
function loginCode() {
  return new Promise((resolve, reject) => {
    uni.login({
      success: (res) => {
        if (res && res.code) resolve(res.code)
        else reject(new Error('wx.login 没有返回 code'))
      },
      fail: (err) => reject(new Error((err && err.errMsg) || 'wx.login 调用失败'))
    })
  })
}

/**
 * 确保有可用 openid（并发调用只会真的登录一次）
 * @param {boolean} [force] 强制重新登录
 * @returns {Promise<string>}
 */
export async function ensureOpenid(force) {
  if (!force) {
    const cached = getOpenid()
    if (cached) return cached
  }
  if (_pending) return _pending
  _pending = (async () => {
    try {
      const code = await loginCode()
      const openid = await api.wxLogin(code)
      _openid = openid
      try {
        uni.setStorageSync(K_OPENID, openid)
        uni.setStorageSync(K_TIME, Date.now())
      } catch (e) { /* 忽略 */ }
      return openid
    } finally {
      _pending = null
    }
  })()
  return _pending
}

/**
 * 文本内容安全检测
 * @param {string} content 要检测的文本
 * @param {{scene?:number, title?:string, nickname?:string}} [opts]
 * @returns {Promise<{status:'pass'|'risky'|'review'|'error', label?:number, traceId?:string, code?:string, message?:string}>}
 */
export async function secCheckText(content, opts = {}) {
  const text = String(content == null ? '' : content)
  if (!text.trim()) return { status: 'pass', label: 100, traceId: '' }
  const scene = opts.scene || 2

  try {
    let openid = await ensureOpenid()
    let r = await api.secCheck({ content: text, openid, scene, title: opts.title, nickname: opts.nickname })
    // 61010（用户访问记录超时）/ 40003（openid 不合法）→ 重新登录后再试一次
    if (r && r.code === 'OPENID_EXPIRED') {
      openid = await ensureOpenid(true)
      r = await api.secCheck({ content: text, openid, scene, title: opts.title, nickname: opts.nickname })
    }
    return r
  } catch (e) {
    return { status: 'error', code: 'NETWORK', message: (e && (e.errMsg || e.message)) || '网络异常' }
  }
}

/**
 * 图片内容安全检测（异步）
 * 调用成功只代表「已送去检测」，结果由微信在 30 分钟内推回服务端；
 * 判违规的图片会被服务端拉黑，之后解析结果里不会再出现。
 * @param {string} url 抖音 CDN 原始地址
 * @param {1|2} [mediaType] 1 音频；2 图片
 */
export async function secCheckMedia(url, mediaType = 2) {
  try {
    const openid = await ensureOpenid()
    return await api.mediaCheck({ mediaUrl: url, mediaType, openid })
  } catch (e) {
    return { ok: false, code: 'NETWORK', message: (e && (e.errMsg || e.message)) || '网络异常' }
  }
}

/** 把检测结果翻译成能直接给用户看的一句话 */
export function blockReasonText(res) {
  if (!res) return '内容安全检测未通过'
  if (res.status === 'risky') return '内容含违规信息，已拦截'
  if (res.status === 'review') return '内容需要人工复核，暂不支持展示'
  if (res.code === 'WX_NOT_CONFIGURED') return '服务端内容安全组件未配置，请联系管理员'
  if (res.code === 'NETWORK') return '内容安全检测服务连接失败，请检查网络后重试'
  return '内容安全检测暂不可用，请稍后再试'
}
