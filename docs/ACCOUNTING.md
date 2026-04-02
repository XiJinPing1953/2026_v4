# 会计凭证自动生成规则（销售）

## 目标
- 业务对账与会计台账长期并存
- 仅销售生成会计凭证，灌装仅运营记录

## 口径与原则
- 收入确认口径沿用旧系统
- kg 模式回瓶净重冲减收入
- bottle / m3 / truck 模式不冲减
- 凭证默认生成草稿，不自动过账

## 触发与幂等
- 触发：销售单创建/更新
- source：`sale:<saleId>`
- 已过账凭证不覆盖

## 收款方式与科目
- on_account: 只记应收
- cash: 库存现金
- bank: 银行存款
- wechat: 银行存款-微信
- alipay: 银行存款-支付宝
- check: 银行存款-支票

## 科目映射（默认）
- 应收账款：1122
- 主营业务收入：6001
- 库存现金：1001
- 银行存款：1002
- 银行存款-微信：1002-WECHAT
- 银行存款-支付宝：1002-ALIPAY
- 银行存款-支票：1002-CHECK

## 金额计算
### kg
- out_amount = 出瓶净重 * 单价
- back_amount = 回瓶净重 * 单价
- should_receive = out_amount - back_amount

### bottle
- out_amount = 出瓶数量 * 单价
- back_amount = 0
- should_receive = out_amount

### m3
- out_amount = 抄表用气量 * 单价
- back_amount = 0
- should_receive = out_amount

### truck
- out_amount = 整车净重 * 单价
- back_amount = 0
- should_receive = out_amount

## 凭证分录模板
借：收款账户（若有收款）
借：应收账款（未收款部分或 on_account）
贷：主营业务收入（应收总额）

## 备注
- 灌装不生成会计凭证
- 如需成本核算，另行定义成本口径与科目
