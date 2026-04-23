# 监管模块剥离手册（一期）

## 1. 目标
把监管模块从当前仓库最小复制到独立目录/仓库，确保不依赖站点业务模块内部实现。

## 2. 剥离范围

### 2.1 必拷贝云函数
- `uniCloud-alipay/cloudfunctions/crm-reg-bridge/index.js`
- `uniCloud-alipay/cloudfunctions/crm-reg-ingest/index.js`

### 2.2 必拷贝 schema
- `uniCloud-alipay/database/schema/crm_reg_outbox.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_push_logs.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_dead_letters.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_station_registry.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_bottle_current.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_bottle_events.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_ingest_dedup.schema.json`
- `uniCloud-alipay/database/schema/crm_reg_ingest_logs.schema.json`

## 3. 自动化剥离演练

### 3.1 执行命令
```bash
node scripts/reg/extractRegModuleDryRun.cjs --cwd=/Users/wangbo/Downloads/2026_v4
```

### 3.2 演练输出
- 临时目录：`/tmp/crm-reg-module-rehearsal-<timestamp>/`
- 报告文件：`rehearsal-report.json`
- 通过标准：
  - `passed=true`
  - `dependency_issues=[]`

## 4. 运维命令脚本（不依赖业务页面）
- `scripts/reg/runRegBridgeAction.cjs`：终端直接调用 `crm-reg-bridge`（`dispatchOutboxV1` / `replayDeadV1` / `getSyncStatsV1` / `bootstrapSnapshotV1`）。

## 5. 配置迁移

### 4.1 站点空间环境变量
- `REG_ENDPOINT`
- `REG_KEY_ID`
- `REG_SECRET`
- `REG_STATION_ID`
- 可选：`REG_STATION_NAME`、`REG_DEFAULT_MEDIUM_CODE`

### 4.2 监管空间配置数据
在 `crm_reg_station_registry` 预置站点 key（支持双 key 并行启用）：
- `station_id`
- `station_name`
- `key_id`
- `secret`
- `is_active=true`
- `allow_skew_ms`

## 6. 部署步骤

### 5.1 监管空间（先）
1. 发布 `crm_reg_*` schema。
2. 发布 `crm-reg-ingest`。
3. 调 `healthV1` 验证可用。

### 5.2 站点空间（后）
1. 发布 `crm_reg_*`（站点侧）schema 与 `crm_bottles` 字段扩展。
2. 发布 `crm-reg-bridge`。
3. 在站点配置环境变量。
4. 调 `crm-bottle.backfillRegFieldsV1` 执行字段回填。
5. 执行 `bootstrapSnapshotV1`（preview -> execute）。
6. 开启 `dispatchOutboxV1` 定时调度。

## 7. 回滚步骤
1. 暂停站点派发任务（停止 `dispatchOutboxV1` 定时触发）。
2. 保留 outbox/dead-letter 数据，不做删除。
3. 站点侧移除监管 endpoint 配置，避免继续外发。
4. 监管侧保留 ingest 数据用于审计，不删除历史事件。

## 8. 验收步骤
1. `healthV1` 返回 `status=ok`。
2. `ingestSnapshotV1/ingestEventV1` 可验签并落库。
3. `verifyStatsV1` 的 accepted/repeated/rejected 计数与站点推送预期一致。
4. 站点 `getSyncStatsV1` 中 pending/retrying/dead 可观测且可重放。
5. 完成第 3 章剥离演练并保留报告。
