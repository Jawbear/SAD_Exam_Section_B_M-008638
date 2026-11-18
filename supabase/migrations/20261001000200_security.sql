begin;

create function scholarship_private.profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.user_profiles where auth_user_id = (select auth.uid());
$$;

create function scholarship_private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_profiles
    where auth_user_id = (select auth.uid()) and role = 'staff'
  );
$$;

create function scholarship_private.require_role(p_role public.profile_role)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  actor_id uuid;
begin
  select id into actor_id from public.user_profiles
    where auth_user_id = (select auth.uid()) and role = p_role;
  if actor_id is null then
    raise exception using errcode = '42501',
      message = case when p_role = 'staff' then 'Scholarship Staff access is required.'
        else 'A linked Scholar account is required.' end;
  end if;
  return actor_id;
end;
$$;

revoke all on all functions in schema scholarship_private from public, anon, authenticated;
grant usage on schema scholarship_private to authenticated;
grant execute on function scholarship_private.profile_id(), scholarship_private.is_staff()
  to authenticated;

revoke all on public.user_profiles, public.scholarship_programs, public.scholar_assignments,
  public.semester_submissions, public.evaluation_history, public.verification_history,
  public.renewal_history, public.correction_history from public, anon, authenticated;

grant select on public.user_profiles, public.scholarship_programs, public.scholar_assignments,
  public.semester_submissions, public.evaluation_history, public.verification_history,
  public.renewal_history, public.correction_history to authenticated;

grant select (id, role, email, auth_user_id), update (auth_user_id)
  on public.user_profiles to service_role;

alter table public.user_profiles enable row level security;
alter table public.scholarship_programs enable row level security;
alter table public.scholar_assignments enable row level security;
alter table public.semester_submissions enable row level security;
alter table public.evaluation_history enable row level security;
alter table public.verification_history enable row level security;
alter table public.renewal_history enable row level security;
alter table public.correction_history enable row level security;

create policy read_profile on public.user_profiles for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select scholarship_private.is_staff()));

create policy read_assignment on public.scholar_assignments for select to authenticated
  using (scholar_id = (select scholarship_private.profile_id())
    or (select scholarship_private.is_staff()));

create policy read_program on public.scholarship_programs for select to authenticated
  using ((select scholarship_private.is_staff()) or exists (
    select 1 from public.scholar_assignments a
    where a.program_id = scholarship_programs.id
      and a.scholar_id = (select scholarship_private.profile_id())
  ));

create policy read_submission on public.semester_submissions for select to authenticated
  using (scholar_id = (select scholarship_private.profile_id())
    or (select scholarship_private.is_staff()));

-- This existence check inherits the submission's RLS policy.
create policy read_evaluation on public.evaluation_history for select to authenticated
  using (exists (select 1 from public.semester_submissions s where s.id = submission_id));
create policy read_verification on public.verification_history for select to authenticated
  using (exists (select 1 from public.semester_submissions s where s.id = submission_id));
create policy read_renewal on public.renewal_history for select to authenticated
  using (exists (select 1 from public.semester_submissions s where s.id = submission_id));
create policy read_correction on public.correction_history for select to authenticated
  using (exists (select 1 from public.semester_submissions s where s.id = submission_id));

-- A staff-registered scholar can link only the confirmed email on their Auth user.
-- Staff identity linking is an owner-only setup step.
create function public.claim_scholar_profile()
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.user_profiles p
  set auth_user_id = u.id
  from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null
    and u.is_anonymous is false
    and p.email = lower(u.email) and p.role = 'scholar' and p.auth_user_id is null
    and not exists (select 1 from public.user_profiles existing where existing.auth_user_id = u.id);
end;
$$;

revoke execute on function public.claim_scholar_profile() from public, anon, authenticated;
grant execute on function public.claim_scholar_profile() to authenticated;

commit;
