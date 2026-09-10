# 当前领域索引

先读 [当前状态](../STATE.md)，再按问题选择领域；业务新决定写入对应文件并标记替代关系。未发布候选的实现与测试在开发分支，不因文档随main保存而视为已上线。

| 领域 | 当前来源 | 何时读取 |
|---|---|---|
| 账务 | [accounting](domains/accounting.md) | 销售金额、客户对账、收退款、冲抵、期初、导出 |
| 流转 | [flow](domains/flow.md) | 灌装、钢瓶状态、异常、封存、历史改单 |
| PDA | [pda](domains/pda.md) | 扫码、称重回填、原生基座与真机验收 |
| 网关 | [gateways](domains/gateways.md) | 储罐、充装许可、秤、RFID、各自发布 |
| 导入/清理 | [data-operations](domains/data-operations.md) | 预览、范围、回退、执行后核对 |
| 展示/上传 | [presentation](domains/presentation.md) | 首页、导出、自动补全、上传状态 |

- [工程约束](../docs/RULES.md)、[会计入口](../docs/ACCOUNTING.md)、[可靠性证据与指标](../docs/SYSTEM_RELIABILITY.md)。
- [系统改造总表](../docs/SYSTEM_MAINLINE.md)保存主线、当前任务、依赖与验收标准；两家客户修账已关闭，不代替通用改造验收。
- [09-10普通导出修复](handoffs/2026-09-10-statement-export-fix.md)记录当前结算函数/H5补丁及实际下载验收；[逐户核账](handoffs/2026-09-10-customer-accounting-audit.md)独立保留未补凭证，不因程序修复核准客户。
- [09-09账务正式发布验收](handoffs/2026-09-09-accounting-release-accepted.md)保留当次结果：5021753四函数及H5已上线，原值、接口、页面和导出验收通过，已通知恢复录入。[前次回退](handoffs/2026-09-09-accounting-release-rollback.md)与[发布准备](handoffs/2026-09-09-accounting-release-preparation.md)保留历史证据。
- [09-09第二批总验收](handoffs/2026-09-09-mainline-entry-acceptance.md)记录PDA/导入交付、三处追加修复和168项统一验证；全量候选5312c6f尚未发布。[09-08首批验收](handoffs/2026-09-08-mainline-owner-acceptance.md)保留前一阶段证据。
- [交接模板](handoffs/TEMPLATE.md) 与 [系统改造交接](handoffs/2026-09-05-system-trust.md)、[前次客户账务修正交接](handoffs/2026-09-07-customer-accounting-reconciliation.md)、[第二客户重建交接](handoffs/2026-09-08-haonuo-rebuild.md)。
- [原有工作区基线](baselines/2026-09-05.json) 只含文件元数据，27 项原有改动不能视为本任务新增。
- [历史索引](history/INDEX.md) 保存完整旧 STATE 与 B2/B3/C1 阶段资料，不再作为当前工作导航。

- [09-09 main合并交接](handoffs/2026-09-09-main-accounting-integration.md)记录已验收账务回合、上下文/检查整理及未合入范围；新任务从更新后的main开始。
