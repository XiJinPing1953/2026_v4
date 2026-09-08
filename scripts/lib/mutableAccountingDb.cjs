'use strict'
const {makeDb}=require('./accountingTestHarness.cjs')
function mutableDb(tables,hooks={}) {
 const base=makeDb(tables),writes=[];let next=0
 function wrap(name,query){return new Proxy(query,{get(q,key){
  if(key==='add') return async data=>{const id=data._id || `new-${++next}`;if((tables[name]||[]).some(r=>r._id===id))throw Error('duplicate key');
   if(hooks.write)hooks.write(name,data);(tables[name]||=[]).push(structuredClone({...data,_id:id}));writes.push({table:name,id,data});return{id}}
  if(key==='update') return async patch=>{const rows=(await q.get()).data;if(hooks.write)hooks.write(name,patch);for(const row of rows){const doc=tables[name].find(r=>r._id===row._id);Object.assign(doc,structuredClone(patch));writes.push({table:name,id:row._id,patch})}return{updated:rows.length}}
  if(key==='remove') return async()=>{const rows=(await q.get()).data;tables[name]=(tables[name]||[]).filter(r=>!rows.some(d=>d._id===r._id));writes.push({table:name,remove:rows.map(r=>r._id)});return{deleted:rows.length}}
  if(['where','doc','field','orderBy','skip','limit'].includes(key))return(...args)=>wrap(name,q[key](...args))
  return q[key]
 }})}
 return {...base,writes,collection:name=>wrap(name,base.collection(name)),startTransaction:async()=>{
  if(hooks.start)hooks.start(tables)
  const copy=structuredClone(tables),tx=mutableDb(copy,{write:hooks.txWrite});let ended=false
  return {...tx,commit:async()=>{if(ended)throw Error('transaction ended');for(const name of Object.keys(tables))delete tables[name];Object.assign(tables,copy);writes.push(...tx.writes);ended=true},rollback:async()=>{ended=true}}
 }}
}
module.exports={mutableDb}
