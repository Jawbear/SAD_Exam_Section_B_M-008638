-- Match existing demo roster entries to their renamed, linked Auth identities.
update public.user_profiles as profile
set email = identity.email
from auth.users as identity,
  (values
    ('20000000-0000-4000-8000-000000000000'::uuid, 'staff@scholarship.example', 'staff@adssu.edu.ph'),
    ('20000000-0000-4000-8000-000000000001'::uuid, 'b01@scholarship.example', 'b01@adssu.edu.ph')
  ) as demo(id, previous_email, new_email)
where profile.id = demo.id
  and profile.email = demo.previous_email
  and profile.auth_user_id = identity.id
  and identity.email = demo.new_email;
