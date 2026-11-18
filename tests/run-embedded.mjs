import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const project = new URL('../', import.meta.url);
const migrations = new URL('supabase/migrations/', project);
const profile = (number) => `20000000-0000-4000-8000-00000000000${number}`;
const submission = (number) => `40000000-0000-4000-8000-00000000000${number}`;
const authUser = (number) => `50000000-0000-4000-8000-00000000000${number}`;
const excellence = '10000000-0000-4000-8000-000000000001';
const access = '10000000-0000-4000-8000-000000000002';

async function withRole(role, user, action) {
  return db.transaction(async (tx) => {
    await tx.exec(role === 'anon' ? 'set local role anon' : 'set local role authenticated');
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user })]);
    return action(tx);
  });
}

function asUser(number, action) {
  return withRole('authenticated', authUser(number), action);
}

async function value(tx, sql, parameters = []) {
  const { rows: [first] } = await tx.query(sql, parameters);
  return first && Object.values(first)[0];
}

before(async () => {
  await db.exec(await readFile(new URL('tests/support/embedded-auth.sql', project), 'utf8'));
  const files = (await readdir(migrations)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile(new URL(file, migrations), 'utf8'));
  const seed = await readFile(new URL('supabase/seed.sql', project), 'utf8');
  await db.exec(seed);
  await db.exec(seed);

  for (const [number, email] of [
    [0, 'staff@adssu.edu.ph'], [1, 'b01@adssu.edu.ph'], [2, 'b02@scholarship.example'],
    [3, 'b03@scholarship.example'], [6, 'b06@scholarship.example'],
  ]) {
    await db.query('insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)', [
      authUser(number), email, number === 3 ? null : new Date(),
    ]);
  }
  await db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    assert.equal(await value(tx, `update public.user_profiles set auth_user_id = $1
      where id = $2 and auth_user_id is null returning id`, [authUser(0), profile(0)]), profile(0));
  });
  for (const number of [1, 2, 6]) {
    await asUser(number, (tx) => tx.exec('select public.claim_scholar_profile()'));
  }
});

after(() => db.close());

const evaluationCases = [
  ['TC01 Valid boundary', 1, 'compliant', []],
  ['TC02 GWA above limit', 2, 'with_deficiency', ['gwa']],
  ['TC03 Program variation', 3, 'compliant', []],
  ['TC04 Multiple deficiencies', 4, 'with_deficiency', ['units', 'incomplete']],
  ['TC05 Failure and lateness', 5, 'with_deficiency', ['failed', 'deadline']],
];

for (const [name, fixture, result, failures] of evaluationCases) {
  test(name, () => asUser(0, async (tx) => {
    const id = submission(fixture);
    const checks = await value(tx, 'select public.staff_preview_compliance($1, 1)', [id]);
    const failed = checks.filter((check) => !check.passed);
    assert.deepEqual(failed.map((check) => check.rule), failures);
    assert.equal(await value(tx, 'select public.staff_evaluate_compliance($1, 1)', [id]), result);
    assert.equal(await value(tx, 'select public.staff_evaluate_compliance($1, 1)', [id]), result);
    const { rows: [history] } = await tx.query('select * from public.evaluation_history where submission_id = $1', [id]);
    assert.equal(history.evaluated_by, profile(0));
    assert.deepEqual(history.deficiency_reasons, failed.map((check) => check.failure_reason));
    assert.equal(await value(tx, 'select count(*)::integer from public.evaluation_history where submission_id = $1', [id]), 1);
    assert.equal(await value(tx, `select a.award_status from public.scholar_assignments a
      join public.semester_submissions s on s.assignment_id = a.id where s.id = $1`, [id]), 'Active');
  }));
}

test('TC06 Verification gate', async () => {
  const id = submission(6);
  for (const method of ['staff_preview_compliance', 'staff_evaluate_compliance']) {
    await assert.rejects(asUser(0, (tx) => tx.query(`select public.${method}($1, 1)`, [id])), {
      code: '22023', message: /Verify.*evidence/,
    });
  }
  await assert.rejects(asUser(0, (tx) => tx.query("select public.staff_verify_evidence($1, 1, 'returned', ' ')", [id])), {
    code: '22023', message: /Enter a reason/,
  });
});

test('TC07 Duplicate and invalid input', async () => {
  const submit = 'select public.scholar_submit_grades($1, $2, $3, $4, $5, $6, $7, $8)';
  const valid = ['2026-2027', 1, 2, 18, 0, 0, 0, 'Grade report'];
  await assert.rejects(asUser(1, (tx) => tx.query(submit, valid)), { code: '23505' });
  for (const [index, input] of [[0, '2026-2028'], [1, 3], [2, 0.99], [2, 5.01], [2, 2.001], [3, 18.5], [4, -1], [5, 0.1], [6, -1], [7, ' ']]) {
    const invalid = valid.slice();
    invalid[index] = input;
    await assert.rejects(asUser(1, (tx) => tx.query(submit, invalid)), { code: '22023' });
  }
});

test('TC08 Role isolation', async () => {
  await assert.rejects(withRole('anon', null, (tx) => tx.exec('select * from public.semester_submissions')), { code: '42501' });
  await asUser(1, async (tx) => {
    assert.equal(await value(tx, 'select id from public.user_profiles'), profile(1));
    assert.equal(await value(tx, 'select id from public.semester_submissions'), submission(1));
    assert.equal(await value(tx, 'select id from public.scholarship_programs'), excellence);
    assert.equal(await value(tx, 'select count(*)::integer from public.verification_history'), 1);
  });
  await asUser(3, async (tx) => {
    await tx.exec('select public.claim_scholar_profile()');
    assert.equal(await value(tx, 'select count(*)::integer from public.user_profiles'), 0);
  });
  await assert.rejects(asUser(1, (tx) => tx.exec("select public.staff_dashboard('2026-2027', 1)")), { code: '42501' });
  await assert.rejects(asUser(1, (tx) => tx.query("select public.staff_verify_evidence($1, 1, 'verified')", [submission(1)])), { code: '42501' });
  await assert.rejects(asUser(1, (tx) => tx.query("update public.semester_submissions set verification_status = 'verified' where id = $1", [submission(1)])), { code: '42501' });
  await asUser(0, async (tx) => {
    assert.equal(await value(tx, 'select count(*)::integer from public.semester_submissions'), 6);
    assert.equal(await value(tx, 'select count(*)::integer from public.verification_history'), 5);
  });
});

test('TC09 Persistence and correction', async () => {
  const id = submission(6);
  const originalTime = await value(db, 'select submitted_at from public.semester_submissions where id = $1', [id]);
  await asUser(0, (tx) => tx.query("select public.staff_verify_evidence($1, 1, 'returned', 'Use current grade report.')", [id]));
  await asUser(6, async (tx) => {
    const { rows: [entry] } = await tx.query('select * from public.verification_history where submission_id = $1', [id]);
    assert.equal(entry.new_status, 'returned');
    assert.equal(entry.reason, 'Use current grade report.');
    assert.equal(entry.verified_by, profile(0));
    assert.ok(entry.changed_at);
  });
  const correct = (tx) => tx.query("select public.scholar_correct_grades($1, 1, 2.50, 15, 0, 0, 1, 'Corrected report')", [id]);
  await assert.rejects(asUser(1, correct), { code: '42501' });
  await asUser(6, async (tx) => {
    await correct(tx);
  });
  await asUser(6, async (tx) => {
    const { rows: [record] } = await tx.query('select * from public.semester_submissions where id = $1', [id]);
    assert.equal(record.revision, 2);
    assert.equal(record.verification_status, 'pending');
    assert.deepEqual(record.submitted_at, originalTime);
    assert.equal(await value(tx, "select previous_values ->> 'evidence_reference' from public.correction_history"), 'DEMO-GRADE-B06');
  });
  await assert.rejects(asUser(0, (tx) => tx.query("select public.staff_verify_evidence($1, 1, 'verified')", [id])), {
    code: '22023', message: /newer revision/,
  });
  await asUser(0, async (tx) => {
    await tx.query("select public.staff_verify_evidence($1, 2, 'verified')", [id]);
    assert.equal(await value(tx, 'select public.staff_evaluate_compliance($1, 2)', [id]), 'compliant');
    assert.equal(await value(tx, 'select count(*)::integer from public.verification_history where submission_id = $1', [id]), 3);
  });
});

test('TC10 Renewal authority', async () => {
  const decision = 'select public.staff_decide_renewal($1, 1, $2, $3)';
  await asUser(0, async (tx) => {
    for (const fixture of [1, 2]) await value(tx, 'select public.staff_evaluate_compliance($1, 1)', [submission(fixture)]);
  });
  await assert.rejects(asUser(1, (tx) => tx.query(decision, [submission(1), 'approved', 'Unauthorized'])), { code: '42501' });
  await assert.rejects(asUser(0, (tx) => tx.query(decision, [submission(2), 'approved', 'Override'])), {
    code: '22023', message: /Only a compliant submission/,
  });
  await assert.rejects(asUser(0, (tx) => tx.query(decision, [submission(1), 'approved', ' '])), { code: '22023' });
  await asUser(0, async (tx) => {
    await tx.query(decision, [submission(1), 'approved', 'All requirements met.']);
    await tx.query(decision, [submission(2), 'held', 'GWA deficiency.']);
  });
  await asUser(1, async (tx) => {
    const { rows: [entry] } = await tx.query('select * from public.renewal_history');
    assert.equal(entry.decision, 'approved');
    assert.equal(entry.decision_notes, 'All requirements met.');
    assert.equal(entry.decided_by, profile(0));
    assert.ok(entry.decided_at);
  });
  await asUser(2, async (tx) => {
    assert.equal(await value(tx, 'select decision from public.renewal_history'), 'held');
  });
});

test('registers scholars and resolves effective program assignments for new submissions', async () => {
  const register = `select public.staff_register_scholar(
    'Morgan Lee', 'b07', 'B07@Scholarship.Example', $1, '2026-2027', 2)`;
  await assert.rejects(asUser(0, (tx) => tx.query(register, [profile(0)])), { code: '22023' });
  await asUser(0, async (tx) => {
    const id = await value(tx, register, [access]);
    const dashboard = await value(tx, "select public.staff_dashboard('2026-2027', 2)");
    const row = dashboard.rows.find((entry) => entry.scholar_id === id);
    assert.equal(row.student_id, 'B07');
    assert.equal(row.program_id, access);
    assert.equal(row.submission, null);
    await tx.query("select public.staff_assign_program($1, $2, '2026-2027', 2)", [profile(2), access]);
  });
  const sendGrades = "select public.scholar_submit_grades('2026-2027', 2, 2.50, $1, 0, 0, 1, 'New grade report')";
  await assert.rejects(asUser(2, (tx) => tx.query(sendGrades, [15.5])), { code: '22023' });
  await asUser(2, async (tx) => {
    const id = await value(tx, sendGrades, [15]);
    const program = await value(tx, `select a.program_id from public.semester_submissions s
      join public.scholar_assignments a on a.id = s.assignment_id where s.id = $1`, [id]);
    assert.equal(program, access);
  });
  await assert.rejects(asUser(2, (tx) => tx.query(sendGrades, [15])), { code: '23505' });
});
