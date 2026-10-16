import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { collectCustomQuestions, fillForm, parseYesNoAnswer } from '../lib/form-filler.js';

function setupDom(html) {
  const dom = new JSDOM(html, { url: 'https://example.com/job' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.Event = dom.window.Event;
  global.CSS = dom.window.CSS || { escape: (value) => String(value).replace(/"/g, '\\"') };
  return dom;
}

test('collectCustomQuestions keeps meaningful prompts and filters sensitive/basic fields', () => {
  setupDom(`
    <main>
      <label>First name</label>
      <label>Why are you interested in this role?</label>
      <label>Why are you interested in this role?</label>
      <label>Gender identity</label>
      <legend>Describe a production incident you handled and the outcome?</legend>
    </main>
  `);

  const questions = collectCustomQuestions();
  assert.deepEqual(questions, [
    'Why are you interested in this role?',
    'Describe a production incident you handled and the outcome?',
  ]);
});

test('fillForm populates text/select/checkbox/radio fields and reports unresolved items', () => {
  setupDom(`
    <form>
      <label for="firstName">First name</label>
      <input id="firstName" name="first_name" />

      <label for="email">Email</label>
      <input id="email" name="email" value="already@set.dev" />

      <label for="auth">Work authorization status</label>
      <select id="auth" name="work authorization">
        <option value="">Select...</option>
        <option value="yes">Yes, authorized</option>
        <option value="no">No</option>
      </select>

      <label><input id="relocate" type="checkbox" name="open_relocation" /> Open to relocate</label>

      <fieldset>
        <legend>Will you require visa sponsorship?</legend>
        <label for="sponsor-yes">Yes</label>
        <input id="sponsor-yes" type="radio" name="sponsorship" value="yes" />
        <label for="sponsor-no">No</label>
        <input id="sponsor-no" type="radio" name="sponsorship" value="no" />
      </fieldset>

      <label for="portfolio">Portfolio</label>
      <input id="portfolio" name="portfolio_url" />
    </form>
  `);

  const answers = {
    first_name: 'Austin',
    work_authorization: 'Yes, authorized to work',
    open_relocation: 'yes',
    requires_sponsorship: 'No sponsorship required',
  };

  const fieldMap = {
    'first name': 'first_name',
    'work authorization': 'work_authorization',
    work_auth: 'work_authorization',
    relocate: 'open_relocation',
    sponsorship: 'requires_sponsorship',
  };

  const result = fillForm(answers, fieldMap, { highlight: false });

  assert.equal(document.getElementById('firstName').value, 'Austin');
  assert.equal(document.getElementById('email').value, 'already@set.dev');
  assert.equal(document.getElementById('relocate').checked, true);
  assert.equal(document.getElementById('sponsor-no').checked, true);

  assert.equal(result.filled >= 3, true);
  assert.equal(result.preserved >= 1, true);
  assert.equal(result.unresolved.some((item) => item.label.toLowerCase().includes('portfolio')), true);
});

test('a long question that uses "address" as a verb is not filled with the street address', () => {
  setupDom(`
    <form>
      <label for="addr">Address</label>
      <input id="addr" />
      <label for="q">Have you designed or implemented solutions to address recurring technical challenges for customers? If yes, briefly describe.</label>
      <textarea id="q"></textarea>
    </form>
  `);

  fillForm({ address_line1: '1 Main St' }, { address: 'address_line1' }, { highlight: false });

  assert.equal(document.getElementById('addr').value, '1 Main St');
  assert.equal(document.getElementById('q').value, '');
});

test('collectCustomQuestions keeps questions that only mention "United States" or "address" in passing', () => {
  setupDom(`
    <main>
      <label>State</label>
      <label>Are you located within the United States?</label>
      <label>Have you designed solutions to address recurring technical challenges for customers?</label>
    </main>
  `);

  assert.deepEqual(collectCustomQuestions(), [
    'Are you located within the United States?',
    'Have you designed solutions to address recurring technical challenges for customers?',
  ]);
});

test('Ashby Yes/No button groups are answered by clicking the matching button', () => {
  setupDom(`
    <form>
      <div class="ashby-application-form-field-entry">
        <label>Are you located within the United States?</label>
        <div class="ashby-application-form-input-yesno">
          <button type="button" aria-pressed="false" data-option="yes">Yes</button>
          <button type="button" aria-pressed="false" data-option="no">No</button>
          <input type="checkbox" tabindex="-1" name="q1" />
        </div>
      </div>
      <div class="ashby-application-form-field-entry">
        <label>Will you now or in the future require visa sponsorship?</label>
        <div class="ashby-application-form-input-yesno">
          <button type="button" aria-pressed="false" data-option="yes">Yes</button>
          <button type="button" aria-pressed="false" data-option="no">No</button>
        </div>
      </div>
      <div class="ashby-application-form-field-entry">
        <label>Have you worked with external clients?</label>
        <div class="ashby-application-form-input-yesno">
          <button type="button" aria-pressed="true" data-option="yes">Yes</button>
          <button type="button" aria-pressed="false" data-option="no">No</button>
        </div>
      </div>
    </form>
  `);
  const clicked = [];
  for (const button of document.querySelectorAll('button')) {
    button.addEventListener('click', () => clicked.push(`${button.closest('.ashby-application-form-field-entry').querySelector('label').textContent}=${button.dataset.option}`));
  }

  const result = fillForm(
    { 'Are you located within the United States?': 'Yes', requires_sponsorship: 'No sponsorship required' },
    { sponsorship: 'requires_sponsorship' },
    { highlight: false },
  );

  assert.deepEqual(clicked, [
    'Are you located within the United States?=yes',
    'Will you now or in the future require visa sponsorship?=no',
  ]);
  assert.equal(document.querySelector('input[name="q1"]').checked, false, 'the hidden checkbox is left to the button handler');
  assert.equal(result.filled, 2);
  assert.equal(result.preserved, 1);
});

test('parseYesNoAnswer only commits to clear answers', () => {
  assert.equal(parseYesNoAnswer('Yes, I am'), 'yes');
  assert.equal(parseYesNoAnswer('No sponsorship required'), 'no');
  assert.equal(parseYesNoAnswer('Not specified.'), null);
  assert.equal(parseYesNoAnswer('I am authorized to work'), null);
  assert.equal(parseYesNoAnswer('It depends'), null);
});

test('an "Other" companion box is never filled with the group answer', () => {
  setupDom(`
    <form>
      <fieldset>
        <legend>Race</legend>
        <label><input type="radio" name="race" value="White" /> White</label>
        <label><input type="radio" name="race" value="Other" /> Other</label>
        <label for="race-other">Other</label>
        <input id="race-other" />
      </fieldset>
    </form>
  `);

  fillForm({ race: 'White' }, { race: 'race' }, { highlight: false });

  assert.equal(document.getElementById('race-other').value, '');
});

test('AI non-answers are left for the user instead of being filled', () => {
  setupDom(`
    <form>
      <label for="hear">Where did you hear about this vacancy?</label>
      <input id="hear" />
    </form>
  `);

  const result = fillForm(
    { 'Where did you hear about this vacancy?': 'Not specified in the provided information.' },
    {},
    { highlight: false },
  );

  assert.equal(document.getElementById('hear').value, '');
  assert.equal(result.unresolved.some((item) => /hear about/i.test(item.label)), true);
});
