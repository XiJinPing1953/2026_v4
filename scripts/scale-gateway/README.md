# PDA Scale Gateway

机房电脑常驻 Node 网关，通过 USB-RS485 读取耀华 `C606+` 称重仪表 `Modbus RTU`，把最新毛重快照写入云端 `crm-pda-scale.upsertLatestV1`，供 PDA 灌装页轮询 `getLatestV1`。

## C606+ 固定协议

- 串口参数：
  - 默认 `9600 / 8 / none / 2 stop bits`
  - 如果现场把仪表设置为奇/偶校验，网关必须同步改成 `odd/even / 1 stop bit`
  - `slaveId=1`
- 仪表设置：
  - RS485 两线 Modbus RTU，使用 C606+ 串口 3 的两线 Modbus 模式
  - 站地址与 `SCALE_SLAVE_ID` 一致，默认 `1`
- 读数据：
  - 毛重浮点数：优先 `FC04 readInputRegisters(0x0008, 2)`
  - 毛重整数：浮点读取失败时回退 `FC04 readInputRegisters(0x0002, 2)`
  - 动态状态：`FC02 readDiscreteInputs(0x0002, 1)`
  - 配置块：`FC04 readInputRegisters(0x001C, 11)`，读取分度值、小数位、重量单位
- 网关使用原始 RTU 读包，不使用通用库解析 `FC02`；C606+ 实测 `FC02` 回包会在 CRC 前多 1 个填充字节，通用库会误判 CRC error。
- 解析规则：
  - 浮点毛重按 32 位 IEEE754、高 word 在前解析，直接按仪表单位换算 kg
  - 整数毛重为 32 位有符号整数，传输顺序为 `最高、次高、次低、最低`
  - 整数毛重 `scaledValue = rawWeight / 10^decimalPlaces`
  - C606+ 单位：`0=mg`、`1=g`、`2=kg`、`3=t`
  - `weight_kg` 统一换算为 kg
  - `scale_read_mode` 标记本次使用 `gross_float` 或 `gross_int`
  - C606+ 离散输入 `0x0002` 为动态灯状态，`is_stable = !dynamic`
  - `stable_metric` 写动态标志 `0/1`，`stable_threshold` 固定写 `0`

> C602 资料仅用于参考 Modbus 命令、CRC 和 32 位字节序；C606+ 的串口参数、稳定位和寄存器语义以 C606+ 说明书为准。

## 环境变量

复制 `.env.example` 为 `.env`，最少填写：

- `SCALE_SERIAL_PORT`
- `CRM_SPACE_ID`
- `CRM_CLIENT_SECRET` 或 `CRM_ACCESS_KEY / CRM_SECRET_KEY / CRM_SPACE_APP_ID`
- `GATEWAY_USERNAME / GATEWAY_PASSWORD`

默认串口参数已按 C606+ USB-RS485 两线 Modbus 设置为 `9600/8/N/2`；不要继续使用旧充装磅的 `115200/8/1/none`。

若暂时没有专用网关账号，可退回：

- `SUPERADMIN_USERNAME`
- `SUPERADMIN_PASSWORD`

## 安装与运行

```bash
cd scripts/scale-gateway
npm install
npm run start
```

## Mock 模式

不接真秤也能验证 C606+ 毛重解析、动态判稳和离线回写：

```bash
cd scripts/scale-gateway
npm run mock
```

只看本地解析日志、不写云端：

```bash
cd scripts/scale-gateway
npm run mock:dry
```

`--mock` 模式会循环输出：

- 稳定 `kg` 样本
- 未稳定 `kg` 样本
- 稳定 `g` 样本
- 固定周期的通讯失败样本（自动上报 `is_online=false`）

## 上云节流

- 本地轮询：`200ms`
- 串口读超时：默认 `1500ms`，可用 `SCALE_TIMEOUT_MS` 调整
- 串口打开后静默等待：默认 `800ms`，可用 `SCALE_OPEN_SETTLE_MS` 调整
- RTU 帧间隔：默认 `100ms`，单请求默认失败重试 `1` 次
- 上云规则：
  - 重量变化立即上报
  - 稳定状态变化立即上报
  - 在线状态/错误摘要变化立即上报
  - 否则每 `2s` 心跳一次
