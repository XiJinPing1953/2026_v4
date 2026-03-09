# 2026_v4 新拓能源 CRM

基于 **uni-app（Vue3 + Vite）+ uniCloud（支付宝云）** 的前后端分离重构项目。

## 技术栈

- 前端：uni-app + Vue 3 + Vite + SCSS
- 后端：uniCloud（支付宝云空间）
- 数据库：uniCloud Database

## 开发命令

```bash
# 开发
npm run dev:h5              # H5 网页开发
npm run dev:mp-alipay       # 支付宝小程序

# 构建
npm run build:h5            # 构建 H5
npm run build:mp-alipay     # 构建支付宝小程序
```

其他平台：`mp-weixin`、`mp-baidu`、`mp-qq`、`mp-toutiao` 等。

## 环境变量

- `SUPERADMIN_USERNAME`：超级管理员账号（必填）
- `SUPERADMIN_PASSWORD`：超级管理员密码（必填）
- `BCRYPT_SALT_ROUNDS`：bcrypt 盐轮数（可选，默认 10）

## 工作目录约定

- 旧项目（仅用于对照查看代码）：`../2026_v2-1`
- 实际重构工作目录：`2026_v4`

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/RULES.md](docs/RULES.md) | 强制约束（目录结构、架构原则、禁止事项） |
| [docs/ACCOUNTING.md](docs/ACCOUNTING.md) | 会计凭证自动生成规则 |
| [STATE.md](STATE.md) | 工作状态日志（SSOT，追加模式） |
| [CLAUDE.md](CLAUDE.md) | AI 助手快速参考 |

## STATE.md 协议

`STATE.md` 是工作状态的单一事实来源（SSOT），采用追加模式：
- 禁止修改历史条目
- 每次提交后追加新条目，包含：做了什么、改动文件列表、验证输出要点、剩余问题及 Next
- 验证输出要点必须明确写清运行了什么/没运行什么
