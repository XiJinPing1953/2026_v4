# 监管平台独立云空间一期实施清单（落地版）

## 1. 范围与目标
- 目标：先打通“站点空间 -> 监管空间”的实时同步链路，一期仅交付接口与数据验收，不交付监管前台页面。
- 同仓多空间部署：同仓维护 `crm-reg-*` 模块，按不同 `space-id` 分别部署站点侧与监管侧。
- 同步策略：`快照 + 事件`、`全量基线 + 增量实时`、`强重试 + 死信`。
- 一期字段口径：
  - 编号=`product_no`
  - 单位内编号=`bottle_no`
  - 产权单位=`filling_company`（一期临时）
  - 当前位置=`status + current_customer_name`

## 2. 已落地接口契约

### 2.1 站点侧 `crm-reg-bridge`
- `enqueueSnapshotV1`
- `enqueueEventV1`
- `dispatchOutboxV1`
- `bootstrapSnapshotV1`（`preview/execute`）
- `replayDeadV1`
- `getSyncStatsV1`

### 2.2 监管侧 `crm-reg-ingest`
- `ingestSnapshotV1`
- `ingestEventV1`
- `healthV1`
- `verifyStatsV1`

### 2.3 固定协议
- `schema_version = v1`
- 幂等键规则：`station_id + payload_type + source_type + source_id + bottle_no + event_at(+index)`
- 签名：`HMAC-SHA256`
- 头字段：
  - `x-reg-station-id`
  - `x-reg-key-id`
  - `x-reg-timestamp`
  - `x-reg-nonce`
  - `x-reg-signature`
  - `x-reg-sign-version=v1`
  - `x-reg-sign-alg=HMAC-SHA256`
  - `x-reg-body-sha256`

## 3. 数据结构

### 3.1 站点空间
- `crm_bottles` 新增字段：`gas_medium_code`、`station_id`
- 新增集合：
  - `crm_reg_outbox`
  - `crm_reg_push_logs`
  - `crm_reg_dead_letters`

### 3.2 监管空间
- 新增集合：
  - `crm_reg_station_registry`
  - `crm_reg_bottle_current`
  - `crm_reg_bottle_events`
  - `crm_reg_ingest_dedup`
  - `crm_reg_ingest_logs`
  - `crm_reg_dead_letters`

## 4. 业务写入后异步入队（已接入）
- `crm-bottle`：`createV1/updateV1` 成功后触发 `profile_update + snapshot` 入队（失败仅 warning，不阻塞主业务提交）。
- `crm-filling`：`createV1/updateV1/removeV1` 成功后触发事件/快照入队（失败仅 warning）。
- `crm-sale`：`createV2/updateV2/removeV2` 成功后触发事件/快照入队（失败仅 warning）。

## 5. 基线与增量上线顺序
1. 发布 schema 与 `crm-reg-*` 云函数（站点 + 监管）。
2. 在站点执行 `crm-bottle.backfillRegFieldsV1`：先 `execute=false` 预览，再 `execute=true` 回填。
3. 在站点执行 `crm-reg-bridge.bootstrapSnapshotV1`：先 `preview=true`，再 `preview=false`。
4. 启用增量派发任务（定时执行 `dispatchOutboxV1`）。
5. 监管侧用 `verifyStatsV1` 对账，站点侧用 `getSyncStatsV1` 观察队列/死信。

## 6. 环境变量（禁止硬编码）
- 站点侧：
  - `REG_ENDPOINT`
  - `REG_KEY_ID`
  - `REG_SECRET`
  - `REG_STATION_ID`
  - 可选：`REG_STATION_NAME`、`REG_DEFAULT_MEDIUM_CODE`、`REG_TIMEOUT_MS`、`REG_MAX_RETRIES`
- 监管侧：
  - 可选：`REG_ALLOW_SKEW_MS`

## 7. 剥离就绪约束（纳入一期验收）
- [x] 代码边界：监管代码仅放在 `crm-reg-*` 命名空间。
- [x] 数据边界：监管侧仅使用 `crm_reg_*` 集合。
- [x] 契约边界：站点与监管仅通过 `snapshot_v1/event_v1`（`ingestSnapshotV1/ingestEventV1`）交互。
- [x] 配置边界：监管关键参数环境变量化。
- [x] 鉴权边界：签名算法和头字段版本固定，支持多活 key（双 key 轮换窗口）。
- [x] 部署边界：提供“仅监管模块”部署清单（见本文件 + 剥离手册）。
- [x] 运维边界：补推/重放/死信处理均可通过云函数调用完成，不依赖站点业务页面。
- [x] 文档边界：已输出剥离手册。
- [x] 剥离演练：提供最小复制演练脚本并输出报告。

## 8. 仅监管模块部署清单

### 8.1 站点空间最小发布
- 云函数：`crm-reg-bridge`
- Schema：
  - `crm_reg_outbox.schema.json`
  - `crm_reg_push_logs.schema.json`
  - `crm_reg_dead_letters.schema.json`
  - `crm_bottles.schema.json`（字段扩展）

### 8.2 监管空间最小发布
- 云函数：`crm-reg-ingest`
- Schema：
  - `crm_reg_station_registry.schema.json`
  - `crm_reg_bottle_current.schema.json`
  - `crm_reg_bottle_events.schema.json`
  - `crm_reg_ingest_dedup.schema.json`
  - `crm_reg_ingest_logs.schema.json`
  - `crm_reg_dead_letters.schema.json`

## 9. 运维动作（无需业务页面）
- 站点补基线：`bootstrapSnapshotV1`
- 站点派发：`dispatchOutboxV1`
- 站点重放死信：`replayDeadV1`
- 站点统计：`getSyncStatsV1`
- 监管健康检查：`healthV1`
- 监管验收统计：`verifyStatsV1`

终端调用示例（站点空间）：
```bash
node scripts/reg/runRegBridgeAction.cjs \
  --space-id=<站点space-id> \
  --username=superadmin \
  --password=<密码> \
  --action=dispatchOutboxV1 \
  --data-json='{\"batch_size\":50}'
```

## 10. 测试验收清单
- 单元：签名/验签、幂等键、映射转换、重试退避。
- 集成：`fill/out/back/profile_update` 后同时产生事件与快照，监管侧状态一致。
- 异常：签名错误、超时、5xx、重复投递，验证重试与死信。
- 基线：全量后抽样 100 瓶对账。
- 剥离验收：执行最小复制演练并回归 `healthV1/ingest*/verifyStatsV1`。
