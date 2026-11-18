import { createClient } from '@supabase/supabase-js';
import { isPublishableKey } from '../../src/services/public-key.js';

function required(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`Set ${name} in .env.test.local.`);
  return value;
}

export function demoAccounts() {
  return [
    ['0', 'staff', 'staff', 'TEST_STAFF_PASSWORD'],
    ['1', 'b01', 'scholar', 'TEST_SCHOLAR_A_PASSWORD'],
    ['2', 'b02', 'scholar', 'TEST_SCHOLAR_B_PASSWORD'],
  ].map(([number, login, role, variable]) => {
    const password = required(variable);
    if (password.length < 12) throw new Error(`${variable} must contain at least 12 characters.`);
    return {
      id: `20000000-0000-4000-8000-00000000000${number}`,
      email: `${login}@scholarship.example`, role, password,
    };
  });
}

export function demoClient({ admin = false } = {}) {
  const url = required('SUPABASE_URL').trim();
  const variable = admin ? 'SUPABASE_ADMIN_KEY' : 'SUPABASE_PUBLISHABLE_KEY';
  const key = required(variable).trim();
  if (isPublishableKey(key) === admin) {
    throw new Error(`Set ${variable} to a Supabase ${admin ? 'secret or service_role' : 'publishable or anon'} key.`);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
