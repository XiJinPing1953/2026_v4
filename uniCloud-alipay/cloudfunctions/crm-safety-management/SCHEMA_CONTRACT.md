# Root schema integration contract

全部集合仅云函数可读写，前端直接读写 false。以下 fields 是最终 service.js/store.js 持久化字段；所有台账 signature_status 固定 pending_signature。对象 snapshot/content/statistics/observation 保留嵌套源版本，不能丢未知原单展示字段。

各主记录共有：`_id:string,station_id:string,revision:int,revision_reason:string,request_fingerprint:string,signature_status:string,created_at:timestamp,created_by:string,updated_at:timestamp,updated_by:string,updated_by_name:string`。_id 为 sha256 确定ID，collection逻辑唯一键仍建议索引。

- `crm_safety_management_config`：共有字段 + `station_name:string,enabled_from:string(YYYY-MM-DD),roles:object{safety_officer:string[],safety_director:string[],principal:string[]},special_equipment:string[]`。唯一station_id。
- `crm_safety_supplements`：共有字段 + `date:string,classification_version:int,content_status:'draft',items:object[]`。items含code/category_code/label/standard/result_code/note/reason strings,evidence object[],hazard_ids string[],details object；唯一station_id,date。
- `crm_safety_daily_records`：共有字段 + `station_name:string,date:string,snapshot:object,source_fingerprint:string,zero_report:boolean,content_status:'checked',checked_at:timestamp,checked_by:string,checked_by_name:string,source_refs:object[]`。唯一station_id,date。
- `crm_safety_weekly_reports`：共有字段 + `station_name:string,period:object{start_date,end_date},period_key:string,content:object,missing:string[],content_status:'draft'|'complete',statistics:object,source_fingerprint:string,previous_record_id:string,previous_revision:int,previous_decisions:object[],source_refs:object[]`。唯一station_id,period_key。
- `crm_safety_monthly_minutes`：字段同weekly。唯一station_id,period_key。
- `crm_safety_revisions`：`_id:string,kind:string,record_id:string,station_id:string,revision:int,snapshot:object,replaced_at:timestamp,replaced_by:string,revision_reason:string`。唯一kind,record_id,revision。
- `crm_safety_issue_events`：`_id:string,station_id:string,date:string,client_submission_id:string,source_type:string,source_id:string,hazard_id:string,request_fingerprint:string,observation:object,created_at:timestamp,created_by:string`。唯一station_id,client_submission_id；索引station_id,date。

扩展现有 `crm_station_safety_hazards`：service registerIssue 新建完整所有旧required字段，新增 `source_type,source_id,source_item_code,first_discovered_at,first_discovered_date,category_code,category_label_snapshot,classification_version,recurrence_of,observations,report,on_site_rectification`。report/on_site_rectification无事实可null（如schema不允许null则根本不写，告诉我调整）。新增隐患 responsible_signature_file_id=''，不强制补充签字；共享原有整改和复查销号流程不变。observation `{observation_key,source_type,source_id,source_revision,item_code,observed_at,observed_date,issue_note,photo_file_ids,evidence,category_code,report,on_site_rectification,temporary_controls,observed_by,observed_by_name}`。

目前字段新增 hazard_id 不能按source_id+source_item唯一，因为同一补充组可实际发现多个独立问题；遗留inspection_id+item_code唯一仍满足（新item_code组code+client提交ID）。新配置、补充、日周月修订使用 database.startTransaction() 原子保存旧版和新版；issue事件和hazard写同一事务幂等。
