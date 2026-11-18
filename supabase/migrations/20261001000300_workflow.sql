begin;

create function scholarship_private.academic_year(p_year text)
returns public.academic_year_value language plpgsql immutable set search_path = '' as $$
declare
  normalized text := translate(btrim(p_year), '–—', '--');
begin
  if normalized is not null and normalized ~ '^[1-9][0-9]{3}-[1-9][0-9]{3}$' then
    if substring(normalized, 6, 4)::integer = substring(normalized, 1, 4)::integer + 1 then
      return normalized::public.academic_year_value;
    end if;
  end if;
  raise exception using errcode = '22023', message = 'Enter consecutive years in YYYY-YYYY format.';
end;
$$;

create function scholarship_private.validate_semester(p_semester integer)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_semester is null or p_semester not in (1, 2) then
    raise exception using errcode = '22023', message = 'Select semester 1 or 2.';
  end if;
end;
$$;

create function scholarship_private.validate_academics(
  p_gwa numeric, p_units numeric, p_failed numeric, p_incomplete numeric, p_dropped numeric, p_evidence text
)
returns void language plpgsql immutable set search_path = '' as $$
declare
  entry record;
begin
  if p_gwa is null or p_gwa not between 1 and 5 or scale(p_gwa) > 2 then
    raise exception using errcode = '22023', message = 'GWA must be from 1.00 to 5.00 with at most two decimal places.';
  end if;
  for entry in
    select * from (values ('Enrolled units', p_units), ('Failed subjects', p_failed),
      ('Incomplete grades', p_incomplete), ('Dropped subjects', p_dropped)) as inputs(label, amount)
  loop
    if entry.amount is null or entry.amount not between 0 and 2147483647
        or entry.amount <> trunc(entry.amount) then
      raise exception using errcode = '22023', message = entry.label || ' must be a nonnegative whole number within the supported range.';
    end if;
  end loop;
  if p_evidence is null or btrim(p_evidence, E' \t\n\r') = '' or char_length(btrim(p_evidence)) > 500 then
    raise exception using errcode = '22023', message = 'Enter a grade-document reference of up to 500 characters.';
  end if;
end;
$$;

create function public.staff_assign_program(
  p_scholar_id uuid, p_program_id uuid, p_academic_year text, p_semester integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := scholarship_private.require_role('staff');
  term_year public.academic_year_value := scholarship_private.academic_year(p_academic_year);
  assignment_id uuid;
begin
  perform scholarship_private.validate_semester(p_semester);
  perform 1 from public.user_profiles where id = p_scholar_id and role = 'scholar' for update;
  if not found then
    raise exception using errcode = '22023', message = 'Select an existing scholar.';
  end if;
  if not exists (select 1 from public.scholarship_programs where id = p_program_id) then
    raise exception using errcode = '22023', message = 'Select an existing scholarship program.';
  end if;
  insert into public.scholar_assignments (
    scholar_id, program_id, effective_academic_year, effective_semester, assigned_by
  ) values (p_scholar_id, p_program_id, term_year, p_semester, actor_id)
  on conflict (scholar_id, effective_academic_year, effective_semester) do nothing
  returning id into assignment_id;
  if assignment_id is null then
    raise exception using errcode = '23505', message = 'This scholar already has a program assignment effective in that semester.';
  end if;
  return assignment_id;
end;
$$;

create function public.staff_register_scholar(
  p_full_name text, p_student_id text, p_email text, p_program_id uuid, p_academic_year text, p_semester integer
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  scholar_id uuid;
  clean_name text := btrim(p_full_name, E' \t\n\r');
  clean_id text := upper(btrim(p_student_id, E' \t\n\r'));
  clean_email text := lower(btrim(p_email));
begin
  perform scholarship_private.require_role('staff');
  if clean_name is null or char_length(clean_name) not between 1 and 120 then
    raise exception using errcode = '22023', message = 'Enter a scholar name of up to 120 characters.';
  end if;
  if clean_id is null or char_length(clean_id) not between 1 and 40 then
    raise exception using errcode = '22023', message = 'Enter a student ID of up to 40 characters.';
  end if;
  if clean_email is null or char_length(clean_email) > 254
      or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode = '22023', message = 'Enter a valid email address.';
  end if;
  insert into public.user_profiles (full_name, student_id, email, role)
    values (clean_name, clean_id, clean_email, 'scholar')
    on conflict do nothing returning id into scholar_id;
  if scholar_id is null then
    raise exception using errcode = '23505', message = 'A profile with this student ID or email already exists.';
  end if;
  perform public.staff_assign_program(scholar_id, p_program_id, p_academic_year, p_semester);
  return scholar_id;
end;
$$;

create function public.scholar_submit_grades(
  p_academic_year text, p_semester integer, p_gwa numeric, p_units numeric,
  p_failed numeric, p_incomplete numeric, p_dropped numeric, p_evidence text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := scholarship_private.require_role('scholar');
  term_year public.academic_year_value := scholarship_private.academic_year(p_academic_year);
  assignment public.scholar_assignments;
  submission_id uuid;
begin
  perform scholarship_private.validate_semester(p_semester);
  perform scholarship_private.validate_academics(p_gwa, p_units, p_failed, p_incomplete, p_dropped, p_evidence);
  perform 1 from public.user_profiles where id = actor_id for update;
  if exists (select 1 from public.semester_submissions
    where scholar_id = actor_id and academic_year = term_year and semester = p_semester) then
    raise exception using errcode = '23505', message = 'You already have a submission for this academic year and semester.';
  end if;
  select * into assignment from public.scholar_assignments
    where scholar_id = actor_id and (effective_academic_year, effective_semester) <= (term_year, p_semester)
    order by effective_academic_year desc, effective_semester desc limit 1;
  if assignment.id is null or assignment.award_status <> 'Active' then
    raise exception using errcode = '22023', message = 'No active scholarship assignment applies to this semester.';
  end if;
  insert into public.semester_submissions (
    scholar_id, assignment_id, academic_year, semester, gwa, enrolled_units,
    failed_count, incomplete_count, dropped_count, evidence_reference
  ) values (
    actor_id, assignment.id, term_year, p_semester, p_gwa, p_units,
    p_failed, p_incomplete, p_dropped, btrim(p_evidence, E' \t\n\r')
  ) on conflict (scholar_id, academic_year, semester) do nothing returning id into submission_id;
  if submission_id is null then
    raise exception using errcode = '23505', message = 'You already have a submission for this academic year and semester.';
  end if;
  return submission_id;
end;
$$;

create function public.scholar_correct_grades(
  p_submission_id uuid, p_revision integer, p_gwa numeric, p_units numeric,
  p_failed numeric, p_incomplete numeric, p_dropped numeric, p_evidence text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := scholarship_private.require_role('scholar');
  previous public.semester_submissions;
begin
  select * into previous from public.semester_submissions
    where id = p_submission_id and scholar_id = actor_id for update;
  if not found then
    raise exception using errcode = '42501', message = 'This submission is unavailable to your account.';
  end if;
  if previous.verification_status <> 'returned' or previous.revision is distinct from p_revision then
    raise exception using errcode = '22023', message = 'Only the latest returned revision can be corrected. Reopen the submission to see its current status.';
  end if;
  perform scholarship_private.validate_academics(p_gwa, p_units, p_failed, p_incomplete, p_dropped, p_evidence);
  update public.semester_submissions set gwa = p_gwa, enrolled_units = p_units,
    failed_count = p_failed, incomplete_count = p_incomplete, dropped_count = p_dropped,
    evidence_reference = btrim(p_evidence, E' \t\n\r'), verification_status = 'pending',
    revision = previous.revision + 1, updated_at = clock_timestamp()
  where id = previous.id;
  insert into public.correction_history (submission_id, corrected_by, revision, previous_values)
    values (previous.id, actor_id, previous.revision + 1,
      jsonb_build_object('gwa', previous.gwa, 'enrolled_units', previous.enrolled_units,
        'failed_count', previous.failed_count, 'incomplete_count', previous.incomplete_count,
        'dropped_count', previous.dropped_count, 'evidence_reference', previous.evidence_reference));
  insert into public.verification_history (
    submission_id, verified_by, revision, previous_status, new_status, reason
  ) values (previous.id, actor_id, previous.revision + 1, 'returned', 'pending', 'Scholar resubmitted a correction.');
  return previous.id;
end;
$$;

create function scholarship_private.lock_submission(p_id uuid, p_revision integer)
returns public.semester_submissions language plpgsql set search_path = '' as $$
declare
  submission public.semester_submissions;
begin
  select * into submission from public.semester_submissions where id = p_id for update;
  if not found then
    raise exception using errcode = '22023', message = 'This submission no longer exists.';
  end if;
  if submission.revision is distinct from p_revision then
    raise exception using errcode = '22023', message = 'This submission has a newer revision. Reopen it before continuing.';
  end if;
  return submission;
end;
$$;

create function public.staff_verify_evidence(
  p_submission_id uuid, p_revision integer, p_status public.verification_state, p_reason text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := scholarship_private.require_role('staff');
  submission public.semester_submissions := scholarship_private.lock_submission(p_submission_id, p_revision);
  reason text := nullif(btrim(p_reason, E' \t\n\r'), '');
begin
  if p_status = 'verified' and submission.verification_status = 'pending' then
    if btrim(submission.evidence_reference) = '' then
      raise exception using errcode = '22023', message = 'A grade-document reference is required before verification.';
    end if;
  elsif p_status = 'returned' and submission.verification_status in ('pending', 'verified') then
    if reason is null then
      raise exception using errcode = '22023', message = 'Enter a reason before returning evidence.';
    end if;
  else
    raise exception using errcode = '22023', message = 'This verification action is unavailable for the current status.';
  end if;
  if char_length(reason) > 1000 then
    raise exception using errcode = '22023', message = 'The verification reason must be at most 1,000 characters.';
  end if;
  update public.semester_submissions set verification_status = p_status,
    compliance_result = 'not_evaluated', renewal_decision = 'not_decided', updated_at = clock_timestamp()
    where id = submission.id;
  insert into public.verification_history (submission_id, verified_by, revision, previous_status, new_status, reason)
    values (submission.id, actor_id, submission.revision, submission.verification_status, p_status, reason);
end;
$$;

revoke all on all functions in schema scholarship_private from public, anon;
revoke execute on function public.staff_assign_program(uuid, uuid, text, integer),
  public.staff_register_scholar(text, text, text, uuid, text, integer),
  public.scholar_submit_grades(text, integer, numeric, numeric, numeric, numeric, numeric, text),
  public.scholar_correct_grades(uuid, integer, numeric, numeric, numeric, numeric, numeric, text),
  public.staff_verify_evidence(uuid, integer, public.verification_state, text) from public, anon, authenticated;
grant execute on function public.staff_assign_program(uuid, uuid, text, integer),
  public.staff_register_scholar(text, text, text, uuid, text, integer),
  public.scholar_submit_grades(text, integer, numeric, numeric, numeric, numeric, numeric, text),
  public.scholar_correct_grades(uuid, integer, numeric, numeric, numeric, numeric, numeric, text),
  public.staff_verify_evidence(uuid, integer, public.verification_state, text) to authenticated;

commit;
