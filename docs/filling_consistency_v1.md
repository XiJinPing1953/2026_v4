# 灌装保存与流转核查 V1

本版将 `batchCreateV1` 与单条/PDA 的 `createV1` 纳入同一持久化处理。历史改单、销售写入仍使用原流程。单条灌装保留监管事件入队，后台读取操作者当前登录凭据；凭据失效或监管入队失败进入可见的失败/重试状态，不在操作中保存 token。所有新任务只从实际提交开始，没有历史记录自动回填、历史异常重扫或生产迁移。

## 业务结果与恢复

前端在请求前将本次内容的紧凑签名与 `operation_id` 写入当前用户的本地存储（不保存批量原文和备注）。同一内容的重试沿用原编号；网络确认丢失后只查询原操作，不生成新编号自动补交。操作接受后冻结源记录草稿、生成的记录 ID、目标瓶号和初始版本。

每一行在一个短事务中提交源单、`operation_id/source_version/consistency_status`、充装流转和气体库存流转。操作本身已先持久化，事务前后中断均可从原行恢复。单条和批量提交通过日期/瓶号唯一占位记录协调并发；事务中再次查询历史源单，排除没有占位记录的既存灌装。同一编号并发提交只创建一个操作，不同编号同时抢同一日期/瓶号也只有一个源单提交。

事务完成后补算原有起始损耗并同步瓶状态，随后逐瓶核查异常。先完成所有源单处理，再开始异常扫描；异常扫描的瓶号位置和瓶内游标分别持久化。53 个瓶完成 6 个后中断，余下 47 个会自动继续；单瓶超过 800 个事件也从瓶内游标继续。相同时间戳以 `_id` 作为分页最后排序字段，避免跨页跳过事件。

返回 `code: 0` 表示操作已受理。`data.complete` 才表示全部保存和流转核查完成；`saved_total` 是已持久化确认的保存进度，`pending_save_total` 是待确认/待保存数。`remaining_total` 是待核查的瓶/车数量，`last_error` 表示最近一次失败。故障后按 1、2、4、8、15 分钟间隔重试，连续 5 次失败停止自动重试，前端提供“重试剩余处理”。

尚未处理完的源单拒绝编辑、删除和批量日期/操作人修正。该约束防止旧任务覆盖新改动；后台再次读取源单版本，发现版本不符或已保存源单被删除就停止，不能凭冻结草稿覆盖新状态。完成后可按原流程修改。

同一瓶的后台异常处理使用独立租约，查询时完整读取事件并校验内容 SHA-256 指纹；续扫期间历史变化会清掉旧游标并重新核查。读取结果带 `read_complete/computed_at/rule_version`。这是读取期间的变化检测，不是跨集合原子快照。指纹能发现未更新时间标记的旧写者改动；两次读取之外的跨集合并发仍不在原子一致性保证内。灌装瓶状态投影使用每瓶租约串行处理，但其他模块写瓶状态尚未纳入同一锁。

## 接口与权限

- `capabilitiesV1`：前端提交前核对持久操作能力和规则版本；旧后台返回不支持时停止提交。
- `createV1` / `batchCreateV1`：执行必须带 12—128 位字母、数字、下划线或连字符的 `operation_id`。原预览不写操作，无需编号。相同编号不同内容返回 409；已受理操作返回最新状态。
- `getOperationV1({ operation_id })`：查看自己提交的操作；管理员可查看全部。仍需灌装查看权限。
- `listOperationsV1()`：优先返回最多 100 个有权查看的未完成操作，按创建时间从旧到新展示；不足 20 个时用已完成操作补足。该列表不是全局积压总数。
- `retryOperationV1({ operation_id })`：需要灌装创建权限及操作归属权限，重试剩余步骤。
- `crm-bottle-anomaly.touchFillingOperationV1`：只接受数据库私有操作凭据和当前租约。瓶号、源版本及续扫位置均从数据库读取，不信任传入的瓶号/游标。私有凭据不返回前端、不保存用户登录 token。

状态、编号、失败原因可由灌装页“灌装处理状态”查看；页面关闭后定时器仍继续。

## 发布依赖与实际验收

1. 增量建立 `crm_filling_operations`、`crm_filling_slots`、`crm_bottle_scan_locks`，客户端 CRUD 全部关闭。上传操作队列索引及流转 `(bottle_no,event_at,type_order,created_at,_id)` 索引，增加源单/两类流转的版本字段。
2. 同步 `common/bottleFlowRules.js` 至 `crm-filling`、`crm-bottle-movement`、`crm-bottle-anomaly` 的本地副本，部署三者。`crm-filling` 包含 `fillingOperations.js`、`flowWarningPaging.js`、`operatorRepairSupport.js`，不能漏包。
3. `crm-filling/package.json` 的函数超时为 60 秒；工作租约为 120 秒，不得单独延长函数超时使其超过租约。`triggers` 使用统一七位配置 `17 * * * * * *`；在支付宝云控制台直接配置时使用六位 `17 * * * * *`，每分钟第 17 秒执行。函数仅信任平台 `context.SOURCE === 'timing'`，伪造客户端事件不能触发队列处理。
4. 发布 H5/小程序及 PDA 新服务层。旧前端没有操作编号，单条和批量创建均会被明确拒绝，因此函数及前端必须作为同次发布交付。
5. 在测试环境验证事务回滚、真实触发器来源、租约超时恢复、53 瓶续跑、权限隔离及完整状态，再验收生产。不能把本地模拟测试当作支付宝云端事务/定时器已验证。

官方机制依据：[事务（事务窗口不超过 10 秒）](https://doc.dcloud.net.cn/uniCloud/cf-database.html#start-transaction)、[定时触发](https://doc.dcloud.net.cn/uniCloud/trigger.html)、[云函数来源 SOURCE](https://doc.dcloud.net.cn/uniCloud/cf-callfunction)。

## 本地验证

`node --test scripts/fillingConsistency.test.cjs scripts/crmFillingMaintenance.test.cjs scripts/bottleAnomalyArchiveCutoff.test.cjs scripts/bottleAnomalyMissingFillPermission.test.cjs`

新增测试通过实际云函数 handler，存储和云调用使用可控模拟。覆盖回滚、提交后确认丢失、同/不同操作编号并发、单条与批量抢占、历史无占位查重、旧失败任务可见、53→6+47、单瓶 800+201 个同时间事件、续扫游标、旧版本保护、失败重试、过期锁恢复、权限及伪造触发器；保留 8 月 27 日封存截止和超管大额损耗规则的现有测试。
