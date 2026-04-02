# 灌装迁移流水线（2026-03-17 固化版）

## 目标
- 仅补录真实缺失（排除“同日同瓶冲突口径”）。
- 清洗新系统灌装日期为 `YYYY-MM-DD`。
- 最终对账应只剩业务冲突差异。

## 前置条件
- 空间：`env-00jxuffegf2n`
- 已上传最新云函数：`crm-filling`
- 输入文件：`docs/hhh.json`
- 差异文件：
  - `docs/filling.hhh.missing.details.json`
  - `docs/filling.hhh.conflicts15.details.json`

## Step 1: 生成“仅真实缺失”导入包
```bash
node scripts/buildFillingTrueMissingFromReports.cjs \
  --missing docs/filling.hhh.missing.details.json \
  --conflicts docs/filling.hhh.conflicts15.details.json \
  --output docs/filling.hhh.true_missing_51.json
```

## Step 2: 先预检，再执行补录
```bash
node scripts/importFillingsFromJson.cjs \
  --input docs/filling.hhh.true_missing_51.json \
  --report docs/filling.import.report.hhh.true_missing_51.dryrun.json \
  --space-id env-00jxuffegf2n
```

```bash
node scripts/importFillingsFromJson.cjs \
  --input docs/filling.hhh.true_missing_51.json \
  --report docs/filling.import.report.hhh.true_missing_51.execute.json \
  --space-id env-00jxuffegf2n \
  --execute
```

验收口径：
- `target_total = 51`
- `success_total = 51`
- `failed_total = 0`

## Step 3: 日期归一化（循环分批，避免超时）
```bash
node scripts/runFillingNormalizeDatesLoop.cjs \
  --space-id env-00jxuffegf2n \
  --scan-limit 12000 \
  --max-updates 300 \
  --max-rounds 30 \
  --output docs/filling.normalize_dates.loop.execute.json
```

验收口径：
- `final_preview.data.candidate_total = 0`

## Step 4: 最终总对账
```bash
node scripts/importFillingsFromJson.cjs \
  --input docs/hhh.json \
  --report docs/filling.import.report.hhh.after_fix.dryrun.json \
  --space-id env-00jxuffegf2n
```

验收口径：
- `target_total = 15`（仅剩同日同瓶冲突口径）

## 记忆唤醒语句
继续按“2026-03-17 灌装迁移流水线”执行：先 `true_missing` 补录，再 `normalizeDatesV1` 分批归一化，最终验收 `hhh dry-run target=15`。
