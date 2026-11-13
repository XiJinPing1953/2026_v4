# DCloud 上秤差续办修复发布（2026-11-13）

用户明确要求“请你部署”，替代此前先不部署的限制。已发布两个云函数和两份 schema；业务续办与账单验收分开记录。

## 发布来源与范围

- 源码 `fbef37aa63b6d7d79d7efadce9cc4fff1f3762c1`，已快进合入并推送 main；独立工作区 `/private/tmp/crm-dcloud-release-20261113`。原工作区相关修改保留在 `dcloud-release-20261113-reviewed-workspace-backup` stash，49项其他已跟踪差异的哈希/缺失状态保持。
- 目标支付宝 `env-00jxuffegf2n`。版本 `2026.11.13-start-loss-resume.1`；本次无 H5、PDA、APK 发布，无手工补历史流水或修改任务状态/重试时间。
- 发布前重新下载：灌装23文件与11-12正式回读一致；销售20文件与11-02正式回读一致。保留1.0.74回瓶门槛、已撤销跨车可见后的线上权限。
- 只叠加6个业务文件：filling 的 index/startLossJobs/startLossScope，sale 的 index/webSaleSave/webStartLossScope。独立候选203项测试通过；运行文件与已复核代码一致，包内依赖与独立检查通过。
- 依次发布 `crm_filling_start_loss_jobs.schema.json`（新增集合）、`crm_web_sale_operations.schema.json`（新增三个可选字段），再发布 crm-filling、crm-sale。原schema权限/必填/已有类型保持，不使用初始化数据库。
- 回读：crm-filling 25文件、crm-sale 21文件；JS逐字节匹配，package JSON语义完全相同，两个schema JSON完全一致。512MB、60秒和两个原定时器配置保持。

## 业务验证

- 发布前完整核验28个受影响历史任务、130瓶；全部日志及瓶号读取完整，无来源分歧。正确流水1716、零差757、人工确认1、非候选2881；疑似缺失38，无重复或错值。此前36条仍在，新增识别2条日期为8月18日、9月14日，均未专项修复。
- 发布前销售当前状态快照28张，其中14张待续办；旧线上版本没有status字段，不以空status推断不存在。
- 14:53最终任务快照：发布前14张待续办销售全部自动完成；28张受影响历史销售均为complete/pending=false，无blocked、查询失败或旧版响应形状。14个新补算任务均一次完成，14次caller调用P50=117ms、P90=521ms、最大609ms，无超时/技术失败/超过9秒；对应工作耗时最大120ms。
- 14任务均scanned=0已独立核对：前后审计中每单日期下界内候选均0，销售日期/瓶号不变、三路来源一致；以操作键/瓶号/日期独立重算14个job_key均匹配实际调用。涉及85个不同瓶，旧全历史每单104–271条、按任务合计1814条含交叠。说明本批正确跳过无关历史，不代表非空范围重算与并发事务的全部生产行为已经现场实测。
- 发布初期两次快照仍夹有旧版响应形状，原因未单独确认；再次下载销售源码仍完全一致，14:53快照已无旧形状。观察窗口内旧10秒超时日志最后在14:36:31，旧同步最后在14:36:38，之后未新增；不可将PDA/手机保留旧同步入口的日志单独当作旧网页代码证据。
- 14:59:51全部任务完成后的最终核验：130瓶和日志均读全，28任务瓶号来源一致、待续办0；所有分类及38条问题逐项与发布前一致，无新增缺失/重复/错值。14次调用仍全部成功。14:48首轮核验结果也一致，当时尚有12张销售续办中。
- 完整一天RU/WU/函数用量与账单：尚未形成，不据短时调用承诺日费用。

## 证据与回退

证据目录：[2026-11-13-dcloud-release](../../outputs/trust-audit/2026-11-13-dcloud-release/)。主要文件：`release-manifest.json`、`release-receipt.json`、`baseline-check.json`、`filling-readback-check.json`、`sale-readback-check.json`、`audit-before.json`、`audit-after-final.json`、`integrity-comparison-final.json`、`tasks-before.json`、`tasks-after-third.json`。时间均为本地UTC+8。

回退依据为本次刚下载的 `readback-before/` 与 `rollback/`，不可使用旧10-31灌装包覆盖1.0.74修复。若需回退，先核对当前任务状态并评估已产生的新任务/blocked状态，再按获准范围恢复代码；新任务集合不删。禁止直接上传旧 `2026-11-12-dcloud-cost/cloud-candidate/`。
