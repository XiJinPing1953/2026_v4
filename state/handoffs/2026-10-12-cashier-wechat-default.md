# 出纳收款渠道默认微信发布

- 用户先指定出纳收款登记默认微信，随后明确“发布”。新建、重置金额、取消编辑及保存成功后的新表单默认微信；已有记录编辑和未完成操作恢复沿用原渠道。决定见[账务 A-18](../domains/accounting.md#a-18出纳到账与气款押金联动2026-09-20用户批准)。
- 主线实现 `8f1c388` 已推送。基于线上网页源码 `378843bc1129e6c256c27026b44e0fe674fa3153` 独立构建，发布提交 `70f6d2168ba75aa1f2ec68092337a10cb5ef2707` 已推送至 `codex/cashier-wechat-release`；运行源码仅改 `CashierReceiptIntakeView.vue` 四处默认值。主线未发布 PDA 候选未带入。
- 正式 H5 `1791785015597-4c4d09be`，支付宝 `env-00jxuffegf2n`，地址 `https://xintuonengyuan.com/index.html#/pages/cashier/receipt-intake`。产物 SHA-256 `6aa3b7fc06459d3f1f464fe5ff6bc055b0901f701914414f122c1095d6f8b499`，`sourceDirty=false`。
- 21项出纳前端测试、干净源码发布依赖检查、绑定空间H5构建通过。配置中的 `crm-bottle-movement` 仅保留已有依赖完整性检查；本次没有上传云函数或数据库。
- HBuilderX 明确选择唯一项目 `crm-closure-release-20261010`，上传其 `outputs/cashier-wechat-release-20261012/web`；上传前核对暂存包产物摘要一致，186/186文件成功，`hosting deploy:OK`。
- 正式域名185项版本和资源回读通过，其中13项CSS匹配绑定本次构建的前导CRLF差异清单；云托管域名 `version.json` 同版。
- 已登录正式Chrome新标签验证初始微信、手动现金、重置恢复微信；未选客户、上传凭证或提交收款。首次打开短暂显示旧缓存，现有版本机制刷新为带 `__h5v=assetsindex-BnW1aggFjs` 的新版入口后通过。真实手机未另测。
- 证据目录 `outputs/trust-audit/2026-10-12-cashier-wechat-release/`：`predeploy.json`、`web/release-manifest.json`、`delivery-policy.json`、`web-delivery.json`、`ui-acceptance.json`、`live-wechat-default.jpg`，源码另存 `source.bundle`。首次沙箱网络受限的读取失败另有记录，未更改网页包，获联网许可后回读通过。
- 上一正式H5 `1791717051630-1e0ccf09` 的精确回退包已复制到证据目录 `rollback-web/` 并校验摘要 `143ab11c7b3d6f96512603623c0529bbc92db626aaedee8b7ad58e15e2f2e44d`；如需回退只上传该网页包并重新核对版本/资源，不改云函数或业务数据。
