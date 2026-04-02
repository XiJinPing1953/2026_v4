# 全量导入前最终验收清单 v1（钢瓶 + 灌装）

适用空间：`env-00jxuffegf2n`  
基线口令：`继续按“2026-03-15 成功基线”执行导入：钢瓶只走 update-only（禁 initdatabase），灌装先重复审计再清洗，验收为 matched/updated 全命中且 duplicate_exact_datetime_pair_count=0。`

## 0. 发布与冻结

- [ ] 当前代码已发布到目标空间（至少 `crm-bottle`、`crm-filling`、`crm-bottle-batch-ops`）。
- [ ] 确认导入窗口（建议低峰），冻结手工新增/编辑。
- [ ] 记录开始时间与执行人。

## 1. 备份与回滚准备

- [ ] 钢瓶导入文件已固化（原始 + 清洗后版本均保留）。
- [ ] 灌装导入文件已固化（原始 + 清洗后版本均保留）。
- [ ] 已准备回滚口径：
  - 钢瓶：按本批次标识可定位并回退。
  - 灌装：重复清洗前先做审计快照；任何删除动作必须保留 `remove_ids` 清单或备份集合。
- [ ] 演练过至少 1 条样本回滚。

## 2. 钢瓶导入门禁（必须全部通过）

- [ ] 严格使用 `crm-bottle-batch-ops` 的 `update-only`。
- [ ] 严禁调用 `initdatabase`。
- [ ] 预览通过：
  - `payload_total` 与计划导入条数一致。
  - `missing=0`（若非 0，先补齐匹配键再执行）。
- [ ] 执行通过（核心验收）：
  - `payload=全量`
  - `matched=全量`
  - `updated=全量`
  - `missing=0`
- [ ] 导入后抽检：瓶号唯一、压力表号唯一、二维码唯一。

## 3. 灌装导入门禁（必须全部通过）

- [ ] 先做重复审计（只读）：
  - 输出 `duplicate_exact_datetime_pair_count`
  - 输出 `duplicate_group_count`
  - 输出 `duplicate_extra_row_count`
- [ ] 若发现重复：
  - 先选择策略（保留最早或最新）
  - 生成 `keep_id/remove_ids`
  - 先备份后删除
- [ ] 重复清洗完成后复核：
  - `duplicate_exact_datetime_pair_count=0`
- [ ] 抽检类型分流：
  - `normal_fill` / `truck_out_agent_sale`：应有 movement
  - `truck_out_no_sale`：不应进入 movement 链路

## 4. 导入后业务验收

- [ ] 钢瓶列表筛选、导出、自然升序正常。
- [ ] 灌装列表查询联想、单条/批量、删除后即时刷新正常。
- [ ] 批量改日期预览与执行口径一致。
- [ ] 到期提醒（瓶检/表检/阀检）统计与筛选联动正常。

## 5. 技术验收（构建与语法）

- [ ] `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
- [ ] `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
- [ ] `npm run build:h5`
- [ ] `npm run build:mp-alipay`

## 6. 收口标准（通过才算全量完成）

- [ ] 钢瓶：`matched/updated` 全命中，`missing=0`。
- [ ] 灌装：`duplicate_exact_datetime_pair_count=0`。
- [ ] 抽检样本（建议 20 条）100% 与源数据一致。
- [ ] 已输出本次导入报告（时间、批次、执行人、异常与处理）。

## 7. 失败即停规则

出现以下任一情况，立即停止继续导入：

- 出现 `initdatabase` 或非 update-only 路径。
- 钢瓶执行结果 `missing>0` 或命中数不闭合。
- 灌装重复清洗后仍 `duplicate_exact_datetime_pair_count>0`。
- 导入后出现大量口径异常（movement 明显错配、列表/导出不一致）。

