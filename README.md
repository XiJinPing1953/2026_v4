# 2026_v4 重构计划与进度

本项目为 **uni-app（Vue3 + Vite）+ uniCloud（支付宝云）** 的前后端分离重构版本。

## 重构原则（必须遵守）
- 官方规则优先：结构/配置完全遵循 uni-app 与 uniCloud 官方规范。
- 前后端分离：前端只负责 UI/交互/编排，业务规则与数据访问在云函数。
- 页面瘦身：`src/pages/**` 只做编排，不堆业务计算与兼容逻辑。
- 组件化优先：复杂展示/交互拆到 `components`。
- 兼容隔离：历史字段兼容仅允许在 `src/services/mappers/**`。
- 新模型优先：不盲拷旧结构，核心模型清晰（Bottle/Sale/Filling/Customer/Vehicle/Anomaly/Log/User）。

## Todo/Task/STATE 持久化（必须遵守）

为保证多人协作/多轮对话/多次提交的上下文一致性，本项目以 `STATE.md` 作为工作状态持久化的单一事实来源（SSOT）：

- `STATE.md` 必须是追加日志（append-only）：任何状态变化/补充说明只能在文件末尾追加新条目，禁止回写/改写历史内容。
- 每次提交代码后必须追加一条变更记录（可引用 commit SHA），并严格按以下字段填写：`做了什么`、`改动文件列表`、`验证输出要点`、`剩余问题`。
- `验证输出要点` 必须明确写清“运行了什么/没运行什么”（例如是否运行 `npm run build`、是否部署/调用云函数等）；不确定就写“未记录/未复跑”。
- 任何 Todo/Task 都以 `STATE.md` 最新条目为准；README 只保留原则与入口，避免出现两套不一致的待办列表。

## 当前进度（已完成）
- 基础页面：登录页、工作台页（`src/pages`）。
- 基础 UI：`AppPage/AppCard/AppButton/AppInput/AppTag/AppSection/AppStatCard/AppEmpty`。
- 数据层基建：`services/api` 统一调用 + 401 处理；`services/auth` + `services/navigation`。
- A3 基建：`useQuery`、`AppSkeleton`、`uni.scss` 主题变量扩展。
- A1 基建：`AppFilterBar` 筛选条。
- A2 基建：`AppList`、`AppListItem`、`AppTable`。
- B1 完成：`crm-auth` 云函数（登录/鉴权/续期）。

## 接下来的计划（严格执行）
### 阶段 A：通用基建（进行中）
- A1 筛选条（已完成）
- A2 列表/表格（已完成）
- A3 useQuery + Skeleton（已完成）

### 阶段 B：核心模型与登录链路
- B1 补齐 `crm-auth` 云函数（登录/鉴权/续期）（已完成）
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

## 环境变量
- `SUPERADMIN_USERNAME`：超级管理员账号（必填）
- `SUPERADMIN_PASSWORD`：超级管理员密码（必填）
- `BCRYPT_SALT_ROUNDS`：bcrypt 盐轮数（可选，默认 10）

## 执行约定
- 所有重构迁移严格按阶段推进，不跨阶段堆叠。
- 页面不承载业务与兼容逻辑；所有兼容仅在 `mappers`。
- 每次迁移必须先完善基建，再进入业务页面。

## 文档（已嵌入）

以下两份文档会作为 README 的长期约束随仓库一起被查看（源文件仍保留在 `docs/` 目录，建议以源文件为准同步更新）。

### docs/PROJECT_STRUCTURE.md（嵌入）
<!-- BEGIN EMBED: docs/PROJECT_STRUCTURE.md -->
# 2026_v4 目录结构与约束

本项目是 **uni-app（Vue3 + Vite）+ uniCloud（支付宝云）** 的前后端分离重建工程。

## 目录结构（必须遵守）

- `src/`：前端源码根目录（遵循官方 vite 模板约定）
  - `src/pages/`：页面容器（只做编排，尽量短）
  - `src/pages.json`：路由与 tabBar 配置
  - `src/manifest.json`：应用配置（含 `appid`），uniCloud 关联依赖此处
  - `src/main.js` / `src/App.vue`：入口
  - `src/static/`：静态资源
  - `src/uni.scss`：全局样式/主题变量
  - `src/components/`：组件库
    - `src/components/base/`：基础组件（Button/Card/Modal/Tag…），不含业务
    - `src/components/domain/`：领域组件（SaleForm/BottleTimeline/AnomalyCard…）
  - `src/composables/`：组合式逻辑（页面不写复杂逻辑，抽到这里）
  - `src/services/`：数据与业务服务层（统一 API、鉴权、映射、模型）
    - `src/services/api/`：统一云函数调用封装（含 401/错误处理）
    - `src/services/models/`：核心模型定义（新结构）
    - `src/services/mappers/`：旧字段/历史数据映射层（如需兼容，仅限此处）
  - `src/utils/`：纯工具函数（格式化、日期、排序等）

- `uniCloud-alipay/`：uniCloud 根目录（支付宝云空间，遵循 uniCloud 官方结构）
  - `uniCloud-alipay/cloudfunctions/`：云函数
  - `uniCloud-alipay/database/`：数据库 schema/索引等

- `docs/`：文档与约束

## 与目录相关的重构原则

1) 页面只做编排：`src/pages/**` 不允许堆业务计算/状态同步/兼容逻辑。
2) 复杂展示组件化：所有复杂 UI 归入 `src/components/**`，页面不写大段模板。
3) 数据获取解耦：页面通过 `src/composables/**` 调度，实际请求在 `src/services/api/**`。
4) 兼容隔离：历史字段兼容只允许在 `src/services/mappers/**`，严禁扩散到页面/组件。
5) 官方规则优先：`src/manifest.json`、`uniCloud-alipay/` 位置与结构不得随意变更。
<!-- END EMBED: docs/PROJECT_STRUCTURE.md -->

### docs/REFACTORING_MEMO.md（嵌入）
<!-- BEGIN EMBED: docs/REFACTORING_MEMO.md -->
# 2026_v4 重构备忘录（必须遵守）

本文件是 `2026_v4` 项目的长期约束与执行准则，用于避免“旧堆积代码”复现。

## 最高优先级：官方规则

- 前端项目结构、配置文件位置、构建方式：严格遵循 **uni-app（Vue3 + Vite）官方模板**。
- 云函数/数据库：严格遵循 **uniCloud 官方规则**，并以当前已绑定的支付宝云空间为准。

## 架构原则

### 1) 前后端分离
- 前端：UI/交互/编排。
- 后端（uniCloud）：数据访问、权限校验、核心业务规则与写入。
- 禁止把“状态更新/业务计算/兼容修补”堆在页面文件里。

### 2) 重新定义核心模型（不盲拷旧结构）
- 不继承旧项目里大量历史字段与兼容逻辑（例如存瓶兼容字段）。
- 新项目以清晰模型为主：Bottle / Sale / Filling / Customer / Vehicle / Anomaly / Log / User。
- 如必须兼容历史数据：通过 **迁移/映射层** 处理，不允许页面到处写兼容 if。

### 3) 页面瘦身：页面只做编排
- `src/pages/**` 应尽量短：路由参数、调 composable、组合组件、布局编排。
- 复杂展示与交互必须组件化：列表、筛选条、表单分段、时间线、异常卡片、统计卡片等。
- 复杂业务计算抽离到 composable / service / 云函数。

### 4) 分阶段推进（按优先级）
1. **组件化拆分**（最小风险、立竿见影，优先级高）
2. **逻辑抽离**（显著降低页面复杂度，优先级中高）
3. **性能与数据层优化**（明确瓶颈后投入，优先级中）

## 约定与落地要求

- 统一 API 调用入口：前端必须通过 `src/services/api/**` 调云函数，统一 401/错误处理。
- 统一 Auth：token 存储/过期处理由 `src/services/auth.js` 负责。
- 统一导航：跳登录、重置会话由 `src/services/navigation.js` 负责。
- 统一 UI：基础组件放在 `src/components/base/**`，领域组件放在 `src/components/domain/**`。

## 禁止事项（Hard No）
- 禁止直接复制旧项目的数据结构到新模型。
- 禁止在页面文件内堆业务计算/状态同步/复杂渲染逻辑。
- 禁止为“兼容历史字段”牺牲新模型清晰性（应通过迁移/映射层解决）。
<!-- END EMBED: docs/REFACTORING_MEMO.md -->
