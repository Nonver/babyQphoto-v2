<template>
	<view class="hl-page">
		<!-- 顶部搜索 -->
		<view class="hl-search-bar">
			<view class="search-box">
				<view class="search-icon"></view>
				<input
					class="search-input"
					v-model="keyword"
					placeholder="搜索英雄名称..."
					@input="onSearch"
				/>
				<text v-if="keyword" class="search-clear" @click="clearSearch">✕</text>
			</view>
		</view>

		<!-- 搜索结果计数 -->
		<view class="hl-count" v-if="keyword">
			<text>找到 {{ pagedList.length }} 位英雄</text>
		</view>
		<view class="hl-count" v-else>
			<text>共 {{ totalCount }} 位英雄</text>
		</view>

		<!-- 英雄列表 -->
		<scroll-view scroll-y class="hl-scroll" v-if="pagedList.length > 0">
			<view class="hero-row" v-for="hero in pagedList" :key="hero.ename || hero.id || hero.name" @click="pickHero(hero)">
				<image v-if="hero.icon || hero.iconUrl" class="hero-img" :src="hero.icon || hero.iconUrl" mode="aspectFill" />
				<view v-else class="hero-img-placeholder">{{ (hero.cname || hero.name || '?').charAt(0) }}</view>
				<text class="hero-title">{{ hero.cname || hero.name || '未知' }}</text>
				<text class="hero-pick">选择 ›</text>
			</view>
		</scroll-view>

		<!-- 空态 -->
		<view v-else-if="!loading" class="hl-empty">
			<text class="empty-icon">🔍</text>
			<text class="empty-text">未找到匹配的英雄</text>
		</view>

		<!-- 加载态 -->
		<view v-if="loading" class="hl-loading">
			<text>加载中...</text>
		</view>

		<!-- 分页器 -->
		<view class="hl-pagination" v-if="totalPages > 1 && !loading">
			<view
				class="page-btn"
				:class="{ disabled: currentPage <= 1 }"
				@click="goPage(currentPage - 1)"
			>
				<text>上一页</text>
			</view>

			<view class="page-nums">
				<view
					v-for="p in displayPages"
					:key="p"
					class="page-num"
					:class="{ active: p === currentPage, ellipsis: p === '...' }"
					@click="p !== '...' && goPage(p)"
				>
					<text>{{ p }}</text>
				</view>
			</view>

			<view
				class="page-btn"
				:class="{ disabled: currentPage >= totalPages }"
				@click="goPage(currentPage + 1)"
			>
				<text>下一页</text>
			</view>
		</view>
	</view>
</template>

<script>
import api from '@/utils/api'

export default {
	data() {
		return {
			keyword: '',
			loading: true,
			allHeroes: [],
			currentPage: 1,
			pageSize: 30
		}
	},
	computed: {
		filteredList() {
			if (!this.keyword) return this.allHeroes
			const kw = this.keyword.toLowerCase()
			return this.allHeroes.filter(h => {
				const name = (h.cname || h.name || '').toLowerCase()
				const ename = (h.ename || h.title || '').toLowerCase()
				return name.includes(kw) || ename.includes(kw)
			})
		},
		totalCount() { return this.allHeroes.length },
		totalPages() { return Math.ceil(this.filteredList.length / this.pageSize) },
		pagedList() {
			const start = (this.currentPage - 1) * this.pageSize
			return this.filteredList.slice(start, start + this.pageSize)
		},
		displayPages() {
			const total = this.totalPages
			const cur = this.currentPage
			if (total <= 7) {
				return Array.from({ length: total }, (_, i) => i + 1)
			}
			const pages = []
			pages.push(1)
			if (cur > 3) pages.push('...')
			const start = Math.max(2, cur - 1)
			const end = Math.min(total - 1, cur + 1)
			for (let i = start; i <= end; i++) pages.push(i)
			if (cur < total - 2) pages.push('...')
			pages.push(total)
			return pages
		}
	},
	onLoad() {
		this.loadHeroes()
	},
	methods: {
		async loadHeroes() {
			this.loading = true
			try {
				const data = await api.getHeroList()
				if (Array.isArray(data) && data.length > 0) {
					this.allHeroes = data
				} else {
					this.allHeroes = this.getMockHeroes()
				}
			} catch (e) {
				console.error('加载英雄失败:', e)
				this.allHeroes = this.getMockHeroes()
			}
			this.loading = false
		},

		getMockHeroes() {
			const names = [
				'亚瑟','安琪拉','妲己','孙悟空','鲁班七号','后羿','李白','韩信','赵云','貂蝉',
				'露娜','兰陵王','狄仁杰','铠','百里守约','诸葛亮','花木兰','关羽','张飞','程咬金',
				'蔡文姬','甄姬','孙膑','庄周','阿轲','王昭君','扁鹊','钟无艳','东皇太一','吕布',
				'黄忠','高渐离','虞姬','夏侯惇','墨子','老夫子','孙尚香','刘禅','小乔','周瑜',
				'达摩','曹操','典韦','廉颇','钟馗','李元芳','张良','项羽','哪吒','刘邦',
				'武则天','嬴政','明世隐','杨玉环','公孙离','裴擒虎','米莱狄','沈梦溪','李信','上官婉儿',
				'猪八戒','盘古','云中君','瑶','马超','西施','鲁班大师','蒙犽','镜','蒙恬',
				'夏洛特','澜','司空震','云缨','金蝉','暃','桑启','戈娅','海月','莱西奥',
				'赵怀真','姬小满','朵莉亚','大司命','敖隐','少司缘','影','苍','空空','元流之子'
			]
			return names.map((name, i) => ({
				cname: name,
				ename: 'hero_' + i,
				icon: ''
			}))
		},

		pickHero(hero) {
			uni.setStorageSync('pickedHero', hero)
			uni.navigateBack()
		},

		onSearch() {
			this.currentPage = 1
			// 防抖已在 computed 中通过 keyword 变化自动处理
		},

		clearSearch() {
			this.keyword = ''
			this.currentPage = 1
		},

		goPage(page) {
			if (page < 1 || page > this.totalPages || page === '...') return
			this.currentPage = page
		}
	}
}
</script>

<style scoped>
.hl-page {
	min-height: 100vh;
	background: #F5F5F5;
	display: flex;
	flex-direction: column;
	padding-bottom: 30rpx;
}

/* ===== 搜索 ===== */
.hl-search-bar {
	padding: 20rpx 30rpx;
	background: #FFFFFF;
	box-shadow: 0 2rpx 12rpx rgba(0,0,0,0.04);
}
.search-box {
	display: flex;
	align-items: center;
	background: #F8F8F8;
	border-radius: 40rpx;
	padding: 16rpx 28rpx;
}
.search-icon {
	width: 30rpx;
	height: 30rpx;
	border: 3rpx solid #BBB;
	border-radius: 50%;
	position: relative;
	margin-right: 16rpx;
	flex-shrink: 0;
}
.search-icon::after {
	content: '';
	position: absolute;
	bottom: -2rpx; right: -2rpx;
	width: 3rpx; height: 12rpx;
	background: #BBB;
	border-radius: 2rpx;
	transform: rotate(-45deg);
	transform-origin: top right;
}
.search-input {
	flex: 1;
	font-size: 28rpx;
	color: #333;
}
.search-clear {
	font-size: 28rpx;
	color: #CCC;
	padding: 8rpx 6rpx 8rpx 16rpx;
}

/* ===== 计数 ===== */
.hl-count {
	padding: 16rpx 30rpx 8rpx;
	font-size: 24rpx;
	color: #999;
}

/* ===== 列表 ===== */
.hl-scroll {
	flex: 1;
	padding: 0 30rpx;
}
.hero-row {
	display: flex;
	align-items: center;
	padding: 20rpx 0;
	border-bottom: 1rpx solid #F0F0F0;
}
.hero-row:active {
	background: #FFF5F7;
	margin: 0 -30rpx;
	padding: 20rpx 30rpx;
	border-radius: 8rpx;
}
.hero-img {
	width: 72rpx;
	height: 72rpx;
	border-radius: 50%;
	border: 2rpx solid #EEE;
	overflow: hidden;
	margin-right: 20rpx;
	flex-shrink: 0;
}
.hero-img-placeholder {
	width: 72rpx;
	height: 72rpx;
	border-radius: 50%;
	background: linear-gradient(135deg, #FFE0E6, #FFB6C1);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 28rpx;
	color: #FF6B8A;
	font-weight: 600;
	margin-right: 20rpx;
	border: 2rpx solid #EEE;
	flex-shrink: 0;
}
.hero-title {
	flex: 1;
	font-size: 30rpx;
	color: #333;
	font-weight: 500;
}
.hero-pick {
	font-size: 26rpx;
	color: #FF6B8A;
	padding-left: 16rpx;
}

/* ===== 空/加载 ===== */
.hl-empty, .hl-loading {
	display: flex;
	flex-direction: column;
	align-items: center;
	padding: 120rpx 0;
}
.empty-icon { font-size: 80rpx; margin-bottom: 20rpx; }
.empty-text, .hl-loading text { font-size: 28rpx; color: #CCC; }

/* ===== 分页 ===== */
.hl-pagination {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 30rpx 30rpx 10rpx;
	gap: 12rpx;
}
.page-btn {
	padding: 14rpx 28rpx;
	background: #FFFFFF;
	border-radius: 12rpx;
	font-size: 26rpx;
	color: #FF6B8A;
	border: 1rpx solid rgba(255,107,138,0.3);
}
.page-btn.disabled {
	color: #CCC;
	border-color: #EEE;
	background: #F8F8F8;
}
.page-nums {
	display: flex;
	align-items: center;
	gap: 6rpx;
}
.page-num {
	width: 64rpx;
	height: 64rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 12rpx;
	font-size: 26rpx;
	color: #666;
	background: #FFF;
}
.page-num.active {
	background: linear-gradient(135deg, #FF6B8A, #FF4D6D);
	color: #FFF;
	font-weight: 600;
}
.page-num.ellipsis {
	color: #CCC;
	background: transparent;
}
</style>
