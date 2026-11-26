import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { applyAccessibleNames } from '../popup/ux/a11y.js';

if (!globalThis.CSS) globalThis.CSS = { escape: (s) => s };

function run(html) {
  const dom = new JSDOM(`<body>${html}</body>`);
  const { document } = dom.window;
  applyAccessibleNames(document);
  return document;
}

test('placeholder becomes the aria-label', () => {
  const doc = run('<input id="a" placeholder="Search jobs">');
  assert.equal(doc.getElementById('a').getAttribute('aria-label'), 'Search jobs');
});

test('title is used when no placeholder; placeholder wins when both exist', () => {
  const doc = run('<input id="a" title="Only title"><input id="b" placeholder="P" title="T">');
  assert.equal(doc.getElementById('a').getAttribute('aria-label'), 'Only title');
  assert.equal(doc.getElementById('b').getAttribute('aria-label'), 'P');
});

test('select falls back to its first option text with trailing punctuation stripped', () => {
  const doc = run(
    '<select id="a"><option>Status:</option><option>Open</option></select>' +
      '<select id="b"><option>Pick one…</option></select>'
  );
  assert.equal(doc.getElementById('a').getAttribute('aria-label'), 'Status');
  assert.equal(doc.getElementById('b').getAttribute('aria-label'), 'Pick one');
});

test('controls with aria-label or aria-labelledby are left untouched', () => {
  const doc = run(
    '<input id="a" aria-label="Keep" placeholder="Other">' +
      '<input id="b" aria-labelledby="x" placeholder="Other"><span id="x">X</span>'
  );
  assert.equal(doc.getElementById('a').getAttribute('aria-label'), 'Keep');
  assert.equal(doc.getElementById('b').hasAttribute('aria-label'), false);
});

test('controls with label[for] or a wrapping label are left untouched', () => {
  const doc = run(
    '<label for="a">Name</label><input id="a" placeholder="P">' +
      '<label>Wrapped <input id="b" placeholder="P"></label>'
  );
  assert.equal(doc.getElementById('a').hasAttribute('aria-label'), false);
  assert.equal(doc.getElementById('b').hasAttribute('aria-label'), false);
});

test('hidden inputs are skipped and nameless controls get no attribute', () => {
  const doc = run('<input id="a" type="hidden" placeholder="P"><input id="b"><select id="c"></select>');
  assert.equal(doc.getElementById('a').hasAttribute('aria-label'), false);
  assert.equal(doc.getElementById('b').hasAttribute('aria-label'), false);
  assert.equal(doc.getElementById('c').hasAttribute('aria-label'), false);
});

test('textarea placeholder is covered', () => {
  const doc = run('<textarea id="a" placeholder="Notes"></textarea>');
  assert.equal(doc.getElementById('a').getAttribute('aria-label'), 'Notes');
});
