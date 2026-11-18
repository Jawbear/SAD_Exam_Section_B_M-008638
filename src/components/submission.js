import { badge, checkTable, detailList, emptyState, escapeHtml as h, historyList, resultsList, table } from './ui.js';
import { formatManila } from '../utils/academic.js';

export function submissionTable(records, view) {
  if (!records.length) return emptyState('No semester submissions yet.');
  return table(['Academic year', 'Semester', 'Submitted (PHT)', 'Verification', 'Compliance', 'Renewal', ''],
    records.map((record) => [
      h(record.academic_year), h(record.semester), h(formatManila(record.submitted_at)),
      badge(record.verification_status), badge(record.compliance_result), badge(record.renewal_decision),
      `<button type="button" class="button button--small button--secondary" data-route="${view}" data-id="${h(record.id)}">${view === 'staff-review' ? 'Review' : 'View'}</button>`,
    ]), 'Semester submission history');
}

export function assignmentTimeline(records) {
  return historyList(records, (record) => `<div class="event-title"><strong>${h(record.program.program_name)}</strong> ${badge(record.award_status)}</div>
    <p>Effective ${h(record.effective_academic_year)}, semester ${h(record.effective_semester)}</p>
    <small>Assigned ${h(formatManila(record.assigned_at))}</small>`, 'No program assignments.');
}

export function currentReview({ submission, verifications, evaluations, renewals }) {
  return {
    evaluation: submission.compliance_result !== 'not_evaluated'
      ? evaluations.find((entry) => entry.revision === submission.revision)
      : null,
    returned: submission.verification_status === 'returned'
      ? verifications.find((entry) => entry.revision === submission.revision && entry.new_status === 'returned')
      : null,
    renewal: submission.renewal_decision !== 'not_decided'
      ? renewals.find((entry) => entry.revision === submission.revision)
      : null,
  };
}

export function reviewHistory({ verifications, evaluations, renewals, corrections }, people = {}) {
  const metadata = (revision, at, actor) => `<small>Revision ${h(revision)} · ${h(formatManila(at))}${people[actor] ? ` · ${h(people[actor])}` : ''}</small>`;
  return `<section class="panel" id="review-history" tabindex="-1" aria-labelledby="audit-title">
    <h2 id="audit-title">Review history</h2>
    <details open><summary>Evidence verification (${verifications.length})</summary>
    ${historyList(verifications, (item) => `<div class="event-title">${badge(item.previous_status)} → ${badge(item.new_status)}</div>
      ${item.reason ? `<p>${h(item.reason)}</p>` : ''}
      ${metadata(item.revision, item.changed_at, item.verified_by)}`, 'No verification changes recorded.')}</details>
    <details><summary>Compliance evaluations (${evaluations.length})</summary>
    ${historyList(evaluations, (item) => `${badge(item.compliance_result)} ${resultsList(item.deficiency_reasons)}
      <details><summary>Recorded policy checks</summary>${checkTable(item.rule_checks)}</details>
      ${metadata(item.revision, item.evaluated_at, item.evaluated_by)}`, 'No evaluations recorded.')}</details>
    <details><summary>Renewal decisions (${renewals.length})</summary>
    ${historyList(renewals, (item) => `${badge(item.decision)} <p>${h(item.decision_notes)}</p>
      ${metadata(item.revision, item.decided_at, item.decided_by)}`, 'No decisions recorded.')}</details>
    <details><summary>Corrections (${corrections.length})</summary>
    ${historyList(corrections, (item) => `<strong>Correction resubmitted</strong>
      <details><summary>Previous academic values</summary>${detailList([
        ['GWA', Number(item.previous_values.gwa).toFixed(2)],
        ['Enrolled units', item.previous_values.enrolled_units],
        ['Failed subjects', item.previous_values.failed_count],
        ['Incomplete grades', item.previous_values.incomplete_count],
        ['Dropped subjects', item.previous_values.dropped_count],
        ['Grade-document reference', item.previous_values.evidence_reference],
      ])}</details>
      ${metadata(item.revision, item.corrected_at, item.corrected_by)}`, 'No corrections recorded.')}</details>
  </section>`;
}
