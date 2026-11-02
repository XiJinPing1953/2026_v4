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
