/**
 * github-issue-to-pr — Git operations.
 *
 * Wraps shell git commands via the Bash tool. All commands run from the
 * skill's working directory (the ats-fill checkout). Uses simple exec-style
 * calls so errors surface as thrown exceptions with stderr text.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function runGit(args, opts = {}) {
  return exec('git', args, {
    cwd: opts.cwd || process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  }).then(({ stdout, stderr }) => ({ stdout: stdout.trim(), stderr }));
}

/** Get current branch name. */
export async function currentBranch() {
  const { stdout } = await runGit(['branch', '--show-current']);
  return stdout;
}

/** List all branches. */
export async function listBranches() {
  const { stdout } = await runGit(['branch', '-a', '--format=%(refname:short)']);
  return stdout.split('\n').filter(Boolean);
}

/** Get the latest commit hash on the default branch. */
export async function getDefaultBranchHead(defaultBranch = 'main') {
  const { stdout } = await runGit(['rev-parse', defaultBranch]);
  return stdout;
}

/** Create a new branch from main. Fails if branch already exists locally. */
export async function createBranch(name, from = 'main') {
  // Fetch latest from remote first
  await runGit(['fetch', 'origin']);
  await runGit(['checkout', from]);
  await runGit(['pull', '--ff-only', 'origin', from]);
  await runGit(['checkout', '-b', name]);
  return name;
}

/** Stage all changes, commit, and push to origin. */
export async function commitAndPush({ message, branch }) {
  await runGit(['add', '-A']);
  const { stdout } = await runGit(['commit', '-m', message]);
  if (stdout.includes('nothing to commit')) return { committed: false, branch };
  await runGit(['push', '--set-upstream', 'origin', branch]);
  return { committed: true, branch };
}

/** Commit without push (for intermediate commits). */
export async function commitOnly({ message }) {
  await runGit(['add', '-A']);
  const { stdout } = await runGit(['commit', '-m', message]);
  return { committed: !stdout.includes('nothing to commit') };
}

/** Push current branch to origin. */
export async function pushBranch(branch) {
  await runGit(['push', '--set-upstream', 'origin', branch]);
}

/** Get git diff stat between origin/main and HEAD. */
export async function diffStat(against = 'origin/main') {
  try {
    const { stdout } = await runGit(['diff', '--stat', `${against}...HEAD`]);
    return stdout;
  } catch {
    return '';
  }
}

/** Check if a branch exists locally. */
export async function branchExists(name) {
  try {
    await runGit(['rev-parse', '--verify', name]);
    return true;
  } catch {
    return false;
  }
}

/** Delete a local branch. */
export async function deleteBranch(name, force = false) {
  await runGit(['branch', force ? '-D' : '-d', name]);
}

/** Get current working directory status (clean/dirty). */
export async function isClean() {
  const { stdout } = await runGit(['status', '--porcelain']);
  return stdout.length === 0;
}

/** Stash all changes (use sparingly). */
export async function stash() {
  await runGit(['stash']);
}

/** Apply a stash entry by index. */
export async function stashApply(index = 0) {
  await runGit(['stash', 'apply', `stash@{${index}}`]);
}

/** Get the diff between two refs. */
export async function getDiff(from, to) {
  const { stdout } = await runGit(['diff', `${from}...${to}`]);
  return stdout;
}

/** Check whether remote main exists. */
export async function remoteExists(name = 'origin') {
  try {
    await runGit(['ls-remote', '--exit-code', name]);
    return true;
  } catch {
    return false;
  }
}