import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyEmail, flattenEmails, planTrackerChanges, normalizeCompany } from '../scripts/tracker/email-triage.mjs';
import { gmailQuery, summarize } from '../scripts/tracker/cli.mjs';

// Shapes copied from real ATS mailers; names and roles are made up.
const MAIL = {
  greenhouse: { id: 'gh', date: '2026-10-14T08:33:07Z', sender: 'no-reply@us.greenhouse-mail.io', subject: 'Thank you for applying to Northwind', snippet: 'Dear Alex, Thank you for applying to the AI Architect - GTM Systems role and for choosing Northwind in your job search!' },
  ashby: { id: 'ab', date: '2026-10-04T00:38:23Z', sender: 'no-reply@ashbyhq.com', subject: 'Thank you for Applying to Contoso', snippet: 'Hi Alex, Thank you for your interest in Contoso! We received your application for the Staff Machine Learning Engineer, and we&#39;re delighted' },
  workable: { id: 'wk', date: '2026-10-14T04:52:08Z', sender: 'noreply@candidates.workablemail.com', subject: 'Thanks for applying to Fabrikam Law', snippet: 'Fabrikam Law Your application for the AI Workflow Engineer/Automation Architect job was submitted successfully.' },
  comeet: { id: 'cm', date: '2026-10-14T04:50:30Z', sender: 'no-reply@tailspin.comeet-notifications.com', subject: 'We Got It: Thanks for applying for Solutions Architect', snippet: 'Hi, Thank you for applying for a position at Tailspin. We received your information and will contact you if there is a good match.' },
  dice: { id: 'dc', date: '2026-10-04T00:47:31Z', sender: 'applyonline@dice.com', subject: 'Application for Platform &amp; ITSM Engineer at Litware Solutions sent', snippet: 'Your application for Platform &amp; ITSM Engineer at Litware Solutions was successfully submitted.' },
  ownDomainApplied: { id: 'am1', date: '2026-10-04T01:19:48Z', sender: 'noreply@mail.wingtip.jobs', subject: 'Keep track of your application', snippet: 'Hi Alex, Thank you for your interest in Sr Admin Engineer, Productivity Services (ID: 104). If you have completed the' },
  truncatedReject: { id: 'am2', date: '2026-10-05T13:19:58Z', sender: 'noreply@mail.wingtip.jobs', subject: 'Wingtip application: Status update', snippet: 'Hi Alex, Thank you for your application for the position of Sr Admin Engineer, Productivity Services (ID: 104). After careful' },
  reject: { id: 'qn', date: '2026-09-21T14:09:08Z', sender: 'no-reply@ashbyhq.com', subject: 'Update on Your Application with Proseware', snippet: 'Thank you for your interest in the Senior Infrastructure Engineer position at Proseware and for the time you invested in the interview process. After careful consideration, we have decided' },
  interview: { id: 'iv', date: '2026-10-15T10:00:00Z', sender: 'Jamie <jamie@contoso.com>', subject: 'Next steps with Contoso', snippet: 'Hi Alex, we would like to schedule a call with the hiring manager. Could you share your availability this week?' },
  offer: { id: 'of', date: '2026-10-20T10:00:00Z', sender: 'people@contoso.com', subject: 'Your offer from Contoso', snippet: 'We are pleased to extend an offer for the Staff Machine Learning Engineer role.' },
  boardMarketing: { id: 'mk', date: '2026-10-12T08:17:03Z', sender: 'dice@connect.dice.com', subject: 'Nail your next interview', snippet: 'Get interview ready with expert tips' },
  newsletter: { id: 'nw', date: '2026-10-13T18:32:40Z', sender: 'hello@mail.example-crypto.io', subject: 'Crypto portfolio update', snippet: 'Portfolio value: $1.00 Past day return' },
};

test('classifyEmail reads event, company and role from common ATS mailers', () => {
  const cases = [
    [MAIL.greenhouse, 'applied', 'Northwind', 'AI Architect - GTM Systems'],
    [MAIL.ashby, 'applied', 'Contoso', 'Staff Machine Learning Engineer'],
    [MAIL.workable, 'applied', 'Fabrikam Law', 'AI Workflow Engineer/Automation Architect'],
    [MAIL.comeet, 'applied', 'Tailspin', 'Solutions Architect'],
    [MAIL.dice, 'applied', 'Litware Solutions', 'Platform & ITSM Engineer'],
    [MAIL.ownDomainApplied, 'applied', 'Wingtip', 'Sr Admin Engineer, Productivity Services'],
    [MAIL.truncatedReject, 'rejected', 'Wingtip', 'Sr Admin Engineer'],
    [MAIL.reject, 'rejected', 'Proseware', 'Senior Infrastructure Engineer'],
    [MAIL.interview, 'interview', 'Contoso', ''],
    [MAIL.offer, 'offer', 'Contoso', 'Staff Machine Learning Engineer'],
  ];
  for (const [mail, event, company, role] of cases) {
    const got = classifyEmail(mail);
    assert.equal(got.event, event, `${mail.id} event`);
    assert.equal(got.company, company, `${mail.id} company`);
    assert.equal(got.role, role, `${mail.id} role`);
  }
});

test('classifyEmail treats job-board marketing and unrelated mail as noise', () => {
  assert.equal(classifyEmail(MAIL.boardMarketing).event, 'noise');
  assert.equal(classifyEmail(MAIL.newsletter).event, 'noise');
});

test('flattenEmails accepts Gmail search_threads output, message lists and arrays', () => {
  const threads = { threads: [{ id: 't1', messages: [MAIL.greenhouse, MAIL.ashby] }, { id: 't2', messages: [MAIL.dice] }] };
  assert.equal(flattenEmails(threads).length, 3);
  assert.equal(flattenEmails(JSON.stringify(threads)).length, 3);
  assert.equal(flattenEmails({ messages: [MAIL.dice] }).length, 1);
  assert.equal(flattenEmails([MAIL.dice, { messages: [MAIL.ashby] }]).length, 2);
  assert.deepEqual(flattenEmails({}), []);
});

test('planTrackerChanges moves tracked apps forward only, oldest email first', () => {
  const apps = [
    { id: 'a1', company: 'Contoso Inc.', title: 'Staff Machine Learning Engineer', status: 'submitted', updated_at: '2026-10-04' },
    { id: 'a2', company: 'Proseware', title: 'Senior Infrastructure Engineer', status: 'interview', updated_at: '2026-09-10' },
  ];
  const mails = [MAIL.offer, MAIL.interview, MAIL.ashby, MAIL.reject].map(classifyEmail);
  const plan = planTrackerChanges(apps, mails);

  assert.deepEqual(plan.updates.map((u) => [u.id, u.from, u.to]), [
    ['a2', 'interview', 'rejected'],
    ['a1', 'submitted', 'interview'],
    ['a1', 'interview', 'offer'],
  ]);
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['already submitted']);
  assert.equal(plan.adds.length, 0);
  assert.equal(apps[0].status, 'submitted', 'input is not mutated');
});

test('planTrackerChanges folds several emails about an untracked company into one add', () => {
  const plan = planTrackerChanges([], [MAIL.truncatedReject, MAIL.ownDomainApplied, MAIL.boardMarketing].map(classifyEmail));
  assert.equal(plan.adds.length, 1);
  assert.equal(plan.adds[0].company, 'Wingtip');
  assert.equal(plan.adds[0].status, 'rejected');
  assert.equal(plan.adds[0].date, '2026-10-04');
  assert.equal(plan.updates.length, 0);

  const noAdd = planTrackerChanges([], [MAIL.dice].map(classifyEmail), { addMissing: false });
  assert.deepEqual(noAdd.skipped.map((s) => s.reason), ['not tracked']);
});

test('an abbreviated mail domain folds into the company name the emails spell out', () => {
  const mails = [
    { id: 'o1', date: '2026-10-04T00:39:41Z', sender: 'hr@litwaregs.com', subject: 'EEO Self-Identification Form', snippet: 'Hi You have recently applied to a job at Litware Global Solutions through Dice. Thank you for your interest.' },
    { id: 'o2', date: '2026-10-04T00:39:44Z', sender: 'HR@litwaregs.com', subject: 'Application Received for Job #26-00053', snippet: 'Dear Candidate, This message is to acknowledge receipt of your resume.' },
    { id: 'o3', date: '2026-10-04T00:47:31Z', sender: 'applyonline@dice.com', subject: 'Application for ITSM Engineer at Litware Global Solutions sent', snippet: 'Your application for ITSM Engineer at Litware Global Solutions was successfully submitted.' },
  ].map(classifyEmail);
  assert.deepEqual(mails.map((m) => m.company), ['Litware Global Solutions', 'Litwaregs', 'Litware Global Solutions']);

  const plan = planTrackerChanges([], mails);
  assert.deepEqual(plan.adds.map((a) => [a.company, a.title, a.status]), [['Litware Global Solutions', 'ITSM Engineer', 'submitted']]);
});

test('normalizeCompany strips suffixes and punctuation', () => {
  assert.equal(normalizeCompany('Contoso, Inc.'), 'contoso');
  assert.equal(normalizeCompany('Litware Solutions LLC'), 'litware solutions');
  assert.equal(normalizeCompany('AT&amp;T'), 'at t');
});

test('gmailQuery starts a day before the last sync, or 30 days back on first run', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  assert.match(gmailQuery('2026-10-10T08:00:00Z', now), /^after:2026\/10\/09 /);
  assert.match(gmailQuery(null, now), /^after:2026\/09\/13 /);
});

test('summarize reports counts, response rate, stale and unscored apps', () => {
  const now = Date.parse('2026-10-14T12:00:00Z');
  const text = summarize([
    { company: 'A', status: 'submitted', date: '2026-09-01' },
    { company: 'B', status: 'submitted', date: '2026-10-12' },
    { company: 'C', status: 'interview', date: '2026-10-01' },
    { company: 'D', status: 'rejected', date: '2026-09-20' },
    { company: 'E', status: 'drafted', date: '2026-10-13' },
  ], now);
  assert.match(text, /5 total · drafted 1 · submitted 2 · interview 1 · rejected 1/);
  assert.match(text, /response rate: 50% \(2\/4\)/);
  assert.match(text, /interviewing \(1\): C/);
  assert.match(text, /no reply ≥14d \(1\).*A \(43d\)/);
  assert.match(text, /drafts without a verdict \(1\): E/);
});
