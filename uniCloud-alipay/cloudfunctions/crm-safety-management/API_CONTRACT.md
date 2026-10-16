# 安全管理接口 v1

云函数 `crm-safety-management`。请求 `{action,token,data}`，结果 `{code:0,data}`；400 输入问题，401 未登录，403 权限，409 修订冲突。业务日期均 `YYYY-MM-DD`，北京时间。默认厂站 `XTNY-001`。所有新台账 `signature_status:'pending_signature'`。

- `getConfigV1 {station_id?}` → `{config,categories,supplement_definitions,permissions,users}`。config `{station_id,station_name,enabled_from,roles:{safety_officer:[],safety_director:[],principal:[]},special_equipment:[],revision}`。users 仅管理员返回账号 `{_id,name,username}`，permissions `{configure, daily, weekly, monthly, view, export}`，写权限要求实际业务岗位绑定；超级管理员仅配置/查看/导出。
- `saveConfigV1 {station_id?,expected_revision,config,revision_reason}` → config。启用日必填；角色数组为账号 ID，必须是有效用户。
- `getDailyV1 {station_id?,date}` → `{record,supplement,snapshot,stale,permissions}`。snapshot `{date,station_id,station_name,categories,inspections,issues,historical_pending,observations,missing,complete,source_fingerprint,summary}`。category `{id,name,issues:完整当天问题[],checks:[{source_type,source_id,item_code,label,result_code,note,evidence,related_categories,hazard_ids}]}`。inspections 原记录数组；issues 唯一隐患数组（当天异常/复见/新发现）；historical_pending 历史未结；summary 含 inspection_count/issue_count。record 可为 null，已核对时 `{revision,snapshot,source_fingerprint,content_status:'checked',signature_status,checked_at,checked_by,zero_report,revision_reason}`。原证据变化时 stale=true，原快照不改写。
- `saveSupplementV1 {station_id?,date,expected_revision,revision_reason,items}` → supplement。items 完整数组或部分数组（按 code 合并）`{code,result_code,note,reason,evidence:[{type:'record'|'url'|'file',value,label}],hazard_ids:[],details:{types,location,approval,monitor,measures}}`。S01～S12、S13a/b/c、S14；空 result_code 是待完成；normal/abnormal/not_conducted/not_running/not_applicable；条件结果须 reason，异常须 note 且关联已登记隐患才算完成。S01 有作业需 details.location/approval/monitor/measures；S14 未配置设施可 not_applicable，其他条件由真实 reason 说明。新补充为空，未填不推定正常。
- `confirmDailyV1 {station_id?,date,expected_revision,source_fingerprint,zero_report:boolean,revision_reason}` → record。需完整检查和补充；zero_report 仅无当日问题与未解决历史问题；任何一次异常均保留；核对非签字。首次 expected_revision=0，之后必填原因。
- `listDailyV1 {station_id?,start_date,end_date}` → `{days:[{date,status,inspection_count,issue_count,signature_status,revision}],enabled_from}`，最多93天；status=not_enabled/no_inspection/incomplete/pending_signature/recheck_required。
- `getWeeklyV1 {station_id?,date}` → `{record,period:{start_date,end_date},statistics,previous,stale,permissions}`（date所在周一～周日）。`saveWeeklyV1 {station_id?,date,expected_revision,source_fingerprint,revision_reason,content}` → record。content `{actual_date,organizer,participants,started_at,ended_at,scope,site_findings,execution_evaluation,repeated_problem_analysis,system_gaps,next_plan,management_issues:[{type,description,risk_level:'general'|'elevated'|'major',responsible_name,measure,due_date}],hazard_ids:[]}`。空内容可保存草稿，填写完整后 `content_status:'complete'`；统计快照、修订保留。新隐患先 registerIssueV1 source_type=weekly。
- `getMonthlyV1 {station_id?,month:'YYYY-MM'}` → 同 weekly，period自然月，previous含上月纪要以复用决议。`saveMonthlyV1 {station_id?,month,expected_revision,source_fingerprint,revision_reason,content}` → record。content `{actual_date,started_at,ended_at,title,location,host,recorder,participants,absences,previous_decisions,accidents_and_near_misses,safety_situation,major_risks,special_work,training,expenditure,emergency_management,contractors,causes,principal_summary,decisions:[{subject,department,responsible_name,due_date,status,implementation}]}`。不得预填已召开；无签字。
- `registerIssueV1 {station_id?,date,client_submission_id,source_type:'supplement'|'weekly',source_item_code,source_id?,existing_hazard_id?,recurrence_of?,issue_note,hazard_level:'general'|'major',responsible_name,planned_measure,planned_complete_date,evidence:[],management_category:1..7,report?:{reported_at,recipient,method,requirements},onsite_rectification?:{measures,rectified_at,recheck_note,rechecked_at},temporary_controls?}` → `{hazard_id,observation_id,duplicate}`。实际 discovered_at 可传毫秒（日期须匹配），不传为当前时间且date须当天。关联仅限本厂站未关闭隐患；再次发现关闭隐患必须 recurrence_of 新建。紧急登记不依赖日表是否完整；登记成功可将 hazard_id 放到补充项。上报/当场整改独立实际事实，不推断销号。
- `exportV1 {kind:'daily'|'weekly'|'monthly',station_id?,date?,month?,format:'snapshot'|'xlsx'}` → snapshot 时 `{kind,document,status,generated_at}`，xlsx 时另外 `{file_id,file_name,url}`。导出未完成/未签认明确状态；日表 document 含当日完整 snapshot 和当前 record，周/月含 record/统计。浏览器按 snapshot 打印，Excel 服务端生成与相同材料一致。

所有更改使用 expected_revision；首次0。服务端只接受白名单字段，旧版本保存到 `crm_safety_revisions`。统计及导出取完整分页源数据，页面不得用局部列表代替。不把实际岗位签认和内容核对混为一谈。

- `listRevisionsV1 {station_id?,kind:'config'|'supplement'|'daily'|'weekly'|'monthly',record_id}` → `{current,revisions:[{revision,snapshot,replaced_at,replaced_by,revision_reason}]}`；按版本降序返回所有旧版，另按具体kind核验页面权限。
- 周月 `source_fingerprint` 必须取用户已读取/刷新核对的返回值；来源变化返回409，不自动套用更新后的统计。
- `statistics` 字段：expected_days/inspected_days/checked_days，missing_days/incomplete_days日期数组，daily完整日历来源，new_hazard_count/verified_closed_count/rectification_rate(null|ratio)/rectification_rate_label，new_hazards/reobservations/reobserved_hazards/recurrence/historical_pending。首次发现计唯一隐患；同日第二次明确观察计复见，来源修订不计复见。
- snapshot.categories 每类 `issues` 保留当日登记问题（含已销号、后次正常或来源更正）；主表不得仅按当前checks异常生成摘要。snapshot.checks reason与note各自完整保留。
- 日表来源指纹含补充历史版本；先记异常后改正常不能清除未登记的问题。正常保存后的再次提交补充必须显式revision_reason。

- 周排查紧急登记支持 `source_period_start`（所选统计周周一），实际date/discovered_at独立按发现日记录。已保存报告的source_id可用于跨周实际排查；未保存草稿用source_period_start确定稳定来源ID。observation.source_revision为当前已存来源版本，来源未存时为0（未绑定），不猜测未来版本。
- historical_pending按所选日期/统计截至日期是否已具备实际复查销号证据判定，返回status为截至当日状态、current_status为当前状态、as_of_date与closure_time_unverified提示；后来关闭不消除早先未结事实。S12与零报告使用同一截至日期口径。statistics增加as_of_date、historical_progress保留历史问题本期整改上报复查事实。
- 复见补充顶层report/on_site_rectification时保存hazard.source_revisions并递增revision；较早补记仅保留在本次observation，不覆盖较新顶层处置。

## 巡检内七类工作流 v1（2026-10-16）

岗位账号及启用日期继续为空；保存检查事实不等于核对日表或签署。下列来源绑定入口允许 `原巡检本人 + /pages/station-safety-inspection/form:create` 在未启用时保存事实。已启用并配置的安全员且有 daily:update 可补齐其他巡检。超级管理员身份不自动取得业务写权限。读取他人记录另需 daily:view。既有 confirmDailyV1/周月权限和启用校验不变。

- `getInspectionWorkflowV1 {inspection_id}` → `{inspection,workflow,source_revision,supplement_revision,definitions,coverage,items,missing,complete,open_hazards,reference_suggestions,permissions:{write,daily},observation}`。inspection 的旧记录 category_code 仅作读取补齐，不写回原单。
- `saveInspectionWorkflowV1 {inspection_id,source_revision,expected_revision,revision_reason,workflow}` → 同上完整 bundle。expected_revision 为整日 supplement 修订号；新记录 0。每次事实绑定原巡检版本，修改需原因，事务保存旧版及新版。同请求重试幂等；原巡检版本或整日修订冲突返回 409。
- `registerInspectionIssueV1 {inspection_id,...registerIssueV1其他字段}` → `{hazard_id,observation_id,duplicate}`。后端锁定来源为本巡检日期的 supplement；实际观察加 inspection_id/inspection_revision，沿用同一隐患整改台账及幂等提交编号。

`workflow`：

- `version:1,observed_at:number`：北京时间业务日内真实确认时刻，不能早于本次实际结束。后续巡检需有自己的确认，不从早晨“无”推断全天无。
- `special_work:[{type,conducted:'yes'|'no'|'',events:[{id,name,location,started_at,ended_at,approval,monitor,measures,result_code,note,evidence,hazard_ids}]}]`：type=hot_work/confined_space/height/lifting/temporary_power/other，逐项必答；有才展开多个事件。正在开展结束可 0，跨日作业须与业务日相交。
- `activities:{filling,unloading,receiving,reports}`，每项 yes/no/空。装卸一个选择驱动 S13a/b/c；无按时刻生成未开展说明，不生成正常。
- `checks:[{code,result_code,note,evidence,hazard_ids,details}]`：S04 details=personnel/qualification/briefing；S06=before/during/after/measurement/exceptions(yes/no)/exception_handling/scope_trace；S09=labels；S11=source/received_at/content；S13a=hose/connections；S13b=personnel/before_after/process；S13c=weather/conditions。旧模板 S02/S05/S07/S08/S10 可实际补查，details.scope 必填；不按旧照片推断新版已查。组正常不能含“发现问题”“待核实”“不符合”子项。
- `certificate_scope_confirmed:boolean,certificate_checks:[{id,equipment,reference_no,valid_until,verification:'unchanged'|'changed'|'missing'|'',result_code,note,evidence,hazard_ids}]`：明确确认已核定完整适用范围；空清单不算正常；正常需要真实编号、有效日期、核验状态和引用依据。变更需说明及新证据。
- `controls:[{hazard_id,implemented:'yes'|'no'|'',changed:'yes'|'no'|'',note,evidence}]`：逐个未关闭隐患核对；新增或状态变化晚于最后确认时刻会再次待核，不把早上无待办延用到下午。未落实或有变化须说明。
- `facilities:[{code,name,present:'yes'|'no'|'unknown'|'',result_code,note,evidence,hazard_ids}]`：code=expansion/rupture_disc/flame_arrester/nonmetal_lining/other。四个已列类型逐项核定；unknown 不等于无；已配置设施必须在实际清单对应。有才检查，无单列不适用。
- `reference_sources:[{inspection_id,source_revision,observed_at,workflow_fingerprint}]`：同日已发生事实明确引用。后端核验来源和版本；异常检查或事件须与所引用源内容一致才可复用原隐患观察，内容变化需本次实际观察。

`reference_suggestions` 仅供显式引用，不自动完成：已核验证书清单、已核定设施清单（各行附 verified_by/verified_at/source_inspection_id/source_revision）；`same_day_workflow` 和 `same_day_source`（已有作业事件和检查依据）；`legacy_items`（既有补充事实，仍按原范围）。本次人员、现场条件、未关闭隐患变化以及此前“无”的时点判断需重新确认。已保存已开展事件及异常不能在后续改成无或正常而抹除。

`coverage` 数组 `{code,label,status:'covered'|'pending',source_refs,result_code,missing}`：仅 v4 模板各组全部规定原项都已检查才能覆盖 S02/S05/S07/S08/S10。`items` 为 16 组权威派生结果，含 `covered_by_inspection,source_type,source_id,source_revision,observed_at,observed_by_name,detail_text,details,missing`。detail_text 包含子项结论及北京时间，用于打印/Excel。

日表 `category.coverage`：`inspection_item_count` 独立原项目数；`inspection_record_count` 原记录条次；`covered_group_count` 已覆盖组数；`supplement_group_count` 补充组数；`result_counts:{normal,abnormal,not_running,not_conducted,not_applicable,pending}` 排除自动覆盖组的重复计数；`pending:[{item_code,label,messages,inspection_id}]` 指向具体待补项。日报仍一日一份，包含各次工作流观察；未开展、不适用与正常分列，缺项不写进隐患等级栏。
