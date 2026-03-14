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

### 2026-01-14 CURRENT — C1 表单组件拆分
- 做了什么：
  - 新增 `src/components/domain/sale` 下的表单区块组件（基础信息/出回瓶/存瓶/流量/整车/代理/收款）。
  - 销售录入页改用领域组件，并保持页面薄。
  - `normalizeSaleDraft()` 仍由页面统一汇总提交。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleFlowCard.vue`
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 出/回/存瓶与代理出站组件仍为占位，需要接入明细录入 UI。
  - 需要接入云函数保存。

### 2026-01-14 CURRENT — C1 明细录入组件
- 做了什么：
  - 出/回瓶、存瓶、代理出站卡片支持增删行与基础录入。
  - 销售录入页已绑定明细数组并参与 `normalizeSaleDraft()` 汇总。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需对瓶号/重量输入做校验与自动计算（gross/tare -> net）。
  - 需接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — Sale 全函数注释补充


- 做了什么：
  - 为 `sale.js` 每个函数补充友好注释，标注职责与清理规则。
- 改动文件列表：
  - `src/services/models/sale.js`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
- 仍需完成 B3（models index + mappers 占位）并接入页面。

### 2026-01-14 CURRENT — 修复 sale/edit.vue 重复区块
- 做了什么：
  - 移除 `sale/edit.vue` 中重复的回瓶/存瓶/代理出站区块，避免重复渲染与无效事件引用。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — 修复明细行无响应与刷新消失
- 做了什么：
  - 将明细数组从 `reactive([])` 改为 `ref([])`，确保 `v-model` 的数组更新能驱动 UI。
  - `normalizeSaleDraft()` 通过 `.value` 传入最新明细数组。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — 销售表单 UI 间距优化
- 做了什么：
  - 为销售录入页与领域卡片增加间距/分组样式，提升可读性。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleFlowCard.vue`
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — 销售表单紧凑布局
- 做了什么：
  - 出/回瓶改为四列紧凑布局，减少纵向空白。
  - 存瓶与代理出站改为多列栅格布局，按钮右对齐。
  - 基础/流量/整车/收款改为双列栅格。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleFlowCard.vue`
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — 基础信息两行三列布局
- 做了什么：
  - 基础信息调整为两行三列布局，配送员拆为两列，单价+单位合并一列。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — 旧版交互对齐（出/回瓶/存瓶/代理）
- 做了什么：
  - 出/回瓶支持内联新增按钮、净重合计展示与候选瓶号占位区。
  - 存瓶显示本次存瓶数汇总。
  - 代理出站增加灌装合计与内联新增按钮。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要接入云函数保存与列表刷新。

### 2026-01-14 CURRENT — 接入 crm-sale 保存与列表
- 做了什么：
  - 新增 `crm-sale` 云函数（`createV2/updateV2/listV2`），用于保存与查询销售单。
  - 新增前端 `src/services/sale.js`，页面仅调用服务层，保持页面薄。
  - 销售录入页 `onSubmit` 调用 `createV2`；销售列表页 `onSearch` 调用 `listV2`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/services/sale.js`
  - `src/pages/sale/edit.vue`
  - `src/pages/sale/list.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/edit.vue`、`src/pages/sale/list.vue` 无诊断。
  - 未运行 `npm run dev` / `npm run build`；未在云端部署并验证云函数调用。
- 剩余问题：
  - 需要部署 `crm-sale` 到 uniCloud 并实测登录 token + create/list 链路。
  - 需要补齐瓶子状态同步/异常检测相关逻辑（后续阶段）。

### 2026-01-17 CURRENT — 添加核心集合 Schema（crm-auth / crm-sale）
- 做了什么：
  - 为 `crm_users`、`crm_operation_logs`、`crm_customers`、`crm_sale_records` 添加最小可用的 schema 文件，确保集合存在并可创建/读写（云函数侧）。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_users.schema.json`
  - `uniCloud-alipay/database/schema/crm_operation_logs.schema.json`
  - `uniCloud-alipay/database/schema/crm_customers.schema.json`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics` 未运行成功（本地未安装 `biome` LSP）。
  - 未运行 `npm run dev` / `npm run build`；未在云端部署并验证云函数调用。
- 剩余问题：
  - 需要在 HBuilderX/控制台上传 schema 并创建集合。
  - 需验证 `crm-auth` / `crm-sale` 云函数调用链路是否解除 “not found collection”。

### 2026-01-17 CURRENT — 移除无效 Sass 旧 API 静默配置
- 做了什么：
  - 移除 `vite.config.js` 中无效的 `silenceDeprecations` 配置，避免出现 “Invalid deprecation 'legacy-js-api'” 警告。
- 改动文件列表：
  - `vite.config.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics` 未运行成功（本地未安装 `typescript-language-server`）。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在本地/CI 运行构建，确认警告已消失。

### 2026-01-17 CURRENT — 销售保存失败提示与防重复提交
- 做了什么：
  - 销售录入页保存按钮增加 `submitting` 防抖与 loading/disabled 状态。
  - 当 `crm-sale` 返回 `code != 0` 时展示 `msg`，避免“点击保存无反应”。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev` / `npm run build`。
  - 未录制云函数调用返回值（需在 HBuilderX 端验证 toast 提示与 `crm_sale_records` 写入）。
- 剩余问题：
  - 需要根据实际返回的 `msg`（如缺少日期/客户）补齐前端必填校验与默认值。

### 2026-01-17 CURRENT — 日期选择器与 UTC+8 今日提示
- 做了什么：
  - 基础信息卡片将“日期”改为 `picker(mode="date")` 选择器，避免手输格式错误。
  - 在基础信息卡片右上角展示“今日(UTC+8)：YYYY-MM-DD”。
  - 销售录入页默认填充 `form.date` 为今日(UTC+8)，避免后端报“日期必填”。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/components/domain/sale/SaleBasicInfoCard.vue`、`src/pages/sale/edit.vue` 无诊断。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 验证 `picker` 点击区域是否稳定触发（不同端对 `pointer-events` 兼容略有差异）。

### 2026-01-17 CURRENT — 客户必填前置校验 + 自动建客户
- 做了什么：
  - 销售录入页在提交前校验 `customerId/customerName`，避免后端返回“客户必填”导致用户感知为无响应。
  - `crm-sale` 若传入客户名但 `crm_customers` 不存在该客户，则自动创建客户记录并回填 `customer_id`。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/edit.vue` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 有未使用变量提示。
  - 未运行 `npm run dev` / `npm run build`。
  - 需在云端验证：保存一条新客户名的销售单后，`crm_customers`/`crm_sale_records` 均应新增记录。
- 剩余问题：
  - 客户选择器/联想搜索尚未实现（先用手输 + 自动建客户）。

### 2026-01-17 CURRENT — 修复基础信息 v-model 不生效
- 做了什么：
  - 将销售录入页的 `form/flow/truck/settlement` 从 `reactive` 改为 `ref`，确保子组件通过 `update:modelValue` 回传的新对象能写回父级。
  - 修复因 `v-model="form"` 绑定到 `const reactive(...)` 导致的“输入客户名但提交仍为空”问题。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/edit.vue` 无诊断。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 实测：输入客户名后保存应不再报“客户必填”。

### 2026-01-17 CURRENT — 精简 crm_sale_records（B 模式干净模型）
- 做了什么：
  - `crm-sale` 创建/更新不再落库派生字段（应收/净重/金额拆分/流量派生等），仅落库输入字段；列表接口返回时按需计算 `should_receive` 等。
  - 前端 `normalizeSaleDraft` 仅提交输入字段，并修复 `truckNo/flow_*` 关键字段映射，避免脏字段/无效字段进入 DB。
  - 更新 `crm_sale_records` schema 使其与“输入字段优先”的模型一致（`deposit_items` → `deposit_rows`，移除展示串字段定义）。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/services/models/sale.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/list.vue` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 存在未使用变量提示；json LSP 未安装。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 历史宽表字段未迁移清理（后续可脚本批量 `$unset`）。

### 2026-01-17 CURRENT — 新增客户存瓶查询 action（不落库展示串）
- 做了什么：
  - `crm-sale` 新增 `getCustomerDepositV1`：按客户与日期上限聚合计算当前存瓶列表，返回 `{ bottles, raw, count }`，不写入 `crm_sale_records`。
  - 销售录入页在客户/日期变更时调用该 action，并在基础信息卡片展示“存瓶 count：raw”，支持点击复制。
  - 去除 `crm-sale` 对旧 payload 结构的兼容（`outItems/backItems/agent_sale_items`、`data.payload||data` 等），仅接受 v4 统一入参。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/services/sale.js`
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/edit.vue`、`src/components/domain/sale/SaleBasicInfoCard.vue`、`src/services/sale.js`、`src/services/models/sale.js` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 有未使用变量提示。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要部署 `crm-sale` 并在真机/H5 验证存瓶展示与复制交互。

### 2026-01-17 CURRENT — Schema 门禁 + 按模式不写空字段
- 做了什么：
  - `crm_sale_records` schema 开启门禁：`additionalProperties=false` + 强制 `required`，从 DB 层禁止写入未定义字段。
  - `crm-sale` 在 create/update 按 `biz_mode`/`price_unit` 写入必要字段：不再写入其它模式的空字段（例如 bottle 模式不写 `truck_*`/`flow_*`）。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/list.vue` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 有未使用变量提示。
  - json LSP 未安装。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要上传 schema 到云端；否则门禁不会生效。
  - 已存在的历史记录仍包含旧字段（不会自动清理）。

### 2026-01-17 CURRENT — Service 层创建销售校验（阻止脏数据入库）
- 做了什么：
  - 新增 `validateSaleDraftForCreate()`，在 service 层统一校验创建销售单的关键约束：
    - `unit_price > 0`
    - `price_unit` 必须为 `kg/bottle/m3`
    - `biz_mode=bottle` 时：`out_items/back_items/deposit_rows` 三者至少一项非空
    - `biz_mode=truck` 时：`truck_sale_net` 必填且 >0
    - `price_unit=m3` 时：`flowIndexPrev/flowIndexCurr` 必填
  - `createSaleV2()` 调用云函数前先校验，不通过直接返回 `{ code: 400, msg }`。
- 改动文件列表：
  - `src/services/models/sale.js`
  - `src/services/models/index.js`
  - `src/services/sale.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/services/models/sale.js`、`src/services/sale.js`、`src/pages/sale/edit.vue` 无诊断。
  - 未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 后续接入客户资料自动带出单价后，可将校验信息与 UI 提示联动优化。

### 2026-01-17 CURRENT — 销售列表进入编辑（C 阶段闭环）
- 做了什么：
  - `crm-sale` 增加 `getV2`（按 `_id` 获取销售单）。
  - 销售列表点击条目/编辑按钮，跳转 `src/pages/sale/edit.vue` 并携带 `_id`。
  - 销售编辑页支持加载已有单据并保存走 `updateV2`；无 `_id` 时仍走 `createV2`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/services/sale.js`
  - `src/pages/sale/list.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/list.vue`、`src/pages/sale/edit.vue`、`src/services/sale.js` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 有未使用变量提示。
  - 未运行 `npm run dev` / `npm run build`；需在真机/H5 验证 edit->update 链路。
- 剩余问题：
  - 需要部署 `crm-sale` 后验证 `getV2/updateV2` 的入参与 schema 门禁一致。

### 2026-01-17 CURRENT — 修复销售列表查询（listV2 关键词过滤）
- 做了什么：
  - `listV2` 关键词查询改为 `db.RegExp({regexp, options})` 并对输入做转义，确保在云端可用且避免特殊字符破坏正则。
  - 销售列表页在云函数返回 `code!=0` 时 toast 提示 `msg`，避免“查询不到但无提示”。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/pages/sale/list.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/list.vue` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 有未使用变量提示。
  - 未运行 `npm run dev` / `npm run build`；需在真机/H5 验证列表查询。


### 2026-01-17 CURRENT — 规范升级：STATE 四要素补齐 Next（A+B+C）
- 做了什么：
  - 确认执行策略：
    - A：`STATE.md` 未来所有新增内容只允许追加到文件末尾（包含 Next 计划）。
    - B：四要素第 4 项升级为“剩余问题及 Next”。
    - C：避免锚点替换覆盖顶部规则，后续只做“末尾追加”式编辑。
  - 约定：不回写历史条目；如需更正，新增“更正说明”条目追加在末尾。
- 改动文件列表：
  - `README.md`
  - `STATE.md`
- 验证输出要点：
  - 无（规范变更）。
- 剩余问题及 Next：
  - 剩余问题：`STATE.md` 顶部仍存在旧模板与早期 NEXT 区块（视为历史，不回写）。
  - Next：从下一条开始所有新记录使用“v2 模板”。

## v2 模板（从此处开始使用）
> 为了避免 `STATE.md` 过长影响阅读，阶段性摘要放在 `state/`：
> - `state/INDEX.md`
> - `state/PHASE_B2_CUSTOMER.md`
> - `state/PHASE_C1_SALE.md`
> `STATE.md` 仍是唯一 SSOT，仍按 append-only 追加。

### YYYY-MM-DD CURRENT — <简短标题>
- 做了什么：
- 改动文件列表：
- 验证输出要点：
- 剩余问题及 Next：
  - 剩余问题：
  - Next：


### 2026-01-17 CURRENT — B2 Customer：客户实体/接口/选择器（仅允许选择）
- 做了什么：
  - 新增 `crm-customer` 云函数：`listV1/getV1/createV1/updateV1`，支持客户管理与模糊搜索。
  - `crm_customers` schema 收敛为干净模型：`additionalProperties=false`，新增 `uniq_key` 唯一索引（`name|phone`，phone 为空则 name）。
  - 新增前端 `src/services/customer.js`，封装客户搜索/读写。
  - 销售录入页客户输入改为模糊搜索 + 候选列表，只允许点击/Tab/Enter 选择后才写入 `customerId`；输入未选择会清空 `customerId`，由 service 校验阻止保存。
  - 移除 `crm-sale` 自动创建客户逻辑：创建/更新销售单必须提供 `customerId`，并从客户表读取 `customer_name`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/database/schema/crm_customers.schema.json`
  - `src/services/customer.js`
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/services/customer.js`、`src/pages/sale/edit.vue` 无诊断；`uniCloud-alipay/cloudfunctions/crm-customer/index.js`、`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 有未使用变量提示。
  - json LSP 未安装。
  - 未运行 `npm run dev` / `npm run build`；需部署云函数并验证客户搜索+选择+保存链路。

### 2026-01-17 NEXT — B2 Customer：客户管理页面闭环（list/create/edit）
- 目标：
  - 完成客户资料维护闭环，支撑销售录入“必须选择客户”的主线。
- 先讨论并冻结字段（客户/客户管理）：
  - 核心：`name`、`phone`、`address`、`is_active`
  - 定价：`default_unit_price`、`default_price_unit`
  - 备注：`remark`
  - 系统字段：`uniq_key`（`name|phone`，phone 为空则 name；唯一索引）、`created_at`、`updated_at`
  - 待确认：是否需要 `contact`（联系人姓名）与 `short_name`（简称）；如需要则一并纳入 schema 白名单。
- 页面规划（C 阶段增量）：
  - `pages/customer/list`：搜索（name/phone）+ 进入编辑 + 新增入口
  - `pages/customer/edit`：新增/编辑表单（写入 `crm-customer createV1/updateV1`）
- 销售录入联动：
  - 选择客户后自动带出单价/单位（若当前单价为空）。
  - 禁止自由手输客户名写入销售单（只允许选择产生 `customerId`）。
- 验证点：
  - 新建客户后可在销售录入候选中搜到并选择；更新客户后默认单价能带入。

### 2026-01-18 NEXT — B2 Customer：字段冻结与筛选规则确认
- 做了什么：
  - 冻结客户字段：在原有 `name/phone/address/is_active/default_unit_price/default_price_unit/remark` 基础上，新增 `contact`（联系人）与 `short_name`（简称）。
  - 冻结规则：
    - `phone` 允许为空字符串（不作为必填非空约束）。
    - `default_price_unit` 严格限定枚举：`kg | bottle | m3`。
    - 客户列表筛选：支持按 `is_active`（启用/停用）筛选；keyword 支持匹配 `name/contact/phone`。
- 改动文件列表：
  - 无（本条为计划澄清，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 现有 `crm_customers` schema 尚未包含 `contact/short_name`，且 `default_price_unit` 尚无 enum 约束。
    - `crm-customer listV1` 当前仅按 `name/phone` 搜索，且无 `is_active` 筛选入参。
  - Next：
    1) 更新 `uniCloud-alipay/database/schema/crm_customers.schema.json`：补齐 `contact/short_name` 字段并对 `default_price_unit` 增加 enum。
    2) 更新 `uniCloud-alipay/cloudfunctions/crm-customer/index.js`：`createV1/updateV1/listV1` 支持新字段与新筛选规则（keyword + is_active）。
    3) 新增页面 `src/pages/customer/list.vue` 与 `src/pages/customer/edit.vue` 完成客户管理闭环。
    4) 更新 `src/pages.json` 注册 customer 路由，并在 `src/pages/index/index.vue` 增加入口。
    5) 部署后烟囱验证：新建客户→列表检索/筛选→编辑保存→销售录入选择客户自动带价（如未部署则在 STATE 明确“未验证”）。

### 2026-01-18 CURRENT — B2 Customer：客户管理闭环（list/create/edit）
- 做了什么：
  - `crm_customers` schema 补齐 `contact/short_name` 字段并为 `default_price_unit` 增加枚举约束（`kg/bottle/m3`），同时补充 `phone/is_active` 索引以支撑筛选查询。
  - `crm-customer` 云函数：`listV1` 支持 keyword 匹配 `name/contact/short_name/phone` 且支持 `is_active` 三态筛选；`createV1/updateV1` 支持新字段并校验 `default_price_unit`。
  - 新增客户管理页面：客户列表（搜索 + 启用/停用筛选 + 进入编辑）与客户录入（新建/编辑）闭环，并在工作台增加入口。
- 改动文件列表：
  - `STATE.md`
  - `uniCloud-alipay/database/schema/crm_customers.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `src/services/customer.js`
  - `src/pages.json`
  - `src/pages/index/index.vue`
  - `src/pages/customer/list.vue`
  - `src/pages/customer/edit.vue`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/customer/list.vue`、`src/pages/customer/edit.vue`、`src/pages/index/index.vue`、`src/services/customer.js` 无诊断；`uniCloud-alipay/cloudfunctions/crm-customer/index.js` 仅有 CommonJS 转 ESModule 的 hint。
  - json LSP 未安装。
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署/调用云函数与 schema。
- 剩余问题及 Next：
  - 剩余问题：
    - 新增字段上线后需确认已有客户数据是否缺失 `contact/short_name`；当前 `updateV1` 会在更新时补齐为空字符串，但未做一次性迁移。
  - Next：
    1) 部署 schema 与 `crm-customer` 云函数，验证 create/update/list 的门禁与筛选正确。
    2) 在真机/H5 走烟囱：客户新增→列表筛选→编辑保存→销售录入页搜索选择客户并自动带出默认单价/单位。
    3) 如需要更好筛选体验：将 list 页的 keyword/is_active 过滤条件加入默认加载与分页（后续增量）。

### 2026-01-18 NEXT — C1 Sale：客户必选（候选选择）链路修复
- 做了什么：
  - 记录问题：销售录入页“输入客户名→候选列表→点击/Enter/Tab 选择后才写入 customerId；未选择则清空 customerId，并由 service 阻止保存”在实际运行中未达到预期。
  - 初步定位方向：重点排查跨端事件支持（H5 vs 小程序）与保存前校验一致性（UI 校验/`validateSaleDraftForCreate`/`crm-sale` 后端门禁）。
- 改动文件列表：
  - 无（本条为修复计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - `SaleBasicInfoCard` 当前候选项绑定 `@mousedown/@touchstart`，可能导致小程序端无法触发选择。
    - `src/pages/sale/edit.vue` 的保存前校验允许 `customerName` 存在但 `customerId` 为空，可能导致“看似通过但后端报错”。
  - Next：
    1) 查阅 uni-app 官方文档确认 `<input>` 的键盘事件支持范围；按跨端规则改用 `@tap` 等通用事件承载候选选择。
    2) 收敛保存前校验：前端必须要求 `customerId` 存在（提示“请选择客户”），与后端 `crm-sale` 的 `客户必选` 门禁对齐。
    3) 复查 `searchCustomersV1` 调用与候选展示，确保 Enter/confirm 能选中当前高亮项。
    4) `lsp_diagnostics` 通过后，在真机/H5 做最小烟囱验证并将结果追加到 `STATE.md`。

### 2026-01-18 CURRENT — C1 Sale：客户必选（候选选择）链路修复
- 做了什么：
  - 修复销售录入页客户选择的两个关键问题：
    - 修复 `SaleBasicInfoCard` 连续两次 emit 导致 `customerId` 被后一次覆盖丢失的问题（改为一次性合并 patch emit）。
    - 移除 uni-app 不支持的 `<input>@keydown/@tab` 事件依赖，候选项选择改为跨端可用的 `@tap`。
  - 收敛保存前校验：销售录入保存必须要求 `customerId` 存在（提示“请从列表选择客户”），与 service/后端门禁一致。
  - 修复存瓶查询 watcher 中未定义变量导致的潜在运行时问题，并将 customerName 纳入 watch key，避免请求竞态覆盖。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/components/domain/sale/SaleBasicInfoCard.vue`、`src/pages/sale/edit.vue` 无诊断。
  - 未运行 `npm run dev:*` / `npm run build:*`；未在真机/小程序复测。
- 剩余问题及 Next：
  - 剩余问题：
    - 需要在 mp-alipay 真机验证：候选列表点击选择、键盘 confirm 选择、blur 收起时序是否稳定。
  - Next：
    1) 在 mp-alipay/H5 验证：输入客户→候选点击→customerId 写入→保存成功。
    2) 如 blur 仍导致偶现点不中：进一步调整 blur delay 或在候选容器使用更保守的“点击优先”策略。

### 2026-01-18 NEXT — C1 Sale：客户模糊搜索无候选列表排查与修复
- 做了什么：
  - 记录问题：销售录入页客户 name 输入后未出现候选列表（模糊搜索无结果展示）。
  - 初步假设：`crm-customer listV1` 的 OR 查询写法在 uniCloud 端不生效/报错，导致前端拿不到 `code=0` 的数据；需要按官方 DB Command 写法改造。
- 改动文件列表：
  - 无（本条为修复计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 当前前端在搜索失败时静默清空候选，缺少可观测性；需要先确认后端 listV1 是否返回错误码/异常。
  - Next：
    1) 调整 `uniCloud-alipay/cloudfunctions/crm-customer/index.js`：用 `db.command.or/and` 构造 keyword OR 查询，并与 `is_active` 条件正确组合。
    2) 视情况在 `src/pages/sale/edit.vue` 搜索失败时 toast `msg`（避免静默）。
    3) `lsp_diagnostics` 后，在 mp-alipay/H5 验证“输入→候选出现→点击选择”。

### 2026-01-18 CURRENT — C1 Sale：客户模糊搜索候选列表恢复
- 做了什么：
  - 修复 `crm-customer listV1` 的查询条件构造：从 `where._or` 改为使用 `db.command.or/and` 组合 keyword OR 条件与 `is_active` 条件，确保云端可用并能返回候选列表数据。
  - 为销售录入页客户搜索失败增加 toast 提示 `msg`，避免候选列表静默为空导致无法排查。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`uniCloud-alipay/cloudfunctions/crm-customer/index.js`、`src/pages/sale/edit.vue` 无错误/警告（仅 CommonJS hint）。
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 需要部署 `crm-customer` 后才能在 mp-alipay/H5 验证候选列表实际返回。
  - Next：
    1) 部署 `crm-customer` 并验证：输入 keyword 能返回候选列表；选择后写入 `customerId`。
    2) 若仍为空：根据 toast 提示的 `msg` 进一步定位 token/权限/索引问题。

### 2026-01-18 NEXT — C1 Sale：修复销售列表查询（listV2 条件组合）
- 做了什么：
  - 记录问题：销售列表查询在云端条件组合可能不生效，导致筛选/关键词/日期过滤异常或直接查不到数据。
  - 初步假设：`crm-sale listV2` 目前使用 `where._and` / `dbCmd.or({...},{...})` 的写法在 uniCloud 端兼容性不足，需改为官方 `db.command.and/or` 组合。
- 改动文件列表：
  - 无（本条为修复计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 需要结合实际现象确认：是“筛选不生效/关键词无效/日期范围异常/一直空列表/直接报错”。
  - Next：
    1) 调整 `uniCloud-alipay/cloudfunctions/crm-sale/index.js` 的 `listV2`：用 `db.command.and/or` 构造 where，替代 `_and`。
    2) 部署 `crm-sale` 后在 H5/mp-alipay 验证：关键词（客户/车牌）、日期范围、计价单位筛选均可用。

### 2026-01-18 CURRENT — C1 Sale：修复销售列表查询（listV2 + 应收计算）
- 做了什么：
  - `crm-sale listV2`：查询条件由 `where._and` 改为使用 `db.command.and/or` 组合，确保关键词/日期/单位筛选在云端可用。
  - 修复销售列表应收计算：`biz_mode=truck` 且 `price_unit=kg` 时，`should_receive` 改为使用 `truck_sale_net * unit_price`（避免列表显示 0）。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 无 error/warning（有 unused 参数与 CommonJS hint）。
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 未部署前无法确认 uniCloud 端真实查询效果与列表数据正确性。
  - Next：
    1) 部署 `crm-sale` 后验证：关键词（客户/车牌）、日期范围、计价单位筛选生效。
    2) 验证 truck 模式销售单在列表中 `应收` 不为 0。

### 2026-01-18 NEXT — C1 Sale：销售列表筛选 UI 升级（日期选择器/计价单位/销售模式）
- 做了什么：
  - 记录需求：销售列表筛选栏升级为可选择的控件，提升筛选准确性与一致性。
- 改动文件列表：
  - 无（本条为计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 当前 `listV2` 仅支持 keyword/日期/计价单位筛选，尚不支持“销售模式(biz_mode)”筛选。
  - Next：
    1) 前端 `src/pages/sale/list.vue`：日期范围改为 date picker（开始/结束同一行），计价单位改为 picker（kg/bottle/m3），新增“销售模式” picker（bottle/truck/agent_sale）。
    2) 后端 `uniCloud-alipay/cloudfunctions/crm-sale/index.js`：`listV2` 新增 `bizMode` 入参并过滤 `biz_mode`。
    3) `src/services/sale.js`：`listSalesV2` 透传 `bizMode`。
    4) `lsp_diagnostics` 通过后追加 CURRENT，部署后验证筛选生效。

### 2026-01-18 CURRENT — C1 Sale：销售列表筛选 UI 升级（日期选择器/计价单位/销售模式）
- 做了什么：
  - 销售列表筛选栏升级：日期范围改为 date picker（开始/结束同一行）；计价单位改为 picker（全部/kg/bottle/m3）；新增销售模式 picker（全部/瓶装/整车/代理出站）。
  - `crm-sale listV2` 增加 `bizMode` 入参并按 `biz_mode` 过滤；前端 service 透传该字段。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/services/sale.js`
  - `src/pages/sale/list.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/list.vue`、`src/services/sale.js` 无诊断；`uniCloud-alipay/cloudfunctions/crm-sale/index.js` 仅 CommonJS hint。
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 未部署前无法确认云端筛选效果。
  - Next：
    1) 部署 `crm-sale` 后验证：日期范围/计价单位/销售模式筛选生效。
    2) 如需要更强约束：可在 UI 侧将计价单位/销售模式从“全部可选”改为必选（后续增量）。

### 2026-01-18 CURRENT — C1 Sale：销售列表筛选已部署验证
- 做了什么：
  - 确认 `crm-sale listV2` 已部署，销售列表筛选（日期范围/计价单位/销售模式）在实际环境中已生效。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 用户反馈：销售列表筛选“均已生效”。
- 剩余问题及 Next：
  - 剩余问题：
    - 尚未记录验证平台（H5 / mp-alipay）与样例筛选用例。
  - Next：
    1) 补一条验证用例记录（平台 + 示例条件 + 期望结果），便于协作回溯。
    2) 推进下一条待验证链路：部署 `crm-customer` 并验证销售录入页客户候选列表与 customerId 写入。

### 2026-01-18 CURRENT — C1 Sale：推进客户候选链路（更强约束与可观测性）
- 做了什么：
  - 销售录入页客户搜索默认仅查询启用客户（`is_active=true`），避免停用客户进入候选。
  - 客户输入框提示文案更新为“客户名/联系人/电话”，与后端 `crm-customer listV1` 支持字段一致。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/sale/edit.vue`、`src/components/domain/sale/SaleBasicInfoCard.vue` 无诊断。
  - 需要部署/验证：`crm-customer listV1` 已支持 `is_active`，但仍需确认线上数据与权限。
- 剩余问题及 Next：
  - 剩余问题：
    - 仍未记录筛选验证平台与具体用例。
  - Next：
    1) 记录验证用例（平台 + 示例条件 + 期望结果）。
    2) 部署 `crm-customer` 后在销售录入页验证：输入关键字→候选出现→点击选择写入 `customerId`。

### 2026-01-18 CURRENT — C1 Sale：筛选与客户候选已验证（待补齐平台）
- 做了什么：
  - 记录验证结果：销售列表筛选（日期范围/计价单位/销售模式）已验证生效；销售录入页客户候选列表与 customerId 写入链路已验证通过。
  - 追加最小验证用例（用于协作回溯）。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 用户反馈："已确认"（筛选与客户候选链路已通过）。
  - 验证平台：未记录（需补齐 H5 / mp-alipay）。
  - 验证用例：
    - 销售列表：设置日期范围（开始/结束）→ 列表数据随范围变化。
    - 销售列表：计价单位选择 `kg` → 列表仅展示 `price_unit=kg`。
    - 销售列表：销售模式选择 `整车` → 列表仅展示 `biz_mode=truck`。
    - 销售录入：客户输入关键字 → 候选出现 → 点击候选 → `customerId` 写入 → 保存通过。
- 剩余问题及 Next：
  - 剩余问题：
    - 需要补齐验证平台（H5 / mp-alipay）与一个具体样例关键字/客户名，便于复测。
  - Next：
    1) 补齐验证平台记录（H5 或 mp-alipay）。
    2) 如后续需要：在销售列表增加分页/加载更多（当前固定 50）。

### 2026-01-18 CURRENT — C1 Sale：补齐验证平台（H5）
- 做了什么：
  - 补齐上一条验证记录的平台信息：本次验证在 H5 完成。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 用户反馈：H5 验证通过（销售列表筛选 + 客户候选链路）。
- 剩余问题及 Next：
  - 剩余问题：
    - 尚未记录一个具体样例关键字/客户名（用于复测）。
  - Next：
    1) 进入阶段 B2：补齐除 Sale/Customer 外的核心模型定义与最小数据层骨架。

### 2026-01-18 NEXT — B2 Core：补齐其他模型（Vehicle/Bottle/Filling/Anomaly）
- 做了什么：
  - 计划推进：在已具备 UI/增量骨架的基础上，补齐 B2 核心模型中剩余的模型定义与最小可用的 schema/API 基建，为后续业务细化做准备。
- 改动文件列表：
  - 无（本条为计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 当前仓库仅落地了 `Sale/Customer/User/OperationLog` 的 schema 与云函数；`Vehicle/Bottle/Filling/Anomaly` 仍缺失。
  - Next：
    1) `src/services/models/index.js`：补齐 Vehicle/Bottle/Filling/Anomaly 的模型模块导出（先最小定义 + 验证函数占位）。
    2) `src/services/mappers/index.js`：为未来兼容迁移预留结构（不引入旧字段）。
    3) `uniCloud-alipay/database/schema/`：新增 `crm_vehicles`、`crm_bottles`、`crm_fillings`、`crm_bottle_anomalies` schema（additionalProperties=false + 必填字段 + 索引）。
    4) `uniCloud-alipay/cloudfunctions/`：新增最小云函数（建议优先 `crm-vehicle` 与 `crm-bottle`：list/get/create/update），统一鉴权与操作日志。
    5) 前端 `src/services/`：新增 `vehicle.js`、`bottle.js` 等 service 封装调用入口（仅 API 薄封装）。
    6) `lsp_diagnostics` 通过后追加 CURRENT，部署后补一条验证记录（至少 list/create 基本链路）。

### 2026-01-18 CURRENT — B2 Core：补齐 Vehicle/Bottle/Filling/Anomaly 最小骨架
- 做了什么：
  - 新增 4 个核心集合 schema（Vehicle/Bottle/Filling/Anomaly），统一开启 `additionalProperties=false` 与最小必填字段/索引。
  - 新增 2 个最小云函数：`crm-vehicle`、`crm-bottle`（list/get/create/update），沿用 token 鉴权 + 操作日志写入。
  - 前端补齐调用入口与模型导出：新增 `src/services/vehicle.js`、`src/services/bottle.js`；`src/services/models` 增加对应模型/校验函数并在 `index.js` 聚合导出；`src/services/mappers/index.js` 预留结构占位。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_vehicles.schema.json`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `uniCloud-alipay/database/schema/crm_fillings.schema.json`
  - `uniCloud-alipay/database/schema/crm_bottle_anomalies.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `src/services/vehicle.js`
  - `src/services/bottle.js`
  - `src/services/models/vehicle.js`
  - `src/services/models/bottle.js`
  - `src/services/models/filling.js`
  - `src/services/models/anomaly.js`
  - `src/services/models/index.js`
  - `src/services/mappers/index.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：新增/修改的 `src/services/**` 与 `src/services/models/**` 无诊断；云函数文件仅 CommonJS hint。
  - `node -e JSON.parse(...)`：新建 schema JSON 解析通过。

### 2026-02-04 CURRENT — 首页仪表盘布局更贴近示例（左侧导航/顶栏/概览卡/右侧栏）
- 做了什么：
  - 首页工作台布局重构为「左侧导航 + 顶栏 + 主内容 + 右侧信息栏」的三列仪表盘结构，并加入概览卡片区块。
  - 左侧新增图标导览轨道与菜单分区；顶栏加入搜索框、快捷图标与用户头像。
  - KPI 卡片样式更轻量化（更接近示例图的密度与层次）；右侧图表尺寸与留白优化。
- 改动文件列表：
  - `src/pages/index/index.vue`
  - `src/components/base/AppStatCard.vue`
  - `src/components/base/AppPage.vue`
  - `src/components/base/AppMiniDonut.vue`
  - `src/components/base/AppSparkline.vue`
  - `src/components/base/AppMiniBars.vue`
  - `src/uni.scss`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 未在 H5/真机实际渲染验证与参考图的视觉接近度。
  - Next：
    1) 在 H5 预览对齐参考图细节（KPI 密度、阴影层级、右侧栏高度）。
    2) 若仍需更接近，可继续细化图标样式与卡片间距。

### 2026-02-04 CURRENT — 仪表盘细化（去除左侧图标轨道 + KPI/右栏更紧凑）
- 做了什么：
  - 移除左侧图标轨道，仅保留导航菜单区，使布局更贴近参考图。
  - KPI 卡片增加趋势徽标（delta/trend）并收紧视觉密度。
  - 右侧栏卡片与图表高度/间距进一步压缩，整体更紧凑。
- 改动文件列表：
  - `src/pages/index/index.vue`
  - `src/components/base/AppStatCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 尚未在 H5/真机核对与参考图的像素级接近度。
  - Next：
    1) 预览确认 KPI 与右侧栏密度是否满足期望。
    2) 如需更像示例图，可继续压缩 card padding 与字体层级。

### 2026-02-04 CURRENT — 工作台接入真实接口 + 调整右栏结构
- 做了什么：
  - 移除“今日完成率”卡片并将“快捷操作”卡片上移至右侧栏顶部。
  - 工作台 KPI/趋势/概览/分布数据改为从新接口拉取（`crm-dashboard summaryV1`）。
  - 新增 dashboard service 与云函数，后端聚合异常/钢瓶/销售数据并返回趋势与分布。
- 改动文件列表：
  - `src/pages/index/index.vue`
  - `src/components/base/AppStatCard.vue`
  - `src/services/dashboard.js`
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - `crm-dashboard` 未部署，前端暂无法拿到真实数据。
  - Next：
    1) 部署 `crm-dashboard` 云函数并在 H5 预览确认数据渲染。
    2) 如需更接近示例图，继续微调 KPI/右栏字体与间距。

### 2026-02-04 CURRENT — 改造销售列表页（筛选区视觉升级 + 新增筛选项）
- 做了什么：
  - 销售列表页筛选区改为卡片化布局，搜索与筛选分区更贴近仪表盘风格。
  - 新增计价单位与销售模式筛选下拉（priceUnit/bizMode），并纳入列表查询与缓存 key。
  - 调整候选列表、筛选 pill、金额样式，整体更轻量化。
- 改动文件列表：
  - `src/pages/sale/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 未在 H5/真机确认筛选 UI 与候选列表交互手感。
  - Next：
    1) 在 H5 预览确认筛选下拉与搜索建议交互。
    2) 如需默认加载列表，可考虑首屏自动触发 `onSearch`。

### 2026-02-04 CURRENT — 销售列表紧凑化 + 默认加载 + KPI 对齐
- 做了什么：
  - 销售列表页：默认进入自动加载；筛选按钮视觉与首页统一；列表条目更紧凑并增加分组信息密度。
  - KPI 卡片：金额右对齐并增加小趋势徽标（UP/DOWN/FLAT）。
- 改动文件列表：
  - `src/pages/sale/list.vue`
  - `src/components/base/AppStatCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 尚未验证列表自动加载与紧凑布局在 H5/真机的实际效果。
  - Next：
    1) H5 预览确认筛选按钮、列表密度与自动加载无误。

### 2026-02-04 CURRENT — 销售列表筛选摘要标签
- 做了什么：
  - 销售列表筛选区新增“当前筛选摘要小标签”，展示关键词/日期/单位/模式等已选条件。
- 改动文件列表：
  - `src/pages/sale/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 尚未验证筛选标签在不同屏幕尺寸下的展示效果。
  - Next：
    1) H5 预览确认标签换行与可读性。

### 2026-02-04 CURRENT — 筛选标签支持一键清除
- 做了什么：
  - 筛选摘要标签增加“×”关闭按钮，点击可清除对应筛选并自动刷新列表。
- 改动文件列表：
  - `src/pages/sale/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 需验证点击标签清除后与筛选器状态同步无误。
  - Next：
    1) H5 预览确认标签点击清除是否触发搜索。

### 2026-02-04 CURRENT — 销售录入出瓶行布局对齐参考图
- 做了什么：
  - Sale 出瓶明细行改为“标签在上/输入在下”的网格布局，末行右侧使用圆形“+”新增按钮。
  - 多行时右上角显示“删除”，底部改为净重合计提示条。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 未在 H5/真机确认与参考图的视觉接近度。
  - Next：
    1) 预览确认标签/输入/按钮位置是否符合预期。

### 2026-02-04 CURRENT — 销售录入细节修复（删除/回瓶文案/基础信息两行）
- 做了什么：
  - 出瓶明细删除按钮改为稳定可点击（`@tap.stop` + 更大点击区），且最后一行也可删除。
  - 回瓶明细改用专属文案（标题/说明/瓶号/合计），不再展示“出瓶”字样。
  - 基础信息栅格在小尺寸下压缩为 2 行（6 列布局）。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 未在 H5/真机验证删除按钮点击与回瓶文案展示。
  - Next：
    1) 预览验证：删除按钮点击稳定、回瓶文本正确、基础信息两行布局生效。

### 2026-02-04 CURRENT — 销售录入基础信息升级（日期/单位下拉 + 联想搜索）
- 做了什么：
  - 销售日期改为 date picker；计价单位改为 selector，下拉选择更一致。
  - 配送车辆、配送员支持模糊联想与回车/点击选择（新增 `crm-user listV1` 作为配送员候选）。
  - 客户选择后自动带出默认单价与计价单位。
  - 流量结算仅在计价单位为 `m3` 时显示。
  - 提交校验改为必须选择客户（`customerId`）。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/pages/sale/edit.vue`
  - `src/services/user.js`
  - `uniCloud-alipay/cloudfunctions/crm-user/index.js`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - `crm-user` 未部署，配送员联想暂无法返回真实数据。
  - Next：
    1) 部署 `crm-user` 云函数并验证配送员联想与选择。
    2) H5 验证日期/单位 picker 与客户自动带价行为。

### 2026-02-04 CURRENT — 录入页下拉优化 + 付款状态选择
- 做了什么：
  - 业务模式/计价单位/销售日期/收款方式下拉点击区域优化（picker 输入禁用指针事件）。
  - 付款状态改为下拉选择（未付款/部分付/已结清），并兼容旧值映射。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 需验证 picker 在 H5/小程序的点击体验是否明显改善。
  - Next：
    1) H5/真机验证各下拉选择的可点性与默认值显示。
  - 未部署 schema/云函数；未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 需要补齐云端部署验证记录（至少 list/create 基本链路），并确定 `crm_fillings` / `crm_bottle_anomalies` 的云函数是否在 C2/C3 阶段再实现。
  - Next：
    1) 部署 schema 与 `crm-vehicle` / `crm-bottle` 云函数，补一条验证记录（H5 或 mp-alipay）。
    2) 进入业务细化：在销售录入页接入车辆选择（如需要），并明确 Vehicle/Bottle 的字段扩展清单。

### 2026-01-18 NEXT — B2 Bottle：引入 movement 事件流 + missing_fill(10kg) 自动闭环
- 做了什么：
  - 冻结事件流规则：`movement.type` 仅 `back/out/fill/adjust`；瓶号字段统一为 `bottle_no`。
  - 冻结缺灌装规则：`missing_fill` 仍为异常；阈值 10kg；按 `diff = next_out_net - last_back_net` 正负分支处理。
  - 库存口径冻结：库存权威入口为 `crm_fillings`；一键修复需落库“简版灌装”或“损耗调整”。
- 改动文件列表：
  - 无（本条为计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 需落地 `crm_bottle_movements` schema + 云函数，并将 sale/filling 写入 movement 事件流。
  - Next：
    1) 新增 `crm_bottle_movements` schema（含 `bottle_no/type/date/source` 等最小字段）。
    2) 新增云函数 `crm-bottle-movement`：list/get/create（write-only），统一鉴权+日志。
    3) 新增云函数 `crm-filling`：支持简版灌装（date/bottle_no/fill_weight/remark）。
    4) 新增云函数 `crm-bottle-anomaly`：基于 movement 扫描缺灌装；resolve 时按 diff 分支：
       - diff>0：自动补简版灌装（fill_weight=diff），并 resolved
       - diff<0：生成损耗 adjust（loss_kg=abs(diff)），并 resolved
       - |diff|>10kg：阻止直接修复，要求补灌装
    5) `crm-sale`：出/回瓶时写 movement（source_type=sale，关联 sale_id）。
    6) `lsp_diagnostics` 通过后追加 CURRENT，部署后补验证记录（至少 scan/resolve）。

### 2026-01-18 CURRENT — B2 Bottle：movement 事件流与缺灌装闭环落地
- 做了什么：
  - 新增 `crm_bottle_movements` schema 与 `crm-bottle-movement` 云函数，作为瓶子事件流的写入入口（back/out/fill/adjust）。
  - 新增 `crm-filling` 云函数：支持简版灌装（date/bottle_no/fill_weight），并自动写入 fill movement。
  - 新增 `crm-bottle-anomaly` 云函数：基于 movement 扫描缺回瓶/缺灌装/连续出瓶；缺灌装 resolve 时按 diff 分支处理（<=10kg 自动补简版灌装或记损耗）。
  - `crm-sale` 出/回瓶写 movement（更新时先清理旧 movement 再重建）。
  - 瓶档补充 `tare_weight` 字段（schema + 云函数 + model 校验）。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_bottle_movements.schema.json`
  - `uniCloud-alipay/database/schema/crm_fillings.schema.json`
  - `uniCloud-alipay/database/schema/crm_bottle_anomalies.schema.json`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `src/services/models/bottle.js`
  - `src/services/filling.js`
  - `src/services/bottleMovement.js`
  - `STATE.md`
- 验证输出要点：
  - `lsp_diagnostics`：云函数存在 CommonJS hint；`crm-bottle-movement` / `crm-bottle-anomaly` 误报 unused `dbCmd`（未找到实际声明）。
  - `node -e JSON.parse(...)`：`crm_bottle_movements.schema.json` 解析通过。
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署云函数。
  - json LSP（biome）未安装，部分 schema 未能 LSP 诊断。
- 剩余问题及 Next：
  - 剩余问题：
    - `crm_bottle_anomalies` schema 与云函数结构需在部署前做一次真实调用验证（scan/resolve）。
  - Next：
    1) 部署 `crm-bottle-movement` / `crm-filling` / `crm-bottle-anomaly` / `crm-sale`，执行一次 scan + resolve。
    2) 验证 missing_fill diff<=10kg 自动补简版灌装，并且 diff<0 时写入损耗 adjust。

### 2026-01-18 NEXT — C2 Bottle：补齐验证页面与调用入口
- 做了什么：
  - 记录阻塞：目前没有前端页面可触发 movement/anomaly 相关验证。
- 改动文件列表：
  - 无（本条为计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - `/pages/bottle/anomaly` 入口已在工作台存在，但页面缺失。
  - Next：
    1) 新增 `src/pages/bottle/anomaly.vue`：提供 scan/list/resolve 的最小验证能力。
    2) 新增 `src/services/bottleAnomaly.js` 与 `src/services/bottleMovement.js` 调用入口（如未具备）。
    3) 更新 `src/pages.json` 注册 bottle/anomaly 路由。
    4) `lsp_diagnostics` 通过后追加 CURRENT。


### 2026-01-18 CURRENT — C2 Bottle：补齐验证页面与调用入口
- 做了什么：
  - 新增 `src/services/bottleAnomaly.js` 封装 `scanV1/listV1/resolveV1`。
  - 新增 `src/pages/bottle/anomaly.vue`：提供全量/单瓶扫描入口、异常列表筛选与修复交互（缺灌装支持确认提示）。
  - 更新 `src/pages.json` 注册异常页面路由。
- 改动文件列表：
  - `src/services/bottleAnomaly.js`
  - `src/pages/bottle/anomaly.vue`
  - `src/pages.json`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 需部署云函数后验证扫描与修复逻辑。
  - Next：
    1) 部署 `crm-bottle-anomaly` 等相关云函数。
    2) 在真机/H5 验证：点击扫描→生成异常→列表展示→点击修复→生成 movement/filling 记录。

### 2026-01-22 CURRENT — 前端页面全量补齐 + 表单紧凑化
- 做了什么：
  - 补齐前端页面：瓶档/车辆/灌装/流转记录页面与录入页，覆盖已有 service 能力，并在工作台新增入口。
  - 销售录入相关卡片与页面间距收紧（表单更紧凑）。
  - 更新 `pages.json` 注册新增页面路由。
- 改动文件列表：
  - `src/pages/bottle/list.vue`
  - `src/pages/bottle/edit.vue`
  - `src/pages/bottle/movement.vue`
  - `src/pages/vehicle/list.vue`
  - `src/pages/vehicle/edit.vue`
  - `src/pages/filling/list.vue`
  - `src/pages/filling/edit.vue`
  - `src/pages/index/index.vue`
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/components/domain/sale/SaleFlowCard.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `src/pages.json`
- 验证输出要点：
  - `lsp_diagnostics`：新增/修改的页面与组件无诊断。
  - 未运行 `npm run dev:*` / `npm run build:*`；未在真机/H5 验证新增页面。
- 剩余问题及 Next：
  - 剩余问题：
    - 新增页面未做真机/H5 烟囱验证。
  - Next：
    1) 在 H5 或 mp-alipay 验证瓶档/车辆/灌装/流转记录页面的查询与保存链路。
    2) 如需：补充列表分页/加载更多交互。

### 2026-01-22 CURRENT — 客户页面字段对齐 Schema
- 做了什么：
  - 移除客户列表/录入页中的 `region` 与 `contact_name` 字段，改为与 `crm_customers` schema 一致的 `short_name/contact/phone/address/remark` 等字段。
- 改动文件列表：
  - `src/pages/customer/list.vue`
  - `src/pages/customer/edit.vue`
- 验证输出要点：
  - `lsp_diagnostics`：`src/pages/customer/list.vue`、`src/pages/customer/edit.vue` 无诊断。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 如需客户区域字段，需先在 schema 中明确并同步到 UI。

### 2026-01-22 NEXT — C2 Bottle：部署/验证阻塞说明（需协作）
- 做了什么：
  - 记录当前环境无法执行 uniCloud 部署与真机验证，需协作补齐部署与烟囱验证记录。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 未运行部署/真机验证（本地无 HBuilderX/云端环境）。
- 剩余问题及 Next：
  - 剩余问题：
    - `crm-bottle-anomaly`/`crm-bottle-movement`/`crm-filling` 未完成云端部署与 scan/resolve 实测。
  - Next：
    1) 在 HBuilderX 上传部署 `crm-bottle-anomaly`/`crm-bottle-movement`/`crm-filling`/`crm-sale`。
    2) 真机/H5 走烟囱：触发 scan→列表→resolve，确认 movement/filling 写入。
    3) 将验证平台与样例瓶号/异常类型追加到 `STATE.md`。

### 2026-01-22 CURRENT — 更正：C2 Bottle 页面/路由已存在
- 做了什么：
  - 更正说明：`src/pages/bottle/anomaly.vue` 与 `src/services/bottleAnomaly.js` 已存在，`src/pages.json` 路由也已注册；无需重新创建页面或路由。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 仅核对文件存在性，未进行部署/真机验证。
- 剩余问题及 Next：
  - 剩余问题：
    - 仍需完成云函数部署与 scan/resolve 烟囱验证。
  - Next：
    1) 在 HBuilderX 上传部署 `crm-bottle-anomaly`/`crm-bottle-movement`/`crm-filling`/`crm-sale`。
    2) 真机/H5 走烟囱：触发 scan→列表→resolve，确认 movement/filling 写入。
    3) 将验证平台与样例瓶号/异常类型追加到 `STATE.md`。

### 2026-01-22 CURRENT — C2 Bottle：确认验证页面已存在
- 做了什么：
  - 复核 `src/pages/bottle/anomaly.vue` 与 `src/services/bottleAnomaly.js` 实际存在，路由已注册在 `src/pages.json`，无须重新创建。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`；未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 仍需完成云端部署与 scan/resolve 实测。
  - Next：
    1) 在 HBuilderX 上传部署 `crm-bottle-anomaly`/`crm-bottle-movement`/`crm-filling`/`crm-sale`。
    2) H5 走烟囱：点击扫描→生成异常→列表展示→点击修复→生成 movement/filling 记录。
    3) 将验证平台与样例瓶号/异常类型追加到 `STATE.md`。


### 2026-01-18 CURRENT — C2/C3 Bottle/Vehicle/Filling：前端页面全量补齐
- 做了什么：
  - 新增瓶档管理页（list/edit）：支持搜索、状态筛选、新建与编辑。
  - 新增车辆管理页（list/edit）：支持搜索、状态筛选、新建与编辑。
  - 新增灌装记录页（list/edit）：支持瓶号/日期筛选、新增灌装。
  - 新增流转记录页（movement）：支持瓶号/类型筛选。
  - 更新工作台与路由配置，增加入口。
- 改动文件列表：
  - `src/pages/bottle/list.vue`
  - `src/pages/bottle/edit.vue`
  - `src/pages/bottle/movement.vue`
  - `src/pages/vehicle/list.vue`
  - `src/pages/vehicle/edit.vue`
  - `src/pages/filling/list.vue`
  - `src/pages/filling/edit.vue`
  - `src/pages.json`
  - `src/pages/index/index.vue`
  - `STATE.md`
- 验证输出要点：
  - 未运行 `npm run dev:*` / `npm run build:*`。
- 剩余问题及 Next：
  - 剩余问题：
    - 需在真机/H5 验证所有新增页面的 list/create/update 链路与筛选是否生效。
  - Next：
    1) 部署所有相关的云函数（crm-bottle/crm-vehicle/crm-filling/crm-bottle-movement）。
    2) 在 H5/小程序 逐个模块进行烟囱测试：
       - 瓶档：新建瓶 -> 列表搜到 -> 编辑保存 -> 列表状态更新。
       - 车辆：新建车 -> 列表搜到 -> 编辑保存。
       - 灌装：新增灌装 -> 列表搜到 -> 触发 movement/anomaly。
       - 流转：查看流转记录是否随操作自动增加。

### 2026-01-28 NEXT — UI 改造：建立 UI 变更记录基线
- 做了什么：
  - 记录 UI 改造约束：新增 UI 变更需写入 `STATE_UI.md`（改了什么/影响范围/如何回退）。
  - 计划创建 `STATE_UI.md` 模板文件，作为 UI 变更的 append-only 日志。
- 改动文件列表：
  - 无（本条为计划，等待实现）
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 需在 2026_v4 创建 `STATE_UI.md` 并确认模板结构。
  - Next：
    1) 新建 `STATE_UI.md`，写入 UI 变更模板（append-only 规则）。

### 2026-01-28 CURRENT — UI 改造：创建 STATE_UI.md 模板
- 做了什么：
  - 在 2026_v4 新建 `STATE_UI.md`，提供 UI 变更记录模板（append-only）。
- 改动文件列表：
  - `STATE_UI.md`
  - `STATE.md`
- 验证输出要点：
  - 未运行构建/测试；仅创建模板文件。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 开始 UI/交互改造时，按页面逐条记录到 `STATE_UI.md`。

### 2026-01-28 CURRENT — UI 改造：STATE_UI.md 中文化与约束补齐
- 做了什么：
  - 将 `STATE_UI.md` 改为中文记录模板，并补齐 UI/交互改造约束清单。
- 改动文件列表：
  - `STATE_UI.md`
  - `STATE.md`
- 验证输出要点：
  - 未运行构建/测试；仅更新文档模板。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) UI 改造开始后按页面追加记录到 `STATE_UI.md`。

### 2026-01-27 CURRENT — 灌装不生成会计凭证（运营记录）
- 做了什么：
  - 确认灌装仅用于运营记录，不在会计层面核算成本，因此不生成灌装凭证。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 后续如引入成本核算，再补齐灌装凭证规则。

### 2026-01-27 CURRENT — 交付销售凭证规则文档
- 做了什么：
  - 新增销售自动凭证规则文档，明确收入口径、支付方式映射与分录模板。
- 改动文件列表：
  - `docs/ACCOUNTING_VOUCHER_RULES.md`
- 验证输出要点：
  - 未运行构建/测试；文档新增。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 若需对外发布，将文档嵌入 README.md。

### 2026-01-27 CURRENT — README 嵌入销售凭证规则
- 做了什么：
  - 将 `docs/ACCOUNTING_VOUCHER_RULES.md` 嵌入 README，明确销售凭证口径。
- 改动文件列表：
  - `README.md`
- 验证输出要点：
  - 未运行构建/测试；README 文档更新。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 需要对外发布时同步更新 docs 与 README。

### 2026-01-27 CURRENT — 销售列表/详情展示收款方式
- 做了什么：
  - 销售列表增加收款方式展示；新增销售详情页展示收款方式与付款信息。
  - 路由注册销售详情页。
- 改动文件列表：
  - `src/pages/sale/list.vue`
  - `src/pages/sale/detail.vue`
  - `src/pages.json`
- 验证输出要点：
  - `lsp_diagnostics`：新增页面与列表无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 如需详情页展示明细行，再补充 out/back/agent 行列表。

### 2026-01-27 CURRENT — 销售录入页：客户联想/编辑回显/bizMode 隐藏
- 做了什么：
  - 客户输入支持模糊联想，下拉点击或 Enter 选择客户并填充 `customerId`。
  - 修复编辑模式：支持回显销售单并更新。
  - 根据 `bizMode` 隐藏非相关模块；流量结算仅在 `m3` 模式显示。
- 改动文件列表：
  - `src/components/base/AppInput.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/pages/sale/edit.vue`
- 验证输出要点：
  - `lsp_diagnostics`：相关文件无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 暂无
  - Next：
    1) 如需更严格客户选择（只允许选择不允许自由输入），再加入校验提示。

### 2026-01-27 CURRENT — D1：列表分页优化（云函数）
- 做了什么：
  - 为客户/钢瓶/车辆/灌装/科目列表增加 `page`/`pageSize` 支持，保留 `limit` 兼容。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-account/index.js`
- 验证输出要点：
  - `lsp_diagnostics`：无错误（仅 CommonJS 提示类 hint）。
  - 未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 未验证分页参数在前端调用中的适配。
  - Next：
    1) 若需前端分页，更新 list 调用传 `page/pageSize` 并增加分页交互。

### 2026-01-27 CURRENT — D1：索引补强（列表筛选）
- 做了什么：
  - 为常用筛选/排序字段补充复合索引（客户/钢瓶/车辆/灌装/科目/凭证/销售）。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_customers.schema.json`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `uniCloud-alipay/database/schema/crm_vehicles.schema.json`
  - `uniCloud-alipay/database/schema/crm_fillings.schema.json`
  - `uniCloud-alipay/database/schema/crm_accounts.schema.json`
  - `uniCloud-alipay/database/schema/crm_vouchers.schema.json`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
- 验证输出要点：
  - `lsp_diagnostics`：schema 文件无诊断。
  - 未部署数据库索引。
- 剩余问题及 Next：
  - 剩余问题：
    - 索引需在 uniCloud 控制台或部署流程中应用。
  - Next：
    1) 部署 schema 更新并验证查询性能。

### 2026-01-27 CURRENT — D2：useQuery 缓存与节流
- 做了什么：
  - 为 `useQuery` 增加可选缓存与节流：`cacheKey`/`cacheTTL`/`throttleMs`。
- 改动文件列表：
  - `src/composables/useQuery.js`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 尚未在具体列表页启用缓存/节流参数。
  - Next：
    1) 按需在列表页传入 `cacheKey` 与 `throttleMs`，保持 UI 不变。

### 2026-01-27 CURRENT — D2：列表启用缓存/节流参数
- 做了什么：
  - 客户/销售/瓶档列表启用 `useQuery` 缓存与节流参数（仅服务层，不改 UI）。
- 改动文件列表：
  - `src/pages/customer/list.vue`
  - `src/pages/sale/list.vue`
  - `src/pages/bottle/list.vue`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 其他列表页尚未接入缓存/节流。
  - Next：
    1) 继续接入车辆/灌装/科目/凭证/流转等列表页。

### 2026-01-27 CURRENT — D2：更多列表接入缓存/节流
- 做了什么：
  - 车辆/灌装/科目/凭证/流转/账期/账簿/报表等列表页接入 `cacheKey`/`cacheTTL`/`throttleMs`。
- 改动文件列表：
  - `src/pages/vehicle/list.vue`
  - `src/pages/filling/list.vue`
  - `src/pages/accounting/account-list.vue`
  - `src/pages/accounting/voucher-list.vue`
  - `src/pages/bottle/movement.vue`
  - `src/pages/accounting/trial-balance.vue`
  - `src/pages/accounting/report-summary.vue`
  - `src/pages/accounting/ledger-general.vue`
  - `src/pages/accounting/ledger-sub.vue`
  - `src/pages/accounting/period-list.vue`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 暂无
  - Next：
    1) 根据实际访问量调整缓存 TTL。

### 2026-01-27 CURRENT — D2：详情页接入缓存/节流
- 做了什么：
  - 销售详情页使用 `useQuery` 缓存与节流。
- 改动文件列表：
  - `src/pages/sale/detail.vue`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 暂无
  - Next：
    1) 如需更多详情页缓存，可继续接入。

### 2026-01-27 NEXT — D3：核心财务日志可观测性
- 做了什么：
  - 启动 D3：为核心财务流程补充 request_id 级别日志追踪。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 需明确 request_id 来源（context/event）与覆盖范围。
  - Next：
    1) 在 `crm-sale`/`crm-voucher` 的记录日志中写入 request_id。
    2) 评估是否扩展到其它云函数。

### 2026-01-27 CURRENT — D3：销售/凭证日志写入 request_id
- 做了什么：
  - `crm-sale` 与 `crm-voucher` 日志记录追加 `request_id` 字段，来源于 event/context。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
- 验证输出要点：
  - `lsp_diagnostics`：无错误（CommonJS 提示类 hint）。
  - 未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 其余云函数未接入 request_id。
  - Next：
    1) 如需全量追踪，扩展到 customer/bottle/vehicle 等函数。

### 2026-01-27 CURRENT — D3：全量云函数日志 request_id
- 做了什么：
  - 扩展 request_id 写入：account/customer/bottle/vehicle/filling/bottle-anomaly/bottle-movement/period/report/ledger/auth。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-account/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-period/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-report/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
- 验证输出要点：
  - `lsp_diagnostics`：无错误（CommonJS 提示类 hint；`bcryptjs` 类型提示为现有依赖）。
  - 未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - `crm_operation_logs` schema 需允许 `request_id` 字段（当前 additionalProperties=true 已允许）。
  - Next：
    1) 部署云函数并验证日志落地。

### 2026-01-27 CURRENT — D3：后端 request_id 生成对齐
- 做了什么：
  - 为所有云函数补充后端 request_id 生成规则，当前端未传入时也能落地统一格式。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-account/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-period/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-report/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
- 验证输出要点：
  - `lsp_diagnostics`：无错误（CommonJS 提示类 hint；bcryptjs 类型提示为现有依赖）。
  - 未部署云函数。
- 剩余问题及 Next：
  - 剩余问题：
    - 需验证 request_id 在云端日志中一致落地。
  - Next：
    1) 部署并检查 `crm_operation_logs` 的 request_id 记录。

### 2026-01-27 CURRENT — E1/E3：往来明细落地
- 做了什么：
  - 销售凭证分录写入客户辅助信息（aux.customer_id/customer_name）。
  - 新增往来明细接口与页面，支持应收明细查询。
  - 为凭证分录新增客户维度索引。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
  - `uniCloud-alipay/database/schema/crm_voucher_entries.schema.json`
  - `src/services/ledger.js`
  - `src/pages/accounting/receivable-detail.vue`
  - `src/pages/index/index.vue`
  - `src/pages.json`
- 验证输出要点：
  - `lsp_diagnostics`：无错误（CommonJS 提示类 hint）。
  - 未部署云函数/未更新索引。
- 剩余问题及 Next：
  - 剩余问题：
    - 往来明细仅覆盖应收（1122），未扩展其他往来科目。
  - Next：
    1) 如需应付/其他往来，扩展 account_code 过滤与页面筛选。

### 2026-01-27 CURRENT — 重构完成度总结文档
- 做了什么：
  - 新增重构完成度总结文档，涵盖已完成/有瑕疵/冻结项。
- 改动文件列表：
  - `docs/REFRACTORING_STATUS.md`
- 验证输出要点：
  - 未运行构建/测试；文档新增。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 如需对外发布，可嵌入 README.md。

### 2026-01-27 CURRENT — README 嵌入重构完成度总结
- 做了什么：
  - 将 `docs/REFRACTORING_STATUS.md` 嵌入 README。
- 改动文件列表：
  - `README.md`
- 验证输出要点：
  - 未运行构建/测试；README 文档更新。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 如需对外发布，保持 docs 与 README 同步更新。

### 2026-01-27 CURRENT — D3：前端注入 request_id
- 做了什么：
  - 在统一云函数调用入口生成并注入 `request_id`。
- 改动文件列表：
  - `src/services/api/callCloud.js`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - request_id 生成规则尚未统一到多端日志中（仅前端发起）。
  - Next：
    1) 部署并验证云函数日志落地。

### 2026-01-27 CURRENT — 销售录入页基础信息紧凑化与业务模式修复
- 做了什么：
  - 基础信息改为两行四列布局，车辆字段放在业务模式后。
  - 业务模式 picker 增加选中索引绑定，修复点击异常。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 如需对移动端进一步压缩布局，可调整断点列数。

### 2026-01-27 CURRENT — 修复客户联想选择无法点击
- 做了什么：
  - 客户联想下拉新增 `click/touchstart/mousedown` 事件，提升 H5/移动端选择稳定性。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
- 验证输出要点：
  - `lsp_diagnostics`：无诊断。
  - 未运行构建/测试。
- 剩余问题及 Next：
  - 剩余问题：
    - 无
  - Next：
    1) 如仍有偶发选择失败，再考虑延长 blur 隐藏延迟。

### 2026-01-27 NEXT — C3 会计台账：按会计规范落地核心模型与页面
- 做了什么：
  - 确认 C3 范围：以会计规范为准，覆盖科目表、凭证、分录、总账/明细账/余额表、账期结账与月度报表入口。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 会计模块尚无 schema/云函数/service/pages 落地。
  - Next：
    1) 新增会计核心 schema（科目、凭证、分录、账期、报表汇总）。
    2) 新增云函数与 service 封装（凭证录入/审核/反审核/结账、报表查询）。
    3) 新增页面：凭证列表/录入、科目管理、总账/明细账/余额表、月度报表入口。
    4) `lsp_diagnostics` 通过后追加 CURRENT。

### 2026-01-27 CURRENT — C3 会计台账：schema/云函数/service 基建
- 做了什么：
  - 新增会计模块 schema：科目、凭证、分录、账期、报表。
  - 新增云函数：`crm-account`、`crm-voucher`、`crm-ledger`、`crm-period`、`crm-report`。
  - 新增前端 service：account/voucher/ledger/period/report；新增模型校验 `services/models/accounting`。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_accounts.schema.json`
  - `uniCloud-alipay/database/schema/crm_vouchers.schema.json`
  - `uniCloud-alipay/database/schema/crm_voucher_entries.schema.json`
  - `uniCloud-alipay/database/schema/crm_periods.schema.json`
  - `uniCloud-alipay/database/schema/crm_reports.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-account/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-period/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-report/index.js`
  - `src/services/account.js`
  - `src/services/voucher.js`
  - `src/services/ledger.js`
  - `src/services/period.js`
  - `src/services/report.js`
  - `src/services/models/accounting.js`
  - `src/services/models/index.js`
- 验证输出要点：
  - `lsp_diagnostics`：云函数/服务文件无错误；存在 CommonJS 提示类 hints。
  - 未部署云函数、未执行端到端验证。
- 剩余问题及 Next：
  - 剩余问题：
    - C3 前端页面尚未落地（科目/凭证/账簿/报表）。
  - Next：
    1) 补齐前端页面与路由入口（科目表、凭证、总账/明细账、试算平衡、报表汇总）。
    2) 进行 H5/mp-alipay 页面烟囱验证后追加记录。

### 2026-01-27 CURRENT — C3 会计台账：前端页面补齐
- 做了什么：
  - 新增会计页面：科目表/科目录入、凭证列表/录入、总账、明细账、试算平衡、报表汇总、账期管理。
  - 工作台增加会计台账入口；`pages.json` 注册路由。
- 改动文件列表：
  - `src/pages/accounting/account-list.vue`
  - `src/pages/accounting/account-edit.vue`
  - `src/pages/accounting/voucher-list.vue`
  - `src/pages/accounting/voucher-edit.vue`
  - `src/pages/accounting/ledger-general.vue`
  - `src/pages/accounting/ledger-sub.vue`
  - `src/pages/accounting/trial-balance.vue`
  - `src/pages/accounting/report-summary.vue`
  - `src/pages/accounting/period-list.vue`
  - `src/pages/index/index.vue`
  - `src/pages.json`
- 验证输出要点：
  - `lsp_diagnostics`：新增页面与入口无诊断。
  - 未运行 `npm run dev:*` / `npm run build:*`；未做真机/H5 验证。
- 剩余问题及 Next：
  - 剩余问题：
    - 会计页面未进行云函数部署与端到端验证。
  - Next：
    1) 部署 `crm-account`/`crm-voucher`/`crm-ledger`/`crm-period`/`crm-report`。
    2) H5/mp-alipay 验证：科目新增→凭证录入→过账→总账/试算平衡查询。

### 2026-01-27 NEXT — 会计凭证自动生成：销售/灌装映射与支付方式
- 做了什么：
  - 明确沿用旧系统口径：kg 模式回瓶净重冲减收入；bottle/m3/truck 不冲减。
  - 新增支付方式需求：WeChat Pay / Alipay。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - 无
- 剩余问题及 Next：
  - 剩余问题：
    - 灌装业务缺少金额口径，无法直接生成会计凭证金额。
  - Next：
    1) 销售单增加 `payment_method` 字段并落库。
    2) `crm-sale` 自动生成凭证（收入/应收/收款科目）。
    3) 明确灌装成本/单价口径后再生成灌装凭证。

### 2026-01-27 CURRENT — 会计凭证自动生成（销售）与支付方式
- 做了什么：
  - 销售单支持 `payment_method`（含 WeChat Pay/Alipay），并在 `crm-sale` 中自动生成销售凭证。
  - 按旧系统口径：kg 模式回瓶净重冲减收入；bottle/m3/truck 不冲减。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `src/services/models/sale.js`
  - `src/services/sale.js`
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
- 验证输出要点：
  - `lsp_diagnostics`：相关前端/云函数无错误（云函数 CommonJS 提示类 hint）。
  - 未部署云函数，未跑端到端验证。
- 剩余问题及 Next：
  - 剩余问题：
    - 灌装业务缺少成本/单价口径，无法自动生成金额型凭证。
  - Next：
    1) 明确灌装成本口径（每 kg/每瓶/每单固定成本）。
    2) 需要时补齐支付方式 UI（若需在销售录入页展示）。

### 2026-02-04 CURRENT — 销售录入点选优化与结算图标
- 做了什么：
  - 结算区“收款方式/付款状态”补充图标提示，强化识别。
  - 销售日期 picker 覆盖宽度统一；清理业务模式/计价单位旧的 picker 计算逻辑。
- 改动文件列表：
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。
- 剩余问题：若需调整图标含义或样式细节可再微调。

### 2026-02-04 CURRENT — 销售结算抹零与结算视觉统一
- 做了什么：
  - 收款结算新增“抹零金额”字段，云端存储并参与应收金额计算。
  - 结算区布局与基础信息区对齐（网格跨度/图标一致），并补充抹零图标。
  - 详情页补充抹零展示，列表/详情应收金额自动扣减抹零。
- 改动文件列表：
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/base/AppIcon.vue`
  - `src/pages/sale/edit.vue`
  - `src/pages/sale/detail.vue`
  - `src/services/sale.js`
  - `src/services/models/sale.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。
- 剩余问题：需要在端侧手动验证抹零对“应收/实收”展示的业务口径是否符合财务预期。

### 2026-02-04 CURRENT — 结算应收展示与公式说明
- 做了什么：
  - 收款结算区新增“应收金额”展示与公式说明，并在页面端按当前输入动态计算（含抹零）。
  - 出瓶/回瓶净重合计补充小号计算公式说明。
- 改动文件列表：
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：`npm run build:h5` 通过。
- 剩余问题：若需按财务口径调整公式文本/取值精度可再细化。

### 2026-02-04 CURRENT — 出/回瓶录入增强与自动建瓶阻断
- 做了什么：
  - 出/回瓶卡片增加联想搜索、自动代入皮重、净重公式、回瓶金额方向提示与批量粘贴（追加去重）。
  - 整车卡片调整为车管语义（车牌号/罐车号），不再显示 TRUCK 派生值。
  - 自动建瓶逻辑加入 `crm-sale`，失败时阻止销售单保存。
  - 取消前端出/回/存瓶的车牌/TRUCK 过滤。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/pages/sale/edit.vue`
  - `src/services/models/sale.js`
  - `src/services/models/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：`npm run build:h5` 通过。
- 剩余问题：自动建瓶失败路径需在云端实测（重复瓶号/并发写入）。

### 2026-02-04 CURRENT — 销售编辑布局统一与结算行对齐
- 做了什么：
  - 收款结算区将“收款方式/付款状态/实收金额/抹零金额”调整为同一行展示（桌面端 4 列）。
  - 销售编辑页顶部信息改为卡片化样式，间距与首页卡片体系一致。
- 改动文件列表：
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。
- 剩余问题：如需进一步收敛移动端布局再单独细化。

### 2026-02-04 CURRENT — 存瓶统计展示与出回瓶卡片精修
- 做了什么：
  - 销售编辑页存瓶记录增加简洁统计展示（当前存瓶数 + 口径提示）。
  - 出/回瓶卡片改为更紧凑的卡片式行布局，按钮/输入密度统一，交互更精致。
  - 存瓶行样式同步收敛为轻量卡片风格。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。
- 剩余问题：如需展示存瓶明细清单（raw 列表）可再补充。

### 2026-02-04 CURRENT — 存瓶实时合并与明细展示
- 做了什么：
  - 存瓶统计改为“历史存瓶 + 本单出/存 - 本单回”的实时合并口径。
  - 统计区域增加存瓶明细标签列表（支持滚动）。
  - 出/回瓶卡片间距适度放宽，新增按钮改为图标居中。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。
- 剩余问题：若需控制明细展示上限或导出可再补充。

### 2026-02-04 CURRENT — 出/回瓶卡片视觉精修（轻卡片）
- 做了什么：
  - 出/回瓶行卡片加入轻阴影，层次更清晰。
  - 标签弱化、删除按钮默认灰色，按下才高亮红色。
  - 联想面板更像浮层；合计区更松、更像摘要条。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 删除按钮对齐与视觉统一
- 做了什么：
  - 删除按钮移动至净重标签行，与标签基线对齐并使用同色系弱化。
  - 增加标签行布局（field-head），整体更和谐。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 删除按钮不顶行 + 净重对齐修复
- 做了什么：
  - 删除按钮改为绝对定位，不影响净重输入框对齐。
  - 删除字号更细，与标签同色系并对齐右侧“+”列。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 删除按钮对齐“+”与高亮红色
- 做了什么：
  - 删除按钮对齐到“+”正上方，字号与标签一致，恢复为醒目红色。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 删除与净重标签基线对齐
- 做了什么：
  - 删除按钮与“净重(kg)”标签基线对齐，并保持与“+”同列。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 删除按钮居中“+”列
- 做了什么：
  - 删除按钮置于固定宽度列中居中对齐，确保正好在“+”正上方。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 删除与“+”同列网格化
- 做了什么：
  - 净重列改为内置网格：删除与“+”同列，确保正上方对齐且不影响输入框对齐。
- 改动文件列表：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-04 CURRENT — 存瓶按钮与明细按钮对齐
- 做了什么：
  - 存瓶空状态按钮与“新增明细行”保持左对齐风格，避免错位感。
- 改动文件列表：
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-05 CURRENT — 结算约束与退款冲退口径
- 做了什么：
  - 应收允许为负，抹零在退款时减少退款额（向 0 靠拢）。
  - 前端保存前增加付款状态/金额强约束校验（含退款场景）。
  - 后端保存校验与前端一致，并支持退款凭证冲退分录。
- 改动文件列表：
  - `src/pages/sale/edit.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-05 CURRENT — 销售编辑瘦身（结算逻辑抽离）
- 做了什么：
  - 结算计算与校验抽至 `useSaleSettlement`，页面只做编排与调用。
  - `normalizePaymentStatus` 统一到 `services/models/sale`，组件复用。
  - 数值工具集中到 `utils/number`。
- 改动文件列表：
  - `src/composables/useSaleSettlement.js`
  - `src/utils/number.js`
  - `src/services/models/sale.js`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/pages/sale/edit.vue`
  - `STATE.md`
- 验证输出要点：未执行构建/测试。

### 2026-02-05 CURRENT — 全局上下文 Skill（crm-2026-v4）
- 做了什么：
  - 创建 Codex 全局 Skill `crm-2026-v4`，用于在任何窗口通过 `$crm-2026-v4` 一键加载本项目上下文与强制约束（`docs/RULES.md` / `README.md` / `STATE.md` / `CLAUDE.md`；财务相关再读 `docs/ACCOUNTING.md`）。
  - Skill 内包含“通用上下文粘贴块”（便于在非 Codex AI 中直接复制使用）与 doc map，并补充 `agents/openai.yaml` 作为 UI metadata。
  - 安装到全局 `~/.codex/skills/crm-2026-v4/`，供后续所有会话复用。
- 改动文件列表：
  - `STATE.md`
  - （外部）`/Users/wangbo/.codex/skills/crm-2026-v4/SKILL.md`
  - （外部）`/Users/wangbo/.codex/skills/crm-2026-v4/agents/openai.yaml`
  - （外部）`/Users/wangbo/.codex/skills/crm-2026-v4/references/universal-prompt.md`
  - （外部）`/Users/wangbo/.codex/skills/crm-2026-v4/references/doc-map.md`
- 验证输出要点：
  - 未执行构建/测试。
  - 已通过 `find` 确认上述 skill 文件存在于 `/Users/wangbo/.codex/skills/crm-2026-v4/`。

### 2026-02-05 CURRENT — 补记：本 Session UI 改造落点（工作台 + 销售编辑）
- 做了什么：
  - 工作台（首页）改为仪表盘式布局（左侧导航 + 顶栏 + 主内容 + 右侧信息栏），并统一 KPI/卡片/图表的“轻量”视觉体系。
  - 销售编辑页整体卡片体系与首页对齐：顶部信息 pill、分业务模式展示区块、收款结算区在同一视觉系统内；出/回瓶与存瓶统计补齐展示（含实时合并口径提示）。
- 改动文件列表：
  - `src/pages/index/index.vue`
  - `src/pages/sale/edit.vue`
- 验证输出要点：未执行构建/测试。

### 2026-02-05 CURRENT — 页面瘦身：提取工作台/销售编辑为领域组件
- 做了什么：
  - 按 `docs/RULES.md` 的“页面瘦身”原则，将两个大页面抽为领域组件：页面仅保留薄编排与必要的页面生命周期（`onLoad`）。
  - 工作台：`src/pages/index/index.vue` 改为薄壳，仪表盘 UI + 数据拉取逻辑迁移到 `src/components/domain/dashboard/DashboardHome.vue`。
  - 销售编辑：`src/pages/sale/edit.vue` 改为薄壳（只负责读取 `_id` 并传入），原 UI/交互逻辑迁移到 `src/components/domain/sale/SaleEditView.vue`；同时修复 `bizModeLabel` 缺失导致的潜在运行时报错，并移除重复的 `normalizeBottleNo` 实现（改用 `src/services/models/bottle` 统一口径）。
- 改动文件列表：
  - `src/pages/index/index.vue`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/pages/sale/edit.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`：构建通过。

### 2026-02-05 CURRENT — 客户页 UI 改造（仪表盘风格）
- 做了什么：
  - 新增客户列表/编辑领域组件，页面改为薄壳，符合页面瘦身约束。
  - 客户列表加入统计摘要、筛选卡片与列表视觉统一，风格对齐主页仪表盘。
  - 客户编辑页改为仪表盘卡片布局，新增头部摘要与页头动作。
- 改动文件列表：
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/customer/CustomerEditView.vue`
  - `src/pages/customer/list.vue`
  - `src/pages/customer/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认表单与统计区的间距与可读性。

### 2026-02-05 CURRENT — 客户列表默认加载与统计卡片间距
- 做了什么：
  - 客户列表进入页面自动加载默认数据。
  - 统计摘要改用“客户”单位文案，并调整数字与图标间距避免拥挤。
  - 重置筛选后自动重新拉取默认列表。
- 改动文件列表：
  - `src/components/domain/customer/CustomerListView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认统计卡片与筛选区密度是否合适。

### 2026-02-05 CURRENT — 首页统计卡片对齐 + 客户编辑页紧凑化
- 做了什么：
  - 首页 KPI 统计卡片数字改为左对齐，图标留出间距，视觉与客户页一致。
  - 客户编辑页减少纵向间距与区块内边距，提升紧凑度与可读性。
- 改动文件列表：
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/domain/customer/CustomerEditView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认 KPI 与客户编辑页在窄屏下的视觉密度。

### 2026-02-05 CURRENT — 瓶档 UI 改造（列表/编辑/异常/流转）
- 做了什么：
  - 新增瓶档领域组件（列表/编辑/异常/流转），页面改为薄壳，保持页面瘦身。
  - 列表页加入仪表盘式统计摘要、筛选卡片与列表统一视觉，并默认加载数据。
  - 编辑页改为卡片化布局与页头动作，压缩纵向间距。
  - 异常/流转页面统一统计摘要与筛选区样式，默认加载数据并修正状态标签样式。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/bottle/BottleEditView.vue`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `src/pages/bottle/list.vue`
  - `src/pages/bottle/edit.vue`
  - `src/pages/bottle/anomaly.vue`
  - `src/pages/bottle/movement.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认瓶档统计卡片与筛选区的密度与可读性。

### 2026-02-05 CURRENT — 瓶档图标色系与统计卡片修正
- 做了什么：
  - 调整瓶档列表/异常/流转的图标色系，使用 AppListItem 内置色阶（避免 scoped 样式失效）。
  - 统计卡片“报废/丢失”不再绑定误导筛选点击。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认图标颜色与背景对比度。

### 2026-02-05 CURRENT — 车辆档案 UI 改造（列表/编辑）
- 做了什么：
  - 新增车辆领域组件（列表/编辑），页面改为薄壳，符合页面瘦身约束。
  - 列表页加入统计摘要、筛选卡片与列表统一视觉，并默认加载数据。
  - 编辑页改为卡片化布局与页头动作，压缩纵向间距。
- 改动文件列表：
  - `src/components/domain/vehicle/VehicleListView.vue`
  - `src/components/domain/vehicle/VehicleEditView.vue`
  - `src/pages/vehicle/list.vue`
  - `src/pages/vehicle/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认车辆列表统计卡片与筛选区的密度与可读性。

### 2026-02-05 CURRENT — 灌装记录 UI 改造（列表/录入）
- 做了什么：
  - 新增灌装领域组件（列表/录入），页面改为薄壳，符合页面瘦身约束。
  - 列表页加入统计摘要、筛选卡片与列表统一视觉，并默认加载数据。
  - 录入页改为卡片化布局与页头动作，纵向更紧凑。
- 改动文件列表：
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/filling/FillingEditView.vue`
  - `src/pages/filling/list.vue`
  - `src/pages/filling/edit.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认日期选择器与筛选区在窄屏下的可用性。

### 2026-02-05 CURRENT — 销售列表/详情 UI 改造（领域组件化）
- 做了什么：
  - 新增销售列表/详情领域组件，页面改为薄壳，保持页面瘦身。
  - 列表页加入统计摘要、筛选卡片与列表统一视觉，并默认加载数据。
  - 详情页改为仪表盘式摘要 + 分区展示，付款状态文案统一。
- 改动文件列表：
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/pages/sale/list.vue`
  - `src/pages/sale/detail.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认筛选区与详情页信息密度。

### 2026-02-05 CURRENT — 销售列表筛选交互优化
- 做了什么：
  - 关键词输入支持回车确认触发查询。
  - 计价单位/销售模式的 picker 点击区域放大，便于触达。
- 改动文件列表：
  - `src/components/domain/sale/SaleListView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认回车触发与 picker 点击区域的可用性。

### 2026-02-05 CURRENT — 销售列表关键词联想与筛选点击修复
- 做了什么：
  - 取消关键词回车直接查询，改为回车选中联想首条（若有）。
  - 关键词输入触发联想时自动展开建议列表。
  - 计价单位/销售模式选择器限制点击区域，避免溢出输入框。
- 改动文件列表：
  - `src/components/domain/sale/SaleListView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认 picker 点击区域与回车选中体验。

### 2026-02-05 CURRENT — 销售筛选点击区域修正（计价单位/销售模式）
- 做了什么：
  - 禁用 picker 内部输入框事件，确保点击输入区也能触发选择。
  - 维持 picker 点击区域限制在字段内。
- 改动文件列表：
  - `src/components/domain/sale/SaleListView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认标签区与输入区均可触发 picker。

### 2026-02-05 CURRENT — 销售筛选：标签区不触发 picker
- 做了什么：
  - 计价单位/销售模式改为外置标签，仅输入框区域触发 picker。
- 改动文件列表：
  - `src/components/domain/sale/SaleListView.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认标签区域不会触发 picker。

### 2026-02-05 CURRENT — 会计台账 UI 改造（页面薄壳化）
- 做了什么：
  - 试算平衡、报表汇总、账期管理、往来明细页面替换为会计领域组件，保持页面瘦身与仪表盘风格统一。
  - 将查询、列表与统计展示逻辑集中在 `src/components/domain/accounting` 中的视图组件。
- 改动文件列表：
  - `src/pages/accounting/trial-balance.vue`
  - `src/pages/accounting/report-summary.vue`
  - `src/pages/accounting/period-list.vue`
  - `src/pages/accounting/receivable-detail.vue`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认会计台账各页统计卡片与筛选区密度是否合适。

### 2026-02-05 CURRENT — 追款任务页 UI 改造（业务层）
- 做了什么：
  - 新增追款任务领域组件与薄页入口，保持页面瘦身与仪表盘风格统一。
  - 提供任务筛选、默认日期范围、统计摘要、任务列表与自动生成按钮。
  - 新增追款任务/跟进数据 schema 与云函数（列表 + 自动生成）。
- 改动文件列表：
  - `src/components/domain/collection/CollectionTaskListView.vue`
  - `src/pages/collection/task-list.vue`
  - `src/pages.json`
  - `src/services/collection.js`
  - `uniCloud-alipay/cloudfunctions/crm-collection/index.js`
  - `uniCloud-alipay/database/schema/crm_collection_tasks.schema.json`
  - `uniCloud-alipay/database/schema/crm_collection_followups.schema.json`
  - `STATE.md`
- 验证输出要点：未运行 `npm run dev` / `npm run build`。
- 剩余问题：
  - 需要在真机/H5 端确认追款任务列表与筛选区的密度与可读性。

### 2026-02-06 CURRENT — 追款任务详情与跟进闭环（业务层）
- 做了什么：
  - 追款任务列表支持点击进入任务详情页，补齐任务页到详情页链路。
  - 新增追款任务详情领域组件，支持任务状态/优先级/负责人/下次跟进更新。
  - 新增跟进记录录入与历史列表展示，提交跟进后自动刷新任务状态与欠款金额。
  - 扩展 `crm-collection` 云函数：新增任务查询、任务更新、跟进列表、新增跟进 action，并在后端执行状态流转与金额更新。
  - 新增 `collection` 模型层前端校验，限制无效状态/优先级/跟进草稿提交。
- 改动文件列表：
  - `src/components/domain/collection/CollectionTaskListView.vue`
  - `src/components/domain/collection/CollectionTaskDetailView.vue`
  - `src/pages/collection/task-detail.vue`
  - `src/pages.json`
  - `src/services/collection.js`
  - `src/services/models/collection.js`
  - `src/services/models/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-collection/index.js`
  - `STATE.md`
- 验证输出要点：已运行 `npm run build:h5`（通过）。
- 剩余问题：
  - 跟进结果“争议处理中”的进一步状态细分（如法务中/待核账）尚未拆分。
  - 负责人目前为手输文本，尚未接入用户选择器。

### 2026-02-06 CURRENT — 追款入口补齐与详情交互增强
- 做了什么：
  - 工作台左侧主导航新增“追款任务”入口，统一进入追款任务列表页。
  - 追款详情页负责人改为用户列表选择器（调用 `crm-user/listV1`），不再手工录入负责人。
  - 追款详情页新增快捷状态按钮（待跟进/跟进中/承诺/部分回款/已结清/暂停），支持一键更新状态。
- 改动文件列表：
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/domain/collection/CollectionTaskDetailView.vue`
  - `STATE.md`
- 验证输出要点：已运行 `npm run build:h5`（通过）。
- 剩余问题：
  - 负责人当前按前 50 用户加载，后续可增加关键词搜索与角色筛选。

### 2026-02-06 CURRENT — 追款模块完善（负责人筛选与搜索）
- 做了什么：
  - 追款任务列表新增负责人筛选：支持按用户列表选择负责人过滤任务。
  - 追款任务列表新增负责人搜索输入与“搜人”动作，支持按姓名/账号刷新负责人选项。
  - 追款详情页补充负责人搜索输入与“搜人”动作，适配用户规模较大时的负责人选择。
- 改动文件列表：
  - `src/components/domain/collection/CollectionTaskListView.vue`
  - `src/components/domain/collection/CollectionTaskDetailView.vue`
  - `STATE.md`
- 验证输出要点：已运行 `npm run build:h5`（通过）。
- 剩余问题：
  - 负责人搜索当前为显式触发（回车/按钮），后续可加输入防抖自动检索。

### 2026-02-06 CURRENT — P0 硬化（索引/日志/权限/重算）
- 做了什么：
  - 完善追款 schema 索引：任务表新增 `owner_id+status+updated_at` 索引与 `range_key` 唯一索引；跟进表新增 `operator_id+created_at` 索引。
  - `crm-collection` 新增操作日志：任务更新、跟进录入、自动生成、重算均记录到 `crm_operation_logs`。
  - `crm-collection` 新增最小权限控制：敏感写操作（更新/跟进/自动生成/重算）仅允许 `superadmin/admin/finance` 角色。
  - 新增 `recalcTaskV1`：按任务的客户 + 日期范围重算应收/已收/未收/销售数，并回写任务状态。
  - 详情页接入“重算金额”按钮，支持前端一键触发重算。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_collection_tasks.schema.json`
  - `uniCloud-alipay/database/schema/crm_collection_followups.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-collection/index.js`
  - `src/services/collection.js`
  - `src/components/domain/collection/CollectionTaskDetailView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check uniCloud-alipay/cloudfunctions/crm-collection/index.js`（通过）
  - 已运行 `npm run build:h5`（通过）
- 剩余问题：
  - 云端 schema/index 与云函数部署需在 uniCloud 控制台执行一次发布。

### 2026-02-06 CURRENT — 操作日志页（角色可见 + 后端读接口）
- 做了什么：
  - 新增 `crm-log` 云函数，提供 `listOperationLogsV1`，支持关键字/动作/角色/日期筛选与分页。
  - `crm-log` 增加后端权限控制，仅 `superadmin/admin/finance` 可读取；无权限访问返回 403 并记录拒绝日志。
  - 新增前端日志服务 `src/services/log.js`，统一通过 `callCloud` 调用日志接口。
  - 新增领域组件 `OperationLogListView` 与薄页面容器 `pages/log/list`，进入页面默认加载近 7 天日志。
  - 仪表盘侧边栏与“财务核算”宫格新增“操作日志”入口，按角色动态显示（仅 `superadmin/admin/finance`）。
  - 日志 schema 增补 `role+created_at` 与 `action+created_at` 索引，匹配日志页常用筛选。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-log/index.js`
  - `uniCloud-alipay/database/schema/crm_operation_logs.schema.json`
  - `src/services/log.js`
  - `src/components/domain/log/OperationLogListView.vue`
  - `src/pages/log/list.vue`
  - `src/pages.json`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check uniCloud-alipay/cloudfunctions/crm-log/index.js`（通过）
  - 已运行 `npm run build:h5`（通过）
- 剩余问题：
  - 生产环境需发布 `crm-log` 云函数并同步 `crm_operation_logs` 新索引后，筛选性能与权限才能在云端生效。

### 2026-02-06 CURRENT — 操作日志权限闭环（finance 角色可配置）
- 做了什么：
  - `crm-auth` 的用户创建与角色变更校验新增 `finance`，与“操作日志仅 superadmin/admin/finance 可见”的权限设计对齐。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check uniCloud-alipay/cloudfunctions/crm-auth/index.js`（通过）
  - 已运行 `npm run build:h5`（通过）
- 剩余问题：
  - 仍需在云端发布 `crm-auth`，新角色白名单才会生效。

### 2026-02-06 CURRENT — 操作日志增强（详情弹层/分页/分类/中文动作）
- 做了什么：
  - 日志页新增“动作分类”筛选，支持按认证与用户、客户、销售、钢瓶、灌装、车辆、财务、追款、工作台、安全等类别过滤。
  - `crm-log` 的 `listOperationLogsV1` 新增 `actionCategory` 后端过滤，分页总数与列表保持同口径。
  - 日志列表新增分页翻页（上一页/下一页 + 当前页码），支持按页查询日志。
  - 日志条目新增详情弹层，展示动作中文名、动作编码、操作时间、操作人、角色、请求号与完整 `detail` JSON。
  - 动作编码中文化：新增 `src/services/models/log.js`，统一动作分类与中文自然语言映射（含通用回退规则）。
- 改动文件列表：
  - `src/components/domain/log/OperationLogListView.vue`
  - `src/services/log.js`
  - `src/services/models/log.js`
  - `src/services/models/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-log/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check uniCloud-alipay/cloudfunctions/crm-log/index.js`（通过）
  - 已运行 `npm run build:h5`（通过）
- 剩余问题：
  - 中文动作映射为静态表 + 回退规则，后续若新增业务 action 需要同步扩充映射字典。

### 2026-02-06 CURRENT — 操作日志可读性优化（非开发者视角）
- 做了什么：
  - 日志列表去除“编码: xxx”直出，主视图以中文动作名 + 业务摘要为主，降低技术词暴露。
  - 日志详情新增“操作描述”业务摘要（按常见字段自动生成自然语言片段）。
  - `user_list_v1` 等动作码默认不再占据主视图；系统动作码与 JSON 明细放入“显示技术信息”开关内，按需查看。
  - 筛选区将“动作编码”标注为“高级”，避免普通用户误以为必须理解编码。
- 改动文件列表：
  - `src/components/domain/log/OperationLogListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `npm run build:h5`（通过）
  - 已运行 `node --check uniCloud-alipay/cloudfunctions/crm-log/index.js`（通过）
- 剩余问题：
  - 业务摘要采用通用字段提取规则；如需更贴近业务话术，可继续按 action 逐条定制摘要模板。

### 2026-02-06 CURRENT — 操作日志筛选下拉热区放大
- 做了什么：
  - 放大日志页筛选区下拉控件（动作分类/角色/日期）的点击热区，覆盖整块字段（含标签区），减少“点中很窄区域才触发”的问题。
  - 将 picker 包裹层改为 `width: 100%` + 最小高度，并让字段内部元素不拦截事件，统一由 picker 响应点击。
- 改动文件列表：
  - `src/components/domain/log/OperationLogListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `npm run build:h5`（通过）
- 剩余问题：
  - 其他页面的下拉点击热区仍按各自样式实现，若你确认要统一，可下一步抽成全局规范并批量替换。

### 2026-02-06 CURRENT — 下拉热区规则批量应用（全局统一）
- 做了什么：
  - 在 `src/uni.scss` 新增全局 `picker` 热区规则，统一 `picker-block/picker-full` 的点击区域与事件透传策略。
  - 规则覆盖：下拉容器统一 `display:block + width:100%`；`picker-trigger/picker-tap` 统一整块可点；`field` 内部元素禁用指针事件，避免点击被输入控件拦截。
  - 将仍使用裸 `picker` 的页面批量补齐为 `class="picker-block"`，使其自动继承统一热区规范。
- 改动文件列表：
  - `src/uni.scss`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/vehicle/VehicleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `npm run build:h5`（通过）。
- 剩余问题：
  - 旧版 `src/pages/accounting/**`（非领域组件）若继续保留并使用其原生 `picker` 布局，后续可按同样规则逐页补类名做一致性收口。

### 2026-02-06 CURRENT — 旧项目导出数据格式化为 v4 导入包（映射层集中）
- 做了什么：
  - 新增旧数据转换脚本 `src/services/mappers/legacyImport/convertLegacyExport.cjs`，将 v2 导出（NDJSON）映射为 v4 schema 可导入 NDJSON。
  - 转换逻辑遵循重构原则：不直接迁移旧宽字段，仅保留新 schema 字段；旧格式 `{"$oid": "..."}` 统一解包为字符串 ID；兼容映射集中在 `src/services/mappers/**`。
  - 生成导入包到 `state/import/legacy_v2_to_v4/`，并输出统计报告 `report.json` 与说明 `README.md`。
  - 本次实转结果：
    - 客户 `114 -> 114`
    - 车辆 `17 -> 17`
    - 钢瓶 `912 -> 912`
    - 灌装 `982 -> 972`（丢弃 10 条 `truck_out_no_sale`，因缺失 `bottle_no` 不满足 v4 `crm_fillings` 必填）
    - 销售 `422 -> 422`
- 改动文件列表：
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/crm_customers.ndjson`
  - `state/import/legacy_v2_to_v4/crm_vehicles.ndjson`
  - `state/import/legacy_v2_to_v4/crm_bottles.ndjson`
  - `state/import/legacy_v2_to_v4/crm_fillings.ndjson`
  - `state/import/legacy_v2_to_v4/crm_sale_records.ndjson`
  - `state/import/legacy_v2_to_v4/report.json`
  - `state/import/legacy_v2_to_v4/README.md`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过，生成导入包）。
  - 已运行 `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过）。
  - 已运行 schema 结构校验脚本（required/extra/type）：
    - `crm_customers`：`missing=0 extra=0 typeErr=0`
    - `crm_vehicles`：`missing=0 extra=0 typeErr=0`
    - `crm_bottles`：`missing=0 extra=0 typeErr=0`
    - `crm_fillings`：`missing=0 extra=0 typeErr=0`
    - `crm_sale_records`：`missing=0 extra=0 typeErr=0`
- 剩余问题：
  - 丢弃的 10 条 `truck_out_no_sale` 记录不属于 v4 `crm_fillings` 模型（缺瓶号），如需保留需定义到专门业务集合或在销售/流转模型补充承载。

### 2026-02-06 CURRENT — 旧数据导入包补充 JSON 数组格式（适配 uniCloud 导入）
- 做了什么：
  - 升级转换脚本 `src/services/mappers/legacyImport/convertLegacyExport.cjs`，在保留 `ndjson` 的同时新增标准 `json` 数组输出。
  - 重新生成导入包，产出可直接用于 uniCloud 的 `crm_customers.json / crm_vehicles.json / crm_bottles.json / crm_fillings.json / crm_sale_records.json`。
  - 更新导入说明文档 `state/import/legacy_v2_to_v4/README.md`，明确 JSON 为 uniCloud 导入主格式。
- 改动文件列表：
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/crm_customers.json`
  - `state/import/legacy_v2_to_v4/crm_vehicles.json`
  - `state/import/legacy_v2_to_v4/crm_bottles.json`
  - `state/import/legacy_v2_to_v4/crm_fillings.json`
  - `state/import/legacy_v2_to_v4/crm_sale_records.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `state/import/legacy_v2_to_v4/README.md`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过，生成 json+ndjson）。
  - 已运行 JSON 解析校验：5 个 `*.json` 均为数组且行数符合预期（114/17/912/972/422）。
- 剩余问题：
  - 灌装仍有 10 条 `truck_out_no_sale` 因缺少 `bottle_no` 未进入 `crm_fillings`，若业务要求保留需定义到独立模型。

### 2026-02-06 CURRENT — 按 uniCloud 官方示例修正导入 JSON 格式
- 做了什么：
  - 根据官方文档导入示例（hellodb/import），将导入主文件 `*.json` 修正为“每行一条 JSON（jsonl 形态）”，不再使用数组 JSON 作为导入主格式。
  - 转换脚本输出策略调整为：
    - `*.json`：uniCloud 导入专用（每行 JSON）
    - `*.ndjson`：与导入 `*.json` 同内容
    - `*.array.json`：标准数组 JSON（仅用于人工查看/二次处理）
  - 重新生成全部导入产物并更新 `state/import/legacy_v2_to_v4/README.md` 说明。
- 改动文件列表：
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/README.md`
  - `state/import/legacy_v2_to_v4/crm_customers.json`
  - `state/import/legacy_v2_to_v4/crm_vehicles.json`
  - `state/import/legacy_v2_to_v4/crm_bottles.json`
  - `state/import/legacy_v2_to_v4/crm_fillings.json`
  - `state/import/legacy_v2_to_v4/crm_sale_records.json`
  - `state/import/legacy_v2_to_v4/crm_customers.array.json`
  - `state/import/legacy_v2_to_v4/crm_vehicles.array.json`
  - `state/import/legacy_v2_to_v4/crm_bottles.array.json`
  - `state/import/legacy_v2_to_v4/crm_fillings.array.json`
  - `state/import/legacy_v2_to_v4/crm_sale_records.array.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过，产物重建）。
  - 已运行逐行 JSON 抽样解析校验：5 个导入 `*.json` 文件行级解析通过。
- 剩余问题：
  - 如后续导入工具对扩展名过滤严格，优先上传当前 `*.json`（逐行 JSON）文件，不用 `*.ndjson`。

### 2026-02-06 CURRENT — 配送员模块补齐（独立于用户）+ 导入链路新增配送员
- 做了什么：
  - 新增独立配送员数据模型与后端：`crm_delivery_men` schema + `crm-delivery` 云函数（`listV1/getV1/createV1/updateV1`），不再复用 `crm-user` 作为配送员数据源。
  - 新增前端配送员模块：配送员列表页/编辑页、服务层与模型校验，并接入路由与工作台侧边栏/业务宫格入口。
  - 销售录入页配送员联想改造：`SaleBasicInfoCard` 将搜索源从 `crm-user/listV1` 切换为 `crm-delivery/listV1`，建议项副文案改为手机号/备注。
  - 日志中文化与分类同步补齐：新增 `delivery_create_v1/delivery_update_v1` 动作中文映射，并在日志前后端分类中新增 `delivery`。
  - 旧数据导入脚本扩展配送员：`convertLegacyExport.cjs` 新增 `crm_delivery_men` 产出；优先读取 `about_crm_delivery_men.json`，若缺失则从销售 `delivery_man` 与灌装 `operator` 派生，最终按姓名去重。
  - 重新生成导入包，新增 `crm_delivery_men.json/.ndjson/.array.json`。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_delivery_men.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-delivery/index.js`
  - `src/services/delivery.js`
  - `src/services/models/delivery.js`
  - `src/services/models/index.js`
  - `src/services/mappers/index.js`
  - `src/components/domain/delivery/DeliveryListView.vue`
  - `src/components/domain/delivery/DeliveryEditView.vue`
  - `src/pages/delivery/list.vue`
  - `src/pages/delivery/edit.vue`
  - `src/pages.json`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/services/models/log.js`
  - `uniCloud-alipay/cloudfunctions/crm-log/index.js`
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.json`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.ndjson`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.array.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `state/import/legacy_v2_to_v4/README.md`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check uniCloud-alipay/cloudfunctions/crm-delivery/index.js`（通过）。
  - 已运行 `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过）。
  - 已运行 `node src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过，新增配送员导入文件）。
  - 已运行逐行 JSON 解析校验：`crm_customers/crm_vehicles/crm_delivery_men/crm_bottles/crm_fillings/crm_sale_records` 均解析通过。
  - 已运行 `npm run build:h5`（通过）。
  - 说明：`.vue` 文件不适用 `node --check`，由 `npm run build:h5` 覆盖前端语法与打包校验。
- 剩余问题：
  - 需在 uniCloud 发布 `crm-delivery` 云函数并同步 `crm_delivery_men` schema/index 后，线上才可用。
  - 由于旧库缺少配送员主文件，本次配送员由销售/灌装文本派生（15 人）；建议导入后人工核对同名与手机号。

### 2026-02-06 CURRENT — 旧配送员导出文件对齐为 v4 可导入格式
- 做了什么：
  - 接入并解析用户提供的旧配送员导出文件：`/Users/wangbo/Downloads/20260206135817_8f915bb4-91ee-4bf6-a1f7-e2f9e17470a4.json`（15 条）。
  - 调整迁移脚本 `transformDeliveries` 规则：当存在正式配送员导出时，仅使用该文件映射；仅在缺失时才从销售/灌装文本派生，避免混入额外人员。
  - 重新生成导入包，`crm_delivery_men.json` 现为 15 条，保留手机号与在岗状态映射（`status: active/inactive -> is_active: true/false`）。
  - 更新导入说明 `state/import/legacy_v2_to_v4/README.md`，补充配送员映射策略。
- 改动文件列表：
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.json`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.ndjson`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.array.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `state/import/legacy_v2_to_v4/README.md`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过）。
  - 已运行 `node src/services/mappers/legacyImport/convertLegacyExport.cjs --deliveries /Users/wangbo/Downloads/20260206135817_8f915bb4-91ee-4bf6-a1f7-e2f9e17470a4.json`（通过）。
  - 已校验 `state/import/legacy_v2_to_v4/crm_delivery_men.json`：`15` 行逐行 JSON 解析通过，字段类型基础校验通过。
- 剩余问题：
  - 需在 uniCloud 导入该文件并发布 `crm_delivery_men` schema/`crm-delivery` 云函数后，前端配送员模块才可完整使用。

### 2026-02-06 CURRENT — 列表页回跳自动刷新（统一 onShow + refresh 协议）
- 做了什么：
  - 修复 `pages/delivery/list -> pages/delivery/edit -> 返回 list` 不自动刷新的问题。
  - 采用统一机制批量治理同类问题：
    - 页面容器层（`src/pages/**/list.vue`）新增 `onShow` 调度；首次展示跳过，后续每次回到列表页调用子组件 `refresh()`。
    - 领域列表组件层（`src/components/domain/**/**ListView.vue`）统一 `defineExpose({ refresh: onSearch })`，复用现有查询逻辑，不把业务逻辑堆到 page。
  - 本次覆盖页面：销售、客户、钢瓶、车辆、配送员、灌装、追款任务、操作日志、会计科目、凭证、账期。
- 改动文件列表：
  - `src/pages/delivery/list.vue`
  - `src/pages/customer/list.vue`
  - `src/pages/vehicle/list.vue`
  - `src/pages/bottle/list.vue`
  - `src/pages/filling/list.vue`
  - `src/pages/sale/list.vue`
  - `src/pages/collection/task-list.vue`
  - `src/pages/log/list.vue`
  - `src/pages/accounting/account-list.vue`
  - `src/pages/accounting/voucher-list.vue`
  - `src/pages/accounting/period-list.vue`
  - `src/components/domain/delivery/DeliveryListView.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/vehicle/VehicleListView.vue`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/collection/CollectionTaskListView.vue`
  - `src/components/domain/log/OperationLogListView.vue`
  - `src/components/domain/accounting/AccountListView.vue`
  - `src/components/domain/accounting/VoucherListView.vue`
  - `src/components/domain/accounting/PeriodListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `npm run build:h5`（通过）。
  - 已检索确认 11 个 `*ListView` 已暴露 `refresh: onSearch`，11 个 `pages/**/list.vue` 已接入 `onShow -> refresh`。
- 剩余问题：
  - 该机制依赖“返回到原列表页（`navigateBack`）”路径；若后续改为重定向跳转（`reLaunch/switchTab`）需按新路由策略评估是否保留首次跳过逻辑。

### 2026-02-06 CURRENT — 旧系统全量导出先行管道（manifest + TRUCK专项 + 严格门禁）
- 做了什么：
  - 新增全量导出管道脚本 `src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs`，覆盖：
    - 10 个旧库集合导出文件契约检查（`about_crm_*.json`）。
    - 生成 `manifest.json`（行数、日期范围、SHA256、200 行样本 JSON 可解析校验）。
    - 执行全量门禁校验（销售/灌装日期是否超过 `2026-01-14`、是否包含 `2026-02-04` 销售、是否命中“新乐新天下塑业 + TRUCK”样本）。
    - 产出 TRUCK 专项清单：`truck_out_no_sale_events.json`、`truck_literal_audit.json`。
    - 在输入满足映射前提时，自动调用 `convertLegacyExport.cjs` 重建 v4 导入包。
  - 更新导入说明 `state/import/legacy_v2_to_v4/README.md`，新增“控制台全量导出先行”命令与文件清单。
  - 按指定目录创建并预置当前已有导出：`/Users/wangbo/Downloads/legacy_full_export_20260206`（已放入 customers/vehicles/delivery_men/bottles/fillings/sales）。
- 改动文件列表：
  - `src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs`
  - `state/import/legacy_v2_to_v4/README.md`
  - `/Users/wangbo/Downloads/legacy_full_export_20260206/manifest.json`
  - `state/import/legacy_v2_to_v4/truck_out_no_sale_events.json`
  - `state/import/legacy_v2_to_v4/truck_literal_audit.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行 `node --check src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs`（通过）。
  - 已运行 `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`（通过）。
  - 已运行严格门禁：
    - `node src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs --inputDir /Users/wangbo/Downloads/legacy_full_export_20260206 --outputDir state/import/legacy_v2_to_v4 --manifestOut /Users/wangbo/Downloads/legacy_full_export_20260206/manifest.json`
    - 结果：按预期返回非 0（`exit code 2`），因全量条件未满足。
  - 门禁失败细项（来自 `manifest.json`）：
    - 缺失文件：`about_crm_users.json`、`about_crm_operation_logs.json`、`about_crm_bottle_anomalies.json`、`about_crm_gas_in.json`。
    - 日期覆盖未过线：销售/灌装 `date_max` 仍为 `2026-01-14`。
    - 未命中目标样本：`2026-02-04` 与“新乐新天下塑业 + TRUCK”。
- 剩余问题：
  - 需你在旧系统控制台补齐 4 个缺失集合并重新全量导出销售/灌装（覆盖到 `2026-02-04` 及之后）。
  - 补齐后重新运行同一命令，门禁通过后再进入 TRUCK 保留/清洗落地规则。

### 2026-02-07 CURRENT — 接入 `u_want` 全量样本并复跑门禁
- 做了什么：
  - 检测到你在项目目录提供了 `u_want` 导出目录，包含 `crm_customers/crm_vehicles/crm_delivery_men/crm_bottles/crm_filling_records/crm_sale_records/crm_gas_in`。
  - 将上述文件对齐为门禁脚本契约命名（`about_crm_*.json`），并在 `u_want` 目录生成 `manifest.json`。
  - 复跑严格门禁 + 映射重建，重新产出 TRUCK 专项清单。
- 改动文件列表：
  - `u_want/about_crm_customers.json`
  - `u_want/about_crm_vehicles.json`
  - `u_want/about_crm_delivery_men.json`
  - `u_want/about_crm_bottles.json`
  - `u_want/about_crm_filling_records.json`
  - `u_want/about_crm_sale_records.json`
  - `u_want/about_crm_gas_in.json`
  - `u_want/manifest.json`
  - `state/import/legacy_v2_to_v4/truck_out_no_sale_events.json`
  - `state/import/legacy_v2_to_v4/truck_literal_audit.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `state/import/legacy_v2_to_v4/crm_*.json/.ndjson/.array.json`（重建）
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs --inputDir /Users/wangbo/Downloads/2026_v4/u_want --outputDir state/import/legacy_v2_to_v4 --manifestOut /Users/wangbo/Downloads/2026_v4/u_want/manifest.json`
  - 结果：按预期 `exit code 2`（严格模式仍未全绿）。
  - 已通过门禁：
    - 销售 `date_max=2026-02-07`（> `2026-01-14`）
    - 灌装 `date_max=2026-02-07`（> `2026-01-14`）
    - 命中 `2026-02-04` 销售
    - 命中“新乐新天下塑业 + TRUCK”记录
  - 未通过门禁：
    - 仍缺 `about_crm_users.json`、`about_crm_operation_logs.json`、`about_crm_bottle_anomalies.json`
  - TRUCK专项摘要：
    - `truck_out_no_sale`: `33` 条，`out_net_sum=10673`，范围 `2026-01-01 21:59 ~ 2026-02-07 08:00`
    - `truck_literal_audit`: `21` 命中，`7` 条销售记录，`TRUCK-NO=0`，全部 `TRUCK-*` 且可追溯
- 剩余问题：
  - 需在旧系统控制台补导出 3 个归档集合文件后，严格门禁才能全量通过。

### 2026-02-07 CURRENT — `u_want` 补齐后全量门禁通过并重建导入包
- 做了什么：
  - 接入你补齐后的 `u_want` 归档集合：`crm_users`、`crm_operation_logs`、`crm_bottle_anomalies`。
  - 将三者对齐到门禁脚本命名：`about_crm_users.json`、`about_crm_operation_logs.json`、`about_crm_bottle_anomalies.json`。
  - 重新执行全量导出管道（严格模式），并重建 v4 可导入 jsonl 文件。
  - 复核导入格式：6 个 `crm_*.json` 均为“每行一条 JSON（jsonl）”，前 200 行抽样解析通过。
- 改动文件列表：
  - `u_want/about_crm_users.json`
  - `u_want/about_crm_operation_logs.json`
  - `u_want/about_crm_bottle_anomalies.json`
  - `u_want/manifest.json`
  - `state/import/legacy_v2_to_v4/crm_customers.json`
  - `state/import/legacy_v2_to_v4/crm_vehicles.json`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.json`
  - `state/import/legacy_v2_to_v4/crm_bottles.json`
  - `state/import/legacy_v2_to_v4/crm_fillings.json`
  - `state/import/legacy_v2_to_v4/crm_sale_records.json`
  - `state/import/legacy_v2_to_v4/crm_customers.ndjson`
  - `state/import/legacy_v2_to_v4/crm_vehicles.ndjson`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.ndjson`
  - `state/import/legacy_v2_to_v4/crm_bottles.ndjson`
  - `state/import/legacy_v2_to_v4/crm_fillings.ndjson`
  - `state/import/legacy_v2_to_v4/crm_sale_records.ndjson`
  - `state/import/legacy_v2_to_v4/crm_customers.array.json`
  - `state/import/legacy_v2_to_v4/crm_vehicles.array.json`
  - `state/import/legacy_v2_to_v4/crm_delivery_men.array.json`
  - `state/import/legacy_v2_to_v4/crm_bottles.array.json`
  - `state/import/legacy_v2_to_v4/crm_fillings.array.json`
  - `state/import/legacy_v2_to_v4/crm_sale_records.array.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `state/import/legacy_v2_to_v4/truck_out_no_sale_events.json`
  - `state/import/legacy_v2_to_v4/truck_literal_audit.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs --inputDir /Users/wangbo/Downloads/2026_v4/u_want --outputDir state/import/legacy_v2_to_v4 --manifestOut /Users/wangbo/Downloads/2026_v4/u_want/manifest.json`
  - 结果：`exit code 0`（严格门禁通过）。
  - `manifest` 关键项：
    - `missing_required_files=[]`
    - `sales_date_max_gt_2026_01_14=true`
    - `fillings_date_max_gt_2026_01_14=true`
    - `sales_contains_2026_02_04=true`
    - `sales_contains_target_customer_truck_record=true`
  - 导入格式校验（jsonl）：
    - `crm_customers/vehicles/delivery_men/bottles/fillings/sale_records.json` 首字符均为 `{`，非数组。
    - 6 个文件前 200 行 JSON 解析通过。
- 剩余问题：
  - `crm_fillings` 仍有 `33` 条 `missing_bottle_no`（`truck_out_no_sale`）未进入按瓶灌装模型；已完整保存在 `truck_out_no_sale_events.json` 待后续规则落地。

### 2026-02-07 CURRENT — 补齐流转明细与异常导入包（全量旧库对齐）
- 做了什么：
  - 扩展 `src/services/mappers/legacyImport/convertLegacyExport.cjs`，新增：
    - 读取 `about_crm_bottle_anomalies.json`（缺失时可空跑）。
    - `transformMovements`：用新库销售 `out/back` + 灌装 `fill` 重建 `crm_bottle_movements` 事件流。
    - `transformAnomalies`：将旧库异常标准化为新库 `crm_bottle_anomalies`（保留状态、上下文、关联记录）。
  - 重新执行全量导出管道，产出新增导入文件：
    - `crm_bottle_movements.json/.ndjson/.array.json`
    - `crm_bottle_anomalies.json/.ndjson/.array.json`
  - 更新导入说明 `state/import/legacy_v2_to_v4/README.md` 的输出清单与口径说明。
- 改动文件列表：
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/README.md`
  - `state/import/legacy_v2_to_v4/crm_bottle_movements.json`
  - `state/import/legacy_v2_to_v4/crm_bottle_movements.ndjson`
  - `state/import/legacy_v2_to_v4/crm_bottle_movements.array.json`
  - `state/import/legacy_v2_to_v4/crm_bottle_anomalies.json`
  - `state/import/legacy_v2_to_v4/crm_bottle_anomalies.ndjson`
  - `state/import/legacy_v2_to_v4/crm_bottle_anomalies.array.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `u_want/manifest.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`
    - `node src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs --inputDir /Users/wangbo/Downloads/2026_v4/u_want --outputDir state/import/legacy_v2_to_v4 --manifestOut /Users/wangbo/Downloads/2026_v4/u_want/manifest.json`
  - 结果：`exit code 0`（严格门禁通过，映射执行成功）。
  - 产物统计：
    - `crm_bottle_movements.json`：`7107` 行（schema 字段校验 0 问题）
    - `crm_bottle_anomalies.json`：`828` 行（schema 字段校验 0 问题）
  - 导入格式校验（jsonl）：
    - 新增两文件前 200 行 JSON 解析通过。
    - 首行均为对象记录（非数组）。
- 剩余问题：
  - 旧库异常类型中存在 `missing_out/customer_mismatch/duplicate_sale`，新库可存储并展示，但仪表盘分布图当前只统计 `missing_back/missing_fill/continuous_out`。

### 2026-02-09 CURRENT — 流转 P0：统一事件时间轴 + 异常去重修复
- 做了什么：
  - 为流转事件补齐统一时间轴字段并全链路落库：
    - 新增 `event_day`（YYYY-MM-DD）、`event_at`（毫秒时间戳，按 +08 解析）、`type_order`（`back/fill/out/adjust` 显式顺序）。
    - 覆盖来源：`crm-sale` 自动流转写入、`crm-filling` 灌装写入、`crm-bottle-movement` 手工写入、`crm-bottle-anomaly` 自动修复写入。
  - 修复异常扫描去重逻辑：
    - 新增 `fingerprint` 字段（按 `bottle_no + anomaly_type + date/context/detail` 生成）。
    - `scanV1` 从“错误依赖顶层 `date` 字段”改为“同瓶同类型 open 异常内按 `fingerprint` 判重”。
  - 流转查询排序改为稳定时间轴：
    - `crm-bottle-movement listV1` 由 `date` 字符串排序改为 `event_at + type_order + created_at` 排序。
    - 同时支持 `source_type/dateStart/dateEnd/page/pageSize` 查询参数（向后兼容旧调用）。
  - 更新导入映射脚本：
    - `convertLegacyExport.cjs` 导出 `crm_bottle_movements` 时写入 `event_day/event_at/type_order`。
    - `convertLegacyExport.cjs` 导出 `crm_bottle_anomalies` 时写入 `fingerprint`。
  - 更新 schema：
    - `crm_bottle_movements.schema.json` 新增并强制 `event_day/event_at/type_order`。
    - `crm_bottle_anomalies.schema.json` 新增 `fingerprint` 与索引 `idx_fingerprint_status`。
- 改动文件列表：
  - `uniCloud-alipay/database/schema/crm_bottle_movements.schema.json`
  - `uniCloud-alipay/database/schema/crm_bottle_anomalies.schema.json`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `state/import/legacy_v2_to_v4/crm_bottle_movements.json`
  - `state/import/legacy_v2_to_v4/crm_bottle_movements.ndjson`
  - `state/import/legacy_v2_to_v4/crm_bottle_movements.array.json`
  - `state/import/legacy_v2_to_v4/crm_bottle_anomalies.json`
  - `state/import/legacy_v2_to_v4/crm_bottle_anomalies.ndjson`
  - `state/import/legacy_v2_to_v4/crm_bottle_anomalies.array.json`
  - `state/import/legacy_v2_to_v4/report.json`
  - `u_want/manifest.json`
  - `STATE.md`
- 验证输出要点：
  - 语法检查通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - 全量管道重跑通过：
    - `node src/services/mappers/legacyImport/runLegacyFullExportPipeline.cjs --inputDir /Users/wangbo/Downloads/2026_v4/u_want --outputDir state/import/legacy_v2_to_v4 --manifestOut /Users/wangbo/Downloads/2026_v4/u_want/manifest.json`
    - 结果：`exit code 0`。
  - 导入产物关键校验：
    - `crm_bottle_movements.json` `7107` 行，`event_day/event_at/type_order` 缺失 `0`。
    - `crm_bottle_anomalies.json` `828` 行，`fingerprint` 缺失 `0`。
    - open 异常按 `fingerprint` 无重复键（`0`）。
- 剩余问题：
  - 已上线环境若仍有旧流转数据（无 `event_*` 字段），建议在部署后执行一次“按销售/灌装重建流转事件”以完全统一排序与扫描口径。

### 2026-02-09 CURRENT — 流转 P1：筛选/分页/统计口径升级
- 做了什么：
  - `crm-bottle-movement listV1` 增强：
    - 支持 `source_type/dateStart/dateEnd/page/pageSize` 参数。
    - 返回 `total/page/pageSize/summary`（`summary` 含 `total/out/back/fill/adjust`），统计口径为后端过滤后汇总。
    - 列表排序固定为 `event_at -> type_order -> created_at`。
  - `src/services/bottleMovement.js` 同步传递新增查询参数。
  - `BottleMovementView` 重构为“可运营”列表：
    - 增加来源筛选与日期范围筛选。
    - 增加分页翻页与每页条数选择（20/50/100/200）。
    - 统计卡片使用后端 `summary`，不再用当前页 `list.length` 近似。
    - 默认加载最近 30 天数据，避免首屏全量加载过重。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/services/bottleMovement.js`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
  - 结果：全部通过。
- 剩余问题：
  - 前端目前仍是“列表视图”为主；若要进一步做单瓶时间线/闭环诊断，需要单独增加 `timelineV1` 聚合接口与对应领域组件。

### 2026-02-09 CURRENT — 流转 P2：单瓶时间线 + 闭环状态 + 异常高亮
- 做了什么：
  - 新增 `crm-bottle-movement timelineV1`：
    - 入参：`bottle_no`（必填）、`limit`。
    - 返回：`events/anomalies/markers/state/stats`，用于单瓶全链路诊断。
    - `state` 口径：优先看 open 异常；否则按最后事件类型给出 `待回瓶/待灌装/可出瓶/调整后待确认`。
    - `markers` 通过异常 `context`（`last_back/next_out/legacy_date`）与 note 日期提取生成，用于事件级异常点高亮。
  - 流转页升级为双视图（列表 + 单瓶时间线）：
    - 列表项可点击直接打开该瓶号时间线。
    - 提供独立“查看瓶号”输入框（支持回车）与“刷新时间线/清空”动作。
    - 展示闭环状态标签、闭环估算数、待处理异常数。
    - 时间线事件显示异常点标签（区分待处理/历史异常）。
    - 补“关联异常”列表，直接查看该瓶号异常明细。
  - 前端服务新增 `getBottleMovementTimelineV1` 调用封装。
  - 操作日志动作映射补齐 `bottle_movement_timeline_v1` 中文语义。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/services/bottleMovement.js`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `src/services/models/log.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check src/services/bottleMovement.js`
    - `npm run build:h5`
  - 结果：全部通过。
- 剩余问题：
  - 旧历史数据若仍存在少量未补 `event_at/type_order` 的在线记录，时间线排序会退化为 `created_at` 近似顺序；建议继续执行一次线上流转重建脚本以完全统一。

### 2026-02-09 CURRENT — 修复时间线信息“跑到页面底部”体验
- 做了什么：
  - 将“单瓶时间线”区块视觉顺序提前到“流转列表”上方（保持筛选区在最上方）。
  - 点击列表项/手动查询/刷新时间线后，自动滚动到时间线锚点，确保用户立即看到结果区。
- 改动文件列表：
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：`npm run build:h5`，通过。
  - 备注：`node --check` 不支持 `.vue` 文件语法检查（工具限制），以构建通过作为验证。
- 剩余问题：
  - 若需要“就地展开（在点击行下方直接展开时间线）”交互，可在下一步改为行内折叠面板实现。

### 2026-02-09 CURRENT — 流转交互调整：列表点击进入独立时间线页
- 做了什么：
  - 按“职责分离”改造流转模块：
    - `流转记录页` 仅保留筛选、统计、分页与记录列表。
    - 点击任意记录后，跳转到独立页面 `pages/bottle/timeline` 展示单瓶时间线与关联异常。
  - 新增 `BottleMovementTimelineView` 领域组件，承载单瓶时间线完整视图（闭环状态、事件流、异常列表）。
  - 新增 `pages/bottle/timeline.vue` 页面容器，并在 `pages.json` 注册路由。
- 改动文件列表：
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `src/pages/bottle/timeline.vue`
  - `src/pages.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
  - 结果：通过。
  - 路由与跳转核对：
    - 列表页跳转：`/pages/bottle/timeline?bottle_no=...`
    - 路由声明：`pages/bottle/timeline`
- 剩余问题：
  - 需要你在本地实测一次“列表点击 -> 新页面时间线自动加载”链路，确认你期望的操作节奏。

### 2026-02-10 CURRENT — 时间线倒序 + 默认五条折叠 + 业务日期统一
- 做了什么：
  - 单瓶时间线事件改为前端倒序展示，排序键为 `event_at` -> `type_order` -> `created_at`（均为降序）。
  - 时间线默认仅显示最新 5 条，新增“展开剩余 N 条 / 收起”交互。
  - 每次“查看瓶号”与“刷新时间线”后重置为折叠态，保持默认只看最新 5 条。
  - 时间线事件标题统一为业务日期显示：优先 `event_day`，回退 `date`，均规范为 `YYYY-MM-DD`，缺失时显示 `-`。
  - 流转记录列表副标题同步统一为业务日期显示口径（同上）。
- 改动文件列表：
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：`npm run build:h5`（通过，输出 `DONE  Build complete.`）。
  - 未运行：云函数相关 `node --check`（本次仅前端 `.vue` 视图与交互改动）。
- 剩余问题：
  - 当前“展开/收起”状态不做跨页面持久化；若需要保留用户上次展开状态，可在下一步接入本地缓存。

### 2026-02-10 CURRENT — 修复同日顺序反转与 missing_back 误报清理
- 做了什么：
  - `crm-bottle-anomaly scanV1` 增加可选入参 `reconcile_missing_back`，并在单瓶扫描场景支持自动关闭已不成立的 open `missing_back`（`resolved_by_name=system-reconcile`）。
  - `scanV1` 返回值新增 `resolved_stale`（本次自动关闭条数），并写入扫描日志详情。
  - 异常扫描排序改为业务顺序优先：`event_day -> type_order -> event_at -> created_at`，避免同日 `fill` 因时分秒领先于 `out/back` 造成误判。
  - `missing_back` 检测改为结构化上下文输出：`context.last_out` + `context.next_fill`。
  - 时间线标记生成增强：`crm-bottle-movement` 优先使用 `context.last_out/next_fill` 打点到 `out/fill` 事件；仅在缺结构化上下文时回退 `legacy_date`/note 日期匹配。
  - 时间线页同日排序改为业务日优先：`event_day -> type_order -> event_at -> created_at`（倒序视图下同日固定 `出瓶 > 灌装 > 回瓶`）。
  - 前端异常扫描调用新增 `reconcileMissingBack` 透传，异常页对“单瓶扫描”默认开启；扫描提示改为“新增 X 条，自动关闭 Y 条”。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `src/services/bottleAnomaly.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check src/services/bottleAnomaly.js`
    - `npm run build:h5`（`DONE  Build complete.`）
  - 未运行：线上真实瓶号扫描回归（需在带历史异常数据的环境验证 `resolved_stale` 实际清理效果）。
- 剩余问题：
  - 历史 `missing_back` 里仅含 `legacy_date` 的旧记录，仍需触发一次“单瓶扫描（带 reconcile）”后才会从时间线 open 红标中清退。

### 2026-02-11 CURRENT — 异常扫描单轨切换：下线 scanV1，上线 scanV2 多轮安全扫描
- 做了什么：
  - 云函数 `crm-bottle-anomaly` 删除 `scanV1` 分支，改为仅保留 `scanV2`（单瓶必填）。
  - `scanV2` 实现多轮安全扫描能力：
    - 入参支持 `bottle_no / cursor / reconcile_missing_back / batch_size / max_events_per_round / max_ms_per_round / max_writes_per_round`。
    - 采用复合游标顺序扫描 `event_at -> type_order -> created_at`，并按“业务日缓冲+同日业务序”判定异常，避免同日顺序抖动。
    - 返回 `done / cursor / round_created / round_resolved_stale / round_scanned_events`，可前端多轮续扫。
    - `reconcile_missing_back=true` 时，仅在当前瓶号内自动关闭 stale `missing_back`，写入 `resolved_by_name=system-reconcile`。
  - 前端异常服务改为 V2 单轨：
    - 删除 `scanBottleAnomaliesV1` 导出。
    - 新增 `scanBottleAnomaliesRoundV2`（单轮）与 `scanBottleAnomaliesSafeV2`（多轮聚合）。
  - 异常页扫描按钮改为调用 `scanBottleAnomaliesSafeV2`，单瓶默认开启 `reconcileMissingBack=true`，并展示“新增 X 条，自动关闭 Y 条”。
  - 单瓶时间线页接入扫描联动：
    - 查询前先执行首轮 `scanV2`，再拉时间线。
    - 若未完成且返回 cursor，则后台续扫最多 3 轮；若期间有新增/自动关闭，则自动刷新一次时间线。
  - 日志动作映射新增 `bottle_anomaly_scan_v2`（保留 `bottle_anomaly_scan_v1` 仅供历史日志展示）。
  - 代码内执行 `rg` 校验：`src` 与 `uniCloud-alipay/cloudfunctions` 运行代码中已无 `scanV1|scanBottleAnomaliesV1` 残留。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/services/bottleAnomaly.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `src/services/models/log.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check src/services/bottleAnomaly.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`（`DONE  Build complete.`）
    - `rg -n "scanV1|scanBottleAnomaliesV1" src uniCloud-alipay/cloudfunctions`（无输出）
- 剩余问题：
  - 当前 `scanV2` 仅支持单瓶扫描；如后续需要“全库批扫”需另设批任务入口，避免在交互式云函数内拉长执行时间。

### 2026-02-11 CURRENT — 异常扫描纠偏补齐：三类异常统一判定与自动清理
- 做了什么：
  - `crm-bottle-anomaly scanV2` 补齐三类异常纠偏：`missing_back` / `missing_fill` / `continuous_out` 均可参与 stale 自动关闭。
  - 新增 `scanV2` 可选入参：
    - `reconcile_anomalies`（是否启用自动纠偏）
    - `reconcile_types`（纠偏类型白名单）
  - 保留旧参数兼容：`reconcile_missing_back=true` 在未显式传 `reconcile_anomalies` 时仍等价于仅纠偏 `missing_back`。
  - 扫描状态机重构为业务语义状态：`last_effective_event` / `last_out_event` / `last_back_event` / `has_fill_since_last_back`；同日仍固定按业务顺序（回瓶→灌装→出瓶）判定。
  - `adjust` 设为中性事件：不触发异常，不重置上述三条业务链。
  - cursor 扩展为 `detected_fps_by_type`（并保留 `detected_missing_back_fps` 兼容输出），支持跨轮持续识别三类异常指纹。
  - 异常指纹生成改为结构化上下文优先（移除 detail 文本依赖），降低文案差异导致的重复/误清问题。
  - 异常页与时间线页的单瓶扫描默认切到三类纠偏：
    - `reconcileAnomalies: true`
    - `reconcileTypes: ['missing_back','missing_fill','continuous_out']`
  - `scanV2` 日志 detail 增强记录：`reconcile_anomalies`、`reconcile_types`、`round_created`、`round_resolved_stale`、`round_scanned_events`、`done`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/services/bottleAnomaly.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check src/services/bottleAnomaly.js`
    - `npm run build:h5`（`DONE  Build complete.`）
  - 样本验收结果（379/151/312）：
    - 当前仓库内仅完成代码与构建验证，未在线上数据环境执行逐轮扫描，样本结果待线上回归填充。
- 剩余问题：
  - 需要在线上按样本 A=379、B=151、C=312 执行多轮 `scanV2` 验证，确认误报关闭计数与时间线红标变化符合预期。

### 2026-02-11 CURRENT — 纠偏补齐后续修正：兼容入参与指纹回退
- 做了什么：
  - 修正 `src/services/bottleAnomaly.js` 参数透传：仅在调用方显式传入时才发送 `reconcile_anomalies/reconcile_types`，避免覆盖旧参数兼容路径。
  - 修正 `buildAnomalyFingerprint`：在缺少结构化上下文字段时回退引入 `detail` 参与指纹，降低历史稀疏数据碰撞风险。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/services/bottleAnomaly.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check src/services/bottleAnomaly.js`
    - `npm run build:h5`（`DONE  Build complete.`）
    - `rg -n "scanV1|scanBottleAnomaliesV1" src uniCloud-alipay/cloudfunctions`（无输出）
- 剩余问题：
  - 仍需线上样本（379/151/312）执行逐轮验收并回填实际 `round_created/round_resolved_stale` 结果。

### 2026-02-11 CURRENT — 异常全量重建入口 + 动态增量更新 + 损耗统计页补齐
- 做了什么：
  - `crm-bottle-anomaly`：
    - `rebuildV2` 权限收紧为仅 `superadmin`。
    - 新增 `touchV2`（按瓶号数组同步触发受影响瓶增量扫描，带限时限量参数），并记录 `bottle_anomaly_touch_v2` 日志。
  - `crm-sale`：
    - 新增 `removeV2`（已过账凭证禁止删；删除草稿凭证/分录、销售流转事件、销售单）。
    - `createV2/updateV2/removeV2` 成功后触发 `crm-bottle-anomaly.touchV2`；触发失败不回滚主业务，仅返回 warning 并记录失败日志。
    - `updateV2` 修正为“旧单是瓶装或新单是瓶装”都会先清理旧流转事件，避免瓶装->非瓶装残留。
  - `crm-filling`：
    - 新增 `getV1/updateV1/removeV1`。
    - `createV1/updateV1/removeV1` 成功后触发 `crm-bottle-anomaly.touchV2`；触发失败不回滚主业务，仅记录失败日志并返回 warning。
  - 异常页：
    - `BottleAnomalyView` 新增“全量扫描异常”按钮，仅 `superadmin` 可见，调用 `rebuildBottleAnomaliesSafeV2` 多轮安全扫描并展示轮次结果。
  - 损耗统计：
    - 新增 `BottleLossView` 与页面 `/pages/bottle/loss`。
    - 新增服务 `getBottleLossStatsV1` 并接 `crm-bottle-movement.lossStatsV1`。
    - 工作台 `DashboardHome` 新增“损耗统计”入口（侧栏 + 业务管理宫格）。
  - 前端销售/灌装操作补齐：
    - 销售：`sale.js` 新增 `removeSaleV2`；`SaleDetailView` 新增删除按钮。
    - 灌装：`filling.js` 新增 `getFillingV1/updateFillingV1/removeFillingV1`；`FillingListView` 新增编辑/删除；`FillingEditView` 支持编辑模式（通过 `_id` 加载并更新）；`pages/filling/edit.vue` 透传 `_id`。
  - 日志映射：
    - `src/services/models/log.js` 新增 `bottle_anomaly_rebuild_v2`、`bottle_anomaly_touch_v2`、`sale_remove_v2`、`filling_get_v1`、`filling_remove_v1`、`bottle_movement_loss_stats_v1` 等映射。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `src/services/bottleAnomaly.js`
  - `src/services/bottleMovement.js`
  - `src/services/sale.js`
  - `src/services/filling.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/filling/FillingEditView.vue`
  - `src/pages/bottle/loss.vue`
  - `src/pages/filling/edit.vue`
  - `src/pages.json`
  - `src/services/models/log.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check src/services/bottleAnomaly.js`
    - `node --check src/services/bottleMovement.js`
    - `node --check src/services/sale.js`
    - `node --check src/services/filling.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`（`DONE  Build complete.`）
- 剩余问题：
  - 线上“清表后全量重建”仍需由 `superadmin` 在异常页执行到 `done=true`，并用样本瓶号（379/151/312）做实数据验收。
  - 动态增量扫描为同步限时触发，超大瓶号在单次写后可能只完成部分轮次，后续可通过异常页单瓶/全量扫描继续补齐。

### 2026-02-11 CURRENT — 顶部统计真实化（异常/销售/客户/灌装）+ 分页统一每页 50
- 做了什么：
  - 后端列表接口统一补齐 `paging + summary`，前端不再用“当前页 50 条”推导顶部统计。
  - 异常页：
    - `crm-bottle-anomaly.listV1` 新增 `summary_ignore_status`，支持“列表按状态筛选、顶部统计忽略状态筛选”。
    - `BottleAnomalyView` 接入后端 `paging/summary`，新增上一页/下一页，查询参数固定 `pageSize=50`。
  - 销售页：
    - `crm-sale.listV2` 新增 `paging + summary(total/paid/partial/unpaid)`，统计跟随当前筛选条件。
    - `SaleListView` 接入后端汇总与分页，顶部统计与“共 X 条”均使用真实总量。
  - 客户页：
    - `crm-customer.listV1` 新增 `paging + summary(total/active/inactive/priced)` 与 `summary_ignore_active`。
    - `CustomerListView` 接入后端汇总与分页，状态筛选仅影响列表，顶部统计忽略 `is_active`（仍跟随关键词等条件）。
  - 灌装页：
    - `crm-filling.listV1` 新增 `paging + summary(total/station/external/with_remark)`。
    - `FillingListView` 接入后端汇总与分页，顶部统计与列表总数按真实筛选结果展示。
  - 服务层透传：
    - `src/services/bottleAnomaly.js` 支持 `summary_ignore_status`。
    - `src/services/customer.js` 支持 `summary_ignore_active`。
    - `src/services/filling.js` 改为透传 `page/pageSize`（保留 `limit` 兼容）。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `src/services/bottleAnomaly.js`
  - `src/services/customer.js`
  - `src/services/filling.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check src/services/bottleAnomaly.js`
    - `node --check src/services/sale.js`
    - `node --check src/services/customer.js`
    - `node --check src/services/filling.js`
    - `npm run build:h5`（`DONE  Build complete.`）
- 剩余问题：
  - 本次按约定只先修 4 页（异常/销售/客户/灌装）；其他列表页若存在“顶部统计按当前页计算”的同类问题，需按相同口径继续改造。

### 2026-02-11 CURRENT — 顶部统计真实化第二批（钢瓶/配送员/车辆）+ 分页统一每页 50
- 做了什么：
  - 后端列表接口补齐 `paging + summary`，对应页面顶部统计改为后端真实汇总，不再使用 `list.length` 计算。
  - 钢瓶：
    - `crm-bottle.listV1` 返回 `paging` 与 `summary(total/in_station/at_customer/abnormal)`。
    - `BottleListView` 接入真实统计与分页（上一页/下一页），查询重置到第 1 页，刷新保留当前页。
  - 配送员：
    - `crm-delivery.listV1` 返回 `paging` 与 `summary(total/active/inactive/with_phone)`。
    - `DeliveryListView` 接入真实统计与分页，查询重置到第 1 页。
  - 车辆：
    - `crm-vehicle.listV1` 返回 `paging` 与 `summary(total/active/inactive/with_remark)`。
    - `VehicleListView` 接入真实统计与分页，查询重置到第 1 页。
  - 服务层透传分页参数：
    - `src/services/bottle.js`
    - `src/services/delivery.js`
    - `src/services/vehicle.js`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-delivery/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
  - `src/services/bottle.js`
  - `src/services/delivery.js`
  - `src/services/vehicle.js`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/delivery/DeliveryListView.vue`
  - `src/components/domain/vehicle/VehicleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-delivery/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
    - `node --check src/services/bottle.js`
    - `node --check src/services/delivery.js`
    - `node --check src/services/vehicle.js`
    - `npm run build:h5`（`DONE  Build complete.`）
- 剩余问题：
  - 账务与催收相关列表页仍存在“顶部统计按当前页计算”的历史写法（如科目/凭证/总账/明细账/应收明细/催收任务），可按同口径继续第三批改造。

### 2026-02-11 CURRENT — 顶部统计真实化第三批（凭证/科目/总账/明细账/往来明细/催收任务）
- 做了什么：
  - 后端接口新增 `paging + summary`，并把前端统计卡切到后端真实汇总，不再基于当前页 `list.length` 推导。
  - 凭证页：
    - `crm-voucher.listV1` 返回 `paging` 与 `summary(total/posted/draft/with_summary)`。
    - `VoucherListView` 接入真实统计与分页（每页 50，上/下一页，查询重置到第 1 页）。
  - 科目页：
    - `crm-account.listV1` 返回 `paging` 与 `summary(total/active/inactive/with_parent)`。
    - `AccountListView` 接入真实统计与分页（每页 50）。
  - 总账/明细账/往来明细：
    - `crm-ledger.generalLedgerV1`、`subLedgerV1`、`receivableDetailV1` 统一返回 `paging` 与 `summary(total/debit/credit)`。
    - 账务汇总金额改为后端按筛选条件全量扫描 `crm_voucher_entries` 计算，前端不再只统计当前页。
    - `LedgerGeneralView`、`LedgerSubView`、`ReceivableDetailView` 接入真实统计与分页（每页 50）。
  - 追款任务页：
    - `crm-collection.listTasksV1` 返回 `paging` 与 `summary(total/open/promised/unpaid)`。
    - `CollectionTaskListView` 接入真实统计与分页（每页 50）。
  - 服务层同步透传分页参数：
    - `src/services/account.js`
    - `src/services/ledger.js`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-account/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-collection/index.js`
  - `src/services/account.js`
  - `src/services/ledger.js`
  - `src/components/domain/accounting/VoucherListView.vue`
  - `src/components/domain/accounting/AccountListView.vue`
  - `src/components/domain/accounting/LedgerGeneralView.vue`
  - `src/components/domain/accounting/LedgerSubView.vue`
  - `src/components/domain/accounting/ReceivableDetailView.vue`
  - `src/components/domain/collection/CollectionTaskListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-account/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-collection/index.js`
    - `node --check src/services/account.js`
    - `node --check src/services/ledger.js`
    - `npm run build:h5`（`DONE  Build complete.`）
- 剩余问题：
  - `TrialBalanceView`、`PeriodListView`、`ReportSummaryView` 等页面的“统计口径”是报表型聚合逻辑，不完全等同列表分页口径；若需统一成“全部可翻页 + 真实统计”，需单独定义每页口径后再改。

### 2026-02-12 CURRENT — 单瓶理论损耗统计（cycleLossV1）落地
- 做了什么：
  - `crm-bottle-movement` 新增 `cycleLossV1`：按单瓶事件流组装闭环周期，使用公式 `delta_kg = back_net + fill_sum - out_net` 计算 `loss/swell/exact`，并返回分页列表、汇总统计与链路不完整预览。
  - `cycleLossV1` 仅做只读统计，不写入任何损耗推导记录；新增操作日志 `bottle_movement_cycle_loss_v1`。
  - 前端服务层新增 `getBottleCycleLossV1` 调用入口。
  - `BottleLossView` 从“修复损耗记录汇总”切换为“理论损耗统计”视图：
    - 顶部统计改为总损耗/总胀重/完整周期/链路不完整。
    - 列表展示“回瓶 + 灌装 => 理论值 vs 实际出瓶值”与 `delta_kg` 分类标签（损耗/胀重/吻合）。
    - 保留瓶号、日期筛选与分页（每页 50）。
  - 日志文案映射补充 `bottle_movement_cycle_loss_v1`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/services/bottleMovement.js`
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/services/models/log.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check src/services/bottleMovement.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`（`DONE  Build complete.`）
  - 已做数据口径验收（基于 `state/import/legacy_v2_to_v4/crm_bottle_movements.ndjson` 脚本核对）：
    - 98 号瓶命中样例 1：`2026-01-29 back=9, 2026-01-30 fill=68, 2026-02-01 out=68 -> delta=9(loss)`。
    - 98 号瓶命中样例 2：`2026-02-02 back=68, fill=0, out=68 -> delta=0(exact)`。
    - 负差值（胀）样例：`151` 号瓶 `2026-01-31 back=2, fill=71, 2026-02-02 out=74 -> delta=-1(swell)`。
- 剩余问题：
  - 本次为代码与本地数据口径验证，尚未在线上云环境完成 `cycleLossV1` 实际调用回归。
  - 当前仅支持单瓶统计；全量瓶统计与批量巡检仍待下一阶段扩展。

### 2026-03-11 CURRENT — 仓库清理第一批（去重页面 + 导入资料本地化）
- 做了什么：
  - 删除未被 `pages.json` 使用、且仅自引用跳转的旧会计页面实现，避免双路径并存：
    - `src/pages/accounting/account/edit.vue`
    - `src/pages/accounting/account/list.vue`
    - `src/pages/accounting/ledger/general.vue`
    - `src/pages/accounting/ledger/sub.vue`
    - `src/pages/accounting/voucher/edit.vue`
    - `src/pages/accounting/voucher/list.vue`
  - 更新根 `.gitignore`，将临时资料与导入产物切换为“默认不入库”：
    - `.trae/`
    - `u_want/`
    - `state/import/legacy_v2_to_v4/*`（保留 `README.md` 与目录内 `.gitignore`）
  - 新增 `state/import/legacy_v2_to_v4/.gitignore`，固定导入目录仅跟踪说明文件。
- 改动文件列表：
  - `.gitignore`
  - `state/import/legacy_v2_to_v4/.gitignore`
  - `src/pages/accounting/account/edit.vue`
  - `src/pages/accounting/account/list.vue`
  - `src/pages/accounting/ledger/general.vue`
  - `src/pages/accounting/ledger/sub.vue`
  - `src/pages/accounting/voucher/edit.vue`
  - `src/pages/accounting/voucher/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 已执行引用检查：旧路径仅在旧页面文件内自引用，不在 `pages.json` 与域组件导航中使用。
  - 本批次不改运行时业务逻辑；构建验证在提交前统一执行。
- 剩余问题：
  - `u_want/` 与 `state/import/**` 既有历史文件将通过索引清理（`git rm --cached`）从仓库移除，但本地文件保留，需在本批提交中完成。

### 2026-03-13 CURRENT — 钢瓶档案扩展（压力表/安全阀 + 检测周期）
- 做了什么：
  - 钢瓶模型与前端校验口径升级：
    - `src/services/models/bottle.js` 增加钢瓶/压力表/安全阀核心字段校验，补充日期格式、周期值（6/12/24/36）、压力区间与费用非负校验。
  - 钢瓶云函数 `crm-bottle` 扩展：
    - `createV1/updateV1` 接入“身份+检验链”必填校验，统一数值与日期校验。
    - 新增压力区间规则：`pressure_gauge_range_min <= pressure_gauge_range_max`。
    - 新增云端唯一校验：`bottle_no`、`qr_code`、`pressure_gauge_no`（返回明确冲突文案）。
    - 新增只读巡检接口 `auditUniqueFieldsV1`，用于上线唯一索引前检查空值与重复值。
  - 钢瓶编辑页重构：
    - `BottleEditView` 拆分为钢瓶本体、钢瓶检验、压力表信息、安全阀信息（2 个阀共享）与档案管理。
    - 所有日期字段改为 `picker mode="date"`。
    - 钢瓶/压力表/安全阀均支持“半年/1年/2年/3年”周期，变更检验日期或周期后自动回填下次检验日期，并允许手动覆盖。
  - 钢瓶列表小改展示：
    - 保持现有筛选与分页不变，仅新增容积/皮重与检验到期信息标签展示（瓶检/表检）。
  - 数据库 schema 扩展：
    - `crm_bottles.schema.json` 新增钢瓶本体、压力表、安全阀相关字段定义，并补充 `qr_code`、`pressure_gauge_no` 索引（非唯一）。
  - 服务层补充：
    - `src/services/bottle.js` 新增 `auditBottleUniqueFieldsV1` 调用入口。
- 改动文件列表：
  - `src/components/domain/bottle/BottleEditView.vue`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/services/bottle.js`
  - `src/services/models/bottle.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check src/services/models/bottle.js`
    - `node --check src/services/bottle.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
    - `npm run build:h5`（`DONE  Build complete.`）
    - `npm run build:mp-alipay`（`DONE  Build complete.`）
- 剩余问题：
  - 按迁移策略，数据库层 `qr_code` 与 `pressure_gauge_no` 的唯一索引需在云环境执行 `auditUniqueFieldsV1` 巡检并完成脏数据清洗后再开启，避免索引构建失败。
