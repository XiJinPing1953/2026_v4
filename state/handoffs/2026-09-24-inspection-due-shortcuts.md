# 钢瓶检验登记快捷筛选发布交接（2026-09-24）

## 范围与版本

- 用户在完成本地方案后明确要求直接部署正式环境。
- 发布分支 `codex/inspection-due-shortcuts`，源码提交 `15f780c60a2c877dd1c2feb836c73fb8e16d512c`；基线 `be68d10ebabd81d5ab56261429ee408edeced88f`。发布工作区：`/Users/wangbo/.codex/worktrees/inspection-due-release/2026_v4`，工作区干净。
- 支付宝云空间 `env-00jxuffegf2n`，域名 `https://xintuonengyuan.com`。
- H5 buildId `1790219575288-063d4ce1`，构建产物摘要 `d2781337d8007794c4da28e33f7e5df6d63052f5aa2c318e1cc2266c695f618a`。
- 只上传 `crm-bottle` 云函数，候选包摘要 `5d825b702997a2854300e20917c88bfe12ab9f43f213ada0bca21e8367941e74`；未上传数据库 schema，未修改业务数据。上传命令返回“云函数crm-bottle上传完成”。云平台不提供本次函数包的直接回读哈希，线上只读查询验证了新增筛选条件可用。

## 功能

- 检验登记页增加“瓶检待处理／表检待处理／阀检待处理”入口。每项合并已过期与未来60天内到期的在用钢瓶，自动勾选对应本次检验项目；操作员仍可修改。
- `overdue_or_due_60d` 在列表与批量登记筛选中使用同一日期范围；保留原有单独状态与链接。筛选变化时清除旧选择，结果仍按瓶号排序，原有预检、确认及2000瓶单批上限保留。
- 首页三个检验到期待办入口打开对应合并结果。

## 验证

- 7项定向测试通过，包括过期、今日、第60天、第61天和无效日期边界，列表与批量预检口径，快捷入口、首页跳转、清除旧选择及旧状态兼容。
- 隔离工作区的 web/cloud 发布范围检查均通过，`sourceDirty=false`。带正式云空间配置的 H5 构建及发布前校验通过。
- HBuilderX 网页发布封装命令在编译阶段报 `ENOENT dist/build/web/index.html`，尚未上传网页。随后用仓库构建命令重新构建，并以 HBuilderX `hosting deploy` 上传 183 个文件；命令返回 `hosting deploy:OK`。
- 正式域名的 `version.json` 返回上述 buildId。182项静态资源回读通过；CSS 在托管分发时增加前导 CRLF，按记录的交付变体策略逐项核验，其他资源按原始哈希核验。
- 登录后的正式“钢瓶检验登记”页面显示三个快捷入口。点击“瓶检待处理”显示16瓶，钢瓶本体项目已勾选，瓶号顺序从115到J80；“表检待处理”“阀检待处理”均显示0瓶并切换到相应项目。以上仅为只读查询，没有勾选待更新钢瓶或提交检验登记。
- 16瓶中有6瓶显示“周期缺失”（J58、J61、J65、J73、J74、J80）；按现有预检规则，若把这些瓶一并登记，需先补齐周期或从本批移除。

## 证据与回退

- 本地证据目录：`outputs/inspection-due-shortcuts-20260924/`。其中 `web-readback-verified.json` 是成功的线上资源回读，`web-version.json`、`web-release-manifest.json`、`cloud-release-manifest.json` 保存候选包清单，`css-delivery-policy.json` 保存 CSS 分发变体声明；候选清单里的 `not_deployed` 是生成清单时的初始状态，实际发布结果以上述 HBuilderX 回执及资源回读为准。
- H5 回退版本 `1790130804769-39a06c6f` 的本地包在 `outputs/trust-audit/2026-09-23/k023-presentation/candidate-web/`。原 `crm-bottle` 源码归档在 `outputs/inspection-due-shortcuts-20260924/crm-bottle-rollback.tar`，取自基线 `be68d10`。回退时仍须分别部署云函数与 H5，并重新核验线上版本和查询。
- 原工作目录还有其他任务的未提交修改。发布使用隔离工作区，未夹带这些文件；原工作目录中的同功能未提交修改保持原状，发布提交保存在独立分支。
