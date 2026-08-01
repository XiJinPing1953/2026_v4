<template>
	<view class="app-icon" :style="{ width: size, height: size }">
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			:stroke-width="strokeWidth"
			stroke-linecap="round"
			stroke-linejoin="round"
			style="width: 100%; height: 100%;"
		>
			<path v-if="name === 'user'" d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
			<circle v-if="name === 'user'" cx="12" cy="7" r="4" />

			<rect v-if="name === 'lock'" x="3" y="11" width="18" height="11" rx="2" ry="2" />
			<path v-if="name === 'lock'" d="M7 11V7a5 5 0 0 1 10 0v4" />

			<path v-if="name === 'chart'" d="M18 20V10M12 20V4M6 20v-6" />

			<path v-if="name === 'document'" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
			<polyline v-if="name === 'document'" points="14 2 14 8 20 8" />
			<line v-if="name === 'document'" x1="16" y1="13" x2="8" y2="13" />
			<line v-if="name === 'document'" x1="16" y1="17" x2="8" y2="17" />
			<polyline v-if="name === 'document'" points="10 9 9 9 8 9" />

			<rect v-if="name === 'truck'" x="1" y="3" width="15" height="13" />
			<polygon v-if="name === 'truck'" points="16 8 20 8 23 11 23 16 16 16 16 8" />
			<circle v-if="name === 'truck'" cx="5.5" cy="18.5" r="2.5" />
			<circle v-if="name === 'truck'" cx="18.5" cy="18.5" r="2.5" />

			<path v-if="name === 'bottle'" d="M7 2h10v22H7z M12 2v4 M7 6h10" /> 
			<!-- Simplified bottle: cylinder with neck -->

			<circle v-if="name === 'alert'" cx="12" cy="12" r="10" />
			<line v-if="name === 'alert'" x1="12" y1="8" x2="12" y2="12" />
			<line v-if="name === 'alert'" x1="12" y1="16" x2="12.01" y2="16" />

			<line v-if="name === 'plus'" x1="12" y1="5" x2="12" y2="19" />
			<line v-if="name === 'plus'" x1="5" y1="12" x2="19" y2="12" />
			
			<path v-if="name === 'search'" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			
			<path v-if="name === 'wallet'" d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
			<path v-if="name === 'wallet'" d="M4 6v12a2 2 0 0 0 2 2h14v-4" />
			<path v-if="name === 'wallet'" d="M18 12a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h4v-8h-4z" />
			
			<line v-if="name === 'menu'" x1="4" y1="12" x2="20" y2="12" />
			<line v-if="name === 'menu'" x1="4" y1="6" x2="20" y2="6" />
			<line v-if="name === 'menu'" x1="4" y1="18" x2="20" y2="18" />

			<line v-if="name === 'close'" x1="18" y1="6" x2="6" y2="18" />
			<line v-if="name === 'close'" x1="6" y1="6" x2="18" y2="18" />

			<path v-if="name === 'home'" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			<polyline v-if="name === 'home'" points="9 22 9 12 15 12 15 22" />

			<rect v-if="name === 'calendar'" x="3" y="4" width="18" height="18" rx="2" ry="2" />
			<line v-if="name === 'calendar'" x1="16" y1="2" x2="16" y2="6" />
			<line v-if="name === 'calendar'" x1="8" y1="2" x2="8" y2="6" />
			<line v-if="name === 'calendar'" x1="3" y1="10" x2="21" y2="10" />

			<line v-if="name === 'list'" x1="8" y1="6" x2="21" y2="6" />
			<line v-if="name === 'list'" x1="8" y1="12" x2="21" y2="12" />
			<line v-if="name === 'list'" x1="8" y1="18" x2="21" y2="18" />
			<line v-if="name === 'list'" x1="3" y1="6" x2="3.01" y2="6" />
			<line v-if="name === 'list'" x1="3" y1="12" x2="3.01" y2="12" />
			<line v-if="name === 'list'" x1="3" y1="18" x2="3.01" y2="18" />

            <path v-if="name === 'chevron-right'" d="M9 18l6-6-6-6" />

			<circle v-if="name === 'credit-card'" cx="12" cy="12" r="9" />
			<rect v-if="name === 'credit-card'" x="7" y="10" width="10" height="6" rx="1" />
			<line v-if="name === 'credit-card'" x1="7" y1="8" x2="17" y2="8" />

			<circle v-if="name === 'check-circle'" cx="12" cy="12" r="9" />
			<polyline v-if="name === 'check-circle'" points="8 12 11 15 16 9" />

			<path v-if="name === 'shield'" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
			<polyline v-if="name === 'shield'" points="9 12 11 14 15 9" />

			<circle v-if="name === 'minus-circle'" cx="12" cy="12" r="9" />
			<line v-if="name === 'minus-circle'" x1="8" y1="12" x2="16" y2="12" />
		</svg>
	</view>
</template>

<script setup>
defineProps({
	name: { type: String, required: true },
	size: { type: String, default: '40rpx' },
	strokeWidth: { type: [Number, String], default: 2 }
})
</script>

<style scoped>
.app-icon {
	display: inline-block;
	vertical-align: middle;
    color: inherit; /* Allow parent to control color */
}
</style>
