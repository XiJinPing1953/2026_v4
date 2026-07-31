# 充装许可网关 V1 交付与投运说明

## 1. 交付边界

本次新增独立的“新拓充装许可网关”，现有储罐网关未修改。固定数据流为：

`TPC7022Ei → Modbus TCP → Windows 网关 → HTTPS URL 化云函数 → crm_bottles / crm_filling_permit_audits`

HMI 再通过现有 SMART200 驱动把最终许可和心跳写入 S7-200 SMART ST20。Windows 网关不直接连接 PLC，也不能绕过 PLC 原有急停、压力和设备联锁。

代码入口：

- Electron：`apps/filling-permit-gateway/`
- 状态机与 Modbus：`scripts/fillingPermitCore.cjs`
- 云函数：`uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway/`
- 审计 schema：`uniCloud-alipay/database/crm_filling_permit_audits.schema.json`
- HMI 变量 CSV：`docs/tpc7022ei_filling_permit_variables.csv`
- 自动测试：`scripts/filling-permit-gateway/*.test.cjs`

在现场确认两个非保持 V 区地址之前，禁止把新许可接入正式充装联锁。

## 2. 安装与云端配置

### 2.1 云函数

上传 `crm-filling-permit-gateway` 为独立 URL 化云函数，配置以下环境变量：

- `FILLING_PERMIT_GATEWAY_PASSWORD_HASH`：独立口令的 PBKDF2-SHA256 哈希。
- `FILLING_PERMIT_GATEWAY_TOKEN_SECRET`：独立随机令牌密钥，至少 32 字节，不与储罐网关共用。
- `FILLING_PERMIT_GATEWAY_TOKEN_TTL_MS`：可选，默认 30 天。

生成密码哈希：

```bash
npm run filling:permit:password -- "现场独立密码"
```

云函数 action：

- `healthV1`：服务时间、协议版本和配置状态。
- `loginV1`：独立口令换取 HMAC 令牌。
- `checkPermitV1`：唯一查询气瓶、判定并写审计；审计成功后才返回允许。
- `syncAuditV1`：按 `request_id` 幂等补传本地系统禁止记录，只接受 `allowed=false` 且 `outcome=system_denied`。

上传 `crm_filling_permit_audits` schema 后，必须在云端确认 `uniq_request_id` 唯一索引已经建立。

### 2.2 Windows 网关

安装后填写：云函数 URL、网关 ID、专网监听 IP、端口 502、Unit ID 1、查询超时 5000 ms。登录并保存密码后再启动。密码进入 Windows Credential Vault；只有系统不支持 keytar 时才回退到 Electron `safeStorage`。

本地文件：

- 配置：`%APPDATA%\XintuoFillingPermitGateway\config.json`
- 审计：`%APPDATA%\XintuoFillingPermitGateway\audits\permit-audit-YYYY-MM-DD.jsonl`
- 补传队列：`%APPDATA%\XintuoFillingPermitGateway\audits\pending-audits.jsonl`

构建命令：

```bash
npm run filling:permit:gateway:test
npm run filling:permit:gateway:dist:win
```

## 3. Modbus TCP 约定

网关为 Server，默认监听专网 IP 的 TCP 502，Unit ID 1。HMI 使用 FC03 读取，FC06/FC16 写入。下表 PDU 地址从 0 开始，McgsPro 通道从 `4WUB0001` 开始：

| PDU | McgsPro | 名称 | 访问 | 含义 |
|---:|---|---|---|---|
| 0 | `4WUB0001` | `GatewayProtocolVersion` | R | 固定 1 |
| 1 | `4WUB0002` | `GatewayBootId` | R | 每次网关启动生成非零值 |
| 2 | `4WUB0003` | `RequestBootId` | W | 提交时复制 boot ID |
| 3 | `4WUB0004` | `RequestSeq` | W | 最后单独写入，作为提交标志 |
| 4 | `4WUB0005` | `BottleLength` | W | 1–16 |
| 5–20 | `4WUB0006–0021` | `BottleChar01–16` | W | 每字一个大写 ASCII，剩余填 0 |
| 21 | `4WUB0022` | `ResponseBootId` | R | 响应 boot ID |
| 22 | `4WUB0023` | `ResponseSeq` | R | 最后写入，作为响应完成标志 |
| 23 | `4WUB0024` | `ResultStatus` | R | 0空闲、1处理中、2允许、3业务禁止、4系统禁止 |
| 24 | `4WUB0025` | `AllowFillRaw` | R | 0禁止、1允许 |
| 25 | `4WUB0026` | `ReasonCode` | R | 中文主原因码 |
| 26–27 | `4WUB0027–0028` | `DetailMaskLow/High` | R | 32位完整失败位图 |
| 28 | `4WUB0029` | `GatewayState` | R | 0停止、1启动、2就绪、3忙、4降级、5故障 |
| 29 | `4WUB0030` | `FaultCode` | R | 网关故障码 |
| 30 | `4WUB0031` | `GatewayHeartbeat` | R | 每秒递增，允许 65535→0 回绕 |
| 31 | `4WUB0032` | `LatencyMs` | R | 查询耗时，最大 65535 |

输出寄存器为只读，HMI 尝试写入会收到 Modbus 异常码 02。`ResponseSeq` 始终最后提交。收到有效新序号时，网关在访问云端之前先把许可清零并置为处理中。

### 3.1 提交顺序

1. 立即把 HMI 内部 `FillPermitOk` 清零、`PermitNeedsRequery` 置 1。
2. 把瓶号转为大写，拒绝空格和非 ASCII 字符；长度必须 1–16。
3. 先写 `BottleLength` 和全部 16 个字符字，再写 `RequestBootId=GatewayBootId`。
4. 等待至少两个 200 ms 采集周期。
5. 递增非零 `RequestSeq`，用 FC06 最后单独写 `RequestSeq`。从 65535 回绕时跳过 0，回到 1。
6. 只在响应 boot 与 seq 同时匹配时使用结果；编辑瓶号、重连或任何通讯故障都会使旧响应失效。

禁止用一个从地址 2 开始的 FC16 把 boot、seq 和瓶号一起写入，因为地址 3 的 seq 会先于瓶号成为提交标志。

## 4. McgsPro 设备与脚本模板

新增“通用 TCP/IP 父设备（客户端）+ 莫迪康 ModbusTCPIP”，远端地址为 Windows 网关专网 IP，端口 502，设备地址 1，采集周期 200 ms。不要改动现有 SMART200 设备。

变量按 `docs/tpc7022ei_filling_permit_variables.csv` 建立。以下是 McgsPro 脚本逻辑模板；对象名可按工程规范加前缀，但寄存器和执行顺序不能改变。

### 4.1 拆分瓶号

```text
BottleLength = !Len(BottleInput)
BottleChar01 = !Ascii2I(!Mid(BottleInput, 1, 1))
BottleChar02 = !Ascii2I(!Mid(BottleInput, 2, 1))
...
BottleChar16 = !Ascii2I(!Mid(BottleInput, 16, 1))
```

实现时对 `index > BottleLength` 的字符字明确写 0。输入框限制为大写 `A–Z`、数字 `0–9`、`_`、`-`，并在提交前检查长度。网关仍会二次规范化和校验。

### 4.2 提交按钮

```text
FillPermitOk = 0
PermitNeedsRequery = 1
RequestBootId = GatewayBootId

PendingRequestSeq = RequestSeq + 1
IF PendingRequestSeq > 65535 OR PendingRequestSeq = 0 THEN PendingRequestSeq = 1

SubmitTicks = 0
SubmitStage = 1
```

200 ms 循环脚本：

```text
IF SubmitStage = 1 THEN
  SubmitTicks = SubmitTicks + 1
  IF SubmitTicks >= 2 THEN
    RequestSeq = PendingRequestSeq
    SubmitStage = 0
  ENDIF
ENDIF
```

### 4.3 心跳和最终 HMI 许可

每个 200 ms 周期先更新心跳状态：

```text
IF NOT HmiGatewayCommOk THEN
  HeartbeatStaleMs = 3000
ELSEIF GatewayHeartbeat <> LastGatewayHeartbeat THEN
  LastGatewayHeartbeat = GatewayHeartbeat
  HeartbeatStaleMs = 0
ELSE
  HeartbeatStaleMs = HeartbeatStaleMs + 200
ENDIF
```

`FillPermitOk` 只能由下面完整条件计算，不能手工置 1：

```text
FillPermitOk =
  (PermitNeedsRequery = 0) AND
  HmiGatewayCommOk AND HmiPlcCommOk AND
  (HeartbeatStaleMs < 3000) AND
  (RequestBootId = GatewayBootId) AND
  (ResponseBootId = RequestBootId) AND
  (ResponseSeq = RequestSeq) AND
  (ResultStatus = 2) AND
  (AllowFillRaw = 1) AND
  (GatewayState = 2) AND
  (FaultCode = 0)
```

收到当前请求完整响应后，如果 boot/seq 匹配且 `ResultStatus` 已进入 2、3 或 4，再将 `PermitNeedsRequery=0`；允许或业务禁止都表示本次查询已完成。这个清零动作必须与“本次新请求已完成”事件绑定，不能仅因通讯恢复而执行。

以下事件必须立即执行同一个失效脚本：瓶号编辑、提交新请求、`ResultStatus=1`、HMI—网关通讯故障、HMI—PLC 通讯故障、网关 boot 改变、设备重新连接、HMI 启动。

```text
FillPermitOk = 0
PermitNeedsRequery = 1
SubmitStage = 0
```

HMI 用现有 SMART200 驱动周期写：

- `HMI_FillPermitCmd = FillPermitOk`
- `HMI_FillPermitHeartbeat = GatewayHeartbeat`

网关心跳失效时不要生成替代心跳；保持旧值，让 PLC 看门狗在 3 秒内清零。

## 5. 中文原因映射

| 码 | HMI 中文 |
|---:|---|
| 0 | 允许充装 |
| 10 | 瓶号输入无效 |
| 11 | 未找到气瓶 |
| 12 | 气瓶已停用 |
| 13 | 气瓶已报废 |
| 14 | 气瓶已丢失 |
| 15 | 气瓶状态异常 |
| 16 | 瓶号主档不唯一 |
| 20 | 钢瓶检验日期缺失或无效 |
| 21 | 钢瓶检验已到提前禁用期 |
| 30 | 压力表检验日期缺失或无效 |
| 31 | 压力表检验已到提前禁用期 |
| 40 | 安全阀检验日期缺失或无效 |
| 41 | 安全阀检验已到提前禁用期 |
| 90 | 云端超时或网络故障 |
| 92 | 数据库故障 |
| 93 | 网关鉴权失败 |
| 94 | 云端审计写入失败 |
| 95 | 网关内部异常 |
| 96 | 本地审计写入失败 |
| 97 | 协议或启动标识异常 |
| 98 | 网关尚未就绪 |
| 99 | 网关忙或请求并发 |

32 位明细位图：bit0 输入无效、bit1 未找到、bit2 不唯一、bit3 状态非法、bit4 停用、bit5 报废、bit6 丢失、bit7 钢瓶日期无效、bit8 钢瓶提前禁用、bit9 压力表日期无效、bit10 压力表提前禁用、bit11 安全阀日期无效、bit12 安全阀提前禁用、bit13 网络/超时、bit14 数据库、bit15 鉴权、bit16 云审计、bit17 内部异常、bit18 本地审计、bit19 协议、bit20 并发、bit21 未就绪。

网关故障码：0 无故障、1 云端不可用、2 鉴权、3 本地审计、4 Modbus、5 内部、6 端口占用。

## 6. ST20 地址与梯形图逻辑

在 STEP 7-Micro/WIN SMART 中先做 V 区交叉引用，再分配：

| PLC 符号 | 类型 | 地址 |
|---|---|---|
| `HMI_FillPermitCmd` | BOOL | `<现场分配未占用、非保持 Vx.y>` |
| `HMI_FillPermitHeartbeat` | WORD/UINT | `<现场分配未占用、非保持 VWn，建议偶地址>` |
| `FillPermitCommOk` | BOOL | PLC 内部位 |
| `FillPermitFinal` | BOOL | PLC 内部位 |
| `LastPermitHeartbeat` | WORD/UINT | PLC 内部字 |
| `PermitHeartbeatChanged` | BOOL | PLC 内部单扫描脉冲 |
| `PermitWatchdog3s` | TON | 3 秒非保持看门狗 |

许可相关 V 区必须从 CPU 的掉电保持范围中排除；下载前在系统块/保持范围设置中复核。

梯形图网络顺序：

1. 首次扫描位接通时，复位 `FillPermitCommOk` 和 `FillPermitFinal`，把当前 `HMI_FillPermitHeartbeat` 复制到 `LastPermitHeartbeat`。
2. 在更新旧值之前比较两个心跳字，生成 `PermitHeartbeatChanged` 单扫描脉冲。
3. 脉冲为 1 时，复制新心跳到 `LastPermitHeartbeat`，置位 `FillPermitCommOk`。
4. `PermitWatchdog3s` 的输入为 `FillPermitCommOk AND NOT PermitHeartbeatChanged`。每次心跳变化都会让 TON 输入断开一个扫描周期并复位计时。
5. TON 到时后复位 `FillPermitCommOk`。
6. 每个扫描周期执行 `FillPermitFinal = HMI_FillPermitCmd AND FillPermitCommOk`。
7. 现有充装启动条件只追加 `AND FillPermitFinal`。PLC 全程序禁止直接使用 `HMI_FillPermitCmd` 控制充装。

不要把 `FillPermitFinal` 并联到原有条件上；它不能绕过急停、压力、阀门、设备状态或其他既有安全回路。

## 7. 判定和审计

气瓶必须按规范化瓶号唯一查到、`is_active===true`、状态属于 `unknown/in_station/at_customer/scrapped/lost`，且不能是 `scrapped` 或 `lost`。钢瓶、压力表、安全阀三个“下次检验日期”必须为真实 `YYYY-MM-DD`。

日期按北京时间自然日计算。到期日在昨天、今天或明天都禁止；至少后天才允许。V1 不判断报废期限、仪表编号/量程、安全阀数量、站点和介质。

每个请求先 `fsync` 写本地日 JSONL。云端以 `request_id` 唯一幂等；允许结果必须在云端审计插入成功且本地结果记录再次刷盘成功之后才提交到 `ResponseSeq`。故障期间的本地系统禁止进入追加式补传队列，成功补传后写入 synced 墓碑，不覆盖原记录。

## 8. 网络与现场验收

建议双网卡或双 IPv4：自动化专网只连接 HMI，外网只访问 HTTPS 云函数。固定 HMI 和网关专网地址。在管理员 PowerShell 中按实际地址建立仅限 HMI 的入站规则：

```powershell
New-NetFirewallRule -DisplayName "Xintuo Filling Permit Modbus" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 502 -LocalAddress <网关专网IP> -RemoteAddress <TPC7022Ei_IP>
```

确认 Windows 防火墙默认阻止其他入站来源，不要把 TCP 502 暴露到办公网或互联网。

投运验收顺序：

1. 对不存在、停用、报废、丢失、日期缺失、昨天/今天/明天/后天及多项失败气瓶逐项测试。
2. 断开 HMI—网关网线、互联网、HMI—PLC 通讯，并分别关闭网关和 HMI；每次观察 `FillPermitFinal` 在 3 秒内清零。
3. 恢复通讯后确认旧允许不自动恢复，必须重新提交、成功审计后才再次置位。
4. 模拟云端 401、HTTP 故障、数据库/审计失败、本地磁盘不可写和端口占用，确认 `AllowFillRaw=0`。
5. 检查每个请求的本地 JSONL；允许请求必须能按同一 `request_id` 查到云端审计；重复补传不能增加重复记录。
6. 完成安装、Windows 登录自启、凭据保存、覆盖升级和重启 boot ID 变化测试。

代码级自动测试命令为 `npm run filling:permit:gateway:test`。现场断线和 PLC 3 秒清零仍必须在实际 TPC7022Ei、ST20 和正式 PLC 工程上完成，不可用软件单元测试替代。

## 9. 官方参考

- [S7-200 SMART 数据类型与 V 存储区](https://www.ad.siemens.com.cn/productportal/prods/s7-200-smart-portal/200smarttop/programming/data_type.html)
- [S7-200 SMART 掉电保持范围说明](https://www.ad.siemens.com.cn/download/materialaggregation_410.html)
