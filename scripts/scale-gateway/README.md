# PDA Scale Gateway

机房电脑常驻 Node 网关，读取充装磅 `Modbus RTU`，把最新重量快照写入云端 `crm-pda-scale.upsertLatestV1`，供 PDA 灌装页轮询 `getLatestV1`。

## 固定协议

- 串口参数：
  - `115200 / 8 / 1 / none`
  - `slaveId=1`
- 读寄存器：
  - 实时块：`FC03` 读取 `0x0000..0x0004`
  - 启动配置块：读取 `0x0009`、`0x0013..0x0015`
- 解析规则：
  - `0x0000 + 0x0001` => 有符号 `Int32`
  - `0x0004` => `stable_metric`
  - `0x0009` => `stable_threshold`
  - `is_stable = stable_metric <= stable_threshold`
  - `scaledValue = rawWeight / 10^decimalPlaces`
  - `unit=0(g)` => `/1000`
  - `unit=1(kg)` => 原值
  - `unit=2(t)` => `*1000`
  - `unit=3(mg)` => `/1000000`

## 环境变量

复制 `.env.example` 为 `.env`，最少填写：

- `SCALE_SERIAL_PORT`
- `CRM_SPACE_ID`
- `CRM_CLIENT_SECRET` 或 `CRM_ACCESS_KEY / CRM_SECRET_KEY / CRM_SPACE_APP_ID`
- `GATEWAY_USERNAME / GATEWAY_PASSWORD`

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

不接真秤也能验证寄存器解析和离线回写：

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
- 上云规则：
  - 重量变化立即上报
  - 稳定状态变化立即上报
  - 在线状态/错误摘要变化立即上报
  - 否则每 `2s` 心跳一次
