import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { extractJsonCandidate, parseJsonResponse } from '../lib/gemini.js';
import {
  findBestSelectOptionValue,
  findLearnedAnswer,
  isIgnoredLearnedPrompt,
  resolveAnswerKeyFromCandidates,
  shouldPersistLearnedValue,
} from '../lib/form-filler.js';
import { structureResume } from '../lib/resume-parser.js';
import {
  deriveTrackerDetailsFromText,
  filterApplicationsForQuery,
  isTerminalApplicationStatus,
  normalizeApplicationStatus,
  normalizeEmploymentType,
  parseApplicationsCsv,
} from '../lib/tracker.js';

const fieldMap = JSON.parse(
  await readFile(new URL('../data/field-map.json', import.meta.url), 'utf8')
);

test('extractJsonCandidate pulls JSON out of surrounding text', () => {
  const raw = 'Sure — here you go:\n```json\n{\n  "email": "a@example.com"\n}\n```\nThanks!';
  assert.equal(extractJsonCandidate(raw), '{\n  "email": "a@example.com"\n}');
});

test('parseJsonResponse handles fenced JSON and trailing commas', () => {
  const parsed = parseJsonResponse('```json\n{"name":"Austin","skills":["IT",],}\n```');
  assert.equal(parsed.name, 'Austin');
  assert.deepEqual(parsed.skills, ['IT']);
});

test('parseJsonResponse handles extra prose before a valid object', () => {
  const parsed = parseJsonResponse('Result: {"linkedin":"linkedin.com/in/example","github":"github.com/example"}');
  assert.equal(parsed.linkedin, 'linkedin.com/in/example');
  assert.equal(parsed.github, 'github.com/example');
});

test('parseJsonResponse salvages partial JSON objects', () => {
  const parsed = parseJsonResponse('{"name":"Austin Hardy","city":"Sevierville","state_region":"TN","postal_code":');
  assert.equal(parsed.name, 'Austin Hardy');
  assert.equal(parsed.city, 'Sevierville');
  assert.equal(parsed.state_region, 'TN');
});

test('resolveAnswerKeyFromCandidates maps common ATS salary prompts', () => {
  const key = resolveAnswerKeyFromCandidates(
    ['What is the beginning of your desired annual base salary range?'],
    fieldMap,
    {}
  );
  assert.equal(key, 'desired_salary_min');
});

test('resolveAnswerKeyFromCandidates matches current title and work auth prompts', () => {
  const currentTitleKey = resolveAnswerKeyFromCandidates(['Current job title?'], fieldMap, {});
  const workAuthKey = resolveAnswerKeyFromCandidates(
    ['Are you legally authorized to work in the countries listed in the job posting?'],
    fieldMap,
    {}
  );

  assert.equal(currentTitleKey, 'current_title');
  assert.equal(workAuthKey, 'work_authorization');
});

test('findBestSelectOptionValue handles ATS sponsorship and notice-period dropdown wording', () => {
  const sponsorshipOption = findBestSelectOptionValue([
    { value: 'YES', text: 'Yes, I will require visa sponsorship now or in the future' },
    { value: 'NO', text: 'No, I do not require sponsorship for employment' },
  ], 'No sponsorship required');

  const startDateOption = findBestSelectOptionValue([
    { value: 'immediate', text: 'Immediately' },
    { value: '2weeks', text: 'Within 2 weeks' },
    { value: 'month', text: 'Within 1 month' },
  ], '2 weeks notice');

  assert.equal(sponsorshipOption?.value, 'NO');
  assert.equal(startDateOption?.value, '2weeks');
});

test('normalizeApplicationStatus keeps tracker semantics honest', () => {
  assert.equal(normalizeApplicationStatus('applied'), 'submitted');
  assert.equal(normalizeApplicationStatus('filled'), 'filled');
  assert.equal(normalizeApplicationStatus(''), 'drafted');
});

test('resolveAnswerKeyFromCandidates can reuse exact saved custom answers', () => {
  const answers = {
    'Why 1Password?': 'I enjoy building reliable internal systems that remove friction for teams.',
  };
  const key = resolveAnswerKeyFromCandidates(['Why 1Password?'], fieldMap, answers);
  assert.equal(key, 'Why 1Password?');
});

test('structureResume derives years of experience when parsed value is zero', () => {
  const resume = structureResume({
    years_of_experience: 0,
    experience: [
      { company: 'Acme', title: 'Engineer', start: '2020', end: 'Present', description: 'Built things' },
    ],
  });

  assert.ok(resume.years_of_experience >= 1);
});

test('findLearnedAnswer reuses prior answers for similar prompts', () => {
  const answer = findLearnedAnswer('Will you need security clearance for this role?', {
    'Do you require security clearance?': 'No',
    'What timezone are you in?': 'Eastern',
  });

  assert.equal(answer, 'No');
});

test('shouldPersistLearnedValue avoids highly sensitive PII prompts', () => {
  assert.equal(shouldPersistLearnedValue('Social Security Number', '123-45-6789'), false);
  assert.equal(shouldPersistLearnedValue('Date of birth', '1993-01-02'), false);
  assert.equal(shouldPersistLearnedValue('Do you require security clearance?', 'No'), true);
});

test('shouldPersistLearnedValue ignores legal acknowledgements and arbitration confirmations', () => {
  assert.equal(
    shouldPersistLearnedValue(
      'I acknowledge that I have opened, read, and understood the Arbitration Agreement.',
      'I confirm I have read the above.'
    ),
    false
  );
});

test('shouldPersistLearnedValue rejects generic placeholders and malformed freeform captures', () => {
  assert.equal(shouldPersistLearnedValue('Start typing...', 'Company careers page'), false);
  assert.equal(shouldPersistLearnedValue('Not listed', 'No'), false);
  assert.equal(
    shouldPersistLearnedValue('Please briefly outline any experience you have deploying systems at scale.', '2406721206'),
    false
  );
  assert.equal(shouldPersistLearnedValue('X (formerly Twitter) URL', 'https://x.com/example'), false);
});

test('isIgnoredLearnedPrompt blocks ignored outlier prompts until the ignore is removed', () => {
  const ignored = {
    'work authorization countries listed in the job posting': {
      question: 'Are you legally authorized to work in the countries listed in the job posting?',
      answer: 'Yes',
    },
  };

  assert.equal(
    isIgnoredLearnedPrompt('Are you legally authorized to work in the countries listed in the job posting?', ignored),
    true
  );
  assert.equal(isIgnoredLearnedPrompt('What timezone are you in?', ignored), false);
});

test('structureResume preserves explicit demographic opt-in fields', () => {
  const resume = structureResume({
    name: 'Example User',
    sensitive_optin: true,
    gender: 'Male',
    race: 'White',
    veteran: 'No',
    disability: 'No',
    pronouns_sensitive: 'He/him',
  });

  assert.equal(resume.sensitive_optin, true);
  assert.equal(resume.gender, 'Male');
  assert.equal(resume.race, 'White');
  assert.equal(resume.veteran, 'No');
  assert.equal(resume.disability, 'No');
  assert.equal(resume.pronouns_sensitive, 'He/him');
});

test('resolveAnswerKeyFromCandidates maps common demographic prompts when opted in', () => {
  const genderKey = resolveAnswerKeyFromCandidates(['Gender identity'], fieldMap, {});
  const veteranKey = resolveAnswerKeyFromCandidates(['Protected veteran status'], fieldMap, {});

  assert.equal(genderKey, 'gender');
  assert.equal(veteranKey, 'veteran');
});

test('normalizeEmploymentType applies sensible tracker defaults', () => {
  assert.equal(normalizeEmploymentType(''), 'Full-time');
  assert.equal(normalizeEmploymentType('part time'), 'Part-time');
  assert.equal(normalizeEmploymentType('contract'), 'Contract');
});

test('isTerminalApplicationStatus hides fill review after submission-style states', () => {
  assert.equal(isTerminalApplicationStatus('filled'), false);
  assert.equal(isTerminalApplicationStatus('drafted'), false);
  assert.equal(isTerminalApplicationStatus('submitted'), true);
  assert.equal(isTerminalApplicationStatus('interview'), true);
  assert.equal(isTerminalApplicationStatus('offer'), true);
});

test('deriveTrackerDetailsFromText extracts location, salary, remote flag, and employment type from pasted JD text', () => {
  const details = deriveTrackerDetailsFromText(`
    Senior Platform Engineer
    Location: San Francisco, CA
    Compensation: $180,000 - $220,000
    This is a full time hybrid role with occasional work from home flexibility.
  `);

  assert.equal(details.location, 'San Francisco, CA');
  assert.equal(details.salary_range, '$180,000 - $220,000');
  assert.equal(details.employment_type, 'Full-time');
  assert.equal(details.remote, true);
});

test('parseApplicationsCsv maps common import columns and skips blank rows', () => {
  const parsed = parseApplicationsCsv(`Company,Role Title,Status,Date,Employment Type,Remote,Location,Salary Range,Scorecard,Verdict,URL,Notes
Acme,Senior Engineer,Applied,2026-04-03,Full time,Yes,Remote,"$180,000 - $220,000",Strong fit,Top choice,https://example.com/jobs/1,"Great backend match"
,,,,,,,,,,,
Beta,Platform Analyst,Interview,04/01/2026,Contract,No,Austin,,$$,,https://example.com/jobs/2,"Take-home complete"`);

  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.skipped, 1);
  assert.equal(parsed.items[0].status, 'submitted');
  assert.equal(parsed.items[0].remote, true);
  assert.equal(parsed.items[0].date, '2026-04-03');
  assert.equal(parsed.items[1].employment_type, 'Contract');
  assert.equal(parsed.items[1].date, '2026-04-01');
});

test('filterApplicationsForQuery narrows tracker results by search text and active-only mode', () => {
  const apps = [
    { company: 'Stripe', title: 'IT Systems Engineer', status: 'drafted', verdict: 'Top choice', description: 'Identity and device automation' },
    { company: 'Northwind', title: 'Systems Administrator', status: 'interview', verdict: 'Panel next week', description: 'Infrastructure and Okta' },
    { company: 'CloudCo', title: 'Infrastructure Analyst', status: 'rejected', verdict: 'Archived', description: 'Networking and support' },
  ];

  assert.equal(filterApplicationsForQuery(apps, 'okta').length, 1);
  assert.equal(filterApplicationsForQuery(apps, 'systems').length, 2);
  // Active = every stage except rejected/retired, so drafted + interview both count.
  assert.equal(filterApplicationsForQuery(apps, '', { activeOnly: true }).length, 2);
  assert.equal(filterApplicationsForQuery(apps, 'cloud', { activeOnly: true }).length, 0);
});

test('filterApplicationsForQuery is case-insensitive for titles', () => {
  const apps = [
    { company: 'Stripe', title: 'IT Systems Engineer', status: 'drafted', verdict: 'Top choice', description: 'Identity and device automation' },
  ];
  assert.equal(filterApplicationsForQuery(apps, 'it systems engineer').length, 1);
  assert.equal(filterApplicationsForQuery(apps, 'IT SYSTEMS ENGINEER').length, 1);
});

test('learned memory skips placeholder non-answers', async () => {
  const { shouldPersistLearnedValue } = await import('../lib/form-filler.js');
  assert.equal(shouldPersistLearnedValue('Where did you hear about this vacancy?', 'Not specified.'), false);
  assert.equal(shouldPersistLearnedValue('Preferred pronouns', 'N/A'), false);
  assert.equal(shouldPersistLearnedValue('Where did you hear about this vacancy?', 'Not specified in the provided information.'), false);
  assert.equal(shouldPersistLearnedValue('Where did you hear about this vacancy?', 'Jobicy'), true);
});
