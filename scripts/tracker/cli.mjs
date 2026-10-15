#!/usr/bin/env node
/**
 * ats-fill — scripts/tracker/cli.mjs
 * Manage the ats-fill tracker from a terminal or a scheduled routine.
 * Output is deliberately terse so an agent can run it on a schedule for a few
 * hundred tokens. See skills/ats-fill-job-search/references/automation.md.
 *
 * Reads come straight from the extension's storage on disk (no Chrome setup).
 * Writes go through ats-fill's native messaging bridge once the helper is set
 * up (`setup`, once) and Settings → "AI assistant access" is on; otherwise
 * they become a CSV for the popup's Tracker → Import CSV.
 *
 *   node scripts/tracker/cli.mjs summary            counts, stale apps, next actions
 *   node scripts/tracker/cli.mjs list [--status s] [--json]
 *   node scripts/tracker/cli.mjs add --company C --title T [--url U] [--status s] [--source s]
 *   node scripts/tracker/cli.mjs set <id-prefix|company> <status>
 *   node scripts/tracker/cli.mjs sync-email <emails.json> [--apply] [--no-add] [--csv out.csv]
 *   node scripts/tracker/cli.mjs triage <emails.json>   classify only
 *   node scripts/tracker/cli.mjs export [--out file.json]
 *   node scripts/tracker/cli.mjs gmail-query            Gmail search for mail since the last sync
 *   node scripts/tracker/cli.mjs setup                  install the bridge helper (once), show status
 *   node scripts/tracker/cli.mjs uninstall-helper
 *
 * Flags: --csv out.csv (write a CSV even when the bridge is on), --wait <s>
 * (how long to wait for the bridge, default 90), --live (opt in to Chrome
 * remote debugging instead; never used unless asked).
 */
import process from 'node:process';
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { withExtensionPage, sendMessage, readApplications, resolveBrowserWsUrl } from './cdp.mjs';
import { readExtensionStorage } from './leveldb.mjs';
import { classifyEmail, flattenEmails, planTrackerChanges, findApplication } from './email-triage.mjs';
import { installHost, uninstallHost, bridgeStatus, enqueue, waitForResults } from './bridge.mjs';

const STATUSES = ['drafted', 'filled', 'pending', 'submitted', 'interview', 'offer', 'rejected', 'retired'];
const STATE_FILE = process.env.ATS_FILL_STATE || join(homedir(), '.ats-fill', 'email-sync.json');

// Per-user defaults so routines don't need env vars, e.g.
// ~/.ats-fill/config.json → {"extensionId": "<unpacked build id>", "profile": "Profile 1"}.
// Environment variables still win.
const CONFIG_KEYS = { extensionId: 'ATS_FILL_EXTENSION_ID', profile: 'ATS_FILL_PROFILE', storageDir: 'ATS_FILL_STORAGE_DIR', staleDays: 'ATS_FILL_STALE_DAYS' };
try {
  const config = JSON.parse(readFileSync(process.env.ATS_FILL_CONFIG || join(homedir(), '.ats-fill', 'config.json'), 'utf8'));
  for (const [key, envName] of Object.entries(CONFIG_KEYS)) {
    if (config[key] !== undefined && process.env[envName] === undefined) process.env[envName] = String(config[key]);
  }
} catch { /* no config file: defaults apply */ }
const STALE_DAYS = Number(process.env.ATS_FILL_STALE_DAYS || 14);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) flags[key] = true;
    else { flags[key] = next; i += 1; }
  }
  return { positional, flags };
}

function daysSince(iso, now = Date.now()) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
}

function row(app) {
  return `${String(app.id).slice(0, 8)}  ${app.status.padEnd(9)} ${app.date || '          '}  ${app.company} — ${app.title || '(no title)'}`;
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { processed: [], lastRun: null }; }
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  // Keep the newest 2000 ids: plenty for de-duplication, bounded file size.
  state.processed = state.processed.slice(-2000);
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function readEmails(file) {
  if (!file) throw new Error('Pass the path to a JSON file of emails (Gmail search_threads output works as-is).');
  const text = file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  return flattenEmails(text);
}

/**
 * Gmail search for job mail since the last sync (one day of overlap; the
 * processed-id list absorbs repeats). First run looks back 30 days.
 */
export function gmailQuery(lastRun, now = Date.now()) {
  const since = Date.parse(lastRun || '') || now - 30 * 86400000;
  const d = new Date(since - 86400000);
  const after = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
  return `after:${after} -category:promotions -category:social (subject:(applying OR application OR applied OR interview OR offer OR "next steps" OR candidacy OR "status update") OR "your application" OR "thank you for your interest")`;
}

export function summarize(apps, now = Date.now()) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const app of apps) counts[app.status] = (counts[app.status] || 0) + 1;
  const stale = apps.filter((a) => a.status === 'submitted' && (daysSince(a.date, now) ?? 0) >= STALE_DAYS);
  const interviewing = apps.filter((a) => a.status === 'interview');
  const unscored = apps.filter((a) => ['drafted', 'filled'].includes(a.status) && !a.verdict);
  const responded = apps.filter((a) => ['interview', 'offer', 'rejected'].includes(a.status)).length;
  const sent = apps.filter((a) => a.status !== 'drafted' && a.status !== 'filled').length;

  const lines = [
    `tracker: ${apps.length} total · ${Object.entries(counts).filter(([, n]) => n).map(([s, n]) => `${s} ${n}`).join(' · ')}`,
    `response rate: ${sent ? Math.round((responded / sent) * 100) : 0}% (${responded}/${sent})`,
  ];
  if (interviewing.length) lines.push(`interviewing (${interviewing.length}): ${interviewing.map((a) => a.company).join(', ')}`);
  if (stale.length) lines.push(`no reply ≥${STALE_DAYS}d (${stale.length}) — follow up or retire: ${stale.slice(0, 8).map((a) => `${a.company} (${daysSince(a.date, now)}d)`).join(', ')}${stale.length > 8 ? ', …' : ''}`);
  if (unscored.length) lines.push(`drafts without a verdict (${unscored.length}): ${unscored.slice(0, 5).map((a) => a.company).join(', ')}`);
  return lines.join('\n');
}

const CSV_COLUMNS = ['company', 'title', 'url', 'status', 'date', 'location', 'remote', 'salary range', 'employment type', 'source', 'scorecard', 'verdict'];

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render tracker changes as a CSV for the popup's Tracker → Import CSV, which
 * de-duplicates on URL and only moves status forward. Updates carry every
 * existing field: a blank location or type column would otherwise reset them.
 * Apps without a URL can't be matched by the importer, so they come back as
 * `manual` instead of turning into duplicates.
 */
export function changesToCsv(ops) {
  const lines = [CSV_COLUMNS.join(',')];
  const manual = [];
  for (const op of ops) {
    const base = op.kind === 'update' ? op.app : op.fields;
    if (!base.url) { manual.push(op); continue; }
    const cells = {
      company: base.company, title: base.title, url: base.url, status: op.kind === 'update' ? op.to : base.status,
      date: base.date, location: base.location || 'Unknown', remote: base.remote ? 'yes' : 'no',
      'salary range': base.salary_range, 'employment type': base.employment_type || 'Full-time',
      source: base.source, scorecard: base.scorecard, verdict: base.verdict,
    };
    lines.push(CSV_COLUMNS.map((c) => csvCell(cells[c])).join(','));
  }
  return { csv: lines.join('\n') + '\n', rows: lines.length - 1, manual };
}

/** Apply tracker changes as a CSV for the popup's Tracker → Import CSV. */
function csvWriter(flags) {
  return async (ops) => {
    const { csv, rows, manual } = changesToCsv(ops);
    const out = flags.csv || join(dirname(STATE_FILE), `import-${new Date().toISOString().slice(0, 10)}.csv`);
    if (rows) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, csv);
      console.log(`wrote ${rows} row(s) to ${out} — import it in ats-fill: Tracker → Import CSV`);
      console.log('tip: run "setup" once and turn on Settings → "AI assistant access" in ats-fill to apply changes directly');
    }
    for (const op of manual) {
      const item = op.kind === 'update' ? op.app : op.fields;
      const next = op.kind === 'update' ? ` → ${op.to}` : '';
      console.log(`edit by hand (no URL to match on): ${item.company}${next}`);
    }
    if (manual.length) console.log('tip: with AI assistant access on, these apply directly too');
    return { written: 0, queued: rows };
  };
}

function toMessage(op) {
  return op.kind === 'update'
    ? { type: 'UPDATE_APPLICATION', payload: { id: op.app.id, patch: { status: op.to } } }
    : { type: 'LOG_APPLICATION', payload: { url: '', ...op.fields } };
}

/** Apply tracker changes through ats-fill's native messaging bridge. */
function bridgeWriter(flags) {
  return async (ops) => {
    const ids = ops.map((op) => {
      const { type, payload } = toMessage(op);
      return enqueue(type, payload);
    });
    const { done, pending } = await waitForResults(ids, { timeoutMs: Number(flags.wait || 90) * 1000 });
    const failed = done.filter((r) => !r.ok);
    for (const r of failed) console.log(`ats-fill refused a change: ${r.error}`);
    const queuedNote = pending.length ? `; ${pending.length} queued, applied at its next check-in (about a minute)` : '';
    console.log(`applied ${done.length - failed.length} change(s) in ats-fill${queuedNote}`);
    return { written: done.length - failed.length, queued: pending.length };
  };
}

/**
 * Run `fn` with the tracker. Reads come from disk; writes go through the
 * native messaging bridge when ats-fill has checked in recently, else become
 * an import CSV. --live opts in to Chrome remote debugging instead.
 * `fn` receives {mode, apps, write}.
 */
async function withTracker(flags, fn) {
  if (flags.live || process.env.ATS_FILL_CDP_URL) {
    resolveBrowserWsUrl();
    return withExtensionPage(async ({ evaluate }) => fn({
      mode: 'live',
      apps: await readApplications(evaluate),
      write: async (ops) => {
        for (const op of ops) {
          const { type, payload } = toMessage(op);
          await sendMessage(evaluate, type, payload);
        }
        return { written: ops.length, queued: 0 };
      },
    }));
  }

  const { dir, data } = readExtensionStorage();
  if (!Array.isArray(data.applications)) {
    // The Web Store build and an unpacked dev build each get their own store.
    console.error(`note: no tracker data in ${dir}. If you track jobs in an unpacked build, set ATS_FILL_EXTENSION_ID to its ID (chrome://extensions).`);
  }
  const bridge = !flags.csv && bridgeStatus().connected;
  return fn({
    mode: bridge ? 'bridge' : 'disk',
    apps: Array.isArray(data.applications) ? data.applications : [],
    write: bridge ? bridgeWriter(flags) : csvWriter(flags),
  });
}

async function main() {
  const [command = 'summary', ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);

  // The only commands that touch Chrome's helper registration, and only when asked.
  if (command === 'setup') {
    const { changed, manifestPath, registered } = installHost();
    console.log(changed ? `installed the ats-fill helper (${manifestPath})` : `the ats-fill helper is already installed (${manifestPath})`);
    if (!registered) {
      console.log('warning: couldn\'t confirm Chrome can see the helper. If ats-fill says "native messaging host not found", run setup once from a normal terminal.');
    }
    const status = bridgeStatus();
    console.log(status.connected
      ? `ats-fill is connected (last check-in ${status.lastSeen}); tracker changes apply directly.`
      : 'next: in ats-fill open Settings → "AI assistant access" and turn it on. It connects within a minute.');
    return;
  }

  if (command === 'uninstall-helper') {
    uninstallHost();
    console.log('removed the ats-fill helper. Also turn off Settings → "AI assistant access" in ats-fill.');
    return;
  }

  if (command === 'gmail-query') {
    console.log(gmailQuery(loadState().lastRun));
    return;
  }

  if (command === 'triage') {
    for (const mail of readEmails(positional[0]).map(classifyEmail)) {
      if (mail.event !== 'noise' || flags.all) console.log(`${mail.date}  ${mail.event.padEnd(9)} ${mail.company || '?'}${mail.role ? ' — ' + mail.role : ''}`);
    }
    return;
  }

  await withTracker(flags, async ({ mode, apps, write }) => {
    switch (command) {
      case 'summary':
        console.log(summarize(apps));
        break;

      case 'list': {
        const filtered = flags.status ? apps.filter((a) => a.status === flags.status) : apps;
        if (flags.json) console.log(JSON.stringify(filtered, null, 2));
        else console.log(filtered.map(row).join('\n') || '(empty)');
        break;
      }

      case 'export': {
        const out = flags.out || `ats-fill-tracker-${new Date().toISOString().slice(0, 10)}.json`;
        writeFileSync(out, JSON.stringify(apps, null, 2));
        console.log(`exported ${apps.length} applications to ${out}`);
        break;
      }

      case 'add': {
        if (!flags.company) throw new Error('--company is required');
        await write([{ kind: 'add', fields: {
          company: flags.company, title: flags.title || '', url: flags.url || '',
          status: flags.status || 'drafted', source: flags.source || '', date: flags.date || '',
        } }]);
        if (mode === 'live') console.log(`added ${flags.company} — ${flags.title || '(no title)'}`);
        break;
      }

      case 'set': {
        const [needle, status] = positional;
        if (!needle || !STATUSES.includes(status)) throw new Error(`usage: set <id-prefix|company> <${STATUSES.join('|')}>`);
        const byId = apps.filter((a) => String(a.id).startsWith(needle));
        const target = byId.length === 1 ? byId[0] : findApplication(apps, { company: needle, role: flags.title || '' });
        if (!target) throw new Error(`No tracked application matches "${needle}".`);
        await write([{ kind: 'update', app: target, to: status }]);
        if (mode === 'live') console.log(`updated ${row({ ...target, status })}`);
        break;
      }

      case 'sync-email': {
        const state = loadState();
        const seen = new Set(state.processed);
        const emails = readEmails(positional[0]).filter((m) => !seen.has(String(m.id)));
        const plan = planTrackerChanges(apps, emails.map(classifyEmail), { addMissing: !flags['no-add'] });
        const verb = flags.apply ? '' : '(dry run) ';

        for (const u of plan.updates) console.log(`${verb}update ${u.company} — ${u.title || '?'}: ${u.from} → ${u.to}`);
        for (const a of plan.adds) console.log(`${verb}add    ${a.company} — ${a.title || '?'}: ${a.status}`);
        const ignored = plan.skipped.filter((s) => s.reason !== 'noise').length;
        console.log(`${emails.length} new emails · ${plan.updates.length} updates · ${plan.adds.length} adds · ${ignored} already current · ${plan.skipped.length - ignored} noise`);

        const pending = plan.updates.length + plan.adds.length;
        if (!flags.apply) {
          if (pending) console.log('re-run with --apply to write these to the tracker');
          break;
        }
        const byId = new Map(apps.map((a) => [a.id, a]));
        const ops = [
          ...plan.updates.map((u) => ({ kind: 'update', app: byId.get(u.id), to: u.to })),
          ...plan.adds.map(({ email: _email, ...fields }) => ({ kind: 'add', fields })),
        ];
        await write(ops);
        // Live and bridge writes are final (queued ones apply at the next
        // check-in), so these emails never need another look. A CSV
        // isn't final until it's imported, so keep the Gmail window open; the
        // next run re-plans against the tracker, and imported rows match.
        if (mode !== 'disk' || !pending) {
          saveState({ processed: [...state.processed, ...emails.map((m) => String(m.id))], lastRun: new Date().toISOString() });
        } else {
          console.log('Gmail window stays open until a run finds nothing left to import');
        }
        break;
      }

      default:
        throw new Error(`Unknown command "${command}". Try: summary, list, add, set, sync-email, triage, export, gmail-query.`);
    }
  });
}

// Compare real paths: an npm/npx bin link has a different name than this file.
const isDirectRun = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isDirectRun) {
  main().catch((err) => {
    console.error(`ats-fill tracker: ${err.message}`);
    process.exitCode = 1;
  });
}
