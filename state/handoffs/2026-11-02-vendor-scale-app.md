# 厂家称重App安装与深度剖析（2026-11-02）

用户指定安装`/Users/wangbo/Downloads/display_weight_control_2.1/APP/weight_tool_2.0.1.apk`到PDA并深度分析。承接[地秤专项核查](2026-11-02-floor-robustness.md)，本次没有修改或另发CRM运行代码。

## 安装证据

已安装到当前连接的i6310 Pro（Android 12）：桌面名`egg-weight_tool`，包名`com.egg.weight.tool`，2.0.1（102），与CRM独立。ADB安装返回Success，dumpsys核对版本，回取已安装APK与原文件SHA-256一致：`8af5afc50bae5e3c607075916a42f5da85f21eb8846b1ca19d00818e83c054bc`，17737398字节。

核验时`stopped=true notLaunched=true`，蓝牙扫描/连接运行时权限尚未授予；未启动App、连接真实地秤或发送归零/标定。首次扫描时原生代码会请求蓝牙扫描、连接和粗略/精确定位。现场操作继续由用户执行。

## 分析方法与主要发现

提取实际APK中的uni-app Vue3业务JS（编译器4.24），Babel AST直接抽取原函数，11组隔离回放验证；不是重写厂家算法后的自测。另用Android SDK dexdump检查厂家原生BLE代码，并只读回取本台PDA的CRM原生APK作对照。没有运行/烧录供应商固件。

1. 实际首页是`pages/egg_show/egg_show`；APK内同时残留四轮汽车秤页面，不能以某个汽车页逻辑代表默认单秤入口。
2. 自动匹配首台`WEIGHT_`，停止扫描后800ms连接，连接成功后1100ms取服务，notify成功后500ms发送`AA05020800011901`。额外包按文档TTL格式解释的目的/源地址与单秤命令不同，整包XOR为0xBC，开源TTL接收器要求0；不能断定它就是必需的“开启上报”。目前没有厂家说明或对应交付固件证据。
3. **厂家原生壳**在发起discoverServices后立即返回连接成功，onServicesDiscovered为空；**本台CRM原生壳**正常情况下等待该回调（发起失败另有回退）。1100ms延迟可能弥补厂家壳时序，不能直接认定为CRM缺失根因。
4. 两份原生壳的notify均调用setCharacteristicNotification和writeDescriptor，但返回success不等待onDescriptorWrite完成，故通知订阅成功不代表设备已经推送有效帧。
5. 默认单秤接收19字节方法6（克）和23字节方法34（毫克）；20+3分包、46字节粘包会被丢弃。仅检查通知长度/AA/方法，未校验XOR、来源设备/特征、目的源地址和声明长度；回放确认坏帧及其他来源通知能覆盖读数。
6. **无真实数据时，初始9999.9999克缓存在默认kg/一位小数下显示10.0kg。**断线10秒仍显示旧150.0kg。厂家App“有数字”不足以验证通信正常，必须随加卸已知重量变化。
7. 原`get_uint64_t`使用Number位移56/48/40/32，实际按32位位移处理：3000kg→-1294.967296kg；-1kg原始结果多偏1mg。此算法不可复制。
8. 归零`AA010308A6010700`、500克质量标定`AA01030C5D050900000001F4`与CRM一致。厂家单秤页未定义wheel_select，位操作隐式转成通道0。
9. 单秤标定函数无质量边界保护，直接调用时0、非法文本、4294967296克均编码为0质量；没有设备回执、空秤/砝码复核或持久待核锁。blue_send调用后立刻返回true，原生写入失败仅日志，不等于实际写入/校准成功。
10. 每次扫描再次注册发现监听，10轮扫描出现10次注册；断开后500ms延迟包仍尝试发送；断开调用closeBluetoothAdapter。单秤100ms刷新且逐帧转hex/日志，不是可直接套进CRM的轻量会话实现。

## 对CRM与现场测试的含义

1.0.60已有的分包/XOR/来源过滤、负值候选、3秒时效、有限采样和校准待核不能照厂家实现删去。归零字节相同，当前优先查真实通知链路，不随意更改归零格式。额外0x19包、通知描述符写入状态与交付固件需进一步取证；本次未擅自加未知控制报文。

建议用户结束当前复秤并退出CRM地秤连接后，打开厂家App授权并连接，先观察空秤→加已知重量→移走是否连续跟随，不必先归零/标定。若厂家正确跟随而CRM无数据，再对照同一设备的原始通知/通信详情。现在仍未取得现场原始帧，不能认定真实根因或计量精度通过。

证据目录：`outputs/trust-audit/2026-11-02-vendor-scale-app/`；[完整报告](../../outputs/trust-audit/2026-11-02-vendor-scale-app/厂家称重App深度剖析.html)、`replay.cjs`/`replay-results.json`、`app-service.readable.js`、两份`native-ble-excerpts.txt`、`installation-and-scope.json`。这些原始提取物留在本地证据目录，不随CRM发布。

规范依据：[ECMAScript Number::leftShift](https://tc39.es/ecma262/2023/multipage/ecmascript-data-types-and-values.html#sec-numeric-types-number-leftShift)、[Android蓝牙权限](https://developer.android.com/develop/connectivity/bluetooth/bt-permissions)。未做厂家全部原生SDK/网络行为安全审计，也未进行实物称重或校准验收。


## 后续现场反馈：换电源后出数，前台约90秒断连

用户确认已停用移动电源，换电源后新拓能源App能出读数，但始终亮屏前台约1分30秒断连。不能再把“始终无数据”作为唯一现状；未证明此前只有软件或供电一种原因。

当前地秤代码没有90秒断连定时器，3秒数据过期只失效读数、不主动关闭BLE；页面隐藏会stop，但用户明确本次在前台。只读日志捕获到一次`Connection Failed Establishment / GATT_ERROR(133)`，不足以解释已连接约90秒后的第一次断线；随后USB设备已离线，未取得完整连接至断开过程。证据`outputs/trust-audit/2026-11-02-floor-disconnect/field-note.json`与`ble-log.txt`。

用户提供的Modbus截图在DSX手册续表有分度值0x0014、小数点0x0015、采样0x0011、滤波0x0016；数码管显示板E0也列有分度档位。CRM当前仅固定三位小数，没有地秤分度设置，不代表1克计量精度。当前蓝牙使用AA/XOR报文，不能直接发送Modbus写寄存器；同资料包开源固件使用另一套寄存器地址，须核对交付固件及参数通道后再写。

丢包需要区分原始通知、完整有效帧、校验失败及界面250ms合并刷新；没有已验证序号/采样时钟语义，不能据通知计数声称准确丢包率。延迟分传感器采样/滤波、UART/BLE、解析及显示测量，不用降低判稳保护掩盖。下一步保持USB连接，由用户正常复现，先记录真实断线原因与数据间隔；本次没有改参数、发设备控制或发布新版本。

## 现场只读采样：2026-11-02 12:42—12:47（UTC+8）

用户要求开始后，USB恢复，确认CRM进程12132前台；用户自行连接，随后反馈“多次失败之后，连接成功”。只读ADB采集，无点击、重启、蓝牙开关或设备参数写入。日志采集已结束，未主动断开地秤。

- 12:42:46.558系统连接回调，12:42:48.424服务发现完成，48.455订阅通知，49.069/49.070收到两次ATT通知；54.091底层报告`GATT_CONN_TIMEOUT`及`Connection Timeout`，54.093应用原生回调后才close。该次是底层链路超时，不能归因于3秒读数过期或App主动定时断开；仍不能判定地秤硬件、无线环境或PDA控制器的具体责任。原因来自当轮补读logcat工具回执；后开`live-reasons.log`未覆盖这条旧事件。
- 随后12:42:55、12:43:04、12:43:14重连均约6秒取消；系统CRM注册客户端从采样前5/6两个增至5—10六个（含随后有效连接）。本台原生DEX确认`closeBLEConnection`和连接超时`execute`仅调用`disconnect()`，`close()`依赖连接状态回调；`createGatt`按设备地址直接覆盖。这是失败重连后的原生资源清理风险，尚未完成修复，不把它宣称为前述链路超时根因。
- 最后12:44:28.344连接成功，12:44:29.698—12:47:34.052持续观察184.354秒，共2997条系统ATT通知事件，未见该段断开/清理事件。通知间隔P95为209ms，最大3357ms，超过1秒8次，其中超过3秒1次。通知日志不是完整重量帧，不构成精确丢包率、端到端延迟或计量准确性验收；3.357秒空档已超过现有3秒读数时效，但未同步观测当时UI提示。
- 后段连接参数日志为interval=56、latency=5、timeout=400；保留原值，不主动改参数。前一次断线参数timeout=500。Bluetooth规范timeout单位10ms，分别为4秒/5秒链路监督超时，与已连接总时长不是一回事。

本轮原始证据：`outputs/trust-audit/2026-11-02-floor-disconnect/live-session.log`、`live-reasons.log`、`bluetooth-after-retries.txt`、`summarize-live.py`与`live-summary.json`。前一段链路原因及原生资源缺口需继续核对；下一现场比较是相同供电/位置下厂家App的连接持续性与通知间隔，不能以本次3分钟未断认定已修复。未改运行代码、未发版本；实际WGT版本本轮未重新核实。

规范参考：[Bluetooth Link Layer](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/Core-61/out/en/low-energy-controller/link-layer-specification.html)。

### 同一连接再次断开：13:15:44（UTC+8）

用户报告“刚问完就断开”，立即只读回取日志及蓝牙快照。系统连接事件保留12:44:28.332连接、13:15:44.855断开，间隔31分16.523秒，证明该次不是固定90秒断线。末次ATT通知13:15:40.800，约4.055秒后底层再次明确`GATT_CONN_TIMEOUT / Connection Timeout`，与此前该连接timeout=400的参数一致。活跃clientIf=10随后注销，旧5—9仍注册。不能从链路超时直接推断射频干扰、供电或设备固件中的具体根因，也不能把重复att_id日志当成多次物理断线。

证据：同目录`second-disconnect.log`、`second-disconnect-state.txt`。此前“3分钟未断”仅为当时观察窗口，现已被本次后续故障补充；未改运行代码或地秤参数。下一步仍需同位置/供电下厂家App对照，以及原生失败重连释放的修复验证。

### 厂家App隔窗与室外对照：13:20—13:58

同供电、原位置下，厂家App于13:20:28.726连接、13:33:46.344出现相同链路超时，持续13分17.618秒；用户确认实际加卸物品时读数变化。13386条ATT通知，最大间隔3710ms，末次通知后4060ms断线。用户随后说明原位置约2米隔窗：PDA在室内桌上、模块在室外地面且外露。

只将PDA移至室外、距模块约1米无遮挡，仍用厂家App；13:43:08.269连接至13:58:37.797采集主动结束，共15分29.528秒未断连。18571条ATT通知，最大间隔210ms、P95为70ms，无超过1秒停顿。用户再次确认是同一台PDA且读数实时变化。两轮均为interval=56、latency=5、timeout=400。对照支持位置/传播环境影响明显，不能确定窗户是唯一根因，也不能把有限窗口当长期稳定或精确丢包率证明。

证据为同目录`vendor-comparison.log`、`vendor-comparison-summary.json`、`vendor-outdoor.log`、`vendor-outdoor-summary.json`；两轮采集均已停止。CRM原生资源残留修复、APK打包与待验收状态统一见[原生修复交接](2026-11-02-floor-native-gatt.md)。
