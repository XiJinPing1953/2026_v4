'use strict';
// Pure preparation. No transport, credentials or database writes.
const crypto = require('node:crypto');
const text = v => String(v ?? '').normalize('NFKC').trim();
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const day = value => {
 const n = Number(value);
 if (!Number.isFinite(n) || n <= 0) throw new Error('缺少有效时间戳');
 return new Date(n + 8 * 3600000).toISOString().slice(0,10);
};
const number = (v, name) => {
 if (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v))) throw new Error(`缺少有效${name}`);
 return Number(v);
};
function buildIndex(source) {
 const candidates = source.记录.filter(r => r.浏览标签查询?.核对结论 === '标签号、产品编号及此前App内部编号均匹配');
 const rows = candidates.map(r => ({
  bottle_no: text(r.Excel来源.单位内编号), source_product_no: text(r.Excel来源.产品编号),
  product_no: text(r.浏览标签查询.App信息.产品编号), regulator_inner_no: text(r.浏览标签查询.App信息.内部编号),
  tag: text(r.浏览标签查询.App信息.标签号), medium: text(r.浏览标签查询.App信息.充装介质),
  next_inspection: text(r.浏览标签查询.App信息.下次检验日期), status: text(r.浏览标签查询.App信息.气瓶状态),
  verified_at: r.浏览标签查询.查询时间, source_sheet: r.Excel来源.工作表, source_row: r.Excel来源.行号
 }));
 const keys = ['bottle_no','product_no','tag'];
 const counts = Object.fromEntries(keys.map(k => [k,new Map()]));
 for (const r of rows) for (const k of keys) counts[k].set(r[k], (counts[k].get(r[k]) || 0)+1);
 const records=[], blocked=[];
 for (const r of rows) {
  const errors=keys.filter(k => !r[k] || counts[k].get(r[k]) !== 1).map(k => `${k}不唯一或缺失`);
  if (!/^\d{11}$/.test(r.tag)) errors.push('标签不是11位数字');
  if (!r.regulator_inner_no) errors.push('监管内部编号为空');
  (errors.length ? blocked : records).push(errors.length ? {...r,errors} : r);
 }
 return {version:1, source_sha256:hash(source), records, blocked};
}
function prepare({record,bottle,index,weather,policy,now=Date.now()}) {
 if (!policy || policy.quantity_basis !== 'incremental_fill') throw new Error('充装量口径未明确');
 if (policy.inspections_performed_by_staff !== true) throw new Error('缺少现场逐瓶检查作业约定');
 if (policy.duration_minutes !== 10 || policy.duration_source !== 'reporting_template') throw new Error('填报模板未明确');
 if (policy.weather_reference_allowed !== true) throw new Error('天气参考值填报口径未明确');
 if (record?.entry_source !== 'pda_reweigh' || record.status !== 'completed' || !text(record._id) || !text(record.operation_id)) throw new Error('不是已保存的正式复秤记录');
 if (number(record.source_version,'源版本') !== 1 || record.reweigh?.corrected_at) throw new Error('更正记录不能自动新增上传，须核对原上传记录');
 const no=text(record.bottle_no), matches=index.records.filter(x => x.bottle_no===no);
 if (matches.length!==1) throw new Error('缺少唯一已核实标签映射');
 const mapping=matches[0];
 if (mapping.crm_id!==bottle?._id || mapping.tag!==text(bottle?.qr_code) || bottle.is_active!==true) throw new Error('CRM瓶档身份、核实标签或启用状态已变化');
 if (text(bottle?.bottle_no)!==no || mapping.product_no!==text(bottle?.product_no)) throw new Error('CRM当前瓶档与已核实产品编号不符');
 if (!['LNG','液化天然气'].includes(mapping.medium)) throw new Error('充装介质为空或不是本次LNG流程');
 if (mapping.status!=='在用') throw new Error('气瓶状态需核对');
 const today=day(now);
 if (!/^\d{4}-\d{2}-\d{2}$/.test(mapping.next_inspection) || mapping.next_inspection<today) throw new Error('缺少有效检验日期或已过检验期');
 if (record.date!==today || day(record.reweigh?.measured_at)!==today) throw new Error('跨日记录不得按当前时间自动补报');
 const rw=record.reweigh, gross=number(rw.gross_weight,'灌后毛重'), basis=number(rw.basis?.gross_weight,'回瓶毛重'), tare=number(rw.tare_weight,'皮重'), fill=number(record.fill_weight,'本次灌装量');
 if (!text(rw.basis?.return_reweigh_id) || gross<tare || basis<tare || tare<=0 || Math.abs(tare-number(bottle.tare_weight,'当前皮重'))>0.001) throw new Error('回瓶依据或皮重异常');
 if (day(record.created_at)!==today || rw.measured_at>now+60000) throw new Error('保存或称重时间异常');
 if (!(fill>0) || Math.abs((gross-basis)-fill)>0.051) throw new Error('本次灌装量与实测依据不符');
 if (Math.abs((gross-tare)-number(rw.net_weight,'瓶内净重'))>0.051) throw new Error('瓶内净重与实测依据不符');
 if (rw.capture_method!=='ble' || rw.capture?.stable!==true) throw new Error('缺少稳定称重证据');
 if (text(weather?.site_id)!==text(policy.site_id) || !text(policy.site_id) || weather.reference_date!==today || day(weather.fetched_at)!==today || day(weather.observed_at)!==today || weather.observed_at>now+60000 || !text(weather.source)) throw new Error('缺少本站当日天气参考值');
 const temperature=number(weather.temperature_c,'参考温度');
 if (temperature < -60 || temperature > 60 || weather.unit!=='°C') throw new Error('参考温度单位或数值异常');
 const content={source:{filling_id:record._id,operation_id:record.operation_id,source_version:record.source_version,bottle_no:no,product_no:text(bottle.product_no),business_date:record.date,measured_at:rw.measured_at},
  expected_bottle:{tag:mapping.tag,product_no:mapping.product_no,inner_no:mapping.regulator_inner_no,medium:mapping.medium,next_inspection:mapping.next_inspection},
  fields:{duration_minutes:10,quantity_kg:fill,temperature_c:temperature},
  provenance:{quantity:'已保存记录fill_weight；灌后毛重减有效回瓶毛重',duration:'填报模板，非实际测量时长',temperature:{...weather,basis:'人员查看天气后录入的当日参考值，非现场实测'},inspections:'现场人员逐瓶实际检查；保留目标App默认通过项'},
  target_time_behavior:'当前版本App上传时以设备当前时间作为充装时间，并以当前时间加模板分钟数生成结束时间；不等于实际复秤时间',
  safeguards:{reread_target_identity:true,recheck_target_inspection:true,stop_on_warning:true,no_automatic_retry_after_unknown_upload:true,record_corrections_require_review:true}};
 return {version:1,key:`hebei:${record._id}`,revision:record.source_version,fingerprint:hash(content),state:'prepared_not_sent',content};
}
function validateTarget(plan, actual) {
 for (const [field, expected] of Object.entries({tag:plan.content.expected_bottle.tag,product_no:plan.content.expected_bottle.product_no,inner_no:plan.content.expected_bottle.inner_no})) {
  if (text(actual?.[field])!==text(expected)) throw new Error(`目标页面${field}不匹配`);
 }
 if (!['LNG','液化天然气'].includes(text(actual.medium))) throw new Error('目标页面介质异常');
 if (actual.enterprise_id!=='6739' || !text(actual.appid) || actual.status!=='在用' || actual.warning) throw new Error('目标企业、气瓶状态或提示异常');
 if (text(actual.next_inspection)!==plan.content.expected_bottle.next_inspection) throw new Error('目标检验日期已变化，需重新核对');
 return true;
}
function canAttempt(plan, ledger) {
 const existing=ledger[plan.key];
 if (!existing) return true;
 if (existing.fingerprint!==plan.fingerprint) throw new Error('同一源记录内容已变化，不能重复新增');
 return false; // includes submitted, attempted/unknown, and explicit rejection; review before any retry.
}
module.exports={buildIndex,prepare,validateTarget,canAttempt,day};
