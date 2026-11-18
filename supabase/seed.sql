-- Run as the database owner. Auth users and passwords are provisioned separately.
begin;

insert into public.user_profiles (id, full_name, student_id, email, role) values
  ('20000000-0000-4000-8000-000000000000', 'Jordan Reyes (Demo Staff)', null, 'staff@adssu.edu.ph', 'staff'),
  ('20000000-0000-4000-8000-000000000001', 'Avery Cruz', 'B01', 'b01@adssu.edu.ph', 'scholar'),
  ('20000000-0000-4000-8000-000000000002', 'Blair Santos', 'B02', 'b02@scholarship.example', 'scholar'),
  ('20000000-0000-4000-8000-000000000003', 'Casey Mendoza', 'B03', 'b03@scholarship.example', 'scholar'),
  ('20000000-0000-4000-8000-000000000004', 'Drew Bautista', 'B04', 'b04@scholarship.example', 'scholar'),
  ('20000000-0000-4000-8000-000000000005', 'Emery Garcia', 'B05', 'b05@scholarship.example', 'scholar'),
  ('20000000-0000-4000-8000-000000000006', 'Finley Ramos', 'B06', 'b06@scholarship.example', 'scholar')
on conflict (id) do nothing;

insert into public.scholar_assignments (
  id, scholar_id, program_id, effective_academic_year, effective_semester, assigned_at, assigned_by
)
select ('30000000-0000-4000-8000-00000000000' || n)::uuid,
  ('20000000-0000-4000-8000-00000000000' || n)::uuid,
  case when n in (1, 2, 5) then '10000000-0000-4000-8000-000000000001'::uuid
    else '10000000-0000-4000-8000-000000000002'::uuid end,
  '2026-2027', 1, '2026-10-01 09:00:00+08', '20000000-0000-4000-8000-000000000000'
from generate_series(1, 6) as numbers(n)
on conflict (id) do nothing;

with fixtures(n, gwa, units, failed, incomplete, dropped, received, verification) as (values
  (1, 2.00, 18, 0, 0, 0, '2026-11-06 17:00:00+08'::timestamptz, 'verified'::public.verification_state),
  (2, 2.01, 18, 0, 0, 0, '2026-11-05 17:00:00+08', 'verified'),
  (3, 2.50, 15, 0, 0, 1, '2026-11-05 17:00:00+08', 'verified'),
  (4, 2.50, 14, 0, 1, 0, '2026-11-05 17:00:00+08', 'verified'),
  (5, 1.75, 18, 1, 0, 0, '2026-11-06 17:01:00+08', 'verified'),
  (6, 2.25, 15, 0, 0, 0, '2026-11-05 17:00:00+08', 'pending')
), inserted as (
  insert into public.semester_submissions (
    id, scholar_id, assignment_id, academic_year, semester, gwa, enrolled_units, failed_count,
    incomplete_count, dropped_count, evidence_reference, submitted_at, verification_status, created_at, updated_at
  )
  select ('40000000-0000-4000-8000-00000000000' || n)::uuid,
    ('20000000-0000-4000-8000-00000000000' || n)::uuid,
    ('30000000-0000-4000-8000-00000000000' || n)::uuid,
    '2026-2027', 1, gwa, units, failed, incomplete, dropped, 'DEMO-GRADE-B0' || n, received,
    verification, received, case when verification = 'verified' then received + interval '1 hour' else received end
  from fixtures
  on conflict (id) do nothing
  returning id, submitted_at, verification_status
)
insert into public.verification_history (submission_id, verified_by, revision, previous_status, new_status, reason, changed_at)
select id, '20000000-0000-4000-8000-000000000000', 1, 'pending', 'verified',
  'Reviewed fictional grade reference.', submitted_at + interval '1 hour'
from inserted where verification_status = 'verified';

-- Additional demo scholars begin their first semester awaiting a grade submission.
with roster(student_id, full_name, program_name) as (values
  ('DEMO-07', 'Lina Mercado', 'Excellence Scholar'),
  ('DEMO-08', 'Nico Salazar', 'Access Scholar'),
  ('DEMO-09', 'Mira Navarro', 'Excellence Scholar'),
  ('DEMO-10', 'Paolo Dizon', 'Access Scholar'),
  ('DEMO-11', 'Tala Soriano', 'Excellence Scholar')
), registered as (
  insert into public.user_profiles (student_id, full_name, email, role)
  select student_id, full_name, lower(student_id) || '@scholarship.example', 'scholar'
  from roster
  on conflict (student_id) do nothing
  returning id, student_id
)
insert into public.scholar_assignments (
  scholar_id, program_id, effective_academic_year, effective_semester, assigned_by
)
select registered.id, program.id, '2026-2027', 1, '20000000-0000-4000-8000-000000000000'
from registered
join roster using (student_id)
join public.scholarship_programs program using (program_name);

commit;
