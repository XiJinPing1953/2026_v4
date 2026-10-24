# 客户改用 kg 后的历史流量入口

2026-10-24 用户说明客户原按流量、现按 kg 结算后无法查看流量表，并确认“保留历史流量只读入口、销售明细显示历史流量单、当前 m³ 客户保持录入”的修复方案。

## 实现

- `CustomerStatementModule.vue` 原以当前 `default_price_unit === m3` 同时控制录入、历史列表、销售明细合并和净欠款来源。结算后端本来就按客户返回有效历史流量单，修复仅调整前端展示条件。
- 当前非 m³ 且返回历史流量单时显示“历史流量”页签；展示表数、气量、金额及分页，标明只读，隐藏新增、编辑、删除和该类历史行的快捷抹零操作。
- 销售明细与净欠款来源保留历史流量行；按后端原未收值判断是否有欠款，0.001元不因两位取整而被隐藏。流量行在历史列表、销售明细、账务流水统一显示三位金额，表数沿用四位。
- 当前 m³ 的录入表单保持；无历史流量的普通 kg 客户不增加入口。当前计价档案、后端账务计算、原单和收付款均不修改。
- 本地隔离预览增加“流量转 kg”模拟场景，含三位金额、四位表数及0.001元未收；模拟数据不进入正常构建。

## 验证

- `node --test scripts/statementWorkspace.test.cjs scripts/accountingFrontend.test.cjs scripts/customerAdjustmentFrontend.test.cjs preview/statement/mock.test.mjs`：35项通过。
- H5构建通过；本地 Chrome 挂载真实组件验证普通 kg 无流量入口、流量转 kg 历史只读、分页及销售明细和净欠款来源中三位金额/0.001元未收、现用 m³ 仍有结算日期/表数/预览/生成结算单。
- 截图在本地 `output/flow-history-20261024/`，使用合成数据。没有把模拟预览当真实客户历史核验。

## 正式发布与回读

- 用户随后明确“发布”。H5源码已提交主线 `da382aeab5b59f09ba2746210b77771e41d43cc9`，发布版本 `2026.10.24-customer-flow-history`，buildId `1792808716893-ed405295`。
- 从该提交创建干净隔离工作区，绑定支付宝 `env-00jxuffegf2n` 构建并生成清单；`checkReleaseIntegrity --product=web --require-clean` 通过，清单 `sourceDirty:false`。当前工作区其他未提交改动未进入发布。
- 通过 HBuilderX CLI 将独立静态候选目录上传正式静态托管；219/219文件成功，退出码0。依赖范围只核对现有 `crm-customer-settlement`，未上传云函数或schema，未改业务数据，未打包PDA。
- 发布后218项网页资源回读通过，包含17项托管层CSS前导CRLF差异；逐文件按本次构建绑定的源/交付哈希策略核验，其他资源精确匹配。正式域名和空间静态域名的 `index.html`、`version.json` 均200且哈希一致。
- sourceDigest `e450f56068c9505c5320f9194faf98dec95f464d7ffb8bb7f005cd2792c5e9ad`；artifactDigest `5c0ee579eba0de5de2088d3b1ebea8d3636acfc90c08c8776f903c0013fccd33`。
- 本地证据：`output/flow-history-20261024/` 下的 `release-build.log`、`upload-completion.json`、`web-readback.json`、`web-public-readback.json`、`web-delivery-policy.json` 及其哈希、`web-candidate/`。最初沙箱网络失败记录保留在 `web-readback-error.json`；随后联网重跑成功，以最终回读收据为准。

## 正式 Chrome 验收

- 用户完成登录后刷新原正式标签页，页面自动切换到入口 `index-CEQ7Ozjv.js`。东丰庄饺子馆当前仍为kg、默认8元/kg，出现“历史流量”页签及“当前按kg结算，仅供查看”提示。
- 历史页共9条、每页5条；2026-09-20单显示应收/未收412.845元，上次表数6298.0270、本次6380.5960、用气82.5690m³。页面没有新增、编辑、删除入口。
- 销售明细共13条，瓶装销售与历史流量单同时可见；9月20日、9月3日等流量金额保留三位。仅查看页面和切换页签，未提交业务操作。
- 正式截图 `live-history.jpg`、`live-history-detail.jpg`，以及 `live-history-ax.txt`、`live-sales-ax.txt` 保存在同一证据目录。Chrome已留在东丰庄“历史流量”页；当前m³录入兼容性由此前本地真实组件场景验证，未提交真实流量测试单。

## 回退

发布前线上buildId `1792773604486-2187b19b`、源码 `71c9cbaf26ebcb404e65c7fdabf0084ac5d4d687`，`production-before.json` 已留存。完整旧包位于 `outputs/trust-audit/2026-10-24-operating-brief-validation/web-candidate/`，发布前核对其artifactDigest为 `aa9f9fd62c2badd9a6630bf30a9a8bb5be8bd9f4c858530f6403c95206131013`，与线上一致；如需回退，重新上传该完整包并执行同等回读。无数据库回滚事项。
