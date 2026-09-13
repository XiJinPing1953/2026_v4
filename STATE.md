# 当前状态

更新时间：2026-09-13。工程契约见[RULES](docs/RULES.md)，按需选择[领域](state/INDEX.md)。本页只维护当前任务、生产版本和继续条件。

## 当前任务

- 协作与上下文审计建议已落实：按需读取、停止边界、验收复用、状态单一归属；GPT-6任务统一Astra轻度（low），Sol保持Ultra。仅文档/技能调整，无业务数据或发布动作。
- K004已完成受保护修正并核准（会计截止09-06，后续业务另计）。完整原值、两次云端回滚、正式提交及幂等、页面和两导出验收通过；清单仅修改K004八格。见[K004核查](state/handoffs/2026-09-13-k004-accounting-audit.md)。K001/K002/K003原核准保持；接续逐户核查，不自动启动下一客户。
- 押金独立资金已上线验收。历史押金不自动迁移，取得原始依据与余额确认后再登记；不重做K002已退押金。[押金交接](state/handoffs/2026-09-12-customer-deposit.md)保存行为、验收及证据限制。

## 当前主线与生产

| 产品 | 已验证运行源码/版本 | 证据 |
|---|---|---|
| 客户结算、K004专用两完整函数 | `56a11b497f59f4f16dc18d23c43b422a8c2ddec2` | [09-13验收](state/handoffs/2026-09-13-k004-accounting-audit.md) |
| 押金、首页 | `ada8f89607e928c74969431bf7711a5891f8b6be` | [09-12发布](state/handoffs/2026-09-12-customer-deposit.md) |
| H5 | `1789287157140-456200a3`，源码`56a11b497f59` | [09-13验收](state/handoffs/2026-09-13-k004-accounting-audit.md) |
| 销售、催收 | `5021753` | [09-09发布](state/handoffs/2026-09-09-accounting-release-accepted.md) |
| K001/K002专用转换 | 保持各自已验收版本 | [K001](state/handoffs/2026-09-11-baotai-receipt-conversion.md)、[K002](state/handoffs/2026-09-12-k002-pending.md) |

09-13运行补丁及验收记录已正常快进合入并推送`main`（验收提交`64cb8bc`），发布分支保留；源码版本不由最新文档提交推断。09-12两张新押金表及索引已上传；云源码和索引元数据无SDK回读能力，完整包/哈希、平台回执和业务核验见对应交接。

## 未完成与继续条件

- `codex/system-trust-foundation`的灌装/PDA/导入候选`5312c6f`尚未合入main。须在对应工作区完成隔离支付宝云事务/调度、监管隔离及PDA现场验收；不重复派发已完成的工程实现。[候选验收](state/handoffs/2026-09-09-mainline-entry-acceptance.md)。
- 部分历史内嵌收款仍缺到账依据，按客户逐项核实；通用规则通过不等于全部客户账务已核清。[账务领域](state/domains/accounting.md)。
- 全仓schema存在入户巡检双份差异，单批范围检查不代表全仓一致；不夹带修正。销售持久写入等后续范围见[里程碑](docs/SYSTEM_MAINLINE.md)。
- 聚力特、浩诺已确认结果与历史截止范围见[汇总交接](state/handoffs/2026-09-08-customer-period-summary.md)、[浩诺重建](state/handoffs/2026-09-08-haonuo-rebuild.md)。不强迫后续当前余额等于历史截止余额。

## 证据与保护

- 私有原始资料、回退包与验收证据位于本机`outputs/trust-audit/`对应日期/任务目录，具体位置见交接；不进入Git。接口投影不冒充原始数据库快照。
- 原有本地`alarm.cjs`、储罐遥测及其他无关未跟踪文件保留，不随本次调整提交。
- 旧STATE原文及校验见[历史索引](state/history/INDEX.md)；旧工作区保护见[基线](state/baselines/2026-09-05.json)。四项改进指标见[可靠性记录](docs/SYSTEM_RELIABILITY.md)，没有测量不能写成零。
