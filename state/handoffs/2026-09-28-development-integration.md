# 2026-09-28 开发分支整合与发布核查

用户要求全部开发分支合并main并检查/补齐发布，覆盖此前分支保留策略；现场目前不用PDA灌装。发布授权已有，不重复请求。

## 基线与合并
- main原基线 `878322b`，开发集合 `08c7c86`；远端已fetch。合并提交 `92d67e6`；旧清理分支 `804620e` 经git cherry确认补丁等价，以 `959b50d` 正常合并历史，保留主线后续文件。全部本地/远端分支祖先检查通过，无未合并分支。
- 开发集合包含灌装持久操作、PDA冻结与恢复、历史导入恢复、进气业务时间及异常前端修复。账务、押金、客户对账与09-28手机布局采用主线较新实现。
- 保留09-24异常定时续扫与分次补灌规则；整合完整历史见证、单瓶互斥与旧游标安全重开。
- 合并交叉回归修正：不完整历史沿用不可忽略的错误结构；保存后失败通过持久操作回读；历史变化返回未完成并重新核查。

## 发布核查
- 本轮尚未部署。正式域名version.json回读为 `1790577617191-7ad0ea63`，源码 `e9937f5`。7函数已下载备份并逐文件比较；正式crm-filling无capabilitiesV1及fillingOperations，数据库集合清单无crm_filling_operations与crm_filling_slots，确认持久协议尚未上线。
- 已列出支付宝空间：beianoffer、changdongqiti、jiachen、peipei、xintuonengyuan；正式空间为 `env-00jxuffegf2n`。其余空间用途未获确认，不将其他项目当测试空间。
- 隔离云事务、定时恢复及监管测试接收端待确认；PDA真机安装/称重验收未完成，现场当前未使用PDA灌装。
- 不执行历史导入、修账或生产故障注入。schema需要线上结构回读与增量预览，禁止初始化数据库。

## 证据
- 持久证据与候选包：`outputs/trust-audit/2026-09-28-development-integration/`，包含production-before、逐文件SHA-256清单、schema-diff.json、candidate-web、candidate-cloud与evidence。未纳入Git。
- npm test：141项通过；test:development-integration：121项通过；verifyTrust：180项通过、3检查器、24语法入口及JSON检查。各组存在重叠，不合计为独立测试总数。包含分次补灌/续扫、失败及回包丢失恢复、批量完整预警和PDA手工录入保留未完成表单。
- 干净发布工作区 `/Users/wangbo/.codex/worktrees/development-integration-release/2026_v4`；源码 `959b50d`，正式空间构建 `1790601480468-f3b79950`；web/cloud明确范围检查及require-clean通过，两份release-manifest.json均为not_deployed。
- 全仓--scope=all诊断仍发现8份历史ACL副本差异（crm-collection、crm-dashboard、crm-sale），均不在本次7函数范围，保留现行生产权限。未关闭检查或自动覆盖这些权限。
- 9份线上schema已下载。crm_gas_in及crm_gas_inventory_movements现行结构较宽松，本地完整结构不能原样覆盖；crm_pda_filling_tasks需新增两个完成字段和状态，其他字段/index变化见schema-diff.json。CLI schema回读不等于物理索引已验证。

## 下一动作与阻塞
- 用户已授权发布，无需重复询问发布许可。仅缺隔离测试空间的明确用途；已通过问题列出5个现有空间，尚未指定哪个可用于灌装故障演练。其他项目不默认授权改作测试空间。
- 确认隔离空间及监管测试接收端后，按filling_consistency_v1.md验收真实事务、并发和定时恢复；形成增量schema/index清单，发布相关后端后切换H5并回读。PDA现场目前不用，设备部署/验收另记。
- 本次没有上传云函数/schema/H5，没有执行导入、修账或生产故障演练。
- 原有 `output/mobile-release-20260928/`、`outputs/bottle-search-20260927/` 未跟踪目录保持，不纳入提交。
