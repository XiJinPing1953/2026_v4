# 系统改造里程碑

本表只维护里程碑及证据入口；当前运行版本见[STATE](../STATE.md)，模型与协作规则见[RULES](RULES.md)。客户金额、核准范围以逐户记录为准。

| 里程碑 | 状态与下一步 | 证据 |
|---|---|---|
| 通用账务规则及独立发布 | 已完成；不等于全部客户已核准 | [正式验收](../state/handoffs/2026-09-09-accounting-release-accepted.md) |
| 对账导出一致性 | 已完成 | [导出修复](../state/handoffs/2026-09-10-statement-export-fix.md) |
| 逐户核账 | K001、K002、K003已核准；按清单继续 | [核账记录](../state/handoffs/2026-09-10-customer-accounting-audit.md)、[K001转换](../state/handoffs/2026-09-11-baotai-receipt-conversion.md)、[K002收尾](../state/handoffs/2026-09-12-rounding-and-deposit.md) |
| 抹零展示与押金独立资金 | 已完成；历史押金须依据确认后登记 | [押金验收](../state/handoffs/2026-09-12-customer-deposit.md) |
| 灌装/PDA/导入闭环 | 工程候选已交付；隔离云与现场验收未完成，未合入main | [候选总验收](../state/handoffs/2026-09-09-mainline-entry-acceptance.md) |
| 上下文与协作契约 | 当前入口按需加载，历史与现行规则分离 | [RULES](RULES.md) |

后续候选：销售持久写入、历史改单恢复、跨模块瓶状态竞争、催收覆盖范围、业务模块拆分及汇总提速。仅在明确安排对应任务后实施，不因核账或其他小任务自动扩展。

[截至09-12的历史总表](../state/handoffs/2026-09-12-system-mainline-snapshot.md)仅供追溯，不用于重派已完成任务。09-10宝泰“待核提示尚未处理”已由09-11转换完成记录替代。
