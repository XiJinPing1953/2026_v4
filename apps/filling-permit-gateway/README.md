# 新拓充装许可网关

这是独立于 `apps/tank-gateway` 的 Windows Electron 应用。它作为 Modbus TCP Server 接收 TPC7022Ei 的瓶号请求，通过独立 URL 化云函数查询气瓶并完成云端审计，再把结果返回 HMI。它不直接连接西门子 PLC。

## 本地运行

```bash
npm run filling:permit:gateway:test
npm run filling:permit:gateway:gui
```

Windows 安装包：

```bash
npm run filling:permit:gateway:dist:win
```

安装包输出到 `release/filling-permit-gateway/`。

## 安全约束

- 允许结果必须同时具有云端审计确认和本地刷盘成功记录。
- 密码仅保存到 Windows Credential Vault；不可用时才使用 Electron `safeStorage`。
- 网关停止、重启、端口故障、本地磁盘故障、云端超时、鉴权失败或内部异常时，`allow_fill_raw` 保持 `0`。
- 审计文件位于 `%APPDATA%\XintuoFillingPermitGateway\audits`。
- 生产机只允许 TPC7022Ei 的专网 IP 访问 TCP 502。

完整部署、HMI 变量与 ST20 联锁说明见 `docs/filling_permit_gateway_v1.md`。
