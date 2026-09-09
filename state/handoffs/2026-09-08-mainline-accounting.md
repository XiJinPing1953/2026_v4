# 2026-09-08 主线账务上线收口交接

## 交付结论与基线

主任务：`01a071ca-9c43-7df3-97b4-96f1e0870ab0`。本任务交付可审查账务补丁与最小发布组合验证，未执行云端发布、业务写入或再次修账。

- 独立工作区：`/Users/wangbo/.codex/worktrees/6f7e/2026_v4`；开始时干净、分离 HEAD 为旧 `9033680`。确认祖先关系后在本工作区创建 `codex/mainline-accounting-20260908`，基线为 `d9eb4fb9dc8edff82789a86a89631f4f86f70b20`，没有重置任何既存改动。
- 已发布源码参照：`101068bb9580b6c0faa1b9b83886789d8b5c2de3`，由主任务提供并与仓库内容核对。本轮没有重新核实线上运行文件。
- **补丁提交：`3fb53caffae8eb40420122d78c18cdeb4ddb5e76`**，18 个文件；本交接另行提交。主任务可以先合并此补丁，再处理下述公共副本交界。
- 原主工作区只读，用其依赖目录的文件克隆到新的临时验证目录；未切换或写入原主工作区，未使用 `/private/tmp/crm-julite-release`。
- 未修改根 STATE、AGENTS、RULES、state/INDEX、schema、发布脚本、灌装/流转实现或网关；没有客户原始明细、凭据、截图或日志入库。

## 先行规则归属与生产差异审查

| 接口/规则 | 权威归属与已有实现 | 本批处理 |
| --- | --- | --- |
| 销售单据金额 | `common/saleAccounting.js`；由部署副本供 `crm-sale`、结算、首页、催收使用 | 继承主线已接好的公式和分类保护，不重写；共享整数金额累加供结算与首页复用 |
| 历史 m³ 归属 | 明确 `sale` 才按单计费，`customer_flow` 销售应收为零，缺模式详情返回 null、计算/相关写入返回 409 | 保留原规则、源单分类审计及超管证据入口，不执行分类或迁移 |
| 对账/两种单客户导出 | `crm-customer-settlement` 的快照、`periodSummary.js`、`receiptSource.js` | 保留 `customer-period-summary/2026-09-08.2`，修复外层完整性误报与三位快照尾差 |
| 实际收款与期初 | 收款单确立金额和到账日期；分配解释用途；期初来源不建立新现金事件 | 把现有来源判定复用到首页；历史差额行明确不是独立到账凭证 |
| 首页销售指标 | 仓库实际云函数为 **`crm-dashboard`**，没有 `crm-home` | 继承同源销售计算；流量金额累加保留三位，收款图排除期初及冲抵，沿用退款负号并标为净收款 |
| 催收销售应收 | `crm-collection` 已调用同源销售金额、读取全部范围销售 | 本批无需再改 index；仅更新同源部署副本，不扩展催收债权范围 |
| 完整读取 | `common/financialRead.js`，游标分页、前后计数和时间戳检测 | 拒绝空/布尔/负数/小数计数；外层完整性继承期间待核状态 |

`101068b` 与 `d9eb4fb` 中以下文件字节一致：结算 `periodSummary.js`、原 `receiptSource.js`、前端 `customerPeriodSummary.js`、`CustomerStatementModule.vue`、`exportWorkbook.js`。因此 `.2`、期初转入列、跨年说明、现有两种导出和页面接收契约均不需重做。本批仅扩充 receiptSource 的复用出口，不更改 period_summary 版本或字段。

生产尚未具备主线四个函数的完整金额模块/读取保护及销售待核页面。不能只把本补丁相对 d9eb4fb 的差异投到 101068b；必须使用下节完整文件组合。

金额兼容范围：销售原有单据金额仍按既有两位规则；流量单、m³ 客户结算/导出沿用三位截取，先量化再用整数累加。首页保存三位聚合结果，未更改历史销售归属或批量重算保存金额。

## 可复现缺陷与最小修复

1. **现金待核却标完整**：无独立收款日期的历史已收差额使 period_summary.cash_received=null、complete=false，但外层 financial_evidence.complete 原为 true。现在外层承接 false，read_complete 仍可为 true，分别说明取数完成和业务证据待核。
2. **未知计数误作可信零**：空表 count.total=null/空字符串/false 原被 Number 转成 0；前后任一计数都必须是非负安全整数，否则 `FINANCIAL_READ_INCOMPLETE`。保留合法数字字符串兼容。
3. **首页把期初及冲抵算现金**：原查询只取 amount，无法识别来源。现在同时读取 source_type、entry_kind，使用结算 receiptSource 生成的本地副本；保留旧 offset 别名与大小写兼容，真实预收仍计现金，退款仍带负号。
4. **三位金额回到两位/假欠款**：首页 `12.345 + 0.001` 原变为 12.35；流量/历史欠款已收 12.344 加收款抹零 0.001 原形成 0.001 假欠款。结算与首页改用同源整数累加；上述快照现在为 paid、outstanding=0。没有保存或更改线上单据。
5. **历史账簿差额看似新凭证**：原 fallback 行摘要直接写“收款/退款”，使用源单业务日期。现在摘要明确“历史单据差额、到账日期待核、非独立收/退款凭证”；原 source_type/source_id、借贷及余额兼容保留，period_summary 继续待核，不把反推金额算作已证明的现金。
6. **首页待核提示破坏网格**：本地视觉检查发现既有候选新增提示占用了侧栏列。提示现在跨整行；收款图隐藏，销售金额显示待核。三位显示及长金额已检查，长金额不再与图标重叠。

代码文件：common 两个模块、四个消费函数的金额/读取副本、结算 index/receiptSource、dashboard index/receiptSourceLocal、首页组件，以及财务专用 reconciliation 的读取副本。新增反例为 `scripts/mainlineAccounting.test.cjs`，生成关系新增于 `config/domain-contracts.json`。

## 从 101068b 上线的最小组合

在**新的独立发布分支/目录**以 101068b 为底，取补丁提交中的以下 **19 个源码文件**。这是本轮实际组装并构建的组合，不包含灌装改造。

| 位置 | 取完整文件 |
| --- | --- |
| `uniCloud-alipay/cloudfunctions/common/` | `saleAccounting.js`、`financialRead.js`（仓库权威源码，独立函数不依赖其线上相对路径） |
| `uniCloud-alipay/cloudfunctions/crm-sale/` | `index.js`、`saleAccountingLocal.js`、`financialReadLocal.js` |
| `uniCloud-alipay/cloudfunctions/crm-customer-settlement/` | `index.js`、`saleAccountingLocal.js`、`financialReadLocal.js`、`receiptSource.js` |
| `uniCloud-alipay/cloudfunctions/crm-dashboard/` | `index.js`、`saleAccountingLocal.js`、`financialReadLocal.js`、`receiptSourceLocal.js` |
| `uniCloud-alipay/cloudfunctions/crm-collection/` | `index.js`、`saleAccountingLocal.js`、`financialReadLocal.js` |
| `src/components/domain/sale/` | `SaleDetailView.vue`、`SaleListView.vue`（主线已有待核与导出完整性保护） |
| `src/components/domain/dashboard/` | `DashboardHome.vue` |

部署为上述 **4 个完整云函数包 + 配套 H5**；函数包中保留 101068b 的原有 ACL、可见性、saleListSearch、tankTelemetry 等本地依赖。结算包必须保留原版 `periodSummary.js`，不能漏传。API/mappers/客户对账组件与导出组件直接保留 101068b，已包含 `.2` 契约；本批无新的 schema 或三方运行时依赖。

源代码维护同时合入 `config/domain-contracts.json` 的 receiptSource 复制关系和反例测试；这些是仓库维护资产，不是额外云函数。`crm-ledger-reconciliation/financialReadLocal.js` 已随本补丁更新以保持财务源码一致，**不要求重新部署或运行专用修账函数**，更不要求重建两家客户账务。

建议主任务发布顺序：建立已提交的最小发布分支并形成原有发布证据 → 四个函数配套切换 → 核查规则版本、分类/完整性返回和两家已修客户只读结果 → 发布配套 H5 → 在同一日期范围验收销售、结算、两种导出、首页及催收销售范围。未经这些线上步骤不能标记为上线验收完成。

新函数规则版本：`sale-accounting/2026-09-08.1`、`financial-read/2026-09-08.1`；period_summary 保持 `customer-period-summary/2026-09-08.2`。

## 公共文件交界与合并门槛

- **主任务必须同步的两个非财务副本**：`uniCloud-alipay/cloudfunctions/crm-filling/financialReadLocal.js` 与 `crm-bottle-anomaly/financialReadLocal.js`。因本任务禁止改灌装/流转，二者有意未修改；合并后由对应负责人从 common 源码生成。不能手工另改算法。
- 本分支全仓 `node scripts/syncDomainContracts.cjs` 明确报告上述两项不同，因此**没有宣称全仓契约检查或 npm test 通过**。财务相关副本已逐字节匹配；最小生产组合的相对依赖检查已通过。主任务同步两个副本后再运行全仓检查；这不等同本批要部署灌装函数。
- `config/domain-contracts.json` 是交界公共文件，只新增一项 receiptSource 生成关系，既有规则与 schema 注册不变。首页组件也需与主任务可能的工作台改动按财务区域合并。
- `common/saleAccounting.js` 新增 sumMoneyByScale 给结算与首页复用；若其他工作并行修改 common，应保留既有分类、价格与抹零语义。

## 实际验证

时间：2026-09-08，Asia/Kuching。全部数据为既有隔离夹具或新增合成反例，未连接业务数据库。

| 层级 | 结果 | 范围与证据 |
| --- | --- | --- |
| 代码基线对照 | 完成 | 101068b/d9eb4fb 相关文件差异、已有 `.2`/期初/导出文件逐一比对 |
| 本工作区测试 | **47/47 通过** | financeTrust、periodSummary、periodSummaryCustomerScope、haonuoReconciliation、accountingLedgerPrecision、accountingReconciliationIntegration、reconciledSaleStatus、frontendTrust、mainlineAccounting 共9个测试文件 |
| 生产底座最小组合 | **43/43 通过** | 101068b 加上述19文件，同一组账务测试；未带与本组合无关的 filling 前端测试 |
| 语法、差异、资料 | 通过 | 16个变更/新增 JS/CJS 语法入口，git diff --check，checkProjectContext；财务副本及独立包相对依赖检查 |
| H5 构建 | **通过** | 最终19文件均与补丁提交一致；原有 Browserslist/工具版本提示，未升级依赖；构建成功不代表发布 |
| 本地视觉 | **通过（合成数据）** | 实际首页组件：三位金额、长金额、净收款说明、409待核和隐藏图表；浏览器阻断外部请求；已关闭会话并还原临时服务替身 |
| 云端部署 | **未执行** | 运行版本本轮未核实，沿用主任务提供的生产101068b事实 |
| 线上业务验收 | **未执行** | 由主任务按下节进行；本地模拟不证明支付宝运行性能/真实并发 |

可复现测试命令：

```sh
node --test scripts/mainlineAccounting.test.cjs scripts/financeTrust.test.cjs scripts/periodSummary.test.cjs scripts/periodSummaryCustomerScope.test.cjs scripts/haonuoReconciliation.test.cjs scripts/accountingLedgerPrecision.test.cjs scripts/accountingReconciliationIntegration.test.cjs scripts/reconciledSaleStatus.test.cjs scripts/frontendTrust.test.cjs
```

覆盖包括：缺模式 m³ 不归零或按价计算、customer_flow 不重复应收、7客户隔离、已重建客户三种期间/两种导出、期初不算现金但可继续分配、实际余款继续分配不新建现金、三位尾差、源单分类与修账证据保持、历史反推余额不充当凭证、5,189条完整读取、计数缺失/超限/变化拒绝可信总数。

本地证据位置（均未提交）：

- `/private/tmp/crm-mainline-accounting-final-tests.log`、`/private/tmp/crm-accounting-production-overlay-tests.log`。
- `/private/tmp/crm-accounting-production-overlay-build.log`；验证目录 `/private/tmp/crm-accounting-release-check-sf3gKC`，仅为组装/构建验证，未形成发布清单或部署回执。
- `/private/tmp/crm-accounting-overlay-files.json`（19文件清单，最终逐字节对照一致）。
- `/private/tmp/crm-accounting-dashboard-visual.png`、`crm-accounting-dashboard-large.png`、`crm-accounting-dashboard-incomplete.png`；浏览器事件 `/private/tmp/crm-accounting-playwright-evidence`。均为本地合成界面，不作为线上截图。

## 其他客户的影响条件、后续范围与回退

**影响条件**：规则按请求客户/范围生效，无指定客户白名单或固定金额。明确模式客户继续按原归属结算；缺失/非法 m³ 模式的其他客户会出现待核并阻止相关账务计算/写入。首页按最近范围、当月及上月查询，催收按任务范围；结算为检测无日期历史收款还会读取该客户全历史。不能仅以已修两家客户无待核推断所有范围都无待核。只做面向发布范围的完整性/分类探测，不扩展人工逐户对账。

本批没有自动刷新所有客户的存储汇总或催收任务。线上验证应区分“即时读取结果”和“历史缓存/任务重算后结果”；若需要刷新，由主任务预览明确范围后集中执行，不以批量重算代替依据核对。

**后续边界**：催收仍只处理销售债权，没有覆盖流量结算、历史欠款或其他费用；首页销售营收只合并销售及有效流量，不等于结算 period_summary 的所有业务费用营收。首页收款图是收款单的净现金序列，不负责全客户历史内嵌收款证据审计。客户存储汇总旧字段、凭证历史修复、多对象写入并发、全部财务钻取不在本批。完整读取是非原子 live read，不能检测所有无时间戳写入、跨集合替换/删除或毫秒边界竞态；不得宣称同一数据库快照。

**回退最低兼容版本**：业务数据兼容底线是已发布 **101068b 的结算完整包 + 对账/导出前端**，必须保留 receiptSource 的 opening_prepay 识别与 period_summary `.2`；不能退到 5f3846f/a465aa8 等不认识期初来源的结算代码，也不能删除已重建的有效单据。四函数回退须使用各自发布前留存完整包，不混用新 index 与旧副本。回退101068b会重新暴露本批缺陷/旧分类推断，因此只能视作维持已修账数据兼容的应急底座，不能视为同等可信功能版本；需要保留本批保护时应回退前端/其他改动或做前向修复。若上线后启用通用分类或新增依赖新保护的业务，还须按新增来源单单独核查，不能机械整套降级。

**下一条可执行动作**：主任务合并 `3fb53ca`，让灌装负责人生成上述两个读取副本，完成全仓契约检查；然后从101068b新建最小发布分支取本页19文件并绑定提交/产物，先对目标支付宝空间做函数能力及已修客户的只读验收。云端发布与业务写入沿用主任务既有授权集中执行，无需要求用户再批准或转述。
