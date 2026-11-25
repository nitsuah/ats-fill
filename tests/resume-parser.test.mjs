import { test } from 'node:test';
import assert from 'node:assert/strict';
import { structureResume, resumeDisplayName } from '../lib/resume-parser.js';

test('structureResume empty object returns defaults', () => {
  const result = structureResume({});
  assert.strictEqual(result.name, '');
  assert.strictEqual(result.email, '');
  assert.strictEqual(result.phone, '');
  assert.strictEqual(result.location, '');
  assert.strictEqual(result.address_line1, '');
  assert.strictEqual(result.city, '');
  assert.strictEqual(result.state_region, '');
  assert.strictEqual(result.postal_code, '');
  assert.strictEqual(result.linkedin, '');
  assert.strictEqual(result.github, '');
  assert.strictEqual(result.portfolio, '');
  assert.strictEqual(result.pronouns, '');
  assert.strictEqual(result.sensitive_optin, false);
  assert.strictEqual(result.gender, '');
  assert.strictEqual(result.race, '');
  assert.strictEqual(result.veteran, '');
  assert.strictEqual(result.disability, '');
  assert.strictEqual(result.pronouns_sensitive, '');
  assert.strictEqual(result.current_company, '');
  assert.strictEqual(result.current_title, '');
  assert.strictEqual(result.why_company_default, '');
  assert.strictEqual(result.why_role_default, '');
  assert.strictEqual(result.additional_info_default, '');
  assert.strictEqual(result.start_date, '');
  assert.strictEqual(result.requires_sponsorship, '');
  assert.strictEqual(result.summary, '');
  assert.deepStrictEqual(result.skills, []);
  assert.deepStrictEqual(result.experience, []);
  assert.deepStrictEqual(result.education, []);
  assert.deepStrictEqual(result.certifications, []);
  assert.deepStrictEqual(result.languages, []);
  assert.strictEqual(result.years_of_experience, 0);
});

test('structureResume aliases: address fills address_line1, state fills state_region, zip fills postal_code; canonical wins', () => {
  const result = structureResume({
    address: '123 Alias St',
    state: 'CA',
    zip: '90210',
    address_line1: '456 Canonical Ave',
    state_region: 'NY',
    postal_code: '10001',
  });
  assert.strictEqual(result.address_line1, '456 Canonical Ave');
  assert.strictEqual(result.state_region, 'NY');
  assert.strictEqual(result.postal_code, '10001');
});

test('structureResume current_company and current_title fall back to experience[0] when not supplied', () => {
  const result = structureResume({
    experience: [{ company: 'Acme Corp', title: 'Engineer' }],
  });
  assert.strictEqual(result.current_company, 'Acme Corp');
  assert.strictEqual(result.current_title, 'Engineer');
});

test('structureResume explicit current_company and current_title win over experience[0]', () => {
  const result = structureResume({
    current_company: 'Explicit Inc',
    current_title: 'Lead',
    experience: [{ company: 'Acme Corp', title: 'Engineer' }],
  });
  assert.strictEqual(result.current_company, 'Explicit Inc');
  assert.strictEqual(result.current_title, 'Lead');
});

test('structureResume non-array skills becomes empty array', () => {
  assert.deepStrictEqual(structureResume({ skills: 'JavaScript' }).skills, []);
  assert.deepStrictEqual(structureResume({ skills: 123 }).skills, []);
  assert.deepStrictEqual(structureResume({ skills: null }).skills, []);
});

test('structureResume sensitive_optin true only for boolean true', () => {
  assert.strictEqual(structureResume({ sensitive_optin: true }).sensitive_optin, true);
  assert.strictEqual(structureResume({ sensitive_optin: 'true' }).sensitive_optin, false);
  assert.strictEqual(structureResume({ sensitive_optin: 1 }).sensitive_optin, false);
  assert.strictEqual(structureResume({ sensitive_optin: 'false' }).sensitive_optin, false);
  assert.strictEqual(structureResume({}).sensitive_optin, false);
});

test('structureResume experience entries get defaults', () => {
  const result = structureResume({
    experience: [{ company: 'Acme', title: 'Eng' }],
  });
  const exp = result.experience[0];
  assert.strictEqual(exp.company, 'Acme');
  assert.strictEqual(exp.title, 'Eng');
  assert.strictEqual(exp.start, '');
  assert.strictEqual(exp.end, 'Present');
  assert.strictEqual(exp.description, '');
});

test('structureResume education entries default each field to empty string', () => {
  const result = structureResume({
    education: [{ institution: 'MIT' }],
  });
  const edu = result.education[0];
  assert.strictEqual(edu.institution, 'MIT');
  assert.strictEqual(edu.degree, '');
  assert.strictEqual(edu.field, '');
  assert.strictEqual(edu.year, '');
});

test('structureResume years_of_experience explicit value with no dates stays explicit', () => {
  const result = structureResume({
    years_of_experience: 10,
    experience: [],
  });
  assert.strictEqual(result.years_of_experience, 10);
});

test('structureResume years_of_experience estimated from two entries 2015..2018 and 2018..2020', () => {
  const result = structureResume({
    experience: [
      { start: '2015', end: '2018' },
      { start: '2018', end: '2020' },
    ],
  });
  // 2015 to 2020 = 5 years
  assert.strictEqual(result.years_of_experience, 5);
});

test('structureResume larger of explicit and estimated wins', () => {
  const result = structureResume({
    years_of_experience: 3,
    experience: [
      { start: '2015', end: '2020' }, // 5 years estimated
    ],
  });
  assert.strictEqual(result.years_of_experience, 5);
});

test('structureResume negative or NaN explicit years ignored', () => {
  assert.strictEqual(structureResume({ years_of_experience: -5 }).years_of_experience, 0);
  assert.strictEqual(structureResume({ years_of_experience: NaN }).years_of_experience, 0);
  assert.strictEqual(structureResume({ years_of_experience: 'abc' }).years_of_experience, 0);
});

test('resumeDisplayName returns name when present', () => {
  assert.strictEqual(resumeDisplayName({ name: 'Ada' }), 'Ada');
});

test('resumeDisplayName empty object returns fallback', () => {
  assert.strictEqual(resumeDisplayName({}), 'Resume loaded');
});

test('resumeDisplayName undefined returns fallback', () => {
  assert.strictEqual(resumeDisplayName(undefined), 'Resume loaded');
});