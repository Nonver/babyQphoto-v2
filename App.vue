<script>
	import { ensureOpenid } from '@/utils/wechat'

	export default {
		onLaunch() {
			console.log('[App] Launch')
			// 内容安全：启动时就换取一次 openid。
			// 微信要求检测接口用的 openid 必须来自「近两小时访问过小程序」的用户，
			// 提前登录能显著降低首次解析时被 61010 挡掉的概率。
			// 失败也不打扰用户 —— 真正解析时还会再重试一次。
			ensureOpenid()
				.then(() => console.log('[App] 内容安全 openid 已就绪'))
				.catch((e) => console.warn('[App] 预登录失败（解析时会重试）:', (e && (e.message || e.errMsg)) || e))
			// 检查登录状态
			const userInfo = uni.getStorageSync('userInfo')
			if (userInfo) {
				console.log('[App] 用户已登录:', userInfo.nickname)
			}
		},
		onShow() {
			console.log('[App] Show')
		},
		onHide() {
			console.log('[App] Hide')
		}
	}
</script>

<style lang="scss">
	/* 全局样式 */
	page {
		background: #F5F5F5;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
		font-size: 28rpx;
		color: #333;
		-webkit-font-smoothing: antialiased;
	}

	/* 主题色变量 */
	:root {
		--primary: #FF6B8A;
		--primary-dark: #FF4D6D;
		--primary-light: #FFF0F3;
		--bg: #F5F5F5;
		--card: #FFFFFF;
		--text: #333333;
		--text-secondary: #666666;
		--text-light: #999999;
		--text-placeholder: #BBBBBB;
		--border: #F0F0F0;
	}

	/* 通用工具类 */
	.flex-center {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.flex-between {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.text-ellipsis {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.safe-bottom {
		padding-bottom: constant(safe-area-inset-bottom);
		padding-bottom: env(safe-area-inset-bottom);
	}
</style>
