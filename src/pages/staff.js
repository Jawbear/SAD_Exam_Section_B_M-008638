import { filterRoster, normalizeYear } from '../utils/academic.js';
import { allRows, assignments, read, submissionDetails, submissions } from '../services/scholarship.js';
import { icon } from '../components/icons.js';
import { assignmentTimeline, currentReview, reviewHistory, submissionTable } from '../components/submission.js';
import {
  badge, checkTable, confirmAction, detailList, emptyState, escapeHtml as h, evidenceReference, field, formAlert, input,
  metric, onForm, pageTitle, recordDetails, resultsList, select, semesterSelect, setFieldErrors, statusSummary, table,
} from '../components/ui.js';

const backButton = (route, name) => `<button type="button" class="button button--secondary" data-route="${route}">${icon('back')} ${name}</button>`;
const directoryBack = backButton('staff-directory', 'Scholars');
const registerButton = `<button type="button" class="button button--primary" data-route="staff-register">${icon('plus')} Register scholar</button>`;
const programOptions = (programs) => programs.map(({ id, program_name }) => [id, program_name]);
const programsQuery = (client) => client.from('scholarship_programs').select('id, program_name').order('program_name');
const textArea = (key) => `<textarea id="${key}" name="${key}" aria-describedby="${key}-error" rows="3" maxlength="1000" required></textarea>`;
const termYear = (key, value) => field(key, 'Academic year', input(key, value, 'required maxlength="9"'), 'Use YYYY-YYYY.');
const searchField = (id) => field(id, 'Search scholars', `<div class="search-input">${icon('search')}
  ${input(id, '', 'type="search" placeholder="Name or student ID"')}</div>`);

const workspaces = {
  'staff-home': { title: 'Staff dashboard', heading: 'Semester roster' },
  'staff-submissions': { title: 'Submissions', heading: 'Semester submissions', description: 'Open grade records and review their current status.', rows: (row) => Boolean(row.submission) },
  'staff-verification': { title: 'Verification', heading: 'Evidence queue', description: 'Review grade-document references and return evidence that needs correction.', section: 'verification', rows: (row) => Boolean(row.submission) },
  'staff-compliance': { title: 'Compliance', heading: 'Verified submissions', description: 'Evaluate verified records against stored scholarship requirements.', section: 'compliance', rows: (row) => row.submission?.verification_status === 'verified' },
  'staff-renewal': { title: 'Renewal decisions', heading: 'Evaluated submissions', description: 'Review compliance and record scholarship renewal decisions.', section: 'renewal', rows: (row) => row.submission?.verification_status === 'verified' && row.submission.compliance_result !== 'not_evaluated' },
  'staff-reports': { title: 'Reports & history', heading: 'Semester outcomes', description: 'Find semester outcomes and open the audit history for a record.', section: 'history' },
};

function rosterRows(rows, term, section, hasRecords) {
  return rows.length ? table(
    ['Scholar', 'Program', 'Academic term', 'Verification', 'Compliance', 'Renewal', 'Action'],
    rows.map((row) => {
      const submission = row.submission;
      const route = submission ? 'staff-review' : 'staff-scholar';
      return [
        `<strong>${h(row.full_name)}</strong><small class="cell-subtitle"><span class="sr-only">Student ID </span>${h(row.student_id)}</small>`, h(row.program_name),
        `<strong>${h(term.year)}</strong><small class="cell-subtitle">Semester ${h(term.semester)}</small>`,
        badge(submission?.verification_status ?? 'no_submission'),
        submission ? badge(submission.compliance_result) : '—',
        submission ? badge(submission.renewal_decision) : '—',
        `<button type="button" class="button button--secondary button--small" data-route="${route}" data-id="${h(submission?.id ?? row.scholar_id)}"
          ${submission && section ? `data-section="${section}"` : ''} aria-label="${submission ? 'Review submission for' : 'View'} ${h(row.full_name)}">${submission ? 'Review' : 'View'} ${icon('arrow')}</button>`,
      ];
    }), 'Scholarship semester roster') : hasRecords ? emptyState('No scholars match the selected filters.', 'search')
      : emptyState('No records are available for this semester.');
}

export async function staffHome(ctx, options = {}) {
  const term = ctx.staffTerm;
  const workspace = workspaces[ctx.view];
  const isHome = ctx.view === 'staff-home';
  const [dashboard, programs] = await Promise.all([
    read(ctx.client.rpc('staff_dashboard', { p_academic_year: term.year, p_semester: term.semester })),
    read(programsQuery(ctx.client)),
  ]);
  const all = workspace.rows ? dashboard.rows.filter(workspace.rows) : dashboard.rows;
  const header = isHome ? `<section class="welcome-panel"><div>
      <p class="term-label">${icon('calendar')} AY ${h(term.year)} · Semester ${h(term.semester)}</p>
      <h1>Staff dashboard</h1><p>Monitor submissions, academic compliance, and scholarship renewal.</p>
    </div>${registerButton}</section>` : pageTitle(workspace.title, workspace.description);
  if (!ctx.mount(`${header}
    ${isHome ? `<section class="metric-grid" aria-label="Semester summary">
      ${metric('Total assigned scholars', h(dashboard.total_assigned), 'users', 'info', 'data-route="staff-reports"')}
      ${metric('Pending verification', h(dashboard.pending), 'clock', 'amber', 'data-route="staff-verification"')}
      ${metric('Compliant scholars', h(dashboard.compliant), 'shield', 'green', 'data-route="staff-compliance" data-filter="compliant"')}
      ${metric('Scholars with deficiency', h(dashboard.with_deficiency), 'warning', 'red', 'data-route="staff-compliance" data-filter="with_deficiency"')}
    </section>` : ''}
    <section class="panel roster-panel">
      <div class="section-heading roster-heading"><div><h2>${workspace.heading}</h2><span id="roster-count" class="muted" role="status"></span></div>
        <form id="term-form" class="term-selector" aria-label="Select a semester" novalidate>
          <div class="filters">
            ${field('term_year', 'Academic year', input('term_year', term.year, 'required maxlength="9"'))}
            ${field('term_semester', 'Semester', semesterSelect(term.semester, 'term_semester'))}
            <button type="submit" class="button button--secondary">Apply semester</button>
          </div>${formAlert}
        </form>
      </div>
      <div class="filters" id="roster-filters">
        ${searchField('roster_search')}
        ${field('program_filter', 'Program', select('program_filter', [['', 'All programs'], ...programOptions(programs)]))}
        ${field('compliance_filter', 'Compliance', select('compliance_filter', [
          ['', 'All results'], ...(ctx.view === 'staff-renewal' ? [] : [['not_evaluated', 'Not Evaluated']]),
          ['compliant', 'Compliant'], ['with_deficiency', 'With Deficiency'],
          ...(workspace.rows ? [] : [['no_submission', 'No submission']]),
        ], options.filter ?? ''))}
        ${['staff-compliance', 'staff-renewal'].includes(ctx.view) ? '' : field('verification_filter', 'Verification', select('verification_filter', [
          ['', 'All statuses'], ['pending', 'Pending'], ['verified', 'Verified'], ['returned', 'Returned'],
        ], ctx.view === 'staff-verification' ? 'pending' : ''))}
        <button type="button" class="button button--secondary" id="clear-filters">Clear filters</button>
      </div>
      <div id="roster-records"></div>
      <div class="pagination" id="roster-pagination" hidden>
        <span class="muted" id="roster-page" role="status"></span>
        <div class="actions"><button type="button" class="button button--small button--secondary" id="previous-page">Previous</button>
          <button type="button" class="button button--small button--secondary" id="next-page">Next</button></div>
      </div>
    </section>`)) return;

  const termForm = ctx.root.querySelector('#term-form');
  onForm(termForm, (values) => {
    const year = normalizeYear(values.term_year);
    const semester = Number(values.term_semester);
    const errors = {};
    if (!year) errors.term_year = 'Enter consecutive years in YYYY-YYYY format.';
    if (![1, 2].includes(semester)) errors.term_semester = 'Choose a valid semester.';
    setFieldErrors(termForm, errors);
    if (!Object.keys(errors).length) ctx.go(ctx.view, { term: { year, semester } });
  });
  const filters = ctx.root.querySelector('#roster-filters');
  const pager = ctx.root.querySelector('#roster-pagination');
  const previous = pager.querySelector('#previous-page');
  const next = pager.querySelector('#next-page');
  const verificationFilter = filters.querySelector('#verification_filter');
  const pageSize = 10;
  let page = 0;
  const renderRows = () => {
    const verification = verificationFilter?.value;
    const rows = filterRoster(all, {
      search: filters.querySelector('#roster_search').value,
      program: filters.querySelector('#program_filter').value,
      compliance: filters.querySelector('#compliance_filter').value,
    }).filter((row) => !verification || row.submission?.verification_status === verification);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.min(page, pages - 1);
    ctx.root.querySelector('#roster-count').textContent = `${rows.length} of ${all.length} scholars`;
    ctx.root.querySelector('#roster-records').innerHTML = rosterRows(rows.slice(page * pageSize, (page + 1) * pageSize), term, workspace.section, all.length > 0);
    pager.hidden = pages === 1;
    pager.querySelector('#roster-page').textContent = `Page ${page + 1} of ${pages}`;
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;
  };
  const resetPage = () => { page = 0; renderRows(); };
  filters.addEventListener('input', resetPage);
  ctx.root.querySelector('#clear-filters').addEventListener('click', () => {
    for (const control of filters.querySelectorAll('input, select')) control.value = '';
    resetPage();
  });
  previous.addEventListener('click', () => { page -= 1; renderRows(); });
  next.addEventListener('click', () => { page += 1; renderRows(); });
  renderRows();
}

export async function staffDirectory(ctx) {
  const records = await allRows(() => ctx.client.from('user_profiles')
    .select('id, full_name, student_id, email').eq('role', 'scholar').order('full_name').order('student_id'));
  if (!ctx.mount(`${pageTitle('Scholar directory', 'Manage scholar profiles and scholarship program assignments.', registerButton)}
    <section class="panel">
      <div class="filters">
        ${searchField('directory_search')}
        <button type="button" class="button button--secondary" id="clear-directory">Clear search</button>
      </div>
      <div id="directory-records"></div>
    </section>`)) return;
  const search = ctx.root.querySelector('#directory_search');
  const renderRows = () => {
    const rows = filterRoster(records, { search: search.value });
    ctx.root.querySelector('#directory-records').innerHTML = rows.length
      ? table(['Student ID', 'Scholar', 'Email', ''], rows.map((record) => [
        h(record.student_id), h(record.full_name), h(record.email),
        `<button type="button" class="button button--secondary button--small" data-route="staff-scholar" data-id="${h(record.id)}">View scholar</button>`,
      ]), 'Scholar directory') : emptyState('No scholars match this search.', 'search');
  };
  search.addEventListener('input', renderRows);
  ctx.root.querySelector('#clear-directory').addEventListener('click', () => { search.value = ''; search.focus(); renderRows(); });
  renderRows();
}

function assignmentFields(programs, term) {
  return `${field('program', 'Scholarship program', select('program', [['', 'Select a program'], ...programOptions(programs)], '', 'required'))}
    ${termYear('academic_year', term.year)}
    ${field('semester', 'Effective semester', semesterSelect(term.semester))}`;
}

function assignmentInput(values, errors) {
  const year = normalizeYear(values.academic_year);
  if (!year) errors.academic_year = 'Enter consecutive years in YYYY-YYYY format.';
  if (!values.program) errors.program = 'Select a scholarship program.';
  const semester = Number(values.semester);
  if (![1, 2].includes(semester)) errors.semester = 'Choose a valid semester.';
  return { p_program_id: values.program, p_academic_year: year, p_semester: semester };
}

export async function staffRegister(ctx) {
  const programs = await read(programsQuery(ctx.client));
  if (!ctx.mount(`${pageTitle('Register scholar', 'Create a scholar profile and its first program assignment.', directoryBack)}
    <section class="panel form-panel">
      <form id="register-form" data-guard novalidate>
        <p class="required-note">Fields marked <span class="required">*</span> are required.</p>
        <div class="form-grid">
          ${field('full_name', 'Full name', input('full_name', '', 'required maxlength="120" autocomplete="off"'))}
          ${field('student_id', 'Student ID', input('student_id', '', 'required maxlength="40" autocomplete="off"'))}
          ${field('email', 'Email address', input('email', '', 'type="email" required maxlength="254" autocomplete="off"'),
            'Use the address on the scholar’s confirmed Supabase Auth account.')}
          ${assignmentFields(programs, ctx.staffTerm)}
        </div>
        ${formAlert}
        <div class="actions"><button type="submit" class="button button--primary">Register scholar</button>${directoryBack}</div>
      </form>
    </section>`)) return;
  const form = ctx.root.querySelector('#register-form');
  onForm(form, async (values) => {
    const errors = {};
    const term = assignmentInput(values, errors);
    if (!values.full_name.trim()) errors.full_name = 'Enter the scholar’s name.';
    if (!values.student_id.trim()) errors.student_id = 'Enter the student ID.';
    if (!values.email.trim() || !form.elements.email.validity.valid) errors.email = 'Enter a valid email address.';
    setFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    const id = await read(ctx.client.rpc('staff_register_scholar', {
      ...term, p_full_name: values.full_name, p_student_id: values.student_id, p_email: values.email,
    }));
    ctx.go('staff-scholar', { id, notice: 'Scholar registered and program assigned.' });
  });
}

export async function staffScholar(ctx, { id }) {
  const [person, history, records, programs] = await Promise.all([
    read(ctx.client.from('user_profiles').select('id, full_name, student_id, email, auth_user_id')
      .eq('role', 'scholar').eq('id', id).maybeSingle()),
    assignments(ctx.client, id), submissions(ctx.client, id), read(programsQuery(ctx.client)),
  ]);
  if (!person) throw new Error('This scholar could not be found.');
  if (!ctx.mount(`${pageTitle(person.full_name, `Student ID ${person.student_id}`, directoryBack)}
    <div class="layout-two">
      <section class="panel"><h2>Scholar information</h2>
        ${detailList([['Student ID', person.student_id], ['Email', person.email],
          ['Account', person.auth_user_id ? 'Linked' : 'Awaiting first confirmed sign-in']])}
        <h3>Program assignments</h3>${assignmentTimeline(history)}
      </section>
      <section class="panel"><h2>Assign program</h2>
        <form id="assignment-form" data-guard novalidate>
          <div class="form-grid">${assignmentFields(programs, ctx.staffTerm)}</div>
          ${formAlert}
          <button type="submit" class="button button--primary">Save assignment</button>
        </form>
      </section>
    </div>
    <section class="panel"><h2>Submission history</h2>${submissionTable(records, 'staff-review')}</section>`)) return;
  const form = ctx.root.querySelector('#assignment-form');
  onForm(form, async (values) => {
    const errors = {};
    const payload = assignmentInput(values, errors);
    setFieldErrors(form, errors);
    if (Object.keys(errors).length) return;
    await read(ctx.client.rpc('staff_assign_program', { ...payload, p_scholar_id: id }));
    ctx.go('staff-scholar', { id, notice: 'Program assignment saved.' });
  });
}

function verificationActions(submission, returned) {
  if (submission.verification_status === 'returned') {
    return `<p class="muted">Waiting for the scholar to resubmit.</p>
      ${returned ? `<p class="long-text">${h(returned.reason)}</p>` : ''}`;
  }
  return `${submission.verification_status === 'pending' ? `<form id="verify-evidence-form">
    ${formAlert}<button type="submit" class="button button--primary">${icon('shield')} Verify evidence</button>
  </form>` : '<p class="muted">Evidence is verified.</p>'}
    <details class="return-details"><summary>Return for correction</summary>
      <form id="return-evidence-form" data-guard novalidate>
        ${field('return_reason', 'Reason for return', textArea('return_reason'))}
        ${formAlert}<button type="submit" class="button button--danger">Return for correction</button>
      </form>
    </details>`;
}

function evaluationActions(submission, evaluation, checks) {
  if (!checks) return `<div class="unavailable-action"><p class="muted" id="evaluation-unavailable">Verify the evidence before evaluating compliance.</p>
    <button type="button" class="button button--secondary" disabled aria-describedby="evaluation-unavailable">Save evaluation</button></div>`;
  const reasons = checks.filter((entry) => !entry.passed).map((entry) => entry.failure_reason);
  return `${evaluation ? badge(evaluation.compliance_result) : '<p class="section-note">Review the proposed checks before saving the evaluation.</p>'}
    ${checkTable(checks)}
    ${reasons.length ? `<h3>Deficiency reasons</h3>${resultsList(reasons)}` : ''}
    ${submission.compliance_result === 'not_evaluated' ? `<form id="evaluate-form">
      ${formAlert}<button type="submit" class="button button--primary">Save evaluation</button>
    </form>` : ''}`;
}

function renewalActions(submission, renewal, evaluation) {
  if (submission.compliance_result === 'not_evaluated') {
    return `<div class="unavailable-action"><p class="muted" id="renewal-unavailable">Verify evidence and save an evaluation before deciding renewal.</p>
      <button type="button" class="button button--secondary" disabled aria-describedby="renewal-unavailable">Save decision</button></div>`;
  }
  const decisions = [['', 'Select a decision']];
  if (submission.compliance_result === 'compliant') decisions.push(['approved', 'Approve']);
  decisions.push(['held', 'Hold']);
  return `<div class="review-outcomes"><div><span class="muted">Compliance</span> ${badge(submission.compliance_result)}</div>
    <div><span class="muted">Current decision</span> ${badge(submission.renewal_decision)}</div></div>
    ${evaluation?.deficiency_reasons.length ? resultsList(evaluation.deficiency_reasons) : ''}
    ${renewal ? `<p class="long-text">${h(renewal.decision_notes)}</p>` : ''}
    <form id="renewal-form" data-guard novalidate>
      ${field('decision', 'Decision', select('decision', decisions, '', 'required'),
        submission.compliance_result === 'compliant' ? '' : 'Only verified, compliant submissions can be approved.')}
      ${field('decision_notes', 'Decision notes', textArea('decision_notes'))}
      ${formAlert}<button type="submit" class="button button--primary">Save decision</button>
    </form>`;
}

async function historyPeople(client, details) {
  const actors = [...new Set([
    ...details.verifications.map((entry) => entry.verified_by),
    ...details.evaluations.map((entry) => entry.evaluated_by),
    ...details.renewals.map((entry) => entry.decided_by),
    ...details.corrections.map((entry) => entry.corrected_by),
  ])];
  const people = [];
  for (let index = 0; index < actors.length; index += 50) {
    people.push(...await read(client.from('user_profiles').select('id, full_name').in('id', actors.slice(index, index + 50))));
  }
  return Object.fromEntries(people.map((row) => [row.id, row.full_name]));
}

export async function staffReview(ctx, { id, section }) {
  const details = await submissionDetails(ctx.client, id);
  const { submission } = details;
  const { evaluation, returned, renewal } = currentReview(details);
  const primary = { p_submission_id: id, p_revision: submission.revision };
  const [person, checks, people] = await Promise.all([
    read(ctx.client.from('user_profiles').select('full_name, student_id').eq('id', submission.scholar_id).single()),
    evaluation?.rule_checks ?? (submission.verification_status === 'verified'
      ? read(ctx.client.rpc('staff_preview_compliance', primary)) : null),
    historyPeople(ctx.client, details),
  ]);
  const returnRoute = { verification: 'staff-verification', compliance: 'staff-compliance', renewal: 'staff-renewal', history: 'staff-reports' };
  if (!ctx.mount(`${pageTitle('Review submission', `${person.full_name} · ${person.student_id} · ${submission.academic_year} · Semester ${submission.semester}`,
    backButton(returnRoute[section] ?? 'staff-submissions', 'Back to records'))}
    <nav class="review-navigation" aria-label="Submission review sections">
      ${[['verification', 'Evidence', 'shield'], ['compliance', 'Compliance', 'clipboard'], ['renewal', 'Renewal', 'check'], ['history', 'History', 'history']]
        .map(([key, label, symbol]) => `<button type="button" class="button button--secondary" data-jump="review-${key}">${icon(symbol)} ${label}</button>`).join('')}
    </nav>
    <div class="layout-two">
      <section class="panel" id="review-verification" tabindex="-1">
        <h2>Academic record</h2>
        <p class="section-note">${h(submission.assignment.program.program_name)}</p>
        ${recordDetails(submission)}
        <button type="button" class="button button--secondary" data-route="staff-scholar" data-id="${h(submission.scholar_id)}">View scholar</button>
      </section>
      <section class="panel">
        <h2>Evidence verification</h2>
        ${statusSummary(submission)}
        <h3>Grade-document reference</h3>
        <p>${evidenceReference(submission.evidence_reference)}</p>
        ${verificationActions(submission, returned)}
      </section>
    </div>
    <section class="panel" id="review-compliance" tabindex="-1">
      <h2>Compliance evaluation</h2>
      ${evaluationActions(submission, evaluation, checks)}
    </section>
    <section class="panel" id="review-renewal" tabindex="-1">
      <h2>Scholarship renewal</h2>
      <p class="section-note">${h(person.full_name)} · ${h(submission.assignment.program.program_name)}</p>
      ${renewalActions(submission, renewal, evaluation)}
      <button type="button" class="button button--secondary button--small" data-jump="review-history">View decision history</button>
    </section>
    ${reviewHistory(details, people)}`)) return;

  const mutate = async (method, notice, reviewSection, args = {}) => {
    await read(ctx.client.rpc(method, { ...primary, ...args }));
    ctx.go('staff-review', { id, notice, section: section ?? reviewSection });
  };
  const verifyForm = ctx.root.querySelector('#verify-evidence-form');
  if (verifyForm) onForm(verifyForm, async () => {
    if (await confirmAction('Verify this evidence?', 'This records your verification and makes the submission eligible for compliance evaluation.', 'Verify evidence')) {
      await mutate('staff_verify_evidence', 'Evidence verified.', 'verification', { p_status: 'verified' });
    }
  });
  const returnForm = ctx.root.querySelector('#return-evidence-form');
  if (returnForm) onForm(returnForm, async (values) => {
    const reason = values.return_reason.trim();
    setFieldErrors(returnForm, reason ? {} : { return_reason: 'Enter a reason before returning the evidence.' });
    if (reason && await confirmAction('Return this submission?', 'The scholar will see the reason and can resubmit a correction. Current review outcomes will be cleared.', 'Return submission', true)) {
      await mutate('staff_verify_evidence', 'Evidence returned for correction.', 'verification', { p_status: 'returned', p_reason: reason });
    }
  });
  const evaluateForm = ctx.root.querySelector('#evaluate-form');
  if (evaluateForm) onForm(evaluateForm, async () => {
    if (await confirmAction('Record the compliance evaluation?', 'The scholar will be able to view the result and any deficiencies.', 'Save evaluation')) {
      await mutate('staff_evaluate_compliance', 'Compliance evaluation saved.', 'compliance');
    }
  });
  const renewalForm = ctx.root.querySelector('#renewal-form');
  if (renewalForm) onForm(renewalForm, async (values) => {
    const errors = {};
    if (!values.decision) errors.decision = 'Choose a renewal decision.';
    if (!values.decision_notes.trim()) errors.decision_notes = 'Enter decision notes.';
    setFieldErrors(renewalForm, errors);
    if (Object.keys(errors).length) return;
    const label = values.decision === 'approved' ? 'Approve renewal' : 'Hold renewal';
    if (!await confirmAction(`${label}?`, 'The decision and your notes will be visible to the scholar and recorded in the audit history.', label)) return;
    await mutate('staff_decide_renewal', 'Renewal decision saved.', 'renewal', {
      p_decision: values.decision, p_notes: values.decision_notes,
    });
  });
}
