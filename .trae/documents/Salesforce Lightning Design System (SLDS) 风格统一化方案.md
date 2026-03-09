# Salesforce Lightning Design System (SLDS) 风格统一化方案

为了使系统风格与 Salesforce Lightning Design System (SLDS) 保持一致，我们将从全局变量、基础组件到业务页面进行全面的视觉重塑。SLDS 的核心在于其**专业、高效、干净**的商务美学。

## 1. 全局样式重塑 (Global Styles)
更新 `uni.scss` 中的全局 CSS 变量，采用 SLDS 官方色板：
- **品牌色 (Brand)**: 从通用蓝改为 Salesforce Blue (`#0176d3`)。
- **中性色 (Neutrals)**: 调整背景色为 `#f3f3f3`，边框色为 `#dddbda`。
- **圆角 (Radius)**: 统一采用 SLDS 标准的 `0.25rem` (约 8rpx)，告别过度圆润。
- **阴影 (Shadows)**: 移除或极度弱化阴影，改用边框定义边界。

## 2. 基础组件 SLDS 化 (Base Components)
- **AppButton**:
    - 引入 `Brand` (深蓝)、`Neutral` (白底黑字带边框) 和 `Outline` 风格。
    - 调整高度和字体权重，匹配 SLDS 按钮比例。
- **AppCard & AppSection**:
    - 改为白底、细边框 (`1px solid #dddbda`) 样式。
    - 移除现有的卡片阴影。
- **AppInput**:
    - 移除浅色背景填充，改为全边框样式。
    - 聚焦状态使用 SLDS 标准的蓝色边框和外发光。
- **AppPage**:
    - 重构页面头部 (Header)，增加面包屑效果或图标背景，模拟 Salesforce 记录页面的头部设计。

## 3. 业务页面优化 (Domain Pages)
- **列表页 (List)**: 采用 SLDS 的数据列表风格，增加行间分割线，优化空状态。
- **编辑页 (Edit)**: 优化表单项排版，采用紧凑型设计，确保在移动端也能体现 Salesforce 的高效录入体验。

## 4. 关键文件调整清单
- [uni.scss](file:///Users/wangbo/Downloads/2026_v4/src/uni.scss) (变量重定义)
- [AppButton.vue](file:///Users/wangbo/Downloads/2026_v4/src/components/base/AppButton.vue)
- [AppCard.vue](file:///Users/wangbo/Downloads/2026_v4/src/components/base/AppCard.vue)
- [AppInput.vue](file:///Users/wangbo/Downloads/2026_v4/src/components/base/AppInput.vue)
- [AppPage.vue](file:///Users/wangbo/Downloads/2026_v4/src/components/base/AppPage.vue)

请确认以上设计方向，确认后我将开始执行具体的代码重构。