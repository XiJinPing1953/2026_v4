# 2026_v4 强制约束（必须遵守）

本文件是项目的唯一强制约束文件，用于避免"旧堆积代码"复现。

## 最高优先级：官方规则

- 前端项目结构、配置文件位置、构建方式：严格遵循 **uni-app（Vue3 + Vite）官方模板**
- 云函数/数据库：严格遵循 **uniCloud 官方规则**，以当前已绑定的支付宝云空间为准

---

## 目录结构

```
src/                          # 前端源码（遵循官方 vite 模板）
├── pages/                    # 页面容器（只做编排，尽量短）
├── pages.json                # 路由与 tabBar 配置
├── manifest.json             # 应用配置（含 appid），uniCloud 关联依赖此处
├── main.js / App.vue         # 入口
├── static/                   # 静态资源
├── uni.scss                  # 全局样式/主题变量
├── components/
│   ├── base/                 # 基础组件（Button/Card/Modal/Tag…），不含业务
│   └── domain/               # 领域组件（SaleForm/BottleTimeline/AnomalyCard…）
├── composables/              # 组合式逻辑（页面不写复杂逻辑，抽到这里）
├── services/
│   ├── api/                  # 统一云函数调用封装（含 401/错误处理）
│   ├── models/               # 核心模型定义（新结构）
│   └── mappers/              # 旧字段/历史数据映射层（兼容代码唯一允许位置）
└── utils/                    # 纯工具函数（格式化、日期、排序等）

uniCloud-alipay/              # uniCloud 根目录（支付宝云空间）
├── cloudfunctions/           # 云函数
└── database/                 # 数据库 schema/索引
```

---

## 架构原则

### 1) 前后端分离
- 前端：UI/交互/编排
- 后端（uniCloud）：数据访问、权限校验、核心业务规则与写入
- 禁止把"状态更新/业务计算/兼容修补"堆在页面文件里

### 2) 页面瘦身
- `src/pages/**` 应尽量短：路由参数、调 composable、组合组件、布局编排
- 复杂展示与交互必须组件化：列表、筛选条、表单分段、时间线、异常卡片、统计卡片等
- 复杂业务计算抽离到 composable / service / 云函数

### 3) 兼容隔离
- 历史字段兼容只允许在 `src/services/mappers/**`
- 严禁在页面/组件中散布兼容 if 判断

### 4) 核心模型（不盲拷旧结构）
- 不继承旧项目里大量历史字段与兼容逻辑
- 新项目以清晰模型为主：Bottle / Sale / Filling / Customer / Vehicle / Anomaly / Log / User
- 如必须兼容历史数据：通过迁移/映射层处理

---

## 约定与落地要求

- **统一 API 调用**：前端必须通过 `src/services/api/**` 调云函数，统一 401/错误处理
- **统一 Auth**：token 存储/过期处理由 `src/services/auth.js` 负责
- **统一导航**：跳登录、重置会话由 `src/services/navigation.js` 负责
- **统一 UI**：基础组件放在 `src/components/base/**`，领域组件放在 `src/components/domain/**`

---

## 禁止事项（Hard No）

- 禁止直接复制旧项目的数据结构到新模型
- 禁止在页面文件内堆业务计算/状态同步/复杂渲染逻辑
- 禁止为"兼容历史字段"牺牲新模型清晰性（应通过迁移/映射层解决）
- 禁止随意变更 `src/manifest.json`、`uniCloud-alipay/` 位置与结构
