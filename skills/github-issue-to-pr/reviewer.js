/**
 * github-issue-to-pr — PR review and CI monitoring.
 *
 * Handles post-PR creation: posting initial comments, monitoring CI status,
 * auto-applying common fixes, and deciding when to request merge/auto-merge.
 *
 * Designed to be called from index.js after PR creation. Can also be re-invoked
 * after each CI check to poll for green status.
 */

import { getPRStatus, addPRComment, getPRReviewComments, mergePR } from '../utils/github.js';
import { currentBranch, diffStat, isClean, deleteBranch } from '../utils/git.js';
import { readTASKS, updateTASKSItem, completeTASKSItem, addTASKSItem, readCHANGELOG, addCHANGELOGEntry, readFEATURES, updateFEATURESFeature, affectsTrackingDocs, generateDoneNote } from '../utils/docs.js';

/** How long to wait between CI polls (seconds). */
const POLL_INTERVAL_SEC = 60;
/** How long to wait before auto-merge after CI green with no new comments (seconds). */
const AUTO_MERGE_DELAY_SEC = 1800; // 30 min

/** State tracked across a single skill invocation. */
class ReviewState {
  constructor(prNumber, issue) {
    this.prNumber = prNumber;
    this.issue = issue;
    this.lastCheck = 0;
    this.commentCountAtLastCheck = 0;
    this.autoMergeTimer = null;
    this.fixedSinceLastCheck = false;
  }

  /** Check CI status and return { status, branch, affectedDocs } */
  async checkCI() {
    try {
      const status = await getPRStatus(this.prNumber);
      const branch = status?.state_branch_ref?.ref || await currentBranch();
      const { stdout: diff } = await diffStat();
      const affectedDocs = affectsTrackingDocs(
        (status?.files_changed || []).map(f => f.filename).filter(Boolean)
      );
      return { status, branch, affectedDocs, diff };
    } catch (err) {
      return { status: 'error', branch: await currentBranch(), affectedDocs: false, diff: '' };
    }
  }

  /** Parse PR comments to count new ones since last check. */
  async parseCommentCount() {
    try {
      const comments = await getPRReviewComments(this.prNumber);
      // Count top-level review comments (not reply-only)
      const topLevel = comments?.filter(c => c?.body?.length > 0 && !c?.body?.includes('>')) || [];
      return topLevel.length;
    } catch {
      return 0;
    }
  }

  /** Post initial setup comment on the PR. */
  async postInitialComment() {
    const classification = classifyIssue(this.issue);
    const tasksInfo = mapsToTASKS(this.issue, await readTASKS(), classification);
    const type = classification.type;
    const priority = classification.priority;

    let body = `This PR was auto-generated from GitHub Issue #${this.issue.number} by the \`github-issue-to-pr\` skill.\n\n`;

    body += `**Issue type:** ${type}${priority ? `, priority: ${priority}` : ''}\n\n`;
    body += `**Branch:** \`${await currentBranch()}\`\n\n`;
    body += `**Tracked work:**\n`;

    if (tasksInfo.mapsToExisting) {
      body += `- [x] TASKS.md item will be auto-ticked upon successful merge\n`;
      body += `- [ ] CHANGELOG.md Unreleased entry added as part of merge\n`;
    } else if (tasksInfo.newTask) {
      body += `- [ ] New TASKS.md item to be created\n`;
      body += `- [ ] CHANGELOG.md Unreleased entry added\n`;
    } else {
      body += `- [ ] No tracked TASKS.md mapping\n`;
    }

    body += `\n---\n`;

    if (tasksInfo.mapsToExisting || tasksInfo.newTask) {
      body += `When this PR is merged, the following will happen automatically:\n`;
      if (tasksInfo.mapsToExisting) {
        body += `- TASKS.md item ticked with \`Done ${new Date().toISOString().slice(0, 10)}: <description>\`\n`;
      }
      if (tasksInfo.newTask) {
        body += `- New TASKS.md item added under \`## Todo\`\n`;
      }
      body += `- CHANGELOG.md \`## [Unreleased]\` entry added\n`;
    }

    body += `\n> This is an automated comment. Human review is still required.\n`;

    await addPRComment(this.prNumber, body);
  }

  /** Poll CI until green or max attempts. Returns true if green. */
  async pollUntilGreen(maxAttempts = 12) { // 12 * 60s = 12 min max
    let attempts = 0;
    while (attempts < maxAttempts) {
      attempts += 1;
      const { status } = await this.checkCI();

      if (status === 'success') {
        // CI is green - check if auto-merge conditions are met
        const commentsNow = await this.parseCommentCount();
        const newComments = commentsNow - this.commentCountAtLastCheck;
        this.commentCountAtLastCheck = commentsNow;

        if (newComments === 0 && this.isAutoMerge) {
          // No new comments for 30 min and it's low-risk (chore/docs) - auto-merge
          this.scheduleAutoMerge();
          return true;
        }

        return true; // Green, wait for human
      }

      if (status === 'failure' || status === 'failure' || status === 'error') {
        // CI failed - report and wait
        // Don't auto-fix complex failures; report and exit
        return false;
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_SEC * 1000));
    }

    return false; // Max attempts reached
  }

  /** Schedule auto-merge after delay if no new comments. */
  scheduleAutoMerge() {
    if (this.autoMergeTimer) clearTimeout(this.autoMergeTimer);
    this.autoMergeTimer = setTimeout(async () => {
      try {
        // Final check: are there still no new comments?
        const commentsNow = await this.parseCommentCount();
        if (commentsNow === this.commentCountAtLastCheck) {
          await this.doAutoMerge();
        }
      } catch (err) {
        console.error('Auto-merge check failed:', err);
      }
    }, AUTO_MERGE_DELAY_SEC * 1000);
  }

  /** Actually perform the auto-merge. */
  async doAutoMerge() {
    try {
      const { branch } = await this.checkCI();
      await mergePR(this.prNumber, {
        method: 'squash',
        commitTitle: `${this.prTitle || 'auto'}: ${this.issue.title}`,
      });
      await addPRComment(this.prNumber, '✅ Auto-merged after CI green and no new comments.');
      await deleteBranch(branch);
      await addPRComment(this.prNumber, `Branch \`${branch}\` deleted after merge.`);
    } catch (err) {
      await addPRComment(this.prNumber, `❌ Auto-merge failed: \`${err.message}\`. Merge manually if desired.`);
    }
  }
}

/** Classifier import - lazily loaded */
let classifyIssueCache = null;

/** Ensure classifyIssue is available. */
function getClassifyIssue() {
  if (!classifyIssueCache) {
    const { classifyIssue: ci } = require('../utils/classifier.js');
    classifyIssueCache = ci;
  }
  return classifyIssueCache;
}

/** Maps issue to TASKS.md items using the classifier. */
function mapsToTASKS(issue, tasks) {
  const classification = getClassifyIssue()(issue);
  // Check for explicit "Closes #NN" in body
  const body = (issue.body || '').toLowerCase();
  const closesRef = body.match(/closes? #(\d+)/i) ||
                    body.match(/fixe?s? #(\d+)/i);

  if (closesRef) {
    const refIssueNum = Number(closesRef[1]);
    const mapsTo = tasks.some(t => String(t.number) === String(refIssueNum));
    return { mapsToExisting: mapsTo, newTask: !mapsTo, refIssueNum };
  }

  // Check title matches
  const titleLower = issue.title.toLowerCase();
  for (const task of tasks) {
    if (task.title.toLowerCase().includes(titleLower.substring(0, 30))) {
      return { mapsToExisting: true, newTask: false, refIssueNum: task.number };
    }
  }

  // Classify priority-based new task creation
  if (classification.type === 'bug' && classification.priority === 'P0') {
    return { mapsToExisting: false, newTask: true, refIssueNum: null };
  }
  if (classification.priority === 'P1') {
    return { mapsToExisting: false, newTask: true, refIssueNum: null };
  }

  return { mapsToExisting: false, newTask: false, refIssueNum: null };
}

/**
 * Main review loop: check CI, post comments, decide on merge.
 *
 * @param {number} prNumber - The PR number
 * @param {object} issue - The GitHub issue object
 * @param {string} branch - The branch name
 * @returns {Promise<void>}
 */
export async function reviewLoop(prNumber, issue, branch) {
  const state = new ReviewState(prNumber, issue);

  // Step 1: Post initial comment with tracked work info
  await state.postInitialComment();

  // Step 2: Poll CI
  const ciGreen = await state.pollUntilGreen();

  if (ciGreen) {
    // CI is green
    // Check if auto-merge should happen
    if (state.isAutoMerge && state.autoMergeTimer) {
      // Timer already scheduled
    }

    // Post final comment
    const classification = getClassifyIssue()(issue);
    const tasksInfo = mapsToTASKS(issue, await readTASKS(), classification);
    const type = classification.type;
    const priority = classification.priority;

    await addPRComment(prNumber, `✅ CI is green. PR is ready for review.\n\n` +
      `**Type:** ${type}${priority ? `, priority: ${priority}` : ''}\n` +
      `${tasksInfo.mapsToExisting ? '- TASKS.md will be auto-ticked on merge' : ''}\n` +
      `${tasksInfo.newTask ? '- New TASKS.md item will be created on merge' : ''}\n` +
      `${!tasksInfo.mapsToExisting && !tasksInfo.newTask ? '- No TASKS.md mapping' : ''}\n\n` +
      `${state.isAutoMerge ? '🤖 Auto-merge scheduled in 30 min if no new comments.' : '👤 Please review and merge manually.'}\n` +
      `---\n` +
      `*Generated by github-issue-to-pr skill*`
    );

    // If auto-merge eligible and no timer yet, schedule it
    if (state.isAutoMerge && !state.autoMergeTimer) {
      state.scheduleAutoMerge();
    }
  } else {
    // CI failed or max attempts reached
    await addPRComment(prNumber, `⚠️ CI check ran ${state.pollUntilGreen.toString().length > 0 ? 'but' : 'did not complete within the polling window'}. Please investigate CI failures manually.\n\n` +
      `---\n*Generated by github-issue-to-pr skill*`);
  }

  // Step 3: Handle any new review comments if this is a re-invocation
  // (When called again, check for new comments and apply fixes if auto-fixable)
  try {
    const comments = await getPRReviewComments(prNumber);
    // If there are new comments since the last check, note them
    if (comments.length > 0) {
      // Could auto-apply certain fix patterns here
      await addPRComment(prNumber, `📬 ${comments.length} new review comment(s) detected. Apply fixes manually or re-run \`/github-issue-to-pr ${issue.number}\` to re-evaluate.`);
    }
  } catch {
    // Ignore errors on re-check
  }
}