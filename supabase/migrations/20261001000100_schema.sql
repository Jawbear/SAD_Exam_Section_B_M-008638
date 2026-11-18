begin;

create schema if not exists scholarship_private;
revoke all on schema scholarship_private from public, anon, authenticated;

create type public.profile_role as enum ('scholar', 'staff');
create type public.verification_state as enum ('pending', 'verified', 'returned');
create type public.compliance_state as enum ('not_evaluated', 'compliant', 'with_deficiency');
create type public.renewal_state as enum ('not_decided', 'approved', 'held');

create domain public.academic_year_value as text
  check (case when value ~ '^[1-9][0-9]{3}-[1-9][0-9]{3}$'
          then substring(value, 6, 4)::integer = substring(value, 1, 4)::integer + 1
          else false end);

create table public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 120),
  student_id text unique check (char_length(btrim(student_id)) between 1 and 40),
  email text not null unique check (email = lower(btrim(email)) and char_length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role public.profile_role not null,
  created_at timestamptz not null default now(),
  check (role <> 'scholar' or student_id is not null),
  check (student_id is null or student_id = upper(btrim(student_id)))
);

create table public.scholarship_programs (
  id uuid primary key default gen_random_uuid(),
  program_name text not null unique,
  maximum_gwa numeric(3,2) not null check (maximum_gwa between 1 and 5),
  minimum_units integer not null check (minimum_units >= 0),
  allowed_failed integer not null check (allowed_failed >= 0),
  allowed_incomplete integer not null check (allowed_incomplete >= 0),
  allowed_dropped integer not null check (allowed_dropped >= 0),
  evidence_required boolean not null default true,
  submission_deadline timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.scholar_assignments (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.user_profiles (id),
  program_id uuid not null references public.scholarship_programs (id),
  award_status text not null default 'Active' check (award_status in ('Active', 'Inactive')),
  effective_academic_year public.academic_year_value not null,
  effective_semester smallint not null check (effective_semester in (1, 2)),
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references public.user_profiles (id),
  unique (scholar_id, effective_academic_year, effective_semester),
  unique (id, scholar_id)
);

create table public.semester_submissions (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.user_profiles (id),
  assignment_id uuid not null,
  academic_year public.academic_year_value not null,
  semester smallint not null check (semester in (1, 2)),
  gwa numeric not null check (gwa between 1 and 5 and scale(gwa) <= 2),
  enrolled_units integer not null check (enrolled_units >= 0),
  failed_count integer not null check (failed_count >= 0),
  incomplete_count integer not null check (incomplete_count >= 0),
  dropped_count integer not null check (dropped_count >= 0),
  evidence_reference text not null check (char_length(btrim(evidence_reference)) between 1 and 500),
  submitted_at timestamptz not null default statement_timestamp(),
  verification_status public.verification_state not null default 'pending',
  compliance_result public.compliance_state not null default 'not_evaluated',
  renewal_decision public.renewal_state not null default 'not_decided',
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (assignment_id, scholar_id) references public.scholar_assignments (id, scholar_id),
  unique (scholar_id, academic_year, semester),
  check (verification_status = 'verified' or compliance_result = 'not_evaluated'),
  check (renewal_decision = 'not_decided' or
    (verification_status = 'verified' and compliance_result <> 'not_evaluated')),
  check (renewal_decision <> 'approved' or compliance_result = 'compliant')
);

create table public.evaluation_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.semester_submissions (id),
  evaluated_by uuid not null references public.user_profiles (id),
  revision integer not null check (revision > 0),
  compliance_result public.compliance_state not null check (compliance_result <> 'not_evaluated'),
  deficiency_reasons text[] not null,
  rule_checks jsonb not null check (jsonb_typeof(rule_checks) = 'array'),
  evaluated_at timestamptz not null default clock_timestamp(),
  unique (submission_id, revision),
  check ((compliance_result = 'compliant') = (cardinality(deficiency_reasons) = 0))
);

create table public.verification_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.semester_submissions (id),
  verified_by uuid not null references public.user_profiles (id),
  revision integer not null check (revision > 0),
  previous_status public.verification_state not null,
  new_status public.verification_state not null,
  reason text check (char_length(btrim(reason)) between 1 and 1000),
  changed_at timestamptz not null default clock_timestamp(),
  check (previous_status <> new_status),
  check (new_status <> 'returned' or reason is not null)
);

create table public.renewal_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.semester_submissions (id),
  decided_by uuid not null references public.user_profiles (id),
  revision integer not null check (revision > 0),
  decision public.renewal_state not null check (decision <> 'not_decided'),
  decision_notes text not null check (char_length(btrim(decision_notes)) between 1 and 1000),
  decided_at timestamptz not null default clock_timestamp()
);

create table public.correction_history (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.semester_submissions (id),
  corrected_by uuid not null references public.user_profiles (id),
  revision integer not null check (revision > 1),
  previous_values jsonb not null check (jsonb_typeof(previous_values) = 'object'),
  corrected_at timestamptz not null default clock_timestamp(),
  unique (submission_id, revision)
);

create index assignments_program_idx on public.scholar_assignments (program_id);
create index assignments_actor_idx on public.scholar_assignments (assigned_by);
create index submissions_period_idx on public.semester_submissions (academic_year, semester, compliance_result);
create index submissions_assignment_idx on public.semester_submissions (assignment_id, scholar_id);
create index evaluations_actor_idx on public.evaluation_history (evaluated_by);
create index verifications_submission_idx on public.verification_history (submission_id, changed_at desc);
create index verifications_actor_idx on public.verification_history (verified_by);
create index renewals_submission_idx on public.renewal_history (submission_id, decided_at desc);
create index renewals_actor_idx on public.renewal_history (decided_by);
create index corrections_actor_idx on public.correction_history (corrected_by);

insert into public.scholarship_programs (
  id, program_name, maximum_gwa, minimum_units,
  allowed_failed, allowed_incomplete, allowed_dropped, evidence_required, submission_deadline
) values
  ('10000000-0000-4000-8000-000000000001', 'Excellence Scholar', 2.00, 18, 0, 0, 0, true,
    timestamp '2026-11-06 17:00:00' at time zone 'Asia/Manila'),
  ('10000000-0000-4000-8000-000000000002', 'Access Scholar', 2.50, 15, 0, 0, 1, true,
    timestamp '2026-11-06 17:00:00' at time zone 'Asia/Manila');

commit;
