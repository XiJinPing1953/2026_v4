# 安全管理本地示例预览

用于审阅已实现的页面。假账号、检查、日期和照片均为示例；写入只存在浏览器内存，刷新页面即重置。页面底部持续显示示例提示。不得将示例 PDF 当作实际安全生产记录。

```bash
node scripts/syncDomainContracts.cjs --write
node preview/safety/generate-fixture.cjs
STATEMENT_PREVIEW=1 SAFETY_PREVIEW=1 npm run dev:h5 -- --host 127.0.0.1 --port 5196
```

访问 `http://127.0.0.1:5196/#/pages/safety-management/home`。

`preview/statement/plugin.mjs` 仅在开发服务启用：云函数请求替换为内存响应，CSP 阻止外部连接；开启预览时拒绝生产构建。正式配置默认账号及启用日期均为空，示例配置不导入云端。

浏览器验证使用 Playwright CLI 的 `run-code --filename`：

- `smoke.cjs`：六个页面、390/1280px 布局、补充暂存、日表核对及两份示例图片的 PDF。
- `print-boundaries.cjs`：缺失证据链接时阻止打印，65段长问题描述跨页打印。
- `recurrence-smoke.cjs`：查询已关闭隐患并明确选中复发来源，验证手机布局。

浏览器脚本只验证实际 Vue 页面与本地模拟服务的交互。权限、完整分页、事务、修订、零报告、复见复发和 Excel 另由 `scripts/safetyManagement*.test.cjs`、`scripts/stationSafetyInspection*.test.cjs` 验证；本地测试不代表云端或现场验收。
