#!/usr/bin/env bash
set -euo pipefail

if [ "${GITHUB_EVENT_NAME:-}" != "push" ] || [ "${GITHUB_REF:-}" != "refs/heads/main" ]; then
  echo "Gallery publication only runs for main push events."
  exit 0
fi

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

node scripts/update-screenshot-metadata.mjs

if git diff --quiet -- screenshots README.md; then
  echo "UI gallery is already current."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

expected_sha="$(git rev-parse HEAD)"
branch="automation/ui-screenshot-gallery-${expected_sha:0:12}"

git switch -c "$branch"
git add screenshots/ README.md
git commit -m "docs: refresh UI screenshots"
git push --set-upstream origin "$branch"

gh pr create \
  --repo "$GH_REPO" \
  --base main \
  --head "$branch" \
  --title "docs: refresh UI screenshots" \
  --body "Automated UI screenshot gallery refresh generated from main commit '$expected_sha'.

This PR is published by the existing CI workflow after the blocking CI gates and screenshot validation pass. The gallery was captured with the deterministic Playwright fixture."

echo "Screenshot gallery PR created for $branch."
