#!/usr/bin/env bash
set -euo pipefail

# Publishes the CI-captured screenshot gallery as a single, rolling PR.
#
# Every refresh goes to ONE fixed branch rebuilt from current main, so a new
# refresh updates the open PR instead of stacking another one next to it.
# (The old per-commit branch naming left a new PR open for every UI-changing
# push to main.)

branch="automation/ui-screenshot-gallery"
legacy_prefix="automation/ui-screenshot-gallery-"

if [ "${GITHUB_EVENT_NAME:-}" != "push" ] || [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "Gallery publication only runs for main push events."
  exit 0
fi

# Loop guard: merging a refresh PR pushes to main again; never republish from it.
commit_message="${GITHUB_EVENT_HEAD_COMMIT_MESSAGE:-}"
case "$commit_message" in
  "docs: refresh UI screenshots"*)
    echo "Screenshot gallery commit detected; skipping publication to prevent a loop."
    exit 0
    ;;
esac

git fetch origin main
current_main="$(git rev-parse origin/main)"
if [ "$current_main" != "$GITHUB_SHA" ]; then
  echo "Main moved from $GITHUB_SHA to $current_main; skipping this gallery publication."
  exit 0
fi

# Only PRs whose head branch lives in THIS repository and that target main are
# ours. A fork can open a PR from a same-named branch; never treat it as the
# gallery PR, update it, or close it.
own_prs_jq='.[] | select((.isCrossRepository | not) and .baseRefName == "main")'

# Close refresh PRs left over from the old per-commit branch naming. Called only
# after the rolling PR is confirmed to exist or main already has the gallery, so
# a failed publish never strands the only open gallery PR.
close_legacy_prs() {
  local reason="$1"
  gh pr list --repo "$GH_REPO" --state open --limit 200 \
    --json number,headRefName,isCrossRepository,baseRefName \
    --jq "$own_prs_jq | select(.headRefName | startswith(\"$legacy_prefix\")) | \"\(.number) \(.headRefName)\"" |
    while read -r number head; do
      [ -n "$number" ] || continue
      echo "Closing superseded screenshot PR #$number ($head)."
      gh pr close "$number" --repo "$GH_REPO" --delete-branch --comment "$reason" || true
    done
}

open_pr="$(gh pr list --repo "$GH_REPO" --state open --limit 200 \
  --json number,headRefName,isCrossRepository,baseRefName \
  --jq "[$own_prs_jq | select(.headRefName == \"$branch\")][0].number // empty")"

node scripts/update-screenshot-metadata.mjs

if git diff --quiet -- screenshots README.md; then
  echo "UI gallery is already current."
  if [ -n "$open_pr" ]; then
    echo "Closing #$open_pr: main already matches the captured gallery."
    gh pr close "$open_pr" --repo "$GH_REPO" --delete-branch \
      --comment "main already matches the latest captured gallery ($GITHUB_SHA)." || true
  fi
  close_legacy_prs "main already matches the latest captured gallery ($GITHUB_SHA)."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

# Rebuild the rolling branch from current main. It only ever holds a single
# bot commit, so replacing it (force push) is safe and keeps the PR diff exact.
git switch -C "$branch"
git add screenshots/ README.md
git commit -m "docs: refresh UI screenshots"
git push --force origin "$branch"

if [ -n "$open_pr" ]; then
  echo "Updated existing screenshot gallery PR #$open_pr."
  close_legacy_prs "Superseded by the rolling \`$branch\` PR (#$open_pr)."
  exit 0
fi

if ! new_pr_url="$(gh pr create \
  --repo "$GH_REPO" \
  --base main \
  --head "$branch" \
  --title "docs: refresh UI screenshots" \
  --body "Automated UI screenshot gallery refresh, regenerated from each UI-changing main commit (latest: '$GITHUB_SHA').

This is a single rolling PR. Later refreshes update this branch instead of opening new PRs. It is published by the CI workflow after the blocking CI gates and screenshot validation pass, and the gallery is captured with the deterministic Playwright fixture.")"; then
  # e.g. the repo setting that lets GITHUB_TOKEN create PRs is off. The gallery
  # is already pushed; leave any legacy PR open and surface the manual step
  # instead of failing main CI.
  echo "::warning::Pushed $branch but could not create its PR. Open it manually: https://github.com/$GH_REPO/compare/main...$branch"
  exit 0
fi

echo "Screenshot gallery PR created: $new_pr_url"
close_legacy_prs "Superseded by the rolling \`$branch\` PR ($new_pr_url)."
