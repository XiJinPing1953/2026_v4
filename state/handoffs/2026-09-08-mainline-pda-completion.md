# T4：PDA 工位持久完成协议交接

任务于 2026-09-08 派发，2026-09-09 完成本地验证。**工程补丁已完成；未部署、未安装、未连接真实云业务或现场设备。** 本文件供主任务直接读取，未跨任务主动发送消息、未派生子任务。

## 基线、提交与归属

- 正式任务 ID：`01a0805d-2f21-7163-a720-41308809833e`，从本任务 `CODEX_THREAD_ID` 核实。主任务 ID：`01a071ca-9c43-7df3-97b4-96f1e0870ab0`。
- 独立工作区：`/Users/wangbo/.codex/worktrees/0ea9/2026_v4`；初始干净、分离于旧 `90336801cf67d7c31b9df7104de3c1545452285f`。验证祖先关系后建立 `codex/pda-durable-completion`，安全快进至指定工程基线 `bec921d3efe65e802af0835120cf04eda6c15b15`，没有重置或丢弃差异。
- **实现提交：`ebd3bc6b573fb948f04d94550d98b98323b725c4`**，14 个范围内文件；此交接另行提交。包含主控已验收的整车占锁续扫和写入上限修复，未覆盖这些代码。
- 验证结束时发现主控分支已前进至 `f3af112`。相对 `bec921d` 仅新增当前状态、主线总表、领域说明及主控验收文档，没有与本批实现文件重叠。本分支保留指定基线与自己的提交，未自行合入主控的新文档。
- 用户提供的生产源码仍为 `101068b`；本任务没有重新读取生产运行版本。本候选不能直接当成生产树或已上线版本。
- 已依序读取 `AGENTS.md`、`docs/RULES.md`、`STATE.md`、领域索引/PDA 决定、`docs/filling_consistency_v1.md`、主线灌装交接。遵循本任务明确边界，未修改 RULES、STATE、总表、索引、全局验证/发布脚本、账务、灌装/异常/流转核心处理器或导入脚本。
- `/Users/wangbo/Downloads/2026_v4` 源码和 `/private/tmp/crm-julite-release` 未修改。Git 工作区自身的索引/分支提交使用其共享 Git 元数据；没有切换主工作区或写入其源码。构建依赖从主工作区只读克隆到本工作区，没有安装或升级依赖。

## 实现结果与接口契约

正式链路仍为 `PdaFillingTaskCreateView` → `services/pda/fillingTask.js` → `crm-pda-filling` → `crm-filling`。后台新增同目录 `completionProtocol.js`，封装冻结、能力检查、原操作恢复和源单回链；没有在 PDA 中复制灌装源单或流转处理器。

PDA 协议为 `pda-completion-2026-09-08-v1`，依赖灌装协议 `filling-consistency-2026-09-08-v2` 及 `source_status_query: true`。

| 接口 | 本批行为与权限 |
|---|---|
| `capabilitiesV1` | 使用当前请求凭据检查下游能力；返回两个协议号及 `durable_completion: true`。PDA 页面新建或完成权限可以调用，但下游仍自行检查原有灌装创建权限 |
| `createTaskV1` | 要求 `data.completion_protocol` 匹配，并通过下游能力检查后才创建工位任务；目标净重、毛重计算和目标写入字段沿用原流程 |
| `completeTaskV1` / `markAbnormalV1` | 两个入口共用一份协议。客户端只提供任务 ID、协议号和备注；最终事实由后端读取与建立。不能从请求替换操作号、重量、操作者或异常结果 |
| `getTaskV1` | 对新协议任务使用 `getOperationV1` 查询源单与进度，并可修复本任务回链；已冻结或旧完成任务不再读取最新秤。返回 `task.completion`，不返回私有冻结 payload |
| `listCompletionTasksV1` | 按 `completion_pending: true`、`_id` 游标分批读取，每页 20 项，额外读取 1 项确定 `has_more`。普通用户仅列首次完成归属于自己的任务；管理员列全部。仍需完成页查看权限 |
| `claimTargetWriteV1` / `finishTargetWriteV1` | 仅增加与冻结完成竞争时的条件写入保护：抢占输给完成后不返回硬件目标；晚到回执可保留目标写入结果，但不能把已完成任务重新改成 ready/error。净重值、寄存器 `0x00CA` / 202、网关 payload、读回值及联锁流程没有改变 |

### 冻结与同一操作恢复

1. 操作号由后端确定：`pda_complete_` + `SHA-256(task_id)`，与客户端、点击次数或请求编号无关。
2. 第一次完成先确认下游状态查询可用；对尚无冻结事实的任务，若同号下游操作已存在则停止并要求核查，不能重新构造事实去覆盖它。
3. 首个匹配“原可完成状态且 `completion_intent` 不存在”的条件更新冻结整个下游 payload：最终毛重/净重、开始/结束时间、操作者 ID/姓名、备注、正常/异常结果、秤原始信息和当时的目标写入快照。同时写 `status: completion_pending`、`completion_pending: true` 和现有重量/时间字段。并发请求及冻结写入确认丢失后都必须回读获胜版本，不能直接发送自己内存中的候选。
4. 后续完成只读冻结 payload。`getOperationV1` 返回 404 且没有已回链源单时，仅原完成操作者可用原 payload 调用 `createV1`；已有 pending/processing/failed 操作则调用 `retryOperationV1`。complete 只查询并修复回链，不重新建立源单。
5. 下游每次调用后，包括超时/确认丢失，都再次查询操作。**返回 code 0、`_id`、`saved_total` 或 complete 字样本身均不是源单保存凭据。** 必须收到匹配协议、操作号、单条数量、瓶号及 `source_records` 的查询结果，且源单 `saved: true`，才回链并显示已保存。
6. 源单查询确认后，任务才能进入 completed/abnormal；源单 ID、完成时间、处理结果回读成功后才确认任务回链。后续 complete 还要求源版本匹配、保存待办为 0、核查剩余为 0。源版本变化、源单缺失或关联 ID 冲突时停止自动重放，保留明确待核提示。

`completion_intent` 只在首次条件更新写入；之后的回链、目标回执及其他完成入口都不修改它。这里的“物理完成”表示操作者确认并冻结当时称重事实，不新增“阀门已关闭”等硬件证明。

### 状态映射与界面行为

| 已知事实 | 任务状态 / 恢复列表 | 页面及下一步 |
|---|---|---|
| 尚未冻结 | 原工位状态 / 未进入恢复列表 | 显示当前秤，允许原完成或异常完成入口 |
| 已冻结，尚未受理或源单未查到 | `completion_pending` / 保留 | 显示“完成事实已冻结，源单尚未确认保存”；工位仍保留原任务，使用原任务恢复 |
| 源单已保存，任务更新失败或确认丢失 | 可能仍为 `completion_pending` / 保留 | 显示源单已保存和“任务回链待确认”；刷新 `getTaskV1` 即可修复，不重新采秤或建源单 |
| 源单已保存，后续 pending/processing | `completed` 或 `abnormal` / 保留 | 显示“源单已保存，后续处理待完成”和剩余核查数量；工位按原流程释放，返回看板后可从待确认列表重新进入 |
| 源单已保存，后续 failed | `completed` 或 `abnormal` / 保留 | 已保存标签不丢失，展示处理错误，原操作者/管理员可恢复原操作 |
| 源单、源版本、后续 complete 和回链均确认 | `completed` 或 `abnormal` / 移出 | 显示完成；重试按钮停用，留在完成页供查看，不再根据 code 0 自动跳走 |
| 查询中断、权限不足或状态凭据不完整 | 已有数据库事实不被清空 / 尚未结清的列表项保留 | 源单显示尚未确认，错误原因可见；不把缓存任务 ID 当成新的保存证明 |
| 源版本/回链冲突 | 保留当前事实 / 原待办保留 | 可查看源单已存在，但后续标为冲突；停用自动重放，交管理员核查 |

完成页显示冻结后的结束重量/净重、结果、操作者、操作号、已确认源单、后续进度和恢复入口；冻结后不能修改备注或通过异常按钮改变已冻结分类。获取源单成功后清除已被解决的请求确认错误。看板恢复列表显式分页；它不是所有历史任务的完整审计或失败统计。

后续处理仍由灌装已有队列/调度器负责。PDA 没有新增定时器或独立 worker；下游自行完成后，PDA 待确认列表项会在原任务再次查询并回链时清除，因此列表中可能暂时包含已经处理完、尚未确认的任务。

## 操作归属与失败边界

- 保留现有 PDA 页面的查看/更新权限；读取工位/任务基本字段的既有范围不扩大。下游操作状态查询及重试限制为首次完成操作者或已有 admin/superadmin 规则，且下游继续检查自己的页面 ACL。
- 管理员可重试已经存在的原操作，不改下游 `created_by` 或冻结 `operator_id`。如果冻结后尚未创建操作，管理员不能用自己的账号代替原操作者建单；需原操作者有效登录恢复，或主任务另行设计有审计的归属迁移。
- 本模块只透传当前请求 token；任务冻结对象、日志和响应不写入 token/worker_secret。登录凭据更新后可用同一账号的新 token 恢复。下游监管 worker 保留灌装基线本身的操作归属/凭据逻辑，本批未改。
- 源单保存失败、监管入队失败、核查未完成/占锁或失败都沿原操作恢复。重复重试不改变物理结果，即使秤已经换瓶、离线、读数改变或操作者改了显示姓名。
- 灌装前置校验拒绝（同日同瓶、封存、流转预警等）保留冻结事实及错误原因；解决业务问题后才能重放原 payload。本补丁不绕过这些校验、不换操作号重建、不自动修改历史源单。
- 源单和任务回链不是一个跨函数事务。故障可能留下“源单已保存但任务仍占工位”，这是可恢复的中间状态，不能显示整体完成或自动丢弃原任务。

## 数据库变更范围

仅涉及 `crm_pda_filling_tasks`。原文件只存在于历史 `database/schema/`，本任务按“仅本地、根 schema 为来源”的明确范围建立了**本地根目录候选**；没有读取线上实际结构，不能据本候选覆盖未知云约束。

- 根 `uniCloud-alipay/database/crm_pda_filling_tasks.schema.json` 为本批唯一编辑来源；使用既有 `syncDomainContracts.cjs --write` 生成同名兼容副本。
- 新增两个可选字段：`completion_intent`（对象，仅 protocol/payload）和 `completion_pending`（布尔）。没有新增必填字段、没有给旧行批量赋默认值、没有新增集合。
- `status` 枚举追加 `completion_pending`，保留全部旧值；既有 source ID、重量、时间和操作归属字段复用。客户端 CRUD 继续全部关闭。
- 根 `crm_pda_filling_tasks.index.json` 使用现有 `buildIndexFile` 从根 schema 生成：保留历史文件中的 5 个索引定义，新增 `idx_completion_pending_id`（`completion_pending: 1, _id: -1`）。没有新增全局唯一键或修改其他集合索引。
- 主任务上传前须在目标测试/生产空间核对现有字段类型、权限与索引，增量应用这两个字段、一个枚举值和新索引，保留线上额外约束。禁止初始化数据库或整集合替换。
- 当前公共 `config/domain-contracts.json` 的 `promotedSchemas` 尚未登记本集合。本任务专属测试已核对根/副本/索引一致；请主控将该集合纳入统一索引生成检查，保持后续从根生成。未越权修改公共注册表。

## 本地证据

实际执行时间：2026-09-09，全部使用合成任务/瓶/秤/账号和本地存储、传输模拟。

- **专属测试 35/35**：`node --test scripts/pdaFillingCompletion.test.cjs scripts/pdaFillingCompletionFrontend.test.cjs`。其中后台 27 项、前端/契约 8 项。
- **相关组合回归 82/82**：上述两个文件，加 `fillingConsistency.test.cjs`、`crmFillingMaintenance.test.cjs`、`bottleAnomalyArchiveCutoff.test.cjs`、`bottleAnomalyMissingFillPermission.test.cjs`、`frontendTrust.test.cjs`。
- PDA 后台反例实际加载 `crm-pda-filling/index.js` 和 `crm-filling/index.js`/原操作处理模块；没有替换完成实现。覆盖双击/不同备注与秤值并发、不同操作者并发、冻结写入失败/确认丢失、下游调用前后确认丢失、源单保存检查点丢失、源单保存后任务写入失败、code 0 无源单、pending/processing/failed/complete、源版本变化、权限和新凭据、异常完成、旧任务/旧前端、恢复列表分页、目标值/寄存器回归和完成抢占目标领取。
- 前端测试执行实际 service 和完成页 script，连接本地真实 PDA/灌装 handler，验证不假报保存、不自动跳页、冻结值展示、异常入口、恢复与双击保护；另验证根 schema/兼容副本/索引一致。
- `npm run build:h5` 通过。最终本地编译标记 `1788919754438-7d0ff619`，构建时 `source=bec921d3efe6 dirty=true`，**仅作编译证据，不能作为发布产物**。未升级 Browserslist 或依赖。
- 浏览器隔离检查通过：使用合成 handler 响应渲染实际完成组件/基础控件，检查 400px 内容宽度下未保存、已保存待处理及点击恢复后的完成状态，长编号换行、冻结备注和按钮状态可见。预览禁用外部连接，页面鉴权用测试替身；不等同于整站登录或 PDA 真机验收。浏览器及仅监听本机的预览服务已关闭。
- `node scripts/syncDomainContracts.cjs`：通过，同步 0 项；两个 PDA 后台文件语法检查、`git diff --check` 通过。`node scripts/checkProjectContext.cjs` 通过：18 份当前资料、STATE 56 行、1 份归档完整。
- 本地辅助证据位于 `outputs/trust-audit/pda-completion-qa/`（测试 TAP、构建日志及合成页面预览）；该目录被既有规则忽略，不进入提交。可重跑的正式反例和模拟存储代码在提交的 `scripts/` 专属文件中。

测试数据库的原子条件更新/串行事务模拟不能证明支付宝真实冲突行为、隔离级别或回滚；监管和扫描运输替身不能证明真实 outbox 去重、监管平台收到、现场秤稳定或联锁动作。全局测试注册、真实云测试与现场验收由主任务接管。

## 主任务整合、升级与在途条件

1. 审查并合入实现提交及本交接；继续继承主线灌装候选和已上线账务修复，不能只把本函数叠到缺 v2 操作模块的 `101068b`，也不能全量覆盖生产。
2. 公共登记待补：在 `scripts/verifyTrust.cjs` 登记两个专属测试及 PDA 后台语法入口；在 `config/release-products.json` 的实际发布范围加入 **`crm-pda-filling`、根 `crm_pda_filling_tasks.schema.json` / `.index.json`**，并组合配套 H5/PDA 版本；在 schema 公共生成登记中加入本集合。现有发布范围缺这些对象，本批没有代改公共文件。
3. 先在隔离支付宝测试空间核对增量 schema/index，再部署完整 `crm-pda-filling/` 目录（新增 `completionProtocol.js`、`package.json` 及既存 ACL 文件均需包含）。本函数显式 60 秒、256MB，没有新触发器。依赖完整 `crm-filling` v2、基线异常/流转函数、既存监管桥与 outbox 索引；具体核心部署依赖仍以主线灌装说明为准。
4. 使用实际普通操作员账号验证 PDA 新建/完成权限、下游灌装 create/view 权限及有效监管凭据。必须实测同任务并发条件写入只有一份冻结对象、确认丢失后同原号回查、源单及两类流转只有一份、任务回链失败可恢复、监管事件/快照去重、断网/换瓶后重试不重采秤。
5. 发布前停止旧新建入口并清点在途任务、旧前端资源及旧云函数仍在执行的请求；等待旧调用退出后切换。**不能让旧完成实现和新冻结实现并存处理同一在途任务。** 新服务先查 PDA/灌装能力；新后台对缺协议的旧 create/complete/abnormal 请求返回 426，从而阻止旧页面继续把 code 0 当作已保存。
6. 旧 active 任务没有冻结对象且尚未完成时，可以由新后台在首次完成时按现场真实秤值采用新协议；必须确认现场仍是原瓶、任务未曾实际完成、开始事实可信。不是自动把已离秤旧任务按新秤补录。
7. 旧 completed/abnormal 或已有 source ID、但没有冻结对象的任务不自动重建。已有 ID 通过 `getV1` 查询，并核对源单中 `raw_scale_payload.task.task_id` 和瓶号后才能显示已保存；后续统一标 `legacy_review`。无 ID、源单缺失、身份不符或缺少原 task 关联时待人工审计，不重新采秤，也不臆造操作号。这些历史任务不会自动加入新恢复队列，须在切换清点中单列。
8. 新冻结未建单的在途任务依赖原完成账号继续有效；已有操作可由符合原权限规则的管理员接续。回退不得丢弃冻结对象、操作表或恢复到会重新称重建单的旧完成逻辑；先保存任务/操作/源单对应关系并排空或制定逐项可恢复方案。
9. 主任务按现场安排发布/安装新 PDA 包并验证扫码、C606+ 连续瓶、断连、目标下发/读回、联锁及完成恢复。H5 编译和本地合成页面不能替代原生安装、真实称重或硬件验收。

机制参考：[uniCloud 云数据库条件更新及返回值](https://doc.dcloud.net.cn/uniCloud/cf-database)、[数据库操作符](https://doc.dcloud.net.cn/uniCloud/cf-database-dbcmd.html)。本任务查阅仅用于核对 API，不能作为目标云空间的实际验收证据。
