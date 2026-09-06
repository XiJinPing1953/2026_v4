# 2026_v4 项目入口

这是新拓能源 CRM：uni-app Vue 3 + Vite 前端，uniCloud 支付宝云后端。

按需读取，避免把历史记录当成当前指令：

1. [工程约束与协作契约](docs/RULES.md)。
2. [当前状态](STATE.md)：当前目标、未完成项、实际验证与发布证据。
3. [领域索引](state/INDEX.md)：只读本次涉及的领域决定；账务另读 [会计入口](docs/ACCOUNTING.md)。
4. [README](README.md) 提供命令；最近改动与代码用于核实文档是否仍成立。

历史过程位于 [历史索引](state/history/INDEX.md)，只在追溯具体决定时检索。历史中的 CURRENT、Next、发布结论均有时间边界，不能覆盖当前用户意图和领域决定。每次交接更新 STATE 快照并链接领域决定或交接记录，不往 STATE 累积流水账。
