<template>
	<view class="photos">
		<view class="photos__grid">
			<view v-for="(photo, index) in modelValue" :key="`${index}-${photo.fileId || photo.localPath}`" class="photos__item">
				<image class="photos__image" :src="previewOf(photo)" mode="aspectFill" @click="preview(index)" />
				<view v-if="photo.uploading" class="photos__overlay">上传中…</view>
				<view v-else-if="photo.uploadState === 'failed'" class="photos__overlay photos__overlay--failed">
					<text>上传失败</text>
					<view class="photos__failed-actions">
						<button class="photos__retry" type="button" @click.stop="$emit('retry', index)">重试</button>
						<button class="photos__retry" type="button" @click.stop="remove(index)">删除</button>
					</view>
				</view>
				<text v-else class="photos__remove" @click.stop="remove(index)">×</text>
			</view>
		</view>
		<view v-if="modelValue.length < max" class="photos__actions">
			<button class="photos__button photos__button--primary" type="button" @click="choose('camera')">拍照</button>
			<button class="photos__button" type="button" @click="choose('album')">从相册选择</button>
		</view>
		<text class="photos__tip">{{ required ? '必填' : '选填' }}，已选 {{ modelValue.length }}/{{ max }} 张；选中后立即上传。</text>
	</view>
</template>

<script setup>
import { chooseInspectionImages } from '@/services/stationSafetyInspectionMedia'

const props = defineProps({
	modelValue: { type: Array, default: () => [] },
	max: { type: Number, default: 3 },
	required: { type: Boolean, default: true }
})
const emit = defineEmits(['update:modelValue', 'retry'])

function previewOf(photo) { return String(photo?.localPath || photo?.previewUrl || photo?.fileId || '') }

async function choose(source) {
	try {
		const remain = Math.max(props.max - props.modelValue.length, 0)
		if (!remain) return
		const paths = await chooseInspectionImages({ count: remain, source })
		const next = props.modelValue.slice()
		for (const path of paths) {
			if (!path || next.some((item) => item.localPath === path)) continue
			next.push({ fileId: '', localPath: path, previewUrl: path, uploading: false, uploadState: 'pending', errorMessage: '' })
			if (next.length >= props.max) break
		}
		emit('update:modelValue', next)
	} catch (error) {
		if (String(error?.errMsg || error?.message || '').toLowerCase().includes('cancel')) return
		uni.showToast({ title: '选择照片失败', icon: 'none' })
	}
}

function remove(index) {
	if (props.modelValue[index]?.uploading) return
	const next = props.modelValue.slice(); next.splice(index, 1); emit('update:modelValue', next)
}

function preview(index) {
	const urls = props.modelValue.map(previewOf).filter(Boolean)
	if (urls.length) uni.previewImage({ urls, current: urls[index] || urls[0] })
}
</script>

<style scoped>
.photos__grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 12rpx; }
.photos__item { position: relative; aspect-ratio: 1; overflow: hidden; border-radius: 16rpx; background: #e8eef4; }
.photos__image { width: 100%; height: 100%; }
.photos__remove { position: absolute; top: 8rpx; right: 8rpx; width: 42rpx; height: 42rpx; line-height: 38rpx; text-align: center; color: #fff; border-radius: 50%; background: rgba(15,23,42,.72); font-size: 34rpx; }
.photos__overlay { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: #fff; background: rgba(15,23,42,.56); font-size: 22rpx; }
.photos__overlay--failed { flex-direction: column; gap: 8rpx; background: rgba(153,27,27,.8); }
.photos__failed-actions { display: flex; gap: 8rpx; }
.photos__retry { margin: 0; padding: 0 14rpx; min-height: 48rpx; line-height: 48rpx; color: #991b1b; border-radius: 24rpx; background: #fff; font-size: 20rpx; }
.photos__retry::after { border: 0; }
.photos__actions { display: flex; gap: 14rpx; margin-top: 14rpx; }
.photos__button { flex: 1; margin: 0; padding: 0 12rpx; height: 72rpx; line-height: 70rpx; color: #334e68; border: 1rpx solid #9fb3c8; border-radius: 14rpx; background: #fff; font-size: 24rpx; }
.photos__button::after { border: 0; }
.photos__button--primary { color: #9a3412; border-color: #fdba74; background: #fff7ed; }
.photos__tip { display: block; margin-top: 10rpx; color: #718096; font-size: 21rpx; line-height: 1.45; }
</style>
