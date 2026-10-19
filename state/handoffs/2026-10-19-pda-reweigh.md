# PDA 复秤与灌装入库

## 已确认范围

原生 PDA + 原 NVK 吊秤；本次灌装量按当前有效回瓶毛重推算，与标签净重分别保存。仅本模块生成的未出瓶、唯一灌装单允许更正，网页支持有原因的人工毛重更正。用户已授权核查通过直接发布、发布后指导真机查看。

**标签及二维码只含新拓能源、瓶号、皮重、毛重、净重，不含回瓶依据或本次灌装量。本阶段跳过打印及标签图生成。** 业务规则见 [P-05](../domains/pda.md)。

## 实施与计算

- PDA入口复用原扫描插件和NVK BLE，按账号保存草稿，提交前冻结操作号与称重证据，未知回执保持原号；明确未保存的拒绝才能新建操作。
- 标签净重＝本次毛重－档案皮重；本次灌装量＝本次毛重－当前有效回瓶毛重。缺少回瓶依据或周期不明禁止提交，草稿保留；时间默认当前UTC+8小时，采集时刻另存。
- 云端事务保存源单/流转/库存；更正原单替换贡献并保留原始蓝牙证据和旧源快照。创建与更正恢复分别核权；并发版本、缺依据、已出瓶、旧来源和多次补灌保护均已实现。
- 网页展示本次灌装量与皮毛净，人工更正原因必填、按原号恢复；日期/录入员/重量不能经普通或批量修改绕过。

## 本地与隔离验收

规则12项、真实handler持久化14项、既有灌装一致性34项、PDA交互16项、网页恢复10项及既有BLE19项通过，共105项。Vue检查、H5/原生编译、发布依赖及上下文检查通过。

真实支付宝SDK隔离验证仅在 changdongqiti `env-00jy6b2th3xi`、独立 `rw1019_` 合成集合：创建、更正、原号重放、内容冲突、并发单版本提交、源单与库存事务回滚、明确拒绝后恢复等13项通过。使用与生产候选哈希一致的灌装源码；监管为封闭模拟入队，不能代表外部监管送达。合成记录已清理，验证函数已替换为410禁用入口。未写生产测试业务数据。

## 生产发布（2026-10-19）

- 实现提交 `842d9ea`，吸收主线检验日期修复后发布源码 `b9624a04179d4e1a67909a624e160d8aa723965c`，已合入并推送main。后续独立检验修正提交不改变本次产物来源。
- 正式空间：支付宝 `env-00jxuffegf2n`（xintuonengyuan）。`crm-filling`、`crm-bottle`、`crm-user`、`crm-auth` 共35源文件上传并回读一致；`crm_fillings.schema.json` 最终JSON回读一致。平台首轮跳过已有schema更新，补传并回读后才发布网页。
- H5 `1792398831671-839d9ace`，入口 `/assets/index-CE5MSBK0.js`；216项网页回读及正式域名version/index/入口哈希通过。CSS平台前缀差异有明确交付策略绑定。登录后正式Chrome汇总与普通列表显示“本次灌装量”，车辆仍“净重”，页面无重叠；只读查看，不提交或更正生产单据。
- 发布前四函数、schema及上一网页 `1792398715876-28a746ea` 已备份。PDA旧资源62文件及原APK已备份；原APK与候选均uni-app5.06、原生模块/插件声明一致，无AAR变更。

## PDA现场与继续条件

设备 `02132611032690`（i6310 Pro，Android12，720×1440）已由用户USB连接并授权调试；包名 `uni.app.UNI756A841`，原APK1.0.1(102)。真机发现旧引擎无Intl，送检模块顶层Collator初始化致白屏，已以自然排序降级修复（`fe3af02`），4项排序/16项PDA测试及独立审查通过，UTC+8规则不变。

发行资源1.0.2(103)源码`67d2bf4`，干净构建、生产云空间绑定明确，已由HBuilder官方同步并回读；保留登录与数据。Intl异常已消失；重启整机后曾进入新版复秤页，显示扫描头就绪、NVK吊秤已连接、0.0kg稳定；现场扫码预览返回缺少本轮回瓶数据409，未提交业务。随后强停再开及用户手动运行仍白屏，日志有App Launch/Show而WebView渲染进程未正常建立，具体系统机制未定；旧资源也曾出现相同白屏。**PDA尚未完成现场验收，用户已要求停止远程设备控制，改为手动连接调试。** 资源更新不等于重新签名安装APK。

早期静态fixture的HTTP预览被拒绝、file URL被浏览器策略阻止，未绕过；实际设备检查独立记录。真实扫描头、NVK吊秤稳定读数、首笔生产保存及监管送达仍须现场验证，不以构建/隔离测试替代。

现场顺序：PDA首页“复秤”→“连接吊秤”→扫描真实瓶码→等重量稳定→核对毛重、标签净重及本次灌装量→“保存灌装记录”。若显示“保存结果待确认”，使用“查询保存结果/重试原操作”，不另建操作；“下一瓶”在结果确认后使用。打印暂不操作。

本机证据目录：`outputs/trust-audit/2026-10-19-pda-reweigh/`。关键记录为 `cloud-proof.json`、`web-proof.json`、`public-proof.json`、`isolated-acceptance.json`、`isolated-cleanup.json`、`isolated-disabled.json`、`web-readonly-verification.json`、`pda-before/runtime-backup-evidence.json`；原始日志、token及备份不进入Git。

## 认证模块加载警告修复（2026-10-19）

用户在手动云端调试时要求先解决`fallback to local pageAcl helpers`。根因是`crm-auth`先加载部署包之外的`../common/pageAcl`，必然缺失后才加载包内模块。源码`4fc2507ee224b78490293f563a8effb898d150dd`改为直接加载同步生成的`./pageAclLocal`，权限规则未变。独立部署包测试通过：无加载警告、有效token正常、无效token401、PDA显式禁用保留、敏感字段剔除；3个权限副本一致。

仅`crm-auth`已发布到正式支付宝空间`env-00jxuffegf2n`，5文件回读与候选一致；线上旧包已备份。未改H5、PDA资源或数据库结构，未操作设备；这项修复不能证明白屏解决。证据为上述目录内`auth-acl-fix/`的`before-proof.json`、`candidate-manifest/release-manifest.json`、`cloud-proof.json`及平台回执。

## HBuilderX本地巡检依赖安装（2026-10-19）

用户随后截图为`crm-safety-management`、`crm-station-safety-export`的`EBADPLATFORM`，与认证警告分开。两函数显式Linux Sharp依赖源自`f9d060c`修复真实云端缺库，不能为消除Mac提示直接删去。恢复被HBuilderX失败安装删除的原锁文件，在当前PDA工作区使用HBuilderX内置Node18/npm10执行一次`ci --force --include=optional --no-audit --no-fund`，同时保留平台库；未改依赖版本、包配置或发布云函数。Sharp平台选择依据见[官方说明](https://sharp.pixelplumbing.com/install/#cross-platform)。

按HBuilderX实际检查方式（`NODE_SKIP_PLATFORM_CHECK=1 npm ls`）两函数均退出0；实际darwin-x64/Node18.20.0加载Sharp0.33.5、libvips8.15.3，PNG转JPEG均通过，Linux原生库保留。证据`local-dependencies.json`。后续新工作区若重现同样问题，可按此限定范围准备本地依赖，不给全局npm配置force。

既有导出测试本轮4/5通过，其中图片嵌入通过；另1项旧测试以`Date.now()`设置销号时间，当前已跨出2026-10-15所在周，历史待办断言失败，不计通过，未顺带改业务或测试。PDA白屏仍由用户手动联调，未操作设备。
