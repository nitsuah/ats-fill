#!/usr/bin/env node
/**
 * ats-fill — scripts/tracker/inbox-sync.mjs
 * Zero-model daily inbox sync. Replaces the model-driven
 * `ats-fill-daily-inbox-sync` scheduled task: searches Gmail through the REST
 * API (gmail.readonly only), writes ~/.ats-fill/inbox-latest.json, runs
 * `cli sync-email --apply` then `cli summary`, and prints at most 8 lines.
 *
 * Credentials come from env GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET /
 * GMAIL_REFRESH_TOKEN, or ~/.ats-fill/gmail-oauth.json with the keys clientId,
 * clientSecret, refreshToken. Exit 2 when absent. See README-automation.md.
 * Credentials are never stored in the repo or printed.
 */
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'cli.mjs');
const DIR = join(homedir(), '.ats-fill');
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MAX_LINES = 8;

export class MissingCredentials extends Error {}

export function loadCredentials(env = process.env, file = join(DIR, 'gmail-oauth.json')) {
  let stored = {};
  try { stored = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no file */ }
  const creds = {
    clientId: env.GMAIL_CLIENT_ID || stored.clientId,
    clientSecret: env.GMAIL_CLIENT_SECRET || stored.clientSecret,
    refreshToken: env.GMAIL_REFRESH_TOKEN || stored.refreshToken,
  };
  const missing = Object.entries(creds).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new MissingCredentials(`Gmail credentials missing (${missing.join(', ')}). Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN, or create ${file}. See scripts/tracker/README-automation.md.`);
  }
  return creds;
}

async function getJson(fetchImpl, url, init, what) {
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    let reason = '';
    try {
      const body = await res.json();
      reason = body.error_description || body.error?.message || (typeof body.error === 'string' ? body.error : '');
    } catch { /* no body */ }
    throw new Error(`${what} failed (${res.status})${reason ? `: ${reason}` : ''}`);
  }
  return res.json();
}

export async function accessToken(creds, fetchImpl = fetch) {
  const body = new URLSearchParams({
    client_id: creds.clientId, client_secret: creds.clientSecret, refresh_token: creds.refreshToken, grant_type: 'refresh_token',
  });
  const json = await getJson(fetchImpl, 'https://oauth2.googleapis.com/token',
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, 'Google token refresh');
  if (!json.access_token) throw new Error('Google token refresh returned no access token');
  return json.access_token;
}

const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || '';

export async function fetchMessages(query, token, fetchImpl = fetch) {
  const auth = { headers: { authorization: `Bearer ${token}` } };
  const ids = [];
  let pageToken;
  do {
    const params = new URLSearchParams({ q: query, maxResults: '50' });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await getJson(fetchImpl, `${GMAIL}?${params}`, auth, 'Gmail search');
    ids.push(...(page.messages || []).map((m) => m.id));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const emails = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map((id) => {
      const params = new URLSearchParams({ format: 'metadata' });
      for (const h of ['From', 'Subject', 'Date']) params.append('metadataHeaders', h);
      return getJson(fetchImpl, `${GMAIL}/${encodeURIComponent(id)}?${params}`, auth, 'Gmail message fetch');
    }));
    for (const msg of batch) {
      emails.push({ id: msg.id, date: header(msg, 'date'), sender: header(msg, 'from'), subject: header(msg, 'subject'), snippet: msg.snippet || '' });
    }
  }
  return emails;
}

/** Pure: condense `sync-email` and `summary` output to at most 8 lines. */
export function formatResult(syncText, summaryText) {
  const sync = syncText.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const summary = summaryText.split('\n').filter((l) => /^(interviewing|no reply)/.test(l));
  const needsAction = /^interviewing/m.test(summaryText) || /\boffer [1-9]/.test(summaryText)
    || sync.some((l) => /→ (interview|offer)$/.test(l) || /: (interview|offer)$/.test(l));
  const action = needsAction ? ['ACTION: open that thread (interview or offer in your tracker)'] : [];
  const countLine = sync.find((l) => /new emails ·/.test(l));
  const room = Math.max(0, MAX_LINES - summary.length - action.length - (countLine ? 1 : 0));
  const changes = sync.filter((l) => l !== countLine && !/^(tip:|re-run with)/.test(l)).slice(0, room);
  return [...changes, ...(countLine ? [countLine] : []), ...summary, ...action].slice(0, MAX_LINES).join('\n');
}

function runCli(args) {
  return execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export async function main({ fetchImpl = fetch, run = runCli, env = process.env, dir = DIR, out = console.log } = {}) {
  const creds = loadCredentials(env, join(dir, 'gmail-oauth.json'));
  const query = run(['gmail-query']).split('\n').find((l) => l.trim()).trim();
  const token = await accessToken(creds, fetchImpl);
  const emails = await fetchMessages(query, token, fetchImpl);
  const file = join(dir, 'inbox-latest.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(emails, null, 2));
  const sync = run(['sync-email', file, '--apply']);
  const summary = run(['summary']);
  out(formatResult(sync, summary));
}

const isDirectRun = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) {
  main().catch((err) => {
    console.error(`inbox-sync: ${String(err.stderr || err.message).trim().split('\n')[0]}`);
    process.exitCode = err instanceof MissingCredentials ? 2 : 1;
  });
}
