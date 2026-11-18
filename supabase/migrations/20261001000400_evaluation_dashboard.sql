begin;

create function scholarship_private.policy_checks(p_submission public.semester_submissions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_agg(jsonb_build_object(
    'rule', c.rule, 'label', c.label, 'requirement', c.requirement,
    'actual', c.actual, 'passed', c.passed, 'failure_reason', case when c.passed then null else c.failure_reason end
  ) order by c.position)
  from public.scholar_assignments a
  join public.scholarship_programs p on p.id = a.program_id
  cross join lateral (values
    (1, 'evidence', 'Grade document', case when p.evidence_required then 'Reference required' else 'Optional' end,
      case when btrim(p_submission.evidence_reference) <> '' then 'Reference provided' else 'Missing' end,
      not p.evidence_required or btrim(p_submission.evidence_reference) <> '', 'A supporting grade-document reference is required.'),
    (2, 'gwa', 'GWA', 'At most ' || p.maximum_gwa::text, round(p_submission.gwa, 2)::text,
      p_submission.gwa <= p.maximum_gwa, 'GWA exceeds the maximum of ' || p.maximum_gwa::text || '.'),
    (3, 'units', 'Enrolled units', 'At least ' || p.minimum_units::text, p_submission.enrolled_units::text,
      p_submission.enrolled_units >= p.minimum_units,
      format('Insufficient enrolled units (%s enrolled, minimum %s).', p_submission.enrolled_units, p.minimum_units)),
    (4, 'failed', 'Failed subjects', 'At most ' || p.allowed_failed::text, p_submission.failed_count::text,
      p_submission.failed_count <= p.allowed_failed,
      format('Failed-subject count exceeds the allowance (%s recorded, %s allowed).', p_submission.failed_count, p.allowed_failed)),
    (5, 'incomplete', 'Incomplete grades', 'At most ' || p.allowed_incomplete::text, p_submission.incomplete_count::text,
      p_submission.incomplete_count <= p.allowed_incomplete,
      format('Incomplete-grade count exceeds the allowance (%s recorded, %s allowed).', p_submission.incomplete_count, p.allowed_incomplete)),
    (6, 'dropped', 'Dropped subjects', 'At most ' || p.allowed_dropped::text, p_submission.dropped_count::text,
      p_submission.dropped_count <= p.allowed_dropped,
      format('Dropped-subject count exceeds the allowance (%s recorded, %s allowed).', p_submission.dropped_count, p.allowed_dropped)),
    (7, 'deadline', 'Original submission deadline',
      to_char(p.submission_deadline at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI:SS AM') || ' PHT',
      to_char(p_submission.submitted_at at time zone 'Asia/Manila', 'Mon DD, YYYY HH12:MI:SS AM') || ' PHT',
      p_submission.submitted_at <= p.submission_deadline, 'Submission was received past the deadline.')
  ) as c(position, rule, label, requirement, actual, passed, failure_reason)
  where a.id = p_submission.assignment_id;
$$;

create function public.staff_preview_compliance(p_submission_id uuid, p_revision integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  submission public.semester_submissions;
begin
  perform scholarship_private.require_role('staff');
  select * into submission from public.semester_submissions
    where id = p_submission_id and revision = p_revision;
  if not found or submission.verification_status <> 'verified' then
    raise exception using errcode = '22023', message = 'Verify the current evidence before evaluating compliance.';
  end if;
  return scholarship_private.policy_checks(submission);
end;
$$;

create function public.staff_evaluate_compliance(p_submission_id uuid, p_revision integer)
returns public.compliance_state language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := scholarship_private.require_role('staff');
  submission public.semester_submissions := scholarship_private.lock_submission(p_submission_id, p_revision);
  checks jsonb;
  reasons text[];
  result public.compliance_state;
begin
  if submission.verification_status <> 'verified' then
    raise exception using errcode = '22023', message = 'Verify the evidence before evaluating compliance.';
  end if;
  if submission.compliance_result <> 'not_evaluated' then
    return submission.compliance_result;
  end if;
  checks := scholarship_private.policy_checks(submission);
  select coalesce(array_agg(rule ->> 'failure_reason' order by position), array[]::text[]) into reasons
    from jsonb_array_elements(checks) with ordinality as items(rule, position)
    where (rule ->> 'passed')::boolean is false;
  result := case when cardinality(reasons) = 0 then 'compliant' else 'with_deficiency' end;
  insert into public.evaluation_history (
    submission_id, evaluated_by, revision, compliance_result, deficiency_reasons, rule_checks
  ) values (submission.id, actor_id, submission.revision, result, reasons, checks);
  update public.semester_submissions set compliance_result = result, updated_at = clock_timestamp()
    where id = submission.id;
  return result;
end;
$$;

create function public.staff_decide_renewal(
  p_submission_id uuid, p_revision integer, p_decision public.renewal_state, p_notes text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := scholarship_private.require_role('staff');
  submission public.semester_submissions := scholarship_private.lock_submission(p_submission_id, p_revision);
  notes text := nullif(btrim(p_notes, E' \t\n\r'), '');
begin
  if p_decision is null or p_decision not in ('approved', 'held') then
    raise exception using errcode = '22023', message = 'Choose Approve or Hold.';
  end if;
  if submission.verification_status <> 'verified' or submission.compliance_result = 'not_evaluated' then
    raise exception using errcode = '22023', message = 'Verify evidence and save a compliance evaluation before deciding renewal.';
  end if;
  if p_decision = 'approved' and submission.compliance_result <> 'compliant' then
    raise exception using errcode = '22023', message = 'Only a compliant submission may be approved.';
  end if;
  if notes is null or char_length(notes) > 1000 then
    raise exception using errcode = '22023', message = 'Enter decision notes of up to 1,000 characters.';
  end if;
  update public.semester_submissions set renewal_decision = p_decision, updated_at = clock_timestamp()
    where id = submission.id;
  insert into public.renewal_history (
    submission_id, decided_by, revision, decision, decision_notes
  ) values (submission.id, actor_id, submission.revision, p_decision, notes);
end;
$$;

create function public.staff_dashboard(p_academic_year text, p_semester integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  term_year public.academic_year_value := scholarship_private.academic_year(p_academic_year);
  dashboard jsonb;
begin
  perform scholarship_private.require_role('staff');
  perform scholarship_private.validate_semester(p_semester);
  with roster as (
    select person.id as scholar_id, person.full_name, person.student_id,
      p.id as program_id, p.program_name, a.award_status,
      s.verification_status, s.compliance_result, to_jsonb(s) as submission
    from public.user_profiles person
    left join public.semester_submissions s
      on s.scholar_id = person.id and s.academic_year = term_year and s.semester = p_semester
    left join lateral (
      select candidate.id from public.scholar_assignments candidate
      where candidate.scholar_id = person.id
        and (candidate.effective_academic_year, candidate.effective_semester) <= (term_year, p_semester)
      order by candidate.effective_academic_year desc, candidate.effective_semester desc limit 1
    ) applicable on s.id is null
    join public.scholar_assignments a on a.id = coalesce(s.assignment_id, applicable.id)
    join public.scholarship_programs p on p.id = a.program_id
    where person.role = 'scholar' and (a.award_status = 'Active' or s.id is not null)
  )
  select jsonb_build_object(
    'total_assigned', count(*),
    'pending', count(*) filter (where verification_status = 'pending'),
    'compliant', count(*) filter (where compliance_result = 'compliant'),
    'with_deficiency', count(*) filter (where compliance_result = 'with_deficiency'),
    'rows', coalesce(jsonb_agg(to_jsonb(roster) order by full_name, student_id), '[]'::jsonb)
  ) into dashboard from roster;
  return dashboard;
end;
$$;

revoke all on function scholarship_private.policy_checks(public.semester_submissions) from public, anon, authenticated;
revoke execute on function public.staff_preview_compliance(uuid, integer),
  public.staff_evaluate_compliance(uuid, integer),
  public.staff_decide_renewal(uuid, integer, public.renewal_state, text),
  public.staff_dashboard(text, integer) from public, anon, authenticated;
grant execute on function public.staff_preview_compliance(uuid, integer),
  public.staff_evaluate_compliance(uuid, integer),
  public.staff_decide_renewal(uuid, integer, public.renewal_state, text),
  public.staff_dashboard(text, integer) to authenticated;

commit;
