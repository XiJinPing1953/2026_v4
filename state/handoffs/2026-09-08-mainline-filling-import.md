# 主线灌装旧单导入可恢复性补口交接

任务于 2026-09-08 派发，2026-09-09 完成。本交付只修改本地导入脚本、纯恢复工具和专用测试；**未部署、未调用真实云端导入、未修改云数据、未安装 PDA，也未改变灌装/PDA/账务/公共规则/schema/统一验证入口**。生产仍由主任务确认在 `101068bb9580b6c0faa1b9b83886789d8b5c2de3`，不能用本分支整包覆盖生产。

## 基线、分支与提交

- 独立工作区开始时干净，位于游离提交 `90336801cf67d7c31b9df7104de3c1545452285f`。已验证它是指定基线的祖先，没有覆盖现场改动。
- 任务分支：`codex/filling-import-idempotency-20260908`；安全前移后的工作基线：`bec921d3efe65e802af0835120cf04eda6c15b15`。
- 工程提交：`fdc0bbee34199afaf039830de4ab6f282c7636f9`（`fix(filling): make legacy import resumable`）。本交接文件位于其后的独立文档提交。
- 上游主任务：`01a071ca-9c43-7df3-97b4-96f1e0870ab0`。本任务的正式任务 ID 未从当前任务接口取得，未把创建回执误写成正式 ID。

## 目标行为与不变量

真实调用链已核对为 `scripts/importFillingsFromJson.cjs` → `crm-filling.createV1`，状态确认走 `crm-filling.getOperationV1`；服务端权威实现为 `uniCloud-alipay/cloudfunctions/crm-filling/index.js` 与 `fillingOperations.js`。当前协议 `filling-consistency-2026-09-08-v2` 的 `code:0` 只表示操作已受理，不等于源单已保存或后续核查完成。

本补口保持以下边界：

- 原有 JSON 数组、对象流、NDJSON 解析，日期/瓶号/作业类型规范化，输入内签名去重，以及目标端按日期、瓶号、重量、操作人和备注的精确跳过逻辑不变。
- 不增加隐式 `updateV1`。已有记录仍跳过；不同内容、同日期同瓶等冲突仍显式报告，不借导入覆盖旧单。
- `source_type: legacy_import` 与历史导入默认放行软流转预警的行为保留；预警确认标志按后端摘要契约不算业务内容。
- 预览只进行认证/列表读取和本地报告输出，不调用 `createV1`、`retryOperationV1`、`updateV1` 或 `removeV1`，也不新建恢复日志。

## 已做

### 稳定操作编号与冻结内容

- 每条源记录在调用前生成符合后端 12—128 位约束的稳定 `operation_id`。优先以旧单 `_id/id` 建立身份；缺 ID 时使用输入路径摘要和源文件提供的 `line_no`，若未提供则使用实际输入位置。相同源记录的规范化业务内容变化不会生成新操作，而会在本地报告为 409 冲突。
- 新纯工具 `scripts/lib/fillingImportRecovery.cjs` 直接复用生产候选 `fillingOperations.js` 导出的协议版本和输入摘要函数，避免另造不同的内容判定。冻结内容排除 `operation_id`、preview 和软预警确认标志，与后端契约一致。
- 发送前同步追加 `<report>.recovery.ndjson`，保存源记录身份、操作号、冻结的规范化业务 payload、SHA-256 摘要和状态；最终压缩为每个已发送源记录一条。报告本身原子替换。中断发生在调用前、调用中或回包后时，均已先留下原操作关联。
- 重跑先读取报告和恢复日志。同内容沿用冻结 payload 和原操作号；输入路径、space-id、源记录身份或业务内容变化时停止，不静默换号。恢复日志缺失冻结内容、摘要校验失败或同一源记录存在矛盾映射时也停止。
- 报告/恢复日志只写白名单业务字段与状态，不写 CRM token、密码、空间密钥、Authorization、request_id 或原始响应；错误文字另做凭据键值脱敏。

### 已受理、已保存、后续完成分离

- `--execute` 在任何 `createV1` 前要求 `capabilitiesV1` 明确返回：规则版本为 `filling-consistency-2026-09-08-v2`、`durable_operations:true`、`source_status_query:true`。旧后台或缺能力时整批停止，不回退到不安全创建。
- `createV1` 返回 `code:0` 后，以及调用抛错/返回丢失后，都用原 `operation_id` 调 `getOperationV1`。只有状态返回同一操作号、同一协议、单条 accepted/source 结构完整，且 `source_saved_total >= 1`、源单 `_id` 存在、`saved:true`、`version_matches:true` 时，才计入 `saved_total` 和兼容字段 `success_total`。
- `completed_total` 只统计上述保存证据成立且 `complete:true` 的操作。另列 `pending_save_total`、`saved_processing_total`、`processing_total`、`operation_failed_total`、`confirmation_required_total`、`conflict_total` 和 `rejected_total`。已保存但后续失败会同时保留“源单已保存”和“操作失败”两项事实，不互相覆盖。
- 状态声称完成却没有匹配源单、源单版本/操作关联不符、返回结构或协议不完整时不计保存成功。确认未知时保留原编号供后续重跑；不会生成新业务号。
- 旧格式报告没有 `operation_records` 时仍可读取；它不会被当成新协议下的保存证据。新版本执行后必须沿用同一 input/report 继续恢复。

## 验证

以下均在本独立工作区实际执行；传输替身只替换云调用，测试调用的是 CLI 使用的同一个 `run` 导入入口，不是镜像导入实现。

- `node --test scripts/importFillingsFromJson.test.cjs`：**6/6 通过**。覆盖：源单已提交但创建返回丢失且保存游标仍为 0；按源单查询恢复；同报告重跑不再创建；输入变化本地冲突；无旧单 ID 且 `code:0`/无已保存源单时只报受理待保存；已保存后续失败与完整完成；预览零业务写入；精确已有记录不隐式更新；旧协议在写入前阻断。报告和恢复日志中的 token/模拟传输密钥泄漏检查通过。
- `node --test scripts/importFillingsFromJson.test.cjs scripts/fillingConsistency.test.cjs scripts/crmFillingMaintenance.test.cjs scripts/bottleAnomalyArchiveCutoff.test.cjs scripts/bottleAnomalyMissingFillPermission.test.cjs scripts/frontendTrust.test.cjs`：**53/53 通过**，把实际导入入口的受控传输测试与既有真实灌装 handler 契约反例同时运行。
- `npm test`：统一检查 **118/118 通过**；3 个检查器、18 个语法入口、19 组既有测试通过。专用导入测试按任务边界没有加入全局验证入口，所以另行运行并记录。
- `node --check` 对导入脚本、纯工具、专用测试均通过；`git diff --check` 通过。
- 对 `docs/2026.json` 只做离线解析：对象流 3,827 条全部规范化、0 无效、0 输入重复、3,827 个唯一操作号。对 `docs/filling.hhh.true_missing_51.json` 只做离线解析：51/51 条、原源行号 3898—3948、51 个唯一操作号。此步没有建立客户端、没有登录或云调用，更没有执行导入。

## 未验证与真实环境条件

- 没有连接支付宝测试空间或生产空间，没有验证真实 HTTP 签名、账号权限、平台网络超时、`getOperationV1` 真实回包及大批量运行时长。模拟传输通过不能代替这些证据。
- 当前生产源码 `101068b` 未核实具备上述 v2 能力；本脚本会在能力不匹配时停止。安全执行的最小后台接口缺口是：`capabilitiesV1` 必须声明 v2、持久操作和源单状态查询；`createV1` 必须按 `operation_id` 同内容复用/异内容 409；`getOperationV1` 必须返回同操作号、规则版本、`accepted_total`、`source_saved_total` 及每条源单的 `_id/saved/version_matches`。候选基线已实现这些接口，本任务没有修改后端；目标环境未部署前不能执行本导入。
- 未验证真实隔离事务、监管入队、调度恢复、PDA、瓶状态跨模块并发或生产旧单。它们仍按 `docs/filling_consistency_v1.md` 和主线灌装交接执行。
- 历史报告中的 `success_total` 是旧脚本按 `code:0` 得出的，不能追溯解释成“源单已回读确认”。新报告中该字段才与 `saved_total` 同义；生产验收还应查看 `completed_total` 与剩余/失败项。
- 同一个报告/恢复日志由多个独立进程同时写入的操作方式未作为支持场景验收；一次导入应只启动一个进程，脚本内部并发仍受支持。

## 主任务合并与下一步

1. 先审查并 cherry-pick 工程提交 `fdc0bbee34199afaf039830de4ab6f282c7636f9`，再 cherry-pick 本交接文档提交；不要整包覆盖生产树。
2. 主任务组合发布树时保留已上线的账务修复。先在明确隔离、可恢复的支付宝测试空间部署/核实灌装 v2 后端能力，再用非生产合成旧单执行预览、单条确认丢失、处理中、已保存后失败和完成场景。
3. 隔离验收应保存报告和 `.recovery.ndjson`，重复运行同一 input/report，核对同一 `operation_id`、唯一源单、无重复流转/库存，并逐条比较 `source_record_id`。通过后才安排真实旧单导入；本任务没有给出生产执行授权或发布结论。
