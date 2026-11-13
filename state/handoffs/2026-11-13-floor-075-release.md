# 地秤1.0.75发布与bench08启用回读

用户先自行刷bench08并设“蠕变=1”，要求回读通过后发布1.0.75。首次回读发现R10仍0；按用户追加授权由Mac单次精确写1，立即回读与用户断电重启后的回读均通过，随后完成App发布。

- **App已发布**：1.0.75/176，源码`87d05fceec5696b5c2ab87295da852526f0cbe80`已推main。只更新WGT；未发crm-filling、H5、APK、schema，未写业务记录。231项相关回归、7项发布范围测试及模板视觉检查复用同一候选证据。
- WGT `crm-pda-1.0.75-ed580233dc8f.wgt`，564282字节，SHA256 `ed580233dc8f5cbca59cadab0d3784a341cd395b68fc2a841826b04ab4fbbf4e`。支付宝空间`env-00jxuffegf2n`，仅上传`pda-updates/`新包，再切换`latest.json`。公网下载逐字节/SHA1/SHA256/资源版本均匹配；更新清单12字段全部一致。上传日志各1成功、0失败。线上1.0.74包和指针已在切换前备份并验证。
- **主板启用值已保存**：用户报告bench08刷写成功（文件SHA `fdbcbf1b45941f597740fb1d7e4998059c3b307746903c44545838029795419b`；没有设备Flash哈希读回）。18:53 Mac只发送一次FC06 `0106000a00016808`，收到原样应答；之后5次R10=1。用户断电约10秒再通电，18:56只读20/20请求成功，10次R10仍1。关键可读参数保持：保存零点37557、Q/R=50/500，未归零/标定。
- 首次厂家工具设置后仍0的具体原因未证实；最终bench08完整FC06原生分发、Flash保存、无FC03采样刷新、启动重载及错误帧拒绝离线补查通过。不需要为该问题重复刷板。
- **设备验收边界**：Mac串口均已释放。当前未接传感器，动态1d跟踪及修后卸载显示尚未做真机验收。PDA USB已连接，底包只读为1.0.72/173，资源版不由底包推断；未替用户安装WGT，设备资源版本待用户在首页更新后确认。
- **回退依据**：生产目录`rollback/`保存1.0.74原包/原指针。已安装新版的PDA不能直接通过普通更新器降级，需同源码构建更高资源版或按受控安装处理。主板交付目录另存最后记录的bench06文件，不冒充当前板Flash备份；回退bench06时R10须恢复0。

证据：`outputs/trust-audit/2026-11-13-floor-fix/production/release-receipt.json`、`public-wgt-check.json`、`pointer-after-switch.json`；主板`bench08-r10-enable/`、`bench08-after-power-cycle/`；刷前备份`output/dsx-bench08/parameters-before.json`。实现与测试见[修复记录](2026-11-13-floor-fix.md)，主板细节见[固件交接](2026-11-13-dsx-tracking-fix.md)。
