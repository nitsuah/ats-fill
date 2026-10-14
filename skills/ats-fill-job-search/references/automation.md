# Automating the tracker (CLI, inbox sync, routines)

ats-fill has no server and no MCP of its own. Its tracker lives in the extension's `chrome.storage.local`, which Chrome keeps as a LevelDB folder on disk:

```
<Chrome User Data>/<Profile>/Local Extension Settings/<extension id>/
```

The Web Store build's ID is `amofaeopfmaicbiijgjaojenedkkadmn`. An unpacked dev build has its own ID (shown on `chrome://extensions`) **and its own, separate store**, so point the CLI at whichever build the candidate actually tracks jobs in.

## The CLI

From an ats-fill checkout (Node 22+, no install step):

| Command | Does |
| --- | --- |
| `node scripts/tracker/cli.mjs summary` | Counts by stage, response rate, apps with no reply after 14+ days, drafts without a verdict. About 5 lines. |
| `… list [--status interview] [--json]` | One line per application. |
| `… set <company or id prefix> <status>` | Move one application (drafted, filled, submitted, interview, offer, rejected, retired). |
| `… add --company C --title T [--url U] [--status s]` | Track a new application. |
| `… gmail-query` | The Gmail search covering everything since the last sync. |
| `… triage <emails.json>` | Classify emails only (applied, interview, rejected, offer, noise). |
| `… sync-email <emails.json> [--apply]` | Plan tracker changes from emails; `--apply` writes them. Status only ever moves forward, and processed emails are remembered in `~/.ats-fill/email-sync.json`. |
| `… export [--out file.json]` | Back up the tracker. |

**Reads** come straight from disk, so Chrome needs no setup and can stay closed. **Writes** go through the running extension when Chrome remote debugging is on (`chrome://inspect/#remote-debugging`). With it off, they become a CSV (`~/.ats-fill/import-<date>.csv`) for the popup's **Tracker → Import CSV**, which matches on URL and only moves status forward. `--disk` and `--live` force one path. Save per-machine defaults in `~/.ats-fill/config.json`, e.g. `{"extensionId": "<unpacked build id>", "profile": "Profile 1", "staleDays": 14}`. The environment variables `ATS_FILL_EXTENSION_ID`, `ATS_FILL_PROFILE` and `ATS_FILL_STALE_DAYS` override it.

## Inbox → tracker loop

Classification is deterministic code, not the model, so a sync costs roughly the size of the email snippets:

1. `node scripts/tracker/cli.mjs gmail-query` → copy the query.
2. Search Gmail with it (Gmail connector `search_threads`, default minimal view, `pageSize` 50). Save the result as-is to a JSON file; `{id, date, sender, subject, snippet}` per message is enough.
3. `node scripts/tracker/cli.mjs sync-email <file> --apply` and report its last lines.

Read individual threads in full only when the output flags something to act on (an interview request needing a reply, an offer). Don't send, label or archive mail unless the candidate asks.

Known limits: a company that mails from an abbreviated domain (`optimags.com` for "Optima Global Solutions") may be tracked twice, so tell the candidate to merge it. Truncated snippets sometimes drop the role title.

## Routines

Pick the cheapest tool that does the job:

| Cadence | What | Cost |
| --- | --- | --- |
| Daily, early morning | Inbox → tracker loop above, then `summary`. Mention only changes, new interviews and offers. | ~2–5k tokens |
| Weekly (e.g. Monday) | `summary`; for each stale app, suggest one follow-up or retire; for drafts without a verdict, ask for a verdict; compare the response rate with last week. | ~3k tokens |
| On demand | Any CLI command directly; no agent needed. | 0 |
| Before an interview | `list --status interview`, then the prep sheet in [interviews.md](interviews.md). | varies |

Run daily and weekly routines as **local** scheduled tasks (the Claude desktop app's scheduled tasks, or a plain OS scheduler calling a script). They need this machine's Chrome profile, which cloud routines can't reach. A pure-script routine (no model at all) can run `summary` on a schedule and only wake an agent when the output changes.
