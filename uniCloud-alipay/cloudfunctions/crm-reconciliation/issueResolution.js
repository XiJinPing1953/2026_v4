'use strict'

// These decisions explain an individual external comparison clue. They never
// alter the comparison, internal integrity checks or approval requirements.
function createIssueResolution({ digest, version }) {
  const clean = ({ issue_key, eligible_resolution_kinds, merge_targets, resolution, ...issue }) => issue
  const keyed = issues => {
    const occurrences = new Map()
    return (issues || []).map(raw => {
      const issue = clean(raw), hash = digest(issue), occurrence = occurrences.get(hash) || 0
      occurrences.set(hash, occurrence + 1)
      return { ...issue, issue_key: 'issue_' + digest([hash, occurrence]).slice(0, 32) }
    })
  }
  const rows = value => (Array.isArray(value) ? value : value ? [value] : [])
  const date = row => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '') ? row.date : ''
  const ids = row => [row?.source_id, row?.adjustment_source?.id, row?.adjustment_source?.receipt_id].filter(Boolean)
  const classification = issue => issue?.type === 'classification' && ['BUSINESS_KIND_DIFFERENCE', 'NONCASH_CLASSIFICATION_CANDIDATE'].includes(issue.code)
  const external = issue => issue?.type === 'unposted' && ['ACCOUNTING_ENTRY_NOT_MATCHED', 'CRM_ENTRY_NOT_MATCHED'].includes(issue.code)
  function relation(issue, target) {
    if (!external(issue) || !classification(target) || issue.issue_key === target.issue_key) return ''
    for (const a of rows(issue.crm)) for (const b of rows(target.crm)) {
      if (date(a) && date(a) === date(b) && ids(a).some(id => ids(b).includes(id))) return 'same_source_date'
    }
    for (const a of rows(issue.accounting)) for (const b of rows(target.accounting)) {
      if (date(a) && date(b) && a.date.slice(0, 7) === b.date.slice(0, 7) && a.account_code && a.account_code === b.account_code &&
          typeof a.voucher === 'string' && a.voucher.trim() && a.voucher === b.voucher) return 'same_voucher_period'
    }
    return ''
  }
  function dateCandidate(issue) {
    const candidates = rows(issue.accounting), crm = issue.crm
    return issue.type === 'date' && issue.code === 'POSSIBLE_DATE_DIFFERENCE' && date(crm) && candidates.length === 1 && date(candidates[0]) &&
      crm.date !== candidates[0].date && crm.debit_milli === candidates[0].debit_milli && crm.credit_milli === candidates[0].credit_milli
  }
  const bound = (resolution, result) => resolution.result_hash === result.result_hash && resolution.source_hash === result.source_hash &&
    resolution.review_inputs_hash === result.review_inputs_hash && resolution.rule_version === result.rule_version && result.rule_version === version
  function carry(previous, result, at) {
    const issues = result.issues || []
    return (previous || []).map(resolution => {
      if (resolution.valid !== true) return resolution // Invalidation is permanent; a reverted source must not revive it.
      const issue = issues.find(item => item.issue_key === resolution.issue_key)
      const target = issues.find(item => item.issue_key === resolution.target_issue_key)
      const valid = result.read_complete === true && !result.stale && bound(resolution, result) && issue &&
        (resolution.kind === 'accepted_date_difference' ? dateCandidate(issue) : Boolean(relation(issue, target)))
      return valid ? resolution : { ...resolution, valid: false, status: 'invalidated', invalidated_at: at,
        invalidated_reason: '来源、对账资料、规则或关联事项已变化，原说明保留，须重新确认' }
    })
  }
  function present(result, stale = result.stale === true) {
    const issues = keyed(result.issues), resolutions = result.issue_resolutions || []
    const effective = new Map()
    const history = resolutions.map(resolution => {
      const current = issues.find(issue => issue.issue_key === resolution.issue_key)
      const target = issues.find(issue => issue.issue_key === resolution.target_issue_key)
      const eligible = current && (resolution.kind === 'accepted_date_difference' ? dateCandidate(current) : Boolean(relation(current, target)))
      const valid = !stale && result.read_complete === true && resolution.valid === true && bound(resolution, result) && eligible
      const projected = { ...resolution, valid: Boolean(valid), status: resolution.valid !== true ? 'invalidated' : valid ? 'applied' : 'needs_recheck' }
      if (valid) effective.set(resolution.issue_key, projected)
      return projected
    })
    const eligibleNow = !stale && result.read_complete === true && result.rule_version === version
    const decorated = issues.map(issue => {
      const targets = eligibleNow && !effective.has(issue.issue_key) ? issues.filter(target => !effective.has(target.issue_key) && relation(issue, target)) : []
      return { ...issue, eligible_resolution_kinds: eligibleNow && !effective.has(issue.issue_key) ?
        [...(dateCandidate(issue) ? ['accepted_date_difference'] : []), ...(targets.length ? ['merged_into_issue'] : [])] : [],
      merge_targets: targets.map(target => ({ issue_key: target.issue_key, message: target.message, code: target.code, relation: relation(issue, target) })) }
    })
    return { ...result, stale, issues: decorated, issue_resolutions: history,
      active_issues: decorated.filter(issue => !effective.has(issue.issue_key)),
      explained_issues: history.map(resolution => ({ ...(decorated.find(issue => issue.issue_key === resolution.issue_key) || resolution.original_issue), resolution })),
      pending_issue_count: decorated.length - effective.size, explained_issue_count: effective.size }
  }
  return { keyed, carry, present }
}

module.exports = { createIssueResolution }
