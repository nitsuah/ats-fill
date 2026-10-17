#!/usr/bin/env node
/**
 * github-issue-to-pr — Main entry point for the skill.
 *
 * This file serves as the CLI entry point for the skill. It parses command-line
 * arguments and dispatches to the appropriate modules for issue-to-PR workflow.
 *
 * Usage examples:
 *   node index.js review <pr-number> <issue-number> <branch-name>
 *   node index.js plan <issue-number> <branch-name>
 */

import { readTASKS } from './utils/docs.js';
import { classifyIssue } from './utils/classifier.js';
import { plan } from './planner.js';
import { reviewLoop } from './reviewer.js';

// Simple argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node index.js <command> [args...]');
  console.log('Commands:');
  console.log('  review <pr-number> <issue-number> <branch-name> - Run PR review loop');
  console.log('  plan <issue-number> <branch-name> - Generate plan for new PR');
  process.exit(1);
}

// Main entry point
async function main() {
  try {
    const [command, ...commandArgs] = args;

    switch (command) {
      case 'review':
        if (commandArgs.length < 3) {
          console.error('Error: review requires pr-number, issue-number, and branch-name');
          process.exit(1);
        }
        const [prNumberStr, issueNumberStr, branchName] = commandArgs;
        const prNumber = Number(prNumberStr);
        const issueNumber = Number(issueNumberStr);

        // Placeholder issue data — in production, fetched from GitHub API
        const issue = {
          number: issueNumber,
          title: `Issue #${issueNumber}`,
          body: `This is a placeholder issue body for testing purposes.`,
          labels: [],
        };

        await reviewLoop(prNumber, issue, branchName);
        break;

      case 'plan':
        if (commandArgs.length < 2) {
          console.error('Error: plan requires issue-number and branch-name');
          process.exit(1);
        }
        const [planIssueNumberStr, planBranchName] = commandArgs;
        const issueNumber2 = Number(planIssueNumberStr);

        const tasks = readTASKS();

        const issue2 = {
          number: issueNumber2,
          title: `Issue #${issueNumber2}`,
          body: `This is a placeholder issue body for planning purposes.`,
          labels: [],
        };

        const classification = classifyIssue(issue2);
        const planResult = plan(issue2, classification, tasks);

        console.log('Plan generated:');
        console.log(`- Branch: ${planResult.branchName}`);
        console.log(`- PR Title: ${planResult.prTitle}`);
        console.log(`- Commit Message: ${planResult.commitMessage}`);
        console.log(`- Auto-merge: ${planResult.isAutoMerge ? 'Yes' : 'No'}`);
        console.log(`- Requires Docs: ${planResult.requiresDocs ? 'Yes' : 'No'}`);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();