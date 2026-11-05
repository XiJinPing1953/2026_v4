<template>
	<AppPage title="秤台校准" icon="scale" hideBottleQuery>
		<view class="readout" :class="{stable:point?.stable}">
			<view class="row"><text>{{ raw?.deviceId || '未连接地秤' }}</text><text>{{ !point ? '等待读数' : point.stable ? '稳定' : '称重中' }}</text></view>
			<view class="weight">{{ display }} <text>kg</text></view>
			<text class="raw">主板原始 {{ point ? point.kg.toFixed(3) + ' kg' : '—' }}　·　AD {{ point?.ad ?? '—' }}</text>
		</view>
		<view v-if="authorized" class="action">
			<AppButton v-if="raw?.status !== 'connected'" :disabled="busy" @click="connect">连接地秤</AppButton>
			<AppButton v-else kind="outline" :disabled="busy" @click="disconnect">断开连接</AppButton>
		</view>
		<text v-if="error || state?.error" class="alert">{{ error || state?.error }}</text>
		<text v-else-if="note" class="hint">{{ note }}</text>
		<template v-if="authorized && state">
			<AppSection title="标定秤台">
				<view class="group">
					<text class="step">1 · 清空秤台，归零</text>
					<AppButton :disabled="!writable || Boolean(state.pending)" @click="issue('zero')">空台归零</AppButton>
					<text v-if="state.zeroFor === raw?.deviceId && !state.pending" class="hint">空台零点已记录，可以放砝码。</text>
					<text class="step">2 · 放上标准砝码，填写实际重量</text>
					<view class="entry"><input v-model="mass" type="digit" placeholder="放 200 kg 就填 200" :disabled="busy || Boolean(state.pending)"/><text>kg</text></view>
					<AppButton :disabled="!writable || Boolean(state.pending) || !mass || state.zeroFor !== raw?.deviceId" @click="issue('mass')">{{ mass ? '标定到 ' + mass + ' kg' : '标定砝码重量' }}</AppButton>
					<text v-if="!state.pending && state.zeroFor !== raw?.deviceId" class="hint">先完成第 1 步。标定会调整主板换算系数；日常归零不会。</text>
				</view>
				<view v-if="state.pending && state.pending.kind !== 'check'" class="group pending">
					<text class="step">{{ state.pending.kind === 'zero' ? '正在核对归零结果' : state.pending.loaded ? '请取下全部砝码' : '正在核对标定结果' }}</text>
					<text v-if="state.pending.needsReconnect" class="hint">发送结果未确认。请重新连接原秤，程序会核对实读，不会重复发送标定。</text>
					<text v-else class="hint">{{ state.pending.kind === 'zero' ? '保持空台，归零后自动进入第 2 步。' : state.pending.loaded ? '保持空台，稳定回零后自动完成。' : '保持 ' + state.pending.grams / 1000 + ' kg 砝码不动，等待稳定读数。' }}</text>
					<text v-if="state.pending.kind === 'mass' && !state.pending.loaded && point" class="hint">目标 {{ state.pending.grams / 1000 }} kg · 实读 {{ point.kg.toFixed(3) }} kg</text>
					<AppButton v-if="state.pending.loaded && state.pending.grams < 500" :disabled="busy || !point?.stable" @click="review('empty')">砝码已取下，核对空台</AppButton>
					<AppButton kind="ghost" :disabled="busy || raw?.status !== 'connected'" @click="review('fail')">结束本次核对，重新标定</AppButton>
				</view>
				<text v-if="!state.pending && ['mass', 'check'].includes(state.lastVerified?.kind) && !state.requiresReview" class="hint">最近通过 · {{ state.lastVerified.grams / 1000 }} kg · {{ shortTime(state.lastVerified.verifiedAt) }}</text>
			</AppSection>
			<AppButton kind="ghost" :disabled="busy" @click="showCheck = !showCheck">只检查准确度（不改标定） {{ showCheck ? '收起' : '展开' }}</AppButton>
			<AppSection v-if="showCheck || state.pending?.kind === 'check'" title="只读砝码复核">
				<text class="hint">这里不会校准主板。要把 200 kg 标定正确，请用上面的“标定秤台”。</text>
				<view v-if="state.pending?.kind === 'check'" class="group">
					<text class="step">{{ state.pending.loaded ? '取下砝码，检查回零' : '放上 ' + state.pending.grams / 1000 + ' kg，检查实读' }}</text>
					<AppButton :disabled="busy || !point?.stable" @click="review(state.pending.loaded ? 'empty' : 'loaded')">{{ state.pending.loaded ? '检查空台读数' : '检查砝码读数' }}</AppButton>
					<AppButton kind="outline" :disabled="busy" @click="leaveCheck">退出检查，去标定</AppButton>
				</view>
				<view v-else class="group">
					<text class="hint">先保持空台，填写准备使用的砝码重量。</text>
					<view class="entry"><input v-model="expected" type="digit" placeholder="例如 200" :disabled="busy"/><text>kg</text></view>
					<AppButton kind="outline" :disabled="busy || Boolean(state.pending) || !point?.stable || !expected" @click="beginCheck">开始检查，不改标定</AppButton>
				</view>
			</AppSection>
			<AppButton kind="ghost" :disabled="busy" @click="showRecords = !showRecords">加卸载记录 {{ showRecords ? '收起' : '展开' }}</AppButton>
			<AppSection v-if="showRecords" title="加卸载记录">
				<text class="hint">只记日志，不改标定。减载时填台上还剩多少公斤。</text>
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
import { computed, onBeforeUnmount, ref } from 'vue'
import AppPage from '@/components/base/AppPage.vue'
import AppButton from '@/components/base/AppButton.vue'
import AppSection from '@/components/base/AppSection.vue'
import { useFloorCalibrationBench } from '@/composables/pda/useFloorCalibrationBench'
const {beginCheck,cancelCheck,raw,point,state,display,error,note,records,mass,expected,busy,authorized,activate,deactivate,connect,disconnect,issue,review,record} = useFloorCalibrationBench()
const showCheck = ref(false), showRecords = ref(false)
async function leaveCheck() { await cancelCheck(); showCheck.value = false }
const writable = computed(() => raw.value?.canWriteCalibration && point.value?.stable && !busy.value && !state.value?.error)
const shortTime = at => new Date(at).toLocaleString()
onBeforeUnmount(deactivate)
defineExpose({activate,deactivate})
</script>
<style scoped>
.readout{background:#edf2f4;color:#243d47;border-radius:12px;padding:16px}.readout.stable{background:#d8efdf;color:#164e37}.row,.action,.entry,.checks{display:flex;align-items:center;gap:8px}.row{justify-content:space-between;font-size:13px}.weight{font-size:49px;font-weight:700;line-height:1.25;margin:6px 0;font-variant-numeric:tabular-nums}.weight text{font-size:19px}.raw,.hint{font-size:13px;line-height:1.55}.action{margin:8px 0}.step,.hint,.alert,.point text{display:block}.step{font-weight:650;margin-top:8px}.hint{color:#526773}.group{display:grid;gap:8px}.pending{margin-top:12px;padding-top:12px;border-top:1px solid #cbd5e1}.entry{margin:8px 0}.entry input{flex:1;border:1px solid #9fadb3;border-radius:6px;padding:8px;min-height:32px}.point{padding:8px 0;border-bottom:1px solid #dbe3e6;font-size:14px}.alert{color:#922c19;background:#fff1e8;padding:8px}.checks{flex-wrap:wrap}
</style>
