// Development-only. The matching Vite middleware creates a separate in-memory
// database for this page and calls the actual management service. No cloud calls.
const session=`preview_${crypto.randomUUID().replaceAll('-','')}`
if(typeof window!=='undefined')window.__crmSafetyPreview=true
export async function callCloud(name,request={}) {
  window.__safetyPreviewCalls ||= []
  window.__safetyPreviewCalls.push({name,action:request.action})
  const response=await fetch('/__safety-preview/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,name,request,missing_media:Boolean(window.__safetyMissingMedia)})})
  return response.json()
}
if(typeof window!=='undefined')window.__safetyPreviewCall=callCloud
