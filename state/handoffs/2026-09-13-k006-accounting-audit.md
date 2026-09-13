# K006 核账交接

状态：2026-09-13受保护修正已提交，账务及页面核准完成，正式清单K006已核准。以下替代此前“能力待开发、修正未执行”的状态。下一客户尚未启动。

## 核准范围与结果

- 核准期间2026-01-01至2026-09-13；60张销售按日期、金额及重复次数与会计逐项对应，全部结清，3笔退气负销售保持原值。
- 控制数：期初38,668元，营收159,663.50元，5笔实际收款197,980元，抹零351.50元，欠款、预付、待分配及冲抵池余额均为0。会计贷方198,331.50含抹零，不是实际收款。期初在CRM仍登记1月1日，本年含历史应收198,331.50元；本批未改变期初日期。
- 用户确认1月5日48,000元与原正式收款38,668元、旧内嵌已收4,452元和4,880元属于同笔；授权按会计日期登记收款和抹零，随后单独批准最小通用修正工具。
- 实際修正：原1月5日收款补齐9,332元依据，保留原编号；两笔现金分配及一笔139元抹零分配新增，销售总已收/总抹零/应收保持。139元由销售抹零转收款抹零并归1月5日；76,100元及39元抹零由4月23日调整至4月22日，原分配目标及金额保持。没有新增收款单，不产生新到账或退款。

## 发布与执行证据

- 源码：`da8b1966174d3ddec3effbcbd62d223800dd0898`；仅新增完整函数`crm-accounting-correction`上传支付宝生产空间`env-00jxuffegf2n`。H5、其他业务函数和数据库结构未改未上传。
- 工具规则`accounting-correction/2026-09-13.1`；完整包SHA-256 `b22de8ecbc508590f50e14dc319888a5f43463498947bd6c5a85d8fa149d1765`。上传文件清单、HBuilder回执、规则版本和实际行为共同取证，不能读回云端源码哈希。
- 批次`k006-accountant-20260913-v1`；原值双读一致，服务器预览经本地独立重编译一致。事务先故意中断4行回滚，再完成32行后全量回滚，原值均恢复；随后正式提交返回committed，32行实际变化与预览逐字段一致。
- 原值哈希：`bcb9b80b4b691d99fff7f263b7888df18d6d24d7084b9611626f156602f3d5d3`；提交后：`88afbd4d4a434d3849b8f1e6b6a27b298bfd107d2b29842a43d35412ced8097a`。
- 前后均为客户1、销售60、收款8（5笔现金及3筆冲抵）、历史款项1；分配63→66。流量、收款调整、押金、催收及相关凭证均未新增。全量回读及范围保护不是跨集合原子快照，不宣称解决全部并发问题。

## 验收与限制

- 本地5项测试通过：权限、范围、源版本冲突、中断及完整回滚、重复执行、客户隔离等；真实K006原值通过对账及两种导出共18组期间测试。发布范围与依赖检查通过。
- 生产8次业务接口验证通过：本年对账和两种导出控制数一致；1月1日/3日现金及抹零0，1月5日48,000/139，4月22日76,100/39，4月23日0/0。
- 用户重新登录后Chrome实际页面显示控制数一致、60张销售已结清、无“未付款”；页面保留供用户查看。
- **云端重复提交补验已通过（2026-09-13 22:07，UTC+8）**：刷新授权登录后，`statusV1`返回新版规则、原批次committed及原计划哈希；完整读取确认当前原值与首次提交后完全一致，再以原operation_id和plan_hash调用`executeV1`，返回`committed, idempotent:true`及原run_id。补验后完整读取的12类记录数量、原始账务哈希均与补验前及首次提交后一致，没有重复写账。证据`recheck-status.json`、`recheck-before.json`、`recheck-execute.json`、`recheck-after.json`及`recheck-acceptance.json`。
- 历史异常保留：先前一次重复请求返回旧只读入口400，随后状态查询因登录失效返回403。本次状态及原值读取均返回新版规则，旧响应未复现；其底层原因未确证，不推断为缓存问题。本次未重新上传、改代码或创建批次；旧补验阻塞已关闭。

## 清单、证据位置与用量

- 私有资料统一在`outputs/trust-audit/2026-09-13/k006/`，不入Git：`sources.json`及原会计导出，`reconciliation.json`，`user-confirmations.json`，`raw-before.json`，`request.json`，`prepare.json`，两份`rehearse-*.json`，`execute.json`，`raw-after.json`，`raw-comparison.json`，`local-business-acceptance.json`，`live-acceptance.json`，`ui-final.json`，`repeat-execute.json`及`status-after-retry.json`。
- 发布清单及回执：`cloud/release-manifest.json`、`upload-crm-accounting-correction.json`；最初只读版清单和回执另保留在`inspector-cloud/`和`inspector-upload-receipt.json`，不是最终版本。
- 正式清单位于`outputs/trust-audit/2026-09-10/customer-roster-01a071ca/客户核账清单_2026-09-10.xlsx`。仅K006行D/G/H/I/J/K/L/T八格改变，其余客户、公式、样式、筛选和其他压缩包内容保持。修改前备份及逐格报告在`roster-candidate/`；应用记录`roster-applied.json`。
- 清单前哈希`c7bb6655b794c160fd57e2be2709929a017ca90b922586850eb2009d864f10da`，后哈希`1c9cb352dc609d46cd26f7ac48680370440e9562324ed3e6e1e61cafea7a3b72`；候选经重新导入及渲染检查，再按原文件哈希保护写回。
- 七天已用：查账开始48%，查账结束49%，完成工具开发、发布、修正及收尾时54%。这是全账户整数百分比，未排除其他任务，且无同条件low/high对照，不能据此认定high更省。证据`usage-start.json`、`usage-end.json`、`usage-final.json`。

工具边界见[受保护修正契约](../../docs/ACCOUNTING_CORRECTION.md)，逐户方式见[RULES](../../docs/RULES.md#逐户核账工作方式)。后续新增业务另行核对，不重复修正已核准期间。
