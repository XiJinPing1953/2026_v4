
使用前请先阅读下面说明：

使用哪个SDK需要根据实际需求，把 uniPluginTest\lib 目录下对应模块的SDK放到   uniPluginTest\nativeplugins\TH-PlatformSDK\android\ 目录，然后自定义基座，即可以使用对应的模块功能。

###一定要先制作自定义基座；
###一定要先制作自定义基座；
###一定要先制作自定义基座；
### 如果不清楚如何自定义调试基座，可参考文档： 《HBuilderX自定义基座说明.doc》 。


一. UniPluginScanSDK-xxx.aar  基础SDK(包含扫描头、设备管理接口)
功能说明：
1.获取SN；
2.扫码功能；
3.打印（仅限POS机）。
4.刷卡（仅限POS机）；
5.插卡（仅限POS机）；
6.挥卡（仅限POS机）。

二. UniPluginRFIDSDK-xxx.aar  RFID-SDK
功能说明：
1.UHF超高频功能，读取RFID标签；
 

三.UniPluginNfcIDSDK-xxx.aar  NFC软解身份证（使用前需要发SN号给我们授权绑定）
1.PDA通过标准NFC读取身份证功能，每次读取都需要联网。

四.UniPluginPDA-POSIDSDK-xxx.aar  PDA&POS 硬解身份证模块
1.需要装背部身份证硬解模块来支持读取身份证，离线读取。


注意:二、三、四模块，目前不能同时加载使用，所以不要同时把它们放到 android\ 目录去制作自定义基座。


五.UniPluginBLEPrintSDK-xxx.aar   
1.便携式蓝牙打印机通过android原生SDK的方式打印（非JS代码连接蓝牙及打印）