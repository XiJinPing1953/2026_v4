# PHASE_B3_BOTTLE_PROFILE

## 目标
- 在不回归现有流程的前提下，完成钢瓶档案扩展（钢瓶本体 + 压力表 + 安全阀共享检测字段）上线验收。
- 在真实数据巡检通过后，再单独落地数据库唯一索引。

## 当前状态（2026-03-14）
- 代码分支：`codex/bottle-profile-expansion-20260313`
- PR：`https://github.com/XiJinPing1953/2026_v4/pull/2`
- 已完成：前端录入、服务层、云函数、schema 扩展，以及构建/语法检查。
- 当前阻塞：尚未拿到测试数据，暂不执行“逐项勾选”手工回归与唯一索引启用。

## 拿到测试数据前（可先保持）
- [ ] 保持 PR #2 打开，不合并。
- [ ] 不在该分支继续堆叠“唯一索引落地”改动，避免混入风险。

## 拿到测试数据后的续跑步骤
1. 同步到扩展分支：
```bash
cd /Users/wangbo/Downloads/2026_v4
git checkout codex/bottle-profile-expansion-20260313
git pull
```

2. 先跑不依赖数据的校验：
```bash
node --check src/services/models/bottle.js
node --check src/services/bottle.js
node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js
npm run build:h5
npm run build:mp-alipay
```

3. 执行手工回归（依赖测试数据）：
- [ ] 新建钢瓶：核心字段完整录入并保存成功。
- [ ] 周期联动：钢瓶/压力表/安全阀修改检验日期或周期后，下次检验日期自动更新。
- [ ] 手动覆盖：3 组下次检验日期都可手改并保存。
- [ ] 必填校验：缺核心字段时阻止提交且提示明确。
- [ ] 数值校验：容积、费用、压力区间非法值被拒绝。
- [ ] 区间校验：`pressure_gauge_range_min <= pressure_gauge_range_max`。
- [ ] 唯一校验：重复 `qr_code` 或 `pressure_gauge_no` 保存失败，文案准确。
- [ ] 列表回归：分页/筛选无回归，新增到期信息展示正常。

4. 执行云函数唯一字段巡检（依赖线上数据）：
- 云函数：`crm-bottle`
- 事件体（云函数测试器）：
```json
{
  "action": "auditUniqueFieldsV1",
  "data": { "sampleLimit": 50 },
  "token": "<管理员登录token>"
}
```
- 判定规则：
  - `data.empty.qr_code == 0`
  - `data.empty.pressure_gauge_no == 0`
  - `data.duplicates.qr_code.length == 0`
  - `data.duplicates.pressure_gauge_no.length == 0`

5. 巡检通过后再做第二阶段分支：
```bash
git checkout main
git pull
git checkout -b codex/bottle-unique-index-migration-20260314
```
- 在新分支完成数据清洗与唯一索引落地，单独提 PR。

## 备注
- `bottle_no`、`qr_code`、`pressure_gauge_no` 目前已在云函数层做唯一校验；数据库唯一索引尚未启用（按策略延期）。
- 本文件作为“续跑钩子”，测试数据到位后按本清单逐项勾选即可继续推进。
