import { isPublishableKey } from './public-key.js';

export async function connect() {
  const env = import.meta.env ?? {};
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) return null;
  if (!isPublishableKey(key)) throw new Error('Set a Supabase publishable or anon key for the browser.');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key, { auth: { detectSessionInUrl: false } });
}

export async function read(request) {
  const { data, error } = await request;
  if (error) throw error;
  return data;
}

export async function getProfile(client, userId) {
  const query = () => client.from('user_profiles').select('id, full_name, email, student_id, role')
    .eq('auth_user_id', userId).maybeSingle();
  const profile = await read(query());
  if (profile) return profile;
  await read(client.rpc('claim_scholar_profile'));
  return read(query());
}

// Server-side sort plus stable ID tie breaker keeps batches deterministic.
export async function allRows(makeQuery) {
  const pageSize = 250;
  const records = [];
  for (let start = 0; ; start += pageSize) {
    const page = await read(makeQuery().range(start, start + pageSize - 1));
    records.push(...page);
    if (page.length < pageSize) return records;
  }
}

export function assignments(client, scholarId) {
  return allRows(() => client.from('scholar_assignments')
    .select('*, program:scholarship_programs(*)').eq('scholar_id', scholarId)
    .order('effective_academic_year', { ascending: false }).order('effective_semester', { ascending: false }));
}

export function programs(client) {
  return allRows(() => client.from('scholarship_programs').select('*').order('program_name'));
}

export function submissions(client, scholarId) {
  return allRows(() => client.from('semester_submissions').select('*').eq('scholar_id', scholarId)
    .order('academic_year', { ascending: false }).order('semester', { ascending: false }));
}

export async function submissionDetails(client, id) {
  const submission = await read(client.from('semester_submissions')
    .select('*, assignment:scholar_assignments(program:scholarship_programs(*))').eq('id', id).maybeSingle());
  if (!submission) throw new Error('This submission is unavailable to your account.');
  const history = (table, timestamp) => allRows(() => client.from(table).select('*').eq('submission_id', id)
    .order(timestamp, { ascending: false }).order('id'));
  const [verifications, evaluations, renewals, corrections] = await Promise.all([
    history('verification_history', 'changed_at'),
    history('evaluation_history', 'evaluated_at'),
    history('renewal_history', 'decided_at'),
    history('correction_history', 'corrected_at'),
  ]);
  return { submission, verifications, evaluations, renewals, corrections };
}
