// site/privacy.html presents docs/PRIVACY.md on GitHub Pages (it is the
// Chrome Web Store listing's Privacy Policy URL). PRIVACY.md stays
// authoritative; these checks fail when the page falls behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const md = readFileSync(new URL('../docs/PRIVACY.md', import.meta.url), 'utf8');
const html = readFileSync(new URL('../site/privacy.html', import.meta.url), 'utf8');

// Properly decode all HTML entities by using JSDOM
const text = new JSDOM(html).window.document.body.textContent.replace(/\s+/g, ' ');

test('privacy page matches the PRIVACY.md document version and date', () => {
  for (const label of ['Document version', 'Last updated']) {
    const m = md.match(new RegExp(`\*\*${label}:\*\* (.+)`));
    assert.ok(m, `${label} missing from docs/PRIVACY.md`);
    assert.ok(text.includes(`${label}: ${m[1].trim()}`), `site/privacy.html ${label} differs from docs/PRIVACY.md (${m[1].trim()})`);
  }
});

test('privacy page has every PRIVACY.md section heading', () => {
  const headings = [...md.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1].trim());
  assert.ok(headings.length > 5);
  for (const h of headings) assert.ok(text.includes(h), `site/privacy.html is missing section "${h}"`);
});

test('landing page footer links the privacy page', () => {
  const index = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');
  assert.match(index, /<footer[\s\S]*href="privacy\.html"[\s\S]*<\/footer>/);
});
