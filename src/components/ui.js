import { formatManila } from '../utils/academic.js';
import { icon } from './icons.js';

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const h = escapeHtml;

const statuses = {
  pending: ['Pending', 'amber'],
  verified: ['Verified', 'green'],
  returned: ['Returned', 'red'],
  not_evaluated: ['Not Evaluated', 'neutral'],
  compliant: ['Compliant', 'green'],
  with_deficiency: ['With Deficiency', 'red'],
  not_decided: ['Not Decided', 'neutral'],
  approved: ['Approved', 'green'],
  held: ['Held', 'amber'],
  no_submission: ['No submission', 'neutral'],
  Active: ['Active', 'green'],
  Inactive: ['Inactive', 'neutral'],
  pass: ['Pass', 'green'],
  fail: ['Fail', 'red'],
};

export function badge(key) {
  const [label, color] = statuses[key] ?? ['—', 'neutral'];
  return `<span class="badge badge--${color}"><span aria-hidden="true"></span>${label}</span>`;
}

export function field(key, label, control, hint = '') {
  const required = /\srequired(?:\s|>)/.test(control);
  return `<div class="field">
    <label for="${key}">${h(label)}${required ? ' <span class="required" aria-hidden="true">*</span>' : ''}</label>
    ${hint ? control.replace(`aria-describedby="${key}-error"`, `aria-describedby="${key}-hint ${key}-error"`) : control}
    ${hint ? `<span class="hint" id="${key}-hint">${h(hint)}</span>` : ''}
    <span class="field-error" id="${key}-error" aria-live="polite"></span>
  </div>`;
}

export function input(key, value = '', attributes = '') {
  return `<input id="${key}" name="${key}" value="${h(value)}" aria-describedby="${key}-error" ${attributes}>`;
}

export function select(key, options, selected = '', attributes = '') {
  return `<select id="${key}" name="${key}" aria-describedby="${key}-error" ${attributes}>
    ${options.map(([value, label]) =>
      `<option value="${h(value)}"${String(value) === String(selected) ? ' selected' : ''}>${h(label)}</option>`).join('')}
  </select>`;
}

export function semesterSelect(selected, key = 'semester') {
  return select(key, [[1, 'Semester 1'], [2, 'Semester 2']], selected, 'required');
}

function setFieldError(control, error = '') {
  if (!control?.name) return;
  const feedback = control.form.querySelector(`#${CSS.escape(control.name)}-error`);
  if (!feedback) return;
  if (feedback.textContent !== error) feedback.textContent = error;
  if (error) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
}

export function setFieldErrors(form, errors) {
  for (const control of form.elements) {
    if (control.name) setFieldError(control, errors[control.name]);
  }
  const [first] = Object.keys(errors);
  if (first) form.elements.namedItem(first)?.focus();
}

const valuesOf = (form) => Object.fromEntries(new FormData(form));

export function validateAsYouType(form, validate) {
  const update = ({ target }) => {
    if (target.name) setFieldError(target, validate(valuesOf(form))[target.name]);
  };
  form.addEventListener('focusout', update);
  form.addEventListener('input', () => {
    const invalid = form.querySelectorAll('[aria-invalid]');
    if (!invalid.length) return;
    const errors = validate(valuesOf(form));
    for (const control of invalid) setFieldError(control, errors[control.name]);
  });
}

export function formMessage(form, message = '') {
  const element = form.querySelector('[data-form-message]');
  element.textContent = message;
  element.hidden = !message;
}

export function message(error) {
  if (error?.status === 429) return 'Too many requests. Wait a moment and try again.';
  if (error instanceof TypeError || error?.name === 'AuthRetryableFetchError' || error?.message?.includes('fetch failed')) {
    return 'The service could not be reached. Check the connection and try again.';
  }
  return error?.message || 'The operation could not be completed.';
}

const initialFormValues = new WeakMap();

export function hasUnsavedChanges(root) {
  return [...root.querySelectorAll('form[data-guard]')].some((form) =>
    initialFormValues.has(form) && initialFormValues.get(form) !== JSON.stringify(valuesOf(form)));
}

export function onForm(form, action, busyLabel = 'Saving…') {
  if (form.hasAttribute('data-guard')) initialFormValues.set(form, JSON.stringify(valuesOf(form)));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.saving) return;
    formMessage(form);
    const values = valuesOf(form);
    const buttons = [...form.querySelectorAll('button[type="submit"]')].filter((button) => !button.disabled);
    const submitter = event.submitter ?? buttons[0];
    const originalLabel = submitter?.innerHTML;
    form.dataset.saving = 'true';
    form.setAttribute('aria-busy', 'true');
    buttons.forEach((button) => { button.disabled = true; });
    if (submitter) submitter.innerHTML = `<span class="spinner" aria-hidden="true"></span>${h(busyLabel)}`;
    try {
      await action(values, event.submitter);
    } catch (error) {
      formMessage(form, message(error));
    } finally {
      delete form.dataset.saving;
      form.removeAttribute('aria-busy');
      buttons.forEach((button) => { button.disabled = false; });
      if (submitter) {
        submitter.innerHTML = originalLabel;
        if (submitter.isConnected && document.activeElement === document.body) submitter.focus();
      }
    }
  });
}

export function confirmAction(title, description, label, danger = false) {
  const dialog = document.querySelector('#action-dialog');
  if (dialog.open) return Promise.resolve(false);
  dialog.querySelector('#dialog-title').textContent = title;
  dialog.querySelector('#dialog-description').textContent = description;
  const button = dialog.querySelector('#dialog-confirm');
  button.textContent = label;
  button.className = `button button--${danger ? 'danger' : 'primary'}`;
  dialog.returnValue = '';
  return new Promise((complete) => {
    dialog.addEventListener('close', () => complete(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

export const formAlert = `<p class="notice notice--error" role="alert" data-form-message hidden></p>`;

export function emptyState(text, symbol = 'file') {
  return `<div class="empty"><span class="icon-tile">${icon(symbol)}</span><p>${h(text)}</p></div>`;
}

export function metric(label, value, symbol, tone = 'green', action = '') {
  const contents = `<span class="icon-tile">${icon(symbol)}</span>${action ? `<span class="metric-arrow">${icon('arrow')}</span>` : ''}
    <span class="metric-label">${h(label)}</span><strong>${value}</strong>`;
  return action ? `<button type="button" class="metric metric--${tone}" ${action}>${contents}</button>`
    : `<div class="metric metric--${tone}">${contents}</div>`;
}

export function pageTitle(title, description = '', action = '') {
  return `<div class="page-heading">
    <div><h1>${h(title)}</h1>${description ? `<p>${h(description)}</p>` : ''}</div>
    ${action}
  </div>`;
}

export function detailList(pairs) {
  return `<dl class="facts">${pairs.map(([label, value]) =>
    `<div><dt>${h(label)}</dt><dd>${h(value)}</dd></div>`).join('')}</dl>`;
}

export function policyContent(program) {
  return detailList([
    ['Maximum GWA', Number(program.maximum_gwa).toFixed(2)],
    ['Minimum units', program.minimum_units],
    ['Failed subjects allowed', program.allowed_failed],
    ['Incomplete grades allowed', program.allowed_incomplete],
    ['Dropped subjects allowed', program.allowed_dropped],
    ['Grade document', program.evidence_required ? 'Reference required' : 'Optional'],
    ['Submission deadline', formatManila(program.submission_deadline)],
  ]);
}

export function resultsList(reasons = []) {
  return reasons.length
    ? `<ul class="reasons">${reasons.map((reason) => `<li>${h(reason)}</li>`).join('')}</ul>`
    : '';
}

export function table(headers, rows, label) {
  return `<div class="table-scroll" role="region" aria-label="${h(label)}" tabindex="0">
    <table><caption class="sr-only">${h(label)}</caption>
    <thead><tr>${headers.map((title) => `<th scope="col">${h(title)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>`;
}

export function statusSummary(submission) {
  return `<dl class="status-grid">
    <div><dt>Verification</dt><dd>${badge(submission.verification_status)}</dd></div>
    <div><dt>Compliance</dt><dd>${badge(submission.compliance_result)}</dd></div>
    <div><dt>Renewal decision</dt><dd>${badge(submission.renewal_decision)}</dd></div>
  </dl>`;
}

export function recordDetails(submission) {
  return detailList([
    ['Academic year', submission.academic_year],
    ['Semester', submission.semester],
    ['Original submission', formatManila(submission.submitted_at)],
    ['Revision', submission.revision],
    ['GWA', Number(submission.gwa).toFixed(2)],
    ['Enrolled units', submission.enrolled_units],
    ['Failed subjects', submission.failed_count],
    ['Incomplete grades', submission.incomplete_count],
    ['Dropped subjects', submission.dropped_count],
  ]);
}

export function evidenceReference(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password) {
      return `<a class="evidence-link" href="${h(url.href)}" target="_blank" rel="noopener noreferrer">${h(value)}</a>`;
    }
  } catch {
    // A grade-document identifier is also a valid reference.
  }
  return `<span class="evidence-link">${h(value)}</span>`;
}

export function checkTable(checks) {
  return table(['Requirement', 'Scholar value', 'Policy requirement', 'Result'],
    checks.map((entry) => [
      h(entry.label), h(entry.actual), h(entry.requirement), badge(entry.passed ? 'pass' : 'fail'),
    ]), 'Academic policy checks');
}

export function historyList(items, render, empty) {
  return items.length
    ? `<ol class="timeline">${items.map((item) => `<li>${render(item)}</li>`).join('')}</ol>`
    : `<p class="muted">${h(empty)}</p>`;
}
