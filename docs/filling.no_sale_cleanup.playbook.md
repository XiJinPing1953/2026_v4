# truck_out_no_sale movement 清洗手册

目标：把 `record_type=truck_out_no_sale` 历史上误写入的 `fill movement` 清掉，同时保留可回滚备份。

## 1. 先预览（不写库）

```bash
npm run filling:no-sale:cleanup:dry -- --space-id env-00jxuffegf2n
```

关注输出中的：
- `filling_total`
- `movement_total`
- `touched_bottle_total`
- `run_id`

## 2. 正式执行（先备份再删除）

```bash
npm run filling:no-sale:cleanup -- --space-id env-00jxuffegf2n
```

执行完成后会输出：
- `removed`（删除 movement 数）
- `backed_up`（备份数）
- `run_id`
- `backup_collection`（默认 `crm_filling_no_sale_movement_backups`）

## 3. 报告文件

默认报告路径：

`docs/filling.no_sale_cleanup.report.json`

可通过 `--report` 指定。

## 4. 回滚思路

按 `run_id` 从备份集合 `crm_filling_no_sale_movement_backups` 取回 `backup_doc`，批量写回 `crm_bottle_movements` 即可回滚。  
建议先在测试环境验证回滚流程，再执行生产回滚。
