# 手机网页隔离预览

启动：`npm run preview:mobile`（仅绑定 `127.0.0.1:5191`）。

- 客户列表：`http://127.0.0.1:5191/#/pages/customer/list?scene=statement`
- 客户对账：`http://127.0.0.1:5191/#/pages/customer/statement`
- 出纳登记：`http://127.0.0.1:5191/#/pages/cashier/receipt-intake`
- 销售详情：`http://127.0.0.1:5191/#/pages/sale/detail?_id=mobile-demo`
- 入户历史：`http://127.0.0.1:5191/#/pages/home-safety-inspection/history?customer_id=demo-kg`

实际业务组件使用本地示例数据；不读取登录凭证。所有云函数入口被替换，未配置动作明确拒绝；CSP 禁止外部连接与表单提交。已有对账/出纳模拟写入只改变浏览器内存，刷新重置。生产构建禁止启用预览插件，不使用此预览证明业务计算正确。

`?fixture=empty`、`?fixture=error`、`?fixture=loading` 放在 `#` 前可检查列表空态、读取失败和延迟 10 秒的加载态。这三个开关仅服务于展示验收，不是生产功能。

`inspection-templates.json` 是当前巡检模板的本地只读快照，用于展示模板字段，不读取真实巡检记录。没有模拟照片、原生蓝牙、扫描器、称重网关和真实导出任务。

## 浏览器巡检

使用已安装的 Playwright CLI 打开上述预览后执行：

```sh
playwright-cli -s=crm-mobile run-code --filename=preview/mobile/audit.cjs
```

脚本包含本轮 `src/pages.json` 的 60 个路由，在 390px 逐页截图，并检查 320/360/430/768/1440px 宽度；返回 JSON 结果。新增路由时同步此清单。截图写入被 Git 忽略的 `output/playwright/mobile/`；最终逐页结论见项目交接记录。检测覆盖主体溢出、非滚动区域裁切、页面加载异常和日期控件容器；局部滚动内容不计为主体溢出。真实手机键盘、Safari、照片/签名及原生硬件须另行实测。
