# 灌装保存与流转核查

2026-09-08主控验收补充：全量重扫遇到占锁整车时保留当前车辆与续扫位置，不能跳过并宣布完成；整车异常新增、更新或旧异常处理达到每轮写入上限时返回未完成，下一轮按同一目标继续。对应失败/恢复反例已加入 `scripts/fillingConsistency.test.cjs`。这些是工程候选修复，尚无生产部署或真实云调度验收。

2026-09-08 工程候选；操作协议为 `filling-consistency-2026-09-08-v2`，流转规则仍为 `bottle-flow-2026-09-05-v1`。本轮只有代码和本地验证，没有部署或真实云验收。交付详情见 [主线灌装交接](../state/handoffs/2026-09-08-mainline-filling.md)。

**2026-09-09更新：工位PDA和历史灌装导入已补齐并通过本地工程验收。** 此条替代09-08“工位后台尚未接入”的候选状态；生产仍未切换。PDA使用`pda-completion-2026-09-08-v1`，固定首次称重、结束时间、操作者和操作编号；回读时同时核对内容摘要、原创建者、源单及版本。历史导入失败重跑会恢复原操作，不能只查询失败状态。主任务补修了异内容占号被认作完成、旧任务被晚到回执重新打开两处PDA问题，见[第二批总验收](../state/handoffs/2026-09-09-mainline-entry-acceptance.md)。真实云事务、调度及PDA现场仍未验收，完整候选不得直接上传生产。

## 已实现的接口与组件关系

| 入口 | 关联模块 | 实际行为 |
|---|---|---|
| H5 单条、批量录入 | `src/services/filling.js` → `fillingOperations.js` → `crm-filling` | 提交前能力与协议版本检查；先在当前用户本地保存紧凑签名和操作号 |
| `createV1`、`batchCreateV1` | `crm-filling/index.js` → `fillingOperations.js` | 校验、预警后持久化冻结草稿、确定源单 ID、目标瓶/车及初始版本；再开始执行 |
| 每行保存 | `saveOperationFillingRow` | 一个短事务写日期/瓶号占位、源单、充装流转及气体库存流转 |
| 每行后续处理 | `synchronizeOperationFillingRow` | 起始损耗调整、瓶状态；直接单条入口另要求监管事件与快照入队 |
| 逐目标核查 | `crm-bottle-anomaly.touchFillingOperationV1` | 从私有操作读取瓶号/游标，校验凭据、租约、源版本；核查结果需完整读取凭据 |
| 状态与恢复 | `getOperationV1`、`listOperationsV1`、`retryOperationV1`、`FillingOperationPanel` | 显示操作号、失败原因、源单保存状态、已扫/剩余数量；自动调度和人工重试 |
| 当前 PDA 工位完成 | `src/services/pda/fillingTask.js` → `crm-pda-filling` | 服务端冻结原事实，原操作恢复、源单回链及待确认列表；已本地验收，须配套发布及现场验收 |
| 历史灌装导入 | `scripts/importFillingsFromJson.cjs` → `crm-filling` | 稳定源身份、冻结恢复日志；回查后重试原操作，已确认保存与全部完成分列；预览不写业务 |

`operation_id` 必须是 12—128 位字母、数字、下划线或连字符。相同编号不同内容返回 409；同编号同内容查询原操作，不重新生成源单。批量 `preview:true` 不写操作，无需编号。服务端输入摘要排除预览/预警确认标志；本地签名区分单条与批量入口，不保留原始批量文本、备注或 token。

`code:0` 表示已受理，只有 `data.complete:true` 才表示全部处理完成。`saved_total` 是已持久化的保存检查点，确认丢失时可能滞后；`getOperationV1` 另按冻结源单 ID 回读 `source_records` 和 `source_saved_total`，可查到已提交但检查点未确认的源单。不存在的源单标明未保存，版本变化单独标记。单条未确认保存时不返回可误认为已存在的 `_id`。

09-09新增`source_payload_hash:true`能力：`getOperationV1`提供`input_hash/created_by`，PDA必须核对冻结payload摘要及首次完成操作者，导入必须核对恢复日志的冻结摘要。缺少或不匹配时停止自动回链/重放，不凭编号和瓶号认作同一业务。摘要算法原样提取到`common/fillingPayload.js`并生成灌装/PDA副本，既有操作摘要不变；不返回冻结原文或凭据。PDA与导入都在写入前要求该能力，因此须使用本次完整后端，不能只按v2字符串判断兼容。

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

1. 工位PDA和导入代码缺口已补齐；先确认隔离支付宝测试空间、可恢复快照和监管测试接收端，不使用生产真实瓶演练。核对实际线上结构后增量建立根目录 `crm_filling_operations`、`crm_filling_slots`、`crm_bottle_scan_locks`，客户端 CRUD 全关。私有集合使用确定 `_id`，必须验证唯一冲突行为。`crm_pda_filling_tasks`根schema/index已登记为候选；上传前核对云端现有结构，仅增量应用两个可选完成字段、状态枚举和待确认索引，保留额外约束。
2. 上传操作队列的 `uniq_operation_id/idx_status_retry/idx_owner_created` 索引；确认源单同日瓶号查重索引、两类流转 `source_id` 查询索引、流转 `idx_bottle_event_cursor`。保留源单/两类流转版本字段和源单一致性字段，操作新增 `last_transaction_ms`。既存集合不能用本地文件覆盖未知线上约束；禁止 `initdatabase`。
3. 检查`common/bottleFlowRules.js`三份及`common/fillingPayload.js`两份生成副本。完整打包`crm-bottle-movement`、`crm-bottle-anomaly`、`crm-filling`及`crm-pda-filling`，保留各自规则、读取与ACL辅助文件；灌装另含`fillingOperations/flowWarningPaging/operatorRepairSupport/fillingPayloadLocal`，PDA含`completionProtocol/fillingPayloadLocal/package.json`。四函数显式60秒配置，不能漏包。公共发布候选范围已登记PDA函数及任务schema/index，不代表已部署。
4. `crm-filling` 调度配置使用七位 `17 * * * * * *`；支付宝控制台直接配置用六位 `17 * * * * *`。只信任平台 `context.SOURCE === 'timing'`。真实触发源、每分钟第 17 秒运行和故障恢复均未验证，删除本地配置不等于云端触发器已删除。
5. 核验监管桥既存版本、outbox唯一索引、创建/查看权限及有效测试账号；任务不保存token。部署四函数并完成能力探测、53瓶故障恢复及实际PDA/导入入口隔离演练后，主任务安排同批H5/PDA切换。不得把包含未发布账务等候选的整个工作区覆盖生产。
6. 新后台拒绝缺少协议的旧PDA新建/完成请求。切换前暂停旧新建入口、保存操作/源单对应关系、清点在途任务并等待旧调用退出，不让旧完成逻辑与冻结逻辑并发处理同一任务。旧completed/abnormal或已有源单却缺冻结事实的任务保持待核，晚到目标回执不能重新打开；不重新采秤补单。未完成冻结任务及已受理操作排空或制定逐项恢复方案，回退不能丢弃冻结事实或恢复会重复建单的旧逻辑。

官方机制依据：[事务 API](https://doc.dcloud.net.cn/uniCloud/cf-database?id=start-transaction)、[定时触发](https://doc.dcloud.net.cn/uniCloud/trigger.html)、[函数配置](https://doc.dcloud.net.cn/uniCloud/cf-functions)、[云函数来源](https://doc.dcloud.net.cn/uniCloud/cf-callfunction)。2026-09-08 查阅；官方文档不是本项目真实云验收证据。

## 默认只读的真实云验收工具

`node scripts/fillingCloudAcceptance.cjs` 只生成离线方案，不读凭据、不联网。`--run 20260908A --fixture-out /private/tmp/filling-synthetic.json` 可生成 53 个合成瓶及 5,189 条历史事件，拒绝覆盖已有文件。主任务需预检精确 ID 冲突、保存快照后自行导入隔离空间，工具没有业务写入、故障注入或部署方法。

真实回读使用 `node scripts/fillingCloudAcceptance.cjs --run 20260908A --space-id TEST_SPACE --adapter /private/tmp/filling-read-adapter.cjs`。adapter 由主任务在隔离环境提供，导出 `{ provider:'alipay', spaceId:'TEST_SPACE', isolated:true, db, call(name,event) }`；`call` 使用测试账号并返回函数的 `result`，`db` 使用真实 SDK 的只读查询权限。凭据留在本地 adapter/环境中，不输出或提交。工具在云调用前校验环境，明确拒绝已知生产空间 `env-00jxuffegf2n`，只读固定合成 operation/source/bottle 范围，输出计数、检查结果与哈希。

该回读只验证合成操作最终状态：53 个源单、53 条充装流转、53 条库存流转、原 5,189 条历史保持及零误报。它不能证明实际中断位置、回滚、租约抢占、调度触发或监管推送；这些证据须按交接中的演练表另收集。演练结束先停隔离调度并等待执行退出，再按精确对象清单恢复快照/清理，优先销毁一次性测试空间，不按宽泛日期/瓶号前缀清理其他数据。
