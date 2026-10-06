/**
 * API 接口封装
 * 用法: import api from '@/utils/api'
 *       const data = await api.douyinParse(分享文案或链接)
 *
 * 说明:
 *   - 抖音去水印 → 走本地 Node 解析服务（server/ 目录），见 utils/config.js 的 baseUrl
 *   - 王者战力查询 → 仍走第三方公开接口，不受影响
 */
import config from './config'

/** 带超时的 uni.request Promise 封装 */
function request({ url, method = 'GET', data, header }) {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method,
      data,
      header: header || {},
      timeout: config.timeout,
      success: (res) => resolve(res),
      fail: (err) => reject(err)
    })
  })
}

export default {
  // ==================== 抖音去水印 ====================

  /**
   * 解析抖音分享链接 / 分享文案
   * @param {string} input 完整分享文案或链接（服务端会自动提取链接）
   * @returns {Promise<object>} 归一化后的作品数据
   *   { type:'video'|'images', title, author, cover, duration_ms,
   *     video:{ no_watermark, watermark, size, gears[] } | null,
   *     images:[{url, backup, width, height}], ... }
   */
  async douyinParse(input) {
    const res = await request({
      url: `${config.baseUrl}/api/parse`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { url: input }
    })

    const body = res.data
    if (res.statusCode === 200 && body && body.ok && body.data) {
      return body.data
    }
    throw new Error((body && body.error) || `解析失败（HTTP ${res.statusCode}）`)
  },

  /**
   * 拼接下载中转地址
   * 小程序 downloadFile 只能访问白名单域名，无法直连抖音 CDN，
   * 因此统一由本地/公网服务转发。
   * @param {string} src 抖音 CDN 原始地址
   * @param {string} [name] 期望的文件名
   */
  buildDownloadUrl(src, name) {
    const q = `src=${encodeURIComponent(src)}` + (name ? `&name=${encodeURIComponent(name)}` : '')
    return `${config.baseUrl}/api/download?${q}`
  },

  // ==================== 内容安全（微信小程序审核要求） ====================

  /**
   * wx.login 的 code 换 openid（服务端调 code2Session，AppSecret 不下发）
   * @param {string} code
   * @returns {Promise<string>} openid
   */
  async wxLogin(code) {
    const res = await request({
      url: `${config.baseUrl}/api/login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { code }
    })
    const body = res.data || {}
    if (res.statusCode === 200 && body.ok && body.openid) return body.openid
    const err = new Error((body && body.error) || `登录失败（HTTP ${res.statusCode}）`)
    err.code = body && body.code
    throw err
  },

  /**
   * 文本内容安全检测（msgSecCheck v2）
   * 约定：服务端只要返回 200 就是检测成功，suggest 为 pass/review/risky；
   *      失败时返回 { status:'error', code }，由调用方决定是否拦截。
   */
  async secCheck({ content, openid, scene = 2, title, nickname }) {
    const data = { content, openid, scene }
    if (title) data.title = title
    if (nickname) data.nickname = nickname

    const res = await request({
      url: `${config.baseUrl}/api/sec-check`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data
    })
    const body = res.data || {}
    if (res.statusCode === 200 && body.ok) {
      return {
        status: body.suggest || 'pass',
        label: body.label,
        traceId: body.trace_id || '',
        cached: !!body.cached
      }
    }
    return {
      status: 'error',
      code: body.code || ('HTTP_' + res.statusCode),
      errcode: body.errcode,
      message: body.error || '内容安全检测失败'
    }
  },

  /**
   * 图片/音频内容安全检测（mediaCheckAsync v2，异步）
   * 成功只代表已送检；结果由微信推回服务端，判违规的地址会被服务端拉黑。
   */
  async mediaCheck({ mediaUrl, mediaType = 2, openid, scene = 2 }) {
    const res = await request({
      url: `${config.baseUrl}/api/media-check`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { mediaUrl, mediaType, openid, scene }
    })
    const body = res.data || {}
    if (res.statusCode === 200 && body.ok) {
      return { ok: true, traceId: body.trace_id || '', blocked: !!body.blocked }
    }
    return { ok: false, code: body.code || ('HTTP_' + res.statusCode), message: body.error || '' }
  },

  // ==================== 王者战力查询 ====================

  /** 获取英雄列表 */
  getHeroList() {
    return new Promise((resolve, reject) => {
      uni.request({
        url: 'https://api.xxoo.team/hero/getHeroList.php',
        method: 'GET',
        success: (res) => {
          if (res.statusCode === 200 && res.data) {
            const data = res.data
            if (Array.isArray(data)) resolve(data)
            else if (data.data && Array.isArray(data.data)) resolve(data.data)
            else resolve([])
          } else {
            resolve([])
          }
        },
        fail: (err) => reject(err)
      })
    })
  },

  /** 查询英雄战力 */
  getHeroPower(hero, type) {
    return new Promise((resolve, reject) => {
      uni.request({
        url: 'https://api.xxoo.team/hero/getHeroInfo.php',
        method: 'GET',
        data: { hero, type },
        success: (res) => {
          if (res.statusCode === 200 && res.data) resolve(res.data)
          else reject(new Error('查询失败'))
        },
        fail: (err) => reject(err)
      })
    })
  }
}
