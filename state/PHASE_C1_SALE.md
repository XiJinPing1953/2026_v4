# C1 Sale — 阶段摘要

## 目标
完成销售：列表 + 新增 + 编辑闭环。

## 当前状态
- 云函数：`crm-sale` 已提供 `createV2/updateV2/listV2/getV2`。
- DB 模型：`crm_sale_records` 仅存输入事实；派生字段在 `listV2` 返回时计算（不落库）。
- schema 门禁：`crm_sale_records` 已设置 `additionalProperties=false` + `required`。
- 新增/编辑：`src/pages/sale/edit.vue` 支持无 `_id` 创建、有 `_id` 更新。
- 列表：`src/pages/sale/list.vue` 支持进入编辑（携带 `_id`）。
- 存瓶展示：`getCustomerDepositV1` 动态计算并返回（不持久化展示串）。

## Next
- 如 keyword 搜索仍不稳定：暂时搁置或用更稳的查询方案替代（不阻塞 B2 Customer 闭环）。
- 接入客户默认定价：选择客户后自动带出 `default_unit_price/default_price_unit`（依赖 B2 客户管理维护数据）。
- 补一份最小烟囱验证清单（部署后在 `STATE.md` 记录：云函数、schema、关键页面流程）。
