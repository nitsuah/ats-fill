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

# A rerun can encounter an automation branch that was already pushed by the
# previous attempt. Reuse it instead of failing on a non-fast-forward push.
if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then
  echo "Automation branch $branch already exists remotely."
  if [ "$(gh pr list --repo "$GH_REPO" --head "$branch" --state open --json number --jq 'length')" -gt 0 ]; then
    echo "An open screenshot gallery PR already exists for $branch; nothing to publish."
    exit 0
  fi

  # Preserve the newly generated gallery while switching to the existing
  # automation branch. That branch may already contain an older gallery commit.
  gallery_patch="$(mktemp)"
  trap 'rm -f "$gallery_patch"' EXIT
  git diff --binary -- screenshots/ README.md > "$gallery_patch"
  git restore --source=HEAD --staged --worktree -- screenshots/ README.md

  git fetch origin "$branch"
  git switch -C "$branch" "origin/$branch"

  if git diff --quiet -- screenshots/ README.md; then
    echo "Existing automation branch already contains the current gallery."
  else
    git apply "$gallery_patch"
    git add screenshots/ README.md

    if git diff --cached --quiet; then
      echo "Existing automation branch already contains the current gallery."
    else
      git commit -m "docs: refresh UI screenshots"
      git push --set-upstream origin "$branch"
    fi
  fi
else
  git switch -c "$branch"
  git add screenshots/ README.md
  git commit -m "docs: refresh UI screenshots"
  git push --set-upstream origin "$branch"
fi

gh pr create \
  --repo "$GH_REPO" \
  --base main \
  --head "$branch" \
  --title "docs: refresh UI screenshots" \
  --body "Automated UI screenshot gallery refresh generated from main commit '$expected_sha'.

This PR is published by the existing CI workflow after the blocking CI gates and screenshot validation pass. The gallery was captured with the deterministic Playwright fixture."

echo "Screenshot gallery PR created for $branch."
