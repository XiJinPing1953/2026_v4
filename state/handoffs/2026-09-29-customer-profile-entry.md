# 客户档案入口发布（2026-09-29）

- 用户确认新增入口并明确授权发布。客户对账页顶部增加“客户档案”，保留关键词进入不按结算主户归并的原档案列表。
- 主线实现 `71e1b8d`；基于发布前线上 H5 源码 `917e8e5ddcb7b8f1396d22295b2161e0647edb52` 单独构建，发布源码 `f012bf636fbccafc1ca61db86197b5a71e4e5158`，运行源码仅两个客户页面文件变化；未夹带主线尚未发布的 PDA 候选。
- 正式环境：支付宝 `env-00jxuffegf2n`，https://xintuonengyuan.com/。H5 `1790663579439-77c9e925`，产物 SHA-256 `585809e6eee2e933929c7f76db08057e3f9239550ba9f00a608881d552fd6579`，源码干净；仅网页，无云函数、schema 或业务数据写入。
- 发布依赖检查及正式空间构建通过。HBuilderX 从主工作区 `dist/customer-profile-release-20260929` 上传183文件，全部成功并返回 `hosting deploy:OK`。182项版本及资源回读通过，13项CSS按发布前声明的前导CRLF差异验证；正式域名版本逐字节一致。
- 已登录Chrome实测：客户对账页按钮存在，携带“美食美客清洗”进入档案列表，独立显示“美食美客清洗部”；编辑入口打开该地点档案，默认销售单价仍7.5元/kg、结算客户为上庄美食美客。未保存修改。
- 证据：`outputs/trust-audit/2026-09-29-customer-profile-release/` 下 candidate、css-policy、web-readback-network、custom-domain-version。首次沙箱网络回读失败，提权联网重试通过；不属于发布失败。
- 回退包：`/private/tmp/crm-production-filling-gasin-20260928/web`，已核实版本 `1790603642181-6ff58023`；当前包保留在上述暂存目录及受管发布工作区。回退仅网页，不改客户资料。
