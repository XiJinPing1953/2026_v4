# truck_out_no_sale 清洗执行文档（浏览器控制台版）

目标：清理历史上 `record_type=truck_out_no_sale` 误写入的 `fill movement`，并确保可回滚。

本手册按“只做一件事”的节奏写，你可以一步一步执行。

---

## 第 0 步：先确认前置条件

你需要先完成这两件事：

1. 已把最新 `crm-filling` 云函数上传到当前空间（包含 `cleanupNoSaleMovementsV1` action）。
2. 已在系统里登录管理员或超级管理员账号。

如果未满足，后面会报 `未知 action` 或 `403`。

---

## 第 1 步：注册控制台工具（只粘贴一次）

在浏览器控制台粘贴并执行下面代码（此步不会写库）：

```js
(() => {
  const state = {
    preview: null,
    execute: null,
    token: ''
  };

  const nowReq = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const getToken = () => {
    try {
      if (window.uni && typeof uni.getStorageSync === 'function') {
        return String(uni.getStorageSync('crm_token') || '').trim();
      }
    } catch (e) {}
    return '';
  };

  const callCleanup = async ({ preview = true, scanLimit = 5000, runId = '' } = {}) => {
    const token = getToken();
    if (!token) throw new Error('未获取到 crm_token，请先登录');
    state.token = token;

    const res = await uniCloud.callFunction({
      name: 'crm-filling',
      data: {
        action: 'cleanupNoSaleMovementsV1',
        token,
        request_id: nowReq(),
        data: {
          preview: Boolean(preview),
          scan_limit: Number(scanLimit) || 5000,
          run_id: runId || undefined
        }
      }
    });

    const result = (res && res.result) || {};
    if (result.code !== 0) {
      throw new Error(`调用失败: code=${result.code}, msg=${result.msg || 'unknown'}`);
    }
    return result.data || {};
  };

  window.__fillingNoSaleCleanup = {
    async preview(scanLimit = 5000) {
      const data = await callCleanup({ preview: true, scanLimit });
      state.preview = data;
      console.log('[PREVIEW]', data);
      console.table([{
        run_id: data.run_id,
        filling_total: data.filling_total,
        movement_total: data.movement_total,
        touched_bottle_total: data.touched_bottle_total,
        backup_collection: data.backup_collection
      }]);
      return data;
    },

    async execute() {
      if (!state.preview) throw new Error('请先执行 preview()');
      const movementTotal = Number(state.preview.movement_total || 0);
      if (movementTotal <= 0) {
        console.warn('无可清洗 movement，跳过执行');
        return { skipped: true, reason: 'movement_total=0' };
      }
      const ok = window.confirm(`将删除 ${movementTotal} 条 movement（先备份后删除），是否继续？`);
      if (!ok) return { cancelled: true };

      const data = await callCleanup({
        preview: false,
        scanLimit: Number(state.preview.scan_limit || 5000),
        runId: state.preview.run_id || ''
      });
      state.execute = data;
      console.log('[EXECUTE]', data);
      console.table([{
        run_id: data.run_id,
        removed: data.removed,
        backed_up: data.backed_up,
        touched_bottle_total: data.touched_bottle_total,
        backup_collection: data.backup_collection,
        touch_warning: data.touch_warning || ''
      }]);
      return data;
    },

    async verify() {
      const data = await callCleanup({ preview: true, scanLimit: 5000 });
      console.log('[VERIFY]', data);
      console.table([{
        movement_total_after: data.movement_total,
        filling_total_after: data.filling_total
      }]);
      return data;
    },

    state() {
      return JSON.parse(JSON.stringify(state));
    }
  };

  console.log('已注册 __fillingNoSaleCleanup');
})();
```

**预期结果**  
控制台出现：`已注册 __fillingNoSaleCleanup`

---

## 第 2 步：预览（不写库）

执行：

```js
await __fillingNoSaleCleanup.preview()
```

**预期结果**  
返回数据里应有：

- `run_id`
- `movement_total`
- `backup_collection`（应为 `crm_filling_no_sale_movement_backups`）

---

## 第 3 步：正式执行（写库）

执行：

```js
await __fillingNoSaleCleanup.execute()
```

会弹确认框，确认后才真正执行。

**预期结果**

- `removed` > 0（如果本来有历史脏 movement）
- `backed_up` 与删除规模一致
- 返回 `run_id`（务必保留）

---

## 第 4 步：执行后验收

执行：

```js
await __fillingNoSaleCleanup.verify()
```

**验收标准**

- `movement_total_after` 为 `0`（或显著下降到预期）
- `filling_total_after` 仍保留（台账不丢）

---

## 第 5 步：常见报错

1. `code=400, msg=未知 action`  
原因：云函数没上传到当前空间。  
处理：重新上传 `crm-filling` 后再执行第 1 步。

2. `code=401` 或提示未登录  
原因：登录态丢失。  
处理：重新登录系统，再执行第 2 步。

3. `code=403, msg=仅管理员可操作`  
原因：当前账号角色不够。  
处理：换管理员/超级管理员账号。

4. `待清洗 movement 超过 5000 条`  
处理：先按业务分批清洗（后续我可以给你分批脚本）。

---

## 回滚说明（保底）

本流程执行时先把原 movement 备份到集合 `crm_filling_no_sale_movement_backups`。  
如果要回滚，可按 `run_id` 从备份集合取 `backup_doc` 批量写回 `crm_bottle_movements`。
