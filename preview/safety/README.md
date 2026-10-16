# 安全管理本地示例预览

用于审阅统一巡检流程。假账号、检查、日期和图片均为示例；填写仅保存在当前页面专属的本地服务内存会话，刷新页面即使用新会话。页面底部持续显示示例提示。不得将示例 PDF 当作实际安全生产记录。

```bash
node scripts/syncDomainContracts.cjs --write
STATEMENT_PREVIEW=1 SAFETY_PREVIEW=1 npm run dev:h5 -- --host 127.0.0.1 --port 5198
```

访问 `http://127.0.0.1:5198/#/pages/station-safety-inspection/form?workflow_id=preview-inspection`，从已保存的36项示例巡检继续七类检查。也可以打开 `/pages/safety-management/daily` 查看当日汇总。日期使用北京时间当天。

示例默认保留岗位账号及启用日期为空，允许巡检流程保存和日表预览，禁止以管理员身份代替业务岗位核对日表。签认保持待签认。示例图片带有明确标记，不模拟真实现场拍照、附件上传或Excel云端上传。

`preview/statement/plugin.mjs` 仅在开发服务启用安全预览中间件。`mock.mjs` 将请求发往同源 `/__safety-preview/api`；`server.mjs` 使用真实安全管理 `createService`、已有内存数据库测试适配器和独立示例数据处理请求，未初始化uniCloud，不持有云端凭据。CSP阻止外部连接；开启预览时拒绝生产构建。

```bash
node --test scripts/safetyUnifiedFlowPreview.test.cjs
```

该测试核对新版36项、5组自动引用、保存后复读、会话隔离，以及岗位未配置时禁止日表核对。正式服务的业务权限、修订、条件检查、隐患和导出另由 `scripts/safetyManagement*.test.cjs`、`scripts/stationSafetyInspection*.test.cjs` 验证。

旧版 `smoke.cjs`、`print-boundaries.cjs`、`recurrence-smoke.cjs` 使用固定日期2026-10-15及已替换的独立补充页面/模拟接口，保留用于追溯，**不适用于当前统一流程**。新流程的交互与截图验收以本轮交接记录为准。本地预览和测试不代表云端或现场验收。

`generate-fixture.cjs` 导出当前内存示例生成器；直接运行时仅生成本地 `fixture.json`，不会导入云端。历史静态fixture不是运行时数据来源。
