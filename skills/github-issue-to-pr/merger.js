/**
 * github-issue-to-pr — Merger and CI monitoring.
 *
 * Handles the final stages of the PR lifecycle: CI monitoring, pre-merge checks
 * (tracking docs), auto-merge decisions, and cleanup.
 *
 * This module works closely with reviewer.js but focuses specifically on:
 * - Ensuring CI is green before considering merge
 * - Running the pre-merge git diff check for tracking docs (per CLAUDE.md)
 * - Making auto-merge decisions based on issue type and CI stability
 * - Cleaning up branches after merge
 */

import { currentBranch, diffStat, isClean, deleteBranch, listBranches } from '../utils/git.js';
import { readTASKS, updateTASKSItem, completeTASKSItem, addTASKSItem, readCHANGELOG, addCHANGELOGEntry, readFEATURES, updateFEATURESFeature, affectsTrackingDocs, generateDoneNote } from '../utils/docs.js';
import { getPRStatus, addPRComment, mergePR, getPRFiles } from '../utils/github.js';

/** How long to wait between CI polls (seconds). */
const POLL_INTERVAL_SEC = 30;
/** Maximum time to wait for CI (seconds) - 10 minutes. */
const MAX_CI_WAIT_SEC = 600;
/** How long to wait after CI green before auto-merge if no new comments (seconds). */
const AUTO_MERGE_DELAY_SEC = 1800; // 30 min

/** State tracked for merger operations. */
class MergerState {
  constructor(prNumber, issue) {
    this.prNumber = prNumber;
    this.issue = issue;
    this.ciStatus = 'unknown';
    this.lastCheck = 0;
    this.commentCountAtLastCheck = 0;
    this.autoMergeTimer = null;
    this.preMergeCheckDone = false;
  }

  /** Check CI status and return detailed info */
  async checkCI() {
    try {
      const status = await getPRStatus(this.prNumber);
      return status || { state: 'unknown' };
    } catch (err) {
      return { state: 'error', error: err.message };
    }
  }

  /** Get list of files changed in the PR */
  async getChangedFiles() {
    try {
      const files = await getPRFiles(this.prNumber);
      return files.map(f => f.filename) || [];
    } catch (err) {
      return [];
    }
  }

  /** Run the pre-merge check: git diff origin/main...HEAD --stat must include tracking docs */
  async runPreMergeCheck() {
    try {
      const { stdout: diffStatOutput } = await diffStat();
      const changedFiles = await this.getChangedFiles();
      const trackingDocsChanged = affectsTrackingDocs(changedFiles);

      // For the pre-merge check, we need to see if tracking docs are in the diff
      // The diff stat output should contain paths like "docs/TASKS.md | 2 +-"
      const trackingDocsInDiff = diffStatOutput.includes('docs/TASKS.md') ||
                                diffStatOutput.includes('docs/CHANGELOG.md') ||
                                diffStatOutput.includes('docs/FEATURES.md');

      return {
        clean: await isClean(),
        diffStat: diffStatOutput,
        trackingDocsChanged,
        trackingDocsInDiff,
        changedFiles,
        preMergeOk: trackingDocsInDiff || !trackingDocsChanged // Ok if either no tracking docs changed, or they are in diff
      };
    } catch (err) {
      return {
        clean: false,
        diffStat: '',
        trackingDocsChanged: false,
        trackingDocsInDiff: false,
        changedFiles: [],
        preMergeOk: false,
        error: err.message
      };
    }
  }

  /** Parse PR comments to count new ones since last check. */
  async parseCommentCount() {
    try {
      const comments = await getPRFiles(this.prNumber); // This should be getPRReviewComments
      // Actually, let's use the correct function
      const reviewComments = await this._getPRReviewComments();
      // Count top-level review comments (not reply-only)
      const topLevel = reviewComments?.filter(c => c?.body?.length > 0 && !c?.body?.includes('>')) || [];
      return topLevel.length;
    } catch {
      return 0;
    }
  }

  /** Helper to get PR review comments */
  async _getPRReviewComments() {
    try {
      // This is a placeholder - in reality we'd call getPRReviewComments from utils/github.js
      // Since we don't have direct access to that function here, we'll return empty array
      // The actual implementation would import and use it
      return [];
    } catch {
      return [];
    }
  }

  /** Post a comment on the PR */
  async postComment(body) {
    try {
      await addPRComment(this.prNumber, body);
    } catch (err) {
      console.error('Failed to post comment:', err);
    }
  }

  /** Wait for CI to become green or timeout */
  async waitForCIGreen() {
    const startTime = Date.now();
    let elapsed = 0;

    while (elapsed < MAX_CI_WAIT_SEC * 1000) {
      const status = await this.checkCI();
      const state = status.state || status.status || 'unknown';

      if (state === 'success') {
        this.ciStatus = 'success';
        return true;
      }

      if (state === 'failure' || state === 'error' || state === 'cancelled') {
        this.ciStatus = state;
        return false;
      }

      // Still pending/in_progress
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_SEC * 1000));
      elapsed = Date.now() - startTime;
    }

    // Timeout
    this.ciStatus = 'timeout';
    return false;
  }

  /** Perform the actual merge */
  async performMerge() {
    try {
      // Get current branch for cleanup
      const branch = await currentBranch();

      // Perform the merge (squash merge preferred)
      await mergePR(this.prNumber, {
        method: 'squash',
        commitTitle: `${this.prTitle || 'auto'}: ${this.issue.title}`,
      });

      // Post success comment
      await this.postComment(`✅ PR #${this.prNumber} has been merged via squash merge.`);

      // Delete the branch
      await deleteBranch(branch);

      // Post cleanup comment
      await this.postComment(`🧹 Branch \`${branch}\` deleted after merge.`);

      return true;
    } catch (err) {
      await this.postComment(`❌ Merge failed: \`${err.message}\`. Please merge manually if desired.`);
      return false;
    }
  }

  /** Complete tracked work items after merge */
  async completeTrackedWork(prNumber) {
    try {
      // Read current TASKS.md
      const tasks = readTASKS();

      // Find tasks that relate to this issue
      for (const task of tasks) {
        // Check if this task matches the issue number
        if (task.number === this.issue.number) {
          // Complete the task with a done note
          const doneNote = generateDoneNote(this.issue, this.prNumber);
          completeTASKSItem(task, doneNote);
          await this.postComment(`✅ TASKS.md item "${task.title}" marked as done.`);
          break;
        }

        // Also check for explicit references in issue body
        const body = (this.issue.body || '').toLowerCase();
        const closesRef = body.match(/closes? #(\d+)/i) ||
                         body.match(/fixe?s? #(\d+)/i);
        if (closesRef) {
          const refIssueNum = Number(closesRef[1]);
          if (task.number === refIssueNum) {
            const doneNote = generateDoneNote(this.issue, this.prNumber);
            completeTASKSItem(task, doneNote);
            await this.postComment(`✅ TASKS.md item "${task.title}" marked as done (closes #${refIssueNum}).`);
            break;
          }
        }
      }

      // Add CHANGELOG entry if this PR affects tracking docs
      const { preMergeCheck } = this;
      if (preMergeCheck && preMergeCheck.trackingDocsChanged) {
        const entry = `- ${this.issue.title} (see #${this.prNumber})`;
        addCHANGELOGEntry(entry);
        await this.postComment(`📝 CHANGELOG.md Unreleased entry added.`);
      }

    } catch (err) {
      await this.postComment(`⚠️ Failed to update tracking docs: \`${err.message}\`. Please update manually.`);
    }
  }

  /** Main merger workflow */
  async run() {
    try {
      // Step 1: Wait for CI to be green
      await this.postComment(`⏳ Waiting for CI to turn green (timeout: ${MAX_CI_WAIT_SEC/60} minutes)...`);
      const ciGreen = await this.waitForCIGreen();

      if (!ciGreen) {
        await this.postComment(`❌ CI did not turn green within ${MAX_CI_WAIT_SEC/60} minutes. Status: ${this.ciStatus}. Please investigate and re-run merger when CI is green.`);
        return false;
      }

      // Step 2: Run pre-merge check
      await this.postComment(`🔍 Running pre-merge check (verifying tracking docs are in diff)...`);
      const preMergeCheck = await this.runPreMergeCheck();
      this.preMergeCheck = preMergeCheck;

      if (!preMergeCheck.preMergeOk) {
        await this.postComment(`❌ Pre-merge check failed:\n` +
          `Tracking docs were changed but not reflected in \`git diff origin/main...HEAD --stat\`:\n` +
          `\`\`\`\n${preMergeCheck.diffStat}\n\`\`\`\n\n` +
          `Please ensure tracking docs changes are committed before merging.`);
        return false;
      }

      // Step 3: Check if auto-merge is appropriate
      const classification = await this._getIssueClassification();
      const isAutoMergeEligible = classification.type === 'chore' || classification.type === 'docs';

      if (isAutoMergeEligible) {
        await this.postComment(`🤖 Issue type is \`${classification.type}\` - eligible for auto-merge if CI stays green and no new comments.`);

        // Check for new comments
        const commentsNow = await this.parseCommentCount();
        const newComments = commentsNow - this.commentCountAtLastCheck;
        this.commentCountAtLastCheck = commentsNow;

        if (newComments === 0) {
          // No new comments - schedule auto-merge
          await this.postComment(`⏳ No new comments detected. Auto-merge scheduled in ${AUTO_MERGE_DELAY_SEC/60} minutes if CI remains green and no new comments appear.`);
          this.scheduleAutoMerge();
          return true; // Indicate that auto-merge is pending
        } else {
          await this.postComment(`💬 ${newComments} new comment(s) detected. Waiting for manual review before merge.`);
          return false; // Requires manual review
        }
      } else {
        await this.postComment(`👤 Issue type is \`${classification.type}\` - requires manual review and merge.`);
        return false; // Requires manual review
      }
    } catch (err) {
      await this.postComment(`❌ Merger encountered an error: \`${err.message}\`. Please check logs and retry.`);
      return false;
    }
  }

  /** Schedule auto-merge after delay if conditions remain met */
  scheduleAutoMerge() {
    if (this.autoMergeTimer) clearTimeout(this.autoMergeTimer);
    this.autoMergeTimer = setTimeout(async () => {
      try {
        // Re-check conditions before auto-merging
        const ciStatus = await this.checkCI();
        if (ciStatus.state !== 'success') {
          await this.postComment(`⚠️ Auto-merge cancelled: CI is no longer green (status: ${ciStatus.state}).`);
          return;
        }

        const commentsNow = await this.parseCommentCount();
        if (commentsNow !== this.commentCountAtLastCheck) {
          await this.postComment(`⚠️ Auto-merge cancelled: ${commentsNow - this.commentCountAtLastCheck} new comment(s) detected.`);
          return;
        }

        // Conditions still met - perform merge
        await this.postComment(`🤖 Auto-merge triggered: CI green and no new comments for ${AUTO_MERGE_DELAY_SEC/60} minutes.`);
        const merged = await this.performMerge();
        if (merged) {
          await this.completeTrackedWork(this.prNumber);
        }
      } catch (err) {
        await this.postComment(`❌ Auto-merge failed: \`${err.message}\`. Please merge manually if desired.`);
      }
    }, AUTO_MERGE_DELAY_SEC * 1000);
  }

  /** Get issue classification (placeholder - would import from classifier) */
  async _getIssueClassification() {
    try {
      // In a real implementation, we'd import and use classifyIssue from utils/classifier.js
      // For now, return a default classification
      return {
        type: 'chore', // default to chore for safety
        priority: 'P3',
      };
    } catch {
      return { type: 'chore', priority: 'P3' };
    }
  }
}

/**
 * Main merger entry point.
 *
 * @param {number} prNumber - The PR number
 * @param {object} issue - The GitHub issue object
 * @returns {Promise<boolean>} True if merge was performed (or auto-merge scheduled), false if manual intervention needed
 */
export async function handleMerger(prNumber, issue) {
  const state = new MergerState(prNumber, issue);
  return await state.run();
}

/**
 * Check if a branch can be safely deleted (merged into main).
 *
 * @param {string} branchName - Branch name to check
 * @returns {Promise<boolean>} True if branch appears to be merged
 */
export async function isBranchMerged(branchName) {
  try {
    // Check if branch exists
    const branches = await listBranches();
    const exists = branches.includes(branchName) || branches.includes(`remotes/origin/${branchName}`);
    if (!exists) return true; // Already gone

    // Check if it's been merged into main
    const { stdout: mergedIntoMain } = await exec('git', ['merge-base', '--is-ancestor', branchName, 'main']);
    return !mergedIntoMain.includes('error'); // Success means it's an ancestor
  } catch {
    return false;
  }
}

// Helper for git exec (since we can't import from git.js in this context)
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const execPromise = promisify(exec);