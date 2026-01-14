state: ok
updated: 2026-01-14
repo: 2026_v4
branch: main

# STATE

本文件用于在多轮对话/多次提交之间持久化项目状态，避免上下文丢失。

## 使用规则（必须遵守）
- `STATE.md` 是“当前工作状态”的单一事实来源（SSOT）。
- 每次开始一段工作前：先更新「当前目标 / 下一步 / 风险与阻塞」。
- 每次提交代码后：在「Commit 记录」新增/补全对应条目（目的、影响面、后续）。
- Todo/Task 只写“下一步可以直接执行的动作”，避免空泛描述。

## 当前目标（Current Objective）
- （待填写）

## 当前上下文（Context Snapshot）
- 产品/业务背景：uni-app（Vue3 + Vite）+ uniCloud（支付宝云）前后端分离重构
- 关键约束：页面瘦身；兼容逻辑仅允许在 `src/services/mappers/**`

## 下一步（Next Actions / Todo）
- [ ] （待填写）

## 阻塞与风险（Blockers / Risks）
- （待填写）

## 决策记录（Decisions）
- （待填写）

## 约束清单（Non‑Negotiables）
- 官方规则优先（uni-app / uniCloud 结构与配置不可随意改动）
- 前后端分离：业务规则与数据访问在云函数
- 页面只做编排：`src/pages/**` 禁止堆业务计算/兼容逻辑

## Commit 记录（初始条目）

> 说明：这里记录“为什么做 / 改了什么范围 / 需要跟进什么”，不要复制粘贴 diff。

### 7873e56 — chore: silence sass deprecation warnings in build (2026-01-14)
- 目的：降低构建噪音，避免未来 sass 行为变化导致的构建风险。
- 影响范围：构建/样式相关配置（待补充具体文件）。
- 验证点：本地 `npm run build` 无新增警告（待执行/记录）。
- 后续：如上游依赖升级，复查警告是否再次出现。

### a41c37e — feat: secure crm-auth with bcrypt (2026-01-14)
- 目的：提升 `crm-auth` 登录链路安全性，避免明文/弱校验。
- 影响范围：云函数鉴权逻辑、环境变量（如盐轮数等）。
- 验证点：正确账号可登录；错误密码/缺失 token 正确拒绝；续期行为正确。
- 后续：补齐边界用例与错误码规范（待补充）。

### 6e471e8 — feat: add crm-auth cloudfunction (2026-01-14)
- 目的：建立最小可用的鉴权云函数，为后续业务云函数提供统一入口。
- 影响范围：`uniCloud-alipay/cloudfunctions/crm-auth`、前端 auth 调用封装。
- 验证点：云端部署与本地调用链路打通。
- 后续：完善权限模型与角色（待补充）。

### 253ae1d — feat: add base list/table/filter scaffolds (2026-01-14)
- 目的：先补齐通用 UI 基建（筛选/列表/表格），为业务页迁移铺路。
- 影响范围：`src/components/base/**`、相关页面/组合式逻辑（待补充）。
- 验证点：列表/表格/筛选在工作台或示例页可正常渲染。
- 后续：统一交互规范（空态/加载/错误）并补文档。
