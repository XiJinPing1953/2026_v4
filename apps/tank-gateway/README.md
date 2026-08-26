# 新拓储罐网关

## 云端配置

1. 生成网关密码 hash：

```bash
node scripts/generateTankGatewayPasswordHash.cjs "your-password"
```

2. 在 `crm-tank-gateway` 云函数环境变量中配置：

```text
TANK_GATEWAY_PASSWORD_HASH=<上一步输出>
TANK_GATEWAY_TOKEN_SECRET=<随机长字符串>
```

3. 部署 `crm-tank-gateway`，在 uniCloud/HBuilderX 控制台开启云函数 URL 化，并把 URL 填入 GUI。

## Windows 网络

Windows 有线网卡建议同时配置两个 IPv4：

```text
192.168.31.x / 255.255.255.0，网关 192.168.31.1，用于上网
192.168.2.10 / 255.255.255.0，无网关，用于访问 PLC
```

测试：

```bat
ping 192.168.2.1
powershell Test-NetConnection 192.168.2.1 -Port 102
```

## 开发与打包

Windows 构建机先安装依赖：

```bash
npm install
```

开发运行：

```bash
npm run tank:gateway:gui
```

Windows 安装包：

```bash
npm run tank:gateway:dist:win
```

默认 PLC 配置：

```text
192.168.2.1:102
rack=0
slot=1
levelAddress=DB1,REAL100       # PLC VD100，储罐液位 kPa
pressureAddress=DB1,REAL104    # PLC VD104，储罐压力 MPa
weightAddress=DB1,REAL140      # PLC VD140，LNG 重量 t
levelReferenceKpa=35.60
levelReferencePercent=72
pollMs=5000
```

液位百分比按现场屏幕标定值计算：`当前液位 kPa / 35.60 * 72`，结果限制在 `0% ~ 100%`。

## 1.0.1 升级说明

- 修复旧配置把“储罐液位”和“LNG 重量”同时保存为 `DB1,REAL140` 的问题。
- 安装升级后会保留云端 URL 和系统凭据，并自动把该已知错误修复为 `DB1,REAL100`。
- 保存、探测和启动前会检查三个 PLC 地址；任意两个地址相同都会停止采集并提示具体冲突。
- 单次探测成功后，运行日志会同时显示三个地址和对应读数，便于与一体机逐项核对。

## 第二屏与声音辅助报警

- 连接第二块显示器后，网关启动时会自动打开全屏监控屏；也可以在主界面点击“打开监控屏”。
- 没有第二块屏幕时，按钮会打开窗口预览。
- 监控屏显示液位百分比、液位信号、压力、LNG 重量、采集时间和通信状态。
- 声音报警通过 Windows 音频输出播放，不需要继电器板。主界面和监控屏都可以测试声音。
- 监控屏的“静音”只停止本屏声音；“确认报警”表示人工已看到，报警横幅和读数继续保留。液位/压力恢复正常后自动复位，不能手动隐藏仍处于超限状态的报警。
- 液位报警按 `kPa` 数值填写低低限、低限、高限、高高限；压力报警按 `MPa` 数值填写低低限、低限、高限、高高限。四级阈值彼此独立，留空表示不启用该项，通信中断报警默认启用。
- 主界面按一体机参数表分别展示液位和压力：当前值、测量范围上限/下限、修正值、报警高高限/高限/低限/低低限和报警功能。
- 液位百分比只用于监控画面的填充显示，不参与液位报警判断。修正值只用于网关本地报警比较和参数表当前值显示，PLC 原始读数和云端上报数据不修改。
- 连续超限时间用于防止瞬时波动误报警。声音报警是辅助提醒，不能替代 PLC 或独立安全系统的报警联锁。
