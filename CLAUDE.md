# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

新拓能源 CRM 系统 - 基于 uni-app（Vue 3 + Vite）+ uniCloud（支付宝云）的前后端分离重构项目。这是一个燃气/液化气配送业务管理系统，涵盖销售、瓶档、灌装、客户、车辆和会计模块。

## 开发命令

```bash
# 开发（主要平台）
npm run dev:h5              # H5 网页开发
npm run dev:mp-alipay       # 支付宝小程序

# 生产构建
npm run build:h5            # 构建 H5
npm run build:mp-alipay     # 构建支付宝小程序
```

其他平台：`mp-weixin`、`mp-baidu`、`mp-qq`、`mp-toutiao`、`mp-kuaishou`、`mp-jd`、`mp-lark`、`mp-harmony`、`mp-xhs`、`quickapp-webview`。

## 架构

### 分层结构
```
Pages（薄编排层）→ Composables → Services → callCloud API → 云函数
```

### 核心目录
- `src/pages/` - 页面容器（仅做编排，保持简短）
- `src/components/base/` - 可复用 UI 组件（无业务逻辑）
- `src/components/domain/` - 业务领域组件
- `src/composables/` - Vue 组合式函数（useQuery、useAuthGuard）
- `src/services/` - 数据与业务逻辑层
  - `services/api/callCloud.js` - 统一云函数调用，含 401 处理
  - `services/models/` - 核心数据模型与校验
  - `services/mappers/` - 历史数据兼容层（兼容代码唯一允许位置）
- `uniCloud-alipay/cloudfunctions/` - 云函数（crm-auth、crm-sale、crm-customer 等）
- `uniCloud-alipay/database/` - 数据库 schema 与索引

### 核心模型
Bottle / Sale / Filling / Customer / Vehicle / Anomaly / Log / User

### 销售业务模式
- `kg` - 按重量计价（回瓶净重冲减收入）
- `bottle` - 按瓶数计价
- `truck` - 整车销售
- `m3` - 按气量计价
- `agent_sale` - 代理商销售

## 强制约束

### 页面瘦身原则
`src/pages/**` 中的页面只做编排：路由参数、调用 composable、组合组件、布局。禁止在页面中放业务计算、状态同步或兼容逻辑。

### 兼容隔离
所有历史字段兼容代码必须且只能放在 `src/services/mappers/**`。禁止在页面或组件中散布兼容 if 判断。

### 前后端分离
- 前端：仅负责 UI/交互/编排
- 后端（uniCloud）：数据访问、权限校验、业务规则、写入操作

### 禁止事项
- 禁止直接复制旧项目数据结构到新模型
- 禁止在页面文件中堆业务计算/状态同步/复杂渲染逻辑
- 禁止为兼容历史字段牺牲新模型清晰性

## STATE.md 协议

`STATE.md` 是工作状态的单一事实来源（SSOT），采用追加模式：
- 禁止修改历史条目
- 每次提交后追加新条目，包含：做了什么、改动文件列表、验证输出要点、剩余问题及 Next
- 验证输出要点必须明确写清运行了什么/没运行什么（如 npm run build、云函数部署等）

## 云函数模式

```javascript
// crm-{domain}/index.js 标准模式
exports.main = async (event, context) => {
  const { action, data = {}, token } = event
  const user = await getUserByToken(token)
  if (!user) return { code: 401, msg: '未登录或登录已过期' }

  if (action === 'createV2') return createV2(user, data, requestId)
  if (action === 'listV2') return listV2(user, data)
  // ...
  return { code: 400, msg: '未知 action' }
}
```

响应格式：`{ code, msg, data }`，其中 code 0 = 成功，401 = 需要登录，400 = 参数错误。

## 会计模块

销售自动生成会计凭证。科目映射：
- 应收账款：1122
- 主营业务收入：6001
- 库存现金：1001
- 银行存款：1002（含微信/支付宝子科目）

灌装记录不生成凭证（仅作运营记录）。

## 环境变量

- `SUPERADMIN_USERNAME` - 超级管理员账号（必填）
- `SUPERADMIN_PASSWORD` - 超级管理员密码（必填）
- `BCRYPT_SALT_ROUNDS` - bcrypt 盐轮数（可选，默认 10）
