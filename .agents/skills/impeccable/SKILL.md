---
name: impeccable
description: Review existing UI in the 2026_v4 CRM using Impeccable visual and technical guidance. Use for page audits, screenshot critique, layout, information hierarchy, usability, accessibility and responsive review. This CRM installation is review-only; it does not implement, redesign or deploy pages, or run automatic hooks.
metadata:
  upstream_version: "4.5.2"
  upstream_commit: "c63b8dd7dd5a5f3c32eaabe1af76d0694f863ed2"
---

# Impeccable — CRM page review

The user chose review-only operation on 2026-10-11. Apply this project adaptation before any upstream playbook. It does not grant permission to edit UI or business data. A later explicit implementation request can change that scope; do not silently enter build, polish, live injection, hook-on, or deploy workflows during a review.

Read [CRM context](reference/crm-review.md) and the relevant existing repository rules. Use the user's screenshot and current source as evidence. Read [audit](reference/audit.md) for technical checks and the relevant criteria in [critique](reference/critique.md) for hierarchy and task clarity. Upstream scoring, interviews, extra agents and follow-up workflows are optional review aids here, not mandatory expansion of a narrow review. Do not invent a score for untested performance, accessibility or mobile behavior.

Keep cwd at the CRM repository. The launcher is project-local:

```sh
sh .agents/skills/impeccable/scripts/impeccable context --target <source-path>
sh .agents/skills/impeccable/scripts/impeccable detect --json <source-path>
sh .agents/skills/impeccable/scripts/impeccable hooks status
```

Run context once when needed and one focused detector pass for a technical audit; reuse its result. Missing PRODUCT.md or DESIGN.md does not block review of an existing page: read the repository and incumbent components directly, without starting an unsolicited product interview or creating a replacement design system. A zero-result detector scan is not proof of good UI, especially for uni-app custom tags and native rendering.

Return a short prioritized list: observed problem, user impact, screenshot or file evidence, and a concrete recommended change. Distinguish visible facts, code-derived risks and untested behavior. Reuse CRM components and tokens in recommendations. Review does not authorize fixes, automatic exceptions, commits or deployment. Ask only for information that is actually missing, not repeated approval for the review itself.

Automatic hooks remain off through `.impeccable/config.json` (`hook.enabled: false`); no provider hook manifest is installed. Do not enable them or run a broad installer/update as a side effect. Any later upgrade must preserve this review-only entrypoint and the disabled hooks setting. Keep official scripts and references unchanged; upstream entrypoint is archived as `SKILL.upstream.md` and source provenance as `upstream.json`.
