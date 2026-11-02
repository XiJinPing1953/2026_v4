# 地秤独立 GATT 连接

实际 PDA 的 DCloud BLE 原生超时只 disconnect，close 依赖后续回调，连续失败后注册客户端残留。该库只持有地秤自己的 BluetoothGatt，不关闭共享适配器，不接管吊秤、扫描或打印。

- 连接、发现、订阅、写入在主线程串行；连接对象按 attempt 归属，关闭先释放再报告。
- 连接/订阅/写入各有6秒原生截止；释放直接调用close，不等待设备回应。校准指令不自动重发。
- CCCD写入成功后才确认订阅；旧attempt回调无效。Activity销毁兜底释放，已销毁页面不能重连。
- 通知队列最多128份、每份最多512字节；超限明确结束该地秤连接，避免丢掉中间分片后继续拼帧。接收时间在原生回调捕获，桥延迟不能刷新旧数据时效。
- 释放失败在进程内禁止再开地秤连接，防止退出页面后继续累积；不影响其他蓝牙客户端。

运行 `python3 scripts/buildFloorScaleNative.py` 编译Java8/Android34兼容AAR并执行所有权故障测试。可用FLOOR_JAVA_HOME/FLOOR_ANDROID_JAR指定工具位置。构建确定性产物位于`nativeplugins/TH-PlatformSDK/android/XintuoFloorScale-1.aar`，作为现有本地插件的附加依赖；不改厂家AAR或模块注册。Native.js使用公开Listener接口，混淆保留规则随AAR提供。

`python3 scripts/testFloorScaleNative.py` 直接编译生产驱动并以Android边界桩回放17组生命周期/超时/队列/校准故障；测试桩及测试类仅进入临时目录，不进入AAR。

必须重新打APK；旧APK不能靠WGT增加Java类，桥会明确提示安装新版，不回退到原失败连接路径。版本、签名、DEX类、云空间初始化必须在APK中核验。代码与模拟测试通过不代表Native.js真机回调、长连、客户端归零及计量精度已通过。
