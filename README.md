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
- `AMAP_WEB_SERVICE_KEY`：高德地图 Web 服务 Key（入户巡检 WGS84 坐标转换及逆地理编码必填，仅配置在云函数环境）

## 工作目录约定

- 旧项目（仅用于对照查看代码）：`../2026_v2-1`
- 实际重构工作目录：`2026_v4`

## 文档入口

- [AGENTS.md](AGENTS.md)：AI 与工程协作读取路线。
- [当前状态](STATE.md)：可更新快照，包含当前目标、未完成项和部署证据。
- [领域索引](state/INDEX.md)：账务、流转、PDA、网关及专项工作规范。
- [工程约束](docs/RULES.md)：业务归属、数据操作和验证契约。
- [会计入口](docs/ACCOUNTING.md)：权威金额规则和凭证约定。
- [可靠性证据](docs/SYSTEM_RELIABILITY.md)：反例、验收和四项改进指标。
- [历史索引](state/history/INDEX.md)：归档原文与校验清单，仅按需追溯。

上下文检查：`node scripts/checkProjectContext.cjs`。STATE 的维护协议统一在工程约束中定义；本页不复制协议或业务规则。

## 分支与检查

`main` 是已验收基线；开发候选在 `codex/system-trust-foundation`，未发布的灌装/PDA/导入不能整包合入。当前生产各函数、H5版本与合并提交分别记录在STATE，不能从一个网页版本推断全部函数均已更新。

```bash
npm test                         # 当前入口/归档、账务反例、web/cloud源码发布范围检查
npm run test:accounting-release   # 账务、客户隔离及发布反例
npm run check:release -- --product=cloud
```

检查使用 `config/release-products.json` 的明确发布范围，保留生产权限历史来源。全仓契约中存在开发候选引用和已知schema差异；本分支不运行全仓自动生成来补齐这些未发布内容。`--scope=all`保留为全仓诊断，结果不能用单次发布范围检查替代。

`release:web`会实际上传，日常合并/测试不运行它。只读网页回读使用 `scripts/verifyWebReadback.cjs`，需显式传入已构建目录和回执路径；历史CSS交付清单按构建及双哈希绑定，不适用于任意新构建。
