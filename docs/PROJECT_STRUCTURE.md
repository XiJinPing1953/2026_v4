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
