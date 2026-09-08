# 第二客户表数账务重建交接

2026-09-08。用户已批准按表数、预付余额及会计收款依据重建；替代此前只读核查“尚未修账、期初不明”的执行状态。原始图片、完整账务数据和金额报告仅保存于本地 `outputs/trust-audit/2026-09-08/haonuo/rebuild/`。

## 已做

- 从已发布 `5f3846f` 建立独立分支 `codex/haonuo-accounting-rebuild`，最终发布源码 `101068bb9580b6c0faa1b9b83886789d8b5c2de3`；主工作区保留补丁 `70a460f`。未部署系统可信度全量候选。
- 新增通用期初预付款来源识别，客户对账、两种导出及现有继续分配入口识别 `opening_prepay`；不计新收款、退款、营收或冲抵池。通用收款入口不能伪造该来源，期初单不能通过普通整单调整或删除改写来源。
- 新增仅超级管理员且限定该客户的专用核对入口。固定批次、完整备份、确定编号、源值冲突检查、事务回滚演练、正式提交、回读与重复执行查询已完成。
- 完整备份比旧只读报告多出一张已有的最后抄表日流量单和一笔早已作废的收款。前者与确认依据完全一致，保留编号并重接区间，另建10张，共11张有效流量单；后者未改动。原9张流量单及2笔有效收款、10条旧分配作废留痕。没有覆盖重建区间外的新业务。
- 24张销售非账务字段逐项不变，全部明确流量结算并同步结清；销售内嵌已收退出有效计算，原值保留在完整备份及每单审计中。
- 4笔实际收款与1笔期初转入形成13条有效分配。剩余可用款仍位于真实收款来源的待分配余额，客户保持启用。没有修改会计软件凭证、数据库结构或硬件。

## 验证与发布

- 独立发布分支：`node --test scripts/haonuoReconciliation.test.cjs scripts/periodSummary.test.cjs scripts/accountingReconciliationIntegration.test.cjs scripts/reconciledSaleStatus.test.cjs`，19项通过。
- 主工作区：`node --test scripts/haonuoReconciliation.test.cjs scripts/periodSummary.test.cjs scripts/periodSummaryCustomerScope.test.cjs scripts/financeTrust.test.cjs`，30项通过。覆盖源版本冲突、失败回滚、重复提交、期初及真实余款继续抵扣、客户隔离。
- 支付宝云 `env-00jxuffegf2n`：第17项写入中断演练与完整75项写入回滚后，原值哈希相同；正式提交75项后逐项回读匹配。再次执行同一批次没有新增。
- 本年、跨年、历史月份的对账及两种导出共9个组合通过；两种导出分别验证4个指定日期余额。页面本年→跨年→历史月份→本年切换通过，显示独立期初来源、实际收款和结清状态。
- 对照客户的原始数据哈希及三种汇总接口不变。其他客户的规则隔离有本地覆盖，未逐户重新审计其历史数据。
- H5构建 `1788853708683-05ed825f`，入口 `/assets/index-CGtQhk9j.js`，产物SHA-256 `ea74e49966c86f325d1d0e9ab5ec5d2766415db47eccd62285ebdf7911ed8593`；运行版本及入口资源与本地产物匹配。
- 必要函数：`crm-customer-settlement`、`crm-haonuo-reconciliation`。先发布兼容后端/H5，再正式修账。云函数无独立源码哈希回读，源码对应证据为提交、上传文件清单和真实行为验收。

## 证据与边界

- 批次：`0f3c27c0f031d776d9abeeac`；计划SHA-256：`cbd089429bf8b9b1a1c62915c99c59c513aa609bf1f5b4e9a9d7a5666cf1acb5`。
- 前备份SHA-256：`331f2b03446675a64f8103334ebddaade36ac87f46c08a13e44ef69af9e0aab5`；后备份：`2283e5a4fd6e92e5fb2fb83c330aac7dc6e859409ccc1c6ee1e034812bf46344`。
- 目录内 `before.json`、`prepared.json`、`after-execute-*.json` 保存原始与逐项结果；`source-fields-verification.json` 验证销售运营原值；`release-evidence.json`、`post-qa-*-verification.json` 及 `ui-*.txt` 保存发布/验收证据；`重建结果.md` 为详细金额报告。
- 首个结算区间跨年，只按结算日期统计营收，不宣称全部气量发生于本年。一个收款渠道按用户方案保留待核；金额与会计日期已确认。现有自动预付款抵扣仍关闭，后续使用“继续分配”，没有擅改录单工作方式。
- 此修正批次已经完成，不能再次生成另一批同类账务。后续新业务从当前有效最后表数继续，历史修改须另建有源版本和依据的任务。
