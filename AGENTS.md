# 2026_v4 项目入口

这是新拓能源 CRM：uni-app Vue 3 + Vite 前端，uniCloud 支付宝云后端。

按任务选择资料；简单解释、只读查询和文案修改不要求先读完整资料栈。已读且未变化的规则不重复加载：

1. [工程约束与协作契约](docs/RULES.md)。
2. [当前状态](STATE.md)：当前目标、未完成项、实际验证与发布证据。
3. [领域索引](state/INDEX.md)：只读本次涉及的领域决定；账务另读 [会计入口](docs/ACCOUNTING.md)。
4. [README](README.md) 提供命令；最近改动与代码用于核实文档是否仍成立。

历史过程位于 [历史索引](state/history/INDEX.md)，只在追溯具体决定时检索。历史中的 CURRENT、Next、发布结论均有时间边界，不能覆盖当前用户意图和领域决定。只有当前任务、阻塞或发布状态改变时更新 STATE 并链接对应记录，不往 STATE 累积流水账。

`main` 保存已验收基线；`codex/system-trust-foundation` 保留未发布的灌装/PDA/导入候选。先按STATE确认代码所在分支及生产版本；仅在对应候选任务中使用开发分支，不将领域目标当成本分支已实现能力。
