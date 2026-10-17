/**
 * github-issue-to-pr — GitHub API wrappers.
 *
 * Thin wrappers around the GitHub MCP tools (mcp__plugin_github_github__*)
 * used by the skill. Each function returns a Promise that resolves to the
 * parsed response or throws a descriptive error. Results are cached per
 * process so a single skill run doesn't hammer the API.
 *
 * The wrappers are intentionally simple: they map one MCP call to one
 * function, so the caller can reason about rate limits and errors easily.
 */

const CACHE = new Map();

function cacheKey(method, ...args) {
  return `${method}:${args.join('|')}`;
}

/** Read from cache if present, else call fn and cache. */
async function cached(method, fn, ...args) {
  const key = cacheKey(method, ...args);
  if (CACHE.has(key)) return CACHE.get(key);
  const result = await fn(...args);
  CACHE.set(key, result);
  return result;
}

/** Fetch a single issue by number. */
export async function getIssue(issueNumber) {
  return cached('getIssue', async () => {
    const result = await mcp__plugin_github_github__issue_read({
      method: 'get',
      owner: process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah',
      repo: process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill',
      issue_number: Number(issueNumber),
    });
    return result;
  });
}

/** Fetch issue comments (for review threads). */
export async function getIssueComments(issueNumber) {
  return cached('getIssueComments', async () => {
    return mcp__plugin_github_github__issue_read({
      method: 'get_comments',
      owner: process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah',
      repo: process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill',
      issue_number: Number(issueNumber),
    });
  });
}

/** List open issues without linked PRs (used by --scan). */
export async function listOpenIssues() {
  return cached('listOpenIssues', async () => {
    const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
    const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
    const issues = [];
    let page = 1;
    while (true) {
      const batch = await mcp__plugin_github_github__list_issues({
        owner,
        repo,
        state: 'open',
        page,
        perPage: 100,
      });
      if (!batch || batch.length === 0) break;
      issues.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }
    return issues;
  });
}

/** List open pull requests. */
export async function listOpenPRs() {
  return cached('listOpenPRs', async () => {
    const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
    const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
    const prs = [];
    let page = 1;
    while (true) {
      const batch = await mcp__plugin_github_github__list_pull_requests({
        owner,
        repo,
        state: 'open',
        page,
        perPage: 100,
      });
      if (!batch || batch.length === 0) break;
      prs.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }
    return prs;
  });
}

/** Create a new pull request. Returns the created PR object. */
export async function createPR({ title, body, head, base }) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__create_pull_request({
    owner,
    repo,
    title,
    body,
    head,
    base: base || 'main',
  });
}

/** Update an existing PR (title/body/state). */
export async function updatePR(prNumber, updates) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__update_pull_request({
    owner,
    repo,
    pullNumber: prNumber,
    ...updates,
  });
}

/** Get the combined commit status of a PR's head commit. */
export async function getPRStatus(prNumber) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__pull_request_read({
    method: 'get_status',
    owner,
    repo,
    pullNumber: prNumber,
  });
}

/** Get review comments on a PR. */
export async function getPRReviewComments(prNumber) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__pull_request_read({
    method: 'get_review_comments',
    owner,
    repo,
    pullNumber: prNumber,
  });
}

/** Get PR files changed. */
export async function getPRFiles(prNumber) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__pull_request_read({
    method: 'get_files',
    owner,
    repo,
    pullNumber: prNumber,
  });
}

/** Add a comment to a PR. */
export async function addPRComment(prNumber, body) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__add_issue_comment({
    owner,
    repo,
    issue_number: prNumber,
    body,
  });
}

/** Merge a pull request. */
export async function mergePR(prNumber, { method = 'squash', commitTitle } = {}) {
  const owner = process.env.GITHUB_REPOSITORY?.split('/')[0] || 'nitsuah';
  const repo = process.env.GITHUB_REPOSITORY?.split('/')[1] || 'ats-fill';
  return mcp__plugin_github_github__merge_pull_request({
    owner,
    repo,
    pullNumber: prNumber,
    merge_method: method,
    commit_title: commitTitle,
  });
}

/** Clear the per-process cache (useful for long-running loops). */
export function clearCache() {
  CACHE.clear();
}

/** Resolve the owner/repo pair from env or defaults. */
export function targetRepo() {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY || 'nitsuah/ats-fill').split('/');
  return { owner, repo };
}