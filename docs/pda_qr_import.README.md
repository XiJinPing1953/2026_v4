# PDA 主数据补码脚本

## 推荐顺序
1. 先审计当前二维码现状  
   `node scripts/auditPdaQrMasters.cjs --space-id <spaceId>`
2. 先做 dry-run  
   `node scripts/upsertBottlePdaQrCodes.cjs --space-id <spaceId>`
3. 确认 report 无误后再执行写入  
   `node scripts/upsertBottlePdaQrCodes.cjs --execute --space-id <spaceId>`

## 脚本列表
- 钢瓶 `pda_qr_code`：`scripts/upsertBottlePdaQrCodes.cjs`
- 客户 `qr_code`：`scripts/upsertCustomerQrCodes.cjs`
- 配送员 `qr_code`：`scripts/upsertDeliveryQrCodes.cjs`
- 车辆 `qr_code`：`scripts/upsertVehicleQrCodes.cjs`
- 全量审计：`scripts/auditPdaQrMasters.cjs`

## 输入模板
- [pda_qr_bottles.csv](/Users/wangbo/Downloads/2026_v4/docs/pda_qr_bottles.csv)
- [customer_qr_codes.csv](/Users/wangbo/Downloads/2026_v4/docs/customer_qr_codes.csv)
- [delivery_qr_codes.csv](/Users/wangbo/Downloads/2026_v4/docs/delivery_qr_codes.csv)
- [vehicle_qr_codes.csv](/Users/wangbo/Downloads/2026_v4/docs/vehicle_qr_codes.csv)

## 约束
- 只更新二维码字段，不创建新档案。
- 不处理历史灌装单、销售单、流转记录。
- 建议先做 20-50 只钢瓶和少量活跃客户/配送员/车辆试点。
