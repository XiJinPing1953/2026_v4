# 灌装保存与流转核查

2026-09-08 工程候选；操作协议为 `filling-consistency-2026-09-08-v2`，流转规则仍为 `bottle-flow-2026-09-05-v1`。本轮只有代码和本地验证，没有部署或真实云验收。交付详情见 [主线灌装交接](../state/handoffs/2026-09-08-mainline-filling.md)。

**发布阻塞：当前 PDA 工位任务尚未接入。** `/pages/pda/filling-create` 实际挂载 `PdaFillingTaskCreateView`，完成页调用 `crm-pda-filling.completeTaskV1`。该后台调用 `crm-filling.createV1` 时没有 `operation_id`；重试还会重新取秤值和结束时间。旧文档“单条/PDA 已接入”只适用于 `src/services/pda/filling.js` 的直接录入服务，不能作为当前工位链路完成的证据。主任务须补齐任务后台的冻结提交和保存确认后才能安排配套 PDA 发布；本补丁没有修改现场控制或该范围外云函数。

## 已实现的接口与组件关系

| 入口 | 关联模块 | 实际行为 |
|---|---|---|
| H5 单条、批量录入 | `src/services/filling.js` → `fillingOperations.js` → `crm-filling` | 提交前能力与协议版本检查；先在当前用户本地保存紧凑签名和操作号 |
| `createV1`、`batchCreateV1` | `crm-filling/index.js` → `fillingOperations.js` | 校验、预警后持久化冻结草稿、确定源单 ID、目标瓶/车及初始版本；再开始执行 |
| 每行保存 | `saveOperationFillingRow` | 一个短事务写日期/瓶号占位、源单、充装流转及气体库存流转 |
| 每行后续处理 | `synchronizeOperationFillingRow` | 起始损耗调整、瓶状态；直接单条入口另要求监管事件与快照入队 |
| 逐目标核查 | `crm-bottle-anomaly.touchFillingOperationV1` | 从私有操作读取瓶号/游标，校验凭据、租约、源版本；核查结果需完整读取凭据 |
| 状态与恢复 | `getOperationV1`、`listOperationsV1`、`retryOperationV1`、`FillingOperationPanel` | 显示操作号、失败原因、源单保存状态、已扫/剩余数量；自动调度和人工重试 |
| 当前 PDA 工位完成 | `src/services/pda/fillingTask.js` → `crm-pda-filling` | **仍不兼容本协议，不能上线切换** |

`operation_id` 必须是 12—128 位字母、数字、下划线或连字符。相同编号不同内容返回 409；同编号同内容查询原操作，不重新生成源单。批量 `preview:true` 不写操作，无需编号。服务端输入摘要排除预览/预警确认标志；本地签名区分单条与批量入口，不保留原始批量文本、备注或 token。

`code:0` 表示已受理，只有 `data.complete:true` 才表示全部处理完成。`saved_total` 是已持久化的保存检查点，确认丢失时可能滞后；`getOperationV1` 另按冻结源单 ID 回读 `source_records` 和 `source_saved_total`，可查到已提交但检查点未确认的源单。不存在的源单标明未保存，版本变化单独标记。单条未确认保存时不返回可误认为已存在的 `_id`。

操作仅本人和管理员可查，仍需灌装/PDA 查看权限；重试需创建权限。私有 `worker_secret`、冻结原文、操作者 token 不返回状态接口。列表先显示最多 100 个未完成操作，再以完成操作补足 20 条；不是全局积压总数。前端额外逐批查询本机记住而列表未包含的操作，释放已完成的本地编号，保留未确认编号和提示。

## 冻结、事务、租约与重试

- 源单版本从 1 开始，旧任务以 `source_version` 和 `updated_at` 校验；未完成操作的源单拒绝常规编辑、删除、批量日期和操作人修正。后台在保存、同步、扫描前及扫描完成后检查版本；条件更新未命中时回读确认，不能直接将旧任务标为完成。完成后的历史改单仍走原流程，不在本轮持久任务内。
- 事务 `doc().get()` 兼容对象、数组和空值返回。事务只作单记录写入；历史同日同瓶查询和确定占位记录仍需真实支付宝事务冲突验收。每行提交前耗时达到 8 秒则回滚重试，为官方 10 秒窗口留余量；不能取消已发出的数据库请求，实际时限仍由云端执行。`last_transaction_ms` 只表示最近成功源单事务耗时，不代表整批耗时或 p95。
- 操作处理租约 120 秒，三个函数候选超时均为 60 秒。提交/手动重试每轮预算 6 秒，调度总预算 40 秒；这些预算在步骤之间检查，单次数据库/跨函数等待可以超过预算。不能把本地快速模拟当作实际时延通过；不得单独把函数超时延长到租约以上。
- 暂时失败按 1、2、4、8 分钟等待，连续第 5 次失败停止自动重试（公式上限 15 分钟）；成功推进重置连续失败次数。失败保留原操作，人工重试使用原编号。不同处理协议的旧任务停止并提示部署版本不符，不自动转换冻结草稿。
- `scan_` 每瓶租约现在覆盖持久核查、普通 `scanV2`、整车扫描、touch/rebuild 内部扫描；相同瓶的扫描会等待。`projection_` 租约只串行灌装模块的瓶状态投影。两个租约不是同一把锁，销售、检验、手动状态修改、导入与直接数据库写者未加入；不宣称全系统并发一致。
- 单条监管调用使用操作者当前凭据、固定源类型 `filling` 和源单 ID。除 `code:0` 外，必须确认一条事件及一条快照已新增或已去重、没有缺失瓶。凭据失效/零入队/部分入队保留已保存源单并重试。这证明入队确认，不证明监管平台已接收；监管 outbox 唯一索引及确认丢失后的幂等必须在测试空间验证。

## 完整事件链和异常结果

所有瓶扫描先按 `_id` 完整读取，核对前后计数及变更标记，计算内容 SHA-256；在内存规范化旧事件字段后再按事件时间、类型、创建时间、ID 分页处理。这样缺少 `type_order/created_at` 的历史记录不会在第 200 条后被数据库游标跳过。每轮最多 800 个事件的持久核查保留瓶内游标，53 个瓶完成 6 个后可继续剩余 47 个。普通扫描也采用见证游标，旧游标无内容见证则安全重开。

扫描前后内容变化或续扫时见证不符，清掉旧游标并重新核查；未完成返回 `read_complete:false`，并保留 `history_changed`。结果附 `history_total/computed_at/rule_version`；灌装端拒绝没有完整读取证明或规则版本不同的“done”。完整计算的 5,000 条旧阈值不再强制让扫描永不完成；真实安全上限仍明确报未完成。

异常项在逐轮处理中写入，扫描完成前的列表仍可能包含待复核的中间结果。见证覆盖钢瓶流转集合，不是跨集合事务快照；车销售/补气读取、手动异常处理、两次见证以外的并发及同刻无时间戳写入不是原子保证。长时间持续写入可能反复重扫；本轮没有历史自动全量重扫、历史事实改写或生产迁移。

## 最小部署依赖与顺序（由主任务执行）

1. 先解决当前 PDA 工位完成协议阻塞，确认隔离支付宝测试空间、可恢复快照和监管测试接收端；本轮不得连接真实生产瓶。核对实际线上结构后增量建立根目录 `crm_filling_operations`、`crm_filling_slots`、`crm_bottle_scan_locks`，客户端 CRUD 全关。私有集合使用确定 `_id`，必须验证唯一冲突行为。
2. 上传操作队列的 `uniq_operation_id/idx_status_retry/idx_owner_created` 索引；确认源单同日瓶号查重索引、两类流转 `source_id` 查询索引、流转 `idx_bottle_event_cursor`。保留源单/两类流转版本字段和源单一致性字段，操作新增 `last_transaction_ms`。既存集合不能用本地文件覆盖未知线上约束；禁止 `initdatabase`。
3. 检查 `common/bottleFlowRules.js` 的三份生成副本一致。以完整目录打包 `crm-bottle-movement`、`crm-bottle-anomaly`、`crm-filling`，包含各自 `financialReadLocal`、规则和 ACL 副本；灌装另含 `fillingOperations/flowWarningPaging/operatorRepairSupport`。本轮三个 `package.json` 声明 60 秒，不能遗漏新增配置。
4. `crm-filling` 调度配置使用七位 `17 * * * * * *`；支付宝控制台直接配置用六位 `17 * * * * *`。只信任平台 `context.SOURCE === 'timing'`。真实触发源、每分钟第 17 秒运行和故障恢复均未验证，删除本地配置不等于云端触发器已删除。
5. 核验监管桥既存版本、outbox 唯一索引、创建/查看权限及有效测试账号；任务不保存 token。部署三个函数并完成能力探测及隔离演练后，主任务安排同批 H5/PDA 版本切换。不得直接把包含未发布账务等候选的整个工作区覆盖生产。
6. 旧 H5 缺操作号会收到升级提示，应暂停新灌装入口、保存操作号，再统一刷新/退出重登新资源。新 H5 拒绝旧后台或旧协议；旧工位 PDA 不可继续调用当前完成链路，须等任务后台修补和配套安装/真机验收。已有受理操作先排空并留证，回退代码不能丢弃操作表或退回会重复写源单的旧创建逻辑。

官方机制依据：[事务 API](https://doc.dcloud.net.cn/uniCloud/cf-database?id=start-transaction)、[定时触发](https://doc.dcloud.net.cn/uniCloud/trigger.html)、[函数配置](https://doc.dcloud.net.cn/uniCloud/cf-functions)、[云函数来源](https://doc.dcloud.net.cn/uniCloud/cf-callfunction)。2026-09-08 查阅；官方文档不是本项目真实云验收证据。

## 默认只读的真实云验收工具

`node scripts/fillingCloudAcceptance.cjs` 只生成离线方案，不读凭据、不联网。`--run 20260908A --fixture-out /private/tmp/filling-synthetic.json` 可生成 53 个合成瓶及 5,189 条历史事件，拒绝覆盖已有文件。主任务需预检精确 ID 冲突、保存快照后自行导入隔离空间，工具没有业务写入、故障注入或部署方法。

真实回读使用 `node scripts/fillingCloudAcceptance.cjs --run 20260908A --space-id TEST_SPACE --adapter /private/tmp/filling-read-adapter.cjs`。adapter 由主任务在隔离环境提供，导出 `{ provider:'alipay', spaceId:'TEST_SPACE', isolated:true, db, call(name,event) }`；`call` 使用测试账号并返回函数的 `result`，`db` 使用真实 SDK 的只读查询权限。凭据留在本地 adapter/环境中，不输出或提交。工具在云调用前校验环境，明确拒绝已知生产空间 `env-00jxuffegf2n`，只读固定合成 operation/source/bottle 范围，输出计数、检查结果与哈希。

该回读只验证合成操作最终状态：53 个源单、53 条充装流转、53 条库存流转、原 5,189 条历史保持及零误报。它不能证明实际中断位置、回滚、租约抢占、调度触发或监管推送；这些证据须按交接中的演练表另收集。演练结束先停隔离调度并等待执行退出，再按精确对象清单恢复快照/清理，优先销毁一次性测试空间，不按宽泛日期/瓶号前缀清理其他数据。
