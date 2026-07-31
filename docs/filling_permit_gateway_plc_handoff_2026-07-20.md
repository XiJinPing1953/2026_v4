# 充装许可网关 V1 — PLC 工程师现场交接书

> 项目：TPC7022Ei + S7-200 SMART ST20 充装许可联锁
> 交接日期：2026-07-20
> 当前阶段：云端、Windows 网关、Modbus TCP、MCGS 查询与故障关闭验证已完成；PLC 地址分配、SMART200 写入通道和 ST20 梯形图尚未实施。
> 安全红线：在 PLC 工程完成地址复核、程序评审和现场断线验收前，禁止把本功能接入正式充装启动条件。

---

## 1. 一页结论

本项目新增一个独立的充装许可网关，不修改原储罐网关。已经完成并实机验证的链路是：

```text
TPC7022Ei（McgsPro）
  → Modbus TCP
Windows 充装许可网关
  → HTTPS
URL 化云函数
  → crm_bottles / crm_filling_permit_audits
  → 审计成功后返回许可结果
  → Modbus TCP 返回 HMI
```

PLC 侧待完成的链路是：

```text
MCGS GatewayPermitOk
  AND HMI—PLC 通讯正常
  → HMI 通过既有 SMART200 驱动写 HMI_FillPermitCmd

Windows 网关心跳 GW05
  → HMI 通过既有 SMART200 驱动写 HMI_FillPermitHeartbeat

ST20：HMI_FillPermitCmd AND 3 秒心跳有效
  → FillPermitFinal

现有充装条件 AND FillPermitFinal
  → 才允许进入原有充装流程
```

任何程序中都不得直接使用 HMI 原始写入位 `HMI_FillPermitCmd` 控制充装；PLC 只能使用内部安全结果 `FillPermitFinal`。

---

## 2. 现场设备和已确认参数

| 项目 | 已确认值 |
|---|---|
| HMI | TPC7022Ei |
| HMI 组态软件 | McgsPro 3.5.1.6963 |
| HMI 局域网 IP | `192.168.31.120/24` |
| Windows 网关局域网 IP | `192.168.31.208/24` |
| 默认网关 | `192.168.31.1` |
| PLC | Siemens S7-200 SMART ST20 |
| HMI—网关协议 | Modbus TCP |
| Windows 网关角色 | Modbus TCP Server |
| TCP 端口 | `502` |
| Unit ID | `1` |
| 云端超时 | `5000 ms` |
| 网关心跳 | 每 `1000 ms` 增加 1，16 位回绕 |
| 本地审计补传周期 | `30000 ms` |
| Windows 网关 ID | `FILLING-GW-TEST-01` |
| 云函数 URL | `https://env-00jxuffegf2n.dev-hz.cloudbasefunction.cn/filling-permit-gateway-v1` |
| Windows 自启动 | 已实测：Windows 登录后自动启动 |
| 密码保存 | 已实测：Electron `safeStorage`，界面显示“密码已保存” |

动态 Boot ID 不应写死。网关每次启动都生成一个新的非零 Boot ID，HMI 必须读取当前值后再提交请求。

---

## 3. 已完成工作和明确未完成项

### 3.1 已完成

- 独立 Electron Windows 网关已经实现并安装。
- Windows 网关监听 `192.168.31.208:502`，TPC 可正常连接。
- URL 化云函数健康检查、登录、查询、审计、离线审计补传均已验证。
- `crm_filling_permit_audits` Schema 已建立。
- `request_id` 唯一索引 `uniq_request_id` 已建立，用于审计幂等。
- 云函数独立密码哈希、独立 HMAC 令牌密钥和 30 天令牌 TTL 已配置。
- MCGS Modbus 32 个保持寄存器已建立。
- MCGS 瓶号 ASCII 拆分、Boot/Seq 提交状态机、响应匹配、3 秒心跳监控和旧许可失效逻辑已建立。
- MCGS 已生成测试级 `GatewayPermitOk`。
- 28 项代码自动测试全部通过。
- Windows GUI 中“允许原因 0 被显示成 95”的显示错误已经修复并重新打包。
- 允许、业务禁止、云端断网、网关停止、网线中断、HMI 重启和 Windows 重启均完成实机测试。

### 3.2 尚未完成，PLC 工程师必须参与

- 尚未从正式 PLC 工程中分配未占用、非保持 V 区地址。
- 尚未建立 HMI 到 SMART200 的许可位和心跳字写入通道。
- 尚未读取并锁存 SMART200 驱动的通讯状态，`HmiPlcCommOk` 尚未接入最终 HMI 许可。
- ST20 中的 3 秒看门狗、`FillPermitCommOk`、`FillPermitFinal` 尚未编程。
- 原有充装启动条件尚未追加 `AND FillPermitFinal`。
- HMI—PLC 实际断线、PLC 断电和 PLC 程序下载后的现场验收尚未进行。
- 动态中文原因标签可以继续完善；目前数字原因码、静态说明和 Windows 网关完整中文原因均可用。

---

## 4. 云端接口和安全配置

### 4.1 云函数 Action

| Action | 功能 |
|---|---|
| `healthV1` | 返回服务时间、协议版本、密码和令牌密钥配置状态 |
| `loginV1` | 使用独立明文口令换取 HMAC 令牌 |
| `checkPermitV1` | 查询气瓶、执行判定、写云端审计；审计成功后才返回允许 |
| `syncAuditV1` | 补传本地系统禁止记录，按 `request_id` 幂等 |

### 4.2 环境变量

```text
FILLING_PERMIT_GATEWAY_PASSWORD_HASH
FILLING_PERMIT_GATEWAY_TOKEN_SECRET
FILLING_PERMIT_GATEWAY_TOKEN_TTL_MS
```

密码哈希必须是完整一行：

```text
pbkdf2-sha256$120000$<salt>$<hash>
```

`TOKEN_SECRET` 是独立随机密钥，不是密码哈希的一部分；推荐使用 32 随机字节的 64 位十六进制字符串。当前 TTL 为：

```text
2592000000 ms（30 天）
```

交接文档不得记录明文密码、完整密码哈希或完整令牌密钥。Windows 网关输入的是明文网关密码，不是密码哈希或令牌密钥。

### 4.3 审计集合

集合：

```text
crm_filling_permit_audits
```

关键索引：

```text
uniq_request_id：request_id 升序、唯一、非稀疏
```

每个允许结果必须先写云端审计。若云端审计失败，结果必须转为系统禁止。网络或数据库故障期间的系统禁止先写本地追加式 JSONL 队列，网络恢复后补传；相同 `request_id` 不允许生成重复审计。

---

## 5. 业务判定规则

瓶号会去除全部空白并转大写，支持数字以及 `Y013`、`X046`、`J71` 等字母数字组合，最终格式必须匹配：

```text
[A-Z0-9_-]{1,16}
```

允许条件必须全部满足：

1. 按规范化瓶号唯一查到一条气瓶主档。
2. `is_active === true`。
3. `status` 必须属于 `unknown / in_station / at_customer / scrapped / lost`。
4. `status` 不能为 `scrapped` 或 `lost`。
5. `bottle_next_check_date` 为有效 `YYYY-MM-DD`。
6. `pressure_gauge_next_check_date` 为有效 `YYYY-MM-DD`。
7. `safety_valve_next_check_date` 为有效 `YYYY-MM-DD`。
8. 三个下次检验日期均至少是北京时间“后天”。昨天、今天和明天都禁止。

V1 不判断：报废期限、压力表编号、压力表量程、安全阀数量、站点和介质。

---

## 6. Modbus TCP 寄存器协议和实际 MCGS 对象

网关使用 PDU 0 基地址；McgsPro 使用从 `4WUB0001` 开始的 1 基通道。

| PDU | McgsPro 通道 | 当前 MCGS 对象 | 访问 | 含义 |
|---:|---|---|---|---|
| — | 通讯状态伪通道 | `GW00` | R | McgsPro 设备通讯状态；不是 Modbus 保持寄存器 |
| 0 | `4WUB0001` | `GW01` | R | 协议版本，固定 1 |
| 1 | `4WUB0002` | `GW02` | R | 当前网关 Boot ID，非零 |
| 2 | `4WUB0003` | `RQ00` | R/W | 请求 Boot ID |
| 3 | `4WUB0004` | `RQ01` | R/W | 请求序号，最后写入作为提交标志 |
| 4 | `4WUB0005` | `RQ02` | R/W | 瓶号长度 1–16 |
| 5–20 | `4WUB0006–0021` | `RQ03–RQ18` | R/W | 第 1–16 个 ASCII 字符，未用字必须写 0 |
| 21 | `4WUB0022` | `RS00` | R | 响应 Boot ID |
| 22 | `4WUB0023` | `RS01` | R | 响应序号，最后更新作为响应完成标志 |
| 23 | `4WUB0024` | `RS02` | R | 0 空闲、1 处理中、2 允许、3 业务禁止、4 系统禁止 |
| 24 | `4WUB0025` | `RS03` | R | 原始许可：0 禁止、1 允许 |
| 25 | `4WUB0026` | `RS04` | R | 主原因码 |
| 26 | `4WUB0027` | `RS05` | R | 32 位失败位图低 16 位 |
| 27 | `4WUB0028` | `RS06` | R | 32 位失败位图高 16 位 |
| 28 | `4WUB0029` | `GW03` | R | 网关状态 |
| 29 | `4WUB0030` | `GW04` | R | 网关故障码 |
| 30 | `4WUB0031` | `GW05` | R | 每秒递增心跳，允许 65535→0 |
| 31 | `4WUB0032` | `GW06` | R | 查询耗时 ms |

写入顺序不可修改：先写长度、16 个字符字和 Boot ID；等待两个 200 ms 循环周期；最后单独改变 `RQ01`。网关收到新的非零请求序号后立即把许可清零，再开始访问云端。结果全部写完后最后提交 `RS01`。

### 6.1 网关状态码

| `GW03` | 含义 |
|---:|---|
| 0 | 停止 |
| 1 | 启动中 |
| 2 | 就绪 |
| 3 | 忙 |
| 4 | 降级 |
| 5 | 故障 |

### 6.2 网关故障码

| `GW04` | 含义 |
|---:|---|
| 0 | 无故障 |
| 1 | 云端不可用 |
| 2 | 鉴权失败 |
| 3 | 本地审计故障 |
| 4 | Modbus 故障 |
| 5 | 内部异常 |
| 6 | TCP 端口占用 |

---

## 7. MCGS 当前内部对象

| 对象 | 类型 | 初值 | 用途 |
|---|---|---:|---|
| `BottleInput` | 字符串 | 空 | 操作员输入瓶号 |
| `PendingRequestSeq` | 整数 | 0 | 下一请求序号 |
| `SubmitStage` | 整数 | 0 | 0 空闲、1 等两周期、2 等响应 |
| `SubmitTicks` | 整数 | 0 | 状态机周期计数 |
| `PermitNeedsRequery` | 整数/BOOL | 1 | 恢复后必须重新查询的锁存标志 |
| `GatewayCommOk` | 整数/BOOL | 0 | 网关心跳在 3 秒内有变化 |
| `LastGatewayHeartbeat` | 整数 | 0 | 上次网关心跳 |
| `HeartbeatSameTicks` | 整数 | 0 | 心跳未变化的 200 ms 周期数 |
| `GatewayPermitOk` | 整数/BOOL | 0 | 网关侧测试许可；不是 PLC 最终许可 |
| `SubmittedBottle` | 字符串 | 空 | 最近一次有效提交的瓶号，用于检测编辑 |

底部三个调试值显示顺序：

```text
GatewayCommOk / PermitNeedsRequery / GatewayPermitOk
```

典型状态：

| 显示 | 含义 |
|---|---|
| `010` | 网关通讯失效，必须重查，许可为 0 |
| `110` | 网关通讯正常，但尚未完成当前查询，许可为 0 |
| `100` | 当前查询完成但业务禁止，许可为 0 |
| `101` | 当前请求完整匹配并允许，网关侧测试许可为 1 |

---

## 8. MCGS“提交查询”按钮最终脚本

本脚本放在“提交查询”标准按钮的抬起脚本中。不要放入循环策略。

```text
IF SubmitStage = 0 THEN

  PermitNeedsRequery = 1
  GatewayPermitOk = 0

  IF !Len(BottleInput) >= 1 AND !Len(BottleInput) <= 16 THEN

    RQ02 = !Len(BottleInput)

    RQ03 = 0
    RQ04 = 0
    RQ05 = 0
    RQ06 = 0
    RQ07 = 0
    RQ08 = 0
    RQ09 = 0
    RQ10 = 0
    RQ11 = 0
    RQ12 = 0
    RQ13 = 0
    RQ14 = 0
    RQ15 = 0
    RQ16 = 0
    RQ17 = 0
    RQ18 = 0

    IF RQ02 >= 1 THEN
      RQ03 = !Ascii2I(!Mid(BottleInput, 1, 1))
    ENDIF
    IF RQ02 >= 2 THEN
      RQ04 = !Ascii2I(!Mid(BottleInput, 2, 1))
    ENDIF
    IF RQ02 >= 3 THEN
      RQ05 = !Ascii2I(!Mid(BottleInput, 3, 1))
    ENDIF
    IF RQ02 >= 4 THEN
      RQ06 = !Ascii2I(!Mid(BottleInput, 4, 1))
    ENDIF
    IF RQ02 >= 5 THEN
      RQ07 = !Ascii2I(!Mid(BottleInput, 5, 1))
    ENDIF
    IF RQ02 >= 6 THEN
      RQ08 = !Ascii2I(!Mid(BottleInput, 6, 1))
    ENDIF
    IF RQ02 >= 7 THEN
      RQ09 = !Ascii2I(!Mid(BottleInput, 7, 1))
    ENDIF
    IF RQ02 >= 8 THEN
      RQ10 = !Ascii2I(!Mid(BottleInput, 8, 1))
    ENDIF
    IF RQ02 >= 9 THEN
      RQ11 = !Ascii2I(!Mid(BottleInput, 9, 1))
    ENDIF
    IF RQ02 >= 10 THEN
      RQ12 = !Ascii2I(!Mid(BottleInput, 10, 1))
    ENDIF
    IF RQ02 >= 11 THEN
      RQ13 = !Ascii2I(!Mid(BottleInput, 11, 1))
    ENDIF
    IF RQ02 >= 12 THEN
      RQ14 = !Ascii2I(!Mid(BottleInput, 12, 1))
    ENDIF
    IF RQ02 >= 13 THEN
      RQ15 = !Ascii2I(!Mid(BottleInput, 13, 1))
    ENDIF
    IF RQ02 >= 14 THEN
      RQ16 = !Ascii2I(!Mid(BottleInput, 14, 1))
    ENDIF
    IF RQ02 >= 15 THEN
      RQ17 = !Ascii2I(!Mid(BottleInput, 15, 1))
    ENDIF
    IF RQ02 >= 16 THEN
      RQ18 = !Ascii2I(!Mid(BottleInput, 16, 1))
    ENDIF

    SubmittedBottle = BottleInput
    RQ00 = GW02

    PendingRequestSeq = RQ01 + 1

    IF PendingRequestSeq > 65535 THEN
      PendingRequestSeq = 1
    ENDIF
    IF PendingRequestSeq = 0 THEN
      PendingRequestSeq = 1
    ENDIF

    SubmitTicks = 0
    SubmitStage = 1

  ENDIF

ENDIF
```

---

## 9. MCGS 全局 200 ms 循环策略最终脚本

运行策略名称：

```text
PermitCycle200ms
```

策略类型：循环策略；周期：`200 ms`；策略行条件：始终为真。脚本只能保留一份，不能同时放在窗口循环脚本和全局策略中重复执行。

```text
IF BottleInput <> SubmittedBottle THEN
  PermitNeedsRequery = 1
  GatewayPermitOk = 0
ENDIF


IF GW05 <> LastGatewayHeartbeat THEN
  LastGatewayHeartbeat = GW05
  HeartbeatSameTicks = 0
  GatewayCommOk = 1
ELSE
  IF HeartbeatSameTicks < 15 THEN
    HeartbeatSameTicks = HeartbeatSameTicks + 1
  ENDIF

  IF HeartbeatSameTicks >= 15 THEN
    GatewayCommOk = 0
    PermitNeedsRequery = 1
    GatewayPermitOk = 0
  ENDIF
ENDIF


IF SubmitStage = 1 THEN
  SubmitTicks = SubmitTicks + 1

  IF SubmitTicks >= 2 THEN
    RQ01 = PendingRequestSeq
    SubmitStage = 2
    SubmitTicks = 0
  ENDIF
ENDIF


IF SubmitStage = 2 THEN
  SubmitTicks = SubmitTicks + 1

  IF RS00 = RQ00 AND RS01 = PendingRequestSeq THEN
    IF RS02 = 2 OR RS02 = 3 OR RS02 = 4 THEN
      PermitNeedsRequery = 0
      SubmitStage = 0
      SubmitTicks = 0
    ENDIF
  ENDIF
ENDIF


IF SubmitStage = 2 AND SubmitTicks >= 40 THEN
  PermitNeedsRequery = 1
  GatewayPermitOk = 0
  SubmitStage = 0
  SubmitTicks = 0
ENDIF


IF GW01 <> 1 OR GW03 <> 2 OR GW04 <> 0 THEN
  PermitNeedsRequery = 1
  GatewayPermitOk = 0
ENDIF


IF RQ00 <> GW02 THEN
  PermitNeedsRequery = 1
  GatewayPermitOk = 0
ENDIF


GatewayPermitOk = 0

IF PermitNeedsRequery = 0 THEN
  IF SubmitStage = 0 AND GatewayCommOk = 1 THEN
    IF GW01 = 1 AND GW02 <> 0 AND GW03 = 2 AND GW04 = 0 THEN
      IF RQ00 = GW02 AND RS00 = GW02 THEN
        IF RQ01 <> 0 AND RS01 = RQ01 THEN
          IF RS02 = 2 AND RS03 = 1 THEN
            IF RS04 = 0 AND RS05 = 0 AND RS06 = 0 THEN
              GatewayPermitOk = 1
            ENDIF
          ENDIF
        ENDIF
      ENDIF
    ENDIF
  ENDIF
ENDIF
```

当前脚本实现的是 HMI—网关安全许可。接入 PLC 后，还必须增加 SMART200 驱动通讯状态的锁存失效逻辑，不能仅把 `GatewayPermitOk` 直接连接到 PLC。

---

## 10. 原因码和 32 位明细位图

| 原因码 | 中文原因 | 位图 bit |
|---:|---|---:|
| 0 | 允许充装 | 无 |
| 10 | 瓶号输入无效 | 0 |
| 11 | 未找到气瓶 | 1 |
| 16 | 瓶号主档不唯一 | 2 |
| 15 | 气瓶状态异常 | 3 |
| 12 | 气瓶已停用 | 4 |
| 13 | 气瓶已报废 | 5 |
| 14 | 气瓶已丢失 | 6 |
| 20 | 钢瓶检验日期缺失或无效 | 7 |
| 21 | 钢瓶检验已到提前禁用期 | 8 |
| 30 | 压力表检验日期缺失或无效 | 9 |
| 31 | 压力表检验已到提前禁用期 | 10 |
| 40 | 安全阀检验日期缺失或无效 | 11 |
| 41 | 安全阀检验已到提前禁用期 | 12 |
| 90 | 云端超时或网络故障 | 13 |
| 92 | 数据库故障 | 14 |
| 93 | 网关鉴权失败 | 15 |
| 94 | 云端审计写入失败 | 16 |
| 95 | 网关内部异常 | 17 |
| 96 | 本地审计写入失败 | 18 |
| 97 | 协议或启动标识异常 | 19 |
| 99 | 网关忙或请求并发 | 20 |
| 98 | 网关尚未就绪 | 21 |

bit 0–15 存入 `RS05`，bit 16–31 存入 `RS06`。示例：

```text
bit13 网络/超时：RS05 = 8192，RS06 = 0
bit15 鉴权：RS05 = 32768，RS06 = 0
bit16 云审计：RS05 = 0，RS06 = 1
```

多个失败项可以同时置位；`RS04` 只显示一个主原因，云端审计和明细位图保留全部失败项。

---

## 11. 已完成实机测试记录

以下测试均在 TPC7022Ei、Windows 网关和正式云函数链路上完成：

| 测试 | 实际结果 |
|---|---|
| HMI 与 Windows 连通 | `192.168.31.120` 与 `192.168.31.208` 双向局域网可达，TCP 502 正常 |
| 网关健康状态 | 协议 1、Boot ID 非零、网关状态 2、故障码 0、心跳每秒增加 |
| 正常允许 | Windows 显示“允许 · 原因 0 允许充装”；HMI `RS02=2, RS03=1, RS04=0, RS05=0, RS06=0`；底部 `101` |
| 业务禁止 | 瓶号 `Y014` 返回原因 20；HMI `RS02=3, RS03=0`；底部 `100` |
| 编辑瓶号 | 不提交，仅修改瓶号，`GatewayPermitOk` 立即从 1 清零；底部 `110` |
| 停止 Windows 网关 | 底部在 3 秒内 `101 → 010` |
| 重启 Windows 网关 | Boot ID 改变；只能 `010 → 110`，旧许可不自动恢复；重查后 `101` |
| 云端网络中断 | HMI—网关心跳继续；新查询返回 `RS02=4, RS03=0, RS04=90, RS05=8192, RS06=0, GW03=4, GW04=1`；底部 `110` |
| 云端恢复 | 旧许可不恢复；日志自动补传系统禁止审计；重新查询后恢复 `101` |
| 拔 HMI—网关网线 | 3 秒内 `101 → 010`；恢复网线只能到 `110`；重查后 `101` |
| HMI 重启 | 启动过程 `010 → 110`，不自动恢复旧许可；重查后 `101` |
| Windows 重启 | 登录后网关自动启动，凭据无需重输；Boot ID 改变；HMI 只能到 `110`；重查后 `101` |
| 鉴权故障恢复 | 原因 93、明细 32768 的历史系统禁止已确认；密码配置修复后鉴权正常，5 条历史系统禁止审计成功补传 |

代码测试：

```text
npm run filling:permit:gateway:test
```

结果：28 项通过，0 失败。

这些结果只证明 HMI—网关—云端链路。PLC 侧 3 秒清零尚未验收。

---

## 12. PLC 工程师必须完成的地址分配

先备份正式 PLC 工程，再编译并检查交叉引用、符号表、数据块、向导生成区和系统块保持范围。不得凭经验直接挑地址。

至少分配以下两个 HMI 写入地址：

| PLC 符号 | 类型 | 地址要求 |
|---|---|---|
| `HMI_FillPermitCmd` | BOOL | 未占用、非保持的 `Vx.y` |
| `HMI_FillPermitHeartbeat` | WORD/UINT | 未占用、非保持的 `VWn`，`n` 建议为偶数 |

地址检查要求：

1. 不在任何程序、子程序、中断、库、向导和数据块中使用。
2. 不与现有 HMI 标签使用的 V 地址重叠。
3. 位地址所在字节不能与心跳字的两个字节重叠。
4. 不属于系统块“保持范围”。
5. 不在数据块中定义危险初值；尤其不能把原始许可位初始化为 1。
6. 地址选择结果必须回填到本交接书，并由 PLC 和 HMI 两端各复核一次。

地址回填：

```text
HMI_FillPermitCmd        = ____________________
HMI_FillPermitHeartbeat  = ____________________
确认非保持范围           = 是 / 否
PLC 工程师签字           = ____________________
HMI 工程师签字           = ____________________
```

西门子官方说明：V 区保持范围在“系统块 → 保持范围”中配置；因此“V 区”本身不等于“非保持”，必须检查具体工程设置。

---

## 13. ST20 内部符号和程序功能要求

PLC 内部还需分配未占用的内部位、字和定时器：

| PLC 内部符号 | 类型 | 功能 |
|---|---|---|
| `FillPermitCommOk` | BOOL | HMI 许可心跳有效 |
| `FillPermitFinal` | BOOL | PLC 唯一允许使用的最终许可位 |
| `LastPermitHeartbeat` | WORD/UINT | 上一次 HMI 心跳值 |
| `PermitHeartbeatChanged` | BOOL | 心跳变化的单扫描标志 |
| `PermitWatchdog3s` | TON | 非保持 3 秒看门狗 |

### 13.1 推荐网络顺序

1. **首次扫描**：清零 `FillPermitCommOk` 和 `FillPermitFinal`；把当前 `HMI_FillPermitHeartbeat` 复制到 `LastPermitHeartbeat`。PLC 上电后绝不能直接继承许可。
2. **先比较后更新**：计算 `PermitHeartbeatChanged = (HMI_FillPermitHeartbeat <> LastPermitHeartbeat)`。
3. **检测到变化**：复制当前心跳到 `LastPermitHeartbeat`，置位 `FillPermitCommOk`。
4. **看门狗复位**：心跳变化的这个扫描周期必须让非保持 TON 输入为假，使其复位。
5. **3 秒无变化**：TON 到时后清零 `FillPermitCommOk`。
6. **每扫描重算**：`FillPermitFinal = HMI_FillPermitCmd AND FillPermitCommOk`。
7. **追加联锁**：现有充装启动条件改成 `原有全部条件 AND FillPermitFinal`。

不要用“心跳值是否大于 0”判断通讯，因为心跳允许从 65535 回绕到 0；必须判断“是否发生变化”。

不要把 `FillPermitFinal` 并联到原有安全条件。它只能作为新增串联条件，不能绕过急停、压力、阀门、设备状态、硬线回路或原程序的其他保护。

### 13.2 功能伪代码

```text
FIRST_SCAN:
  FillPermitCommOk := 0
  FillPermitFinal := 0
  LastPermitHeartbeat := HMI_FillPermitHeartbeat

EVERY_SCAN:
  PermitHeartbeatChanged := (HMI_FillPermitHeartbeat <> LastPermitHeartbeat)

  IF PermitHeartbeatChanged THEN
    LastPermitHeartbeat := HMI_FillPermitHeartbeat
    FillPermitCommOk := 1
  END_IF

  PermitWatchdog3s.IN := FillPermitCommOk AND NOT PermitHeartbeatChanged

  IF PermitWatchdog3s.Q THEN
    FillPermitCommOk := 0
  END_IF

  FillPermitFinal := HMI_FillPermitCmd AND FillPermitCommOk
```

具体定时器号、时间基准和内部地址必须由 PLC 工程师根据正式工程分配，不能照抄占用已有资源。

---

## 14. 地址确定后 HMI 侧还要完成的工作

在现有 SMART200 设备下建立两个写通道和一个通讯状态通道：

```text
PLC_FillPermitCmd        → HMI_FillPermitCmd
PLC_FillPermitHeartbeat  → HMI_FillPermitHeartbeat
HmiPlcCommOk             ← SMART200 驱动通讯状态
```

HMI 侧正式许可必须满足：

```text
FillPermitOk = GatewayPermitOk AND HmiPlcCommOk
```

HMI 周期写入：

```text
PLC_FillPermitCmd = FillPermitOk
PLC_FillPermitHeartbeat = GW05
```

出现 SMART200 通讯故障时必须立即：

```text
FillPermitOk = 0
PermitNeedsRequery = 1
```

通讯恢复后 `PermitNeedsRequery` 不能自动清零，必须重新查询。这个要求很重要：PLC 看门狗虽然会在断线期间清零 `FillPermitFinal`，但如果 HMI 在重连后继续发送旧许可 1，PLC 可能因新心跳恢复而重新置位。因此 HMI 必须锁存“需要重新查询”。

PLC 中仍保留独立的 3 秒看门狗；不得因为 HMI 已做通讯判断而取消 PLC 看门狗。

---

## 15. PLC 接入后的现场验收

每项测试都要同时观察：

```text
HMI_FillPermitCmd
HMI_FillPermitHeartbeat
FillPermitCommOk
FillPermitFinal
现有充装启动条件
```

验收顺序：

1. PLC 首次上电：`FillPermitFinal=0`。
2. 未查询时：即使心跳正常，`FillPermitFinal=0`。
3. 允许查询：审计成功、HMI `GatewayPermitOk=1`、SMART200 通讯正常后，`FillPermitFinal=1`。
4. 编辑瓶号：不提交也必须使 `FillPermitFinal=0`。
5. 业务禁止：`FillPermitFinal=0`。
6. Windows 网关停止：`FillPermitFinal` 在 3 秒内清零。
7. 拔 HMI—网关网线：`FillPermitFinal` 在 3 秒内清零。
8. 拔 HMI—PLC 通讯线：PLC 心跳停止，`FillPermitFinal` 在 3 秒内清零。
9. 关闭 HMI：PLC 心跳停止，`FillPermitFinal` 在 3 秒内清零。
10. PLC 重启：首次扫描清零；必须等待新心跳变化和重新查询，旧许可不能恢复。
11. 恢复任何通讯：旧许可不得自动恢复；重新查询并成功审计后才能再次置位。
12. 最后验证：即使 `FillPermitFinal=1`，急停、压力、阀门或任何原有安全条件不满足时仍不得启动充装。

所有断线测试建议先在设备空载、无充装压力、现场负责人确认的条件下进行。

---

## 16. Windows 网关文件、版本和审计位置

修正版安装包：

```text
release/filling-permit-gateway/新拓充装许可网关-V1-x64-Setup.exe
```

SHA-256：

```text
94627c26a93ff00a32647b56e99369a1d043acb6ddb24c7f26abd01ca5f50dec
```

Windows 数据位置：

```text
配置：%APPDATA%\XintuoFillingPermitGateway\config.json
审计：%APPDATA%\XintuoFillingPermitGateway\audits\permit-audit-YYYY-MM-DD.jsonl
补传：%APPDATA%\XintuoFillingPermitGateway\audits\pending-audits.jsonl
```

不要删除审计目录。升级安装应覆盖程序文件并保留 `%APPDATA%` 配置、凭据和审计数据。

---

## 17. 源码和交付文件

| 内容 | 路径 |
|---|---|
| Windows Electron 应用 | `apps/filling-permit-gateway/` |
| Modbus、状态机、本地审计 | `scripts/fillingPermitCore.cjs` |
| 云函数 | `uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway/` |
| 云端判定规则 | `uniCloud-alipay/cloudfunctions/crm-filling-permit-gateway/permitPolicy.js` |
| 审计 Schema | `uniCloud-alipay/database/crm_filling_permit_audits.schema.json` |
| 审计索引 | `uniCloud-alipay/database/crm_filling_permit_audits.index.json` |
| MCGS 变量表 | `docs/tpc7022ei_filling_permit_variables.csv` |
| 总体交付说明 | `docs/filling_permit_gateway_v1.md` |
| 自动测试 | `scripts/filling-permit-gateway/*.test.cjs` |
| Windows 构建配置 | `electron-builder.filling-permit.yml` |

---

## 18. 安全和网络要求

- Windows TCP 502 只允许 TPC7022Ei 的 `192.168.31.120` 访问。
- TCP 502 不得暴露到互联网或不受控办公网。
- 推荐自动化专网和外网使用双网卡或分离路由。
- Windows 密码只保存在安全凭据存储中；配置文件不得保存明文密码。
- 不得把云函数密码哈希或令牌密钥填写到 HMI、PLC 或普通配置文件。
- 本功能不是独立安全仪表系统，不能替代急停、硬线联锁或设备自身保护。

建议 Windows 管理员按实际网卡建立入站白名单规则：

```powershell
New-NetFirewallRule -DisplayName "Xintuo Filling Permit Modbus" `
  -Direction Inbound -Action Allow -Protocol TCP `
  -LocalPort 502 -LocalAddress 192.168.31.208 `
  -RemoteAddress 192.168.31.120
```

---

## 19. 交接确认清单

### PLC 工程师接收时

- [ ] 已取得正式 PLC 工程备份。
- [ ] 已确认 CPU 为 S7-200 SMART ST20。
- [ ] 已检查 V 区交叉引用、数据块和系统块保持范围。
- [ ] 已回填两个 HMI 写入地址。
- [ ] 已分配内部位、内部字和 3 秒定时器。
- [ ] 已实现首次扫描清零和心跳变化看门狗。
- [ ] PLC 全程序只使用 `FillPermitFinal`，未直接使用 `HMI_FillPermitCmd`。
- [ ] `FillPermitFinal` 只作为原有条件的串联附加条件。

### HMI 工程师接收 PLC 地址后

- [ ] 已建立 SMART200 许可位和心跳字写通道。
- [ ] 已建立并验证 SMART200 通讯状态 `HmiPlcCommOk`。
- [ ] PLC 通讯故障会置 `PermitNeedsRequery=1`。
- [ ] 通讯恢复不会自动恢复旧许可。

### 现场联合验收

- [ ] 允许、业务禁止、云端故障均符合预期。
- [ ] HMI—网关断线 3 秒内清零。
- [ ] HMI—PLC 断线 3 秒内清零。
- [ ] HMI、Windows 网关、PLC 分别重启后旧许可不恢复。
- [ ] 所有原有安全联锁仍然有效。
- [ ] 每个请求均可查到本地审计；允许结果可查到同 `request_id` 云端审计。

---

## 20. 官方参考

- [S7-200 SMART 数据类型与 V 存储区](https://www.ad.siemens.com.cn/productportal/prods/s7-200-smart-portal/200smarttop/programming/data_type.html)
- [S7-200 SMART 保持范围设置](https://www.ad.siemens.com.cn/download/materialaggregation_410.html)
- [S7-200 SMART 系统手册](https://support.industry.siemens.com/cs/attachments/109978364/S7-200_SMART_system_manual_en-HS.pdf)
