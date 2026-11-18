import { icon } from '../components/icons.js';
import { COUNTS, effectiveAssignment, EXAM_TERM, formatManila, previewPolicy, validateAcademic } from '../utils/academic.js';
import { assignments, read, submissionDetails, submissions } from '../services/scholarship.js';
import { assignmentTimeline, currentReview, reviewHistory, submissionTable } from '../components/submission.js';
import {
  badge, checkTable, confirmAction, detailList, emptyState, escapeHtml as h, evidenceReference, field, formAlert,
  input, metric, onForm, pageTitle, policyContent, recordDetails, resultsList, semesterSelect, setFieldErrors,
  statusSummary, validateAsYouType,
} from '../components/ui.js';

const dashboardButton = `<button type="button" class="button button--secondary" data-route="scholar-home">${icon('back')} Dashboard</button>`;
const historyButton = `<button type="button" class="button button--secondary" data-route="scholar-history">${icon('history')} View history</button>`;

function submitButton(programs) {
  const canSubmit = programs.some((assignment) => assignment.award_status === 'Active');
  return canSubmit ? `<button type="button" class="button button--primary" data-route="scholar-submit">${icon('plus')} Submit grades</button>`
    : `<div class="unavailable-action"><button type="button" class="button button--primary" disabled aria-describedby="submit-unavailable">${icon('plus')} Submit grades</button>
      <small id="submit-unavailable">An active program assignment is required.</small></div>`;
}

function policyPanel(program, submission, evaluation) {
  if (!program) return `<section class="panel"><h2>Scholarship requirements</h2>
    ${emptyState('The Scholarship Office has not assigned a program for this semester.', 'cap')}</section>`;
  return `<section class="panel policy-card"><div class="section-heading"><div><h2>Scholarship requirements</h2>
    <p class="muted">${h(program.program_name)}</p></div><span class="icon-tile">${icon('cap')}</span></div>
    ${submission ? `${evaluation ? '' : '<p class="section-note">These checks are for reference. The official result is recorded after evidence verification and staff evaluation.</p>'}
      ${checkTable(evaluation?.rule_checks ?? previewPolicy(program, submission))}` : policyContent(program)}
  </section>`;
}

export async function scholarHome(ctx) {
  const [programs, records] = await Promise.all([
    assignments(ctx.client, ctx.profile.id), submissions(ctx.client, ctx.profile.id),
  ]);
  const current = records.find(({ academic_year, semester }) => academic_year === EXAM_TERM.year && semester === EXAM_TERM.semester);
  const latest = current ?? records[0];
  const assignment = effectiveAssignment(programs, EXAM_TERM.year, EXAM_TERM.semester);
  const recordProgram = latest ? programs.find(({ id }) => id === latest.assignment_id)?.program : assignment?.program;
  const official = latest?.compliance_result && latest.compliance_result !== 'not_evaluated'
    ? await read(ctx.client.from('evaluation_history').select('rule_checks').eq('submission_id', latest.id).eq('revision', latest.revision).maybeSingle()) : null;
  const returned = latest?.verification_status === 'returned';
  ctx.mount(`<section class="welcome-panel">
      <div><p class="term-label">${icon('calendar')} AY ${h(EXAM_TERM.year)} · Semester ${h(EXAM_TERM.semester)}</p>
        <h1>Welcome, ${h(ctx.profile.full_name)}</h1>
        <p>${h(ctx.profile.student_id)} · ${h(assignment?.program.program_name ?? 'Program assignment pending')}</p></div>
      ${submitButton(programs)}
    </section>
    <section class="metric-grid scholar-metrics" aria-label="Scholarship summary">
      ${metric('Scholarship program', h(assignment?.program.program_name ?? 'Unassigned'), 'cap')}
      ${metric('Submission verification', badge(latest?.verification_status ?? 'no_submission'), 'shield', 'amber')}
      ${metric('Academic compliance', badge(latest?.compliance_result ?? 'not_evaluated'), 'clipboard', 'info')}
      ${metric('Renewal decision', badge(latest?.renewal_decision ?? 'not_decided'), 'check')}
    </section>
    <section class="panel submission-overview">
      <div class="section-heading"><div><h2>${current ? 'Current submission' : 'Latest submission'}</h2>
        ${latest ? `<p class="muted">AY ${h(latest.academic_year)} · Semester ${h(latest.semester)}</p>` : ''}</div>${historyButton}</div>
      ${latest ? `${detailList([
        ['GWA', Number(latest.gwa).toFixed(2)], ['Enrolled units', latest.enrolled_units],
        ['Failed subjects', latest.failed_count], ['Incomplete grades', latest.incomplete_count], ['Dropped subjects', latest.dropped_count],
        ['Submitted (PHT)', formatManila(latest.submitted_at)],
      ])}
      <div class="section-footer"><div><span class="muted">Evidence status</span> ${badge(latest.verification_status)}</div>
        <div class="actions"><button class="button button--secondary" type="button" data-route="scholar-record" data-id="${h(latest.id)}">View submission ${icon('arrow')}</button>
          ${returned ? `<button class="button button--primary" type="button" data-route="scholar-correct" data-id="${h(latest.id)}">Correct submission</button>` : ''}</div></div>`
    : emptyState('No semester grades have been submitted yet.')}
    </section>
    ${policyPanel(recordProgram, latest, official)}`);
}

export async function scholarSubmissions(ctx) {
  const [programs, records] = await Promise.all([
    assignments(ctx.client, ctx.profile.id), submissions(ctx.client, ctx.profile.id),
  ]);
  ctx.mount(`${pageTitle('Submissions', 'View semester records and correct submissions returned by staff.', submitButton(programs))}
    <section class="panel"><h2>Semester records</h2>${submissionTable(records, 'scholar-record')}</section>`);
}

export async function scholarHistory(ctx) {
  const [programs, records] = await Promise.all([
    assignments(ctx.client, ctx.profile.id), submissions(ctx.client, ctx.profile.id),
  ]);
  ctx.mount(`${pageTitle('History', 'Review previous submissions and scholarship assignments.')}
    <section class="panel"><h2>Submission history</h2>${submissionTable(records, 'scholar-record')}</section>
    <section class="panel"><h2>Program assignment history</h2>${assignmentTimeline(programs)}</section>`);
}

export async function scholarRecord(ctx, { id }) {
  const details = await submissionDetails(ctx.client, id);
  const { submission } = details;
  const { evaluation, returned, renewal } = currentReview(details);
  ctx.mount(`${pageTitle('Semester submission', `${submission.academic_year} · Semester ${submission.semester}`, dashboardButton)}
    <div class="layout-two">
      <section class="panel">
        <h2>Academic record</h2>
        ${recordDetails(submission)}
        <h3>Grade-document reference</h3>${evidenceReference(submission.evidence_reference)}
      </section>
      <section class="panel">
        <h2>Review outcome</h2>
        ${statusSummary(submission)}
        ${returned ? `<div class="notice notice--error"><strong>Correction requested</strong><p>${h(returned.reason)}</p></div>
          <button class="button button--primary" type="button" data-route="scholar-correct" data-id="${h(id)}">Correct submission</button>` : ''}
        ${evaluation?.deficiency_reasons.length
          ? `<h3>Deficiency reasons</h3>${resultsList(evaluation.deficiency_reasons)}` : ''}
        ${renewal ? `<h3>Decision notes</h3><p class="long-text">${h(renewal.decision_notes)}</p>` : ''}
      </section>
    </div>
    ${policyPanel(submission.assignment.program, submission, evaluation)}
    ${reviewHistory(details)}`);
}

export async function scholarForm(ctx, { id } = {}) {
  const correction = Boolean(id);
  const [details, programs, records] = await Promise.all([
    correction ? submissionDetails(ctx.client, id) : null,
    correction ? [] : assignments(ctx.client, ctx.profile.id),
    correction ? [] : submissions(ctx.client, ctx.profile.id),
  ]);
  const record = details?.submission;
  if (correction && record.verification_status !== 'returned') {
    ctx.go('scholar-record', { id, notice: 'Only a returned submission can be corrected.' });
    return;
  }
  const returned = details && currentReview(details).returned;
  const cancel = correction
    ? `<button type="button" class="button button--secondary" data-route="scholar-record" data-id="${h(id)}">Cancel</button>`
    : `<button type="button" class="button button--secondary" data-route="scholar-home">Cancel</button>`;
  const title = correction ? 'Correct semester grades' : 'Submit semester grades';
  if (!ctx.mount(`${pageTitle(title, 'Enter the values from your supporting grade document.', dashboardButton)}
    <section class="panel form-panel">
      ${!correction && !programs.some(({ award_status }) => award_status === 'Active') ? emptyState('An active program assignment is required to submit grades.', 'cap') : ''}
      ${returned ? `<div class="notice notice--error"><strong>Correction requested</strong><p>${h(returned.reason)}</p></div>` : ''}
      ${correction ? `<p class="section-note">${h(record.academic_year)} · Semester ${h(record.semester)} · Originally submitted ${h(formatManila(record.submitted_at))}</p>` : ''}
      <form id="academic-form" data-guard novalidate>
        <p class="required-note">Fields marked <span class="required">*</span> are required.</p>
        <fieldset ${!correction && !programs.some(({ award_status }) => award_status === 'Active') ? 'disabled' : ''}>
        <div class="form-grid">
          ${correction ? '' : field('academic_year', 'Academic year', input('academic_year', EXAM_TERM.year, 'required maxlength="9" placeholder="2026-2027"'), 'Use YYYY-YYYY.')
            + field('semester', 'Semester', semesterSelect(EXAM_TERM.semester))}
          ${field('gwa', 'General Weighted Average (GWA)', input('gwa', record ? Number(record.gwa).toFixed(2) : '', 'type="number" inputmode="decimal" min="1" max="5" step="0.01" required'), '1.00 is best, 3.00 is passing, and 5.00 is failing.')}
          ${COUNTS.map(([key, label, column]) => field(key, label,
            input(key, record?.[column] ?? (key === 'units' ? '' : 0),
              'type="number" inputmode="numeric" min="0" max="2147483647" step="1" required'))).join('')}
          <div class="form-wide">${field('evidence', 'Grade-document reference', input('evidence',
            record?.evidence_reference, 'maxlength="500" required'), 'Enter a grade-document ID or a link staff can access.')}</div>
        </div>
        ${formAlert}
        <div class="actions">
          <button type="submit" class="button button--primary">${correction ? 'Resubmit correction' : 'Submit grades'} ${icon('arrow')}</button>
        </div>
        </fieldset>
        <div class="form-cancel">${cancel}</div>
      </form>
    </section>`)) return;

  const form = ctx.root.querySelector('#academic-form');
  const validate = (values) => {
    const { errors, payload } = validateAcademic(values, correction);
    if (!correction && !errors.academic_year && !errors.semester) {
      const year = payload.p_academic_year;
      const semester = payload.p_semester;
      if (records.some((entry) => entry.academic_year === year && entry.semester === semester)) {
        errors.semester = 'You already have a submission for this academic year and semester.';
      } else if (effectiveAssignment(programs, year, semester)?.award_status !== 'Active') {
        errors.semester = 'No active scholarship assignment applies to this semester.';
      }
    }
    return { errors, payload };
  };
  validateAsYouType(form, (values) => validate(values).errors);
  onForm(form, async (values) => {
    const { errors, payload } = validate(values);
    setFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    const confirmed = await confirmAction(correction ? 'Resubmit correction?' : 'Submit semester grades?',
      correction ? 'The updated record will return to Pending verification.'
        : 'Staff will review your grade-document reference and submitted academic values.',
      correction ? 'Resubmit correction' : 'Submit grades');
    if (!confirmed) return;
    const submitted = await read(correction
      ? ctx.client.rpc('scholar_correct_grades', { ...payload, p_submission_id: id, p_revision: record.revision })
      : ctx.client.rpc('scholar_submit_grades', payload));
    ctx.go('scholar-record', {
      id: submitted,
      notice: correction ? 'Correction resubmitted for verification.' : 'Grades submitted for verification.',
    });
  }, 'Submitting…');
}
