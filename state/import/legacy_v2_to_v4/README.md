# Legacy v2 -> v4 导入包

## 生成方式

在 `/Users/wangbo/Downloads/2026_v4` 目录执行：

```bash
node src/services/mappers/legacyImport/convertLegacyExport.cjs
```

可选参数：

```bash
node src/services/mappers/legacyImport/convertLegacyExport.cjs \
  --inputDir .. \
  --outputDir state/import/legacy_v2_to_v4
```

## 全量导出先行（控制台导出）

当旧库需要先做“全量导出验收”再映射时，执行：

```bash
node src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs \
  --inputDir /Users/wangbo/Downloads/legacy_full_export_20260206 \
  --outputDir state/import/legacy_v2_to_v4
```

说明：

- `inputDir` 需包含以下文件（jsonl）：
  - `about_crm_users.json`
  - `about_crm_operation_logs.json`
  - `about_crm_customers.json`
  - `about_crm_vehicles.json`
  - `about_crm_delivery_men.json`
  - `about_crm_bottles.json`
  - `about_crm_filling_records.json`
  - `about_crm_sale_records.json`
  - `about_crm_bottle_anomalies.json`
  - `about_crm_gas_in.json`
- 脚本会输出：
  - `manifest.json`（默认写入 `inputDir`，可用 `--manifestOut` 改路径）
  - `truck_out_no_sale_events.json`
  - `truck_literal_audit.json`
  - 以及映射后的 `crm_*.json/.ndjson/.array.json` 与 `report.json`
- 默认严格模式：缺文件、关键校验失败或映射失败会返回非 0。
- 可用 `--allowPartial` 跳过严格失败（仅用于本地排查，不建议用于正式迁移）。

## 输出文件

- `crm_customers.json`
- `crm_vehicles.json`
- `crm_delivery_men.json`
- `crm_bottles.json`
- `crm_fillings.json`
- `crm_sale_records.json`
- `crm_bottle_movements.json`
- `crm_bottle_anomalies.json`
- `crm_customers.ndjson`
- `crm_vehicles.ndjson`
- `crm_delivery_men.ndjson`
- `crm_bottles.ndjson`
- `crm_fillings.ndjson`
- `crm_sale_records.ndjson`
- `crm_bottle_movements.ndjson`
- `crm_bottle_anomalies.ndjson`
- `crm_customers.array.json`
- `crm_vehicles.array.json`
- `crm_delivery_men.array.json`
- `crm_bottles.array.json`
- `crm_fillings.array.json`
- `crm_sale_records.array.json`
- `crm_bottle_movements.array.json`
- `crm_bottle_anomalies.array.json`
- `report.json`

`*.json` 为 uniCloud 导入格式：每行一条 JSON（jsonl 形态，不是数组）。
`*.array.json` 为标准数组 JSON，仅用于人工查看或二次加工。
`*.ndjson` 与导入 `*.json` 内容一致，便于与外部工具兼容。

## 映射原则（重构约束）

- 不直接沿用旧库宽字段，只保留新 schema 允许字段。
- 兼容映射逻辑集中在 `src/services/mappers/legacyImport/convertLegacyExport.cjs`。
- 关联 ID 统一从旧格式 `{"$oid":"..."}` 解包为字符串。
- 对 required 字段缺失数据执行回填或丢弃，并在 `report.json` 记录。

## 本次结果摘要

- 客户：116 -> 116
- 车辆：17 -> 17
- 配送员：15 -> 15（来自旧配送员导出文件，按新模型字段标准化）
- 钢瓶：964 -> 964
- 灌装：2459 -> 2426（丢弃 33 条：缺失 `bottle_no`，原始类型 `truck_out_no_sale`）
- 销售：1036 -> 1036
- 流转明细：`7107` 条（由销售 `out/back` + 灌装 `fill` 事件重建）
- 流转异常：`828` 条（按旧库 `crm_bottle_anomalies` 全量对齐，保留状态与上下文）

详细统计见 `report.json`。

## 配送员映射说明

- 如提供 `--deliveries <旧配送员导出文件>`，则以该文件为准，不再混入销售/灌装文本派生数据。
- 仅在缺失配送员导出文件时，才会从销售 `delivery_man` 与灌装 `operator` 派生补齐。
