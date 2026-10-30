import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCredentials, MissingCredentials, fetchMessages, formatResult, main } from '../scripts/tracker/inbox-sync.mjs';

const ENV = { GMAIL_CLIENT_ID: 'cid', GMAIL_CLIENT_SECRET: 'csecret', GMAIL_REFRESH_TOKEN: 'rtoken' };
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const meta = (id) => ({
  id, snippet: `snippet ${id}`,
  payload: { headers: [{ name: 'From', value: `Jobs <jobs@${id}.com>` }, { name: 'Subject', value: `Re: ${id}` }, { name: 'Date', value: 'Mon, 26 Oct 2026 10:00:00 +0000' }] },
});

function stubFetch() {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (u.startsWith('https://oauth2.googleapis.com/token')) return ok({ access_token: 'at' });
    const parsed = new URL(u);
    if (parsed.pathname.endsWith('/messages')) {
      return parsed.searchParams.get('pageToken') === 'p2' ? ok({ messages: [{ id: 'm3' }] }) : ok({ messages: [{ id: 'm1' }, { id: 'm2' }], nextPageToken: 'p2' });
    }
    return ok(meta(parsed.pathname.split('/').pop()));
  };
  fn.calls = calls;
  return fn;
}

test('missing credentials throw MissingCredentials naming the gaps', () => {
  assert.throws(() => loadCredentials({}, join(tmpdir(), 'no-such-gmail-oauth.json')), (e) => e instanceof MissingCredentials && /clientId, clientSecret, refreshToken/.test(e.message));
  assert.equal(loadCredentials(ENV).refreshToken, 'rtoken');
});

test('fetchMessages paginates and maps metadata verbatim', async () => {
  const f = stubFetch();
  const emails = await fetchMessages('after:2026/10/01', 'at', f);
  assert.deepEqual(emails.map((e) => e.id), ['m1', 'm2', 'm3']);
  assert.deepEqual(emails[0], { id: 'm1', date: 'Mon, 26 Oct 2026 10:00:00 +0000', sender: 'Jobs <jobs@m1.com>', subject: 'Re: m1', snippet: 'snippet m1' });
  const list = f.calls.filter((c) => new URL(c.url).pathname.endsWith('/messages'));
  assert.equal(list.length, 2);
  assert.equal(new URL(list[0].url).searchParams.get('maxResults'), '50');
  assert.equal(new URL(list[0].url).searchParams.get('q'), 'after:2026/10/01');
  assert.equal(list[0].init.headers.authorization, 'Bearer at');
  assert.ok(f.calls.every((c) => !/gmail\.(modify|send|compose)/.test(c.url)));
});

test('main writes inbox-latest.json, runs the CLI, and caps output at 8 lines with ACTION', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'inbox-'));
  const cli = [];
  const out = [];
  await main({
    fetchImpl: stubFetch(), env: ENV, dir, out: (t) => out.push(t),
    run: (args) => {
      cli.push(args[0]);
      if (args[0] === 'gmail-query') return 'after:2026/10/01 subject:(applied)\n';
      if (args[0] === 'sync-email') {
        assert.equal(args[1], join(dir, 'inbox-latest.json'));
        assert.equal(args[2], '--apply');
        return [...Array.from({ length: 12 }, (_, i) => `update Co${i} — Eng: submitted → interview`), '3 new emails · 12 updates · 0 adds · 0 already current · 0 noise', 'applied 12 change(s) in ats-fill'].join('\n');
      }
      return 'tracker: 3 total\nresponse rate: 33% (1/3)\ninterviewing (1): Co0\nno reply ≥14d (1) — follow up or retire: Old (20d)';
    },
  });
  assert.deepEqual(cli, ['gmail-query', 'sync-email', 'summary']);
  assert.equal(JSON.parse(readFileSync(join(dir, 'inbox-latest.json'), 'utf8')).length, 3);
  const lines = out[0].split('\n');
  assert.ok(lines.length <= 8);
  assert.match(out[0], /3 new emails/);
  assert.match(lines.at(-1), /^ACTION: open that thread/);
  assert.doesNotMatch(out.join('\n'), /rtoken|csecret/);
});

test('failed token refresh surfaces the status without secrets', async () => {
  const f = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }) });
  await assert.rejects(main({ fetchImpl: f, env: ENV, dir: mkdtempSync(join(tmpdir(), 'inbox-')), run: () => 'q\n', out: () => {} }), (e) => /token refresh failed \(400\)/.test(e.message) && !/rtoken/.test(e.message));
});

test('formatResult stays quiet without interview/offer', () => {
  const text = formatResult('0 new emails · 0 updates · 0 adds · 0 already current · 0 noise', 'tracker: 1 total\nresponse rate: 0% (0/1)');
  assert.doesNotMatch(text, /ACTION/);
});
