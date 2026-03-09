# B2 Customer — 阶段摘要

## 目标
让 Customer 路线闭环：schema 门禁 + 云函数 API + 前端选择器 + 与销售录入联动。

## 当前状态
- 云函数：`crm-customer` 已提供 `listV1/getV1/createV1/updateV1`。
- 数据库 schema：`crm_customers` 已开启门禁（`additionalProperties=false`）并新增唯一索引 `uniq_key`。
- 唯一键策略：`uniq_key = name|phone`（phone 为空则 uniq_key=name）。
- 前端 service：`src/services/customer.js` 已封装客户搜索/读写。
- 销售录入：客户输入已改为“模糊搜索 + 候选列表”，只有选择后才写入 `customerId`。
- 销售后端：`crm-sale` 已移除“自动创建客户”，创建/更新销售必须提供 `customerId`。

## Next
- 讨论并冻结客户字段：是否需要 `contact`（联系人）与 `short_name`（简称）。
- 实现客户管理页面：list/create/edit（用于真正维护客户资料）。
- 验证：新建客户 → 销售录入可搜到并选择 → 选择后自动带出默认单价/单位。
