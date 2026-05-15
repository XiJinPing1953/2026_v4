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

### 2026-03-14 CURRENT — 钢瓶档案回归“续跑钩子”预留（待测试数据）
- 做了什么：
  - 新增阶段文档 `state/PHASE_B3_BOTTLE_PROFILE.md`，固化“拿到测试数据后”的续跑步骤：
    - 分支切换与同步命令。
    - 不依赖数据的构建/语法校验命令。
    - 依赖测试数据的手工回归逐项勾选清单。
    - 云函数 `auditUniqueFieldsV1` 巡检入口（事件体模板 + 判定规则）。
    - 巡检通过后“唯一索引迁移”第二阶段分支建议。
  - 更新 `state/INDEX.md`，加入该阶段文档索引，便于后续按阶段直接定位。
- 改动文件列表：
  - `state/PHASE_B3_BOTTLE_PROFILE.md`
  - `state/INDEX.md`
  - `STATE.md`
- 验证输出要点：
  - 本次为文档钩子与流程固化，不涉及运行时代码与云端逻辑变更。
  - 目标是确保“测试数据到位后可无缝续跑”，避免上下文丢失。
- 剩余问题：
  - 仍需等待测试数据后执行手工回归与线上唯一字段巡检，再决定 PR #2 合并与唯一索引落地窗口。

### 2026-03-14 CURRENT — test0314 测试数据清洗 + 自动上传脚本
- 做了什么：
  - 基于 `docs/test0314.csv` 生成清洗上传文件 `docs/test0314.cleaned_for_upload.csv`：
    - 压力值拆分为 `压力值最小/压力值最大`，并将最小值统一置为 `0`。
    - 安全阀检测日期统一填充为 `2026-02-28`，安全阀下次检验日期统一填充为 `2027-02-27`。
    - 去除原文件尾部空列，表头重命名为可区分字段（钢瓶/压力表日期不再重名）。
  - 按用户要求删除清洗文件第 `71` 行，解决重复压力表号冲突（当前清洗文件无 `pressure_gauge_no` 重复键）。
  - 新增自动上传脚本 `scripts/uploadBottlesFromCsv.cjs`：
    - 支持 `--execute` 真实写入与默认 `dry-run` 预演。
    - 支持从 CSV 映射到 `crm-bottle createV1` 所需字段，自动推断钢瓶/压力表/安全阀检测周期（6/12/24/36）。
    - 兼容 `CRM_TOKEN` 或 `CRM_USERNAME/CRM_PASSWORD` 登录获取业务 token。
    - 通过 uniCloud client API（需 `UNI_SPACE_ID` + `UNI_CLIENT_SECRET`）批量调用云函数并输出上传报告。
  - `package.json` 增加命令：
    - `npm run bottle:upload:dry`
    - `npm run bottle:upload`
- 改动文件列表：
  - `docs/test0314.cleaned_for_upload.csv`
  - `scripts/uploadBottlesFromCsv.cjs`
  - `package.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/uploadBottlesFromCsv.cjs`
    - `npm run bottle:upload:dry -- --dry-run-sample 2`
      - 解析行数：`133`
      - 周期推断样例：钢瓶 `36`、压力表 `6`、安全阀 `12`
  - 已检查清洗文件唯一性：`pressure_gauge_no` 重复键数 `0`。
- 剩余问题：
  - 真实上传需要提供云空间配置（`UNI_SPACE_ID`、`UNI_CLIENT_SECRET`）及 CRM 登录凭据（`CRM_TOKEN` 或账号密码）。
  - 本次未在无凭据环境执行 `--execute` 写库验证。

### 2026-03-14 CURRENT — env-00jxuffegf2n 真实写库（initdatabase 导入）
- 做了什么：
  - 新增导出脚本 `scripts/exportBottlesInitData.cjs`：
    - 将 `docs/test0314.cleaned_for_upload.csv` 转换为 `uniCloud-alipay/database/crm_bottles.init_data.json`。
    - 自动补齐 `crm_bottles` 必需字段（`current_customer_id/current_customer_name/remark/is_active/created_at/updated_at`）。
    - 生成可回退 `_id` 列表文件 `docs/test0314.rollback_ids.json`（`imp0314_00001` ...）。
    - 导出元信息 `docs/test0314.init.meta.json`（含 `batch_id`）。
  - `package.json` 新增脚本：
    - `npm run bottle:initdata:export`
  - 使用 HBuilder CLI 在支付宝云空间 `env-00jxuffegf2n` 执行真实导入：
    - `cli cloud functions --initdatabase --prj 2026_v4 --provider alipay`
    - CLI 输出包含：`上传初始数据(crm_bottles.init_data.json)`、`初始化云数据库完成`。
  - 新增回退说明 `docs/test0314.rollback.md`，按 `remark` 或 `_id` 批量删除本次导入数据。
  - 记录执行结果 `docs/test0314.import.result.json`。
- 改动文件列表：
  - `scripts/exportBottlesInitData.cjs`
  - `package.json`
  - `uniCloud-alipay/database/crm_bottles.init_data.json`
  - `docs/test0314.init.meta.json`
  - `docs/test0314.rollback_ids.json`
  - `docs/test0314.rollback.md`
  - `docs/test0314.import.result.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/exportBottlesInitData.cjs`
    - `npm run bottle:initdata:export`（导出 `133` 条）
    - `cli cloud functions --initdatabase --prj 2026_v4 --provider alipay`（返回 `0:cloud functions:OK`）
- 剩余问题：
  - HBuilder CLI `initdatabase` 输出不含逐条写入计数；如需二次确认，请在云控制台按本批次 `remark` 做数量核对。

### 2026-03-15 CURRENT — crm-bottle-batch-ops 切换为严格 update-only（预检失败整批中止）
- 做了什么：
  - 修正 `uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`：
    - 新增 `precheckPayload()`，在真正写入前做全量预检：
      - `bottle_no` 为空 -> 失败；
      - payload 内重复 `bottle_no` -> 失败；
      - 数据库内缺失 `bottle_no` -> 失败；
      - 数据库内同 `bottle_no` 多条 -> 失败。
    - 预检不通过时，直接返回 `aborted=true`，并给出 `abort_reason`，整批不写入。
    - 仅在预检通过后才执行“备份 + 按 `_id` 更新”；不调用 `crm_bottles.add()`，避免新增。
  - 在用户已回档数据库后，执行：
    - `cli cloud runfunction --prj 2026_v4 --provider alipay --name crm-bottle-batch-ops`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
    - `cli cloud runfunction --prj 2026_v4 --provider alipay --name crm-bottle-batch-ops`
      - 日志时间：`2026-03-15 11:42:03` 开始，`2026-03-15 11:44:04` 完成。
  - 已确认当前函数写路径为 `bottles.doc(existing._id).update(patch)`；未包含 `crm_bottles` 的新增调用。
- 剩余问题：
  - 当前 HBuilder CLI 运行链路未回传函数返回体，无法直接拿到 `updated/missing` 数字；如需精确审计值，需补一条“结果落库/可查询”链路。

### 2026-03-15 CURRENT — 修复 bottle_no 类型不一致导致 0 更新（string/number 双类型命中）
- 做了什么：
  - 修正 `crm-bottle-batch-ops` 的匹配逻辑：
    - 新增 `normalizeBottleNo()`，统一键值比较规则（trim + uppercase）。
    - 新增 `buildBottleNoQueryTokens()`，对纯数字瓶号同时使用 `"134"` 与 `134` 两种 token 查询。
    - `buildBottleNoMap()` 改为 `dbCmd.in(queryTokens)`，解决数据库内 `bottle_no` 为 number、payload 为 string 时无法命中的问题。
  - 重新执行云函数：
    - `cli cloud runfunction --prj 2026_v4 --provider alipay --name crm-bottle-batch-ops`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
    - `cli cloud runfunction --prj 2026_v4 --provider alipay --name crm-bottle-batch-ops`
      - 日志时间：`2026-03-15 12:32:38` 开始，`2026-03-15 12:34:39` 完成。
- 剩余问题：
  - HBuilder CLI 仍未回传函数返回体，无法直接打印 `updated/missing` 数字；当前以“执行完成 + 数据侧刷新核验”为准。

### 2026-03-15 CURRENT — 修复“备份失败阻断更新”导致 0 更新
- 做了什么：
  - 调整 `crm-bottle-batch-ops` 更新循环：
    - 备份写入 `crm_bottles_import_backups` 失败时，仅记录 `backup_failed`，不再 `continue` 跳过本条更新。
    - 这样即使备份集合权限/结构异常，也不会导致整批 `updated=0`。
  - 再次执行云函数：
    - `cli cloud runfunction --prj 2026_v4 --provider alipay --name crm-bottle-batch-ops`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
    - `cli cloud runfunction --prj 2026_v4 --provider alipay --name crm-bottle-batch-ops`
      - 日志时间：`2026-03-15 13:20:49` 开始，`2026-03-15 13:22:50` 完成。
- 剩余问题：
  - CLI 仍无函数返回体，更新条数需通过页面刷新或额外结果落库来核验。

### 2026-03-15 CURRENT — test0314 成功导入（update-only 验证通过）
- 做了什么：
  - 在浏览器控制台触发云函数 `crm-bottle-batch-ops`，执行 update-only 批量更新（不新增）。
  - 成功返回结果：`code=0`、`payload_total=133`、`upsert.matched=133`、`upsert.updated=133`、`upsert.missing=[]`。
- 改动文件列表：
  - `STATE.md`
- 验证输出要点：
  - `crm-bottle listV1` 正常返回；
  - `crm-bottle-batch-ops` 返回 `updated=133`，说明本批 133 条均已命中并更新成功。
- 剩余问题：
  - 后续批次继续沿用 update-only 链路；禁止使用 `initdatabase` 作为导入方式（会产生新增风险）。

### 2026-03-15 CURRENT — 钢瓶列表补充安全阀检测日期展示
- 做了什么：
  - 在钢瓶列表卡片的标签行新增“阀检”展示，字段为 `safety_valve_check_date`。
  - 保持原有“产品/瓶检/表检”展示样式和布局不变。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 本次为模板层小改，未运行 `npm run build`；建议前端页面手工刷新确认标签显示。
- 剩余问题：
  - 如需显示“安全阀下次检测日期”，可在同位置追加 `safety_valve_next_check_date` 标签。

### 2026-03-15 CURRENT — 安全阀标签改为展示下次检测日期
- 做了什么：
  - 钢瓶列表中“阀检”标签由 `safety_valve_check_date`（检测日期）切换为 `safety_valve_next_check_date`（下次检测日期）。
  - 与现有“瓶检/表检”统一为“下次检验日期”口径。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 模板层字段映射调整，未运行构建；建议页面刷新后人工确认展示。
- 剩余问题：
  - 如需更明确语义，可将文案由“阀检”改为“阀下检”。

### 2026-03-15 CURRENT — 移除钢瓶/压力表/安全阀三项检测费用
- 做了什么：
  - 在钢瓶编辑页移除三处“检测费用（元）”输入框（钢瓶检验、压力表检验、安全阀检验）。
  - 提交逻辑不再校验或提交 `bottle_check_fee`、`pressure_gauge_check_fee`、`safety_valve_check_fee` 三个字段，避免写入/覆盖费用。
  - 编辑加载逻辑不再回填上述三个费用字段。
- 改动文件列表：
  - `src/components/domain/bottle/BottleEditView.vue`
  - `STATE.md`
- 验证输出要点：
  - `rg` 检查 `BottleEditView.vue` 内已无上述三个费用字段引用。
  - 未运行构建命令；建议页面手工打开“新建/编辑钢瓶”确认三项费用输入框已消失。
- 剩余问题：
  - 后端仍兼容接收这三个字段（仅前端不再提交），历史数据不会被删除。

### 2026-03-15 CURRENT — 钢瓶档案新增“按筛选导出 CSV”
- 做了什么：
  - 在钢瓶列表区新增“导出筛选”按钮，按当前筛选条件（关键词/流向/启用状态）导出全部命中数据。
  - 导出实现为分页拉取全量（`listV1` 分页循环）并生成 CSV。
  - 导出文件名包含筛选信息与时间戳，格式：`钢瓶档案_{流向}_{启用}_{关键词}_{条数}条_{YYYYMMDD_HHmmss}.csv`。
  - 导出字段覆盖钢瓶本体、压力表、安全阀及状态信息，不包含已移除的三项检测费用字段。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 当前文件下载实现依赖浏览器能力（H5）；非 H5 端会提示“请在浏览器端导出”。

### 2026-03-15 CURRENT — 钢瓶导出按瓶号自然排序
- 做了什么：
  - 调整钢瓶导出逻辑：导出前按 `bottle_no` 进行自然排序。
  - 排序规则：纯数字瓶号按数值升序（`1,2,3...10`），混合编号按字母数字自然序。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：`npm run build:h5`。
- 剩余问题：
  - 当前只影响导出文件顺序，不改变列表页原有排序（列表仍按 `updated_at desc`）。

### 2026-03-15 CURRENT — 钢瓶瓶号规则筛选（单选）与导出命名增强
- 做了什么：
  - 列表/导出新增瓶号规则参数：`bottle_no_mode`（`all|numeric|prefix`）与 `bottle_no_prefix`（仅 `prefix` 使用）。
  - 后端 `crm-bottle listV1` 增强筛选：
    - `numeric` => `bottle_no` 匹配 `^[0-9]+$`；
    - `prefix` => `bottle_no` 匹配 `^前缀`（不区分大小写）；
    - `prefix` 但前缀为空返回 `400` 明确错误。
  - 前端钢瓶列表新增“瓶号规则”单选与“前缀输入框”（仅前缀模式显示）。
  - 查询/导出都加前置校验：前缀模式必须填写前缀。
  - 筛选标签、重置、缓存键、查询参数、导出参数全部纳入瓶号规则。
  - 导出文件名新增规则片段：`瓶号-全部/瓶号-纯数字/瓶号-前缀N`。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/services/bottle.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 本期仍未实现 Excel 式“值列表多选/计数/全选反选”弹层（按阶段规划留到后续）。

### 2026-03-15 CURRENT — 检验批次筛选放宽 + 列表默认瓶号自然升序
- 做了什么：
  - 检验批次筛选语义调整为“检验日期必填、下次检验日期可选”：
    - 仅填检验日期可筛批次；
    - 同时填写检验日期+下次检验日期为精确匹配；
    - 仅填下次日期前端阻止、后端 `400` 拒绝。
  - 钢瓶列表、批量 filter 预览样本、批量 filter 执行目标集统一改为按瓶号自然排序键升序。
  - 新增排序键落库字段：`bottle_no_sort_group`、`bottle_no_sort_num`、`bottle_no_sort_text`、`bottle_no_sort_key`。
  - 新建/编辑钢瓶时自动写入排序键；`crm-bottle-batch-ops` 导入更新时也同步写入排序键，避免后续导入破坏排序。
  - 新增一次性回填 action：`crm-bottle/backfillBottleSortKeysV1`（支持 `preview`、`limit`、`force`）。
  - 导出文件名中的批次片段支持单日期与双日期两种形态。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/services/bottle.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-batch-ops/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上数据需执行一次 `backfillBottleSortKeysV1` 后，旧记录才能完全按新排序键稳定分页排序。

### 2026-03-15 CURRENT — 列表页增加瓶号自然排序前端兜底
- 做了什么：
  - 在钢瓶列表结果落地时增加前端自然排序，保证当前页显示顺序与导出一致（数字优先、自然升序）。
  - 该兜底用于覆盖“后端排序键尚未回填/未部署”阶段的展示不稳定问题。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 该兜底保证“当前页有序”；跨页全局稳定顺序仍依赖后端排序键与 `backfillBottleSortKeysV1` 回填完成。

### 2026-03-15 CURRENT — 钢瓶到期提醒（提前60天）工作台入口 + 列表筛选联动
- 做了什么：
  - 工作台新增“检验到期提醒”KPI与“今日待办”三检分项（瓶检/表检/阀检），展示 `过期/60天内` 数量并可点击跳转钢瓶列表。
  - 钢瓶列表新增“到期提醒模块 + 到期提醒状态”筛选，支持与现有筛选条件 `AND` 叠加，并纳入筛选标签、导出文件名、批量更新 `filter` 选择器。
  - 页面路由新增到期提醒参数透传与预置应用：支持从工作台携带 `inspection_due_module`、`inspection_due_state` 直达列表并自动生效。
  - 后端 `crm-bottle listV1` 增加到期提醒筛选逻辑：
    - `overdue`: `next_check_date < today`
    - `due_60d`: `today <= next_check_date <= today+60`
    - 模块映射：瓶检/表检/阀检分别对应各自下次检验日期字段。
  - 后端 `crm-dashboard summaryV1` 返回三检到期统计：`inspection_due.total/bottle/gauge/valve`（含 `overdue`、`due_60d`、`total`）。
- 改动文件列表：
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/pages/bottle/list.vue`
  - `src/services/bottle.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 本期为站内实时提醒，不含短信/订阅消息推送。

### 2026-03-15 BASELINE — 钢瓶档案 V1 封版验收清单（可继续增量导入）
- 已验收功能清单：
  - 钢瓶档案扩展字段已落地（钢瓶本体 + 压力表 + 安全阀，安全阀按“2个共用一组检测字段”建模）。
  - 三检日期均采用日期选择器；检测周期支持 `6/12/24/36` 月；下次检验日期支持“自动计算 + 手动覆盖”。
  - 列表展示已统一为“瓶检/表检/阀检 下次检验日期”口径。
  - 三项检测费用已从前后端主链路移除（不再作为业务必需字段）。
  - 导出能力已支持“按当前筛选全量导出”，文件名含关键筛选片段，导出顺序为瓶号自然升序。
  - 瓶号规则筛选已支持 `全部/纯数字/前缀`；纯数字支持区间分段；列表/导出/批量 `filter` 语义一致。
  - 检验批次筛选已支持“检验日期必填、下次日期可选精确匹配”，并可多模块 `AND` 叠加。
  - 批量检验更新已支持“按筛选全量/勾选子集”、模块可多选、预览与执行分离、失败清单返回。
  - 工作台与列表已接通“到期提醒（提前60天）”，按瓶检/表检/阀检分开统计 `已过期/60天内`。
  - 数据导入链路基线已固定为 `crm-bottle-batch-ops update-only`（禁止 `initdatabase` 覆写式导入）。
- 回滚点（代码）：
  - 若封版后发现回归，优先使用 `git revert <baseline_commit_sha>` 回滚单次发布提交。
  - 若需临时切回封版快照排障，可 `git checkout bottle-v1.0-20260315`（只读排查，不在 detached HEAD 上继续开发）。
  - 批量检验与导入异常优先关闭入口开关/停用按钮，再做代码回滚，避免继续写入脏数据。
- 回滚点（数据）：
  - 导入回滚统一用 `docs/test0314.rollback.batch.js` + `docs/test0314.rollback_ids.json` 或按批次 `remark` 精确删除。
  - 执行批量检验前保留预览结果与请求参数；如误更新，按失败/命中清单做反向批量修正。
  - 任何后续导入仍以“`payload=matched=updated，missing=0` 同类结果”为验收门槛，不满足则中止上线。

### 2026-03-15 CURRENT — 灌装记录批量能力（批量新增 + 批量改日期）
- 做了什么：
  - 灌装模块移除“灌装地点（address）”：
    - 前端灌装录入页删除地点输入与摘要展示；
    - 灌装列表删除地点标签及“站内/外出”统计口径；
    - 后端 `createV1/updateV1/batchCreateV1/listV1` 不再读写/统计 `address`；
    - `crm_fillings` schema 已彻底移除 `address` 字段定义，与前后端口径一致。
  - 灌装列表新增“批量新增灌装”操作区：
    - 统一填写 `日期/备注/默认净重`，并通过多行文本批量粘贴（每行 `瓶号,净重` 或仅 `瓶号`）。
    - 支持“预览 -> 二次确认 -> 执行”链路，预览返回可新增条数、无效行数、重复行数与样例瓶号。
  - 云函数 `crm-filling` 新增 `batchCreateV1`：
    - 参数：`preview`、`date`、`remark`、`default_fill_weight`、`batch_text`。
    - 执行时写入 `crm_fillings`，并同步写入 `crm_bottle_movements(fill)`。
    - 自动拦截“批量内容内重复瓶号”和“同日期同瓶号已存在”记录，按失败明细返回。
    - 执行后触发 `crm-bottle-anomaly.touchV2`，保持异常结果同步。
  - 灌装列表新增“批量改日期”操作区，支持两种范围：
    - 按当前筛选全量（需填写至少一个筛选条件）；
    - 勾选子集（列表内勾选记录）。
  - 支持“预览 -> 二次确认 -> 执行”链路，执行结果返回总数/成功/失败及失败明细。
  - 云函数 `crm-filling` 新增 `batchUpdateDateV1`：
    - 参数：`preview`、`scope_mode`、`selector`、`new_date`。
    - 执行时同步更新 `crm_fillings.date/updated_at` 与对应 `crm_bottle_movements` 的 `date/event_day/event_at`。
    - 批量更新成功后触发 `crm-bottle-anomaly.touchV2`，保持异常结果实时同步。
    - 单批上限 `2000` 条，超限返回提示缩小范围。
  - 日志映射新增 `filling_batch_create_v1`、`filling_batch_update_date_v1`。
- 改动文件列表：
  - `src/components/domain/filling/FillingEditView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/services/filling.js`
  - `src/services/models/log.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/database/schema/crm_fillings.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check src/services/filling.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 本期已覆盖“批量新增 + 批量改日期”；“更多批量字段（地点/备注的批量改值）”可作为下一阶段。

### 2026-03-16 CURRENT — 灌装P0（作业类型 + 操作人筛选展示）
- 做了什么：
  - 灌装数据模型扩展 `record_type/operator/operator_id`：
    - `createV1/updateV1/batchCreateV1` 写入作业类型与操作人信息；
    - `getV1/listV1` 对历史记录做读时归一（`record_type` 默认 `normal_fill`，`operator` 回退 `created_by_name`）。
  - 灌装列表筛选增强：
    - 新增 `操作人` 与 `作业类型` 筛选参数，和原有 `瓶号/日期` 一起按 `AND` 生效；
    - `batchUpdateDateV1` 的 `scope_mode=filter` 复用同一筛选构造器，批量命中口径与列表一致。
  - 灌装前端交互增强：
    - `FillingEditView` 新增“作业类型”选择并随单条保存；
    - `FillingListView` 新增“操作人 + 作业类型”筛选控件与 chip；
    - 列表项 `meta` 增加“作业类型标签 + 操作人标签”展示；
    - “批量新增灌装”新增作业类型选择并透传到后端。
  - `crm_fillings` schema 新增字段与索引：
    - 字段：`record_type/operator/operator_id`；
    - 索引：`idx_record_type_date`、`idx_operator_date`。
- 改动文件列表：
  - `src/components/domain/filling/FillingEditView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/services/filling.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/database/schema/crm_fillings.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check src/services/filling.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 已在下一条 `2026-03-16 CURRENT — 灌装P1` 完成“操作人模糊检索”。

### 2026-03-16 CURRENT — 灌装P1（操作人模糊检索 + 同日同瓶拦截）
- 做了什么：
  - 操作人筛选改为模糊匹配：
    - `crm-filling listV1` 使用 `db.RegExp(i)` 对 `operator` 与 `created_by_name` 做包含匹配；
    - 前端筛选输入提示改为“输入操作人（模糊）”。
  - 重复录入防护（同日期 + 同瓶号）：
    - `createV1` 新增前校验重复，命中返回 `409`；
    - `updateV1` 保存前校验（排除自身），命中返回 `409`；
    - `batchUpdateDateV1` 执行时逐条校验，若目标日期已存在同瓶号则该条失败并进入失败清单（部分成功策略不变）。
- 改动文件列表：
  - `src/components/domain/filling/FillingListView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check src/services/filling.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 目前重复防护基于应用层校验，若后续并发写入升高，建议补 `bottle_no + date` 唯一索引做最终兜底。

### 2026-03-16 CURRENT — 灌装P2（操作人改配送员选择，默认陈铁栓）
- 做了什么：
  - 灌装单条录入/编辑页改为“操作人下拉选择”：
    - 操作人来源为 `crm_delivery_men` 在岗列表（分页拉取汇总）；
    - 新建记录默认选中 `陈铁栓`，若不存在则回退首个在岗配送员；
    - 编辑历史记录时，若原操作人不在当前在岗列表，自动注入为临时选项避免丢失。
  - 批量新增灌装改为“操作人下拉选择”：
    - 批量面板新增操作人选择控件；
    - 默认同样为 `陈铁栓`（缺失时回退首个在岗配送员）；
    - 预览/执行提交时强制要求操作人已选择。
  - 服务透传补齐：
    - `batchCreateFillingsV1` 增加 `operator/operator_id` 透传到 `crm-filling.batchCreateV1`。
- 改动文件列表：
  - `src/components/domain/filling/FillingEditView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/services/filling.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check src/services/filling.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check src/services/models/log.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 当前“操作人筛选”仍保留模糊输入（列表筛选口径不变）；如需也改为配送员下拉，可在下一步切换筛选控件。

### 2026-03-17 CURRENT — 灌装收尾（里程碑提交前）
- 做了什么：
  - 修复“删除后列表不即时刷新”问题：`FillingListView` 新增强制刷新版本键，删除/查询/刷新/批量执行后统一绕过 10 秒缓存，避免删除后短时间读到旧列表。
  - 补齐收尾文档：
    - `docs/filling.regression.checklist.md`（回归清单）
    - `docs/filling.smoke.playbook.md`（全链路冒烟与回滚手册）
  - 保留并纳入本轮灌装改造成果（作业类型分流、联想输入、批量预览明细化、批量改日期、no_sale 清洗脚本与执行文档）。
- 改动文件列表：
  - `STATE.md`
  - `package.json`
  - `src/components/base/AppInput.vue`
  - `src/components/domain/filling/FillingEditView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/services/filling.js`
  - `src/services/models/log.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/database/schema/crm_fillings.schema.json`
  - `docs/filling.no_sale_cleanup.playbook.md`
  - `docs/filling.no_sale_cleanup.browser.playbook.md`
  - `docs/filling.regression.checklist.md`
  - `docs/filling.smoke.playbook.md`
  - `scripts/cleanupNoSaleMovements.cjs`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上“异常/损耗口径一致性”需按 `docs/filling.smoke.playbook.md` 在真实空间完成一次人工冒烟并留验收截图。

### 2026-03-17 CURRENT — 全量导入前最终验收清单 v1
- 做了什么：
  - 新增“钢瓶 + 灌装”全量导入前最终验收清单（v1），统一了发布冻结、回滚准备、钢瓶 update-only 门禁、灌装重复清洗门禁、构建验收与失败即停规则。
- 改动文件列表：
  - `docs/full_import_readiness_v1.md`
  - `STATE.md`
- 验证输出要点：
  - 文档型改动，未触发额外构建/语法命令。
- 剩余问题：
  - 等你拿到完整源数据后，按清单执行一次“预演（dry-run）”并输出正式导入报告。

### 2026-03-17 CURRENT — 灌装导入规则修正（车牌保留 + 0/000 保留）
- 做了什么：
  - 修正灌装清洗脚本 `scripts/cleanLegacyFillingsExport.cjs`：
    - `truck_out_no_sale` 在 `bottle_no` 为空时，自动回填车牌（`vehicle_no/car_no/truck_no`）到 `bottle_no`。
    - 默认不再丢弃 `bottle_no=0`（`dropBottleZero` 默认改为 `false`）。
    - 报告新增 `no_sale_bottle_no_filled_from_vehicle_total` 统计字段。
  - 修正灌装导入脚本 `scripts/importFillingsFromJson.cjs`：
    - 同步增加 no_sale 车牌回填兜底。
    - `fill_weight` 支持从 `fill_weight/net_fill/out_net` 回退取值。
    - 导入报告新增 `input_no_sale_bottle_filled_from_vehicle_total`。
  - 修正旧系统转换脚本 `src/services/mappers/legacyImport/convertLegacyExport.cjs`：
    - `transformFillings` 纳入 `record_type`，并对 no_sale 执行车牌回填；移除 `address` 输出字段。
    - movement 生成仅对 `normal_fill/truck_out_agent_sale` 生效，`truck_out_no_sale` 不再生成 `fill movement`。
- 改动文件列表：
  - `scripts/cleanLegacyFillingsExport.cjs`
  - `scripts/importFillingsFromJson.cjs`
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/cleanLegacyFillingsExport.cjs`
    - `node --check scripts/importFillingsFromJson.cjs`
    - `node --check src/services/mappers/legacyImport/convertLegacyExport.cjs`
    - `node scripts/cleanLegacyFillingsExport.cjs --input docs/20260317161633_9a623b2d-1421-443b-9ee2-f4ab7772d9f9.json --output /tmp/legacy.clean.ndjson --outputArray /tmp/legacy.clean.array.json --report /tmp/legacy.clean.report.json`
  - 核验结果（基于 `/tmp/legacy.clean.array.json`）：
    - `truck_out_no_sale=69` 且 `bottle_no` 非空 69 条（车牌）
    - `TRUCK-*` 共 9 条，全部仍是 `normal_fill`
    - `bottle_no=0` 保留 1 条，`bottle_no=000` 保留 3 条
- 剩余问题：
  - 若要把修正结果直接覆盖为新的导入源（如替换 `docs/2026.json`），需在确认后执行覆盖并跑一次导入 dry-run 报告。

### 2026-03-17 CURRENT — 灌装补传执行 + 瓶档新旧差异复核（基于旧瓶档）
- 做了什么：
  - 执行灌装补传（`docs/2026.fixed.array.json`）到云端：
    - 命令：`node scripts/importFillingsFromJson.cjs --input docs/2026.fixed.array.json --report docs/filling.import.report.reclean.execute.json --space-id env-00jxuffegf2n --execute`
    - 结果：`already_exists=3827`，`target_total=1`，`success=0`，`conflict=1`，`failed=0`。
    - 冲突明细：`2026-01-28 08:00 + bottle_no=0`（同日同瓶冲突）。
  - 复核冲突源数据与现网数据：
    - 源行（line 1969）是 `fill_weight=518`；
    - 现网已有同日同瓶记录 `fill_weight=1036`，备注为“同日同瓶合并3条”，因此不能再新增。
  - 使用真正旧瓶档 `docs/about_crm_bottles.json`（912条）与现网 `crm_bottles` 做全量对比：
    - 生成：`docs/bottle_compare_with_about_crm_bottles.latest.report.json`
    - 结果：`old_unique=912`，`current_unique=975`，`intersection=911`，`only_in_old=1`，`only_in_current=64`，`duplicates_in_current=0`。
    - 进一步明细：`docs/bottle_only_in_current.details.json`（64个新系统独有瓶号列表与时间戳）。
- 改动文件列表：
  - `docs/filling.import.report.reclean.execute.json`
  - `docs/bottle_compare_with_about_crm_bottles.latest.report.json`
  - `docs/bottle_only_in_current.details.json`
  - `STATE.md`
- 验证输出要点：
  - 灌装补传已执行，未出现写库失败，仅 1 条业务冲突（同日同瓶）。
  - 瓶档对比已改用旧瓶档数据源（不再使用灌装导出），并确认现网无瓶号重复。
- 剩余问题：
  - 仍有 1 个旧档独有瓶号：`TRUCK-9335`；现网对应为 `TRUCK-9335Z`，需业务确认是否同一车辆瓶号命名变更。

### 2026-03-18 CURRENT — 天然气入库 + 三层库存闭环（truck 按销售净重扣主账）
- 做了什么：
  - 新增天然气入库能力（吨制 + 元/吨）：
    - 新增云函数 `crm-gas-in`，支持 `listV1/getV1/createV1/updateV1/removeV1/syncCycleAdjustmentsV1/rebuildInventoryV1/restoreInventoryV1`。
    - 新增前端页面与服务：`/pages/gas-in/list`、`/pages/gas-in/edit`、`src/services/gasIn.js`。
    - 列表支持筛选/分页/统计卡/导出；编辑支持车牌联想、自动计算可覆盖、负损耗告警。
  - 新增三层库存流水集合与口径：
    - 新增 schema：`crm_gas_in`、`crm_gas_inventory_movements`（含唯一索引 `source_type + source_id + movement_kind`）。
    - 三层口径：`asset_total_t`（总库存）、`station_total_t`（站内可灌装）、`in_bottle_total_t`（在瓶未售）。
  - 联动 `crm-filling`：
    - `normal_fill / truck_out_agent_sale`：`asset 0, station -, in_bottle +`。
    - `truck_out_no_sale`：`asset -, station -, in_bottle 0`。
  - 联动 `crm-sale`：
    - `bottle`：按 `(out_net_total - back_net_total)/1000` 扣 `asset` 与 `in_bottle`。
    - `agent_sale`：按 `sum(agent_sale_items.fill_weight)/1000` 扣 `asset` 与 `in_bottle`。
    - `truck`：按 `truck_sale_net/1000`（缺失回退 `out_items.net/1000`）扣 `asset` 与 `in_bottle`。
    - `truck` 差值 `((out_gross-back_gross)-truck_sale_net)` 仅记分析字段，不入主账扣减。
  - 闭环与可撤销重建：
    - `syncCycleAdjustmentsV1`：基于 `back + fills - out` 生成/更新闭环调整流水（幂等键 `source_type=cycle_adjust + source_id + movement_kind`）。
    - `rebuildInventoryV1(preview/execute)`：全量重建 `gas_in + filling + sale + cycle_adjust`。
    - 执行前自动备份至 `crm_gas_inventory_movements_backup`，可 `restoreInventoryV1(run_id)` 一键恢复。
  - 导入链路：
    - 新增脚本 `scripts/importGasInFromJson.cjs`（支持 `--dry-run/--execute`、json-array/ndjson、`kg->t`、`元/kg->元/吨`、对账报告）。
    - `package.json` 新增 `gasin:import:dry`、`gasin:import`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/database/schema/crm_gas_in.schema.json`
  - `uniCloud-alipay/database/schema/crm_gas_inventory_movements.schema.json`
  - `src/services/gasIn.js`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/components/domain/gasIn/GasInEditView.vue`
  - `src/pages/gas-in/list.vue`
  - `src/pages/gas-in/edit.vue`
  - `src/pages.json`
  - `src/components/base/AppFloatNav.vue`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `scripts/importGasInFromJson.cjs`
  - `package.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check scripts/importGasInFromJson.cjs`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
  - 导入脚本 dry-run 样例：
    - `node scripts/importGasInFromJson.cjs --input docs/gas_in.json --report /tmp/gas_in.import.report.test.json`
    - 结果：`source_total=19`、`valid_total=19`、`invalid_total=0`（仅预检，未写库）。
- 剩余问题：
  - `crm-gas-in` 及 schema 需在云端完成上传后，前端页面与导入脚本才能对线上空间生效。

### 2026-03-18 HOTFIX — 天然气入库页面 500 止血 + UI 收敛
- 做了什么：
  - 定位并确认线上 500 根因：支付宝空间缺少集合（`not found collection`），`crm-gas-in.listV1` 直接抛异常导致 HTTP 500。
  - 云函数止血：
    - `crm-gas-in` 增加统一 `try/catch`，集合缺失时返回业务可读提示，不再抛 HTTP 500。
    - `listV1` 在集合未初始化时返回空列表与引导文案（`code=0`）。
    - `summarizeGasInWhere/getInventorySnapshot` 增加集合缺失容错。
    - 修正日期区间条件拼装：`dbCmd.and([dbCmd.gte(...), dbCmd.lte(...)])`。
  - 灌装侧日期筛选同样修正 `dbCmd.and([...])`（`crm-filling`）。
  - 前端 `GasInListView` 收敛：
    - 顶栏仅保留“新增/导出”，将“闭环同步/库存重建”下沉到页面操作区。
    - 新增服务告警条，直接显示云端引导信息，避免只看到网络报错。
  - 新增备份集合 schema：`crm_gas_inventory_movements_backup.schema.json`（用于重建前备份与恢复）。
  - 已上传云函数：
    - `crm-gas-in`（hotfix 已上线）
    - `crm-filling`（区间条件修正已上线）
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `uniCloud-alipay/database/schema/crm_gas_inventory_movements_backup.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 云端探针结果：
    - `crm-gas-in.listV1` 已从 `HTTP 500` 变为 `HTTP 200 + code=0 + 集合未初始化提示`。
  - 本地检查通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `npm run build:h5`
- 剩余问题：
  - 仍需在云端上传 3 个 schema：`crm_gas_in`、`crm_gas_inventory_movements`、`crm_gas_inventory_movements_backup`，上传后天然气入库页面可正常读写与重建回滚。

### 2026-03-19 CURRENT — 销售3月“备注列优先”优化（原文+标准化+标签）
- 做了什么：
  - 后端 `crm-sale` 增加备注派生字段与统一解析：
    - 新增并写入：`remark_normalized`、`remark_tags`、`system_note`、`has_remark`。
    - 解析规则覆盖：`ticket_adjust_up/down`、`remove_back_bottle`、`balance_carry`、`material_install`、`cash_mark`、`merge_trace`、`payment_event`、`other`。
    - `[合并自:xxx]` 从业务备注中识别并写入 `system_note`，保留 `remark` 原文。
  - `listV2/getV2/createV2/updateV2` 全链路接入备注派生字段：
    - 列表/详情回读旧数据时自动补算派生字段（兼容历史记录缺字段）。
    - `listV2` 新增筛选入参：`hasRemark`（yes/no）、`remarkTag`（单选）。
    - 关键词检索扩展到 `remark/system_note/remark_normalized`。
  - 前端销售列表增强：
    - 新增筛选控件：`有无备注`、`备注标签`。
    - 列表卡片新增“备注摘要（1行截断）+ 标签”。
    - 导出新增列：`业务备注`、`系统备注`、`备注标签`。
    - 导出文件名新增备注筛选片段（可追溯）。
  - 前端销售详情增强：
    - “业务备注 / 系统备注 / 解析标签”分层展示。
    - 标签可点击跳转列表并预置筛选（`hasRemark=yes&remarkTag=...`）。
  - 销售编辑链路修复：
    - 补充“业务备注”输入项。
    - 编辑加载/提交均携带 `remark`，避免保存时备注被清空。
  - 对账脚本新增：
    - `scripts/reconcileSalesRemarkFromXlsx.cjs`
    - 支持读取 xlsx 与系统月数据对比，输出 `仅表格有/仅系统有/计数不一致` 三段报告。
    - `package.json` 新增命令：`sale:remark:reconcile`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `src/services/sale.js`
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/pages/sale/list.vue`
  - `scripts/reconcileSalesRemarkFromXlsx.cjs`
  - `package.json`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js` 通过。
  - `node --check scripts/reconcileSalesRemarkFromXlsx.cjs` 通过。
  - `npm run build:h5` 通过。
  - `npm run build:mp-alipay` 通过。
- 剩余问题：
  - schema 新增字段/索引需要按发布流程上传到云端后生效。
  - 对账脚本首次运行需传入 `--space-id`（或设置环境变量）并保证本机可读取空间签名信息。

### 2026-03-20 CURRENT — 客户级预付款与欠款结算（销售联动）一期落地
- 做了什么：
  - 新增客户结算引擎并落地云函数 `crm-customer-settlement`：
    - 支持 `previewAllocationV1/createReceiptV1/confirmAllocationV1/getCustomerStatementV1/listCustomerStatementRowsV1/autoApplyPrepayToSaleV1/refreshCustomerBalancesV1/rebuildOpeningBalancesV1`。
    - 默认 FIFO 分配（最早欠款优先），支持手工分配确认。
    - 收款口径：先冲历史欠款，余款自动进入预付款。
  - 销售联动改造（`crm-sale`）：
    - `createV2/updateV2` 保存后自动调用客户结算引擎执行预付款抵扣，并在有抵扣时二次同步销售凭证。
    - `quickReceiveV1` 从“单据内改实收”改为“客户级收款入账”，并保持销售详情快捷入口；回款后按最新销售单状态回传。
    - `removeV2` 删除销售后补触发客户余额刷新，避免客户侧余额漂移。
  - 客户模型与 schema 扩展：
    - `crm_customers` 新增余额汇总字段：`receivable_balance/prepay_balance/net_balance/should_receive_total/amount_received_total/last_receipt_at`。
    - 新增集合 schema：`crm_customer_receipts`、`crm_customer_receipt_allocations`。
  - 前端页面与服务：
    - 新增服务 `src/services/customerSettlement.js`。
    - 新增客户对账页：`/pages/customer/statement` + `CustomerStatementView.vue`。
    - 对账页包含：客户总览、近100条销售明细、账务流水、登记收款、预览分配、确认入账。
    - 客户列表卡片新增余额信息（应收/预付/净余额）与“客户对账”入口。
    - 销售列表与销售详情新增“客户对账”跳转入口。
    - 销售详情“回款登记”文案与交互调整为“本次回款金额”，语义对齐客户级收款。
  - 迁移脚本：
    - 新增 `scripts/initCustomerOpeningBalances.cjs`（支持预览/执行）。
    - `package.json` 新增命令：`customer:opening:dry`、`customer:opening`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/database/schema/crm_customers.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_receipts.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_receipt_allocations.schema.json`
  - `src/services/customerSettlement.js`
  - `src/services/sale.js`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `src/pages/customer/statement.vue`
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/pages.json`
  - `scripts/initCustomerOpeningBalances.cjs`
  - `package.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`
    - `node --check scripts/initCustomerOpeningBalances.cjs`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 需云端上传新增 schema（`crm_customer_receipts`、`crm_customer_receipt_allocations`、更新后的 `crm_customers`）与云函数（`crm-customer-settlement`、`crm-sale`、`crm-customer`）后，线上客户对账与客户级回款才会完整生效。
  - 若历史账号角色为 `user`，客户级收款/自动抵扣已放开；仅“期初重建”仍限制为 `superadmin/admin/finance`。

### 2026-03-20 EXECUTE — 客户期初余额迁移第3/4步实操（env-00jxuffegf2n）
- 做了什么：
  - 按操作链路执行 `customer:opening:dry` 与 `customer:opening`。
  - 过程中发现并修复云端阻塞：
    - 新增集合名 `crm_customer_receipt_allocations` 超过平台长度限制（>30），改为 `crm_customer_allocations`。
    - 同步调整 `crm-customer-settlement` 云函数集合名并重新上传云函数。
    - 通过 HBuilder CLI 上传 schema：
      - `crm_customer_receipts`
      - `crm_customer_allocations`
      - `crm_customers`（云端提示 skip，说明已一致）
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `uniCloud-alipay/database/schema/crm_customer_allocations.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_receipts.schema.json`
  - `docs/customer.opening_balances.report.json`
  - `STATE.md`
- 验证输出要点：
  - Dry-run：`npm run customer:opening:dry -- --space-id env-00jxuffegf2n`
    - 结果：`code=0`，`total=120`，`updated=0`，返回样例客户余额。
  - Execute：`npm run customer:opening -- --space-id env-00jxuffegf2n`
    - 结果：`code=0`，`total=120`，`updated=120`。
- 剩余问题：
  - 本地 `uniCloud-alipay/database/` 下为 CLI 上传临时放置了 `*.schema.json` 文件（同名副本）；后续可在确认不再用于 CLI 上传后清理。

### 2026-03-21 CURRENT — 理论损耗统计卡片数值位置微调
- 做了什么：
  - 仅调整“理论损耗统计”页顶部汇总卡片的局部样式。
  - 将数值区从原先偏右、贴近图标的布局，改为更靠左且与图标垂直居中的排列，减少单位/图标与数字的挤压感。
  - 保持改动范围在页面级样式，不修改全局 `AppStatCard`，避免影响其他统计页。
- 改动文件列表：
  - `src/components/domain/bottle/BottleLossView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
- 剩余问题：
  - 当前为页面级视觉微调；若你希望数值统一改成“居中”或“更靠上”的排版，需要再同步确认其他汇总页是否也一起收口。

### 2026-03-23 CURRENT — 灌装录入支持按灌后总重推导净重（过渡方案 v2）
- 做了什么：
  - 在 `crm-filling` 云函数增加 `resolveFillWeightV1` 和统一推导逻辑，三种灌装类型都支持按 `灌后总重 - 最近依据值` 反推 `fill_weight`。
  - `normal_fill` / `truck_out_agent_sale` 改为按最近一次回瓶明细取依据值，优先 `gross`，缺失时回退 `tare + net`；`truck_out_no_sale` 改为按同车最近一次整车销售记录的 `truck_back_gross` 推导。
  - 扩展 `createV1` / `batchCreateV1` 支持 `input_mode='after_fill_total'`，服务端统一重算净重并校验，不信任前端传值。
  - 不改 `crm_fillings` schema；总重与推导依据通过标准化后缀追加进 `remark`，保留过渡期追溯信息。
  - 前端 `FillingListView.vue` 增加单条/批量“双模式”切换，单条总重模式可实时展示命中依据值、依据类型、来源日期/单据、推导净重；批量总重模式支持按记录类型展示瓶号/车牌样式与预览明细。
  - `src/services/filling.js` 增加 `resolveFillingFillWeightV1` 封装，并把批量新增的 `input_mode` 透传到云端。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/services/filling.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 当前“最近回瓶依据”查询依赖 `crm_sale_records.back_items` 的数组字段检索，已在本地构建通过，但仍建议上传云函数后用真实云端样本做一次烟测，确认目标空间对该查询路径的行为与本地假设一致。
  - 过渡方案仍只正式保存 `fill_weight`；这不会影响库存、损耗和列表统计主流程，但历史记录若要做“按总重重算”仍缺正式留痕字段，后续若需要审计报表应升级为独立字段方案。

### 2026-03-23 CURRENT — 缺灌装修复改为“双入口 + 系统推荐/限制”
- 做了什么：
  - `missing_fill` 异常不再沿用单一“修复”确认，前端改成“记损耗 / 补灌装单”双入口，并按 `next_out.net - last_back.net` 自动限制错误选项。
  - 增重场景只允许“补灌装单”；减重且绝对值不超过 `10kg` 只允许“记损耗”；减重超过 `10kg` 或缺少净重时不给快捷修复，直接提示人工核查。
  - `crm-bottle-anomaly.resolveV1` 新增可选入参 `resolution_mode`，前端在“记损耗”路径显式传 `loss_accept`；旧调用不传时保持兼容。
  - “补灌装单”改为跳转灌装列表页的单条录入区预填：带入异常来源、瓶号、默认出瓶日期、默认 `normal_fill`、默认 `net` 模式、建议净重和机器可读备注。
  - 灌装保存成功后，若来自异常补单入口则自动返回异常页；异常页 wrapper 在 `onShow` 刷新，依赖现有 anomaly touch 让缺灌装自然消失，不强制结案。
- 改动文件列表：
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/pages/bottle/anomaly.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/pages/filling/list.vue`
  - `src/services/bottleAnomaly.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - “补灌装单”目前默认预填 `normal_fill`；这是按当前异常上下文无法稳定反推真实灌装类型做的保守默认，若后续需要更精确回填，需要补充异常来源与灌装类型映射规则。
  - 异常页返回后的消失/保留依赖现有 anomaly touch 重扫结果；建议云端上传后用真实 `missing_fill` 样本各做一条增重、减重、超阈值回归烟测。

### 2026-03-23 FIX — 修正缺灌装补单预填首屏丢参
- 做了什么：
  - 检查后确认“补灌装单”的预填与回跳逻辑代码已写入，但首屏存在路由参数落地竞态：灌装页首次打开时，预填有概率没有真正执行，导致瓶号、日期、建议净重、备注和返回异常页标记都没带上。
  - `FillingListView.vue` 改为直接监听 wrapper 透传的预填 props，并在存在预填时跳过默认重置，确保首屏一定执行 `applyRoutePreset`。
  - `src/pages/filling/list.vue` 移除多余的 `routePresetPending` 状态机，避免 wrapper 首次 `onShow` 把待应用预填错误清空。
- 改动文件列表：
  - `src/components/domain/filling/FillingListView.vue`
  - `src/pages/filling/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-24 CURRENT — 同日“回瓶 + 出瓶”歧义日改为待后续动作判定
- 做了什么：
  - `crm-bottle-anomaly` 新增内部挂起语义：同一瓶同一天同时出现 `back + out` 且当天无 `fill` 时，不再一律按固定顺序判异常；若前序状态已明确则按既有闭环强制解释，否则挂起为“待后续动作”。
  - 后续第一条有效动作到来时再解歧：`fill` 解释为 `out -> back`、不生成异常；`back` / `out` 解释为 `back -> out`，补一条歧义日 `missing_fill`，若是 `out` 还会继续走现有 `continuous_out` 逻辑。
  - `crm-bottle-movement` 的周期配对同步复用相同判定，未解歧的同日交叉不再产出 cycle row 或 incomplete row；时间线顶部状态新增 `waiting_next_action / 待后续动作`。
  - 这会修正 `Y169` 一类“同日既出瓶又回瓶、次日灌装”被误报 `missing_back` 的场景，同时保留“客户 A 直接给客户 B”这类应报 `missing_fill` 的路径。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次仅完成仓库实现与本地构建校验，尚未把云函数上传到目标空间；要验证 `Y169` 在线误报是否消失，仍需上传后对真实数据做一次异常页与单瓶时间线烟测。

### 2026-03-24 FIX — 修正 `missing_fill` 跨段复用旧回瓶导致的误配
- 做了什么：
  - 收紧 `crm-bottle-anomaly` 扫描状态机在 `out` 分支的收口逻辑：出瓶一旦消费当前回瓶上下文，无论这次是否产出 `missing_fill`，都会清掉 `last_back_event` 并重置 `has_fill_since_last_back`。
  - 保留 `last_out_event` 与 `last_effective_event=out`，确保后续 `fill` 仍能继续判 `missing_back`，但不能再把更早的回瓶跨段复用到后续出瓶上。
  - 这会修正 `273` 一类“`03-05 back 73 -> 03-06 out 73 -> 03-09 back 32 -> 03-09 out 32`”被错误串成单条跨段 `missing_fill` 的问题；当前业务口径仍保持“回瓶后未灌装直接出瓶就是异常”，不放宽成直转正常。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 待运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - 针对 `273` / `Y169` 的本地状态机回放与受影响瓶定向 reconcile 验证
- 剩余问题：
  - 代码修复后仍需上传云函数并对受影响瓶号做定向 reconcile，确认旧的跨段 `missing_fill` 能被 `system-reconcile` 自动收敛。

### 2026-03-24 CURRENT — 销售单提交前增加瓶流转归属预警
- 做了什么：
  - `crm-sale.createV2/updateV2` 增加瓶流转软预警：瓶装销售在提交前会校验回瓶是否属于当前客户截至单据日期的应持有瓶集合，以及出瓶是否命中了“最近状态仍为出瓶、尚未回站”的连续出瓶风险。
  - 回瓶归属校验复用了 `getCustomerDepositV1` 的存瓶口径，抽出内部 helper，并支持编辑旧单时排除当前单据自身影响。
  - 出瓶可用性校验基于 `crm_bottle_movements` 计算瓶截至单据日期的最新有效状态，并复用现有同日 `back + out` 语义，避免与时间线/异常页口径冲突。
  - 当存在可疑瓶号且未显式忽略时，接口返回 `409 + confirmable + bottle_flow_mismatch`，不落库；前端销售编辑页收到后弹出“请核对瓶号”确认框，用户确认后带 `ignore_bottle_flow_warning=true` 重试提交。
  - 创建/更新成功日志补记了是否 override、预警条数和相关瓶号，便于后续审计这类手工放行场景。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/services/sale.js`
  - `src/components/domain/sale/SaleEditView.vue`
  - `STATE.md`
- 验证输出要点：
  - 待运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
    - 销售单回瓶误录 / 连续出瓶的前端提交确认链路烟测
- 剩余问题：
  - 第一版仅做提交时软确认，不做输入过程中的行内高亮；若后续误录仍高频，可再补“边录边提示”的轻量行级提醒。

### 2026-03-24 CURRENT — 灌装提交前增加“未回瓶先灌装”软预警
- 做了什么：
  - `crm-filling.createV1/updateV1/batchCreateV1` 增加灌装前的瓶流转软预警，仅覆盖按瓶号流转的 `normal_fill` / `truck_out_agent_sale`，`truck_out_no_sale` 不接入。
  - 云端新增基于 `crm_bottle_movements` 的瓶流转状态 helper，沿用现有同日 `back + out` 语义判断“最近仍为出瓶未回站”或“同日待后续动作”两类风险，并在未显式忽略时返回 `409 + confirmable + bottle_flow_mismatch`。
  - 单条新增、批量执行、编辑保存三条前端链路统一改成“先弹请核对瓶号，再允许继续提交”，确认后带 `ignore_bottle_flow_warning=true` 重试。
  - 批量灌装预览结果新增 `warning_total`、`warning_items` 和每条待新增项的预警摘要，执行成功后会提示本次是否带着预警 override 保存。
  - 创建、更新、批量新增的操作日志补记了是否 override、预警条数和命中的瓶号，便于后续审计这类高风险录入。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `src/services/filling.js`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/filling/FillingEditView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次仍是提交时软预警，不做录入过程中的实时高亮；若后续误灌装误录仍高频，可再补输入期行级提示。

### 2026-03-24 CURRENT — 对齐 `crm-bottle-anomaly` 与单瓶时间线的同日 `back+out` 语义
- 做了什么：
  - 修正 `crm-bottle-anomaly` 对“同日 `back + out` 且无 `fill`”的前置状态判断，只要前面仍存在未闭环周期，就不再挂起歧义日，而是按 `out -> back` 解释。
  - 同步把日内重排条件从“仅 `回瓶后未灌装`”放宽为“任意未闭环回瓶周期”，使 anomaly 扫描与 `crm-bottle-movement` 的周期配对口径保持一致。
  - 这样像 87 号瓶这类“前一天已回+灌、次日同日 `back+out`”场景，不会再把当日 `back/out` 错挂成同日 `missing_fill`，而会把后续真正未灌装的 `out` 判出来。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - 本地最小序列回放：
      - 87 场景输出仅剩 `2026-03-17 -> 2026-03-18 missing_fill`
      - `Y169` 场景输出为空，不再误报
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上已有错误 anomaly 记录不会因本地改码自动消失；还需要上传 `crm-bottle-anomaly`，并对受影响瓶号做一次 reconcile / 重扫。

### 2026-03-24 CURRENT — 时间线事件卡片仅显示 open 异常 marker
- 做了什么：
  - 调整 `crm-bottle-movement.timelineV1` 的 marker 生成逻辑，事件卡片仅消费 `open` 状态的 anomaly marker，不再把已 `resolved` 的历史异常继续挂在事件行上。
  - 这样像 87 号瓶这类已经被 `system-reconcile` 修正掉的旧 `continuous_out` / 旧同日 `missing_fill`，仍会保留在“关联异常”列表中，但不会继续污染事件卡片展示。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
- 剩余问题：
  - 该改动需要重新上传 `crm-bottle-movement` 后才会体现在真实时间线页面。

### 2026-03-24 CURRENT — 单瓶时间线改为按业务语义排序同日事件
- 做了什么：
  - 新增前端纯函数 `buildBottleTimelineDisplayEvents`，不再让 `BottleMovementTimelineView` 直接按数据库原始 `type_order` 倒序渲染事件列表。
  - 时间线同日 `back + out` 现在会按现有闭环语义重排：若前面仍存在未闭环周期，则该日按 `out -> back` 解释；若属于真正的歧义日待后续动作，则继续按挂起规则等待后续事件解歧。
  - 修复后，87 号这类序列会按你确认的业务顺序显示：从下到上是 `03-16 回瓶 -> 03-16 灌装 -> 03-17 出瓶 -> 03-17 回瓶 -> 03-18 出瓶`，对应异常只应理解为 `2026-03-17 回瓶 -> 2026-03-18 出瓶` 的 `missing_fill`。
- 改动文件列表：
  - `src/services/models/bottleTimeline.js`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - 最小序列回放（补全 87 的 `2026-03-16 回瓶` 后）输出顺序为：
      - `2026-03-18:out`
      - `2026-03-17:back`
      - `2026-03-17:out`
      - `2026-03-16:fill`
      - `2026-03-16:back`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这是前端排序修正；若线上页面仍显示旧顺序，需要重新发布前端资源后才能看到效果。

### 2026-03-24 CURRENT — `missing_fill` 小幅增重改为“记胀重”并纳入理论损耗统计
- 做了什么：
  - 调整 `missing_fill` 的差值判断口径：
    - `0 < diff <= 10kg` 不再强制补灌装单，改为允许“记胀重修复”；
    - `diff > 10kg` 仍要求补灌装单；
    - `-10kg <= diff < 0` 继续按“记损耗修复”；
    - `diff < -10kg` 继续要求人工核查。
  - `crm-bottle-anomaly.resolveV1` 新增 `swell_accept` 修复模式；小幅增重会落一条 `manual_fix adjust`，`loss_weight` 记负数，`adjust_reason=missing_fill_swell_accept`，用于后续统计修复胀重。
  - `crm-bottle-movement.lossStatsV1` 放开原先 `loss_weight > 0` 的过滤，改为同时统计 `missing_fill_loss_accept` 与 `missing_fill_swell_accept`，并返回 `total_swell_kg / swell_record_count / result_type`。
  - 理论损耗页顶部“总损耗 / 总胀重”改为合并显示完整周期与修复差值；新增“修复胀重”卡片，修复明细改成统一的“异常修复差值明细”。
  - 流转列表与单瓶时间线的 `manual_fix` 差值文案改为正负分开显示，避免出现“损耗 -1 kg”。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
    - 最小序列回放：同日 `back + out` 仍按 `out -> back` 显示，不影响既有时间线排序修正。
- 剩余问题：
  - 线上要看到 84 号这类 `+1kg` 的“记胀重”入口和理论损耗汇总变化，仍需上传 `crm-bottle-anomaly`、`crm-bottle-movement` 并发布前端。

### 2026-03-24 CURRENT — 同日“多回一出 / 多出一回”按前序状态交错解释
- 做了什么：
  - 修正 `crm-bottle-anomaly`、`crm-bottle-movement` 和前端时间线 helper 对“同日存在多条 `back/out` 且无 `fill`”的排序口径，不再把同类事件简单堆在一起。
  - 新规则改为按前一状态交错解释：
    - 若上一状态仍是 `out`，当天按 `back -> out -> back -> ...`
    - 若上一状态存在未闭环回瓶周期，按 `out -> back -> out -> ...`
  - 这样 83 号这类序列会按你确认的业务顺序解释：从下到上 `2026-02-07 出62 -> 2026-02-14 回37 -> 2026-02-14 出37 -> 2026-02-14 回30`，不再错误地显示成 `回37 -> 回30 -> 出37`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/services/models/bottleTimeline.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - 前端 helper 最小回放：
      - 83 号显示顺序（上到下）为 `02-14 回30 -> 02-14 出37 -> 02-14 回37 -> 02-07 出62`
      - 87 / `Y169` 场景未回归
    - 状态机最小回放：
      - 83 号会产出 `2026-02-14 回37 -> 2026-02-14 出37`
      - 以及 `2026-02-14 回30 -> 2026-02-24 出26`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上要看到 83 号的最新顺序和异常配对，仍需上传 `crm-bottle-anomaly`、`crm-bottle-movement` 并发布前端。

### 2026-03-24 CURRENT — 流转记录筛选瓶号输入补齐模糊联想
- 做了什么：
  - 给流转记录页 `BottleMovementView` 的“记录筛选 -> 瓶号”输入补齐钢瓶档案联想下拉。
  - 交互对齐灌装单的瓶号联想口径：输入后延迟查询、聚焦时按当前值拉建议、失焦后收起、确认搜索时自动规整成大写无空格。
  - 联想项展示 `瓶号 + 状态/当前客户`，方便录入时直接判断是否选对钢瓶。
- 改动文件列表：
  - `src/components/domain/bottle/BottleMovementView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 该改动是前端侧体验增强，需发布前端后线上流转记录筛选页才会看到联想下拉。

### 2026-03-24 CURRENT — 缺灌装补单预填日期改为回瓶日期
- 做了什么：
  - 调整缺灌装异常“补灌装单”的预填日期来源，不再默认带 `next_out.date`，改为优先带 `last_back.date`。
  - 这样从异常页跳去灌装页时，默认灌装日期会落在回瓶当天，避免一进入灌装页就因为“出瓶日在前、未回瓶”触发瓶流转预警。
  - 出瓶日期仍保留在补单备注里，便于后续追溯这次补单是为哪次直接出瓶补录。
- 改动文件列表：
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 该改动依赖前端发布；发布前线上异常页跳转仍会沿用旧的出瓶日期预填。

### 2026-03-24 CURRENT — 销售记录瓶号联想统一对齐灌装单
- 做了什么：
  - 给销售单里所有瓶号录入入口统一接入钢瓶档案模糊联想，覆盖：
    - 出瓶明细 / 回瓶明细
    - 存瓶记录
    - 代理出站
  - 抽出销售侧共用的瓶号联想 helper，统一复用灌装单单瓶灌装的联想口径：只联想启用钢瓶、展示 `状态 · 当前客户`、确认时自动规整成大写无空格。
  - 出/回瓶原有联想保留自动回填皮重/净重的便捷逻辑，但联想展示内容改为与灌装单一致。
  - 编辑已有销售单时，存瓶和代理出站也会保留并透传 `bottle_id`，避免选中过档案后再次保存丢失标识。
- 改动文件列表：
  - `src/composables/useBottleSuggestions.js`
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/services/models/sale.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 该改动是前端录入体验和前端草稿归一化增强，需发布前端后销售单页面才会看到统一的瓶号联想下拉。

### 2026-03-24 CURRENT — 缺灌装补单返回异常页改为保位置定点刷新
- 做了什么：
  - 调整“缺灌装 -> 补灌装单”回流链路，不再依赖异常页 `onShow` 的整页通用刷新。
  - 异常页跳去灌装页前会记录当前页面滚动位置，并把 `sourceAnomalyId / bottleNo / returnScrollTop` 一并带入补单页。
  - 灌装保存成功且需要返回异常页时，先发一个“补单已完成”的回流事件，再 `navigateBack`。
  - 异常页收到该事件后，只对这一个瓶号做 reconcile 扫描，再刷新当前页数据，并用保存的 `scrollTop` 恢复到原位置。
  - 普通从其他页面返回异常页时，仍保留原来的 `onShow -> refresh` 行为。
- 改动文件列表：
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/pages/bottle/anomaly.vue`
  - `src/pages/filling/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 要在线上看到“补单返回仍停在原位置”的效果，仍需发布前端。

### 2026-03-24 CURRENT — 缺灌装补单回流增加 storage 兜底
- 做了什么：
  - 发现“补灌装单保存后返回异常页”的定点刷新链路仅靠 `uni.$emit` 不够稳，部分场景会漏掉回流事件，导致异常页仍走默认整页刷新。
  - 补充为“双保险”：
    - 仍保留全局事件通知；
    - 同时在补单保存成功前把回流 payload 写入本地临时存储。
  - 异常页 `onShow` 现在优先读取这份临时回流 payload；只要补单保存过，即使事件没命中，也会走“单瓶 reconcile + 当前页刷新 + 恢复原滚动位置”。
- 改动文件列表：
  - `src/components/domain/filling/FillingListView.vue`
  - `src/pages/bottle/anomaly.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 该修正依赖前端发布；发布前线上仍会沿用旧的回流刷新行为。

### 2026-03-24 CURRENT — 新增“连续回瓶”异常类型
- 做了什么：
  - 在 `crm-bottle-anomaly` 异常状态机中新增 `continuous_back`，用于识别“上一段回瓶状态还没被出瓶消费掉，又来了新的回瓶”。
  - 判定口径覆盖两类场景：
    - `back -> back`
    - `back -> fill -> back`
  - 这样 385 号这类 `2026-03-07 出瓶 -> 2026-03-07 回瓶(误录) -> 2026-03-16 回瓶` 会新增一条“连续回瓶”异常，不再只落出后续的缺灌装。
  - 同步更新了：
    - 异常类型列表和 reconcile 白名单
    - 时间线 anomaly marker 映射与单瓶补扫
    - timeline marker 对 `next_back` 的打点
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/services/bottleAnomaly.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上要看到 385 号的“连续回瓶”异常和时间线 marker，仍需上传 `crm-bottle-anomaly`、`crm-bottle-movement` 并发布前端。

### 2026-03-24 CURRENT — 异常类型补齐“缺出瓶”并封禁销售录错类直接修复
- 做了什么：
  - 在 `crm-bottle-anomaly` 状态机中新增 `missing_out`（缺出瓶），用于识别 `back -> fill -> back` 这类“已灌装但未出瓶又再次回瓶”的异常。
  - 将 `continuous_back` 的前端显示文案统一为“连续回瓶”，不再依赖后端类型接口回传后才显示中文。
  - 对 4 类通常属于销售单瓶号录错的异常封禁直接“修复”：
    - `missing_back`（缺回瓶）
    - `missing_out`（缺出瓶）
    - `continuous_out`（连续出瓶）
    - `continuous_back`（连续回瓶）
  - 前端异常列表这 4 类改为显示禁用按钮“回原单修正”，并提示“请回销售单修正，不支持直接标记修复”。
  - 后端 `resolveV1` 同步拒绝这 4 类直接标记修复，避免前端绕过。
  - 异常筛选类型和单瓶时间线补扫白名单同步加入 `missing_out`，并保证本地固定映射包含“连续回瓶 / 缺出瓶”。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `src/services/bottleAnomaly.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上要看到“连续回瓶 / 缺出瓶”中文文案、筛选项和禁用修复按钮，仍需上传 `crm-bottle-anomaly` 并发布前端。
  - `missing_out` 属于新增异常类型，建议上传后用一个 `back -> fill -> back` 的真实瓶号做一次单瓶补扫回归，确认异常 note 与时间线 marker 都符合预期。

### 2026-03-24 CURRENT — 修复“缺灌装记损耗点一次不消失”
- 做了什么：
  - 分析后确认，问题不是“记损耗没成功”，而是两层叠加：
    - 历史上可能已存在同指纹的重复 `open missing_fill` 异常，第一次点击只关闭了当前 `_id`；
    - 前端成功后立即刷新，用户会看到另一条同指纹 open 记录顶上来，体感上像“点一次还在，点第二次才消失”。
  - 在 `crm-bottle-anomaly.resolveV1` 增加“按指纹批量关闭”：
    - 解析当前异常的 `fingerprint`
    - 同时关闭同瓶号、同类型、同指纹的所有 `open` 记录
    - 返回 `resolved_count` 供前端提示和局部更新使用
  - 异常页前端在“记损耗/记胀重/通用修复”成功后，先把当前页对应异常做本地移除，再做一次短延时同步刷新，避免云端更新刚完成时用户又看到旧行顶回来。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 要让线上“点一次即消失”生效，仍需上传 `crm-bottle-anomaly` 并发布前端。
  - 这次修复解决的是“同指纹重复 open 记录 + 回流时机”问题；若线上仍有极少数残留，建议再抽一个真实瓶号核查是否存在更老的无指纹异常脏数据。

### 2026-03-24 CURRENT — 新增“连续灌装”异常类型
- 做了什么：
  - 在 `crm-bottle-anomaly` 状态机中新增 `continuous_fill`（连续灌装），用于识别“前一次灌装尚未被出瓶消费掉，又来了新的灌装”。
  - 判定口径覆盖两类常见场景：
    - `回瓶 -> 灌装 -> 灌装`
    - `缺回瓶 -> 灌装 -> 灌装`
  - 新增异常上下文：
    - `last_fill`
    - `next_fill`
    - 若存在则补带 `last_back`
  - 同步更新：
    - 异常类型列表与筛选项
    - 单瓶时间线中文映射
    - 时间线 anomaly marker 打点（上一条灌装 + 下一条灌装）
    - 单瓶补扫 reconcile 白名单
  - `continuous_fill` 也按“回原单修正”处理，不开放直接“修复”按钮。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/services/bottleAnomaly.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上要看到“连续灌装”类型、筛选项和时间线异常点，仍需上传 `crm-bottle-anomaly`、`crm-bottle-movement` 并发布前端。
  - 建议上传后用一个真实 `back -> fill -> fill` 的瓶号做单瓶补扫回归，确认会同时在异常列表和时间线上打到两条灌装事件。

### 2026-03-24 CURRENT — 修复缺灌装“手工记损耗/记胀重”重复落调整
- 做了什么：
  - 复核后确认：全量扫描不会重复插入 `manual_fix`；你看到的两条“手工修复”来自此前同一缺灌装异常被重复点过，云端当时每次都会新增一条 `adjust` 流转。
  - 在 `crm-bottle-anomaly.resolveMissingFill` 增加幂等保护：
    - 以 `anomaly.fingerprint` 作为新的 `manual_fix.source_id`
    - 插入前按 `瓶号 + event_day + adjust_reason` 预查，并用 `source_id` 或旧版精确特征做 identity 比对
    - 命中已有同一条修复时不再重复 `add`
  - 在 `crm-bottle-movement` 的时间线与理论损耗统计增加“缺灌装修复调整”只读去重：
    - 新版优先按 `source_id`
    - 旧版无 `source_id` 时按 `瓶号 + 日期 + adjust_reason + loss_weight + note` 去重
  - 这样可以同时解决：
    - 以后再点“记损耗/记胀重”不再写出重复调整
    - 历史已经重复写入的完全相同 `manual_fix` 不再在时间线和损耗统计中双倍显示
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 线上要看到历史重复“手工修复”不再双显，仍需上传 `crm-bottle-anomaly`、`crm-bottle-movement` 并刷新前端。
  - 这次修复默认只对“完全相同”的缺灌装修复调整做去重；若历史库里存在同日同瓶但文案/重量不完全一致的手工修复脏数据，仍需要单独核查。

### 2026-03-24 CURRENT — 修复“新增连续灌装后全量扫描导致异常翻倍”
- 做了什么：
  - 复核后确认，本次“全量扫描后 open/resolved 都翻倍”的根因不是扫描器单纯重复跑，而是异常 `fingerprint` 在后续扩展中被改成了“通用拼接上下文字段”。
  - 新增 `continuous_fill`、`next_back`、`last_fill` 等上下文字段后，旧异常行和新扫描结果对同一业务异常会生成两套不同指纹，导致：
    - 扫描阶段把旧 open 异常当成“不存在”，重新插一条新 open
    - reconcile 阶段又把旧 open 误判成 stale，改成 resolved
    - 最终表现成 open 和 resolved 同时翻倍
  - 在 `crm-bottle-anomaly` 把异常身份改回“按类型固定字段生成”的稳定指纹：
    - `missing_fill = last_back + next_out`
    - `missing_back = last_out + next_fill`
    - `missing_out = last_back + next_fill + next_back`
    - `continuous_out = last_out + next_out`
    - `continuous_back = last_back + next_back + has_fill_since_last_back`
    - `continuous_fill = last_back + last_fill + next_fill`
  - 扫描、reconcile、缺灌装修复幂等都改为使用这套稳定指纹做比对，不再直接优先相信库里历史 `fingerprint`。
  - 在 `listV1` 增加“先按稳定指纹去重，再分页/统计/筛选”的只读兜底：
    - 可以把已经翻倍的 open/resolved 异常先在页面上折叠成一条
    - 统计摘要和异常类型 breakdown 也同步按去重后口径计算
  - 在 `crm-bottle-movement` 时间线异常去重中，也改成同一套稳定指纹，避免单瓶时间线继续把旧、新两条重复异常同时打点。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次修复会阻止之后继续翻倍，并把现有重复异常在列表/时间线上只读折叠；但不会物理删除历史重复 anomaly 文档。
  - 如果后续要把库里的重复异常真正清理掉，仍建议在上传云函数后做一次“按稳定指纹清理重复 open/resolved”的专项脚本或一轮受控 purge + rebuild。

### 2026-03-24 CURRENT — 线上执行重复异常物理清理（按稳定指纹删重）
- 做了什么：
  - 在 `crm-bottle-anomaly` 新增 `cleanupDuplicatesV1`：
    - 超级管理员可调用；
    - 按稳定指纹对 `crm_bottle_anomalies` 全量分组；
    - 每组只保留一条首选记录，其余重复文档物理删除；
    - 保留规则与当前只读去重一致，并优先保留人工已处理记录，其次再看 open/system-reconcile 和更新时间。
  - 扩展 `scripts/resetBottleAnomalies.cjs`，支持：
    - `--cleanup-duplicates`
    - `--cleanup-max-rows=...`
  - 已上传 `crm-bottle-anomaly` 到支付宝云空间 `env-00jxuffegf2n`，并执行线上清理。
- 线上执行结果：
  - 清理前原始 anomaly 文档：`608`
  - 稳定指纹去重后应保留：`351`
  - 实际删除重复文档：`257`
    - `open`: `26`
    - `resolved`: `231`
  - 清理后再次预览确认：
    - `total_rows = 351`
    - `duplicate_groups = 0`
    - `duplicate_rows = 0`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `scripts/resetBottleAnomalies.cjs`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check scripts/resetBottleAnomalies.cjs`
    - 线上预览：重复 `257` 条
    - 线上执行：删除 `257` 条
    - 线上复核：重复归零
- 剩余问题：
  - 当前只上传了 `crm-bottle-anomaly`；若你要让时间线也立即吃到最新的本地只读去重规则，仍需上传 `crm-bottle-movement`。

### 2026-03-24 CURRENT — 修复单瓶时间线查看/切回时异常被“新增后立刻自动关闭”
- 做了什么：
  - 复核 6 号瓶后确认，问题不在前端切屏本身，而在 `crm-bottle-anomaly.scanV2` 的同轮 reconcile：
    - 单瓶时间线页每次进入都会先跑 `scanV2(reconcile=true)`；
    - 新 anomaly 落库时没有写 `date` 字段；
    - 稳定指纹重算时优先从 anomaly 文档重建，结果第三段日期变成空串；
    - 于是同一轮里出现“`round_created = 1`，`round_resolved_stale = 1`”，即刚新增的 open 异常又被当 stale 关闭。
  - 修正 `buildAnomalyFingerprint()` 的日期回退：
    - `missing_fill` 优先 `next_out.date`
    - `missing_back` 优先 `next_fill.date`
    - `missing_out` 优先 `next_back.date`
    - `continuous_out` 优先 `next_out.date`
    - `continuous_back` 优先 `next_back.date`
    - `continuous_fill` 优先 `next_fill.date`
  - 修正 anomaly 落库：
    - `persistAnomaly()` 现在会显式写入 `date: anomaly.date`
  - 这样即使历史 anomaly 没有 `date` 字段，也能按类型从 context 恢复出稳定指纹；新 anomaly 也不会再出现“刚写入就被本轮 reconcile 误关”的问题。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `npm run build:h5`
  - 已上传 `crm-bottle-anomaly` 到支付宝云空间 `env-00jxuffegf2n`
  - 用 6 号瓶远程探针复核：
    - 修复前：`round_created = 1`、`round_resolved_stale = 1`
    - 修复后：`round_created = 1`、`round_resolved_stale = 0`
    - 扫描后 6 号瓶 `continuous_back` 正常保留为 `open`
- 剩余问题：
  - 单瓶时间线页当前仍会在进入时自动触发单瓶 `scanV2(reconcile=true)`；这次已经修掉“误自动关闭”，但它依然属于“查看页面会触发写操作”的设计。如果后续你要改成纯只读查看，再单独收口这条交互。

### 2026-03-25 CURRENT — 异常全量扫描安全轮询补强、异常页移除 TOP 瓶号、理论损耗页卡片筛选
- 做了什么：
  - 加固前端 `rebuildBottleAnomaliesSafeV2()`：
    - 默认 `maxRounds` 提高到 `240`，上限放宽到 `600`，避免“20 轮没扫完就停”；
    - 新增 `maxStallRounds` 与停滞检测，若游标和轮次进度连续不前进，会返回 `408 / stopped_reason=stalled`，避免前端无限续扫；
    - 返回值新增 `limit_reached` / `stall_rounds`，便于界面准确提示“已扫到上限但未完成”。
  - 调整异常页“全量扫描异常”按钮参数为更保守的多轮预算：
    - `maxRounds=240`
    - `batchBottlesPerRound=18`
    - `maxMsPerRound=2200`
    - `maxEventsPerRound=700`
    - `maxWritesPerRound=160`
    - `batchSize=160`
  - 云函数 `crm-bottle-anomaly.rebuildV2()` 默认单轮预算同步收紧：
    - `max_ms_per_round` 默认值由 `3200` 下调到 `2400`
    - `max_writes_per_round` 默认值由 `300` 下调到 `180`
    - rebuild 日志 detail 新增 `bottle_after / current_bottle_no / has_current_scan_cursor`，便于线上定位卡在哪个瓶。
  - 流转异常页移除“排查视图 -> TOP 瓶号”区域，只保留“按异常类型”统计；前端不再消费 `top_bottles`。
  - 理论损耗统计页头部 6 张卡片接入点击筛选：
    - `总损耗` -> 只看损耗周期
    - `总胀重` -> 只看胀重周期
    - `完整周期` -> 只看周期明细
    - `链路不完整` -> 只看链路不完整预览
    - `修复损耗` -> 只看修复损耗明细
    - `修复胀重` -> 只看修复胀重明细
  - 新增“清除卡片筛选”按钮，并给激活卡片增加高亮态。
  - 为保证分页正确，`crm-bottle-movement` 新增轻量 `result_type` 筛选参数：
    - `cycleLossV1`：只影响列表与分页总数，不影响头部 summary 总量；
    - `lossStatsV1`：只影响手工修复列表与总数，不影响头部 summary 总量。
- 改动文件列表：
  - `src/services/bottleAnomaly.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/services/bottleMovement.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次还没有上传云函数和前端；线上要吃到“全量扫描更耐久”和“理论损耗卡片筛选”，仍需发布前端并上传 `crm-bottle-anomaly`、`crm-bottle-movement`。

### 2026-03-25 CURRENT — 代理出站销售自动补全 `回瓶 -> 灌装 -> 出瓶` 钢瓶链路
- 做了什么：
  - 在 `crm-sale` 新增代理出站 synthetic movement 构建：
    - `agent_sale` 销售单保存时，不再只留下 `agent_sale_items`；
    - 会为每条代理明细自动补两条 `source_type='sale'` 的钢瓶 movement：
      - `back`：净重固定记 `0kg`
      - `out`：净重取 `agent_sale_item.fill_weight`
    - 中间 `fill` 严格复用现有 `truck_out_agent_sale` 灌装 movement，不由销售单重复写第二条 `fill`。
  - 代理链路的灌装关联改成双路解析：
    - 优先使用 `agent_sale_item.filling_record_id`
    - 若前端未带 `filling_record_id`，再回退按“同瓶号 + 同销售日期”匹配同日 `truck_out_agent_sale` 灌装 movement
    - 若显式关联到的 filling 不是 `truck_out_agent_sale`，或瓶号不匹配，则降级为按销售日期补 `back/out`，并在 movement `note` 留痕。
  - `crm-sale.updateV2()` 的 `source_type='sale'` movement 删除/重建改成统一覆盖全部业务模式切换：
    - `bottle -> agent_sale`
    - `agent_sale -> bottle`
    - `agent_sale -> truck`
    - `agent_sale` 明细调整
    - 避免遗留旧 sale movement。
  - 编辑销售单时补上 `agent_sale_items[].filling_record_id` 回填，避免已有代理销售单一旦进入编辑页再保存就丢失显式 fill 关联。
  - `SaleAgentSaleCard` 新增行默认带 `filling_record_id: null`，与后端 payload 结构保持一致。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleAgentSaleCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次只实现了代理出站销售在 create/update/remove 时的自动补链；历史已存在的 `agent_sale` 旧单还没有做一次性 backfill，线上若要让旧代理销售也进入完整异常流转，后续仍需补一轮历史 movement 回填。

### 2026-03-25 CURRENT — 历史代理出站钢瓶链路回填 action 与执行脚本
- 做了什么：
  - 在 `crm-sale` 新增 `backfillAgentSaleBottleMovementsV1`：
    - 仅 `superadmin` 可执行；
    - 支持按 `sale_id` 或日期范围筛选历史 `agent_sale` 销售单；
    - 对每张代理出站单重建期望的 synthetic `back/out` movement，并与现有 `source_type='sale'` movement 做签名比对；
    - `preview` 返回 `rebuild_sales / unchanged_sales / expected_insert_rows / affected_bottles / sample_sales`；
    - `execute` 要求确认口令 `BACKFILL_AGENT_SALE_BOTTLE_MOVEMENTS`，会删除该销售单旧 `sale` movement，再按新规则重建，并按瓶号触发 anomaly touch，联动更新异常流转。
  - 回填预览/执行的代理灌装关联改成“共享 linked meta”批量解析：
    - 先一次性收集目标销售单内全部 `agent_sale_items` 的 `filling_record_id` / `瓶号 + 销售日期`；
    - 再统一查询 `crm_bottle_movements.fill` 与 `crm_fillings`，避免按销售单逐条重复回查同日代理灌装。
  - 新增执行脚本 `scripts/backfillAgentSaleBottleMovements.cjs`：
    - 支持 `--dry-run` / `--execute`；
    - 支持 `--date-start` / `--date-end` / `--sale-id` / `--max-rows`；
    - 支持 `--no-touch` 与 `--touch-batch-size`；
    - 通过支付宝云函数调用 `crm-sale.backfillAgentSaleBottleMovementsV1`，输出预览与正式执行 JSON 结果。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `scripts/backfillAgentSaleBottleMovements.cjs`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check scripts/backfillAgentSaleBottleMovements.cjs`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 云函数与脚本还需在线上执行一次预览/正式回填，才能让历史 `agent_sale` 旧单进入完整 `回瓶 -> 灌装 -> 出瓶` 链路并更新异常流转。

### 2026-03-25 CURRENT — 已执行历史代理出站钢瓶链路回填并重建异常
- 做了什么：
  - 已将 `crm-sale` 云函数上传到支付宝云空间 `env-00jxuffegf2n`。
  - 已执行 `scripts/backfillAgentSaleBottleMovements.cjs --execute`：
    - 预览结果：历史 `agent_sale` 共 `39` 张、全部缺失代理出站 synthetic movement；
    - 正式执行：重建 `39` 张销售单、插入 `504` 条 `source_type='sale'` synthetic `back/out` movement，影响 `99` 个瓶号。
  - 因代理出站回填后的 anomaly touch 返回“未完成”，已追加执行全量异常重建：
    - `scripts/resetBottleAnomalies.cjs --execute --max-rounds=240 --batch-bottles-per-round=18 --max-ms-per-round=2200 --max-events-per-round=700 --max-writes-per-round=160 --batch-size=160`
    - 重建结果：`55` 轮、`976` 个瓶、`12181` 条事件、`177` 条 `open` 异常、`done=true`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `scripts/backfillAgentSaleBottleMovements.cjs`
  - `STATE.md`
- 验证输出要点：
  - 本地：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check scripts/backfillAgentSaleBottleMovements.cjs`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
  - 线上：
    - `crm-sale` 上传成功（`0:cloud functions:OK`）
    - 代理出站历史回填执行成功
    - 异常全量重建执行成功，且 `done=true`
- 剩余问题：
  - 回填后再次跑 `backfillAgentSaleBottleMovementsV1` 预览时，`39` 张代理出站单仍会被判为 `movement_signature_mismatch`；当前链路和异常已实际补齐，但回填预览的幂等签名口径还需进一步收口。

### 2026-03-25 CURRENT — 新增整车异常并将 truck_no 从瓶异常口径中剥离
- 做了什么：
  - 在 `crm-bottle-anomaly` 中新增 3 类整车异常：
    - `missing_truck_fill / 缺整车补给`
    - `truck_return_diff_excess / 整车回站差异过大`
    - `missing_truck_back_gross / 缺回站总重`
  - 确认业务口径：
    - `truck_out_no_sale` 仅代表车辆补给，不算销售；
    - `biz_mode='truck'` 按车辆链路独立扫描，不再混入钢瓶 `back/fill/out` 异常状态机；
    - `整车回站差异过大` 阈值固定为 `100kg`。
  - `crm-bottle-anomaly.rebuildV2` 现已拆成两阶段：
    - 第一阶段继续扫描钢瓶异常；
    - 第二阶段按 `truck_no` 扫描整车异常。
  - `crm-bottle-anomaly.touchV2` 增加 `truck_nos` 入参，支持销售单/车辆补给保存后增量触发整车异常刷新。
  - 在整车异常扫描时，会把同一 `truck_no` 下旧的瓶异常类型（误混入钢瓶流转的 `missing_* / continuous_*`）自动 `system-reconcile`，用于把 `truck_no` 从现有瓶异常口径中清出去。
  - 销售云函数 `crm-sale` 的异常 touch 已扩展：
    - 普通瓶销售仍传 `bottle_nos`；
    - `biz_mode='truck'` 额外传 `truck_nos`。
  - 灌装云函数 `crm-filling` 的异常 touch 已扩展：
    - `truck_out_no_sale` 创建/更新/删除及相关批量操作会传 `truck_nos`；
    - 不再把车辆补给误当成钢瓶异常增量扫描输入。
  - 前端异常页已同步：
    - 新增整车异常类型中文映射与筛选项；
    - `缺整车补给 / 整车回站差异过大 / 缺回站总重` 统一归为“回原单修正”，禁用直接修复；
    - 筛选输入标签改为“瓶号/车牌”。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/bottle/BottleMovementTimelineView.vue`
  - `src/services/bottleAnomaly.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次仅完成本地代码与构建校验；线上生效还需要重新上传 `crm-bottle-anomaly` / `crm-sale` / `crm-filling` / `crm-bottle-movement` 并执行一次全量异常重建，才能把历史 `truck_no` 旧瓶异常批量 reconcile 掉并生成新的整车异常。

### 2026-03-25 CURRENT — 修复整车异常漏认历史“车号灌装”补给
- 做了什么：
  - 定位 `缺整车补给` 误报根因：整车异常扫描此前只把 `crm_fillings.record_type='truck_out_no_sale'` 识别为车辆补给，漏掉了历史导入里以 `bottle_no=TRUCK-*`、`record_type` 为空或 `normal_fill` 方式记录的“车号灌装”补给。
  - 在 `crm-bottle-anomaly` 中新增历史兼容口径：
    - `fetchTruckSupplementRowsByTruckNo` 不再只查 `truck_out_no_sale`；
    - 对 `bottle_no == truck_no` 的灌装记录，若 `record_type` 为 `truck_out_no_sale`，或该 `truck_no` 形如 `TRUCK-*` 且记录类型为 `normal_fill`，均视为整车补给；
    - 显式排除 `truck_out_agent_sale`，避免把代理灌装误判为整车补给。
  - 在 `crm-filling` 中补齐整车异常增量触发：
    - 新增 `shouldTouchTruckAnomalyForFilling`，让 `truck_out_no_sale` 与历史兼容的 `TRUCK-* + normal_fill` 灌装在创建、更新、删除、批量新增、批量改日期、日期归一化后都能触发 `truck_nos` 异常刷新。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 这次修复的是本地代码口径；线上 `TRUCK-9335Z` 这类历史整车补给误报仍需要重新上传 `crm-bottle-anomaly` / `crm-filling`，再对整车异常执行一次重扫或全量重建，异常才会消失。

### 2026-03-25 CURRENT — 修复同日整车补给导致的残留“缺整车补给”误报
- 做了什么：
  - 针对 `TRUCK-9335Z` 这类同一天存在“前一张整车销售 -> 补给 -> 后一张整车销售”的情况，补了一层整车扫描兜底：
    - 原先 `missing_truck_fill` 只按 `date + created_at` 严格判断补给是否位于两张销售之间；
    - 现在线上若出现同一天业务、且严格排序下没命中补给，会额外检查同日补给；
    - 若同日补给重量与 `当前出站总重 - 上次回站总重` 的差值精确匹配，则认定这次已补给，不再报 `缺整车补给`；
    - 若没有精确匹配，再退回同日任一补给存在即视为已补给的宽松兜底。
  - 保持原有跨天逻辑不变，只收敛同日油罐车补给的业务日判定。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - 本地回放 `TRUCK-9335Z / 2026-01-24` 组数据，`gapKg = 5380`，补给存在且不应继续报 `缺整车补给`
- 剩余问题：
  - 线上还需要重新上传 `crm-bottle-anomaly` 并对整车异常执行一次重扫或全量重建，这条残留异常才会被 reconcile 掉。

### 2026-03-25 CURRENT — 剔除 `TRUCK-*` 进入钢瓶异常扫描，避免时间线反复生成“连续灌装”
- 做了什么：
  - 修复 `TRUCK-9335Z` 这类车号仍被单瓶时间线和瓶异常扫描器当成“钢瓶号”处理的问题。
  - 在 `crm-bottle-anomaly.scanV2` 中新增车号短路：
    - 若 `bottle_no` 形如 `TRUCK-*`，不再跑钢瓶 `back/fill/out` 状态机；
    - 直接把该标识下现存的钢瓶异常类型（`missing_* / continuous_*`）批量 `system-reconcile` 关闭。
  - 在 `crm-bottle-anomaly.touchV2` 中把 `bottle_nos` 里的 `TRUCK-*` 自动挪入 `truck_nos`，避免灌装保存、单瓶时间线后台扫描等入口又把车号送回钢瓶异常扫描器。
  - 在 `fetchNextBottleNo` 中跳过 `TRUCK-*` 标识，确保后续全量重建的瓶阶段也不再把车号当钢瓶扫描。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
- 剩余问题：
  - 线上已有的 `TRUCK-*` 钢瓶异常残留，需要重新上传 `crm-bottle-anomaly` 后再触发一次该车号的 `touchV2` 或执行一次全量重建，时间线里的“连续灌装”才会彻底消失。

### 2026-03-25 CURRENT — 已上线清除 `TRUCK-9335Z` 的钢瓶“连续灌装”残留
- 做了什么：
  - 已将最新 `crm-bottle-anomaly` 上传到支付宝云空间。
  - 对 `TRUCK-9335Z` 执行线上单标识扫描 / reconcile，利用新的 `scanV2` 车号短路逻辑，批量关闭该标识下误混入钢瓶流转的 `continuous_fill`。
- 线上验证结果：
  - 扫描前：`total=16 / open=10 / resolved=6`
  - 本轮扫描结果：`round_created=0 / round_resolved_stale=8 / round_scanned_events=0`
  - 扫描后：`total=16 / open=2 / resolved=14`
  - 被关闭的 8 条均为 `continuous_fill`，`resolved_by_name=system-reconcile`
- 保留情况：
  - `TRUCK-9335Z` 仍保留 2 条整车异常 open：
    - `missing_truck_fill`
    - `truck_return_diff_excess`
  - 这 2 条属于整车口径，不是钢瓶“连续灌装”残留。

### 2026-03-25 CURRENT — 优化整车回站差异异常链路说明，显式体现“上次余量已并入车重基线”
- 做了什么：
  - 优化 `truck_return_diff_excess` 的详情文案，不再只堆 `出站/回站/销售净重/差值` 四个数。
  - 改为显式展示整车链路：
    - `上次回站总重 -> 中间补给 -> 本次出站总重`
    - `本次回站总重`
    - `本次实际减重 = 出站总重 - 回站总重`
    - `与登记销售净重的差额`
  - 对正差 / 负差分别给出解释：
    - 正差：偏向额外损耗、补给漏记或重量录入偏差
    - 负差：偏向车上仍有结转余量，或销售净重 / 回站总重录入偏大
  - 在文案中明确说明：`上次余量会自然并入回站总重基线，无需单独再加`，避免再把“历史余量”误当额外链路。
  - 同步优化 `missing_truck_fill` 文案，直接展示按车重链路推算出的“至少需补给 kg”。
  - 异常页整车提示文案同步更新，区分整车正差 / 负差语义。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 后续动作：
  - 如需线上立刻看到新的整车异常详情，需要重新上传 `crm-bottle-anomaly`，再对目标车辆执行一次整车异常重扫 / reconcile。

### 2026-03-25 CURRENT — 修复整车异常重扫不刷新旧详情的问题
- 根因：
  - `crm-bottle-anomaly` 的扫描逻辑命中“同指纹 open 异常”时，只跳过新增，不会把旧异常文档的 `date / note / context` 更新成新规则生成的内容。
  - 同时 `scanTruckAnomaliesV1` 虽然内部已实现，但云函数 action 分发漏挂，外部无法直接定向触发整车重扫。
- 做了什么：
  - 为 open anomaly 新增 `fingerprint -> row` 映射，扫描命中同指纹旧异常时，若 `date / note / context` 有变化，就直接 update 原文档。
  - 这套“命中即刷新”逻辑同时覆盖：
    - 钢瓶扫描 `scanV2`
    - 整车扫描 `scanTruckAnomaliesV1`
  - 在云函数导出分发中补上 `scanTruckAnomaliesV1` action。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 预期结果：
  - 重新上传并重扫后，像 `TRUCK-9335Z` 这类已经存在的 open 整车异常，不需要先被 reconcile 掉再重建，也会直接刷新成新的链路说明和差异解释。

### 2026-03-25 CURRENT — 已上线刷新 `TRUCK-9335Z` 整车回站差异详情
- 做了什么：
  - 使用带空间环境变量的 HBuilderX CLI 成功上传最新 `crm-bottle-anomaly`。
  - 通过远程 `scanTruckAnomaliesV1` 对 `TRUCK-9335Z` 做定向整车重扫 / reconcile。
- 线上验证结果：
  - 扫描前该车仍有 `1` 条 open 的 `truck_return_diff_excess`，详情还是旧文案。
  - 本轮扫描结果：`round_created=0 / round_resolved_stale=0 / round_scanned_events=19`
  - 扫描后该 open 异常保留，但 `note / context / updated_at` 已刷新为新口径：
    - 展示链路：`2026-01-12回站总重 21600 kg -> 中间补给 9650 kg -> 2026-01-23出站总重 31250 kg`
    - 显示 `实际减重 6040 kg`
    - 明确指出 `比登记销售净重 9650 kg 少 3610 kg`
    - 明确说明：`上次余量会自然并入回站总重基线，无需单独再加`
- 影响：
  - 这条异常现在仍存在，但链路说明已经与“车内原有余量 + 中间补给 + 本次实际减重”的业务解释一致。

### 2026-03-27 CURRENT — 销售录入基础信息联想对齐
- 做了什么：
  - 将销售录入页基础信息卡片里的 `客户名称 / 配送车辆 / 配送员1 / 配送员2` 联想行为统一成同一口径：
    - 输入即联想
    - 聚焦时按当前值重新拉联想；空值时回显最近使用
    - 回车默认选第一个候选
    - 选择后写入最近使用列表
  - 为客户名称补上最近使用缓存与合并展示逻辑，行为与配送车辆、配送员保持一致。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 修复带前缀图标输入框的文本截断
- 做了什么：
  - 在全局基础组件 `AppInput` 中补齐输入框样式重置：
    - `min-width: 0`
    - `width: 100%`
    - `border / outline / background / padding / margin` 统一归零
    - `box-sizing: border-box`
  - 这次修复的是基础组件层，不只覆盖销售录入页“配送车辆”，其它使用 `prefix-icon` 的输入框也会一起受益。
- 改动文件列表：
  - `src/components/base/AppInput.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 销售基础信息联想对齐单瓶灌装交互
- 做了什么：
  - 将销售录入页基础信息卡片里的 `客户名称 / 配送车辆 / 配送员1 / 配送员2` 联想交互改成与“单瓶灌装瓶号输入”一致的节奏：
    - 非空输入时才触发联想
    - 聚焦时仅按当前已有输入复查联想
    - 失焦延时收起候选
    - 回车只规整当前输入，不再自动选中第一条候选
  - 同时移除了这 4 个字段的“空态最近使用回显”和“最近使用写回”，避免与单瓶灌装的联想行为不一致。
  - 联想结果数量统一放宽到 `20` 条，与单瓶灌装瓶号输入保持一致。
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 修复销售基础信息候选层点选与溢出
- 做了什么：
  - 修复销售录入页基础信息卡片联想候选层在 `客户名称 / 配送车辆 / 配送员1 / 配送员2` 上的层级与点选问题：
    - 候选项同时监听 `tap` 和 `click`，兼容不同端的点选回填
    - 候选项 `key` 改为稳定主键，避免车辆/配送员候选渲染异常
    - 候选层样式对齐到已稳定的销售瓶号联想卡片：
      - `top: calc(100% + 8rpx)`
      - `max-height: 320rpx`
      - `overflow: auto`
    - 允许 `AppCard` / `card__body` / `form-item` / `info-grid` 溢出显示，避免候选层看得见但点不到
    - 基础信息字段容器补 `z-index`，避免被同卡片其它区域盖住
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 修复基础信息联想层被相邻字段覆盖
- 做了什么：
  - 修复销售录入基础信息卡片中联想层被下一行/相邻字段压住的问题：
    - 当前展开候选的字段容器会动态加 `field-popover-open` 并提升 `z-index`
    - 不再给所有基础信息字段固定同级 `z-index`，避免同层后渲染节点互相覆盖
  - 保留候选项 `tap/click` 双事件，确保展开后可正常点选回填
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 修复基础信息联想列表滚动失效
- 做了什么：
  - 将销售录入基础信息卡片中 `客户名称 / 配送车辆 / 配送员1 / 配送员2` 的联想候选层，从 `view + overflow:auto` 改为 `scroll-view scroll-y`
  - 解决配送员等长候选列表在部分端上“看得见但不能上下滑动”的问题
  - 空结果态仍保留普通 `view` 容器，避免无结果时出现空白滚动层
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 修复基础信息联想列表底部候选被截断
- 做了什么：
  - 将销售录入基础信息卡片的联想候选层拆成两档：
    - `<= 3` 条：普通 `view` 直接展开，不走滚动容器
    - `> 3` 条：使用固定高度 `320rpx` 的 `scroll-view`
  - 为滚动容器内层补 `suggest-list` 和底部留白，避免最后一条候选只显示半截
  - 这次同时覆盖 `客户名称 / 配送车辆 / 配送员1 / 配送员2`
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 基础信息联想层支持向上展开
- 做了什么：
  - 为销售录入基础信息卡片的 `客户名称 / 配送车辆 / 配送员1 / 配送员2` 联想层新增可视区探测：
    - 聚焦并拿到候选后，测量当前字段相对视口的位置
    - 如果下方空间不足以完整显示候选层，则自动切换为向上展开
  - 修复“列表到底后只会回弹，但底部仍被屏幕裁掉”的问题；这不是候选内容没渲染，而是原先弹层始终向下展开，超出视口后不可见
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 放开基础信息外层 Section 的裁切
- 做了什么：
  - 修复销售编辑页 `基础信息` 区块外层 `AppSection` 的 `overflow: hidden` 对联想层的裁切
  - 仅针对 `基础信息` 这一段加 `section-popover-host`，并放开：
    - Section 根节点溢出
    - Section body 溢出
  - 这次修复的是父级容器裁切，不是联想层自身滚动逻辑
- 改动文件列表：
  - `src/components/domain/sale/SaleEditView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 修正基础信息浮层外层样式命中
- 做了什么：
  - 将销售编辑页基础信息联想浮层相关的“放开外层裁切”样式，从不稳定的 `:deep(...)` 根节点写法改为明确类名命中：
    - `SaleBasicInfoCard` 根节点 `AppCard` 增加 `basic-info-card`
    - `SaleEditView` 中 `基础信息` 的 `AppSection` 继续使用 `section-popover-host`
  - 现在会直接命中组件根节点，再向内放开 `card__body / section__body` 溢出
- 改动文件列表：
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 流量结算表数变更自动回填用气量
- 做了什么：
  - 修复销售录入页 `流量结算` 中，填写 `上次表数 / 本次表数` 后 `用气量` 输入框不自动回填的问题
  - `SaleFlowCard` 现在会在更新 `flowPrev / flowCurr` 时自动计算并写回：
    - `用气量 = max(本次表数 - 上次表数, 0)`
  - 数值展示会自动去掉整数的小数尾零，保持与页面其它数值输入一致
- 改动文件列表：
  - `src/components/domain/sale/SaleFlowCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 流量结算差值改为十进制精确计算
- 做了什么：
  - 修复销售录入页 `流量结算` 中，`上次表数=556993.1`、`本次表数=569469` 一类输入会出现 `12475.900000000023` 的浮点误差
  - `SaleFlowCard` 的 `用气量` 自动回填不再直接用 JS 浮点减法，改为按输入小数位数做十进制定点计算
  - 现在会稳定输出 `12475.9`，并继续保持 `本次表数 <= 上次表数` 时回填 `0`
- 改动文件列表：
  - `src/components/domain/sale/SaleFlowCard.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 客户对账页承接 `m3` 计费并新增 `kg / bottle` 经营分析
- 做了什么：
  - 销售单新增 `settlement_mode` 口径，`default_price_unit = m3` 的客户默认走 `customer_flow`：
    - 销售录入页隐藏流量结算与收款结算，只保留实际重量/流转录入
    - 销售单金额、应收、未收固定归零，不再从销售单直接形成应收
  - `crm-customer-settlement` 新增流量结算单能力：
    - `previewFlowSettlementV1`
    - `createFlowSettlementV1`
    - `getCustomerStatementAnalysisV1`
  - 客户对账页新增“经营分析”区块，按客户计价单位切换：
    - `m3`：流量结算录入、理论重量、阶段实际重量、阶段亏损、历史流量结算单
    - `kg`：客户阶段理论损耗（只统计钢瓶正损耗，不并入整车）
    - `bottle`：每公斤参考售价、阶段销售净重、参考kg金额、按瓶/按kg价差（仅经营对比，不参与账务）
  - 账务流水新增 `flow_settlement` 行类型；客户收款分配支持同时分配到：
    - 销售单 `sale`
    - 流量结算单 `flow_settlement`
  - 新增/更新数据库 schema：
    - `crm_customer_flow_settlements`
    - `crm_customer_allocations` 增加 `flow_settlement_id / target_type / target_id / target_title`
    - `crm_sale_records` 增加 `settlement_mode`
- 改动文件列表：
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `src/services/customerSettlement.js`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleBasicInfoCard.vue`
  - `src/composables/useSaleSettlement.js`
  - `src/services/models/sale.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_allocations.schema.json`
  - `uniCloud-alipay/database/crm_customer_allocations.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_flow_settlements.schema.json`
  - `uniCloud-alipay/database/crm_customer_flow_settlements.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 客户经营分析超时兜底与客户损耗统计轻量化
- 做了什么：
  - 修复客户对账页“经营分析”在 `kg` 客户上容易触发 `HttpClientRequestTimeoutError: Request timeout for 10000 ms`
  - 前端云调用基类 `callCloud` 新增可选 `timeout` 参数，客户经营分析接口提升为 `30000ms`
  - `customerLossSummaryV1` 收紧了最重的查询范围：
    - 若有结束日期，只加载该日期之前的瓶流转事件
    - 解析手工 `missing_fill` 修复时，优先按异常 `date` 范围过滤，减少无关 resolved anomaly 扫描
- 改动文件列表：
  - `src/services/api/callCloud.js`
  - `src/services/customerSettlement.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 客户经营分析内层云函数调用超时修复
- 做了什么：
  - 修复客户对账页“经营分析”在 `kg` 客户上仍然报 `HttpClientRequestTimeoutError: Request timeout for 10000 ms`
  - 根因是 `crm-customer-settlement` 内部调用 `crm-bottle-movement.customerLossSummaryV1` 时仍沿用默认 `10000ms` 超时
  - 已将这次内层 `uniCloud.callFunction` 调用超时提升到 `30000ms`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — `kg` 客户经营分析改为必须先选日期范围
- 做了什么：
  - 为避免大客户默认按全历史统计“客户阶段理论损耗”导致超时，`kg` 客户的经营分析改成必须先选“开始日期 + 结束日期”才会触发
  - 前端：
    - 未选完整日期范围时不再发起理论损耗云调用
    - 经营分析卡片显示“待选择日期范围”提示
    - 经营分析区新增独立日期筛选，不再复用“账务流水”的日期控件
    - `kg` 客户首次进入客户对账页时，经营分析日期默认填“本月”
  - 后端：
    - `getCustomerStatementAnalysisV1` 对 `kg` 客户无日期范围请求直接返回 `requires_date_range=true`
    - 同时增加开始/结束日期顺序校验
- 改动文件列表：
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-27 CURRENT — 客户理论损耗切到 `customer_id + day` 日汇总表
- 做了什么：
  - 为 `kg` 客户经营分析新增持久化汇总表 `crm_customer_loss_daily`
  - `crm-bottle-movement.customerLossSummaryV1` 不再直接把区间内客户钢瓶全链路结果当场汇总返回，而是：
    - 先按请求日期范围重建该客户的日损耗汇总
    - 再从 `customer_id + day` 汇总表读取阶段理论损耗
  - 日汇总统计口径：
    - 完整钢瓶周期正损耗，按 `next_out.customer_id` 和 `out_day` 归属到客户和日期
    - 缺灌装修复里“记损耗”的手工正损耗，按 `next_out.customer_id` 和 `next_out.date` 归属
  - 汇总表保留：
    - `cycle_loss_weight / cycle_loss_count`
    - `manual_loss_weight / manual_loss_count`
    - `loss_total_weight`
    - `bottle_count / bottle_nos`
  - 当前客户对账页仍以日期范围驱动重建和查询；后续若接全历史入口，直接查这张日汇总表即可，不再重建瓶子全链路
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/database/schema/crm_customer_loss_daily.schema.json`
  - `uniCloud-alipay/database/crm_customer_loss_daily.schema.json`
  - `STATE.md`
- 云端操作提示：
  - 需要新建集合 `crm_customer_loss_daily`
  - 上传 `crm-bottle-movement` 云函数
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-28 CURRENT — 新增客户理论损耗只读 breakdown 入口
- 做了什么：
  - 在 `crm-bottle-movement` 新增只读 `customerLossBreakdownV1`
  - 复用现有 `customer_id + day` 日汇总重建逻辑，返回：
    - 区间总损耗
    - 按天损耗明细
    - TOP 亏损日期
    - TOP 亏损瓶号
  - 新增一次性脚本 `scripts/analyzeCustomerLoss.cjs`，用于登录线上空间后查询指定客户在指定日期范围内的理论损耗拆解
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `scripts/analyzeCustomerLoss.cjs`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check scripts/analyzeCustomerLoss.cjs`
    - `npm run build:h5`

### 2026-03-28 CURRENT — 理论损耗页补客户筛选与导出
- 做了什么：
  - 在 `/pages/bottle/loss` 对应的理论损耗页新增“客户名称”筛选
  - `cycleLossV1 / lossStatsV1` 支持按客户名称过滤：
    - 周期明细按 `out_customer_name` 过滤
    - 手工修复差值按 `context.next_out.customer_name` 过滤
  - 理论损耗页新增导出功能：
    - 支持导出当前筛选结果
    - 未点卡片筛选时，导出“周期 + 修复差值 + 链路不完整”的合并 CSV
    - 点了卡片筛选时，导出当前卡片对应的数据
  - 导出时补齐了客户名称、链路不完整明细所需字段
- 改动文件列表：
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/services/bottleMovement.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-28 CURRENT — 理论损耗导出改为客户汇总优先
- 做了什么：
  - 调整理论损耗页导出结构，默认导出两段：
    - 客户汇总
    - 明细
  - 客户汇总按 `customer_name` 聚合：
    - 周期损耗
    - 周期胀重
    - 修复损耗
    - 修复胀重
    - 链路不完整条数
    - 明细条数
    - 涉及瓶数
  - 明细导出排序改为按“客户名称 -> 日期倒序 -> 类别 -> 瓶号”，方便先看客户再查瓶
- 改动文件列表：
  - `src/components/domain/bottle/BottleLossView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-28 CURRENT — 理论损耗导出改为 Excel 多工作表
- 做了什么：
  - 理论损耗页导出从单个 CSV 改为 Excel 可打开的多工作表文件（`.xls`）
  - 第一张工作表固定为“客户汇总”
  - 后续每个客户一张明细工作表，sheet 名按客户名称生成并自动去重/截断
  - 不引入第三方 xlsx 依赖，直接生成浏览器可下载、Excel/WPS 可识别的多工作表 XML Workbook
- 改动文件列表：
  - `src/components/domain/bottle/BottleLossView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-28 CURRENT — 整车销售净重改为毛重差值优先，m3 销售页退出流量结算
- 做了什么：
  - 整车销售卡片改成一行四列布局：车牌号、出厂毛重、回厂毛重、销售净重
  - `销售净重` 语义收口为：
    - 优先使用手填正数
    - 否则自动回退为 `出厂毛重 - 回厂毛重`
    - 历史 `0` 值也按“未填写”处理并回退差值
  - 销售页移除 `流量结算` 卡片
  - `m3` 销售单在前后端统一强制走 `customer_flow`：
    - 销售单只记录实际送货重量
    - 不在销售单内计费/收款
    - 详情页和回款入口也按客户对账结算口径展示
  - 瓶装模式不再允许通过流量表绕过出瓶/回瓶/存瓶录入校验
- 改动文件列表：
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/composables/useSaleSettlement.js`
  - `src/services/models/sale.js`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-28 CURRENT — 客户对账页流量结算改为两行四列，并明确首笔结算口径
- 做了什么：
  - 客户对账页 `m3` 客户的“流量结算”表单改成两行四列布局：
    - 第一行：`结算日期 / 上次表数 / 本次表数 / 表数差值`
    - 第二行：`理论系数 / 备注`
  - 新增只读字段 `表数差值`，按十进制定点算法计算 `本次表数 - 上次表数`，避免浮点尾差
  - 预览区新增：
    - `表数起点`
    - `重量统计`
    - 首笔流量结算的说明文案
  - 首笔流量结算（无上一张流量结算单）时：
    - 上次表数允许录系统启用前历史读数
    - 阶段实际重量仅统计 `2026-01-01` 起系统内销售
    - 若历史表数起点早于 `2026-01-01`，预览明确提示本次亏损会混入系统启用前用气，仅供参考
  - 阶段实际重量中的整车销售改为和销售页一致：
    - 优先取手填 `truck_sale_net`
    - 否则回退为 `truck_out_gross - truck_back_gross`
  - 同一阶段内的整车销售和瓶装销售会统一纳入 `actual_weight_kg`
- 改动文件列表：
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

### 2026-03-28 CURRENT — 整车销售统一放弃“销售净重”概念，改为毛重差值口径
- 做了什么：
  - 统一整车销售业务口径：
    - 放弃“销售净重”概念
    - 统一改为 `出厂毛重 - 回厂毛重`
    - 兼容老字段 `truck_sale_net` 仅作为历史数据兜底，不再作为新口径主值
  - 销售录入页整车卡片：
    - 第四项改为只读 `毛重差值`
    - 自动按 `出厂毛重 - 回厂毛重` 回填
    - 不再把它当作可独立输入概念
  - 销售草稿校验、结算公式、详情页展示、云端创建/更新校验全部切到同一口径：
    - 必须满足 `出厂毛重 - 回厂毛重 > 0`
    - 整车应收按 `毛重差值 × 单价`
  - 整车异常文案同步改口：
    - `销售净重` 全部改成 `毛重差值`
    - 负差解释仍保留“车上可能有结转余量”的说明
  - 客户结算、经营分析、看板、催收统计、进气库存流水、异常/时间线指纹等仍会用到整车重量的入口，统一改成：
    - 优先读 `truck_out_gross - truck_back_gross`
    - 缺失毛重时才回退旧字段 `truck_sale_net`
- 改动文件列表：
  - `src/components/domain/sale/SaleTruckCard.vue`
  - `src/services/models/sale.js`
  - `src/composables/useSaleSettlement.js`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-collection/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`

## 2026-03-29 20:01 CST
- 问题：用户管理页打开即提示 `[crm-user]: 用户函数代码语法或逻辑异常`，列表为空。
- 原因：
  - `crm-user` 在模块加载阶段直接 `require('bcryptjs')`，但云函数目录缺少 `package.json` 依赖声明。
  - 导致即使只是调用 `listManageV1/getPermissionRegistryV1`，云函数也会在启动时直接失败。
- 处理：
  - 为 `uniCloud-alipay/cloudfunctions/crm-user/` 新增 `package.json`，声明 `bcryptjs` 依赖。
  - 将 `bcryptjs` 改为延迟加载，仅在 `createV1/resetPasswordV1` 需要哈希密码时再 `require`。
  - 缺依赖时返回更明确的错误：提示重新上传 `crm-user` 云函数依赖。
- 影响文件：
  - `uniCloud-alipay/cloudfunctions/crm-user/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-user/package.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-user/index.js`

## 2026-03-29 20:09 CST
- 问题补充：
  - 上传 `crm-user` 后仍报错。
  - “新增用户”表单被浏览器自动填入当前 `superadmin` 账号密码。
- 处理：
  - `crm-user` 增加第二层兜底：优先读取 `../common/pageAcl`，缺失时自动退回函数目录内置的 `pageAclLocal/pageAclRegistryLocal`，避免因未同步上传 `common/` 导致函数启动失败。
  - 前端 `AppInput` 新增 `name/autocomplete` 透传。
  - 用户管理页“新增用户/重置密码”输入框显式设置为 `autocomplete="off/new-password"`，降低浏览器自动填充当前管理员账号密码的概率。
- 影响文件：
  - `uniCloud-alipay/cloudfunctions/crm-user/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-user/pageAclLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-user/pageAclRegistryLocal.js`
  - `src/components/base/AppInput.vue`
  - `src/components/domain/user/UserListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-user/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 20:18 CST
- 问题补充：
  - 用户管理页点击“刷新”时偶发 `[crm-user]: 用户函数代码语法或逻辑异常`。
- 原因收口：
  - `listManageV1` 使用 `users.orderBy('created_at', 'desc')`，而 `crm_users` schema 当前没有 `created_at` 索引，云端排序可能直接异常。
  - `crm-user` 外层没有统一 `try/catch`，导致页面只能收到平台泛化报错。
- 处理：
  - `listManageV1` 改为 `users.get()` 后本地按 `created_at` 排序，消除索引依赖。
  - `exports.main` 增加统一 `try/catch`，线上再失败时会直接返回真实 `err.message`。
- 影响文件：
  - `uniCloud-alipay/cloudfunctions/crm-user/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-user/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-collection/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 15:41 CST
- 作者：Codex
- 事项：连续灌装异常增加“删除后灌装”修复入口
- 变更摘要：
  - `continuous_fill` 异常卡片新增专用按钮“删除后灌装”，默认删除异常上下文中的后一次灌装记录 `next_fill`
  - 删除动作直接复用 `crm-filling.removeV1`，删除成功后本地先移除对应异常，再同步刷新列表
  - 异常提示文案同步调整为“建议删除后一次灌装”，未定位到后次灌装记录时保留提示并禁用按钮
- 改动文件列表：
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 16:41 CST
- 作者：Codex
- 事项：全局瓶子查询替换悬浮菜单
- 变更摘要：
  - 新增全局组件 `AppBottleQueryFloat`，用悬浮搜索按钮替换原来的展开式悬浮菜单
  - 查询结果直接复用单瓶时间线接口，展示瓶号、当前状态、销售/灌装统计、当前客户、最后事件和前 10 条流转记录
  - `AppPage` 不再挂载 `AppFloatNav`，原“工作台 / 销售记录 / 客户档案 / 钢瓶档案 / 车辆档案 / 天然气入库”的悬浮菜单整体下线
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `src/components/base/AppPage.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 16:47 CST
- 作者：Codex
- 事项：全局瓶子查询补齐灌装信息与拖动交互
- 变更摘要：
  - 查询结果里的灌装行不再显示 `—`，改为优先展示 `净重 xx kg`
  - 右下角搜索按钮支持拖动，拖动后松手不会误触发打开
  - 查询面板改为可拖动浮层，拖动区域在面板头部
  - 展开后的背景去掉模糊，仅保留轻度遮罩
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 16:56 CST
- 作者：Codex
- 事项：全局瓶子查询补齐鼠标拖动与非悬浮态透明度
- 变更摘要：
  - 悬浮搜索按钮新增鼠标拖动支持，H5 端可直接拖动位置
  - 查询面板头部新增鼠标拖动支持，拖动时不会误触发关闭/点击
  - 搜索按钮非悬浮态改为半透明，鼠标移入时恢复不透明
  - 按钮鼠标拖动后增加 click 抑制，避免拖拽结束误打开面板
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 16:18:00 CST

- 作者：Codex
- 事项：线上天然气库存账本差异清理与重复销售去重
- 变更摘要：
  - 新增运维脚本：
    - `scripts/cleanupDuplicateSales.cjs`
    - `scripts/rebuildGasInventoryLedger.cjs`
  - 清理线上疑似重复销售：
    - 基于 `docs/gas_inventory_diagnosis.latest.json` 中的 `suspected_duplicate_sales`
    - 按同签名组保留最早 `_id` 一条，调用 `crm-sale.removeV2` 删除其余重复单
  - 线上天然气库存账本重建：
    - 先做轻量预览，确认若保留旧 `cycle_adjust` 会继续残留瓶侧负值
    - 再执行带 `include_cycle_adjust=true` 的完整重建，彻底用源单重建结果覆盖线上 `crm_gas_inventory_movements`
  - 重建后复跑诊断，确认：
    - `current ledger == rebuilt ledger`
    - 疑似重复销售组清零
- 线上执行结果：
  - 重复销售清理：
    - 预览 `16` 组，额外重复 `17` 条
    - 实际删除 `17` 条，失败 `0` 条
    - 报告：
      - `docs/sale_duplicate_cleanup.preview.json`
      - `docs/sale_duplicate_cleanup.execute.json`
  - 天然气库存重建：
    - 轻量重建（保留旧 `cycle_adjust`）后摘要仍异常：
      - `asset_total_t=-129.708`
      - `in_bottle_total_t=-124.321`
    - 完整重建（重算 `cycle_adjust`）后摘要恢复到源单重建口径：
      - `asset_total_t=1.652`
      - `station_total_t=-7.647`
      - `in_bottle_total_t=7.039`
      - `vehicle_total_t=2.26`
    - 报告：
      - `docs/gas_inventory_rebuild.preview.json`
      - `docs/gas_inventory_rebuild.preview.full.json`
      - `docs/gas_inventory_rebuild.execute.json`
      - `docs/gas_inventory_rebuild.execute.full.json`
  - 复核诊断：
    - `docs/gas_inventory_diagnosis.after_full_cleanup.json`
    - 结果：
      - 线上 `remote_inventory` 与本地源单重建 `local_inventory` 完全一致
      - `suspected_duplicate_sales` 变为 `0`
- 结论要点：
  - 之前 `在瓶未售净值` 异常巨大，不是正常业务结果，而是：
    - 一批重复销售单
    - 以及沿用旧 `cycle_adjust` 的库存账本残差
  - 这次已在线上同时清掉重复销售和旧残差账本
- 改动文件列表：
  - `scripts/cleanupDuplicateSales.cjs`
  - `scripts/rebuildGasInventoryLedger.cjs`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/cleanupDuplicateSales.cjs`
    - `node --check scripts/rebuildGasInventoryLedger.cjs`
  - 已在线上执行：
    - `node scripts/cleanupDuplicateSales.cjs --execute --out=docs/sale_duplicate_cleanup.execute.json`
    - `node scripts/rebuildGasInventoryLedger.cjs --execute --include-cycle-adjust --out=docs/gas_inventory_rebuild.execute.full.json`
    - `node scripts/analyzeGasInventoryLedger.cjs --out=docs/gas_inventory_diagnosis.after_full_cleanup.json`

## 2026-03-29 15:28:00 CST
- 作者：Codex
- 事项：天然气库存四桶诊断与异常源单抓取
- 变更摘要：
  - 新增线上诊断脚本 `scripts/analyzeGasInventoryLedger.cjs`：
    - 直接读取线上 `crm-gas-in / crm-filling / crm-sale / crm-bottle-movement`
    - 本地重建天然气库存四桶（总资产 / 站内 / 在瓶 / 在车）
    - 产出 `docs/gas_inventory_diagnosis.latest.json`
  - 诊断结果确认：
    - 当前页面汇总读取到的线上账本为：
      - `asset_total_t = -148.524`
      - `station_total_t = -7.647`
      - `in_bottle_total_t = -130.397`
      - `vehicle_total_t = -10.480`
    - 但按真实源单重建后的本地账本仅为：
      - `asset_total_t = -16.446`
      - `station_total_t = -7.647`
      - `in_bottle_total_t = 1.681`
      - `vehicle_total_t = -10.480`
    - 两者差值集中在：
      - `asset_total_t = -132.078`
      - `in_bottle_total_t = -132.078`
    - 结论：线上 `crm_gas_inventory_movements` 仍残留一批额外的瓶侧负向 movement；问题已不只是期初缺失，而是库存账本与源单重建结果不一致。
  - 额外抓到的源数据异常：
    - `16` 组疑似重复销售单，共 `17` 条额外重复行
    - 对库存的附加影响约：
      - `asset_total_t = -18.816`
      - `in_bottle_total_t = -6.076`
      - `vehicle_total_t = -12.740`
    - 典型重复：
      - `2026-02-07` `TRUCK-9335Z` -> `四公` 整车销售 `2480kg` 重复 `3` 次
      - `2026-02-27` `TRUCK-9335Z` -> `浩诺` 整车销售 `5910kg` 重复 `2` 次
      - `2026-03-12` `肃宁-金颖` 瓶装销售 `1820kg` 重复 `2` 次
  - 还计算了四桶避免负数所需的最小期初量：
    - `asset = 27.468t`
    - `station = 18.774t`
    - `in_bottle = 10.626t`
    - `vehicle = 11.380t`
- 改动文件列表：
  - `scripts/analyzeGasInventoryLedger.cjs`
  - `docs/gas_inventory_diagnosis.latest.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/analyzeGasInventoryLedger.cjs`
    - `node scripts/analyzeGasInventoryLedger.cjs --space-id=env-00jxuffegf2n --out=docs/gas_inventory_diagnosis.latest.json`

## 2026-03-29 15:08:00 CST
- 作者：Codex
- 事项：天然气库存净值改为四桶口径，单列车载待售
- 变更摘要：
  - 将天然气库存快照与重建预览统计从三桶改为四桶：
    - `总库存净值`
    - `站内可灌装净值`
    - `在车待售净值`
    - `在瓶未售净值`
  - `TRUCK-*` 车号灌装与整车销售不再隐含在 `balance_diff_t` 里：
    - `filling_truck_fill` 计入 `vehicle_total_t`
    - `sale_truck` 从 `vehicle_total_t` 扣减
  - 对历史错误口径做兼容纠偏：
    - 若旧 movement 仍是 `filling_normal_fill` 且 `meta.inventory_scope='truck'` 或 `meta.bottle_no` 看起来像 `TRUCK-*`，汇总时按车载待售处理，不再计入 `在瓶未售净值`
  - 页面顶部摘要卡片新增 `在车待售净值`
  - 负库存提示文案增加“未归类差额”说明，明确当前仍残留的非站内/非在瓶/非在车的历史残差
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 13:46
- 作者：Codex
- 事项：天然气库存“在瓶未售净值”口径纠偏
- 变更摘要：
  - 修正整车销售气量 movement：
    - `sale_truck` 不再冲减 `in_bottle_delta_t`
    - 仅冲减天然气总资产，避免把整车销售误算进“在瓶未售净值”
  - 修正车号灌装 movement：
    - `TRUCK-*` 且 `record_type=normal_fill` 的车号灌装，不再按普通钢瓶灌装计入 `in_bottle_delta_t`
    - 改为只从站内可灌装净值转出，保留为车辆链路库存
  - 天然气库存重建逻辑补齐 `bottle_no` 读取：
    - 重建时能够正确识别历史车号灌装，避免库存重建后再次把车辆补给混入“在瓶未售净值”
  - 新增 movement 元信息：
    - `meta.bottle_no`
    - `meta.inventory_scope`
- 影响说明：
  - “在瓶未售净值”现在只统计真正灌进钢瓶、且尚未售出的气量
  - 整车销售与 `TRUCK-*` 车号灌装不再污染该指标
  - 线上历史错误 movement 需上传云函数后执行一次“库存重建”才能完全纠正
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`

## 2026-03-29 13:55
- 作者：Codex
- 事项：天然气入库页重建后摘要仍显示旧值的缓存修复
- 变更摘要：
  - 修复 `useQuery` 对 `force: true` 无效的问题：
    - 之前即使页面主动传入强制刷新，仍会优先命中本地查询缓存
    - 导致“库存重建”完成后，天然气入库页摘要卡片仍短时间显示旧值
  - 现改为：
    - `force: true` 时跳过缓存读取
    - `force: true` 时跳过节流拦截
    - 请求完成后仍会写回新缓存
- 影响说明：
  - 天然气入库页执行“库存重建”后，摘要卡片会立即读取最新云端结果
  - 其他传了 `force: true` 的列表/统计页也同步受益
- 改动文件列表：
  - `src/composables/useQuery.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 14:05
- 作者：Codex
- 事项：天然气库存重建降载与超时兜底
- 变更摘要：
  - `库存重建` 默认改为轻量模式：
    - 不再在每次重建时重扫整批钢瓶闭环差值
    - 默认保留现有 `cycle_adjust` movement
    - 闭环差值继续通过单独的“闭环同步”按钮维护
  - `crm-gas-in.rebuildInventoryV1` 在 `include_cycle_adjust=false` 时：
    - 直接读取并保留现有 `cycle_adjust` movement
    - 只重建 `gas_in / filling / sale` 三类天然气库存流水
  - 前端重建与闭环同步云调用超时统一提升到 `60000ms`
- 影响说明：
  - 天然气库存重建耗时显著下降，更不容易出现 `crm-gas-in 函数执行失败`
  - 本次“在瓶未售净值口径纠偏”不再被最重的闭环扫描阻塞
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/services/gasIn.js`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 14:14
- 作者：Codex
- 事项：天然气库存重建默认取消备份以规避执行失败
- 变更摘要：
  - `crm-gas-in.rebuildInventoryV1` 新增 `backup_before_rebuild`
    - 默认 `false`
    - 页面“库存重建”改为不自动备份旧流水
  - 当前页面重建链路进一步收敛为：
    - 不重扫闭环差值
    - 不自动备份
    - 只重建 `gas_in / filling / sale` 三类天然气库存 movement
  - 前端提示文案同步改成“默认不自动备份旧流水”
  - 重建调用超时提高到 `120000ms`
- 影响说明：
  - 进一步缩短单次重建耗时，降低 `crm-gas-in 函数执行失败` 的概率
  - 如需保留旧流水备份，后续可单独再加一个“带备份重建”入口
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `src/services/gasIn.js`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 13:17
- 作者：Codex
- 事项：收口 import_new 剩余 3 个档案问题并补跑尾批导入
- 变更摘要：
  - 新增一次性线上修复脚本 `scripts/fixImportNewArchives.cjs`：
    - 查并启用钢瓶 `X46`
    - 查并创建/启用车辆 `冀A77K99`
    - 查并创建/启用车辆 `冀A300AN`
    - 输出修复报告到 `docs/import_new/archive.fix.report.json`
  - 执行结果：
    - `X46` 已启用，钢瓶档案 `_id = 693fbee16dd837518fa12285`
    - `冀A77K99` 已创建并启用，车辆档案 `_id = 69c8b4c95cee11b05eee98fa`
    - `冀A300AN` 已创建并启用，车辆档案 `_id = 69c8b4c9ad2f4ad42ebc786e`
  - 补跑剩余导入：
    - 灌装导入：新增成功 `1` 条，正好收掉之前因 `X46` 未启用失败的那条；其余剩余 `30` 条仍为“同日期同瓶号记录已存在”的业务冲突，不再需要处理
    - 入库导入：`22` 条全部成功，新增 `2` 条（对应两辆新车），其余 `20` 条命中已有同日同车记录被安全跳过
- 改动文件列表：
  - `scripts/fixImportNewArchives.cjs`
  - `docs/import_new/archive.fix.report.json`
  - `docs/import_new/filling.import.report.json`
  - `docs/import_new/gas_in.import.report.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/fixImportNewArchives.cjs`
    - `node scripts/fixImportNewArchives.cjs --space-id env-00jxuffegf2n --report docs/import_new/archive.fix.report.json`
    - `node scripts/fixImportNewArchives.cjs --execute --space-id env-00jxuffegf2n --report docs/import_new/archive.fix.report.json`
    - `node scripts/importFillingsFromJson.cjs --execute --space-id env-00jxuffegf2n --input docs/import_new/filling_records.json --report docs/import_new/filling.import.report.json`
    - `node scripts/importGasInFromJson.cjs --execute --space-id env-00jxuffegf2n --input docs/import_new/gas_in_records.json --report docs/import_new/gas_in.import.report.json`
  - 报告关键结果：
    - `archive.fix.report.json`：`activated = 1`、`created = 2`
    - `filling.import.report.json`：`success_total = 1`、`conflict_total = 30`、`failed_total = 0`
    - `gas_in.import.report.json`：`success = 22`、`created = 2`、`skipped_existing = 20`、`failed = 0`
- 剩余问题：
  - `docs/import_new/filling_records.json` 仍有 `30` 条业务冲突，全部是“同日期同瓶号记录已存在”；当前策略保持跳过，不做覆盖更新。

## 2026-03-29 13:28
- 作者：Codex
- 事项：修正天然气入库页负库存说明、卡片布局和返回即强刷问题
- 变更摘要：
  - 天然气入库页顶部 6 张统计卡改成响应式网格：
    - 宽屏按 6 列一行展示
    - 常规宽度自动折行为多列
    - 窄屏维持单列
  - 将库存卡片标题改成 `总库存净值 / 站内可灌装净值 / 在瓶未售净值`，并在出现负值时展示说明：
    - 当前库存是按系统内天然气流水净值计算
    - 若系统启用前已有期初库存、或历史入库未补齐，会出现负数
  - 去掉天然气入库列表页的 `onShow` 无脑刷新：
    - 现在只在新增/编辑保存成功后，通过 `gasIn:list:refresh` 标记触发列表页刷新
    - 普通切屏返回不再重新加载
  - 首次进入页面不再强制跳过 `useQuery` 缓存，改为正常命中短缓存
- 改动文件列表：
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/components/domain/gasIn/GasInEditView.vue`
  - `src/pages/gas-in/list.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`
- 剩余问题：
  - 当前负库存说明只做了口径澄清，尚未引入天然气期初库存/历史入库补齐功能；若要把负数真正消掉，需要补期初或补全历史入库数据后再做库存重建。

## 2026-03-29 11:55
- 作者：Codex
- 事项：工作台左侧主图改为“近7日充装去向”
- 变更摘要：
  - 工作台左侧主图区不再使用“近7日出货结构（钢瓶/整车/代理）”
  - 新口径改为基于近 7 日灌装记录的“近 7 日充装去向”：
    - `钢瓶灌装`：灌装记录里除地方车 `000`、车辆燃气补给之外的常规钢瓶灌装
    - `地方车`：灌装记录里 `bottle_no = 000`
    - `车辆补给`：灌装记录里 `record_type = truck_out_no_sale`
  - 左图标题、图例、颜色、右侧摘要同步调整为：
    - `总充装`
    - `峰值日`
    - `峰值量`
    - `主去向`
  - 摘要与图例文案改成更贴近日常业务口径：
    - `钢瓶灌装`
    - `地方车`
    - `车辆补给`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 12:02
- 作者：Codex
- 事项：工作台左侧主区改为“近7日业务日报”
- 变更摘要：
  - 用户确认上一版遗漏了日报右半边“销售”信息后，左侧主区从“近7日充装去向”进一步改为“近7日业务日报”
  - 新日报按每天一行展示以下字段：
    - `充装瓶数`
    - `充装重量`
    - `地方车次`
    - `地方车重`
    - `车辆次`
    - `车辆重`
    - `客户数`
    - `销售瓶数`
    - `销售重量`
  - 数据口径明确拆分为：
    - 灌装侧：
      - `充装瓶数/充装重量`：近 7 日灌装记录里，除 `000` 和 `truck_out_no_sale` 之外的常规灌装
      - `地方车次/地方车重`：近 7 日灌装记录里 `bottle_no = 000`
      - `车辆次/车辆重`：近 7 日灌装记录里 `record_type = truck_out_no_sale`
    - 销售侧：
      - `客户数`：按业务日去重后的客户数
      - `销售瓶数`：瓶装 `out_items` 数量 + 代理销售明细行数
      - `销售重量`：瓶装出瓶净重 + 整车毛重差值 + 代理销售灌装净重
  - 左侧摘要同步改为：
    - `总充装`
    - `总销售`
    - `服务客户`
    - `主去向`
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 11:18
- 工作台“本月销售”完成线上核数，新增 `scripts/probeDashboardSummary.cjs` 对比工作台 KPI、本月销售单应收、本月 m3 流量结算应收和客户贡献分布。
- 核数结果：
  - 线上原始 KPI：`661823.4 元`
  - 销售单本月应收：`610522.4 元`
  - m3 流量结算本月应收：`51290 元`
  - 预期合计：`661812.4 元`
  - 与工作台差额仅 `11 元`，属于小额舍入差，不是三个月累计。
- 确认截图里“661.8w”是前端万元格式换算错误，已将工作台 KPI 的 `w` 换算从错误的 `/100` 修正为 `/10000`，`661823.4` 现在会显示为 `66.2w`。
- 工作台继续清理静态占位：
  - 移除了顶部搜索框
  - 移除了右上角静态通知/列表图标与占位头像
  - 之前已移除“本周 / 本月 / 成员”静态切换
- 新增/改动文件：
  - `scripts/probeDashboardSummary.cjs`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check scripts/probeDashboardSummary.cjs`
  - `node scripts/probeDashboardSummary.cjs --space-id=env-00jxuffegf2n --out=docs/dashboard_sales_probe_current_month.json`
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-29 11:42
- 工作台图表完成业务化替换，不再使用信息密度偏低的“近 6 日销售额 / 7 天趋势”组合。
- 替换方案：
  - 主图区改为 `近 7 日出货结构`
    - 维度：钢瓶 / 整车 / 代理
    - 口径：按销售业务实际出货重量统计
    - 摘要：总出货、峰值日、峰值量、主渠道
  - 右侧小图区改为 `近 7 日新增应收 vs 实收`
    - 口径：当日新增应收（销售单 + m3 流量结算单）与当日实收（客户收款单）
    - 摘要：新增应收、实收、差额、回款率
- 云端 `crm-dashboard.summaryV1` 新增数据结构：
  - `shipment.rows / total_weight_kg / peak_date / peak_weight_kg / dominant_channel / channel_totals`
  - `receivable.rows / total_receivable / total_received / gap_amount / collection_rate`
- 前端 `DashboardHome.vue` 已消费新结构并移除残余顶部占位控件。
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-29 10:33
- 作者：Codex
- 事项：工作台数据口径与图表接入修正
- 变更摘要：
  - 工作台 KPI `本月销售` 改为按现行结算口径汇总：
    - 普通销售继续来自销售单
    - `m3/customer_flow` 客户改为从 `crm_customer_flow_settlements` 汇总
    - 不再把销售单里的 `m3` 流量字段直接算进工作台金额
  - `任务分布` 从“老三类异常”改成覆盖当前全部异常类型的分组统计：
    - `缺失类`
    - `连续类`
    - `整车类`
    - `其他`
  - `工作概览` 改成真正区别于右侧 `7 天订单趋势` 的图：
    - 主图显示 `近 6 日销售额`
    - 右侧补充 `总额 / 峰值日 / 峰值额 / 日均`
    - 不再重复展示同一份 7 天订单数
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 12:54
- 作者：Codex
- 事项：执行 `docs/import_new` 增量导入并收口安全写入策略
- 执行摘要：
  - 已确认 `docs/import_new` 下三份源文件均为 `NDJSON`：
    - `sale_records.json`
    - `filling_records.json`
    - `gas_in_records.json`
  - 已按“旧系统只补新增，不覆盖新系统已修正数据”的口径执行导入：
    - 销售导入脚本保持 append-only
    - 灌装导入脚本保持 append-only
    - 天然气入库导入脚本新增默认保护：命中同日同车旧记录时跳过，不再默认 update
  - 为避免历史导入被当前瓶流转软预警阻断，已将以下脚本改为默认忽略瓶流转软预警：
    - `scripts/importSalesFromJson.cjs`
    - `scripts/importFillingsFromJson.cjs`
- 脚本改动：
  - `scripts/importGasInFromJson.cjs`
    - 新增 `--allow-update-existing`
    - 默认 `execute` 下命中旧记录时返回 `skip_existing`
  - `scripts/importSalesFromJson.cjs`
    - 新增 `--respect-flow-warning`
    - 默认历史导入自动传 `ignore_bottle_flow_warning = true`
  - `scripts/importFillingsFromJson.cjs`
    - 新增 `--respect-flow-warning`
    - 默认历史导入自动传 `ignore_bottle_flow_warning = true`
- 实际导入结果：
  - 销售：
    - 首轮预检：`待新增 317`
    - 首轮执行：`成功 124`，其余主要被瓶流转软预警拦截
    - 脚本收口后补跑：`待新增 195`，`成功 195`，`失败 0`
    - 当前结论：本批销售增量已全部导入完成
  - 灌装：
    - 预检：`原始 4821`，`规范化 4765`，`输入内重复 56`，`待新增 928`
    - 首轮执行：`成功 441`，`冲突 486`，`失败 1`
    - 补跑后：`已存在 4278`，`目标新增 487`，`成功 456`，`冲突 30`，`失败 1`
    - 当前剩余未导入项：
      - `30` 条：`同日期同瓶号记录已存在，请勿重复录入`
      - `1` 条：`X46`，原因 `钢瓶档案未启用，不能灌装`
  - 天然气入库：
    - `attempted 22`
    - `success 20`
    - `created 1`
    - `skipped_existing 19`
    - `failed 2`
    - 当前剩余未导入项：
      - `冀A77K99`：`车牌未关联启用车辆档案`
      - `冀A300AN`：`车牌未关联启用车辆档案`
- 结果说明：
  - 销售/灌装通过云函数创建，已随业务写入自动更新钢瓶运行状态、流转和异常 touch
  - 本次没有额外执行钢瓶主档静态字段同步；若后续需补启用 `X46` 或补建车辆档案，应单独处理档案层数据
- 输出文件：
  - `docs/import_new/sale.import.report.json`
  - `docs/import_new/filling.import.report.json`
  - `docs/import_new/gas_in.import.report.json`
- 验证输出要点：
  - 已运行并通过：
    - `node --check scripts/importGasInFromJson.cjs`
    - `node --check scripts/importSalesFromJson.cjs`
    - `node --check scripts/importFillingsFromJson.cjs`

## 2026-03-29 09:58
- 作者：Codex
- 事项：线上执行整车毛重差值历史回填
- 执行摘要：
  - 已在支付宝云空间 `env-00jxuffegf2n` 远程调用：
    - `crm-sale.backfillTruckGrossDiffV1` 预览
    - `crm-sale.backfillTruckGrossDiffV1` 正式执行
  - 执行参数：
    - `clear_legacy = true`
    - `batch_size = 200`
- 执行结果：
  - 预览：
    - `scanned = 10`
    - `changed = 10`
    - `cleared_legacy = 10`
  - 正式执行：
    - `scanned = 10`
    - `changed = 10`
    - `cleared_legacy = 10`
- 当前线上状态：
  - 历史整车销售已补写 `truck_gross_diff`
  - 历史整车销售遗留 `truck_sale_net` 已同步清空
  - 整车 schema 迁移已完成到“云函数 + schema + 历史数据”三层一致

## 2026-03-29 09:39
- 作者：Codex
- 事项：整车毛重差值 schema 迁移收口
- 变更摘要：
  - 确认整车业务新口径已正式切到 `truck_gross_diff`：
    - 新建/编辑整车销售时正式写入 `truck_gross_diff`
    - `truck_sale_net` 对新写入统一置空，仅保留历史兼容回读
  - 补齐剩余兼容读取：
    - 时间线/异常指纹里最后一处旧字段直读改为优先 `truck_gross_diff`
    - 旧导出转换、JSON 导入和销售标准化对象统一改为“正式输出新字段、旧字段清空”
  - `crm-sale` 保留了 `backfillTruckGrossDiffV1`：
    - 可先预览再执行，把历史 `biz_mode='truck'` 销售补写 `truck_gross_diff`
    - 可选同步清空遗留 `truck_sale_net`
- 迁移口径：
  - 正式字段：`crm_sale_records.truck_gross_diff`
  - 兼容字段：`crm_sale_records.truck_sale_net`
  - 读取顺序统一为：
    - 优先 `truck_out_gross - truck_back_gross`
    - 其次 `truck_gross_diff`
    - 最后回退历史 `truck_sale_net`
- 改动文件列表：
  - `src/services/models/sale.js`
  - `src/services/sale.js`
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `scripts/importSalesFromJson.cjs`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-collection/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 17:00 CST
- 作者：Codex
- 事项：全局瓶子查询补齐 pointer 拖动与闲置透明度
- 变更摘要：
  - `AppBottleQueryFloat` 的右下角搜索按钮新增 `pointerdown + window pointermove/up` 拖动链路，补齐桌面 WebView 下鼠标拖动不生效的问题。
  - 查询面板头部同样切到 `pointer` 拖动链路，继续保留原有触摸拖动，面板可随意拖动。
  - 触发按钮闲置态透明度从 `0.68` 下调到 `0.42`，鼠标悬浮时恢复为 `1`。
  - 为触发按钮和面板头部补了 `touch-action: none`，减少拖动时的浏览器默认手势干扰。
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 17:10 CST
- 作者：Codex
- 事项：全局瓶子查询改为把手拖动与全局触摸跟随
- 变更摘要：
  - 查询面板头部新增左侧三横拖动把手，拖动入口对齐旧系统样式。
  - 面板拖动不再绑定整块标题栏，而是绑定拖动把手，避免和关闭按钮、输入区交互混淆。
  - 触摸拖动链路改成“按下开始、window 级 touchmove 跟随、touchend 结束”，解决手指滑出按钮/标题区后拖动中断的问题。
  - 右下角放大镜按钮继续支持拖动，并沿用全局跟随链路提升稳定性。
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 17:16 CST
- 作者：Codex
- 事项：全局瓶子查询改为仅关闭按钮可关闭
- 变更摘要：
  - 查询面板展开后，点击外层遮罩不再关闭面板。
  - 当前仅保留右上角关闭按钮作为显式关闭入口，避免拖动或误触遮罩导致面板关闭。
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 17:20 CST
- 作者：Codex
- 事项：全局瓶子查询遮罩改为不拦截外部点击
- 变更摘要：
  - 面板展开后的遮罩层保留轻视觉背景，但不再接管 pointer 事件。
  - 用户在面板打开时仍可点击页面其他按钮，关闭动作继续只保留右上角关闭按钮。
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 17:34 CST
- 作者：Codex
- 事项：销售单新增可选销售底单图片上传
- 变更摘要：
  - 新建/编辑销售单时新增“销售底单”区块，支持选择、预览、移除单张图片。
  - 保存销售单前自动上传图片到云端文件存储，并把 `fileID` 随销售单一起提交。
  - 销售单 schema、新建接口、更新接口和前端草稿模型统一新增 `ticket_image / ticketImage` 字段。
- 改动文件列表：
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/services/sale.js`
  - `src/services/models/sale.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 17:42 CST
- 作者：Codex
- 事项：工作台业务日报改为近五日并补齐对齐汇总
- 变更摘要：
  - 左侧日报卡片改为仅展示最近五日，不影响右侧“近7日新增应收 vs 实收”。
  - 在日报表格底部新增与列对齐的“五日合计”汇总行，补齐充装瓶数、充装重量、地方车、车辆补给、客户数、销售瓶数、销售重量合计。
  - 右侧摘要同步改成更直接的合计口径：充装瓶数、充装重量、销售瓶数、销售重量、客户数合计和主去向。
- 改动文件列表：
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `STATE.md`
- 验证输出要点：
  - 已运行并通过：
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 18:09 CST
- 作者：Codex
- 事项：新增用户管理页并补齐页面级 CRUD 权限控制
- 变更摘要：
  - 新增仅 `superadmin` 可见的用户管理页，支持新增用户、改角色、重置密码、删除用户、保存页面级 `查/增/改/删` 权限，以及按角色模板回填现有用户权限。
  - 新增统一页面权限注册表与 ACL helper，`crm-auth`/`crm-user` 返回并保存 `role_template` 与 `page_permissions`，前端新增 `useAuthGuard` 页面视图/动作判断。
  - 将销售、灌装、天然气入库、钢瓶、车辆、配送员、会计科目、凭证、账期、客户对账、瓶流转异常、工作台导航等页面入口和按钮接到页面权限；无权按钮隐藏，直接调云函数由后端 ACL 统一拒绝。
  - 将 `crm-sale`、`crm-filling`、`crm-gas-in`、`crm-account`、`crm-voucher`、`crm-ledger`、`crm-report`、`crm-period`、`crm-collection`、`crm-log`、`crm-bottle-movement`、`crm-bottle-anomaly`、`crm-customer-settlement` 接入统一 ACL，并保留高风险维护动作为 `superadmin` 专属。
- 改动文件列表：
  - `src/pages.json`
  - `src/pages/user/list.vue`
  - `src/components/domain/user/UserListView.vue`
  - `src/services/user.js`
  - `src/services/pageAclRegistry.js`
  - `src/services/pageAcl.js`
  - `src/composables/useAuthGuard.js`
  - `src/components/base/AppPage.vue`
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/bottle/BottleAnomalyView.vue`
  - `src/components/domain/delivery/DeliveryListView.vue`
  - `src/components/domain/vehicle/VehicleListView.vue`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/accounting/AccountListView.vue`
  - `src/components/domain/accounting/VoucherListView.vue`
  - `src/components/domain/accounting/PeriodListView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/services/auth.js`
  - `src/services/navigation.js`
  - `src/services/api/callCloud.js`
  - `uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`
  - `uniCloud-alipay/cloudfunctions/common/pageAcl.js`
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-user/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-account/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-report/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-period/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-collection/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-log/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `uniCloud-alipay/database/schema/crm_users.schema.json`
  - `STATE.md`
  - 验证输出要点：
    - 已运行并通过：
      - `node --check uniCloud-alipay/cloudfunctions/crm-auth/index.js`
      - `node --check uniCloud-alipay/cloudfunctions/crm-user/index.js`
      - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-account/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-voucher/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-ledger/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-report/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-period/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-collection/index.js`
      - `node --check uniCloud-alipay/cloudfunctions/crm-log/index.js`
      - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
      - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
      - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`

## 2026-03-29 账号看得见页面但数据全空修复

- 问题结论：
  - ACL 上线后，多数数据云函数直接依赖 `../common/pageAcl`，一旦云端未同步这份 `common`，函数会在模块加载阶段直接异常。
  - 前端多处列表页对云函数失败做了“静默回空”，所以用户看到的是“页面能打开，但数据全空”。
  - 前端登录后没有主动向 `crm-auth/check` 同步当前用户最新权限，导航和真实后端权限可能脱节。
- 代码调整：
  - 给所有依赖 `../common/pageAcl` 的云函数增加本地 ACL 兜底：
    - `pageAclLocal.js`
    - `pageAclRegistryLocal.js`
    - 通过 `try/catch` 优先读 `../common/pageAcl`，失败时回退本地副本
  - 覆盖云函数：
    - `uniCloud-alipay/cloudfunctions/crm-auth`
    - `uniCloud-alipay/cloudfunctions/crm-account`
    - `uniCloud-alipay/cloudfunctions/crm-bottle`
    - `uniCloud-alipay/cloudfunctions/crm-bottle-anomaly`
    - `uniCloud-alipay/cloudfunctions/crm-bottle-movement`
    - `uniCloud-alipay/cloudfunctions/crm-collection`
    - `uniCloud-alipay/cloudfunctions/crm-customer`
    - `uniCloud-alipay/cloudfunctions/crm-customer-settlement`
    - `uniCloud-alipay/cloudfunctions/crm-dashboard`
    - `uniCloud-alipay/cloudfunctions/crm-delivery`
    - `uniCloud-alipay/cloudfunctions/crm-filling`
    - `uniCloud-alipay/cloudfunctions/crm-gas-in`
    - `uniCloud-alipay/cloudfunctions/crm-ledger`
    - `uniCloud-alipay/cloudfunctions/crm-log`
    - `uniCloud-alipay/cloudfunctions/crm-period`
    - `uniCloud-alipay/cloudfunctions/crm-report`
    - `uniCloud-alipay/cloudfunctions/crm-sale`
    - `uniCloud-alipay/cloudfunctions/crm-vehicle`
    - `uniCloud-alipay/cloudfunctions/crm-voucher`
  - 前端新增登录态同步：
    - `src/services/auth.js` 增加 `syncCurrentUser`
    - `src/App.vue` 在 `onLaunch/onShow` 调 `crm-auth/check`
  - 前端修复“失败显示为空”：
    - `src/components/domain/dashboard/DashboardHome.vue`
    - `src/components/domain/sale/SaleListView.vue`
    - `src/components/domain/gasIn/GasInListView.vue`
    - 现在云函数失败会直接 toast 实际错误，不再默默清空列表
- 验证输出要点：
  - 已运行并通过：
    - `node --check uniCloud-alipay/cloudfunctions/crm-auth/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-dashboard/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-gas-in/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-anomaly/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
    - `node --check uniCloud-alipay/cloudfunctions/crm-log/index.js`
    - `npm run build:h5`
    - `npm run build:mp-alipay`

## 2026-03-29 22:20 用户权限与 superadmin 校正

- 背景：
  - 用户管理和多业务页在 ACL 上线后出现“当前账号能进页面但无数据/偶发云函数异常”的问题。
  - 排查后确认一个关键成因是：旧 `superadmin` 账号若历史上不是 `role=superadmin`，`crm-auth.ensureSuperAdmin()` 只会“查到即返回”，不会把账号强制校正成真正超级管理员。
- 处理：
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
    - `ensureSuperAdmin()` 改为：已存在的 `superadmin` 账号会强制校正 `role`、`role_template`、`page_permissions`，缺密码哈希时自动补齐。
    - 超级管理员校验统一改成 `isSuperAdmin()`，不再直接判断 `user.role === 'superadmin'`。
  - `uniCloud-alipay/cloudfunctions/crm-user/index.js`
    - 保护 `superadmin`：禁止改角色；保存权限时自动回正为全权；回填权限时按用户名 `superadmin` 强制模板为 `superadmin`。
  - `src/components/domain/user/UserListView.vue`
    - 新增用户区域加入浏览器自动填充陷阱，减少 `superadmin` 账号/密码被自动带入。
    - 选中 `superadmin` 时，权限矩阵、角色、重置模板、重置密码、保存按钮全部只读，并提示“超级管理员固定全权”。
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-auth/index.js`
  - `node --check uniCloud-alipay/cloudfunctions/crm-user/index.js`
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-29 22:45 工作台品牌与退出登录、登录页样式、权限矩阵显示收口

- 背景：
  - 用户确认当前账号状态已恢复正常，但工作台没有明显的退出登录入口，品牌文案仍保留旧的 `2026 CRM / 运营驾驶舱`。
  - 登录页品牌和首页不一致，输入框与按钮在桌面端过长。
  - 用户管理页里 `superadmin` 权限矩阵把“不适用动作”显示成关闭开关，容易误解成超级管理员缺权限。
  - 一些列表页的 CRUD 支持在权限注册表里缺项，导致授权矩阵不完整。
- 处理：
  - `src/App.vue`
    - 应用启动和切回前台时，登录态同步统一改为 `syncCurrentUser({ force: true })`，减少旧会话缓存导致的页面可见性与真实权限脱节。
  - `src/components/domain/dashboard/DashboardHome.vue`
    - 左侧品牌改为 `新拓能源`，移除副标题 `运营驾驶舱`。
    - 顶栏面包屑改为 `新拓能源 / 工作台`。
    - 新增当前账号信息和 `退出登录` 按钮，退出时清空本地登录态并回到登录页。
  - `src/pages/login/login.vue`
    - 登录页标题改为 `新拓能源`，副标题改为 `账号登录`。
    - 登录卡片宽度收窄并居中，登录按钮改为较短固定宽度，整体视觉与工作台蓝白风格对齐。
    - 页脚品牌改为 `Powered by 新拓能源`。
  - `src/components/domain/user/UserListView.vue`
    - 权限矩阵中不支持的 `增/改/删` 动作改为显示 `—`，不再显示灰色关闭开关。
    - 保留 `superadmin` 只读逻辑，明确表达“系统固定全权”而不是“权限缺失”。
  - `src/services/pageAclRegistry.js`
  - `uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`
    - 补齐明显缺失的 CRUD 支持：
      - `/pages/sale/list`
      - `/pages/customer/list`
      - `/pages/bottle/list`
      - `/pages/vehicle/list`
      - `/pages/delivery/list`
      - `/pages/accounting/account-list`
      - `/pages/accounting/voucher-list`
      - `/pages/accounting/period-list`
    - 云函数目录下所有 `pageAclRegistryLocal.js` 已同步为最新口径，避免只上传单个云函数目录时继续走旧权限注册表。
- 验证：
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-30 00:26 工作台日报表格桌面端自适应回退

- 调整工作台“近 5 日业务日报”表格宽度策略：
  - 桌面端取消固定 `min-width: 980px`，改为容器内满宽显示，避免需要左右滑动才能看完整列。
  - 表格外层改为居中布局，整体视觉位置更居中。
  - 窄屏（`<= 1024px`）保留横向滚动回退，避免移动端挤压过度。
- 改动文件：
  - `src/components/domain/dashboard/DashboardHome.vue`
- 验证：
  - `npm run build:h5`
  - `npm run build:mp-alipay`
## 2026-03-29 23:32 销售记录页本月销售口径对齐工作台

- 销售记录页首张统计卡从“应收总额”改为“本月销售”，独立显示当月 `销售单应收 + 流量结算单应收`，不再复用当前筛选汇总。
- `crm-sale.listV2` 新增返回 `month_sales_doc_total`、`month_flow_total`、`month_sales_total`、`month_range_start`、`month_range_end`，由云端按当前月份直接汇总销售单与 `crm_customer_flow_settlements`。
- 保留其余销售记录页统计卡的筛选汇总逻辑不变，避免把“月度口径”和“筛选口径”继续混在一起。
- 已验证 `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`、`npm run build:h5`、`npm run build:mp-alipay` 通过。

### 2026-03-29 23:38 销售记录页月度口径容错回退
- 做了什么：为 crm-sale 的本月销售头部汇总增加流量结算查询容错；当 crm_customer_flow_settlements 查询失败时，销售记录页仍可回退为仅统计本月销售单应收，不再拖垮 listV2。
- 改动文件列表：uniCloud-alipay/cloudfunctions/crm-sale/index.js。
- 验证输出要点：node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js 通过；构建通过。
- 剩余问题：若线上未同步流量结算集合或权限异常，销售记录页第一张卡会暂时少算流量结算部分，但不会报函数异常。
## 2026-03-29 23:58 修复销售记录页月销售卡导致 crm-sale 崩溃

- 背景：销售记录页顶部首卡已改为“本月销售”，`crm-sale.listV2` 会附带返回本月销售单应收与本月流量结算应收合计；线上用户反馈进入销售记录页时报 `[crm-sale]: 用户函数代码语法或逻辑异常`。
- 原因：新增的 `computeMonthSalesHeadline()` 里误调用了不存在的 `computeSaleAmount()`，线上 `listV2` 在统计本月销售单应收时直接抛 `ReferenceError`。
- 处理：
  - 改为复用 `crm-sale` 内部现有的 `computeSaleAmountsForDoc(doc).amounts.should_receive` 口径，不再引用未定义函数。
  - 保留此前对 `crm_customer_flow_settlements` 查询失败的降级处理，避免集合或权限异常再次拖垮 `listV2`。
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-30 00:21 工作台日报与多页面快捷日期补齐

- 销售记录：
  - 关键词联想继续保留客户 + 车牌混合候选，并补了 `@tap.stop`，避免移动端点选车牌候选时事件冒泡导致回填失败。
  - 保持“本月销售”冗余卡已移除后的现状，头部仅保留筛选汇总卡组。
- 客户档案：
  - 关键词联想下拉放开父容器裁切，候选点击后可稳定回填。
  - 客户卡片继续展示 `存瓶 x`，后端 `crm-customer` 已返回 `deposit_count`。
- 快捷日期：
  - `销售记录`、`灌装记录` 维持已有 `今日/本周/本月/自定义` 滑块。
  - 新增到 `天然气入库`、`理论损耗统计`，统一使用 `AppDatePresetBar` 和 `datePreset` 同步逻辑。
- 工作台：
  - “近 5 日业务日报”左侧去掉底部“五日合计”行，右侧“业务摘要”保留汇总并压缩成两列。
  - 在右侧摘要下新增“近5日销售重量”迷你柱状图，提升占位利用率。
  - 调整 `overview-grid` 侧栏宽度与业务摘要样式，避免信息重复堆叠。
- 改动文件：
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/components/domain/dashboard/DashboardHome.vue`
- 验证：
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-30 00:34 统一快捷日期滑块顶部位置

- 背景：用户给出快捷日期滑块的标准位置截图，要求各页面统一把快捷日期放在统计区之后、筛选区之前，而不是继续塞在筛选网格内部。
- 处理：
  - 将 `销售记录`、`灌装记录`、`天然气入库`、`理论损耗统计` 四页的 `AppDatePresetBar` 统一提到顶部独立一行。
  - 删除筛选网格内原有的“快捷日期”字段，避免网格内出现额外一格。
  - 统一新增 `quick-date-strip` 容器样式，保证桌面端按截图基准左对齐展示，窄屏下允许横向滚动兜底。
- 改动文件：
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/components/domain/bottle/BottleLossView.vue`
- 验证：
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-30 00:48 快捷日期联动查询与客户存瓶详情

- 背景：用户要求点击快捷日期滑块时，对应卡片和筛选结果一起变动；并把同样的顶部滑块位置规则扩到客户对账里的日期范围区块；客户档案卡片需要在联系人下方显示存瓶数和每个瓶号。
- 处理：
  - 为 `销售记录`、`灌装记录`、`天然气入库`、`理论损耗统计` 四页的快捷日期滑块补上即时查询逻辑，点击 `今日/本周/本月` 会立刻刷新卡片和列表，而不只是改日期字段。
  - 在 `客户对账` 页的 `经营分析` 与 `账务流水` 区块新增同样位置的 `AppDatePresetBar`，并在点击快捷日期后分别触发经营分析查询和流水查询。
  - `crm-customer.listV1` 返回当前客户的 `deposit_bottle_nos`，客户档案列表卡片改成在联系人下方显示 `存瓶 X` 和全部瓶号串，不再只显示一个统计标签。
- 改动文件：
  - `src/components/domain/sale/SaleListView.vue`
  - `src/components/domain/filling/FillingListView.vue`
  - `src/components/domain/gasIn/GasInListView.vue`
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `npm run build:h5`
  - `npm run build:mp-alipay`

## 2026-03-30 01:05 钢瓶当前归属批量重建脚本

- 背景：用户要求把钢瓶当前状态和“在谁家”的归属批量更新，并要求写一个脚本来辅助执行。
- 处理：
  - 在 `crm-bottle` 新增 `rebuildCurrentStatusV1`，按 `crm_bottle_movements` 的既有业务排序口径重建钢瓶当前归属。
  - 重建规则：
    - 最新有效事件是 `out`：写为 `at_customer`，并回填 `current_customer_id/current_customer_name`
    - 最新有效事件是 `back/fill`：写为 `in_station`
    - 无有效事件：写为 `unknown`
  - 默认跳过：
    - `TRUCK-*`、`000` 这类伪瓶号
    - `scrapped/lost` 特殊状态钢瓶
    - 同日 `back+out` 尚未解歧的钢瓶
  - 新增脚本 `scripts/rebuildBottleCurrentStatus.cjs`，支持：
    - 全量或按瓶号执行
    - `preview` 预览
    - `--execute` 真正写库
    - 分批调用云函数，避免单次云函数超时
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `scripts/rebuildBottleCurrentStatus.cjs`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `node --check scripts/rebuildBottleCurrentStatus.cjs`

## 2026-03-30 09:42 钢瓶当前归属线上批量重建已执行

- 背景：本地脚本与云端 action 已完成后，用户要求直接把线上钢瓶“当前状态/在谁家”批量更新到位。
- 处理：
  - 修复 `crm-bottle.rebuildCurrentStatusV1` 运行时缺失的 `normalizeEventDay()`。
  - 通过 HBuilder CLI 重新上传 `crm-bottle` 云函数。
  - 使用 `scripts/rebuildBottleCurrentStatus.cjs --execute` 执行线上批量重建。
  - 执行结果：
    - `target_total=1107`
    - `updated_total=841`
    - `changed_total=841`
    - `unchanged_total=256`
    - `no_movement_total=315`
    - `pending_same_day_total=1`
    - `skipped_pseudo_total=9`
- 结果文件：
  - `docs/bottle_current_status_rebuild.execute.json`
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `scripts/rebuildBottleCurrentStatus.cjs`
  - `docs/bottle_current_status_rebuild.execute.json`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - 线上脚本执行成功，返回 `ok=true`

## 2026-03-30 10:18 销售与灌装写入后实时同步钢瓶当前状态

- 背景：用户要求补上“实时同步瓶状态”，避免后续销售/灌装继续写 `crm_bottle_movements` 但不更新 `crm_bottles.status/current_customer_*`，导致还要再次跑批量重建。
- 处理：
  - 在 `crm-sale` 内新增按受影响瓶号即时重算当前状态的 helper，复用当前 movement 流转语义：
    - `createV2`
    - `updateV2`
    - `removeV2`
    - `backfillAgentSaleBottleMovementsV1`
    在写完销售 movement 后即时回写 `crm_bottles`。
  - 在 `crm-filling` 内新增同样的即时重算 helper，并接入：
    - `createV1`
    - `updateV1`
    - `removeV1`
    - `batchCreateV1`
    - `batchUpdateDateV1`
    - `normalizeDatesV1`
  - 同步规则：
    - 最新有效事件为 `out`：更新为在客户，并回填 `current_customer_id/current_customer_name`
    - 最新有效事件为 `back/fill`：更新为在站
    - `TRUCK-*`、`000` 等伪瓶号默认跳过
    - 同日 `back+out` 尚未解歧的钢瓶跳过，避免错误覆盖
  - 销售/灌装日志与返回结果补充：
    - `bottle_status_updated_total`
    - `bottle_status_skipped_pending_total`
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`

## 2026-03-30 11:10 钢瓶档案重复清洗（线上执行）

- 背景：用户反馈 `crm_bottles` 中存在大量重复档案，要求直接线上清洗；本批重复主要来自 `imp0314_*` 导入副本。
- 处理：
  - 在 `crm-bottle.cleanupDuplicatesV1` 中实现按 `bottle_no` 归并清洗：
    - 规范化 `bottle_no` 后分组；
    - 以销售引用数、状态优先级、档案完整度、更新时间选主档；
    - 将重复档案缺失字段合并到主档；
    - 如有 `crm_sale_records.*.bottle_id` 指向副本则改写到主档；
    - 删除重复副本后，对受影响瓶号即时重建当前状态。
  - 新增线上执行脚本：
    - `scripts/cleanupDuplicateBottles.cjs`
  - 首次正式执行发现线上缺少 `crm_bottles_import_backups` 集合，补丁改为“备份集合缺失只记日志、不阻断清洗”后重新上传并执行。
- 线上执行结果：
  - 预览：`duplicate_group_total=133`、`duplicate_row_total=133`、`sale_row_rewrite_total=0`
  - 正式执行：删除 `133` 条重复副本，主档合并更新 `133` 条，钢瓶状态重建变更 `16` 条
  - 备份集合缺失：`bottle_remove` 与 `canonical_before` 均安全跳过，不影响清洗完成
  - 执行后复查：`duplicate_group_total=0`、`duplicate_row_total=0`
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `scripts/cleanupDuplicateBottles.cjs`
  - `docs/bottle_duplicate_cleanup.preview.json`
  - `docs/bottle_duplicate_cleanup.execute.json`
  - `docs/bottle_duplicate_cleanup.after_preview.json`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `node --check scripts/cleanupDuplicateBottles.cjs`
  - 线上预览执行成功
  - 线上正式清洗执行成功
  - 线上复查归零

## 2026-03-30 15:35 历史销售单改瓶号后存瓶残留修复

- 背景：用户反馈编辑历史销售单把瓶号从 `43` 更正为 `45` 后，客户存瓶清单仍出现 `43+45` 共存。
- 根因：
  - 销售单实时瓶状态同步的受影响瓶号集合此前未纳入 `deposit_rows`；
  - 仅按 movement 重算后，部分“存瓶行调整”场景仍可能残留旧客户归属。
- 修复：
  - `collectSaleBottleNosFromDoc` 补充 `deposit_rows`；
  - `ensureBottlesExist` 补充 `depositRows` 入参，避免存瓶行出现“目标瓶不存在不参与同步”；
  - `buildCustomerDepositBottleSet` 调整为：`deposit_rows` 仅在“无出/回瓶行的纯存瓶补录单”参与存瓶快照，避免“出瓶改号后旧存瓶行残留”导致双瓶并存；
  - `updateV2` 新增“历史单自动同步存瓶行”兜底：当历史单原本是“出瓶=存瓶”且本次未手工改存瓶行、仅改了出瓶瓶号时，自动将 `deposit_rows` 同步为最新 `out_items`；
  - 新增 `reconcileBottleCurrentCustomerByDepositSnapshot`：
    - 在 `createV2 / updateV2 / removeV2` 后，对“受影响客户 + 受影响瓶号”按销售单存瓶口径做归属纠偏；
    - 只修正 `current_customer_*` 与 `status=at_customer/unknown` 的错挂，不改业务流水。
  - 日志新增纠偏统计字段：
    - `bottle_status_deposit_reconciled_total`
    - `bottle_status_deposit_forced_total`
    - `bottle_status_deposit_cleared_total`
    - `bottle_status_deposit_conflict_total`
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`

## 2026-03-30 16:05 销售编辑页联想重叠/皮重残留/保存按钮位置修复

- 背景：用户反馈销售编辑存在三类问题：
  - 瓶号联想下拉覆盖下一行输入区域；
  - 同行改瓶号时皮重沿用旧瓶（如 `275 -> 375` 后仍显示旧皮重）；
  - 保存按钮在顶栏，不便于长表单末尾提交。
- 修复：
  - `SaleBottleLinesCard.vue`
    - 瓶号联想面板改为文档流内展示（不再 absolute 悬浮覆盖下一行）；
    - `selectSuggestion` 改为“新瓶号命中即覆盖皮重”，并在新瓶无皮重时清空旧皮重；
    - `onBottleConfirm` 增加“精确瓶号自动匹配联想并回填”逻辑，避免仅回填瓶号不回填皮重。
  - `SaleDepositCard.vue`
    - 同步调整联想面板展示方式与 `onBottleConfirm` 精确匹配回填逻辑，避免同类重叠问题复现。
  - `SaleEditView.vue`
    - 将“保存并提交”从页头移至页面内容最底部操作区；
    - 保留取消按钮，并在小屏下改为纵向按钮布局。
- 改动文件：
  - `src/components/domain/sale/SaleBottleLinesCard.vue`
  - `src/components/domain/sale/SaleDepositCard.vue`
  - `src/components/domain/sale/SaleEditView.vue`
- 验证：
  - `npm run build:h5`

## 2026-03-30 16:42 销售改单存瓶未同步根因修复 + 张翠欣皮厂定向修复

- 用户复现：`张翠欣皮厂 2026-03-27` 历史单重保存后，`out_items` 已是 `45/143`，但 `deposit_rows` 仍残留 `43/143`。
- 根因定位：
  - `updateV2` 中“出瓶改号自动同步存瓶行”逻辑未实际生效；
  - 该逻辑误放到了 `createV2`，并引用了未定义变量 `existing`，导致修复未命中且存在潜在创建崩溃风险。
- 修复：
  - `crm-sale/index.js`
    - 移除 `createV2` 中误放的自动同步分支；
    - 在 `updateV2` 恢复并启用自动同步：
      - 当本次未手工改 `deposit_rows`（与历史一致）且 `deposit_rows` 与本次 `out_items` 不一致时，自动按 `out_items` 重建 `deposit_rows`；
    - `depositRows` 改为 `let` 以支持自动重建回写。
  - 销售编辑输入补强：
    - `SaleBottleLinesCard.vue`
      - 同行改瓶号时立刻清空旧皮重/净重（净重仅在非手填模式下清空）；
      - 失焦时自动执行精确匹配确认，回填新瓶皮重；
      - 联想面板改为“行内撑高 + 绝对层展示”组合，避免压住下一行；
    - `SaleDepositCard.vue`
      - 同步失焦精确匹配与联想面板撑高机制，避免重叠复现。
- 云端定向修复执行：
  - 脚本：`scripts/repairSaleDepositFromOut.cjs`
  - 目标单：`69c8afca59063e84c13ec7bd`（张翠欣皮厂，2026-03-27）
  - 修复前：`deposit_bottle_nos=[43,143]`
  - 修复后：`deposit_bottle_nos=[45,143]`
  - 复查文件：
    - `docs/sale_repair_zhangcuixin_20260327.latest.json`
    - `docs/sale_probe_zhangcuixin_20260327.latest.json`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `npm run build:h5`

## 2026-03-30 18:18 灌装总重推导“已回瓶但提示找不到依据”修复

- 背景：用户反馈灌装总重模式下，瓶号 `368` 提示“未找到最近回瓶总重”，但该瓶实际已有多条回瓶记录。
- 复现与定位：
  - 云端复现：`crm-filling.resolveFillWeightV1` 对 `368` 返回 `code=400`。
  - 取数核查显示 `368` 最近回瓶（`2026-03-28`）在销售单 `back_items` 中存在且包含 `gross/tare/net`。
  - 根因是总重推导只依赖 `crm_sale_records` 的嵌套条件命中，旧/混合数据形态下存在漏匹配，导致依据丢失。
- 修复：
  - `findLatestBackBasisByBottleNo` 改为三段式查找（按可靠性降级）：
    1. **优先按 `crm_bottle_movements` 的 `back + sale` 事件反查销售单**，再从 `back_items` 取 `gross` 或 `tare+net`。
    2. 再走销售单嵌套条件查询（并补充纯数字瓶号的 number/string 双候选）。
    3. 最后按最近有回瓶行的销售单兜底扫描（限量）并做规范化比对。
  - 新增内部辅助函数：
    - `buildBackBottleWhereCandidates`
    - `fetchSaleDocsByIds`
    - `pickBasisFromSaleDocByBottleNo`
    - `findLatestBackBasisByBottleNoFromMovements`
    - `findLatestBackBasisByBottleNoFromSales`
    - `findLatestBackBasisByBottleNoByRecentScan`
  - 新增诊断脚本：
    - `scripts/probeFillBasisByBottle.cjs`（可抓取 resolve 结果 + 对应回瓶源单原始字段）。
- 改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `scripts/probeFillBasisByBottle.cjs`
  - `docs/fill_basis_probe_368_20260330.json`
  - `docs/fill_basis_probe_45_20260330.json`
- 验证：
  - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `node --check scripts/probeFillBasisByBottle.cjs`
  - 线上探针确认 bug 复现与数据依据存在（修复前基线）。

## 2026-03-30 15:08 H5 发布缓存兜底（版本探针 + 构建产物标记）

- 背景：
  - 用户出现“代码已改但前端网页仍是旧效果”，强刷后恢复，属于典型浏览器命中旧 `index.html` 缓存。
  - 排查发现当前 `npm run build:h5` 主产物在 `dist/build/h5`，旧目录 `dist/build/web` 可能残留历史包。
- 修复：
  - 新增 `src/services/h5VersionGuard.js`：
    - H5 生产环境在 `onLaunch/onShow` 拉取 `/version.json`（`no-store`）；
    - 对比当前入口脚本与远端入口脚本，不一致时自动一次性强制刷新（带 `__h5v` 标记防循环）。
  - `src/App.vue` 接入 `ensureLatestH5Bundle`，在鉴权前先做版本自检。
  - 新增 `scripts/writeH5Version.cjs`，构建后自动生成 `version.json`：
    - 自动识别并写入 `dist/build/h5`（主）；
    - 若存在 `dist/build/web` 也同步写入，兼容历史发布习惯。
  - `package.json` 增加 `postbuild:h5` 自动执行版本文件生成。
  - `index.html` 增加 no-cache meta（辅助手段）。
- 改动文件：
  - `src/services/h5VersionGuard.js`
  - `src/App.vue`
  - `scripts/writeH5Version.cjs`
  - `package.json`
  - `index.html`
- 验证：
  - `npm run build:h5`
  - 产物确认：
    - `dist/build/h5/version.json` 已生成，入口指向当前 `index-*.js`
    - H5 主包时间戳更新：`dist/build/h5/assets/index-*.js`

## 2026-03-31 费用收款与记账链路收敛（payment_method 全链路 + 凭证分录修正）

- 做了什么：
  - 前端销售结算与客户对账补齐“收款方式（挂账/现金/转账/微信/支付宝）”输入，并接入服务层请求参数，避免收费链路丢字段。
  - 销售云函数 `crm-sale` 在 `createV2/updateV2/quickReceiveV1` 中统一校验并落库 `payment_method`，并把回款登记同步到客户结算引擎。
  - 记账分录修正：`syncSaleVoucher` 改为按 `payment_method` 选择借方科目（1001/1002/1002-WECHAT/1002-ALIPAY），不再将实收一律计入应收账款。
  - 客户结算云函数 `crm-customer-settlement` 收款单落库补齐 `payment_method`，并在账务流水返回中透出，前端流水详情可直接看到收款方式。
- 改动文件列表：
  - `src/services/models/settlement.js`
  - `src/services/models/index.js`
  - `src/services/models/sale.js`
  - `src/services/sale.js`
  - `src/composables/useSaleSettlement.js`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/services/customerSettlement.js`
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 历史销售/收款数据存在 `payment_method` 为空的旧记录，当前改动只保证新写入链路一致；如需历史补齐，建议增加 dry-run + execute 的批量回填 action（按 `payment_status/amount_received` 推断并产出审计报告）。

## 2026-03-31 收款区间分配 + 支票方式 + 骏驰机械单据修复

- 做了什么：
  - 客户结算引擎改为强制区间分配（`allocation_mode=period`），`previewAllocationV1/createReceiptV1/confirmAllocationV1` 全部要求 `allocation_start_date/allocation_end_date`，不再默认“最早欠款优先”。
  - 收款与分配落库新增区间审计字段：`allocation_mode/allocation_start_date/allocation_end_date`（收款单与分配明细均透出到账务流水 meta）。
  - 新增 `repairReceiptAllocationV1`（dry-run/execute）用于“回滚原分配 -> 按新区间重分配 -> 可选修正收款方式”。
  - 全链路补齐 `payment_method=check`（支票）：前端收款方式选项、前后端归一化、会计科目映射 `1002-CHECK`。
  - 销售详情快捷回款入口与客户对账入口统一为区间分配参数透传。
  - 已执行骏驰机械样本修复：`receipt_id=69c9ea38836c2b0268862bc9`，区间 `2026-02-01~2026-03-20`，收款方式 `cash -> wechat`。
- 关键改动文件：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `src/components/domain/customer/CustomerStatementView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/services/customerSettlement.js`
  - `src/services/sale.js`
  - `src/services/models/settlement.js`
  - `src/services/mappers/legacyImport/convertLegacyExport.cjs`
  - `uniCloud-alipay/database/crm_customer_receipts.schema.json`
  - `uniCloud-alipay/database/crm_customer_allocations.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_receipts.schema.json`
  - `uniCloud-alipay/database/schema/crm_customer_allocations.schema.json`
  - `docs/ACCOUNTING.md`
- 验证：
  - 语法：
    - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
    - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - 构建：
    - `npm run build:h5`（通过）
    - `npm run build:mp-alipay`（通过）
  - 云端修复：
    - dry-run 结果：`/tmp/junchi_receipt_repair_preview.json`（`code=0`，`next_allocations_count=12`，`payment_method_before=cash`，`payment_method_after=wechat`）
    - execute 结果：`/tmp/junchi_receipt_repair_execute.json`（`code=0`，`success_count=1`，`rollback_total=19446`，`applied.allocated_total=19446`）
    - 修复后复核：`/tmp/junchi_receipt_probe_after_repair.json`（收款方式为 `wechat`，分配日期落在 `2026-02-04~2026-03-20`）
- 剩余问题：
  - 当前历史批量修复仍以“显式 items 入参”执行，适合小范围精准修复；后续若要全客户批量治理，建议增加批处理编排与分批回滚点。

### 2026-04-01 CURRENT — 流量金额三位截断修复（3384.115 保存精度）
- 做了什么：
  - 修复 `crm-customer-settlement` 流量客户金额精度链路：流量金额统一按三位小数截断（不四舍五入），并补齐 `create/update flow settlement`、`create/update receipt`、`create prepay`、`confirm allocation`、`autoApplyPrepayToFlowSettlement` 的三位精度与状态判断。
  - 修复流量客户对账接口输出精度：`getCustomerStatementV1`、`listCustomerStatementRowsV1`、`exportCustomerStatementV1` 的收款/分配/余额金额按客户计价口径返回（m3 为三位）。
  - 修复前端 `CustomerStatementModule` 金额格式化浮点误差：改为基于字符串+BigInt 的固定小数截断显示与输入规范化，避免 `3384.115` 被显示/提交为 `3384.110` 之类误差。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js` 通过。
  - `npm run build:h5` 通过。
  - `npm run build:mp-alipay` 通过。
- 剩余问题：
  - 需在云端部署最新 `crm-customer-settlement` 后，用流量客户实测 `3384.115` 录入、保存、回显与再次编辑全链路一致性。

### 2026-04-01 CURRENT — 修复销售列表顶部卡片与导出统计口径不一致
- 做了什么：
  - 核实销售列表顶部卡片汇总逻辑 `computeSaleListSummary` 与导出行口径，发现汇总扫描字段缺失。
  - 在 `crm-sale` 汇总查询的字段投影中补齐 `settlement_mode`、`truck_out_gross`、`truck_back_gross`、`truck_settle_tare`、`truck_settle_gross`，确保与列表/导出使用的 `buildSaleListRow + computeSaleAmountsForDoc` 计算输入一致。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js` 通过。
- 剩余问题：
  - 需部署 `crm-sale` 后按你给的区间（`2026-03-01` 到 `2026-03-31`）复测：顶部卡片与导出汇总是否一致。

### 2026-04-01 CURRENT — 客户对账导出功能补齐（H5 + 小程序）
- 做了什么：
  - 在客户对账导出工具中新增跨端导出能力：H5 维持浏览器下载；非 H5（含 uni 小程序端）改为写入本地文件并尝试 `openDocument` 打开。
  - 对账页导出按钮调用从 `downloadWorkbookOnH5` 切换为统一 `downloadWorkbookFile`，避免小程序端点击导出无效。
- 改动文件列表：
  - `src/components/domain/customer/statement/exportWorkbook.js`
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check src/components/domain/customer/statement/exportWorkbook.js` 通过。
  - `npm run build:h5` 通过。
  - `npm run build:mp-alipay` 通过。
- 剩余问题：
  - 需在支付宝小程序真机或开发者工具实测导出后的文档打开链路（`openDocument` 受端侧能力与文件类型支持影响）。

### 2026-04-02 CURRENT — 前端隐藏客户档案入口（保留客户对账）
- 做了什么：
  - 工作台导航中移除“客户档案”入口（侧边主导航 + 业务管理宫格），保留“客户对账”入口（`/pages/customer/list?scene=statement`）。
  - 浮动导航菜单中移除“客户档案”入口，其他快捷入口不变。
  - 未修改客户对账页面、客户结算服务、云函数和 ACL，仅做前端入口可见性调整。
- 改动文件列表：
  - `src/components/domain/dashboard/DashboardHome.vue`
  - `src/components/base/AppFloatNav.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 当前仅隐藏入口，`/pages/customer/list` 路由仍可直接访问（符合“隐藏入口不去耦后端依赖”的预期）。

### 2026-04-02 CURRENT — 客户对账页导出入口增强（头部直达 + 默认区间）
- 做了什么：
  - 在客户对账页头部动作区新增“导出对账单”按钮，和原账务流水区导出逻辑复用同一 `onExportStatement`。
  - 新增 `syncRowsFilterDefaults`：当账务流水日期为空时，自动初始化为“当月起止”，避免首次导出被“请先选择日期”拦截。
  - 在 `refreshAll` 中先执行账务流水日期默认同步，再加载流水与分析数据。
- 改动文件列表：
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 导出仍依赖当前筛选区间；如需“一键全历史导出”，需单独定义大范围导出策略与性能上限。

### 2026-04-02 CURRENT — 客户对账导出入口去重（仅保留顶部按钮）
- 做了什么：
  - 移除“账务流水”分区 actions 内的“导出对账单”按钮，避免与页面顶部导出按钮重复。
  - 保留顶部导出按钮与现有导出逻辑（`onExportStatement`）不变。
- 改动文件列表：
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 目前“共 N 条”仍在账务流水区显示，导出入口统一为顶部；如后续需要，可再将统计文案移到顶部统一展示。

### 2026-04-02 CURRENT — 客户列表新增“总分”导出（总览汇总 + 客户明细）
- 做了什么：
  - 客户列表页头部新增“导出”按钮（默认模式与 `scene=statement` 模式均可见），导出范围为当前筛选条件下的全量分页数据。
  - 新增客户列表导出工作簿构建器，输出 SpreadsheetML 双 Sheet：`总览汇总` + `客户明细`。
  - 导出下载复用现有 `downloadWorkbookFile` 跨端能力（H5 下载、uni 端写文件+尝试打开）。
- 改动文件列表：
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/customer/exportCustomerListWorkbook.js`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 导出使用前端分页聚合，超大客户量下导出耗时会随页数增长；如后续数据规模继续扩大，可评估云端异步导出任务。

### 2026-04-02 CURRENT — 客户对账入口筛选增强（余额方向 + 定价状态）
- 做了什么：
  - 在 `pages/customer/list?scene=statement` 的筛选区新增两个条件：`余额方向`（全部/应收欠款/预付余额）、`定价状态`（全部/已设单价/未设单价）。
  - 前端查询参数打通：`listCustomersV1` 新增透传 `balance_type`、`pricing_type`，并纳入列表缓存键与导出口径说明。
  - 后端 `crm-customer.listV1` 新增对应 where 条件，确保筛选在服务端真实生效（非前端本地假筛选）。
  - 客户列表导出（总览汇总/文件名）补充余额方向与定价状态标签，保证导出口径可追溯。
- 改动文件列表：
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/customer/exportCustomerListWorkbook.js`
  - `src/services/customer.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 若线上未部署最新 `crm-customer` 云函数，`balance_type/pricing_type` 会被忽略，界面仍可用但筛选口径不会生效。

### 2026-04-02 CURRENT — 客户对账筛选二次调整（新增已结清 + 时间范围，移除定价状态）
- 做了什么：
  - 按最新口径调整 `pages/customer/list?scene=statement`：`余额方向` 新增 `已结清`，并移除 `定价状态` 筛选项。
  - 新增 `更新时间从/至` 日期筛选（仅 statement 模式可见），前端支持开始/结束日期互换纠正，避免反向区间造成空结果。
  - 服务层改为透传 `updated_date_start/updated_date_end`，并移除 `pricing_type` 透传。
  - `crm-customer.listV1` 新增：
    - `balance_type=settled`（`net_balance` 近零区间）
    - `updated_at` 时间范围过滤（支持仅开始、仅结束、起止区间）
  - 客户列表导出总览与文件名口径同步更新：移除“定价状态”，新增“更新时间范围”。
- 改动文件列表：
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/customer/exportCustomerListWorkbook.js`
  - `src/services/customer.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 线上若仍是旧版 `crm-customer`，时间范围与“已结清”筛选不会生效；需同步部署云函数。

### 2026-04-02 CURRENT — 修复瓶子查询浮窗/入口右侧拖拽边界过宽
- 做了什么：
  - 调整 `AppBottleQueryFloat` 拖拽边界算法：触发按钮与查询面板统一走 `clampTriggerPosition/clampPanelPosition`，减少硬编码边距造成的右侧不可达区域。
  - 视口尺寸改为优先读取 H5 实时可视区（`visualViewport/innerWidth/clientWidth`），并在 `window resize` 与 `visualViewport resize` 时重算约束并回收位置，避免页面尺寸变化后边界失真。
  - 保留原有拖拽交互与点击防误触逻辑，不改查询业务逻辑。
- 改动文件列表：
  - `src/components/base/AppBottleQueryFloat.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
- 剩余问题：
  - 需你在实际设备/端侧拖拽复测；若某端仍有安全区偏差，再按端侧单独校准边界预留。

### 2026-04-02 CURRENT — 理论损耗统计优化（近7天首屏 + 本月后台预取 + 异常TOP/抽屉）
- 做了什么：
  - `pages/bottle/loss` 首屏改为自动查询：页面挂载后默认填充滚动近7天（含当天）并触发查询，不再需要先点“刷新”。
  - 查询链路拆分为主次两段：先拉 `cycleLossV1` 渲染周期明细，再异步拉 `lossStatsV1` 修复差值，降低首屏可见等待；分页切换仅刷新周期明细，不再重复请求修复统计。
  - 新增“异常TOP”区块：`单次异常TOP` + `瓶号累计异常TOP`，首屏各展示 5 条，均按当前筛选口径计算。
  - 新增“查看全部”同页抽屉：支持两个 Tab（单次异常/瓶号累计）和分页翻页，避免跳转页面。
  - 新增本月后台预取（偷偷加载）：在默认条件（无瓶号/客户、近7天默认筛选）查询成功后，后台异步预取本月全分页周期/修复/TOP并缓存（TTL）；切到“本月”优先命中缓存秒开。
  - 云函数 `crm-bottle-movement` 新增 action `lossAnomalyRankV1`，统一汇总周期异常 + 修复差值，返回 `top_single`、`top_bottle` 及分页列表。
  - 前端服务 `src/services/bottleMovement.js` 新增 `getBottleLossAnomalyRankV1` 封装。
  - `crm_bottle_movements` schema 新增两条复合索引：
    - `type + event_day + event_at + created_at`
    - `type + source_type + event_day + event_at + created_at`
- 改动文件列表：
  - `src/components/domain/bottle/BottleLossView.vue`
  - `src/services/bottleMovement.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/database/schema/crm_bottle_movements.schema.json`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 本月“偷偷预取”走前端分页聚合，数据量特别大时仍会有后台请求成本，但已限制在本月范围并加 TTL 缓存。
  - 新增索引需线上同步发布后，范围查询性能收益才会完全体现。

### 2026-04-03 CURRENT — 销售冲抵改为“手工入池 + 客户对账手工分配”
- 做了什么：
  - 销售侧新增并落库 `offset_enabled`，新建默认 `false`；编辑历史单据（缺字段）前端按 `true` 回显兼容旧口径。
  - 销售保存后不再让冲抵款自动冲销：`repairOffsetCreditsV1` 明确 `auto_apply=false`，`autoApplyPrepayToSaleV1` 在销售链路改为 `exclude_offset_credit=true`（仅保留普通预付自动分配）。
  - 销售更新增加保护：当冲抵来源已存在已分配记录时，禁止将 `offset_enabled` 从开启改为关闭，并返回明确提示。
  - 客户对账页新增独立“冲抵分配”区：来源池分页、单笔来源选择、本次冲抵金额、勾选目标（销售/流量/历史欠款）与提交分配。
  - 销售编辑/详情/客户对账文案同步改为“手工分配”口径，去除“自动用于后续结算”表述。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/database/schema/crm_sale_records.schema.json`
  - `src/services/models/sale.js`
  - `src/services/sale.js`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleDetailView.vue`
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - `offset_enabled` 为新增字段，线上若未同步发布 `crm_sale_records` schema，可能出现落库校验不通过；需同时发布 schema 与云函数。

### 2026-04-22 CURRENT — 监管平台独立云空间一期落地（链路 + 剥离就绪）
- 做了什么：
  - 新增监管接收云函数 `crm-reg-ingest`，实现 `ingestSnapshotV1/ingestEventV1/healthV1/verifyStatsV1`：验签（`HMAC-SHA256` + 版本头）、时间窗校验、幂等去重、快照 upsert、事件追加、重复投递识别、拒绝日志与死信落库。
  - 站点桥接 `crm-reg-bridge` 补齐剥离约束：签名版本头固定、`station_id` 入队强校验、环境变量配置边界强化。
  - 在 `crm-bottle/crm-filling/crm-sale` 成功写入后接入监管异步入队（失败仅 warning，不阻塞主业务提交）；`crm-bottle` 同步新增 `backfillRegFieldsV1`（`execute=false/true`）用于 `station_id/gas_medium_code` 回填。
  - 新增监管文档与剥离演练：仅监管模块部署清单、剥离手册、最小复制演练脚本 `scripts/reg/extractRegModuleDryRun.cjs` 并完成一次演练报告输出。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-reg-bridge/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-reg-ingest/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_outbox.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_push_logs.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_dead_letters.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_station_registry.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_bottle_current.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_bottle_events.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_ingest_dedup.schema.json`
  - `uniCloud-alipay/database/schema/crm_reg_ingest_logs.schema.json`
  - `docs/regulatory/reg-space-phase1-checklist.md`
  - `docs/regulatory/reg-module-extraction-manual.md`
  - `scripts/reg/extractRegModuleDryRun.cjs`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-reg-bridge/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-reg-ingest/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - `node --check scripts/reg/extractRegModuleDryRun.cjs`（通过）
  - `node scripts/reg/extractRegModuleDryRun.cjs --cwd=/Users/wangbo/Downloads/2026_v4`（通过，报告：`/var/folders/7k/hs5s75sn2kg1dy4v5j61zvwc0000gn/T/crm-reg-module-rehearsal-20260422141628/rehearsal-report.json`）
- 剩余问题：
  - 尚未在真实双空间执行端到端回归（`bootstrapSnapshotV1 preview/execute + dispatchOutboxV1 + verifyStatsV1`）；上线前需在目标 `space-id` 完成一次全链路验收。

### 2026-04-22 CURRENT — 监管一期运维脚本补充（终端直连桥接）
- 做了什么：
  - 新增 `scripts/reg/runRegBridgeAction.cjs`，支持在终端直接调用 `crm-reg-bridge` 的运维动作（派发、重放、统计、基线），不依赖站点业务页面。
  - 更新监管文档，补充脚本调用示例与运维章节。
- 改动文件列表：
  - `scripts/reg/runRegBridgeAction.cjs`
  - `docs/regulatory/reg-space-phase1-checklist.md`
  - `docs/regulatory/reg-module-extraction-manual.md`
  - `STATE.md`
- 验证输出要点：
  - `node --check scripts/reg/runRegBridgeAction.cjs`（通过）
- 剩余问题：
  - 运维脚本依赖本机已配置目标 `space-id` 的 HBuilderX 项目密钥；新机器需先完成密钥配置再执行。

### 2026-04-22 CURRENT — 监管字段回填分页稳定性修正
- 做了什么：
  - 修正 `crm-bottle.backfillRegFieldsV1` 的分页排序口径：由 `updated_at` 改为 `created_at`，避免执行态更新 `updated_at` 导致分页重排、漏扫或重复扫描。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`（通过）
- 剩余问题：
  - 无。
### 2026-04-17 CURRENT — PDA 安卓壳 V1（无硬件首版）
- 做了什么：
  - 新增 `pda_operator` 角色模板、PDA 页面 ACL 注册与 `crm-bottle/crm-bottle-movement/crm-customer/crm-filling/crm-sale` 的 PDA 页面 action 放行，`pda_operator` 登录后直达 `/pages/pda/home`，`index` 页冷启动也会重定向到 PDA 首页。
  - 新增 PDA 前端壳：`/pages/pda/home`、`/pages/pda/bottle-query`、`/pages/pda/movement-query`、`/pages/pda/customer-query`、`/pages/pda/filling-create`、`/pages/pda/sale-create`，并把灌装/销售映射、客户搜索、钢瓶补空瓶重、存瓶预览下沉到 `src/services/pda/**` 与 `src/composables/pda/**`。
  - PDA 销售录入固定为 `bizMode='bottle' + priceUnit='kg' + unpaid/on_account`；客户单价来自客户档案默认 `kg` 单价，提交前会调用 `getCustomerDepositV1` 自动生成只读存瓶预览后再回传 `createSaleV2`。
- 改动文件列表：
  - `src/components/domain/pda/PdaHomeView.vue`
  - `src/components/domain/pda/PdaBottleQueryView.vue`
  - `src/components/domain/pda/PdaMovementQueryView.vue`
  - `src/components/domain/pda/PdaCustomerQueryView.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/composables/pda/usePdaFillingForm.js`
  - `src/composables/pda/usePdaSaleForm.js`
  - `src/pages/pda/home.vue`
  - `src/pages/pda/bottle-query.vue`
  - `src/pages/pda/movement-query.vue`
  - `src/pages/pda/customer-query.vue`
  - `src/pages/pda/filling-create.vue`
  - `src/pages/pda/sale-create.vue`
  - `src/services/pda/shared.js`
  - `src/services/pda/entry.js`
  - `src/services/pda/bottle.js`
  - `src/services/pda/customer.js`
  - `src/services/pda/filling.js`
  - `src/services/pda/sale.js`
  - `src/pages.json`
  - `src/pages/index/index.vue`
  - `src/pages/login/login.vue`
  - `src/services/pageAclRegistry.js`
  - `src/components/domain/user/UserListView.vue`
  - `uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`
  - `uniCloud-alipay/cloudfunctions/crm-auth/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-auth/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-user/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle-movement/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-filling/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-sale/pageAclRegistryLocal.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle-movement/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这版仍是“无硬件首版”，扫码头、蓝牙秤、原生插件和 Android 真机串口/蓝牙联调还未开始。
  - `admin/superadmin` 虽保留 PDA 页面权限用于测试，但桌面工作台暂未新增 PDA 导航入口；当前主入口仍是 `pda_operator` 登录直达或手工访问 PDA 路由。

### 2026-04-17 CURRENT — PDA 专机入口 + 销售分步流 + 自动存瓶预览
- 做了什么：
  - 将 `app-plus` 入口改为 PDA 专机模式：登录成功与 App 冷启动后的首选首页都走 PDA 首页，不再依赖 `pda_operator` 角色才进入 PDA；同时 `index` 页在专机模式下默认隐藏桌面工作台，减少冷启动闪原首页。
  - 将 PDA 销售录入页改为 3 步流：`客户/基础信息 -> 出回瓶明细 -> 预览提交`，缩短单屏操作路径，减少现场来回滚动。
  - 将 PDA 销售的存瓶预览改为自动防抖刷新：客户、日期、出瓶或回瓶变化后自动刷新，进入预览步前再强制刷新一次，提交时仍保留最终校验。
- 改动文件列表：
  - `src/App.vue`
  - `src/pages/index/index.vue`
  - `src/services/pda/entry.js`
  - `src/composables/pda/usePdaSaleForm.js`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 目前“专机入口化”是前端入口层实现，尚未拆成独立 Android 包配置；如果后续同一 `app-plus` 还要兼顾桌面风格移动端，需要再加显式运行模式开关。
  - 自动存瓶预览仍依赖实时云函数请求，弱网环境下会有等待；下一步若现场网络不稳，应补本地草稿与提交幂等控制。

### 2026-04-17 CURRENT — PDA 客户/瓶号联想补齐
- 做了什么：
  - 新增 `usePdaSuggestions` 与 `PdaSuggestList`，统一处理 PDA 联想的 `200ms debounce`、`150ms` 失焦延迟、阈值控制和触控友好下拉列表。
  - 新增 `PdaBottleSuggestField`，复用现有钢瓶联想排序/去重逻辑，让灌装录入、销售出瓶、销售回瓶都支持“输入即联想”，并在回瓶选中钢瓶时自动补空瓶重与重算净重。
  - 将 PDA 销售客户选择改成自动联想，不再依赖“查询”按钮；客户改字后会立即清掉旧客户选择，避免旧客户与当前输入不一致。
- 改动文件列表：
  - `src/components/domain/pda/PdaSuggestList.vue`
  - `src/components/domain/pda/PdaBottleSuggestField.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/composables/pda/usePdaSuggestions.js`
  - `src/composables/pda/usePdaSaleForm.js`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这次只补了客户和瓶号联想，配送员、车牌号仍是普通输入。
  - 瓶号手工修改后目前只清 `bottleId`，如果现场需要更强的防错，还可以继续补“切换瓶号时同步清理旧空瓶重/净重”的保护。

### 2026-04-17 CURRENT — PDA 扫码/OCR 自动录单 V1（`qr_code` 主路径）
- 做了什么：
  - 为钢瓶、客户、配送员、车辆补齐 `qr_code` 接入链路：维护页新增/显示二维码字段，列表搜索扩到 `qr_code`，云函数新增 `resolveQrCodeV1`（钢瓶另增 `resolveBottleNoV1`），并在服务端 create/update 阶段补了二维码重复校验。
  - 新增 `src/services/pda/capture/index.js`，以 `app-plus + Native.js` 包装优博讯 `ScanManager` 的广播模式采集，对前端统一暴露 `scanCode/scanOcr/stopCapture/getScannerState`，默认按 `QRCODE + CODE128 + CODE39` 扫码，OCR 仍保留字段级确认后回填。
  - PDA 灌装页新增“扫瓶码 / 识别瓶号 / 识别总重 / 按总重换算”，销售页新增客户、配送员、车辆扫码入口，以及出回瓶的扫码/OCR 回填；销售页的配送员/车辆无码兜底改为联想搜索，不走中文 OCR。
- 改动文件列表：
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/customer/CustomerEditView.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `src/components/domain/delivery/DeliveryEditView.vue`
  - `src/components/domain/delivery/DeliveryListView.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaLookupSuggestField.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/components/domain/vehicle/VehicleEditView.vue`
  - `src/components/domain/vehicle/VehicleListView.vue`
  - `src/composables/pda/usePdaFillingForm.js`
  - `src/composables/pda/usePdaSaleForm.js`
  - `src/services/bottle.js`
  - `src/services/customer.js`
  - `src/services/delivery.js`
  - `src/services/pda/bottle.js`
  - `src/services/pda/capture/index.js`
  - `src/services/pda/customer.js`
  - `src/services/pda/delivery.js`
  - `src/services/pda/filling.js`
  - `src/services/pda/shared.js`
  - `src/services/pda/vehicle.js`
  - `src/services/vehicle.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-delivery/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`
  - `uniCloud-alipay/database/schema/crm_customers.schema.json`
  - `uniCloud-alipay/database/schema/crm_delivery_men.schema.json`
  - `uniCloud-alipay/database/schema/crm_vehicles.schema.json`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-delivery/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-filling/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 本轮二维码唯一性先落在服务端校验与审计链路，数据库 schema 只补了 `qr_code` 索引，没有直接改成云端唯一索引；正式上线前仍需先做一次缺码/重码清洗，再决定是否升成数据库唯一索引。
  - `ScanManager` 的 OCR 目前按通用字段级模式接入，真实秤屏幕和瓶身字符的模板/曝光参数仍需在 `i6310Pro / Android 12` 真机上做一轮现场调参。
  - 工作区里还存在与本次 PDA 改动无关的预存改动：`src/components/domain/customer/CashierReceiptIntakeView.vue`、`src/components/domain/customer/statement/CustomerStatementModule.vue`、`uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`、`docs/scanner api 文档.docx`；本次未回滚或整理这些文件。

### 2026-04-17 CURRENT — 钢瓶 PDA 扫码切换到 `pda_qr_code`
- 做了什么：
  - 为 `crm_bottles` 新增 `pda_qr_code` schema 字段和索引，保留旧 `qr_code` 作为历史/档案字段，不再承担 PDA 钢瓶主扫码语义。
  - 将 `crm-bottle.resolveQrCodeV1`、PDA 前端钢瓶扫码服务和灌装/销售页钢瓶扫码确认文案统一切到 `pda_qr_code`，钢瓶扫码主链路不再用旧 `crm_bottles.qr_code` 命中。
  - 钢瓶维护页改成双码录入：新增 `PDA二维码号`，旧字段改名为 `原二维码号`；钢瓶列表导出和关键词搜索也补上了 `pda_qr_code`。
  - 服务端钢瓶唯一性审计扩到 `pda_qr_code`，便于上线前排查缺码/重码；旧 `qr_code` 审计保留，方便历史字段清洗。
- 改动文件列表：
  - `src/components/domain/bottle/BottleEditView.vue`
  - `src/components/domain/bottle/BottleListView.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/services/bottle.js`
  - `src/services/models/bottle.js`
  - `src/services/pda/bottle.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/database/schema/crm_bottles.schema.json`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 云端现有钢瓶数据不会自动生成 `pda_qr_code`；部署后需要给要扫码的钢瓶补录新字段，否则钢瓶扫码不会命中档案。
  - 这轮只切了钢瓶主扫码字段，客户/配送员/车辆仍继续使用各自现有 `qr_code` 字段。

### 2026-04-18 CURRENT — 优博讯扫码桥接恢复与广播校验修复
- 做了什么：
  - 重构 `src/services/pda/capture/index.js`，把扫码桥接改为“采集前快照原配置、采集后恢复原配置”的临时接管模式，不再在初始化阶段就把扫描头永久切到 `broadcast + HOST`。
  - 新增扫描头配置快照与恢复：读取并缓存 `getOutputMode()`、`getTriggerMode()`、`getParameterString(WEDGE_INTENT_ACTION_NAME / WEDGE_INTENT_DATA_STRING_TAG)`，并在成功、取消、超时、异常、页面离开、App 退后台时统一恢复。
  - 删除“只开 `QRCODE/CODE128/CODE39`”的收窄做法，改为保底覆盖 `QRCODE + CODE128 + CODE39 + EAN13 + UPCA + UPCE + UPCE1`，避免现场常见一维码被误伤。
  - 为广播配置增加读回校验和诊断状态：`switchOutputMode`、`setParameterString` 后读回当前 output/trigger/action/key；超时时会附带广播 action/key 与当前模式诊断，便于判断是“没读到码”还是“广播没收到”。
  - `App.vue` 的 `onHide`、`/pages/pda/filling-create` 和 `/pages/pda/sale-create` 的 `onHide/onUnload` 都接入了 `restoreScannerProfile()`，避免退出 PDA 页面后设备继续停留在广播模式。
- 改动文件列表：
  - `src/services/pda/capture/index.js`
  - `src/App.vue`
  - `src/pages/pda/filling-create.vue`
  - `src/pages/pda/sale-create.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮只修了扫码桥接的接管/恢复和广播校验，真实 `ScanManager` 广播是否会在 `i6310Pro / Android 12` 上稳定回调，仍需真机复测确认。
  - OCR 仍沿用当前通用参数，秤屏幕与瓶身字符模板的现场调参不在本轮内。

### 2026-04-18 CURRENT — 扫描头 `Triggering.HOST` 静态常量兼容修复
- 做了什么：
  - 修正 `src/services/pda/capture/index.js` 的静态常量获取方式，不再只依赖 `plus.android.getAttribute(className, fieldName)`。
  - 新增 `importClass + Java 反射` 兜底路径，确保 `Triggering.HOST`、`PropertyID.*`、`Symbology.*` 在 `i6310Pro / Android 12` 上也能取到。
  - 这次修复同时覆盖了 HOST 触发模式、广播参数 ID 和码制枚举，避免后续再因为同类静态常量取值失败卡在配置阶段。
- 改动文件列表：
  - `src/services/pda/capture/index.js`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮只修了静态常量解析，真机上仍需再次验证 `HOST` 模式配置成功后，广播回调是否能稳定收到扫码结果。

### 2026-04-18 CURRENT — 广播参数缺失时回退官方默认广播
- 做了什么：
  - 调整 `src/services/pda/capture/index.js`，当 `PropertyID.WEDGE_INTENT_ACTION_NAME / WEDGE_INTENT_DATA_STRING_TAG` 不可用时，不再直接报错，而是回退到 `ScanManager` 官方默认广播通道。
  - 新增默认广播配置读取：优先取 `ScanManager.ACTION_DECODE / BARCODE_STRING_TAG / BARCODE_TYPE_TAG`，取不到时再回退到 `android.intent.ACTION_DECODE_DATA / barcode_string / barcodeType`。
  - 广播模式接管时同步尝试把 `WEDGE_KEYBOARD_ENABLE` 设为 `0`，恢复时再回写原值，避免键盘 wedge 抢占广播结果。
  - 接收器注册改为同时监听自定义 action 和默认 action，兼容“支持自定义广播参数”和“只能走系统默认广播”的两类设备。
- 改动文件列表：
  - `src/services/pda/capture/index.js`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮解决的是“广播参数不可用”配置阶段失败；真机上下一步要确认的是：是否已进入默认广播回调链路，还是会继续停在广播超时。

### 2026-04-18 CURRENT — Android 12 广播接收兼容补丁
- 做了什么：
  - `src/services/pda/capture/index.js` 的广播接收器改成双实现类兜底：优先 `io.dcloud.android.content.BroadcastReceiver`，其次 `io.dcloud.feature.internal.reflect.BroadcastReceiver`。
  - `onReceive` 中先 `plus.android.importClass(intent)`，再读 `getAction/getStringExtra`，避免 Android 12 下 Native.js 对 intent extra 读取异常。
  - 当字符串 extra 为空时，新增 `byte[] barcode` 兜底读取，把官方默认广播中的原始字节数组转回文本。
  - 文本键候选改成“当前广播 key + 默认广播 key + 常见兼容 key”，尽量覆盖优博讯默认广播和自定义广播两条链路。
- 改动文件列表：
  - `src/services/pda/capture/index.js`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮补的是 Android 12 广播接收兼容性；真机上下一步要确认的是：现在是否能收到广播，还是仍旧完全没有回调进入。

### 2026-04-18 CURRENT — 物理扫码键优先的页面级广播会话
- 做了什么：
  - `src/services/pda/capture/index.js` 从“按钮触发一次 `startDecode()`”重构为“页面级条码广播会话 + 一次性 OCR 采集”双通道：新增 `enterBarcodeSession / setActiveBarcodeTarget / leaveBarcodeSession`，物理扫码键走持续广播，OCR 仍走 `scanOcr()`。
  - 页面接管扫描头时不再强依赖 `Triggering.HOST` 或一次性软件触发；进入页面后只做广播模式接管、关闭键盘 wedge、`unlockTrigger()`，并在离页/退后台后恢复原配置。
  - 灌装页改成固定路由：进入页面默认等待“瓶号”物理扫码；“扫瓶码”按钮只负责切回当前扫码目标并提示按 PDA 扫码键，扫码成功后直接按钢瓶 `pda_qr_code` 自动回填瓶号。
  - 销售页改成“当前步骤 + 当前选中项”路由：步骤 1 按当前头部字段回填客户/配送员/车辆，步骤 2 按当前出/回瓶行回填瓶号；重量继续保留 OCR 按钮处理。
  - `src/pages/pda/filling-create.vue` 和 `src/pages/pda/sale-create.vue` 接入页面 `onShow/onHide/onUnload` 生命周期，会在显示时重新激活物理扫码会话，隐藏或卸载时释放并恢复设备原状态。
- 改动文件列表：
  - `src/services/pda/capture/index.js`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/pages/pda/filling-create.vue`
  - `src/pages/pda/sale-create.vue`
  - `STATE.md`
- 验证输出要点：
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮已经把条码主路径切到物理扫码键和页面广播会话，但是否能在 `i6310Pro / Android 12` 上稳定收到优博讯物理键广播，仍需真机复测确认。
  - OCR 仍沿用当前模板参数；秤屏幕和瓶身字符识别的现场模板调优不在本轮内。

### 2026-04-18 CURRENT — PDA 主数据补码脚本与审计
- 做了什么：
  - 新增 `scripts/lib/qrImportCommon.cjs`，统一封装 uniCloud HTTP 调用、CRM 登录、CSV/JSON 输入读取、dry-run/execute/report/backup 输出。
  - 新增 4 个主数据补码脚本：
    - `scripts/upsertBottlePdaQrCodes.cjs` 仅按 `bottle_no` 更新钢瓶 `pda_qr_code`
    - `scripts/upsertCustomerQrCodes.cjs` 仅更新客户 `qr_code`
    - `scripts/upsertDeliveryQrCodes.cjs` 仅更新配送员 `qr_code`
    - `scripts/upsertVehicleQrCodes.cjs` 仅更新车辆 `qr_code`
  - 新增 `scripts/auditPdaQrMasters.cjs`，用于批量审计钢瓶 `pda_qr_code`、客户/配送员/车辆 `qr_code` 的空值和重复样本。
  - 新增默认模板与说明文档：
    - `docs/pda_qr_bottles.csv`
    - `docs/customer_qr_codes.csv`
    - `docs/delivery_qr_codes.csv`
    - `docs/vehicle_qr_codes.csv`
    - `docs/pda_qr_import.README.md`
- 改动文件列表：
  - `scripts/lib/qrImportCommon.cjs`
  - `scripts/upsertBottlePdaQrCodes.cjs`
  - `scripts/upsertCustomerQrCodes.cjs`
  - `scripts/upsertDeliveryQrCodes.cjs`
  - `scripts/upsertVehicleQrCodes.cjs`
  - `scripts/auditPdaQrMasters.cjs`
  - `docs/pda_qr_bottles.csv`
  - `docs/customer_qr_codes.csv`
  - `docs/delivery_qr_codes.csv`
  - `docs/vehicle_qr_codes.csv`
  - `docs/pda_qr_import.README.md`
  - `STATE.md`
- 验证输出要点：
  - `node --check scripts/lib/qrImportCommon.cjs`（通过）
  - `node --check scripts/upsertBottlePdaQrCodes.cjs`（通过）
  - `node --check scripts/upsertCustomerQrCodes.cjs`（通过）
  - `node --check scripts/upsertDeliveryQrCodes.cjs`（通过）
  - `node --check scripts/upsertVehicleQrCodes.cjs`（通过）
  - `node --check scripts/auditPdaQrMasters.cjs`（通过）
- 剩余问题：
  - 这轮只提供脚本和模板，还没有实际对云端执行补码；正式写入前仍需先跑 dry-run 并核对 report。
  - 客户、配送员、车辆的补码命中依赖现有 `name/phone/plate_no` 主数据质量；若历史主数据本身脏乱，需要先清洗档案再批量补码。

### 2026-04-18 CURRENT — PDA 主数据审计已完成 dry-run
- 做了什么：
  - 修正 `scripts/lib/qrImportCommon.cjs` 的空间鉴权路径：不再只支持 `clientSecret`，新增支付宝空间 `accessKey/secretKey/spaceAppId` 调用通道，并调整空间配置选择逻辑，优先使用带支付宝密钥的空间配置。
  - 使用 `node scripts/auditPdaQrMasters.cjs --space-id env-00jxuffegf2n` 对当前支付宝云空间完成主数据二维码审计 dry-run，并生成报告 `docs/pda_qr_audit.report.json`。
  - 审计结果显示当前主数据没有重复码，但钢瓶 `pda_qr_code`、客户/配送员/车辆 `qr_code` 仍全部为空，符合“先试点补码再扩面”的迁移起点。
- 改动文件列表：
  - `scripts/lib/qrImportCommon.cjs`
  - `docs/pda_qr_audit.report.json`
  - `STATE.md`
- 验证输出要点：
  - `node --check scripts/lib/qrImportCommon.cjs`（通过）
  - `node --check scripts/auditPdaQrMasters.cjs`（通过）
  - `node scripts/auditPdaQrMasters.cjs --space-id env-00jxuffegf2n`（通过，dry-run）
- 剩余问题：
  - 当前还没有执行任何补码写入；下一步仍应先准备试点 CSV，再用 `upsertBottlePdaQrCodes.cjs` / `upsertCustomerQrCodes.cjs` 等脚本先做 dry-run 后 execute。
  - 钢瓶旧 `qr_code` 仍有 189 条已填值，但这轮没有自动迁移到 `pda_qr_code`，后续是否复用旧码需单独决策。

### 2026-04-18 CURRENT — PDA 试点补码已写入并回查
- 做了什么：
  - 选取试点对象并生成专用补码 CSV：
    - 客户 `旭昶皮厂`
    - 钢瓶 `135 / 139 / 138 / 140 / 137`
    - 配送员 `陈铁栓 / 李凤荣`
    - 车辆 `冀A300AN`
  - 对上述 4 类主数据分别执行 dry-run，报告均为 `not_found=0 / duplicated=0 / invalid=0 / conflict=0 / failed=0` 后再执行写入。
  - 首次并行 execute 时，客户与配送员脚本因同账号并行登录触发 token 顶替，出现 `401`；随后改为串行 execute，客户、钢瓶、配送员、车辆全部写入成功。
  - 对试点对象做了云端 post-check，确认 1 个客户、5 只钢瓶、2 个配送员、1 台车的二维码字段都已落库。
- 改动文件列表：
  - `scripts/lib/qrImportCommon.cjs`
  - `docs/pilot_customer_qr_codes.csv`
  - `docs/pilot_pda_qr_bottles.csv`
  - `docs/pilot_delivery_qr_codes.csv`
  - `docs/pilot_vehicle_qr_codes.csv`
  - `docs/pilot_customer_qr_codes.report.json`
  - `docs/pilot_pda_qr_bottles.report.json`
  - `docs/pilot_delivery_qr_codes.report.json`
  - `docs/pilot_vehicle_qr_codes.report.json`
  - `docs/pilot_customer_qr_codes.execute.report.json`
  - `docs/pilot_pda_qr_bottles.execute.report.json`
  - `docs/pilot_delivery_qr_codes.execute.report.json`
  - `docs/pilot_vehicle_qr_codes.execute.report.json`
  - `docs/customer_qr_codes.20260418-181112.backup.json`
  - `docs/pda_qr_bottles.20260418-181050.backup.json`
  - `docs/delivery_qr_codes.20260418-181123.backup.json`
  - `docs/vehicle_qr_codes.20260418-180932.backup.json`
  - `docs/pda_qr_audit.report.json`
  - `STATE.md`
- 验证输出要点：
  - `node scripts/upsertBottlePdaQrCodes.cjs --space-id env-00jxuffegf2n --input docs/pilot_pda_qr_bottles.csv --report docs/pilot_pda_qr_bottles.report.json`（dry-run 通过）
  - `node scripts/upsertCustomerQrCodes.cjs --space-id env-00jxuffegf2n --input docs/pilot_customer_qr_codes.csv --report docs/pilot_customer_qr_codes.report.json`（dry-run 通过）
  - `node scripts/upsertDeliveryQrCodes.cjs --space-id env-00jxuffegf2n --input docs/pilot_delivery_qr_codes.csv --report docs/pilot_delivery_qr_codes.report.json`（dry-run 通过）
  - `node scripts/upsertVehicleQrCodes.cjs --space-id env-00jxuffegf2n --input docs/pilot_vehicle_qr_codes.csv --report docs/pilot_vehicle_qr_codes.report.json`（dry-run 通过）
  - `node scripts/upsertBottlePdaQrCodes.cjs --execute --space-id env-00jxuffegf2n ...`（执行通过）
  - `node scripts/upsertCustomerQrCodes.cjs --execute --space-id env-00jxuffegf2n ...`（串行重跑后通过）
  - `node scripts/upsertDeliveryQrCodes.cjs --execute --space-id env-00jxuffegf2n ...`（串行重跑后通过）
  - `node scripts/upsertVehicleQrCodes.cjs --execute --space-id env-00jxuffegf2n ...`（执行通过）
  - `node /tmp/verifyPilotQr.cjs env-00jxuffegf2n`（post-check 通过）
- 剩余问题：
  - 后续扩面执行时，客户/配送员/车辆脚本不应并行共用同一个超级管理员登录态；建议继续串行写入，或为批处理准备专用账号/固定 token。
  - 当前只是试点补码；批量扩面前仍应先准备映射表并继续按 dry-run -> execute -> post-check 节奏推进。

### 2026-04-18 CURRENT — PDA 销售页配送员扫码 403 fallback ACL 修复
- 做了什么：
  - 排查 `PDA 销售页先扫客户成功、再扫配送员报无权限` 的根因，确认问题不在前端扫码目标切换，而在 `crm-delivery` 云函数 fallback 到本地 ACL 时仍使用旧版 `pageAclRegistryLocal.js`。
  - 修复 `uniCloud-alipay/cloudfunctions/crm-delivery/pageAclRegistryLocal.js`：补齐 `pda` 分组、`pda_operator` 角色模板，以及 `/pages/pda/home`、`/pages/pda/bottle-query`、`/pages/pda/movement-query`、`/pages/pda/customer-query`、`/pages/pda/filling-create`、`/pages/pda/sale-create` 页面注册。
  - 同步修复 `uniCloud-alipay/cloudfunctions/crm-vehicle/pageAclRegistryLocal.js` 的同类缺口，避免车辆扫码在 fallback 路径下复现 403。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-delivery/pageAclRegistryLocal.js`
  - `uniCloud-alipay/cloudfunctions/crm-vehicle/pageAclRegistryLocal.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-delivery/pageAclRegistryLocal.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-vehicle/pageAclRegistryLocal.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-delivery/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-vehicle/index.js`（通过）
- 剩余问题：
  - 这轮还未部署云函数；要让 PDA 真机修复生效，至少需要重新上传 `crm-delivery` 和 `crm-vehicle`。
  - 部署后应以 `pda_operator` 账号回归验证：先扫客户，再扫配送员 1/2，再扫车辆，确认都不再出现 403。

### 2026-04-18 CURRENT — PDA 秤屏数字 OCR 优化与手输兜底
- 做了什么：
  - 扩展 `src/services/pda/capture/index.js`，新增重量专用 OCR profile `scale_weight_led`、重量 OCR `6s` 超时、OCR 结果结构补充 `normalizedText/parsedValue/failureReason`，并把最近 OCR 目标、原文、解析值、能力校验纳入 `getScannerState()`。
  - 扩展 `src/services/pda/shared.js`，新增七段数码管专用重量清洗与解析：对 `O/D/Q/I/L/Z/S/B/G` 等易混字符做归一化，只保留数字与一个小数点，并按候选评分提取秤屏重量。
  - 新增 `src/components/domain/pda/PdaNumericCaptureDialog.vue`，作为 PDA 复用数字手输框，供重量 OCR 超时/无效时立即兜底回填。
  - 改造 `src/components/domain/pda/PdaFillingCreateView.vue` 与 `src/components/domain/pda/PdaSaleCreateView.vue`：重量 OCR 按钮改为“识别秤屏重量”，增加秤屏拍摄提示、页面内 OCR 诊断入口，以及 OCR 失败后直接弹手输框继续流程。
- 改动文件列表：
  - `src/services/pda/capture/index.js`
  - `src/services/pda/shared.js`
  - `src/components/domain/pda/PdaNumericCaptureDialog.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check src/services/pda/capture/index.js`（通过）
  - `node --check src/services/pda/shared.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮仍只使用扫描头 OCR；如果 `i6310Pro / Android 12` 对红色秤屏的 OCR 仍不稳定，下一版应规划相机 OCR 兜底。
  - 当前未对纸上手写数字做专项优化；手写数字只允许偶然识别，不作为正式支持场景。

### 2026-04-18 CURRENT — PDA 秤屏 OCR 深度调参与隐藏调参页 V2
- 做了什么：
  - 扩展 `src/services/pda/capture/index.js`，新增 `scanScaleWeightOcr()`：按 `preset_builtin_a -> preset_builtin_b -> preset_user_numeric` 三组预设顺序尝试秤屏 OCR；每组独立超时、复用曝光/低对比/灯光/centering 参数，并把 attempt 链、最近运行历史、本机 override 加入 `getScannerState()`。
  - 新增 `src/services/pda/ocrTuning.js`，统一维护秤屏 OCR 默认预设、本机存储键 `pda_ocr_weight_tuning_v2`、加载/保存/恢复默认逻辑；窗口裁切参数默认关闭，仅在管理员调参页中可编辑。
  - 调整 `src/services/pda/shared.js` 的秤屏权重候选评分：优先连续整数 `3-5` 位，其次 `3-6` 位含一个小数点，提升红色数码管整数场景命中优先级。
  - 新增隐藏调参页 `src/pages/pda/ocr-tuning.vue` / `src/components/domain/pda/PdaOcrTuningView.vue`，支持管理员查看当前有效预设、编辑共享图像参数与 3 组 OCR 预设、测试识别一次、查看最近 5 次 attempt 结果并恢复默认。
  - 改造 `src/components/base/AppButton.vue` 与 PDA 灌装/销售页：诊断按钮支持 `2s` 按住进入隐藏调参页，普通点击仍只切换诊断面板；重量识别统一改走 `scanScaleWeightOcr()`。
  - 更新 `src/pages.json`、`src/services/pageAclRegistry.js`、`uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`，新增 `/pages/pda/ocr-tuning`，并通过新 `pdaAdmin` 分组限制为 `admin/superadmin` 可见。
- 改动文件列表：
  - `src/components/base/AppButton.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/components/domain/pda/PdaOcrTuningView.vue`
  - `src/pages/pda/ocr-tuning.vue`
  - `src/pages.json`
  - `src/services/pageAclRegistry.js`
  - `src/services/pda/capture/index.js`
  - `src/services/pda/ocrTuning.js`
  - `src/services/pda/shared.js`
  - `uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check src/services/pda/capture/index.js`（通过）
  - `node --check src/services/pda/shared.js`（通过）
  - `node --check src/services/pda/ocrTuning.js`（通过）
  - `node --check src/services/pageAclRegistry.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 这轮仍完全依赖优博讯扫描头 OCR；是否能在 `i6310Pro / Android 12` 上稳定识别红色秤屏，仍需真机用隐藏调参页逐组验证。
  - `2s` 长按入口与本机参数覆盖都只在 App 真机链路有意义，H5/小程序构建通过不代表硬件 OCR 已稳定。

### 2026-04-18 CURRENT — PDA 扫描头 OCR 秤显数字稳定化 V3（数字专用）
- 做了什么：
  - 调整 `src/services/pda/ocrTuning.js`：秤屏 OCR 默认总预算改为 `4000ms`，单次尝试默认 `700ms`，与“速度优先 + 手输兜底”策略一致。
  - 重构 `src/services/pda/capture/index.js` 的 OCR 参数写入逻辑：
    - 增加 `setParameterInts` / `setPropertyInts` 双通道写入适配。
    - 对 `LOW_CONTRAST_IMPROVED*` 走 `property` 通道优先，失败后回退 `parameter` 并记录降级。
    - 将不支持参数归集到 `unsupportedParams`，仅做诊断不阻断 OCR。
  - 将 `scanScaleWeightOcr()` 改为数字专用稳定采样器：
    - 在 `4s` 总预算内循环短采样（预设链顺序固定 `builtin_a -> builtin_b -> user_numeric`）。
    - 每个样本统一数字清洗，只接受 `整数 + 单小数点`。
    - 仅当连续两次样本完全一致才判定命中并回填（`consensus` 规则）。
    - 返回结构补齐 `samples`、`consensus`、`selectedPreset`，并落地到 `getScannerState()` 诊断字段。
  - 升级灌装/销售页 OCR 诊断文案和确认交互：
    - OCR 能力改为“能力状态 + 写入通道 + 降级项”而非单条报错。
    - 重量命中确认弹窗展示“命中值 + 预设 + 样本数 + 连续一致次数”。
- 改动文件列表：
  - `src/services/pda/ocrTuning.js`
  - `src/services/pda/capture/index.js`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check src/services/pda/capture/index.js`（通过）
  - `node --check src/services/pda/ocrTuning.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - `.vue` 文件无法用 `node --check` 直接做语法检查（Node 不识别 `.vue` 扩展），本轮以 `uni build` 作为页面语法与依赖回归依据。
  - 真机仍需重点验证：`i6310Pro` 扫描头在红色数码管场景下是否能稳定达到“连续两次一致”门槛。

### 2026-04-20 CURRENT — 登录回跳修复 + PDA 管理员 OCR 校准入口
- 做了什么：
  - 修复登录回跳链路：新增待登录回跳页存储，未登录被拦截后会记住原目标页面；登录成功后优先回跳原页面，不再无条件落到 `resolveHomePath()`。
  - 在 `App.vue` 增加“登录页 + 待回跳页”兜底处理，避免 `onShow` 抢先把登录后的当前页又重定向回 PDA 首页。
  - 为 `admin/superadmin` 在 PDA 首页补显式入口 `OCR ROI 校准`，不再只能靠 HBuilderX 运行隐藏页。
- 改动文件列表：
  - `src/services/navigation.js`
  - `src/pages/login/login.vue`
  - `src/App.vue`
  - `src/components/domain/pda/PdaHomeView.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check src/services/navigation.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 真机仍需重装这次新包或新基座后验证：`运行当前页 -> 登录 -> 回到 /pages/pda/ocr-tuning` 是否按预期生效。
  - 若设备上仍看到旧版入口布局，优先排查是否运行了旧基座或旧资源缓存，而不是继续怀疑 OCR 逻辑本身。

### 2026-04-22 CURRENT — PDA 量重改造 V1（OCR 下线 + 秤网关 + 扫码提速）
- 做了什么：
  - 新分支继续沿用 PDA 当前工作，在前端彻底下线 OCR：删除 OCR 页面/服务/路由/ACL/首页入口，移除 `TH-WeightOCR-MLKit` 插件引用，并把 `src/services/pda/capture/index.js` 收敛为纯扫码广播会话，新增“同目标 + 同码 600ms 去重”。
  - 新增秤网关链路：增加 `uniCloud-alipay/cloudfunctions/crm-pda-scale/index.js` 与 `uniCloud-alipay/database/schema/crm_pda_scale_latest.schema.json`，前端新增 `src/services/pda/scale.js`、`src/composables/pda/usePdaScale.js`，灌装页补秤状态卡、轮询、在线/稳定判定和“手工总重优先，留空回退稳定秤值”的换算逻辑。
  - 扫码提速按“扫码优先”收口：销售页步骤 1/2 取消自动存瓶预览请求，仅在进入步骤 3 或手动刷新时重算；客户/钢瓶扫码 resolve 改为 PDA 最小摘要返回，并在前端增加 30s TTL 缓存；机房电脑侧新增 `scripts/scale-gateway/` 独立 Node 网关与 `--mock` 模式。
- 改动文件列表：
  - `src/components/domain/pda/PdaHomeView.vue`
  - `src/components/domain/pda/PdaFillingCreateView.vue`
  - `src/components/domain/pda/PdaSaleCreateView.vue`
  - `src/composables/pda/usePdaFillingForm.js`
  - `src/composables/pda/usePdaSaleForm.js`
  - `src/composables/pda/usePdaScale.js`
  - `src/services/pda/capture/index.js`
  - `src/services/pda/customer.js`
  - `src/services/pda/bottle.js`
  - `src/services/pda/filling.js`
  - `src/services/pda/scale.js`
  - `src/pages.json`
  - `src/services/pageAclRegistry.js`
  - `src/manifest.json`
  - `uniCloud-alipay/cloudfunctions/common/pageAclRegistry.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-bottle/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-pda-scale/index.js`
  - `uniCloud-alipay/database/schema/crm_pda_scale_latest.schema.json`
  - `scripts/scale-gateway/package.json`
  - `scripts/scale-gateway/.env.example`
  - `scripts/scale-gateway/protocol.cjs`
  - `scripts/scale-gateway/index.cjs`
  - `scripts/scale-gateway/README.md`
  - `STATE.md`
- 验证输出要点：
  - `node --check src/services/pda/capture/index.js`（通过）
  - `node --check src/services/pda/customer.js`（通过）
  - `node --check src/services/pda/bottle.js`（通过）
  - `node --check src/services/pda/filling.js`（通过）
  - `node --check src/services/pda/scale.js`（通过）
  - `node --check src/composables/pda/usePdaScale.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-pda-scale/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-bottle/index.js`（通过）
  - `node --check scripts/scale-gateway/index.cjs`（通过）
  - `node --check scripts/scale-gateway/protocol.cjs`（通过）
  - `node scripts/scale-gateway/index.cjs --mock --dry-run --once`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 云函数、schema 和前端仍需按发布流程部署到目标空间后，PDA 真机才能看到秤状态卡和最新重量。
  - `scripts/scale-gateway/` 还需要在机房电脑执行 `npm install` 并配置真实串口、云空间凭证和网关账号，随后做至少 10 分钟真机联调。
  - 目前只做“最新快照”链路，不含重量历史、超载位、多秤调度或 WebSocket；若后续补到明确超载寄存器，再扩字段。

### 2026-04-24 CURRENT — PDA 销售吊秤闭环（gross/tare/net 对齐 + 测试二维码）
- 做了什么：
  - PDA 销售出瓶对齐 Web 销售明细三字段模型：称重回填统一写入 `gross/tare/net`，提交 `outItems/backItems` 时均传递三重量字段；手工只录净重时仍允许按原兜底提交。
  - 扫瓶后增加自动称重回填：扫码先回填瓶号和瓶档皮重，若已有可用稳定吊秤值立即写净重，否则保留 15 秒待回填目标；同类型同瓶二维码 3 秒内重复扫描会被忽略。
  - 销售页清理操作员无用的扫码诊断展示，吊秤高频通知在服务层保留实时接收但页面快照节流到 200ms；切换步骤不再自动断开吊秤。
  - 新增 `scripts/createPdaScaleTestData.cjs`，已在 `env-00jxuffegf2n` 创建测试客户 `PDA测试客户-吊秤`（5 元/kg）和三只皮重 1kg 的测试瓶，并生成本地 300×300 二维码到 `docs/pda-qr-300x300/2026-04-24-scale-test/`。
- 云端测试数据：
  - 客户：`PDA-SCALE-CUST-001`，`_id=69eaf32df64c736626208828`
  - 钢瓶：`PDA-SCALE-B001` / `PDA-SCALE-BOTTLE-001`，`_id=69eaf32dde35b6f5aac288ee`，皮重 1kg
  - 钢瓶：`PDA-SCALE-B002` / `PDA-SCALE-BOTTLE-002`，`_id=69eaf32dfec79e230c7254c1`，皮重 1kg
  - 钢瓶：`PDA-SCALE-B003` / `PDA-SCALE-BOTTLE-003`，`_id=69eaf32dde35b6f5aac288f1`，皮重 1kg
- 验证输出要点：
  - `node --check src/services/pda/sale.js`（通过）
  - `node --check src/composables/pda/usePdaSaleForm.js`（通过）
  - `node --check src/services/pda/bleScale.js`（通过）
  - `node --check scripts/createPdaScaleTestData.cjs`（通过）
  - `node scripts/createPdaScaleTestData.cjs --space-id env-00jxuffegf2n --execute`（通过）
  - `node scripts/createPdaScaleTestData.cjs --space-id env-00jxuffegf2n`（通过，4 个二维码均解析为 update）
  - `file docs/pda-qr-300x300/2026-04-24-scale-test/*.png`（均为 300 x 300 PNG）
  - `git diff --check`（通过）
  - `uni build` H5（通过）
  - `uni build -p mp-alipay`（通过）
- 剩余问题：
  - 仍需真机验证：扫测试客户后带出 5 元/kg，扫测试瓶后带出 1kg 皮重，吊秤稳定后自动写入 `gross/tare/net`，Web 端打开 PDA 销售单能看到完整三字段。

### 2026-04-24 CURRENT — PDA 吊秤稳定锁与销售预览权限修复
- 做了什么：
  - 吊秤真实分度值改为 `0.1kg`，显示仍保留 1 位小数；业务稳定值不再信任厂家 `ST` 标志，统一由本地稳定锁产生。
  - 稳定锁规则收口为同一量化重量连续保持 `1200ms` 且不少于 `5` 帧，只有生成新的 `stable_seq` 才触发扫码后的待回填，避免重量还在上升时误自动写入。
  - 销售页新增出瓶/回瓶后立即切换物理扫码目标到新行；已通过吊秤称重的行不会被扫码自动二次覆盖，手动重称需要确认。
  - 上传了 `crm-sale` 与 `crm-user` 云函数，确保 PDA 销售预览和提交使用最新 `/pages/pda/sale-create` ACL；`common` 目录不是当前 HBuilderX 可识别的公共模块，但两个云函数均带本地 ACL fallback。
- 验证输出要点：
  - `node --check src/services/pda/bleScale.js`（通过）
  - `node --check src/composables/pda/usePdaSaleForm.js`（通过）
  - `node --check src/services/pda/sale.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
  - `git diff --check`（通过）
- 剩余问题：
  - 真机仍需验证：2.5kg 物体在上升阶段不会因厂家早发 `ST` 自动回填，重量稳定后才写入；新增出瓶后直接扫码应写入新行；预览提交不再 403。

### 2026-04-24 CURRENT — PDA 吊秤稳定锁 V2（ST 候选 + 延迟确认）
- 做了什么：
  - 修复本地稳定窗口边界问题，不再用“裁剪窗口后再反查跨度”的方式判定稳定。
  - 厂家 `ST` 改为稳定候选信号：收到 `ST` 后继续取样，候选重量连续保持 `1500ms` 后才生成业务稳定锁；候选期间重量变化会把候选起点重置到最新重量。
  - 无 `ST` 时保留本地兜底：同一 `0.1kg` 量化重量持续 `1200ms` 且至少 `5` 帧后生成稳定锁。
  - 回填语义不变，页面、自动回填和手动回填仍统一读取 `last_stable_weight_kg/stable_seq`。
- 验证输出要点：
  - `node --check src/services/pda/bleScale.js`（通过）
  - `node --check src/composables/pda/usePdaSaleForm.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 真机需验证：早发 `ST` 后重量继续上升时不应回填；重量停稳后应在约 1.5 秒内进入可回填状态。

### 2026-04-24 CURRENT — PDA 销售称重回填细节修复
- 做了什么：
  - 修复回瓶联动净重浮点精度问题，`gross - tare` 统一按 1 位小数写入，避免 `0.6000000000000001` 进入表单。
  - `stable_seq` 改为稳定状态持续期间按确认间隔重新发布稳定事件，解决连续多只同重量瓶扫码后 pending 行不自动回填的问题。
  - 已称重行保护、手动重称确认和瓶流转预警阻断提交逻辑保持不变。
- 验证输出要点：
  - `node --check src/services/pda/sale.js`（通过）
  - `node --check src/services/pda/bleScale.js`（通过）
  - `node --check src/composables/pda/usePdaSaleForm.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
- 剩余问题：
  - 真机需验证：B001 与 B002 同重量连续称重时，第二行扫码后等待稳定事件可自动回填；回瓶净重显示为 `0.6`。

### 2026-05-13 CURRENT — 客户对账会计明细账导出
- 做了什么：
  - 新增 `crm-customer-settlement.exportCustomerAccountingLedgerV1`，按好会计明细账样式输出客户应收账款流水：销售/流量/历史欠款/其他费用走借方，收款和收款抹零走贷方，分配流水不进入会计导出。
  - 客户对账页新增“会计导出”按钮，保留原“导出对账单”不变；客户列表的对账入口新增批量“会计导出”。
  - 新增会计明细账 SpreadsheetML 生成器，列结构为 `日期/凭证号/摘要/借方/贷方/方向/余额`，含期初余额、本月合计、本年累计和批量失败 sheet。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `src/services/customerSettlement.js`
  - `src/components/domain/customer/statement/exportWorkbook.js`
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `src/components/domain/customer/CustomerListView.vue`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `node --check src/services/customerSettlement.js`（通过）
  - `node --check src/components/domain/customer/statement/exportWorkbook.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
  - `git diff --check`（通过）
- 剩余问题：
  - 这轮未部署 `crm-customer-settlement` 云函数；线上使用前需要上传该云函数并发布前端。
  - 第一版未维护好会计 `112202...` 客户明细科目编码，导出标题默认使用 `1122 应收账款_<客户名称>`；如需精确匹配好会计科目，下一步再补客户档案映射字段。

### 2026-05-14 CURRENT — 客户会计明细账负数销售与月结行修正
- 做了什么：
  - 对齐好会计明细账口径：负数销售保留为借方负数，余额统一按 `借方 - 贷方` 逐行滚动，负借方会减少应收并可转为贷方余额。
  - 会计导出的收款行按收款单发生日期生成贷方，收款抹零单独生成贷方；排除负销售形成的冲抵池来源，避免 1.12、1.29 这类负销售重复扣减余额，同时保留跨期收款和未分配预收款。
  - 补充历史已收兜底：如果销售、流量结算、历史欠款、其他费用单据自身已有 `amount_received/receipt_rounding_amount`，但没有对应收款单或分配流水承载，会计明细账按业务日期补出贷方，避免已结清历史单据在导出里只显示借方。
  - 明细账 workbook 改用 `display_rows`，每个月明细后立即插入“本月合计”“本年累计”；期初余额行月份改用导出起始月份。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `src/components/domain/customer/statement/exportWorkbook.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `node --check src/components/domain/customer/statement/exportWorkbook.js`（通过）
  - `node --check src/services/customerSettlement.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
  - `git diff --check`（通过）
- 剩余问题：
  - 这轮仍未部署 `crm-customer-settlement` 云函数；线上导出要看到新口径，需要上传该云函数并发布前端。

### 2026-05-14 CURRENT — 会计导出历史已收兜底参数修复
- 做了什么：
  - 修复上一轮历史已收兜底里自引入的参数传递错误：`pushAccountingTargetReceivedFallback` 调用时补传 `allocationBackedMap`，避免云函数执行到 `backedMap.get(...)` 抛错，导致点击“会计导出”后无正常返回。
  - 单客户会计导出前端补充异常 toast 和控制台错误输出，避免云函数异常时用户只看到 loading 消失。
  - 将“回归优先检查最近 Codex 改动”的排查原则写入 `/Users/wangbo/.codex/skills/crm-2026-v4/SKILL.md`。
- 改动文件列表：
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `STATE.md`
  - `/Users/wangbo/.codex/skills/crm-2026-v4/SKILL.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `node --check src/components/domain/customer/statement/exportWorkbook.js`（通过）
  - `node --check src/services/customerSettlement.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
  - `git diff --check`（通过）
- 剩余问题：
  - 需要重新上传 `crm-customer-settlement` 云函数；如果前端错误提示改动也要生效，需要重新发布前端。

### 2026-05-14 CURRENT — 销售单手动冲抵款分配与净欠款来源跳转
- 做了什么：
  - 销售单“使用冲抵款”保持默认关闭；编辑加载时不再沿用历史 `apply_offset_credit` 勾选态。
  - 仅超级管理员可在销售单结算区开启“使用冲抵款”；前端禁用非超级管理员开关，后端 `crm-sale.updateSettlementV1` 和 `crm-customer-settlement.autoApplyPrepayToSaleV1` 同步兜底 403。
  - 销售单保存结算时，如果超级管理员手动开启冲抵款，云函数会按客户冲抵池中未分配来源，排除当前销售单自身形成的冲抵来源，分配到当前销售单欠款；保存尝试后会把 `apply_offset_credit` 复位为关闭，未找到可用冲抵款时回写为真实未结清状态并返回失败提示。
  - 销售列表新增 `customerId` 路由/筛选参数，客户对账页点击“净欠款(扣冲抵后)”会跳转到该客户销售列表，并套用当前日期范围和 `net_outstanding_non_zero` 口径。
- 改动文件列表：
  - `src/components/domain/sale/SaleEditView.vue`
  - `src/components/domain/sale/SaleSettlementCard.vue`
  - `src/components/domain/sale/SaleListView.vue`
  - `src/pages/sale/list.vue`
  - `src/services/sale.js`
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `uniCloud-alipay/cloudfunctions/crm-sale/index.js`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-sale/index.js`（通过）
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `node --check src/services/sale.js`（通过）
  - `node --check src/services/customerSettlement.js`（通过）
  - `node --check src/components/domain/customer/statement/exportWorkbook.js`（通过）
  - `npm run build:h5`（通过）
  - `npm run build:mp-alipay`（通过）
  - `git diff --check`（通过）
- 剩余问题：
  - 需要上传 `crm-sale`、`crm-customer-settlement` 云函数，并发布前端后验证：超级管理员勾选“使用冲抵款”保存后，冲抵来源生成分配流水，销售单 `amount_received/payment_status` 与客户对账余额同步更新。

### 2026-05-14 CURRENT — 净欠款定位改为客户对账页内销售明细
- 做了什么：
  - 修正“净欠款(扣冲抵后)”点击行为：不再跳转到全局销售记录列表，而是在当前客户对账页内切换销售明细为“净欠款来源”视图并滚动定位到该区域。
  - 销售明细新增定位态高亮和“查看全部”按钮；定位态只显示当前对账日期范围内仍有未收余额的销售/流量结算来源。
  - `getCustomerStatementV1` 增加 `net_debt_source_sales` 与 `net_debt_source_flow_settlements`，避免只依赖“近100条”导致更早的欠款销售单无法定位；如果当前日期范围没有来源，不回退到全量历史，避免误定位。
- 改动文件列表：
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `node --check src/services/customerSettlement.js`（通过）
  - `node --check src/components/domain/customer/statement/exportWorkbook.js`（通过）
  - `git diff --check`（通过）
  - `npm run build:h5`（通过）
  - 未运行 `npm run build:mp-alipay`（本轮按要求只验证 H5，当前不计划支付宝小程序上线）
- 剩余问题：
  - 需要上传 `crm-customer-settlement` 云函数并发布 H5 前端后验证点击定位效果。

### 2026-05-15 CURRENT — 出纳收款单客户对账抹零放开
- 做了什么：
  - 客户对账页编辑出纳登记来源收款单时，继续锁定真实收款金额、业务日期、收款方式和备注，但允许录入/调整收款抹零。
  - 后端 `updateReceiptV1` 放开出纳来源收款单的 `rounding_amount` 调整，仍禁止从客户对账反改金额/日期/方式/备注等出纳登记字段。
  - 提示文案同步改为“仅支持调整分配和抹零”。
- 改动文件列表：
  - `src/components/domain/customer/statement/CustomerStatementModule.vue`
  - `uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`
  - `STATE.md`
- 验证输出要点：
  - `node --check uniCloud-alipay/cloudfunctions/crm-customer-settlement/index.js`（通过）
  - `npm run build:h5`（通过）
  - `git diff --check`（通过）
  - 未运行 `npm run build:mp-alipay`（本轮按计划只验证 H5）
- 剩余问题：
  - 需要上传 `crm-customer-settlement` 云函数并发布 H5 前端后，在线上验证出纳收款 `22610.00` + 抹零 `9.50` 可结清 `22619.50` 区间欠款。
