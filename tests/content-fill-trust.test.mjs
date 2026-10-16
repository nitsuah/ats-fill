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
