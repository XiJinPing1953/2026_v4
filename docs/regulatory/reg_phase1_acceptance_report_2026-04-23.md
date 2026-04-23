# 监管一期验收报告（2026-04-23）

## 1. 执行范围
- 执行基线：
  - `docs/regulatory/reg-space-phase1-checklist.md`
  - `docs/regulatory/reg-module-extraction-manual.md`
- 目标：完成“一期链路可对外验收”闭环（发布、基线、增量、抽样对账、异常闭环、剥离演练）。

## 2. 参数锁定
- 站点空间 `space-id`: `env-00jxuffegf2n`
- 监管空间 `space-id`: 当前账号仅可操作同一空间，采用同空间逻辑隔离验证（`crm-reg-*` 模块分离）
- `REG_STATION_ID`: `XTNY-001`
- `REG_KEY_ID`: `reg-key-a-20260423`（双 key 已预置）

## 3. 发布与基线执行结果
- `crm-reg-ingest` 健康检查通过：见 `reg_ingest_health.final_lock.json`
- 基线回填完成：
  - `crm-bottle.backfillRegFieldsV1 preview/execute`
  - 覆盖 `1033` 瓶，`updated_total=1033`
  - 证据：`backfillRegFields.preview.json` / `backfillRegFields.execute.json`
- 基线快照入队完成：
  - `bootstrapSnapshotV1 preview/execute`
  - 有效活跃瓶 `1032`，入队 `1032`
  - 证据：`bootstrapSnapshot.preview.json` / `bootstrapSnapshot.execute.json`
- 增量派发稳定运行：
  - 派发分批执行完成，最终队列归零
  - 证据：`dispatchOutbox.run*.json` 与最终统计文件

## 4. 异常联调结果
- 签名错误（bad secret）：
  - 首次派发进入 `retrying=2`，监管侧 `rejected` 增加
  - 修正密钥后重试成功闭环
  - 证据：`anomaly_sign.*.json`
- 重复投递（固定 `source_id + event_at` 二次入队）：
  - 第二次入队命中幂等，`duplicate_total=1`（event）+`1`（snapshot）
  - 证据：`anomaly_duplicate.enqueue.second.json`
- 超时/网络异常（不可达 endpoint）：
  - 首次派发进入 `retrying=2`
  - 重试窗口后恢复 endpoint，派发成功
  - 证据：`anomaly_timeout.*.json`

## 5. 数据验收（100 瓶抽样）
- 抽样脚本：`scripts/reg/reconcileRegSampleV1.cjs`
- 最终锁定结果：
  - `sampled_total=100`
  - `matched_total=100`
  - `consistency_rate_pct=100`
- 证据：`reg_reconcile_100.final_lock.report.json`

## 6. 剥离就绪验收
- 剥离演练脚本执行通过：
  - `passed=true`
  - `dependency_issues=[]`
- 证据：`reg_module_rehearsal_report.20260423.json`

## 7. 硬门槛判定
- `healthV1` 正常：通过
- `verifyStatsV1` accepted 持续增长：通过（`log_accepted_total=1184`）
- rejected 仅可解释测试数据：通过（`log_rejected_total=2`，来自签名错误联调）
- 站点 `getSyncStatsV1.dead_total=0`：通过
- 100 瓶抽样一致率 100%：通过

## 8. 最终锁定快照
- 站点同步统计：`run_getSyncStats.final_lock.json`
  - `pending=0, retrying=0, sent=1184, dead=0, dead_letter_open=0`
- 监管验收统计：`reg_verifyStats.final_lock.json`
  - `bottle_current_total=1032`
  - `bottle_event_total=66`
  - `log_accepted_total=1184`
  - `log_rejected_total=2`
  - `dead_letter_open_total=0`

## 9. 备注
- 本轮在单可用空间条件下完成了监管链路可验收验证；后续切换独立监管空间时，仅需替换 `REG_ENDPOINT + key` 并按同流程重跑基线/抽样验收即可。
