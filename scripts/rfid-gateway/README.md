# RFID TCP Gateway

4G UHF 读写器主动模式网关。网关监听公网 TCP 端口，接收 4G 模块透传的原始 Modbus/RFID 数据，解析 EPC，在本地控制台输出 JSON 行，并可在会话结束后上传到支付宝云。

## 设备链路

```text
4G RFID 模块 -> ECS TCP 8063 -> scripts/rfid-gateway -> 控制台 JSON 日志 -> 支付宝云 crm-rfid-gateway
```

4G 模块建议配置：

```text
工作模式：TCP/UDP 透传
连接类型：TCP
目标地址：47.94.226.70
目标端口：8063
心跳内容：00
心跳格式：HEX
心跳间隔：60 秒
```

RFID 读写器建议配置：

```text
模式：主动模式
设备地址码：0001
功率：先从 16-18 dBm 试起，再按现场误读/漏读调整
```

## 运行

```bash
cd /path/to/2026_v4
cp scripts/rfid-gateway/.env.example scripts/rfid-gateway/.env
node scripts/rfid-gateway/index.cjs
```

或直接指定端口：

```bash
node scripts/rfid-gateway/index.cjs --host 0.0.0.0 --port 8063
```

ECS 安全组需要放行：

```text
入方向 TCP 8063 0.0.0.0/0
```

## 环境变量

```text
RFID_GATEWAY_HOST=0.0.0.0
RFID_GATEWAY_PORT=8063
RFID_SESSION_WINDOW_MS=15000
RFID_DEDUP_MS=1000
RFID_LOG_LEVEL=info
RFID_GATEWAY_ID=rfid-gate-main
RFID_CLOUD_UPLOAD_ENABLED=false
RFID_CLOUD_URL=
RFID_CLOUD_PASSWORD=
RFID_CLOUD_GATEWAY_ID=rfid-gate-main
```

## 输出事件

每行都是一个 JSON 文档，便于后续接 `systemd/journalctl`、日志采集或云端上报。

```text
rfid_connection       连接、监听、关闭、退出
rfid_heartbeat        4G 模块心跳 00
rfid_tag_seen         读到一张标签
rfid_session_summary  一个车辆盘点窗口结束
rfid_frame_ignored    调试/控制帧过滤
rfid_parse_error      CRC 错误、未知帧等
rfid_cloud_upload_ok  会话已上传到支付宝云
rfid_cloud_upload_failed  会话上传失败，本地日志仍保留
```

## 标签帧解析

支持主动/触发模式的 Modbus 上报帧：

```text
01 10 03 E8 00 07 0E 00 01 E2 80 68 94 00 00 50 1B E7 85 04 D8 75 C2
```

解析为：

```text
reader_device_code = 0001
epc = E28068940000501BE78504D8
```

网关按 TCP 流解析，支持粘包和半包。调试工具发出的 `55...`、`22...`、`A0...` 帧会输出为 `rfid_frame_ignored`。

## XT EPC 规则

车辆和瓶子标签使用 96-bit EPC，格式固定为 12 字节：

```text
58 54      XT
01         版本
01/02      01=瓶子，02=车辆
6 bytes    序列号
2 bytes    CRC16(Modbus, little-endian)
```

示例：

```text
车辆 #1:    585401020000000000011FA3
瓶子 #135: 58540101000000000087AD01
```

非 XT EPC 不丢弃，标记为 `unknown_epc`。

## 写标验收

第一轮现场验收使用厂家 UHF Demo 工具手动写 EPC，详细步骤见：

```text
scripts/rfid-gateway/WRITE_TAG_ACCEPTANCE.md
```

生成或校验 XT EPC：

```bash
node scripts/rfid-gateway/issue-tags.cjs
node scripts/rfid-gateway/issue-tags.cjs --type vehicle --serial 1
node scripts/rfid-gateway/issue-tags.cjs --validate 585401020000000000011FA3
```

## 会话逻辑

- 读到车辆 EPC 后开启车辆盘点窗口，默认 15 秒。
- 窗口内读到的瓶子 EPC 自动归入该车辆会话。
- 同一 EPC 在 `RFID_DEDUP_MS` 内重复读取时标记 `deduped=true`，会话中只保留一条记录并累计 `read_count`。
- 如果同一窗口读到多个车辆 EPC，summary 标记 `vehicle_conflict=true`。
- 如果瓶子先于车辆被读到，网关会临时保留最近 15 秒的待归属标签；随后读到车辆 EPC 时自动并入该会话。

## 云端上传

默认只写本地日志，不上传云端。部署 `crm-rfid-gateway` 云函数并开启 URL 化后，再在 ECS 的 `.env` 中配置：

```bash
node scripts/generateRfidGatewayPasswordHash.cjs "your-rfid-gateway-password"
```

将输出写入 `crm-rfid-gateway` 云函数环境变量 `RFID_GATEWAY_PASSWORD_HASH`，同时配置 `RFID_GATEWAY_TOKEN_SECRET`。

```text
RFID_CLOUD_UPLOAD_ENABLED=true
RFID_CLOUD_URL=https://你的云函数URL
RFID_CLOUD_PASSWORD=你的RFID网关专用密码
RFID_CLOUD_GATEWAY_ID=rfid-gate-main
```

云函数使用 `loginV1` 换取短期 token，再调用 `ingestSessionV1` 上传 `rfid_session_summary`。上传失败不会影响 TCP 收卡和本地 `journalctl` 日志。

## 测试

```bash
node scripts/rfid-gateway/test.cjs
node scripts/rfid-gateway/test-cloud-upload.cjs
node --check scripts/rfid-gateway/protocol.cjs
node --check scripts/rfid-gateway/index.cjs
```

## CRM 查看

上传成功后，CRM 的 `RFID 门口盘点` 页面可查看会话。当前版本只做入库和查看，不自动生成销售单，也不修改瓶子流转状态。
