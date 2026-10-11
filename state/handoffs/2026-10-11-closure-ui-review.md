# 天然气闭环页面审查与 Impeccable 安装

用户要求安装 Impeccable、关闭自动 hooks、适配当前 CRM，先只用于页面审查。初次审查未改页面或部署；随后用户明确回复“你来改”，本页建议已按下方实施记录发布。

## 安装与范围

- 官方来源：https://github.com/pbakaus/impeccable ，4.5.2，固定提交 c63b8dd7dd5a5f3c32eaabe1af76d0694f863ed2，引擎 0.1.14。通过 Codex skill-installer 安装到项目 .agents/skills/impeccable/，没有运行全提供商安装器。
- [CRM 审查入口](../../.agents/skills/impeccable/SKILL.md)替换通用构建入口，原文保存在 SKILL.upstream.md。组件、口径和边界见[适配上下文](../../.agents/skills/impeccable/reference/crm-review.md)。审查不授权自动修页面、改账、发布或启用 hooks。
- 官方 hooks off 命令已将[配置](../../.impeccable/config.json)写为 hook.enabled=false；状态回读 disabled，环境覆盖未设置，没有安装任何提供商的 Impeccable hook manifest。未关闭其他工具的 hooks。
- 56个官方支持文件与固定提交逐字节一致，适配链接检查通过。升级须保留 CRM 入口与 hooks 关闭配置。

## 本轮证据

依据用户10月11日截图及当前代码：日期09-01至10-11、1773周期、460待核。这些数字仅描述截图时点，本轮未重新查询或更正账务。

独立代码审查与 Impeccable 手动检测分别进行。官方 detect 对 GasClosureView.vue 正常退出并返回空数组。这是机械扫描0项，不代表视觉、无障碍或移动端合格；uni-app 自定义标签及信息层级需要人工判断。本轮未新做浏览器交互、对比度测量或手机测试，不为未测项目打分。

## 建议优先处理

| 优先级 | 问题与影响 | 证据 | 建议 |
|---|---|---|---|
| P1 | 四项指标并列同权重，易被误当成可相减对平的余额；口径挤在灰字长句中 | GasClosureView.vue:28、:36及截图 | 累计灌入与核对状态分组，口径就近说明，保留数字与定义 |
| P1 | 每日灌前余量在20条逐瓶卡片和分页之后，核心环节难发现 | GasClosureView.vue:47、:77；useGasClosure.js:34 | 首屏提供逐瓶闭环与每日灌前余量的清晰切换，保持筛选范围独立 |
| P1 | 待核行只显示待核加号，460条须逐个展开才能知原因 | GasClosureView.vue:48、:62及截图 | 默认露出第一条已有待核原因，展开完整源单，不改判断规则 |
| P2 | 原生导航与 AppPage 双标题，页头与正文对齐不一致 | src/pages.json:269；GasClosureView.vue:2、:189及截图 | 本页保留一层标题，页头与正文同轴，不全局修改 AppPage |
| P2 | 卡片留白与重复字段降低比较效率，筛选占首屏较多 | GasClosureView.vue:7、:23、:201及截图 | 桌面紧凑列、手机卡片；可复用日期预设，保持日期含义 |
| P2（代码风险） | 自动刷新先清空储罐详情，可能闪动打断阅读 | useGasClosure.js:50、:60、:72，尚未交互复现 | 保留旧值并标更新中，成功后替换；失败标过期，频率不变 |

现有源单展开、待核保留、仪表候选提示和更新时间应保留。建议先调整标题、指标层级和两个工作区入口，再压缩列表。这些均为页面建议，本轮未实施。


## 用户授权后的实施与发布（2026-10-11）

- 用户“你来改”授权实施上述 UI 建议。统一单层标题和对齐；前置逐瓶/每日余量工作区；指标就近解释；桌面紧凑列、窄屏卡片；首条待核原因直接显示；灌前余量刷新期间保留旧值并标更新/过期。后端计算、源单和拟合公式不变。
- 主线实现 `0f9d251`；基于原正式源码 `633d5ac` 的发布源码 `626b27916a8bf5b4c2019b9c431d7868d22011d2`，H5 `1791714002815-18ed2df2`。只发布 H5，支付宝 `env-00jxuffegf2n`，正式地址 https://xintuonengyuan.com/index.html#/pages/gas-closure/index 。发布配置中的 crm-bottle-movement 仅保留现有依赖完整性检查，本次没有上传函数或数据库。
- 7 项相关前端测试、SFC 模板编译、绑定空间的 H5 构建通过；干净发布源码、186 文件上传成功、185 项网页资源回读一致。原生产包已保留，可回退。
- 正式 Chrome：09-01～10-11 为1773周期/460待核，四项指标123293.3、85584.5、3162、38257 kg，与用户旧截图一致；待核原因直接可见。窄屏实际433 CSS px，页面 scrollWidth=433，日期选择到10-10、20周期查询、138号瓶详情通过。浏览器跨桌面/窄屏直接切换时曾出现 uni 日期控件暂态样式异常，按窄屏重载后初始布局及弹层选择正常；真实手机和 Safari 未实测。
- 每日余量工作区可直接展开10-10候选21.42吨；点击刷新时21.42吨及原始读数仍保留、明确提示等待更新。返回新结果后更新时间更新。故障/竞态由对应前端测试覆盖，没有人为中断正式网络。
- 手动 Impeccable 检测1条 border-accent-on-rounded 提示；对应 workspace-tab 已设 border-radius:0，是选中页签下划线的误报。自动 hooks 继续关闭，技能默认仍仅用于审查。
- 证据：`outputs/trust-audit/2026-10-11-closure-ui-release/`（version、manifest、web-delivery、ui-acceptance、desktop/mobile-detail、refresh-retained及精确网页包）；上版回退包 `outputs/trust-audit/2026-10-10-closure-module-release/web/`。本机预览云端登录 request:fail，未计作验收；以上交互均在正式域名只读完成。
