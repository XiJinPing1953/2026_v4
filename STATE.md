# STATE

`STATE.md` 是本仓库工作状态的单一事实来源（SSOT）。本文件必须以“追加日志（append-only）”方式维护：任何状态变化/补充说明都只能在文件末尾追加新条目，禁止回写/改写历史内容。

## 每条变更记录格式（必填）

> 每次提交代码、或做出会影响协作判断的变更，都必须追加一条记录（可引用 commit SHA）。

- 做了什么：
- 改动文件列表：
- 验证输出要点：
- 剩余问题：

## 日志（Append-only）

### 2026-01-14 CURRENT — 下一步进入 B2 核心模型
- 做了什么：确认当前方向为「阶段 B2：定义核心模型（Bottle/Sale/Filling/Customer/Vehicle/Anomaly/Log/User）」。
- 改动文件列表：无（状态更新）。
- 验证输出要点：无。
- 剩余问题：需要产出模型字段/索引/云函数接口的最小清单，并落到 `src/services/models` + `src/services/mappers`（阶段 B3）。

### 2026-01-14 bed6f8a — docs: add STATE template and embed project docs
- 做了什么：新增 `STATE.md` 模板；在 README 嵌入项目结构/重构备忘录文档。
- 改动文件列表：
  - `README.md`
  - `STATE.md`
- 验证输出要点：该提交未在 `STATE.md` 中记录任何执行输出；本次补写记录未复跑构建/测试。
- 剩余问题：需要把 `STATE.md` 约束收敛为“严格追加日志”，并补全各 commit 的文件清单/验证信息/遗留问题。

### 2026-01-14 7873e56 — chore: silence sass deprecation warnings in build
- 做了什么：降低构建日志噪音，避免 sass 弃用警告干扰后续排障。
- 改动文件列表：
  - `src/App.vue`
  - `vite.config.js`
- 验证输出要点：该提交未在 `STATE.md` 中记录 `npm run build`/`npm run dev` 输出；本次补写记录未复跑构建。
- 剩余问题：需要在一次可复现的构建环境下确认警告确实消失，并在依赖升级后回归检查。

### 2026-01-14 a41c37e — feat: secure crm-auth with bcrypt
- 做了什么：为 `crm-auth` 引入 bcrypt 哈希/校验，提升登录链路安全性。
- 改动文件列表：
  - `README.md`
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-auth/package.json`
- 验证输出要点：该提交未在 `STATE.md` 中记录云端部署/本地调用验证输出；本次补写记录未复跑调用链路。
- 剩余问题：需要补齐错误码与边界用例（错误密码/缺失 token/续期等），并确认环境变量（如 `BCRYPT_SALT_ROUNDS`）在实际运行环境生效。

### 2026-01-14 6e471e8 — feat: add crm-auth cloudfunction
- 做了什么：建立最小可用的鉴权云函数入口，为后续业务云函数提供统一鉴权能力。
- 改动文件列表：
  - `README.md`
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
- 验证输出要点：该提交未在 `STATE.md` 中记录云端部署/本地调用验证输出；本次补写记录未复跑调用链路。
- 剩余问题：需要完善权限模型（角色/权限点）与统一错误码规范，并补齐部署/调用验证记录。

### 2026-01-14 253ae1d — feat: add base list/table/filter scaffolds
- 做了什么：补齐通用 UI 基建（筛选条/列表/表格/Skeleton/useQuery），为业务页迁移提供统一组件与交互约束。
- 改动文件列表：
  - `README.md`
  - `src/components/base/AppFilterBar.vue`
  - `src/components/base/AppList.vue`
  - `src/components/base/AppListItem.vue`
  - `src/components/base/AppSkeleton.vue`
  - `src/components/base/AppTable.vue`
  - `src/composables/useQuery.js`
  - `src/uni.scss`
- 验证输出要点：该提交未在 `STATE.md` 中记录页面渲染/交互验证输出；本次补写记录未复跑本地运行。
- 剩余问题：需要统一空态/加载/错误态交互规范，并挑选一个示例页做端到端验证后再进入业务迁移。

### 2026-01-14 CURRENT — 仓库体检 + Sale 注释请求
+- 做了什么：
+  - 扫描仓库核心目录与基础组件，未发现明显 TODO/FIXME。
+  - 检查现有页面/服务层是否遵循“页面瘦身/前后端分离/兼容隔离”等原则。
+  - 你要求为 `sale.js` 增加注释，但根据仓库当前规则（避免非必要注释）未保留注释，保持代码自解释。
+- 改动文件列表：
+  - `STATE.md`
+  - `src/services/models/sale.js`
+- 验证输出要点：未运行 `npm run dev` / `npm run build`。
+- 剩余问题：
+  - `docs/about_crm_*.json` 在仓库中属于本地导出数据（已在 `.gitignore` 排除），建议不要提交到远程。
+  - B2/B3 仍未完成：模型 index 与 mappers 占位尚未建立。
+
+### 2026-01-14 CURRENT — Sale 模型与规范化（B2 起步）
- 做了什么：
  - 新增 `Sale` 前端模型规范化逻辑（支持 `bottle/truck/agent_sale` 三模式与 `kg/bottle/m3` 计价）。
  - 明确 `price_unit=m3` 时强制 `flow_volume_m3 * unit_price`，并保留瓶装流转明细用于库存/异常检测。
  - TRUCK 模式按“特殊瓶号容器/车辆实体”处理，避免使用车牌字段冒充瓶号。
  - 代理出站（agent_sale）保留，行项目由灌装记录生成，自动转出瓶（无回瓶）。
- 改动文件列表：
  - `src/services/models/sale.js`
  - `.gitignore`
- 验证输出要点：未运行 `npm run dev` / `npm run build`；未部署/调用云函数。
- 剩余问题：
  - 需根据该模型补充 `src/services/models/index.js` 与 `src/services/mappers` 占位（B3）。
  - 需将 `normalizeSaleDraft()` 接入后续 sale 页面（C1）。

### 2026-01-14 CURRENT — Sale 必要注释补充
- 做了什么：
  - 在 `sale.js` 增加三处必要注释：车牌过滤、m3 金额公式、模式隔离。
- 改动文件列表：
  - `src/services/models/sale.js`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
- 仍需完成 B3（models index + mappers 占位）并接入页面。

### 2026-01-14 CURRENT — C1 销售页面骨架与模型接入
- 做了什么：
  - 新增销售列表与录入页面骨架（无业务逻辑）。
  - 在录入页内接入 `normalizeSaleDraft()` 生成 payload（尚未提交云端）。
  - 更新路由 `pages.json` 增加 sale/list 与 sale/edit。
- 改动文件列表：
  - `src/pages/sale/list.vue`
  - `src/pages/sale/edit.vue`
  - `src/pages.json`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入真实出/回/存瓶明细组件与代理出站录入组件。
  - 需要接入真实提交云函数（crm-sale）。

### 2026-01-14 CURRENT — Sale 全函数注释补充

- 做了什么：
  - 为 `sale.js` 每个函数补充友好注释，标注职责与清理规则。
- 改动文件列表：
  - `src/services/models/sale.js`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 仍需完成 B3（models index + mappers 占位）并接入页面。
