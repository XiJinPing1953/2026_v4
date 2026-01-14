# 2026_v4 重构计划与进度

本项目为 **uni-app（Vue3 + Vite）+ uniCloud（支付宝云）** 的前后端分离重构版本。

## 重构原则（必须遵守）
- 官方规则优先：结构/配置完全遵循 uni-app 与 uniCloud 官方规范。
- 前后端分离：前端只负责 UI/交互/编排，业务规则与数据访问在云函数。
- 页面瘦身：`src/pages/**` 只做编排，不堆业务计算与兼容逻辑。
- 组件化优先：复杂展示/交互拆到 `components`。
- 兼容隔离：历史字段兼容仅允许在 `src/services/mappers/**`。
- 新模型优先：不盲拷旧结构，核心模型清晰（Bottle/Sale/Filling/Customer/Vehicle/Anomaly/Log/User）。

## 目录结构（必须遵守）
- `src/` 前端源码根目录
  - `pages/` 页面容器（只做编排）
  - `components/base/` 基础组件（Button/Card/Tag/...）
  - `components/domain/` 领域组件（SaleForm/AnomalyCard/...）
  - `composables/` 组合式逻辑（页面不写复杂逻辑）
  - `services/`
    - `api/` 统一云函数调用封装与错误处理
    - `models/` 核心模型
    - `mappers/` 旧字段/历史数据映射
  - `utils/` 纯工具函数
- `uniCloud-alipay/` 云函数与数据库
- `docs/` 文档与约束

## 当前进度（已完成）
- 基础页面：登录页、工作台页（`src/pages`）。
- 基础 UI：`AppPage/AppCard/AppButton/AppInput/AppTag/AppSection/AppStatCard/AppEmpty`。
- 数据层基建：`services/api` 统一调用 + 401 处理；`services/auth` + `services/navigation`。
- A3 基建：`useQuery`、`AppSkeleton`、`uni.scss` 主题变量扩展。
- A1 基建：`AppFilterBar` 筛选条。
- A2 基建：`AppList`、`AppListItem`、`AppTable`。

## 接下来的计划（严格执行）
### 阶段 A：通用基建（进行中）
- A1 筛选条（已完成）
- A2 列表/表格（已完成）
- A3 useQuery + Skeleton（已完成）

### 阶段 B：核心模型与登录链路
- B1 补齐 `crm-auth` 云函数（登录/鉴权/续期）
- B2 定义核心模型（Bottle/Sale/Filling/Customer/Vehicle/Anomaly/Log/User）
- B3 建立 `services/models` 与 `services/mappers`

### 阶段 C：业务页面迁移
- C1 销售列表/详情/新增（先用列表 + 表单）
- C2 瓶子流转异常列表/处理
- C3 客户/车辆/台账类页面

### 阶段 D：性能与数据层优化
- D1 云函数分页/索引优化
- D2 前端列表缓存、查询节流

### 阶段 E：规范会计模块（新增）
- E1 设计会计核心模型：科目/凭证/分录/账期/往来/费用/收入
- E2 云函数：凭证录入、审核、反审核、结账、报表汇总
- E3 页面：凭证列表/录入、科目管理、往来明细、月度报表
- E4 与销售/瓶子业务对接（生成收入/成本凭证）

## 执行约定
- 所有重构迁移严格按阶段推进，不跨阶段堆叠。
- 页面不承载业务与兼容逻辑；所有兼容仅在 `mappers`。
- 每次迁移必须先完善基建，再进入业务页面。
