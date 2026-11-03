<template>
	<AppPage title="秤台校准" icon="scale" hideBottleQuery>
		<view class="readout" :class="{stable:point?.stable}">
			<view class="row"><text>{{ raw?.deviceId || '未连接地秤' }}</text><text>{{ !point ? '等待读数' : point.stable ? '稳定' : '称重中' }}</text></view>
			<view class="weight">{{ display }} <text>kg</text></view>
			<text class="raw">原始 {{ point ? point.kg.toFixed(3) + ' kg' : '—' }}　·　AD {{ point?.ad ?? '—' }}</text>
		</view>
		<view v-if="authorized" class="action">
			<AppButton v-if="raw?.status !== 'connected'" :disabled="busy" @click="connect">连接地秤</AppButton>
			<AppButton v-else kind="outline" :disabled="busy" @click="disconnect">断开连接</AppButton>
		</view>
		<text v-if="error || state?.error" class="alert">{{ error || state?.error }}</text>
		<text v-else-if="note" class="hint">{{ note }}</text>
		<template v-if="authorized && state">
			<AppSection title="标定">
				<view v-if="state.pending" class="group">
					<text class="step">{{ state.pending.kind === 'zero' ? '核对空台零点' : state.pending.loaded ? '卸空复核' : '核对加载示值' }}</text>
					<text class="hint" v-if="state.pending.needsReconnect">发送结果不明确，请重新连接原来的秤，再核对读数。</text>
					<text class="hint" v-if="state.pending.kind === 'mass' && !state.pending.loaded">保持 {{ state.pending.grams / 1000 }} kg 砝码在台上，等读数稳定。</text>
					<text class="hint" v-else>清空秤台，等数字稳定回到零。</text>
					<AppButton :disabled="busy || !point?.stable" @click="review(state.pending.kind === 'mass' && !state.pending.loaded ? 'loaded' : 'empty')">{{ state.pending.kind === 'mass' && !state.pending.loaded ? '核对砝码实读' : '核对空台实读' }}</AppButton>
					<AppButton kind="outline" :disabled="busy || raw?.status !== 'connected'" @click="review('fail')">结果异常</AppButton>
				</view>
				<view v-else class="group">
					<text class="step">1　清空秤台</text><text class="hint">先看原始重量。如果卸空仍有明显残重，先在下方记下空台，检查秤台后再归零。</text>
					<AppButton kind="outline" :disabled="!writable" @click="issue('zero')">空台归零</AppButton>
					<text class="step">2　放标准砝码</text>
					<view class="entry"><input v-model="mass" type="digit" placeholder="放 200 kg 就填 200" :disabled="busy"/><text>kg</text></view>
					<AppButton :disabled="!writable || !mass || state.zeroFor !== raw?.deviceId" @click="issue('mass')">标定砝码</AppButton>
				</view>
				<text v-if="!state.pending && state.lastVerified?.kind === 'mass' && !state.requiresReview" class="hint">最近核验 · {{ state.lastVerified.grams / 1000 }} kg · {{ shortTime(state.lastVerified.verifiedAt) }}<text v-if="state.lastVerified.loaded">　加载 {{ state.lastVerified.loaded.kg.toFixed(3) }} / 卸空 {{ state.lastVerified.empty.kg.toFixed(3) }} kg</text></text>
			</AppSection>
			<AppSection title="加卸载复核">
				<text class="hint">每次称稳记一笔。减载时填台上还剩多少公斤。</text>
				<view class="entry"><input v-model="expected" type="digit" placeholder="台上已知重量" /><text>kg</text></view>
				<view class="checks"><AppButton kind="outline" v-for="name in ['空台','加载','减载']" :key="name" :disabled="busy || !point?.stable" @click="record(name)">记{{name}}</AppButton></view>
				<view v-for="(row,i) in records" :key="row.at + ':' + i" class="point">
					<text>{{row.label}} · {{row.nominal}} kg　实读 {{row.kg.toFixed(3)}} kg</text>
					<text class="hint">{{shortTime(row.at)}} · {{row.device.slice(-5)}} · AD {{row.ad}} · 差 {{(row.kg-row.nominal).toFixed(3)}} kg</text>
				</view>
			</AppSection>
		</template>
	</AppPage>
</template>
<script setup>
import { computed, onBeforeUnmount } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSection from '@/components/base/AppSection.vue'
import { useFloorCalibrationBench } from '@/composables/pda/useFloorCalibrationBench'
const {raw,point,state,display,error,note,records,mass,expected,busy,authorized,activate,deactivate,connect,disconnect,issue,review,record} = useFloorCalibrationBench()
const writable = computed(() => raw.value?.canWriteCalibration && point.value?.stable && !busy.value && !state.value?.error)
const shortTime = at => new Date(at).toLocaleString()
onBeforeUnmount(deactivate)
defineExpose({activate,deactivate})
</script>
<style scoped>
.readout{background:#edf2f4;color:#243d47;border-radius:12px;padding:16px}.readout.stable{background:#d8efdf;color:#164e37}.row,.action,.entry,.checks{display:flex;align-items:center;gap:8px}.row{justify-content:space-between;font-size:13px}.weight{font-size:49px;font-weight:700;line-height:1.25;margin:6px 0;font-variant-numeric:tabular-nums}.weight text{font-size:19px}.raw,.hint{font-size:13px;line-height:1.55}.action{margin:8px 0}.step,.hint,.alert,.point text{display:block}.step{font-weight:650;margin-top:8px}.hint{color:#526773}.group{display:grid;gap:8px}.entry{margin:8px 0}.entry input{flex:1;border:1px solid #9fadb3;border-radius:6px;padding:8px;min-height:32px}.point{padding:8px 0;border-bottom:1px solid #dbe3e6;font-size:14px}.alert{color:#922c19;background:#fff1e8;padding:8px}.checks{flex-wrap:wrap}
</style>
