<template>
	<view class="float-nav" :class="{ 'float-nav--expanded': isExpanded }">
		<!-- Menu Items -->
		<view class="float-nav__menu" v-if="isExpanded">
			<view 
				class="float-nav__item" 
				v-for="(item, index) in menuItems" 
				:key="index"
				@click="handleNavigate(item)"
				:style="{ transitionDelay: `${index * 50}ms` }"
			>
				<text class="float-nav__label">{{ item.label }}</text>
				<view class="float-nav__icon" :class="item.bgClass">
					<AppIcon :name="item.icon" size="32rpx" color="#fff" />
				</view>
			</view>
		</view>

		<!-- Toggle Button -->
		<view class="float-nav__trigger" @click="toggle" :class="{ 'float-nav__trigger--active': isExpanded }">
			<AppIcon :name="isExpanded ? 'close' : 'menu'" size="40rpx" color="#fff" />
		</view>
		
		<!-- Overlay -->
		<view v-if="isExpanded" class="float-nav__overlay" @click="toggle"></view>
	</view>
</template>

<script setup>
import { ref } from 'vue'
import AppIcon from '@/components/base/AppIcon.vue'

const isExpanded = ref(false)

const menuItems = [
	{ label: '工作台', icon: 'home', url: '/pages/index/index', type: 'reLaunch', bgClass: 'bg-primary' },
	{ label: '销售记录', icon: 'document', url: '/pages/sale/list', type: 'navigateTo', bgClass: 'bg-indigo' },
	{ label: '钢瓶档案', icon: 'bottle', url: '/pages/bottle/list', type: 'navigateTo', bgClass: 'bg-teal' },
	{ label: '车辆档案', icon: 'truck', url: '/pages/vehicle/list', type: 'navigateTo', bgClass: 'bg-emerald' },
	{ label: '天然气库存', icon: 'list', url: '/pages/gas-in/list', type: 'navigateTo', bgClass: 'bg-indigo' }
]

function toggle() {
	isExpanded.value = !isExpanded.value
}

function handleNavigate(item) {
	isExpanded.value = false
	if (item.type === 'reLaunch') {
		uni.reLaunch({ url: item.url })
	} else {
		uni.navigateTo({ url: item.url })
	}
}
</script>

<style scoped>
.float-nav {
	position: fixed;
	right: 40rpx;
	bottom: 60rpx; /* Safe area handled by OS usually, but keeping margin */
	z-index: 999;
}

.float-nav__trigger {
	width: 96rpx;
	height: 96rpx;
	background: #1e293b;
	border-radius: 48rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	box-shadow: 0 8rpx 24rpx rgba(15, 23, 42, 0.25);
	transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	position: relative;
	z-index: 1000;
}

.float-nav__trigger:active {
	transform: scale(0.92);
}

.float-nav__trigger--active {
	background: #ef4444;
	transform: rotate(90deg);
}

.float-nav__menu {
	position: absolute;
	bottom: 120rpx;
	right: 0;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	gap: 24rpx;
	z-index: 999;
	padding-bottom: 20rpx; /* Spacing from trigger */
}

.float-nav__item {
	display: flex;
	align-items: center;
	gap: 20rpx;
	opacity: 0;
	transform: translateY(20rpx) scale(0.9);
	animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}

@keyframes slideIn {
	to {
		opacity: 1;
		transform: translateY(0) scale(1);
	}
}

.float-nav__label {
	background: #fff;
	padding: 12rpx 24rpx;
	border-radius: 16rpx;
	font-size: 26rpx;
	font-weight: 500;
	color: #334155;
	box-shadow: 0 4rpx 12rpx rgba(0,0,0,0.08);
}

.float-nav__icon {
	width: 80rpx;
	height: 80rpx;
	border-radius: 40rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	box-shadow: 0 6rpx 16rpx rgba(0,0,0,0.15);
}

.float-nav__overlay {
	position: fixed;
	top: 0;
	left: 0;
	right: 0;
	bottom: 0;
	background: rgba(15, 23, 42, 0.4);
	backdrop-filter: blur(4px);
	z-index: 998;
	animation: fadeIn 0.2s ease forwards;
}

@keyframes fadeIn {
	from { opacity: 0; }
	to { opacity: 1; }
}

/* Colors */
.bg-primary { background: linear-gradient(135deg, #2563eb, #1d4ed8); }
.bg-indigo { background: linear-gradient(135deg, #4f46e5, #4338ca); }
.bg-cyan { background: linear-gradient(135deg, #06b6d4, #0891b2); }
.bg-teal { background: linear-gradient(135deg, #14b8a6, #0d9488); }
.bg-emerald { background: linear-gradient(135deg, #10b981, #059669); }
</style>
