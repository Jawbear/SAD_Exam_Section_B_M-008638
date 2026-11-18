import { demoAccounts, demoClient } from '../tests/support/demo-config.mjs';
import { read } from '../src/services/scholarship.js';

async function provision() {
  const accounts = demoAccounts();
  const admin = demoClient({ admin: true });
  const profiles = await read(admin.from('user_profiles').select('id, role, email, auth_user_id')
    .in('id', accounts.map(({ id }) => id)));

  for (const account of accounts) {
    const profile = profiles.find(({ id }) => id === account.id);
    if (profile?.email !== account.email || profile.role !== account.role) {
      throw new Error(`Expected demo profile ${account.email} is missing. Apply the migrations and seed the demo database first.`);
    }
  }

  for (const { id, email, role, password } of accounts) {
    const profile = profiles.find((entry) => entry.id === id);
    const client = demoClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    let user = data?.user;
    if (error) {
      if (error.code !== 'invalid_credentials') throw error;
      if (profile.auth_user_id) throw new Error(`Check the existing demo password for ${email}.`);
      ({ user } = await read(admin.auth.admin.createUser({ email, password, email_confirm: true })));
    }

    if (profile.auth_user_id && profile.auth_user_id !== user.id) {
      throw new Error(`Demo profile ${email} is already linked to a different Auth user.`);
    }
    if (role === 'staff' && profile.auth_user_id === null) {
      await read(admin.from('user_profiles').update({ auth_user_id: user.id })
        .eq('id', id).is('auth_user_id', null).select('id').single());
    }
    console.log(`Demo account ready for ${email}`);
  }
}

provision().catch((error) => {
  console.error(`Demo provisioning failed. ${error.message}`);
  process.exitCode = 1;
});
