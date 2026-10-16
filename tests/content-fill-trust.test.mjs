import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Trust rules for the live content script: what ats-fill typed must not be
// treated as the user's own answer (drafts, learned memory), radio groups are
// learned under their question, and the saved resume only goes into
// Resume/CV upload fields.
const CONTENT_JS = readFileSync(new URL('../content/content.js', import.meta.url), 'utf8');

function load(body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    url: 'https://jobs.ashbyhq.com/acme/123/application',
    runScripts: 'outside-only',
  });
  const { window } = dom;
  Object.defineProperty(window.HTMLElement.prototype, 'innerText', {
    get() { return this.textContent; },
    configurable: true,
  });
  window.chrome = {
    runtime: { onMessage: { addListener() {} }, sendMessage: () => Promise.resolve() },
  };
  window.eval(CONTENT_JS);
  return window;
}

test('values ats-fill typed are not learned until the user changes them', () => {
  const window = load(`
    <form>
      <label for="why">Why do you want to work here?</label>
      <textarea id="why"></textarea>
      <label for="hear">Where did you hear about this vacancy?</label>
      <input id="hear" />
    </form>
  `);
  const { document } = window;

  window.fillForm({
    'Why do you want to work here?': 'Generated answer about the mission',
    'Where did you hear about this vacancy?': 'Company careers page',
  }, {});

  assert.equal(document.getElementById('why').value, 'Generated answer about the mission');
  assert.deepEqual({ ...window.collectLearnedAnswerEntries() }, {});

  document.getElementById('hear').value = 'Jobicy';
  assert.deepEqual({ ...window.collectLearnedAnswerEntries() }, {
    'Where did you hear about this vacancy?': 'Jobicy',
  });
  window.close();
});

test('radio groups are learned under their question, not the option label', () => {
  const window = load(`
    <fieldset>
      <legend>Are you open to relocation?</legend>
      <input type="radio" name="reloc" id="r1" value="Yes" /><label for="r1">Yes, anywhere</label>
      <input type="radio" name="reloc" id="r2" value="No" /><label for="r2">No</label>
    </fieldset>
  `);
  window.document.getElementById('r2').checked = true;

  assert.deepEqual({ ...window.collectLearnedAnswerEntries() }, {
    'Are you open to relocation?': 'No',
  });
  window.close();
});

test('the saved resume only targets Resume/CV upload fields', () => {
  const window = load(`
    <div class="ashby-application-form-field-entry">
      <input type="file" id="autofill" />
      <p>Autofill from resume</p>
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="_systemfield_resume">Resume</label>
      <input type="file" id="_systemfield_resume" accept=".pdf,.docx" />
    </div>
    <div class="ashby-application-form-field-entry">
      <label for="cl">Cover letter</label>
      <input type="file" id="cl" />
    </div>
    <label for="job_application_resume">CV / Resume</label>
    <input type="file" id="job_application_resume" name="job_application[resume]" />
  `);
  const { document } = window;
  const targets = Array.from(document.querySelectorAll('input[type="file"]'))
    .filter((input) => window.isResumeFileInput(input))
    .map((input) => input.id);

  assert.deepEqual(targets, ['_systemfield_resume', 'job_application_resume']);
  window.close();
});

test('the saved resume is decoded locally and respects the field accept list', () => {
  const window = load('');
  const file = window.dataUrlToFile('data:application/pdf;base64,JVBERi0=', 'Resume.pdf', 'application/pdf');

  assert.equal(file.name, 'Resume.pdf');
  assert.equal(file.size, 5);
  assert.equal(window.fileMatchesAccept(file, '.pdf,.docx'), true);
  assert.equal(window.fileMatchesAccept(file, 'application/*'), true);
  assert.equal(window.fileMatchesAccept(file, '.docx'), false);
  assert.equal(window.fileMatchesAccept(file, ''), true);
  window.close();
});

test('a filled text field gets the click-in / tab-out events React forms commit on', () => {
  const window = load(`
    <form>
      <label for="gh">Github Profile</label>
      <input id="gh" />
    </form>
  `);
  const { document } = window;
  const seen = [];
  for (const type of ['focusin', 'input', 'change', 'focusout']) {
    // Listen on the document, the way React's root listener does.
    document.addEventListener(type, (event) => {
      if (event.target.id === 'gh') seen.push(`${type}:${document.getElementById('gh').value}`);
    });
  }

  window.fillForm({ github: 'github.com/example' }, { github: 'github' });

  assert.deepEqual(seen, [
    'focusin:',
    'input:github.com/example',
    'change:github.com/example',
    'focusout:github.com/example',
  ]);
  window.close();
});

test('type-ahead options match on every word, with US states and countries spelled out', () => {
  const window = load('');
  const { document } = window;
  const options = ['Sevierville, Arkansas, United States', 'Sevierville, Tennessee, United States', 'United States +1']
    .map((text) => Object.assign(document.createElement('div'), { textContent: text }));

  assert.equal(window.pickComboboxOption(options, 'Sevierville, TN, US')?.textContent, 'Sevierville, Tennessee, United States');
  assert.equal(window.pickComboboxOption(options, 'United States')?.textContent, 'United States +1');
  assert.equal(window.pickComboboxOption(options, 'Reston, VA'), null);
  window.close();
});

test('a react-select style combobox is opened with mousedown, searched, and its option clicked', async () => {
  const window = load(`
    <form>
      <label id="loc-label" for="loc">Location (City)</label>
      <div class="select__control">
        <div class="select__value-container">
          <input id="loc" role="combobox" aria-autocomplete="list" aria-required="true" />
        </div>
        <div class="select__indicators"></div>
      </div>
    </form>
  `);
  const { document } = window;
  const control = document.querySelector('.select__control');
  const input = document.getElementById('loc');
  let open = false;
  const searches = [];
  // Like Greenhouse: typing alone doesn't open the menu; a pointer press does.
  control.addEventListener('mousedown', () => { open = true; });
  input.addEventListener('input', () => {
    searches.push(input.value);
    document.querySelectorAll('[role="option"]').forEach((node) => node.remove());
    if (!open || !input.value) return;
    for (const text of [`${input.value}, Arkansas, United States`, `${input.value}, Tennessee, United States`]) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.id = `react-select-loc-option-${text.length}`;
      option.textContent = text;
      option.addEventListener('click', () => {
        const chosen = document.createElement('div');
        chosen.className = 'select__single-value';
        chosen.textContent = text;
        control.querySelector('.select__value-container').prepend(chosen);
        input.value = '';
      });
      document.body.append(option);
    }
  });

  const result = await window.fillComboboxes({ location: 'Sevierville, TN, US' }, { location: 'location' });

  assert.equal(result.filled, 1);
  assert.deepEqual(searches, ['Sevierville']);
  assert.equal(document.querySelector('.select__single-value')?.textContent, 'Sevierville, Tennessee, United States');
  window.close();
});

test('splitFullName keeps middle initials out of the last name', async () => {
  const { splitFullName } = await import('../lib/utils.js');
  assert.deepEqual(splitFullName('Austin J. Hardy'), { first: 'Austin', last: 'Hardy' });
  assert.deepEqual(splitFullName('Austin Hardy'), { first: 'Austin', last: 'Hardy' });
  assert.deepEqual(splitFullName('Ann Lee Jr.'), { first: 'Ann', last: 'Lee Jr.' });
  assert.deepEqual(splitFullName('Cher'), { first: 'Cher', last: '' });
});

test('short dropdown lists fall back to careful matches and never guess', () => {
  const window = load('');
  const { document } = window;
  const list = (...texts) => texts.map((text) => Object.assign(document.createElement('div'), { textContent: text }));
  const yesNo = list('Yes', 'No');

  const authorized = 'Are you legally authorized to work in the United States?';
  assert.equal(window.pickComboboxFallback(yesNo, 'US Citizen', authorized)?.textContent, 'Yes');
  assert.equal(window.pickComboboxFallback(yesNo, 'No sponsorship required', 'Will you require sponsorship?')?.textContent, 'No');
  assert.equal(window.pickComboboxFallback(yesNo, 'US Citizen', 'Do you require visa sponsorship now or in the future?')?.textContent, 'No');
  assert.equal(window.pickComboboxFallback(yesNo, 'US Citizen', 'Are you currently located in the US?'), null);
  assert.equal(window.pickComboboxFallback(list('Man', 'Woman', 'Non-binary'), 'Male')?.textContent, 'Man');
  assert.equal(
    window.pickComboboxFallback(list('I am not a protected veteran', 'I identify as a protected veteran', "I don't wish to answer"), 'No')?.textContent,
    'I am not a protected veteran',
  );
  window.close();
});

test('type-ahead search text is not saved to drafts or learned memory', () => {
  const window = load(`
    <label for="country">Country</label>
    <div class="select__control"><input id="country" role="combobox" aria-autocomplete="list" /></div>
  `);
  window.document.getElementById('country').value = 'United St';
  assert.deepEqual({ ...window.collectLearnedAnswerEntries() }, {});
  window.close();
});

test('a checkbox group needing review is one item named after its question', () => {
  const window = load(`
    <fieldset>
      <legend>Which of the following applies to you?</legend>
      <label><input type="checkbox" name="export[]" value="a" /> U.S. citizen</label>
      <label><input type="checkbox" name="export[]" value="b" /> U.S. permanent resident</label>
      <label><input type="checkbox" name="export[]" value="c" /> None of these apply to me</label>
    </fieldset>
  `);

  const report = window.fillForm({}, {});

  assert.deepEqual(Array.from(report.unresolved, (item) => item.label), ['Which of the following applies to you?']);
  window.close();
});

test('decline answers match each form\'s own wording', () => {
  const window = load('');
  const { document } = window;
  const options = ['Yes', 'No', "I don't wish to answer"].map((text) => Object.assign(document.createElement('div'), { textContent: text }));
  assert.equal(window.pickComboboxFallback(options, 'Prefer not to say.', 'Are you Hispanic/Latino?')?.textContent, "I don't wish to answer");
  window.close();
});
