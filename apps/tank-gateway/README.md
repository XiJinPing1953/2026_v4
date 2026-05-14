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
192.168.0.10 / 255.255.255.0，无网关，用于访问 PLC
```

测试：

```bat
ping 192.168.0.1
powershell Test-NetConnection 192.168.0.1 -Port 102
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
192.168.0.1:102
rack=0
slot=1
levelAddress=DB1,REAL2000
pressureAddress=DB1,REAL2040
fullLevelM=10
pollMs=5000
```
