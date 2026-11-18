import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProfile, read } from '../src/services/scholarship.js';
import { demoAccounts, demoClient } from './support/demo-config.mjs';

test('Supabase Auth links demo identities and applies role permissions', async (t) => {
  const accounts = demoAccounts();
  await t.test('rejects invalid credentials', async () => {
    await assert.rejects(() => read(demoClient().auth.signInWithPassword({
      email: accounts[0].email, password: `${accounts[0].password}-invalid`,
    })), { code: 'invalid_credentials' });
  });
  for (const account of accounts) {
    await t.test(`signs in ${account.email}`, async () => {
      const client = demoClient();
      const { user } = await read(client.auth.signInWithPassword({ email: account.email, password: account.password }));
      try {
        const profile = await getProfile(client, user.id);
        assert.equal(profile?.id, account.id);
        assert.equal(profile.role, account.role);
        const dashboard = () => read(client.rpc('staff_dashboard', { p_academic_year: '2026-2027', p_semester: 1 }));
        if (account.role === 'staff') {
          const result = await dashboard();
          assert.ok(result.total_assigned >= 6);
          for (const id of ['B01', 'B02', 'B03', 'B04', 'B05', 'B06']) assert.ok(result.rows.some((row) => row.student_id === id && row.submission));
          assert.equal(result.total_assigned, result.rows.length);
          for (const [key, field, status] of [['pending', 'verification_status', 'pending'],
            ['compliant', 'compliance_result', 'compliant'], ['with_deficiency', 'compliance_result', 'with_deficiency']]) {
            assert.equal(result[key], result.rows.filter((row) => row.submission?.[field] === status).length);
          }
        } else {
          const otherScholar = accounts.find(({ role, id }) => role === 'scholar' && id !== account.id);
          const records = await read(client.from('semester_submissions').select('id, revision, scholar_id').eq('scholar_id', account.id));
          assert.ok(records.length >= 1);
          assert.deepEqual(await read(client.from('semester_submissions').select('id').eq('scholar_id', otherScholar.id)), []);
          await assert.rejects(dashboard, { code: '42501' });
          const record = records[0];
          await assert.rejects(() => read(client.rpc('staff_verify_evidence', {
            p_submission_id: record.id, p_revision: record.revision, p_status: 'verified',
          })), { code: '42501' });
          await assert.rejects(() => read(client.rpc('staff_decide_renewal', {
            p_submission_id: record.id, p_revision: record.revision, p_decision: 'approved', p_notes: 'Role isolation test',
          })), { code: '42501' });
        }
      } finally {
        await read(client.auth.signOut({ scope: 'local' }));
      }
    });
  }
});
