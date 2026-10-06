<template>
	<view class="pq-page">
		<!-- 顶部 Banner -->
		<view class="pq-banner">
			<view class="banner-bg"></view>
			<view class="banner-content">
				<text class="banner-title">王者荣耀 · 战力查询</text>
				<text class="banner-sub">查询各英雄最低上榜战力</text>
			</view>
		</view>

		<!-- 战区类型选择 -->
		<view class="pq-section">
			<text class="section-label">选择战区</text>
			<view class="zone-tabs">
				<view
					v-for="zone in zones"
					:key="zone.value"
					class="zone-tab"
					:class="{ active: selectedZone === zone.value }"
					@click="selectZone(zone.value)"
				>
					<text class="zone-icon">{{ zone.icon }}</text>
					<text class="zone-label">{{ zone.label }}</text>
					<text class="zone-sub">{{ zone.sub }}</text>
				</view>
			</view>
		</view>

		<!-- 英雄查询 -->
		<view class="pq-section">
			<text class="section-label">输入英雄名查询</text>
			<view class="hero-input-row">
				<input
					class="hero-name-input"
					v-model="heroName"
					placeholder="输入英雄名字，如：李白、妲己"
					confirm-type="search"
					@confirm="doQuery"
				/>
				<text v-if="heroName" class="input-clear" @click="heroName = ''">✕</text>
			</view>

			<!-- 查看英雄列表入口 -->
			<view class="hero-list-link" @click="goHeroList">
				<text class="link-text">查看英雄列表 ›</text>
			</view>
		</view>

		<!-- 查询按钮（查询成功后隐藏） -->
		<view class="pq-action" v-if="!result">
			<view class="query-btn" :class="{ disabled: (!heroName.trim() || querying) }" @click="doQuery">
				<text v-if="querying">查询中...</text>
				<text v-else>🔍 立即查询战力</text>
			</view>
		</view>

		<!-- 查询结果 -->
		<view v-if="result" class="pq-result">
			<view class="result-card">
				<!-- 英雄头部 -->
				<view class="result-hero-center">
					<image v-if="result.photo" class="result-avatar-center" :src="result.photo" mode="aspectFill" />
					<view v-else class="result-avatar-center-placeholder">{{ (result.name || heroName).charAt(0) }}</view>
					<text class="result-hero-name-center">{{ result.name || heroName }}</text>
					<text class="result-alias-center" v-if="result.alias">{{ result.alias }}</text>
				</view>

				<!-- 国标卡片 -->
				<view class="gb-card-white" v-if="result.guobiao || result.gbPower || result.nationalPower">
					<text class="gb-icon">🏆 国标</text>
					<text class="gb-power">{{ formatPower(result.guobiao || result.gbPower || result.nationalPower) }}</text>
				</view>

				<!-- 省/市/区 列表 -->
				<view class="level-list">
					<view class="level-row" v-if="result.province || result.provincePower">
						<text class="level-badge orange">🥉 省标</text>
						<text class="level-area">{{ result.province }}</text>
						<text class="level-power">{{ formatPower(result.provincePower) }}</text>
					</view>
					<view class="level-row" v-if="result.city || result.cityPower">
						<text class="level-badge blue">🥈 市标</text>
						<text class="level-area">{{ result.city }}</text>
						<text class="level-power">{{ formatPower(result.cityPower) }}</text>
					</view>
					<view class="level-row" v-if="result.area || result.areaPower">
						<text class="level-badge green">🥇 区标</text>
						<text class="level-area">{{ result.area }}</text>
						<text class="level-power">{{ formatPower(result.areaPower) }}</text>
					</view>
				</view>

				<!-- 更新时间 -->
				<view class="update-time-row" v-if="result.updateTime || result.time">
					<text class="update-icon">📅</text>
					<text class="update-label">数据更新时间:</text>
					<text class="update-val">{{ result.updateTime || result.time }}</text>
				</view>

				<!-- 操作按钮 -->
				<view class="result-actions-row">
					<view class="action-btn-outline" @click="copyPower">
						<text>复制战力</text>
					</view>
					<view class="action-btn-pink" @click="shareResult">
						<text>分享给好友</text>
					</view>
				</view>

				<!-- 返回搜索 -->
				<view class="back-link" @click="result = null">
					<text>← 返回搜索</text>
				</view>
			</view>
		</view>

		<!-- 底部说明（始终在页面最下方） -->
		<view class="pq-bottom-tips">
			<view class="tip-item">
				<text class="tip-dot"></text>
				<text class="tip-text">输入英雄名称查询最低上榜战力</text>
			</view>
			<view class="tip-item">
				<text class="tip-dot"></text>
				<text class="tip-text">战力数据每周一凌晨5点更新</text>
			</view>
			<view class="tip-item">
				<text class="tip-dot"></text>
				<text class="tip-text">数据仅供参考，以游戏内为准</text>
			</view>
			<view class="tip-item">
				<text class="tip-dot"></text>
				<text class="tip-text">不会改战区？点击上方"改战区教程"</text>
			</view>
		</view>
	</view>
</template>

<script>
import api from '@/utils/api'
import { secCheckText, blockReasonText } from '@/utils/wechat'

export default {
	data() {
		return {
			querying: false,
			showRaw: false,
			selectedZone: 'aqq',
			heroName: '',
			selectedHero: null,
			result: null,
			zones: [
				{ value: 'aqq', label: '安卓QQ', sub: 'AQQ', icon: '🤖' },
				{ value: 'awx', label: '安卓微信', sub: 'AWX', icon: '💬' },
				{ value: 'iqq', label: '苹果QQ', sub: 'IQQ', icon: '🍎' },
				{ value: 'iwx', label: '苹果微信', sub: 'IWX', icon: '📱' }
			]
		}
	},
	computed: {
		hasUnknownFields() {
			if (!this.result) return false
			const knownKeys = ['power', 'minPower', 'score', 'gloryPower', 'maxPower', 'honorPower',
				'rank', 'ranking', 'updateTime', 'time', 'name', 'title', 'extra', 'detail',
				'code', 'msg', 'data']
			return Object.keys(this.result).some(k => !knownKeys.includes(k))
		}
	},
	onShow() {
		// 从英雄列表页返回时自动填入英雄名
		const picked = uni.getStorageSync('pickedHero')
		if (picked) {
			this.selectedHero = picked
			this.heroName = picked.cname || picked.name || ''
			this.result = null
			uni.removeStorageSync('pickedHero')
		}
	},
	// 分享给好友
	onShareAppMessage() {
		const hero = this.result ? `[${this.result.name || this.heroName}]` : ''
		return {
			title: hero ? `${hero}最低上榜战力查询结果` : '王者荣耀战力查询 - 查看各英雄最低上榜战力',
			path: '/pages/power-query/power-query',
			imageUrl: this.result && this.result.photo ? this.result.photo : ''
		}
	},
	// 分享到朋友圈
	onShareTimeline() {
		const hero = this.result ? `[${this.result.name || this.heroName}]` : ''
		return {
			title: hero ? `${hero}最低上榜战力查询结果` : '王者荣耀战力查询 - 查看各英雄最低上榜战力',
			query: '',
			imageUrl: this.result && this.result.photo ? this.result.photo : ''
		}
	},
	methods: {
		goHeroList() {
			uni.navigateTo({ url: '/pages/hero-list/hero-list' })
		},

		selectZone(zone) {
			this.selectedZone = zone
		},

		async doQuery() {
			const name = this.heroName.trim()
			if (!name || this.querying) return
			this.querying = true

			try {
				// 内容安全：英雄名是用户输入且会原样回显，按审核要求先过审
				const inputCheck = await secCheckText(name, { scene: 2 })
				if (inputCheck.status !== 'pass') {
					this.result = null
					uni.showToast({ title: blockReasonText(inputCheck), icon: 'none', duration: 2500 })
					this.querying = false
					return
				}

				const data = await api.getHeroPower(name, this.selectedZone)
				if (data.code === 200 && data.data) {
					this.result = data.data
				} else if (data.code !== undefined && data.code !== 200) {
					this.result = null
					uni.showToast({ title: data.msg || '查询失败', icon: 'none' })
				} else {
					this.result = data
				}
			} catch (e) {
				console.error('战力查询失败:', e)
				this.result = null
				uni.showToast({ title: '查询失败，请重试', icon: 'none' })
			}
			this.querying = false
		},

		getZoneLabel() {
			const zone = this.zones.find(z => z.value === this.selectedZone)
			return zone ? zone.label : this.selectedZone
		},

		formatPower(val) {
			if (val === undefined || val === null || val === '') return '---'
			const num = parseInt(val)
			if (isNaN(num)) return String(val)
			return num.toLocaleString()
		},

		copyPower() {
			const lines = []
			const gb = this.result.guobiao || this.result.gbPower || this.result.nationalPower
			if (gb) lines.push(`国标: ${this.formatPower(gb)}`)
			if (this.result.province) lines.push(`省标 ${this.result.province}: ${this.formatPower(this.result.provincePower)}`)
			if (this.result.city) lines.push(`市标 ${this.result.city}: ${this.formatPower(this.result.cityPower)}`)
			if (this.result.area) lines.push(`区标 ${this.result.area}: ${this.formatPower(this.result.areaPower)}`)
			const text = `【${this.result.name || this.heroName}】战力\n${lines.join('\n')}`
			uni.setClipboardData({ data: text, success: () => {
				uni.showToast({ title: '已复制战力信息', icon: 'success' })
			}})
		},

		shareResult() {
			// #ifdef MP-WEIXIN
			uni.showToast({ title: '请点击右上角分享', icon: 'none' })
			// #endif
			// #ifndef MP-WEIXIN
			uni.showToast({ title: '分享功能开发中', icon: 'none' })
			// #endif
		}
	}
}
</script>

<style scoped>
.pq-page {
	min-height: 100vh;
	background: #F5F5F5;
	padding-bottom: 40rpx;
}

/* ===== Banner ===== */
.pq-banner {
	position: relative;
	margin: 20rpx 30rpx;
	height: 200rpx;
	border-radius: 20rpx;
	overflow: hidden;
}
.banner-bg {
	position: absolute;
	top: 0; left: 0; right: 0; bottom: 0;
	background: linear-gradient(135deg, #1A1A2E 0%, #16213E 40%, #0F3460 100%);
}
.banner-bg::after {
	content: '';
	position: absolute;
	top: -60rpx; right: -40rpx;
	width: 260rpx; height: 260rpx;
	background: radial-gradient(circle, rgba(255,107,138,0.25) 0%, transparent 70%);
	border-radius: 50%;
}
.banner-content {
	position: relative;
	z-index: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100%;
}
.banner-title {
	font-size: 38rpx;
	font-weight: 700;
	color: #FFFFFF;
	letter-spacing: 2rpx;
}
.banner-sub {
	font-size: 24rpx;
	color: rgba(255,255,255,0.6);
	margin-top: 8rpx;
}

/* ===== 分区 ===== */
.pq-section {
	margin: 0 30rpx 24rpx;
}
.section-label {
	display: block;
	font-size: 28rpx;
	font-weight: 600;
	color: #333;
	margin-bottom: 16rpx;
}

/* ===== 战区 Tab ===== */
.zone-tabs {
	display: flex;
	gap: 14rpx;
}
.zone-tab {
	flex: 1;
	background: #FFFFFF;
	border-radius: 16rpx;
	padding: 24rpx 12rpx;
	text-align: center;
	box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
	transition: all 0.3s;
	display: flex;
	flex-direction: column;
	align-items: center;
}
.zone-tab.active {
	background: linear-gradient(135deg, #FF6B8A, #FF4D6D);
	box-shadow: 0 6rpx 20rpx rgba(255,107,138,0.35);
	transform: translateY(-4rpx);
}
.zone-icon {
	font-size: 36rpx;
	margin-bottom: 6rpx;
}
.zone-label {
	font-size: 24rpx;
	font-weight: 500;
	color: #333;
}
.zone-tab.active .zone-label {
	color: #FFF;
}
.zone-sub {
	font-size: 18rpx;
	color: #BBB;
	margin-top: 2rpx;
}
.zone-tab.active .zone-sub {
	color: rgba(255,255,255,0.7);
}

/* ===== 英雄名输入 ===== */
.hero-input-row {
	display: flex;
	align-items: center;
	background: #FFFFFF;
	border-radius: 16rpx;
	padding: 6rpx 24rpx;
	box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.hero-name-input {
	flex: 1;
	height: 88rpx;
	font-size: 28rpx;
	color: #333;
}
.input-clear {
	font-size: 28rpx;
	color: #CCC;
	padding: 12rpx 0 12rpx 16rpx;
}
.hero-list-link {
	text-align: right;
	padding: 12rpx 4rpx 0;
}
.link-text {
	font-size: 24rpx;
	color: #FF6B8A;
}

/* ===== 查询按钮 ===== */
.pq-action {
	padding: 0 30rpx;
	margin-bottom: 30rpx;
}
.query-btn {
	height: 90rpx;
	background: linear-gradient(135deg, #FF6B8A, #FF4D6D);
	border-radius: 18rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 32rpx;
	font-weight: 600;
	color: #FFF;
	box-shadow: 0 6rpx 24rpx rgba(255,107,138,0.35);
	transition: all 0.3s;
}
.query-btn.disabled {
	background: #E0E0E0;
	color: #BBB;
	box-shadow: none;
}
.query-btn:active:not(.disabled) {
	transform: scale(0.98);
	opacity: 0.9;
}

/* ===== 底部说明（自然流，始终在最后） ===== */
.pq-bottom-tips {
	margin: 30rpx 30rpx;
	padding: 24rpx 28rpx;
	background: #FFFFFF;
	border-radius: 16rpx;
	box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.tip-item {
	display: flex;
	align-items: flex-start;
	padding: 8rpx 0;
}
.tip-dot {
	width: 10rpx;
	height: 10rpx;
	border-radius: 50%;
	background: #FF6B8A;
	margin-top: 12rpx;
	margin-right: 14rpx;
	flex-shrink: 0;
}
.tip-text {
	font-size: 24rpx;
	color: #999;
	line-height: 1.5;
}

/* ===== 查询结果 ===== */
.pq-result {
	margin: 0 30rpx 30rpx;
}
.result-card {
	background: #FFFFFF;
	border-radius: 20rpx;
	overflow: hidden;
	box-shadow: 0 4rpx 24rpx rgba(0,0,0,0.08);
	padding: 36rpx 30rpx 0;
}

/* 英雄居中展示 */
.result-hero-center {
	display: flex;
	flex-direction: column;
	align-items: center;
	margin-bottom: 30rpx;
}
.result-avatar-center {
	width: 120rpx;
	height: 120rpx;
	border-radius: 50%;
	border: 4rpx solid rgba(255,107,138,0.3);
	overflow: hidden;
	margin-bottom: 14rpx;
}
.result-avatar-center-placeholder {
	width: 120rpx;
	height: 120rpx;
	border-radius: 50%;
	background: linear-gradient(135deg, #FFE0E6, #FFB6C1);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 44rpx;
	font-weight: 700;
	color: #FF6B8A;
	border: 4rpx solid rgba(255,107,138,0.3);
	margin-bottom: 14rpx;
}
.result-hero-name-center {
	font-size: 36rpx;
	font-weight: 700;
	color: #333;
}
.result-alias-center {
	font-size: 24rpx;
	color: #999;
	margin-top: 6rpx;
}

/* 国标卡片 */
.gb-card-white {
	display: flex;
	align-items: center;
	justify-content: space-between;
	background: linear-gradient(135deg, #FFFBF0, #FFF8E1);
	border: 1rpx solid rgba(255,193,7,0.3);
	border-radius: 16rpx;
	padding: 26rpx 28rpx;
	margin-bottom: 20rpx;
}
.gb-icon {
	font-size: 30rpx;
	font-weight: 600;
	color: #F59E0B;
}
.gb-power {
	font-size: 38rpx;
	font-weight: 700;
	color: #F59E0B;
}

/* 省/市/区列表 */
.level-list {
	margin-bottom: 20rpx;
}
.level-row {
	display: flex;
	align-items: center;
	padding: 22rpx 0;
	border-bottom: 1rpx solid #F5F5F5;
}
.level-row:last-child {
	border-bottom: none;
}
.level-badge {
	width: 140rpx;
	font-size: 26rpx;
	font-weight: 600;
	flex-shrink: 0;
}
.level-badge.orange { color: #F59E0B; }
.level-badge.blue { color: #3B82F6; }
.level-badge.green { color: #10B981; }
.level-area {
	flex: 1;
	font-size: 28rpx;
	font-weight: 500;
	color: #333;
}
.level-power {
	font-size: 32rpx;
	font-weight: 700;
	color: #FF6B8A;
}

/* 更新时间 */
.update-time-row {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 8rpx 0 24rpx;
}
.update-icon {
	font-size: 22rpx;
	margin-right: 6rpx;
}
.update-label {
	font-size: 22rpx;
	color: #BBB;
}
.update-val {
	font-size: 22rpx;
	color: #999;
	margin-left: 6rpx;
}

/* 操作按钮 */
.result-actions-row {
	display: flex;
	gap: 20rpx;
	padding-bottom: 24rpx;
}
.action-btn-outline, .action-btn-pink {
	flex: 1;
	height: 76rpx;
	border-radius: 14rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28rpx;
	font-weight: 500;
}
.action-btn-outline {
	background: #F8F8F8;
	color: #666;
	border: 1rpx solid #EEE;
}
.action-btn-outline:active { background: #EEE; }
.action-btn-pink {
	background: linear-gradient(135deg, #FF6B8A, #FF4D6D);
	color: #FFF;
}
.action-btn-pink:active { opacity: 0.85; }

/* 返回链接 */
.back-link {
	text-align: center;
	padding: 8rpx 0 30rpx;
	font-size: 24rpx;
	color: #CCC;
}

/* ===== 旧兜底 ===== */
.result-grid {
	display: flex;
	flex-wrap: wrap;
	padding: 10rpx;
}

</style>
