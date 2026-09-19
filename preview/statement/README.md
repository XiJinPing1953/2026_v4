# 本地客户对账预览

仅纯模拟数据，挂载真实 CustomerStatementModule。不是账务计算验收依据。

启动：`npm run preview:statement`，打开 http://127.0.0.1:5190/#/pages/customer/statement 。服务只绑定本机，kg/瓶/m3 可以切换；切换仅更新 recordId，不重挂主组件，方便验证客户状态隔离。重置按钮或刷新恢复初始模拟数据。

测试：`node --test preview/statement/mock.test.mjs`。覆盖示例计数、预览只读、模拟新增/确认、冲抵分配/撤销、未知操作/客户/函数拒绝及重置。模拟不支持的删除、退款、押金写入、抹零等会明确拒绝，不能据此推断线上能力。

正常构建：`npm run build:h5`。未设置 STATEMENT_PREVIEW 时插件不启用，fixture、模拟登录、页面壳不进入客户端构建；可搜索 dist/build/h5 的产物确认没有 `demo-kg`、`本地模拟用户` 或 `[statement-preview]`。误设 `STATEMENT_PREVIEW=1` 进行任何 build 会主动失败。

边界：预览插件仅在显式环境开关下替换 callCloud、auth、App.vue 和 statement 路由模块；主业务组件与服务代码均未替换。CSP 将连接限制为本站及本地开发 WebSocket。auth 直接返回本地示例用户，不读取 token 或真实客户；所有 mock 写入仅保存到当前浏览器内存。示例汇总为固定全量范围，日期选择用于界面和分配目标交互，不作为期间会计口径验证。

整单调整模拟：支持 beginReceiptAdjustmentV1 / cancelReceiptAdjustmentV1 / updateReceiptV1。进入时按真实服务 deferred 策略保存原收款与目标快照，账务读取保持原分配；released_targets 仅返回释放增量供前端补回，保存时才回滚旧分配并重分配；期间读取、切换工作区不会清除快照；取消精确恢复原值，保存按当前选择重新分配。一次仅允许同一客户的一张收款进入调整，调整期间拒绝其他模拟写入，避免覆盖快照。测试覆盖重复进入、读取后继续、取消全量恢复、修改金额及目标后保存，以及再次调整/取消恢复新分配。这里只验证模拟状态，组件工作区切换仍由浏览器交互验证。
