/**
 * 统一请求封装
 * 用法: import request from '@/utils/request'
 *       const data = await request.get('/material/list', { type: 1 })
 */
import config from './config'

const BASE_URL = config.baseUrl

function doRequest(options) {
  return new Promise((resolve, reject) => {
    const adminToken = uni.getStorageSync('adminToken')
    const userInfo = uni.getStorageSync('userInfo')
    const header = {
      'Content-Type': 'application/json',
      ...options.header
    }
    if (adminToken) {
      header['Authorization'] = 'Bearer ' + adminToken
    } else if (userInfo?.token) {
      // APP用户：发送token用于收藏/历史等接口身份认证
      header['Authorization'] = 'Bearer app_' + userInfo.token
    }

    uni.request({
      url: BASE_URL + '?r=' + encodeURIComponent(options.url || ''),
      method: options.method || 'GET',
      data: options.data || {},
      header,
      timeout: options.timeout || config.timeout,
      success: (res) => {
        const data = res.data
        if (res.statusCode === 200) {
          if (data.code === 200) {
            resolve(data.data)
          } else {
            uni.showToast({ title: data.msg || '请求失败', icon: 'none' })
            reject(new Error(data.msg || '请求失败'))
          }
        } else if (res.statusCode === 401) {
          uni.removeStorageSync('adminToken')
          uni.removeStorageSync('isAdmin')
          uni.showToast({ title: '登录已过期，请重新登录', icon: 'none' })
          reject(new Error('未授权'))
        } else {
          uni.showToast({ title: '服务器异常(' + res.statusCode + ')', icon: 'none' })
          reject(new Error('服务器异常'))
        }
      },
      fail: (err) => {
        uni.showToast({ title: '网络异常，请检查网络', icon: 'none' })
        reject(err)
      }
    })
  })
}

export default {
  get(url, data, options) {
    return doRequest({ url, method: 'GET', data, ...options })
  },
  post(url, data, options) {
    return doRequest({ url, method: 'POST', data, ...options })
  },
  put(url, data, options) {
    return doRequest({ url, method: 'PUT', data, ...options })
  },
  delete(url, data, options) {
    return doRequest({ url, method: 'DELETE', data, ...options })
  },
  /** 上传文件 */
  upload(filePath, params = {}) {
    return new Promise((resolve, reject) => {
      const adminToken = uni.getStorageSync('adminToken')
      const header = {}
      if (adminToken) {
        header['Authorization'] = 'Bearer ' + adminToken
      }
      uni.uploadFile({
        url: BASE_URL + '?r=/upload',
        filePath,
        name: 'file',
        formData: params,
        header,
        success: (res) => {
          try {
            const data = JSON.parse(res.data)
            if (data.code === 200) {
              resolve(data.data)
            } else {
              reject(new Error(data.msg || '上传失败'))
            }
          } catch (e) {
            reject(new Error('解析响应失败: ' + (res.data || '').substring(0, 200)))
          }
        },
        fail: (err) => {
          reject(new Error('网络异常: ' + (err.errMsg || JSON.stringify(err))))
        }
      })
    })
  }
}
