import assert from 'node:assert/strict';
import { test } from 'node:test';
import { effectiveAssignment, filterRoster, normalizeYear, previewPolicy, validateAcademic } from '../../src/utils/academic.js';
import { isPublishableKey } from '../../src/services/public-key.js';

const valid = {
  academic_year: '2026–2027', semester: '1', gwa: '2.00', units: '18',
  failed: '0', incomplete: '0', dropped: '0', evidence: '  Grade report  ',
};

test('normalizes consecutive years and prepares a new submission', () => {
  assert.equal(normalizeYear(' 2026—2027 '), '2026-2027');
  assert.equal(normalizeYear('2026-2028'), '');
  assert.deepEqual(validateAcademic(valid), {
    errors: {},
    payload: {
      p_academic_year: '2026-2027', p_semester: 1, p_gwa: 2, p_units: 18,
      p_failed: 0, p_incomplete: 0, p_dropped: 0, p_evidence: 'Grade report',
    },
  });
});

test('rejects invalid grade data and leaves the term out of correction payloads', () => {
  const invalid = validateAcademic({
    ...valid, academic_year: '2026-2028', semester: '3', gwa: '2.001', units: '',
    failed: '-1', incomplete: '0.5', dropped: '2147483648', evidence: '   ',
  });
  assert.deepEqual(Object.keys(invalid.errors), [
    'academic_year', 'semester', 'gwa', 'units', 'failed', 'incomplete', 'dropped', 'evidence',
  ]);
  const correction = validateAcademic({ ...valid, academic_year: '', semester: '' }, true);
  assert.deepEqual(correction.errors, {});
  assert.equal('p_academic_year' in correction.payload, false);
  assert.equal('p_semester' in correction.payload, false);
});

test('filters by student ID or name and combines program and compliance', () => {
  const rows = [
    { student_id: 'B01', full_name: 'Avery Cruz', program_id: 'excellence', submission: { compliance_result: 'compliant' } },
    { student_id: 'B02', full_name: 'Blair Santos', program_id: 'access', submission: null },
  ];
  assert.deepEqual(filterRoster(rows, { search: ' b01 ', program: 'excellence', compliance: 'compliant' }), [rows[0]]);
  assert.deepEqual(filterRoster(rows, { search: 'SANTOS', compliance: 'no_submission' }), [rows[1]]);
  assert.deepEqual(filterRoster(rows, { program: 'access', compliance: 'compliant' }), []);
});

test('accepts browser credentials and rejects privileged credentials', () => {
  const key = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(isPublishableKey('sb_publishable_example'), true);
  assert.equal(isPublishableKey(key('anon')), true);
  assert.equal(isPublishableKey(key('service_role')), false);
  assert.equal(isPublishableKey('sb_secret_example'), false);
  assert.equal(isPublishableKey('header.invalid.signature'), false);
});

test('selects the applicable assignment for the requested semester', () => {
  const assignments = [
    { id: 'future', effective_academic_year: '2027-2028', effective_semester: 1 },
    { id: 'later', effective_academic_year: '2026-2027', effective_semester: 2 },
    { id: 'current', effective_academic_year: '2026-2027', effective_semester: 1 },
  ];
  assert.equal(effectiveAssignment(assignments, '2026-2027', 1)?.id, 'current');
  assert.equal(effectiveAssignment(assignments, '2026-2027', 2)?.id, 'later');
  assert.equal(effectiveAssignment(assignments, '2025-2026', 2), undefined);
});

test('shows advisory checks against the assigned policy and observes the exact deadline', () => {
  const policy = {
    maximum_gwa: '2.50', minimum_units: 15, allowed_failed: 0, allowed_incomplete: 0, allowed_dropped: 1,
    submission_deadline: '2026-11-06T09:00:00+00:00',
  };
  const grades = { gwa: '2.50', enrolled_units: 15, failed_count: 0, incomplete_count: 0, dropped_count: 1 };
  const onDeadline = previewPolicy(policy, { ...grades, submitted_at: '2026-11-06T17:00:00+08:00' });
  const late = previewPolicy(policy, { ...grades, submitted_at: '2026-11-06T09:00:00.000001Z' });
  assert.ok(onDeadline.every(({ passed }) => passed));
  assert.deepEqual(late.filter(({ passed }) => !passed).map(({ label }) => label), ['Original submission deadline']);
});
