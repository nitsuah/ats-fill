---
name: github-issue-to-pr
description: Turns GitHub issues into workable PRs — classifies, implements, reviews, monitors CI, and merges while keeping TASKS.md/CHANGELOG/FEATURES in sync.
argument-hint: A GitHub issue number (e.g. 157) or '--scan' to find open issues without PRs
---

# github-issue-to-pr skill

An autonomous agent skill that takes GitHub issues and converts them into workable PRs with minimal human intervention. Designed for the ats-fill repo (and the nitsuah/.github shared infra), it implements the full issue→branch→PR→CI→merge loop while keeping tracking docs honest.

## Why this exists

Nightly journeys file `bot:journey` issues. Community members file bugs and features. Each needs to become a branch, a PR, a green CI run, and an updated TASKS.md/CHANGELOG/FEATURES — all without constant manual attention. Free-tier rate limits mean reviews need to be batched and efficient.

## Trigger

- Manual: `/github-issue-to-pr <issue-number>` or `npx -y github:nitsuah/ats-fill github-issue-to-pr <issue-number>`
- Scan: `/github-issue-to-pr --scan` — finds open issues without linked PRs
- Auto: `.github/workflows/github-issue-to-pr.yml` dispatches on new issues (see Install)

## Design decisions

- **Branch naming**: `fix/<issue-number>-<slugified-title>` from main
- **Auto-merge**: chore/docs only; code changes wait for human approval
- **TASKS.md**: auto-tick existing items with `Done YYYY-MM-DD: <what>`; new items go under Todo as `- [ ] TASK: <brief> (Issue #NN) — P1/P2/P3/P4`
- **Tracking docs checked pre-merge**: `git diff origin/main...HEAD --stat` must include docs whenever a tracked item completes

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | This file — skill definition and usage |
| `index.js` | Entry point: parses args, dispatches to modules |
| `classifier.js` | Classifies issue type (bug/feature/chore/docs) |
| `planner.js` | Branch naming, PR template fill, acceptance criteria |
| `implementer.js` | Code scaffolding based on issue type |
| `reviewer.js` | PR review comment handling and auto-fix |
| `merger.js` | CI monitoring, auto-merge decisions, branch cleanup |
| `utils/github.js` | GitHub API wrappers (issues, PRs, repos) |
| `utils/git.js` | Git operations (branch, commit, push, diff) |
| `utils/docs.js` | TASKS.md/CHANGELOG.md/FEATURES.md utilities |

## Install

```bash
# Copy into a project's skills folder:
cp -r skills/github-issue-to-pr ~/.claude/skills/
# Or install from git:
npx skills add "https://github.com/nitsuah/ats-fill#main" --skill github-issue-to-pr -a claude-code -y
```

The GitHub Action trigger (`.github/workflows/github-issue-to-pr.yml`) ships separately in `.github/`.

## Example session

```
/github-issue-to-pr 157
# → creates branch fix/157-fix-greenhouse-iframe-detection
# → implements the iframe-aware DETECT_ATS fix
# → opens PR "fix: detected ATS application form embedded in iframe"
# → lints, tests, waits for CI
# → CI green: PR is ready for human review (code change, no auto-merge)
/github-issue-to-pr 142
# → chore: updates CI config, auto-merges on green
```

## Constraints

- Never commits/pushes to main directly — always feature branch + PR
- Never force-pushes over a shared branch
- Never merges without CI green (or explicit human override)
- Stays within GitHub API rate limits (cached results, batched calls)
- Respects existing `.github/pull_request_template.md`

## Next steps

1. Create `.github/workflows/github-issue-to-pr.yml` for auto-triggering on new issues
2. Copy `skills/github-issue-to-pr/` into your project's skills folder
3. Run `/github-issue-to-pr <issue-number>` on a test issue
4. Verify PR opens, CI runs, docs update