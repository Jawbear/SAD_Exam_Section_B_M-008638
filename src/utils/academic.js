export const EXAM_TERM = Object.freeze({ year: '2026-2027', semester: 1 });

export function normalizeYear(value) {
  const year = String(value ?? '').trim().replace(/[–—]/g, '-');
  const match = /^([1-9]\d{3})-([1-9]\d{3})$/.exec(year);
  return match && Number(match[2]) === Number(match[1]) + 1 ? year : '';
}

export const COUNTS = [
  ['units', 'Enrolled units', 'enrolled_units'],
  ['failed', 'Failed subjects', 'failed_count'],
  ['incomplete', 'Incomplete grades', 'incomplete_count'],
  ['dropped', 'Dropped subjects', 'dropped_count'],
];

export function validateAcademic(values, isCorrection = false) {
  const errors = {};
  const payload = {};
  if (!isCorrection) {
    payload.p_academic_year = normalizeYear(values.academic_year);
    payload.p_semester = Number(values.semester);
    if (!payload.p_academic_year) errors.academic_year = 'Enter consecutive years in YYYY-YYYY format.';
    if (![1, 2].includes(payload.p_semester)) errors.semester = 'Select semester 1 or 2.';
  }

  const gwa = String(values.gwa ?? '').trim();
  payload.p_gwa = Number(gwa);
  if (!/^\d+(?:\.\d{1,2})?$/.test(gwa) || payload.p_gwa < 1 || payload.p_gwa > 5) {
    errors.gwa = 'Enter a GWA from 1.00 to 5.00 with up to two decimal places.';
  }
  for (const [key, label] of COUNTS) {
    const raw = String(values[key] ?? '').trim();
    payload[`p_${key}`] = Number(raw);
    if (!/^\d+$/.test(raw) || Number(raw) > 2147483647) {
      errors[key] = `${label} must be a whole number from 0 to 2,147,483,647.`;
    }
  }
  payload.p_evidence = String(values.evidence ?? '').trim();
  if (!payload.p_evidence || [...payload.p_evidence].length > 500) {
    errors.evidence = 'Enter a grade-document reference of up to 500 characters.';
  }
  return { errors, payload };
}

const manilaFormat = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

export function formatManila(timestamp) {
  return timestamp ? `${manilaFormat.format(new Date(timestamp))} PHT` : '—';
}

export function effectiveAssignment(assignments, year, semester) {
  return assignments.find((assignment) => assignment.effective_academic_year < year
    || (assignment.effective_academic_year === year && assignment.effective_semester <= semester));
}

function isOnTime(submittedAt, deadline) {
  const submitted = Date.parse(submittedAt);
  const due = Date.parse(deadline);
  if (submitted !== due) return submitted < due;
  // PostgreSQL can retain three more fractional digits than JavaScript Date.
  const microsWithinMillisecond = (value) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(3, 6);
  return microsWithinMillisecond(submittedAt) <= microsWithinMillisecond(deadline);
}

export function previewPolicy(program, submission) {
  const maximumGwa = Number(program.maximum_gwa);
  const actualGwa = Number(submission.gwa);
  const checks = [
    ['GWA', actualGwa.toFixed(2), `At most ${maximumGwa.toFixed(2)}`, actualGwa <= maximumGwa],
    ['Enrolled units', submission.enrolled_units, `At least ${program.minimum_units}`, submission.enrolled_units >= program.minimum_units],
    ['Failed subjects', submission.failed_count, `At most ${program.allowed_failed}`, submission.failed_count <= program.allowed_failed],
    ['Incomplete grades', submission.incomplete_count, `At most ${program.allowed_incomplete}`, submission.incomplete_count <= program.allowed_incomplete],
    ['Dropped subjects', submission.dropped_count, `At most ${program.allowed_dropped}`, submission.dropped_count <= program.allowed_dropped],
    ['Original submission deadline', formatManila(submission.submitted_at), formatManila(program.submission_deadline),
      isOnTime(submission.submitted_at, program.submission_deadline)],
  ];
  return checks.map(([label, actual, requirement, passed]) => ({ label, actual, requirement, passed }));
}

export function filterRoster(rows, { search = '', program = '', compliance = '' } = {}) {
  const query = search.trim().toLowerCase();
  return rows.filter((row) => {
    const result = row.submission?.compliance_result;
    return (!query || [row.student_id, row.full_name].some((value) => value?.toLowerCase().includes(query)))
      && (!program || row.program_id === program)
      && (!compliance || (compliance === 'no_submission' ? !row.submission : result === compliance));
  });
}
