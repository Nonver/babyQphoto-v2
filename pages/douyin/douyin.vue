<template>
	<view class="dy-page">
		<!-- 头部 -->
		<view class="dy-header">
			<text class="dy-header-icon">🎵</text>
			<text class="dy-header-title">抖音视频/图集去水印</text>
			<text class="dy-header-sub">粘贴抖音分享口令，自动提取无水印视频和图集</text>
		</view>

		<!-- 内容安全说明（小程序审核要求：需明确体现已接入内容安全能力） -->
		<view class="dy-sec-bar">
			<text class="dy-sec-bar-text">🛡 已接入微信内容安全检测 · 输入与展示内容自动送检</text>
		</view>

		<!-- 输入区 -->
		<view class="dy-card">
			<view class="dy-input-row">
				<input
					class="dy-input"
					v-model="inputUrl"
					placeholder="粘贴抖音口令或链接..."
					placeholder-style="color:rgba(255,255,255,0.35)"
					confirm-type="done"
					@confirm="doParse"
					@focus="onInputFocus"
				/>
				<view class="dy-parse-btn" :class="{ disabled: !inputUrl.trim() || parsing }" @click="doParse">
					<text>解析</text>
				</view>
			</view>
			<!-- 链接已提取提示 -->
			<view v-if="extractedUrl && extractedUrl !== inputUrl.trim()" class="dy-url-extracted">
				<text class="dy-extract-label">🔗 已识别链接：</text>
				<text class="dy-extract-url">{{ extractedUrl }}</text>
			</view>
			<view class="dy-quick-actions">
				<text class="dy-quick-link" @click="pasteFromClipboard">📋 粘贴</text>
				<text class="dy-quick-link" @click="inputUrl='';extractedUrl='';result=null;errorMsg='';secPassed=false;secNote=''">✕ 清空</text>
			</view>
			<view v-if="secPassed" class="dy-sec-pass">
				<text>✅ 已通过微信内容安全检测</text>
			</view>
		</view>

		<!-- 内容安全提示（例如检测服务异常时隐藏了第三方文字） -->
		<view v-if="secNote" class="dy-sec-note">
			<text>🛡 {{ secNote }}</text>
		</view>

		<!-- 加载中 -->
		<view v-if="parsing" class="dy-loading">
			<view class="dy-spinner"></view>
			<text class="dy-loading-text">正在解析视频，请稍候...</text>
		</view>

		<!-- 错误 -->
		<view v-if="errorMsg" class="dy-error">
			<text class="dy-error-text">{{ errorMsg }}</text>
		</view>

		<!-- 视频结果 -->
		<view v-if="result && result.type === 'video'" class="dy-result">
			<!-- 视频预览 -->
			<view class="dy-video-preview" @click="previewVideo">
				<image v-if="result.cover" class="dy-cover-img" :src="result.cover" mode="aspectFill" />
				<view v-else class="dy-cover-place">
					<text>🎬</text>
				</view>
				<view class="dy-play-icon">
					<text>▶</text>
				</view>
				<text v-if="result.duration_ms" class="dy-duration">{{ formatDuration(result.duration_ms) }}</text>
			</view>

			<!-- 作者 -->
			<view class="dy-author-row">
				<image v-if="result.author && result.author.avatar" class="dy-author-avatar" :src="result.author.avatar" mode="aspectFill" />
				<view v-else class="dy-author-avatar-placeholder">{{ (result.author && result.author.nickname || '?').charAt(0) }}</view>
				<view class="dy-author-info">
					<text class="dy-author-name">{{ result.author ? result.author.nickname : '未知作者' }}</text>
					<text class="dy-author-uid" v-if="result.author && result.author.uid">抖音号: {{ result.author.uid }}</text>
				</view>
			</view>

			<!-- 标题 -->
			<text class="dy-desc">{{ result.title || '(无标题)' }}</text>

			<!-- 音乐 -->
			<view v-if="result.music && result.music.title" class="dy-music-row">
				<text class="dy-music-icon">🎶</text>
				<view class="dy-music-info">
					<text class="dy-music-title">{{ result.music.title }}</text>
					<text v-if="result.music.author" class="dy-music-author">{{ result.music.author }}</text>
				</view>
			</view>

			<!-- 视频无水印地址 -->
			<view class="dy-url-box">
				<text class="dy-url-text">{{ result.video && result.video.no_watermark }}</text>
				<view class="dy-url-copy-btn" @click="copyVideoUrl">
					<text>复制</text>
				</view>
			</view>

			<!-- 按钮 -->
			<view class="dy-action-btns">
				<view class="dy-btn-dl" @click="previewVideo">
					<text>⬇ 下载视频</text>
				</view>
				<view class="dy-btn-copy" @click="copyAllInfo">
					<text>📝 复制全部信息</text>
				</view>
			</view>
		</view>

		<!-- 图集结果 -->
		<view v-if="result && result.type === 'images'" class="dy-result">
			<!-- 图集数量 -->
			<text class="dy-img-count">共 <text class="dy-count-num">{{ (result.images||[]).length }}</text> 张图片<text v-if="hasAnimated" class="dy-anim-tag"> · 含动图</text></text>
			<text v-if="hasAnimated" class="dy-anim-note">动图为动态 WebP，部分机型保存后可能只保留首帧</text>

			<!-- 图片网格 -->
			<view class="dy-img-grid">
				<view v-for="(img, idx) in (result.images || [])" :key="idx" class="dy-img-item" @click="previewImages(idx)">
					<image class="dy-img-thumb" :src="img.url" mode="aspectFill" />
					<text class="dy-img-idx">{{ idx + 1 }}</text>
					<view class="dy-img-dl-btn" @click.stop="saveImage(idx)">
						<text>保存</text>
					</view>
				</view>
			</view>

			<!-- 作者 -->
			<view class="dy-author-row">
				<image v-if="result.author && result.author.avatar" class="dy-author-avatar" :src="result.author.avatar" mode="aspectFill" />
				<view v-else class="dy-author-avatar-placeholder">{{ (result.author && result.author.nickname || '?').charAt(0) }}</view>
				<view class="dy-author-info">
					<text class="dy-author-name">{{ result.author ? result.author.nickname : '未知作者' }}</text>
					<text class="dy-author-uid" v-if="result.author && result.author.uid">抖音号: {{ result.author.uid }}</text>
				</view>
			</view>

			<!-- 标题 -->
			<text class="dy-desc">{{ result.title || '(无标题)' }}</text>

			<!-- 音乐 -->
			<view v-if="result.music && result.music.title" class="dy-music-row">
				<text class="dy-music-icon">🎶</text>
				<view class="dy-music-info">
					<text class="dy-music-title">{{ result.music.title }}</text>
					<text v-if="result.music.author" class="dy-music-author">{{ result.music.author }}</text>
				</view>
			</view>

			<!-- 按钮 -->
			<view class="dy-action-btns">
				<view class="dy-btn-dl" @click="downloadAllImages">
					<text>⬇ 下载全部图片</text>
				</view>
				<view class="dy-btn-copy" @click="copyAllInfo">
					<text>📝 复制全部信息</text>
				</view>
			</view>
		</view>

		<!-- 底部提示 -->
		<view class="dy-footer">
			<text class="dy-footer-note">内容来自第三方平台，本小程序不提供发布、上传功能</text>
			<text class="dy-footer-note">所有输入与展示内容均通过微信内容安全接口（msgSecCheck / mediaCheckAsync）检测</text>
		</view>
	</view>
</template>

<script>
import api from '@/utils/api'
import { secCheckText, secCheckMedia, blockReasonText } from '@/utils/wechat'

/** 一条解析结果里最多送检几张图片（服务端也有同样上限） */
const MAX_MEDIA_CHECK = 10

export default {
	data() {
		return {
			inputUrl: '',
			extractedUrl: '',
			parsing: false,
			result: null,
			errorMsg: '',
			/** 本次解析是否已通过内容安全检测（界面会显示 ✅ 标记） */
			secPassed: false,
			/** 内容安全相关的提示文字（例如检测服务异常时隐藏了第三方文字） */
			secNote: ''
		}
	},
	computed: {
		/** 是否包含动图（抖音的「动态壁纸」实际是 animated WebP） */
		hasAnimated() {
			if (!this.result) return false
			// 优先采信服务端的判定：图集项若带 video 子对象即为动图，比按 URL 后缀猜更可靠
			if (typeof this.result.has_animated === 'boolean') return this.result.has_animated
			if (!this.result.images) return false
			return this.result.images.some(img => /\.webp(\?|$)/i.test(img.url || ''))
		},
		/** 图集图片地址数组（预览用） */
		imageUrls() {
			const list = (this.result && this.result.images) || []
			return list.map(i => i.url)
		}
	},
	// 分享给好友
	onShareAppMessage() {
		return {
			title: '抖音去水印 - 无水印视频/图集提取',
			path: '/pages/douyin/douyin',
			imageUrl: ''
		}
	},
	// 分享到朋友圈
	onShareTimeline() {
		return {
			title: '抖音去水印 - 无水印视频/图集提取',
			query: '',
			imageUrl: ''
		}
	},
	methods: {
		/** 从抖音分享口令文本中提取链接 */
		extractDouyinUrl(text) {
			if (!text) return ''
			// 匹配 v.douyin.com 短链接（最常见的口令链接格式）
			const match = text.match(/https?:\/\/v\.douyin\.com\/[A-Za-z0-9_\-/]+/)
			if (match) return match[0]
			// 匹配 www.douyin.com 完整链接
			const match2 = text.match(/https?:\/\/(?:www\.)?douyin\.com\/[^\s]+/)
			if (match2) return match2[0]
			// 匹配 iex.douyin.com 等其他子域名
			const match3 = text.match(/https?:\/\/[a-z]+\.douyin\.com\/[^\s]+/)
			if (match3) return match3[0]
			return ''
		},

		/** 输入内容变化时自动提取链接 */
		onInputChange(e) {
			const text = (e && e.detail && e.detail.value) || this.inputUrl || ''
			this.extractedUrl = this.extractDouyinUrl(text)
		},

		/**
		 * 内容安全：把作品里由第三方（抖音）提供的文字收集起来送检。
		 * 这些文字会直接展示给用户，属于规范里要求检测的内容。
		 */
		collectThirdPartyText(data) {
			if (!data) return ''
			const parts = []
			if (data.title) parts.push(data.title)
			if (data.author && data.author.nickname) parts.push('作者：' + data.author.nickname)
			if (data.music && data.music.title) parts.push('音乐：' + data.music.title)
			return parts.join('\n').trim()
		},

		/**
		 * 内容安全：图片异步送检（不阻塞解析流程）。
		 * 送检结果是异步推回服务端的，判违规的地址会被服务端拉黑，
		 * 之后相同地址不会再出现在解析结果里。
		 */
		checkMediaAsync(data) {
			if (!data) return
			const urls = []
			if (data.cover) urls.push(data.cover)
			if (Array.isArray(data.images)) {
				data.images.forEach((im) => { if (im && im.url) urls.push(im.url) })
			}
			urls.slice(0, MAX_MEDIA_CHECK).forEach((u) => {
				secCheckMedia(u, 2).then((r) => {
					if (r && r.ok) console.log('[内容安全] 图片已送检', r.traceId)
					else if (r && r.code !== 'WX_NOT_CONFIGURED') console.warn('[内容安全] 图片送检未成功', r.code, r.message)
				})
			})
		},

		async doParse() {
			const text = this.inputUrl.trim()
			if (!text || this.parsing) return

			// 本地先试提取一次，仅用于界面提示；提取不到也不拦截，交给服务端兜底
			this.extractedUrl = this.extractDouyinUrl(text) || text

			this.parsing = true
			this.errorMsg = ''
			this.result = null
			this.secPassed = false
			this.secNote = ''

			try {
				// ① 内容安全：用户输入先过审（不通过就不往下走）
				const inputCheck = await secCheckText(text, { scene: 2 })
				if (inputCheck.status !== 'pass') {
					this.errorMsg = blockReasonText(inputCheck)
					uni.showToast({ title: inputCheck.status === 'error' ? '内容安全服务不可用' : '内容未通过检测', icon: 'none' })
					this.parsing = false
					return
				}

				// ② 把整段分享文案交给服务端（服务端有更完整的链接识别能力）
				const data = await api.douyinParse(text)

				// ③ 内容安全：第三方文字（标题/作者昵称/音乐名）再查一遍
				const thirdText = this.collectThirdPartyText(data)
				if (thirdText) {
					const r2 = await secCheckText(thirdText, {
						scene: 2,
						title: data.title || '',
						nickname: (data.author && data.author.nickname) || ''
					})
					if (r2.status === 'risky' || r2.status === 'review') {
						this.errorMsg = '该作品的文字信息' + blockReasonText(r2)
						uni.showToast({ title: '内容未通过检测，已拦截', icon: 'none' })
						this.parsing = false
						return
					}
					if (r2.status === 'error') {
						// 检测服务异常时不展示未经检测的文字，但媒体本身仍可正常使用
						data.title = ''
						if (data.author) { data.author.nickname = ''; data.author.uid = '' }
						if (data.music) { data.music.title = ''; data.music.author = '' }
						this.secNote = '内容安全检测暂不可用，已隐藏文字信息（' + (r2.message || '服务异常') + '）'
					}
				}

				this.result = data
				this.secPassed = true

				// ④ 图片异步送检，不阻塞界面
				this.checkMediaAsync(data)

				const msg = data.type === 'images' ? '图集解析成功' : '视频解析成功'
				uni.showToast({ title: msg, icon: 'success' })
			} catch (e) {
				console.error('解析失败:', e)
				this.errorMsg = e.message || '解析失败，请检查链接'
			}
			this.parsing = false
		},

		onInputFocus() {
			// 小程序中自动从剪贴板读取
			if (!this.inputUrl) {
				uni.getClipboardData({
					success: (res) => {
						const txt = (res.data || '').trim()
						if (txt.includes('douyin.com') || txt.includes('抖音')) {
							this.inputUrl = txt
							this.extractedUrl = this.extractDouyinUrl(txt)
						}
					},
					fail: () => {}
				})
			}
		},

		pasteFromClipboard() {
			uni.getClipboardData({
				success: (res) => {
					const txt = (res.data || '').trim()
					this.inputUrl = txt
					this.extractedUrl = this.extractDouyinUrl(txt)
					uni.showToast({ title: '已粘贴', icon: 'success', duration: 1000 })
				},
				fail: () => {
					uni.showToast({ title: '请手动粘贴', icon: 'none' })
				}
			})
		},

		// 下载代理：小程序 downloadFile 无法直连抖音 CDN，统一由解析服务转发
		proxyUrl(originalUrl, filename) {
			return api.buildDownloadUrl(originalUrl, filename)
		},

		copyVideoUrl() {
			const url = this.result && this.result.video && this.result.video.no_watermark
			if (!url) return
			uni.setClipboardData({
				data: url,
				success: () => uni.showToast({ title: '无水印链接已复制', icon: 'success' })
			})
		},

		copyImageUrl(idx) {
			// 改为保存图片
			this.saveImage(idx)
		},

		saveImage(idx) {
			const item = (this.result && this.result.images) ? this.result.images[idx] : null
			if (!item || !item.url) return
			// #ifdef MP-WEIXIN
			this.downloadAndSaveImage(item.url, 'wx')
			// #endif
			// #ifdef MP-TOUTIAO
			this.downloadAndSaveImage(item.url, 'tt')
			// #endif
			// #ifndef (MP-WEIXIN || MP-TOUTIAO)
			uni.setClipboardData({
				data: item.url,
				success: () => uni.showToast({ title: '链接已复制', icon: 'success' })
			})
			// #endif
		},

		downloadAndSaveImage(imageUrl, platform) {
			const getSetting = platform === 'wx' ? wx.getSetting : tt.getSetting
			const authorize = platform === 'wx' ? wx.authorize : tt.authorize
			const openSetting = platform === 'wx' ? wx.openSetting : tt.openSetting

			getSetting({
				success: (res) => {
					if (!res.authSetting['scope.writePhotosAlbum']) {
						authorize({
							scope: 'scope.writePhotosAlbum',
							success: () => this.doDownloadImage(imageUrl),
							fail: () => {
								uni.showModal({
									title: '权限提示',
									content: '保存图片需要相册权限，请在设置中开启',
									success: (r) => { if (r.confirm) openSetting({}) }
								})
							}
						})
					} else {
						this.doDownloadImage(imageUrl)
					}
				}
			})
		},

		doDownloadImage(imageUrl) {
			uni.showLoading({ title: '保存中...', mask: true })
			uni.downloadFile({
				url: this.proxyUrl(imageUrl),
				success: (res) => {
					if (res.statusCode === 200) {
						uni.saveImageToPhotosAlbum({
							filePath: res.tempFilePath,
							success: () => {
								uni.hideLoading()
								uni.showToast({ title: '已保存到相册', icon: 'success' })
							},
							fail: (err) => {
								uni.hideLoading()
								if (err.errMsg && err.errMsg.indexOf('auth deny') > -1) {
									uni.showModal({
										title: '权限提示',
										content: '保存图片需要相册权限，请在设置中开启',
										success: (r) => {
											if (r.confirm) {
												// #ifdef MP-WEIXIN
												wx.openSetting({})
												// #endif
												// #ifdef MP-TOUTIAO
												tt.openSetting({})
												// #endif
											}
										}
									})
								} else {
									uni.showToast({ title: '保存失败，请重试', icon: 'none' })
								}
							}
						})
					} else {
						uni.hideLoading()
						uni.showToast({ title: '下载失败，请重试', icon: 'none' })
					}
				},
				fail: () => {
					uni.hideLoading()
					uni.showToast({ title: '下载失败，请检查网络', icon: 'none' })
				}
			})
		},

		copyAllInfo() {
			const data = this.result
			if (!data) return
			const lines = []
			if (data.title) lines.push('标题：' + data.title)
			if (data.author && data.author.nickname) lines.push('作者：' + data.author.nickname)
			if (data.author && data.author.uid) lines.push('抖音号：' + data.author.uid)
			if (data.music && data.music.title) lines.push('音乐：' + data.music.title + (data.music.author ? ' - ' + data.music.author : ''))
			if (data.create_time) lines.push('发布时间：' + this.formatDate(data.create_time))
			const isImage = data.type === 'images'
			if (isImage) {
				const list = data.images || []
				lines.push('图集（' + list.length + '张）：')
				list.forEach((im, i) => { lines.push('  [' + (i + 1) + '] ' + im.url) })
			} else if (data.video && data.video.no_watermark) {
				lines.push('无水印地址：' + data.video.no_watermark)
			}
			uni.setClipboardData({
				data: lines.join('\n'),
				success: () => uni.showToast({ title: '全部信息已复制', icon: 'success' })
			})
		},

		previewVideo() {
			// 改为下载视频
			this.downloadVideo()
		},

		downloadVideo() {
			const videoUrl = this.result && this.result.video && this.result.video.no_watermark
			if (!videoUrl) return

			// #ifdef MP-WEIXIN
			this.checkPermAndDownloadVideo(videoUrl, 'wx')
			// #endif
			// #ifdef MP-TOUTIAO
			this.checkPermAndDownloadVideo(videoUrl, 'tt')
			// #endif
			// #ifndef (MP-WEIXIN || MP-TOUTIAO)
			uni.setClipboardData({
				data: videoUrl,
				success: () => uni.showModal({
					title: '下载提示',
					content: '无水印视频链接已复制，请在浏览器中打开下载',
					showCancel: false
				})
			})
			// #endif
		},

		checkPermAndDownloadVideo(videoUrl, platform) {
			const getSetting = platform === 'wx' ? wx.getSetting : tt.getSetting
			const authorize = platform === 'wx' ? wx.authorize : tt.authorize
			const openSetting = platform === 'wx' ? wx.openSetting : tt.openSetting

			getSetting({
				success: (res) => {
					if (!res.authSetting['scope.writePhotosAlbum']) {
						authorize({
							scope: 'scope.writePhotosAlbum',
							success: () => this.doDownloadVideo(videoUrl),
							fail: () => {
								uni.showModal({
									title: '权限提示',
									content: '保存视频需要相册权限，请在设置中开启',
									success: (r) => { if (r.confirm) openSetting({}) }
								})
							}
						})
					} else {
						this.doDownloadVideo(videoUrl)
					}
				}
			})
		},

		doDownloadVideo(videoUrl) {
			uni.showLoading({ title: '下载视频中...', mask: true })
			uni.downloadFile({
				url: this.proxyUrl(videoUrl),
				timeout: 120000,
				success: (res) => {
					if (res.statusCode === 200) {
						uni.saveVideoToPhotosAlbum({
							filePath: res.tempFilePath,
							success: () => {
								uni.hideLoading()
								uni.showToast({ title: '视频已保存到相册', icon: 'success' })
							},
							fail: (err) => {
								uni.hideLoading()
								if (err.errMsg && err.errMsg.indexOf('auth deny') > -1) {
									uni.showModal({
										title: '权限提示',
										content: '保存视频需要相册权限，请在设置中开启',
										success: (r) => {
											if (r.confirm) {
												// #ifdef MP-WEIXIN
												wx.openSetting({})
												// #endif
												// #ifdef MP-TOUTIAO
												tt.openSetting({})
												// #endif
											}
										}
									})
								} else {
									uni.showToast({ title: '保存失败，请重试', icon: 'none' })
								}
							}
						})
					} else {
						uni.hideLoading()
						uni.showToast({ title: '下载失败，请重试', icon: 'none' })
					}
				},
				fail: (err) => {
					uni.hideLoading()
					console.error('视频下载失败', err)
					uni.showToast({ title: '下载失败，请检查网络', icon: 'none' })
				}
			})
		},

		previewImages(index) {
			const urls = this.imageUrls
			if (urls.length === 0) return
			uni.previewImage({ urls, current: index || 0 })
		},

		downloadAllImages() {
			const urls = this.imageUrls
			if (urls.length === 0) return

			// #ifdef MP-WEIXIN || MP-TOUTIAO
			const getSetting = (typeof wx !== 'undefined') ? wx.getSetting : tt.getSetting
			const authorize = (typeof wx !== 'undefined') ? wx.authorize : tt.authorize
			const openSetting = (typeof wx !== 'undefined') ? wx.openSetting : tt.openSetting

			const downloadAll = () => {
				this.downloadImagesBatch(urls, 0)
			}

			getSetting({
				success: (res) => {
					if (!res.authSetting['scope.writePhotosAlbum']) {
						authorize({
							scope: 'scope.writePhotosAlbum',
							success: downloadAll,
							fail: () => {
								uni.showModal({
									title: '权限提示',
									content: '保存图片需要相册权限，请在设置中开启',
									success: (r) => { if (r.confirm) openSetting({}) }
								})
							}
						})
					} else {
						downloadAll()
					}
				}
			})
			// #endif

			// #ifndef (MP-WEIXIN || MP-TOUTIAO)
			uni.previewImage({ urls, current: 0, success: () => {
				uni.showToast({ title: '长按图片即可保存', icon: 'none', duration: 2000 })
			}})
			// #endif
		},

		downloadImagesBatch(urls, index) {
			if (index >= urls.length) {
				uni.hideLoading()
				uni.showToast({ title: `已保存${urls.length}张到相册`, icon: 'success' })
				return
			}
			uni.showLoading({ title: `保存中 ${index + 1}/${urls.length}...`, mask: true })
			uni.downloadFile({
				url: this.proxyUrl(urls[index]),
				success: (res) => {
					if (res.statusCode === 200) {
						uni.saveImageToPhotosAlbum({
							filePath: res.tempFilePath,
							success: () => {
								this.downloadImagesBatch(urls, index + 1)
							},
							fail: (err) => {
								// 跳过失败，继续下一张
								console.error('保存失败', urls[index], err)
								this.downloadImagesBatch(urls, index + 1)
							}
						})
					} else {
						this.downloadImagesBatch(urls, index + 1)
					}
				},
				fail: () => {
					this.downloadImagesBatch(urls, index + 1)
				}
			})
		},

		formatDuration(ms) {
			if (!ms) return ''
			const total = Math.floor(Number(ms) / 1000)
			const m = Math.floor(total / 60)
			const sec = total % 60
			return m + ':' + String(sec).padStart(2, '0')
		},

		formatDate(ts) {
			if (!ts) return ''
			const d = new Date(Number(ts) * 1000)
			const p = (n) => String(n).padStart(2, '0')
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
		}
	}
}
</script>

<style scoped>
.dy-page {
	min-height: 100vh;
	background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
	padding: 40rpx 30rpx;
}

/* 头部 */
.dy-header {
	text-align: center;
	margin-bottom: 48rpx;
}
.dy-header-icon {
	font-size: 60rpx;
	display: block;
	margin-bottom: 12rpx;
}
.dy-header-title {
	font-size: 40rpx;
	font-weight: 700;
	color: #FFFFFF;
	letter-spacing: 2rpx;
	display: block;
}
.dy-header-sub {
	font-size: 24rpx;
	color: rgba(255,255,255,0.55);
	margin-top: 12rpx;
	display: block;
}

/* 卡片 */
.dy-card {
	background: rgba(255,255,255,0.06);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 20rpx;
	padding: 24rpx;
	margin-bottom: 24rpx;
}

/* 输入行 */
.dy-input-row {
	display: flex;
	gap: 16rpx;
}
.dy-input {
	flex: 1;
	height: 88rpx;
	background: rgba(255,255,255,0.1);
	border: 1px solid rgba(255,255,255,0.15);
	border-radius: 14rpx;
	padding: 0 24rpx;
	color: #FFFFFF;
	font-size: 28rpx;
}
.dy-parse-btn {
	height: 88rpx;
	padding: 0 36rpx;
	background: linear-gradient(135deg, #FF6B8A, #FF4D6D);
	border-radius: 14rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28rpx;
	font-weight: 600;
	color: #FFF;
	white-space: nowrap;
	flex-shrink: 0;
}
.dy-parse-btn.disabled {
	opacity: 0.5;
}
.dy-parse-btn:active:not(.disabled) {
	transform: scale(0.96);
	opacity: 0.9;
}

/* 已识别链接提示 */
.dy-url-extracted {
	display: flex;
	align-items: center;
	gap: 10rpx;
	margin-top: 16rpx;
	padding: 14rpx 20rpx;
	background: rgba(255, 107, 138, 0.12);
	border: 1px solid rgba(255, 107, 138, 0.25);
	border-radius: 12rpx;
	overflow: hidden;
}
.dy-extract-label {
	font-size: 22rpx;
	color: rgba(255, 255, 255, 0.6);
	white-space: nowrap;
	flex-shrink: 0;
}
.dy-extract-url {
	font-size: 22rpx;
	color: #FF6B8A;
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* 快捷操作 */
.dy-quick-actions {
	display: flex;
	gap: 12rpx;
	margin-top: 18rpx;
}
.dy-quick-link {
	font-size: 22rpx;
	color: rgba(255,255,255,0.45);
	background: rgba(255,255,255,0.06);
	padding: 10rpx 20rpx;
	border-radius: 10rpx;
	border: 1px solid transparent;
}
.dy-quick-link:active {
	color: #FF6B8A;
	border-color: rgba(255,107,138,0.3);
	background: rgba(255,107,138,0.08);
}

/* 加载 */
.dy-loading {
	text-align: center;
	padding: 60rpx 0;
}
.dy-spinner {
	width: 60rpx;
	height: 60rpx;
	border: 4rpx solid rgba(255,255,255,0.15);
	border-top-color: #FF6B8A;
	border-radius: 50%;
	margin: 0 auto 20rpx;
	animation: dySpin 0.8s linear infinite;
}
@keyframes dySpin {
	to { transform: rotate(360deg); }
}
.dy-loading-text {
	font-size: 26rpx;
	color: rgba(255,255,255,0.5);
}

/* 错误 */
.dy-error {
	padding: 24rpx;
	background: rgba(255,107,107,0.1);
	border-radius: 14rpx;
	margin-bottom: 24rpx;
}
.dy-error-text {
	font-size: 26rpx;
	color: #FF6B6B;
	line-height: 1.5;
}

/* 结果 */
.dy-result {
	background: rgba(255,255,255,0.06);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 20rpx;
	padding: 24rpx;
	margin-bottom: 24rpx;
}

/* 视频预览 */
.dy-video-preview {
	position: relative;
	border-radius: 16rpx;
	overflow: hidden;
	margin-bottom: 24rpx;
	background: #000;
	width: 100%;
	height: 0;
	padding-bottom: 177.78%; /* 9:16 */
}
.dy-cover-img {
	position: absolute;
	top: 0; left: 0;
	width: 100%;
	height: 100%;
}
.dy-cover-place {
	position: absolute;
	top: 0; left: 0;
	width: 100%; height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 80rpx;
}
.dy-play-icon {
	position: absolute;
	top: 50%; left: 50%;
	transform: translate(-50%, -50%);
	width: 100rpx;
	height: 100rpx;
	border-radius: 50%;
	background: rgba(0,0,0,0.55);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 36rpx;
	color: #FFF;
}
.dy-duration {
	position: absolute;
	bottom: 16rpx; right: 16rpx;
	background: rgba(0,0,0,0.6);
	color: #FFF;
	padding: 4rpx 16rpx;
	border-radius: 8rpx;
	font-size: 22rpx;
}

/* 作者行 */
.dy-author-row {
	display: flex;
	align-items: center;
	gap: 16rpx;
	margin-bottom: 20rpx;
}
.dy-author-avatar {
	width: 68rpx;
	height: 68rpx;
	border-radius: 50%;
	flex-shrink: 0;
}
.dy-author-avatar-placeholder {
	width: 68rpx;
	height: 68rpx;
	border-radius: 50%;
	background: linear-gradient(135deg, rgba(255,107,138,0.4), rgba(255,77,109,0.4));
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 30rpx;
	color: #FFF;
	flex-shrink: 0;
}
.dy-author-info {
	display: flex;
	flex-direction: column;
}
.dy-author-name {
	font-size: 30rpx;
	font-weight: 600;
	color: #FFF;
}
.dy-author-uid {
	font-size: 22rpx;
	color: rgba(255,255,255,0.4);
	margin-top: 4rpx;
}

/* 描述 */
.dy-desc {
	display: block;
	font-size: 28rpx;
	color: rgba(255,255,255,0.85);
	line-height: 1.6;
	margin-bottom: 24rpx;
	word-break: break-all;
}

/* 音乐 */
.dy-music-row {
	display: flex;
	align-items: center;
	gap: 14rpx;
	padding: 16rpx 20rpx;
	background: rgba(255,255,255,0.04);
	border-radius: 14rpx;
	margin-bottom: 24rpx;
}
.dy-music-icon {
	font-size: 30rpx;
}
.dy-music-info {
	flex: 1;
	display: flex;
	flex-direction: column;
}
.dy-music-title {
	font-size: 26rpx;
	color: rgba(255,255,255,0.75);
	font-weight: 500;
}
.dy-music-author {
	font-size: 22rpx;
	color: rgba(255,255,255,0.4);
	margin-top: 2rpx;
}

/* URL */
.dy-url-box {
	display: flex;
	align-items: center;
	gap: 14rpx;
	background: rgba(0,0,0,0.3);
	border: 1px solid rgba(255,255,255,0.1);
	border-radius: 14rpx;
	padding: 20rpx 24rpx;
	margin-bottom: 24rpx;
}
.dy-url-text {
	flex: 1;
	color: rgba(255,255,255,0.7);
	font-size: 22rpx;
	word-break: break-all;
	overflow: hidden;
	text-overflow: ellipsis;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	-webkit-box-orient: vertical;
}
.dy-url-copy-btn {
	height: 56rpx;
	padding: 0 24rpx;
	background: rgba(255,255,255,0.08);
	border: 1px solid rgba(255,255,255,0.2);
	border-radius: 10rpx;
	display: flex;
	align-items: center;
	font-size: 22rpx;
	color: #FFF;
	flex-shrink: 0;
}
.dy-url-copy-btn:active {
	background: rgba(255,255,255,0.14);
}

/* 按钮 */
.dy-action-btns {
	display: flex;
	gap: 16rpx;
}
.dy-btn-dl, .dy-btn-copy {
	flex: 1;
	height: 80rpx;
	border-radius: 14rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28rpx;
	font-weight: 500;
}
.dy-btn-dl {
	background: linear-gradient(135deg, #FF6B8A, #FF4D6D);
	color: #FFF;
}
.dy-btn-dl:active { opacity: 0.85; }
.dy-btn-copy {
	background: rgba(255,255,255,0.08);
	color: #FFF;
	border: 1px solid rgba(255,255,255,0.2);
}
.dy-btn-copy:active { background: rgba(255,255,255,0.14); }

/* 图集 */
.dy-img-count {
	display: block;
	font-size: 24rpx;
	color: rgba(255,255,255,0.5);
	margin-bottom: 16rpx;
}
.dy-count-num {
	color: #FF6B8A;
	font-weight: 600;
}
.dy-anim-tag {
	color: #FFB84D;
	font-weight: 600;
}
.dy-anim-note {
	display: block;
	font-size: 21rpx;
	color: rgba(255, 184, 77, 0.7);
	margin: -8rpx 0 16rpx;
}
.dy-img-grid {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	margin-bottom: 24rpx;
}
.dy-img-item {
	width: calc(33.33% - 7rpx);
	height: 280rpx;
	border-radius: 12rpx;
	overflow: hidden;
	background: #000;
	position: relative;
	margin-bottom: 10rpx;
}
.dy-img-thumb {
	width: 100%;
	height: 100%;
}
.dy-img-idx {
	position: absolute;
	top: 8rpx; left: 8rpx;
	background: rgba(0,0,0,0.5);
	color: #FFF;
	font-size: 20rpx;
	padding: 2rpx 12rpx;
	border-radius: 6rpx;
}
.dy-img-dl-btn {
	position: absolute;
	bottom: 8rpx; right: 8rpx;
	background: rgba(255,107,138,0.8);
	color: #FFF;
	border-radius: 8rpx;
	font-size: 20rpx;
	padding: 4rpx 16rpx;
}

/* 底部 */
.dy-footer {
	padding: 30rpx 10rpx 20rpx;
}
.dy-footer-note {
	display: block;
	text-align: center;
	font-size: 22rpx;
	color: rgba(255,255,255,0.25);
	line-height: 1.7;
}

/* 内容安全说明条 */
.dy-sec-bar {
	display: flex;
	align-items: center;
	justify-content: center;
	background: rgba(76, 217, 130, 0.10);
	border: 1px solid rgba(76, 217, 130, 0.22);
	border-radius: 12rpx;
	padding: 12rpx 18rpx;
	margin-bottom: 22rpx;
}
.dy-sec-bar-text {
	font-size: 22rpx;
	color: rgba(126, 231, 164, 0.9);
	text-align: center;
}
/* 检测通过标记 */
.dy-sec-pass {
	margin-top: 16rpx;
	padding: 10rpx 18rpx;
	background: rgba(76, 217, 130, 0.10);
	border-radius: 10rpx;
}
.dy-sec-pass text {
	font-size: 22rpx;
	color: #4CD982;
}
/* 检测异常提示 */
.dy-sec-note {
	padding: 18rpx 24rpx;
	background: rgba(255, 184, 77, 0.10);
	border: 1px solid rgba(255, 184, 77, 0.25);
	border-radius: 12rpx;
	margin-bottom: 24rpx;
}
.dy-sec-note text {
	font-size: 22rpx;
	color: #FFB84D;
	line-height: 1.6;
}
</style>
