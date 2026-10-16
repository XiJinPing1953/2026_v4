# 手机称重销售迁移

用户于 2026-10-15 批准完整实施计划，随后明确“先完成代码，设备稍后验收”。设备验收不再阻挡本地实现；发布仍须完整业务链路实测。销售计价公式、历史单据、灌装及 C606+ 网关保持原范围。

## 源码与范围

- 基线 `106a57d`；隔离工作区 `codex/mobile-scale-sale`。原主目录的无关修改、原始资料及删除状态未纳入本次修改。
- 实现提交 `f99feeb` 已快进合入本地 `main`；合并前后核对原有 41 项未提交状态，内容/删除状态全部保留，原有 STATE 修改已恢复。主目录已安装锁定的扫码依赖。没有推送远程或发布生产。
- 入口沿用 `/pages/pda/sale-create` 和原权限，用户可见名称为“手机称重销售”。不会自动授予普通账号权限。
- `MobileQrScanner.vue`、`cameraScan.js`：本地 `qr-scanner@1.4.2`、明确按钮开镜头、后摄优先、扫描会话与稳定行 ID、迟到结果丢弃、退出释放资源。
- `usePdaSaleForm.js`、`mobileSaleDraft.js`：账号隔离草稿、写后核对与存储失败提示；同草稿固定操作号及旧页面覆盖保护；提交冻结、查询恢复、价格/瓶档/存瓶差异确认。已保存结果不因查询失败丢失单号。
- `bleScaleCore.js` 保留原拆帧、单位、0.1 kg 与稳定算法；`webBleScale.js` 用户手势选择设备并订阅 FFE0/FFE1，共享核心保留原生使用方。每瓶新会话，断线/后台/三秒超时失效；重连重新取得 GATT 对象。
- `crm-sale/mobileSaleCreate.js` 复用 `createV2` 的计算和后置处理。创建者+操作号派生固定 ID，源单和永久凭据同事务创建；只有首次胜出的请求执行后置处理。插入异常但读不到赢家仍返回未知，不能据此换号重建。处理中或待核单均拦普通改/收款/删。
- 数据库仅新增 `crm_mobile_sale_operations` schema/index 及销售可选来源、采集证据字段；根目录 schema 为上传入口，旧 schema 副本一致。

## 当前验证

- 专项 62 项通过：扫码/UI 15、草稿/提交恢复 14、BLE 16、真实 `crm-sale` 入口搭配事务模拟 17。命令：`node --test scripts/mobileSaleCapture.test.cjs scripts/mobileSaleDraft.test.cjs scripts/mobileSaleScale.test.cjs scripts/mobileSaleCreate.test.cjs`。
- 相关回归 43 项通过：`frontendTrust`/`accountingFrontend`/`bottleSuggestions` 10 项，`pdaFillingCompletionFrontend` 9 项，`financeTrust`/`gasInventoryPrecision`/`customerAdjustmentIntegration` 24 项（均为 `scripts/*.test.cjs`）。保留原桌面销售、账务和灌装前端兼容路径。
- 本地浏览器预览使用已有 `STATEMENT_PREVIEW=1 MOBILE_PREVIEW=1` 隔离插件；调用模拟数据且 CSP 限制外部连接，不访问生产云业务数据。模拟 BLE 只能证明前端事件链路，不能证明吊秤或手机兼容。
- `npm run build:h5`、`npm run build:mp-alipay`、云文件语法及 `git diff --check` 通过。扫码库改为同包内含 worker 的发行文件，修复 uni-app 对依赖动态分包生成裸路径的问题；`node scripts/checkMobileSaleBundle.cjs` 检查实际 H5 产物中本地软件 worker 与非法导入路径。
- Chrome 隔离预览已完成关闭原生 `BarcodeDetector` 后的真实软件解码（本地生成二维码的视频流）、模拟拒绝相机权限、模拟蓝牙连接、手动选 101 号瓶、通知稳定后毛重120/皮重100/净重20回填、刷新恢复、存瓶预览与模拟销售保存，并确认保存后表单冻结。390/320 px 无横向溢出，最终流程无页面脚本异常；截图位于独立工作区本地 `output/playwright/mobile-sale-saved-{390,320}.png`，不包含真实客户或云单据。
- 可复用浏览器脚本：`preview/mobile/sale-smoke.cjs`（Playwright CLI `run-code --filename`）；必须先在独立端口启动 `STATEMENT_PREVIEW=1 MOBILE_PREVIEW=1 npm run dev:h5 -- --host 127.0.0.1 --port 5194`。脚本检查隔离预览标识，使用独立浏览器会话并清空该本地模拟站点存储，不能用于生产页面。

## 仍需验收与发布门槛

- 本次尚无已连接安卓手机、iPhone 及原吊秤，未完成真实摄像头+BLE并行、两瓶同重、断线、锁屏恢复及真实操作员完整业务链路。设备型号、系统和浏览器版本须现场记录，不能填写为已通过。
- 新操作凭据集合须先核对目标空间线上结构，再上传根目录 schema/index；隔离支付宝云须验证同号并发、事务回滚、源单已写后函数中断、处理中改单及删除后迟到重试。
- 发布顺序：兼容数据库与 `crm-sale` → H5；保存源码提交、产物哈希及各产品回退包。撤回入口仍保留操作凭据，不能因回退重新允许重复创建。
- 截至 10-15，生产云函数、数据库及 H5 未部署；10-16 仅账号配置支持按下文范围上线，手机销售提交服务及新版 H5 仍未发布。

## 2026-10-16 专用账号与可修改默认值

- 已在支付宝正式空间 `env-00jxuffegf2n` 创建用户指定的专用账号，仅开放 PDA 入口查看及手机称重销售查看/新建；其余页面权限显式关闭，不授权销售列表、改单、删单、档案维护或用户管理。凭据不进入 Git。
- 通过档案 ID 核实张侨冰、王红权及冀A38U7G 均启用，保存为账号默认配送员 1/2 与车辆。后端校验 ID 并使用权威名称；新表单使用默认值，现场可修改，草稿恢复保留已修改值，下一单重新采用账号默认值。
- 账号后端源码 `60a1e7b`；前端 `bb330b9`；正常合并至 main `0b645e8`。只发布 `crm-user` 六个文件及 `crm_users.schema.json` 可选字段；上传前备份并核对线上结构，上传后六文件哈希和一个结构语义回读一致。未部署本次 H5 和 `crm-sale`。
- 正式账号登录、客户联想查询/详情、人员/车辆/瓶档/存瓶读取成功；用户管理、档案修改、销售列表/修改/删除均返回 403。没有新建测试销售单。私有证据：`outputs/trust-audit/2026-10-16-mobile-sale-account/`，凭据仅存在本地受限文件及交付会话中。
- 后端 8 项、草稿 18 项测试通过；H5 构建通过。390px Chrome 本地隔离预览验证两个客户候选、点击回填 ID/名称/各自单价、改关键词或清空后清除旧选择、配送员及车辆修改、刷新恢复后保留修改值。脚本 `preview/mobile/account-defaults-smoke.cjs`；截图在 `output/playwright/mobile-account-*.png`。模拟预览不代替正式账号页面或真实手机验收。
- 后续仍按上节验证设备及隔离云事务，再发布手机新版页面与销售提交服务。当前账号可登录不代表完整手机称重销售已经上线。

浏览器与库依据：[Web Bluetooth 用户手势及 GATT](https://developer.chrome.com/docs/capabilities/bluetooth)、[Bluefy 官方指南](https://bluefy.app/guide.html)、[qr-scanner 本地解码及 worker](https://github.com/nimiq/qr-scanner)。这些文档不能代替本项目现场验收。
