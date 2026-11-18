import { icon } from '../components/icons.js';
import { assignmentTimeline } from '../components/submission.js';
import { badge, detailList, emptyState, escapeHtml as h, pageTitle, policyContent } from '../components/ui.js';
import { assignments, programs } from '../services/scholarship.js';
import { effectiveAssignment, EXAM_TERM } from '../utils/academic.js';

export function profilePage(ctx) {
  const { full_name, email, student_id, role } = ctx.profile;
  const roleName = role === 'staff' ? 'Scholarship Staff' : 'Scholar';
  const details = [['Full name', full_name], ['Email address', email], ['Role', roleName]];
  if (student_id) details.push(['Student ID', student_id]);

  ctx.mount(`${pageTitle('Profile', 'Your Scholarship Office account information.')}
    <section class="panel form-panel"><div class="profile-intro"><span class="icon-tile">${icon('user')}</span>
      <div><h2>${h(full_name)}</h2><p class="muted">${h(roleName)}</p></div></div>
      ${detailList(details)}
    </section>`);
}

export async function programsPage(ctx) {
  const scholar = ctx.profile.role === 'scholar';
  const history = scholar ? await assignments(ctx.client, ctx.profile.id) : [];
  const policies = scholar
    ? [...new Map(history.map(({ program }) => [program.id, program])).values()]
    : await programs(ctx.client);
  const active = effectiveAssignment(history, EXAM_TERM.year, EXAM_TERM.semester);
  ctx.mount(`${pageTitle('Scholarship programs', 'Academic requirements and original submission deadlines.')}
    ${policies.length ? `<div class="layout-two program-grid">${policies.map((program) => `
      <section class="panel policy-card"><div class="program-heading"><span class="icon-tile">${icon('cap')}</span>
        <div><h2>${h(program.program_name)}</h2>${active?.program.id === program.id ? badge(active.award_status) : ''}</div></div>
        ${policyContent(program)}
      </section>`).join('')}</div>` : emptyState('The Scholarship Office has not assigned a program to this account.', 'cap')}
    ${scholar && history.length ? `<section class="panel"><h2>Assignment history</h2>${assignmentTimeline(history)}</section>` : ''}`);
}
