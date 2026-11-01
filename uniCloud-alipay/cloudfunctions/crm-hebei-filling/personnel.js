'use strict';
const {day}=require('./plan');
// Resolve actual shift assignments; never pick or rotate people automatically.
function resolvePersonnel({roster,assignment,enterpriseId,now=Date.now()}) {
 if (!enterpriseId || String(roster?.enterprise_id)!==String(enterpriseId)) throw new Error('人员企业范围不匹配');
 if (!assignment?.basis || !assignment.confirmed_by || !Number.isFinite(assignment.confirmed_at)) throw new Error('缺少实际岗位安排依据');
 const today=day(now);
 if (assignment.mode!=='fixed' || !/^\d{4}-\d{2}-\d{2}$/.test(assignment.effective_from) || today<assignment.effective_from || (assignment.effective_until && today>assignment.effective_until) || assignment.confirmed_at>now) throw new Error('岗位安排尚未生效或已失效');
 const result={};
 for (const role of ['before','filling1','filling2','after']) {
  const name=assignment[role];
  const matches=(roster.people||[]).filter(p=>p.personname===name && String(p.sydwid)===String(enterpriseId));
  if (!name || matches.length!==1) throw new Error(`${role}没有唯一人员档案`);
  const p=matches[0];
  if (p.verifyflag!=='审核通过' || p.overDue!==false || !/^\d{4}-\d{2}-\d{2}$/.test(p.expiredate) || p.expiredate<today) throw new Error(`${role}人员审核或证件状态异常`);
  if (!Number.isInteger(p.id) || typeof p.personid!=='string' || !p.personid.trim()) throw new Error('人员编号缺失');
  result[role]={id:p.id,personid:p.personid,personname:p.personname};
 }
 if (result.filling1.id===result.filling2.id || result.filling1.personid===result.filling2.personid) throw new Error('两名充装人员不能重复');
 for (const check of ['before','after']) for (const fill of ['filling1','filling2']) {
  if (result[check].id===result[fill].id || result[check].personid===result[fill].personid) throw new Error('检查人员不能与充装人员重复');
 }
 return {enterprise_id:String(enterpriseId),date:today,roles:result,basis:assignment.basis,confirmed_by:assignment.confirmed_by,confirmed_at:assignment.confirmed_at};
}
module.exports={resolvePersonnel};
