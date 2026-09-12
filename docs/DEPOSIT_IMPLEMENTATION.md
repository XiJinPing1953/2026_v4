# 押金资金能力：2026-09-12实施契约

用户已批准独立押金收取、退还、期初转入及转气款。对所有独立结算客户适用，存瓶不触发资金操作；旧备注不自动迁移。金额使用整数分，日期显式登记。

## 接口

独立云函数`crm-customer-deposit`：`getDepositStatementV1`、`previewDepositEntryV1`、`createDepositEntryV1`、`voidDepositEntryV1`、`getDepositOperationV1`。统一参数customer_id；期间date_from/date_to；写入kind=receive/refund/opening/transfer，amount，biz_date，payment_method（cash/bank/wechat/alipay/check/unknown），voucher_ref，note，operation_id，expected_version。作废entry_id及reason必填，亦使用operation_id/expected_version。preview只读，create以同参数再次确认。操作号客户端保存重试，超时查询结果。已用操作号不能更换内容。

成功返回code=0；失败code=400/401/403/409，msg明确。get返回data={rule_version:'customer-deposit/2026-09-12.1',read_complete:true,customer_id,version,current_balance,opening_balance,received_total,refunded_total,transferred_total,opening_transferred_total,closing_balance,entries}；全历史账户余额current_balance，所选期间opening/closing分开。entries含完整期间流水与作废留痕。数据不完整/账户与流水不符，不返回可信零。preview返回before_balance/after_balance/current_version及可提交参数；create/void返回entry/receipt_id及version/balance，重复返回idempotent。

## 存储与保护

新集合`crm_customer_deposit_accounts`与`crm_customer_deposit_entries`，禁止客户端直接读写，仅云函数受对账页面view/update权限控制，期初转入额外限superadmin/admin/finance。账户按客户确定ID；流水按customer_id+operation_id确定ID。每次余额、流水及转款来源在同一事务写入，账户version冲突拒绝。完整流水计算防截断，拒绝历史任意时点负余额、超额退还/转出。作废保留原单与理由，不能让历史余额变负。

转气款同时生成现有`crm_customer_receipts`的`source_type='deposit_transfer'`、source_id=押金流水ID、entry_kind='prepay'、payment_method='unknown'。参与正常可用预付款与后续分配；不是第二次现金到账，不计经营实际收款、退款或收入。普通收款入口禁止伪造此来源，禁止编辑/删除该转款来源；专用作废仅在转款未分配/无关联/无抹零且原值一致时允许，否则禁止直接作废，先核对原气款分配。前端提示转入后可使用既有预付分配入口，避免虚构自动结清。

## 页面与导出

财务操作新增“押金”，内部切换收取/退还/期初转入/转气款；当前余额、期间收退转入转出及流水独立显示；源单作废使用已有金额/日期不可编辑并须理由。收退填写实际渠道，unknown明确待核，期初不冒充新收款。操作先预览后登记，普通技术选择无需用户再批。

两种原有对账导出添加独立押金汇总/流水工作表，不改变气款借贷或余额。所有入口缺新字段或不完整时未完成，不回退零。

## 交付

后端代理负责新函数、两集合schema/index及专项测试；前端代理负责组件/服务/mapper和对账模块接入；主任务负责既有收款来源保护、首页/对账/导出识别、集成测试、发布与最终验收。新集合先核对是否存在并只发布明确范围，不上传全库结构。无真实押金原始单被授权补录，本轮上线能力不自动生成K002旧押金。
