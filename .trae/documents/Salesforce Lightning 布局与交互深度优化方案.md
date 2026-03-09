# Salesforce Lightning 布局与交互深度优化方案

为了进一步提升系统的专业感和操作效率，我们将从页面架构、核心交互组件和业务场景适配三个维度，深度对齐 Salesforce Lightning Design System (SLDS) 的布局规范。

## 1. 核心布局组件重构 (Layout Components)
- **[AppPage.vue](file:///Users/wangbo/Downloads/2026_v4/src/components/base/AppPage.vue)**:
    - **Page Header 升级**: 将头部拆分为“标题区”、“摘要面板 (Highlights Panel)”和“选项卡 (Tabs)”。
    - **摘要面板**: 支持在标题下方以横向网格形式展示 3-4 个关键字段（如状态、总金额、创建日期），让用户无需滚动即可获取核心信息。
- **新增 `AppTabs.vue`**:
    - 实现符合 SLDS 规范的选项卡组件，支持在“详情 (Details)”、“关联项 (Related)”等视图间快速切换。

## 2. 对象主页优化 (Object Home - List View)
- **[list.vue](file:///Users/wangbo/Downloads/2026_v4/src/pages/sale/list.vue)**:
    - **增强头部信息**: 在标题旁显示记录总数（如 "12 items"），对齐 Salesforce 的列表展示逻辑。
    - **筛选器重塑**: 将复杂的筛选条件整合进一个更整洁的操作栏，支持快速搜索与高级筛选的切换。

## 3. 记录主页重塑 (Record Home - Detail & Edit)
- **[detail.vue](file:///Users/wangbo/Downloads/2026_v4/src/pages/sale/detail.vue)**:
    - **引入摘要面板**: 移除目前的深色大卡片，改为 Header 内嵌的摘要栏，使页面视觉层次更丰富。
    - **选项卡式结构**: 默认显示“详情”，通过选项卡切换到“明细记录”或“历史追踪”，减少单页面的纵向滚动压力。
- **[edit.vue](file:///Users/wangbo/Downloads/2026_v4/src/pages/sale/edit.vue)**:
    - **动作栏规范化**: 将“保存/取消”按钮同步至页面头部右侧，符合 Salesforce 的操作习惯。

## 4. 交互细节打磨 (Interaction Polish)
- **字段展示**: 统一 Field-Value 的对齐规范，采用 SLDS 的 2 列或多列网格布局。
- **反馈增强**: 优化页面加载时的骨架屏 (Skeleton)，使其布局与 Tab 切换后的内容完全对应。

请确认以上深度优化方向，确认后我将开始实施。