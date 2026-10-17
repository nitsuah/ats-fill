/**
 * github-issue-to-pr — Code implementation scaffolding.
 *
 * Generates the minimal code changes needed to address an issue,
 * based on its classified type (bug / feature / chore / docs) and
 * the existing patterns in the extension codebase (lib/, content/, popup/, background/).
 *
 * This module does NOT perform the full implementation itself — it produces a
 * task-specific implementation plan plus a small starter diff that the agent
 * can review, iterate on, and expand.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

/** Map issue type to a likely code location. */
const TYPE_TO_DIR = {
  bug:   'content',   // most bugs live in content scripts
  feature: 'content', // new features usually extend content scripts
  chore:   'lib',     // chores touch shared libs
  docs:    null,      // docs only — no code change
};

/** Map issue type to likely file pattern hints. */
const TYPE_TO_FILE_PATTERN = {
  bug:   ['content.ts', 'content.js', 'lib/'],
  feature: ['content.ts', 'content.js', 'lib/', 'popup/'],
  chore:   ['lib/', 'manifest.json', 'package.json'],
  docs:    ['docs/', 'README.md', 'docs/FEATURES.md'],
};

/**
 * Generate a scaffolding plan for implementing an issue fix.
 *
 * @param {object} issue - GitHub issue object
 * @param {object} classification - Output from classifyIssue()
 * @param {object} tasksInfo - Output from mapsToTASKS()
 * @returns {object} Implementation plan with suggested files, edits, and acceptance criteria
 */
export function generateImplementationPlan(issue, classification, tasksInfo) {
  const { type, priority } = classification;
  const title = issue.title || '';
  const body = issue.body || '';

  const plan = {
    type,
    priority,
    suggestedFiles: [],
    suggestedEdits: [],
    acceptanceCriteria: [],
    testSteps: [],
    commitMessage: `fix(${type}): ${title}`,
    estimatedComplexity: 'small',
    notes: [],
  };

  // Determine where changes likely go based on type
  const targetDir = TYPE_TO_DIR[type];

  if (targetDir) {
    plan.suggestedFiles.push(`src/${targetDir}/`);
  }

  // Classify by keywords to suggest specific file edits
  const text = `${title} ${body}`.toLowerCase();

  if (/popup|options|settings|badge|icon/i.test(text)) {
    plan.suggestedFiles.push('src/popup/', 'src/popup/popup.html', 'src/popup/popup.js');
    plan.suggestedEdits.push({ file: 'src/popup/popup.js', change: 'likely UI change' });
  }

  if (/background|service-worker|sw\.|alarm|storage|tabs/i.test(text)) {
    plan.suggestedFiles.push('src/background/');
    plan.suggestedEdits.push({ file: 'src/background/service-worker.js', change: 'service worker logic' });
  }

  if (/content|inject|script|page|DOM/i.test(text)) {
    plan.suggestedFiles.push('src/content/');
    plan.suggestedEdits.push({ file: 'src/content/content.js', change: 'content script change' });
  }

  if (/manifest|permission|host/i.test(text)) {
    plan.suggestedFiles.push('manifest.json');
    plan.suggestedEdits.push({ file: 'manifest.json', change: 'permission or host permission change' });
  }

  if (type === 'docs') {
    plan.suggestedFiles.push('docs/', 'README.md');
    plan.suggestedEdits.push({ file: 'docs/README.md', change: 'documentation update' });
    plan.commitMessage = `docs: ${title}`;
  }

  if (type === 'chore') {
    plan.commitMessage = `chore(${type}): ${title}`;
    plan.suggestedEdits.push({ file: 'package.json', change: 'dependency or config bump' });
  }

  // Acceptance criteria from classifier
  plan.acceptanceCriteria.push(
    `Issue type: ${type}`,
    `Priority: ${priority || 'none'}`,
    `Maps to tracked work: ${tasksInfo.mapsToExisting ? 'yes (auto-tick on merge)' : tasksInfo.newTask ? 'yes (new item)' : 'no'}`,
    'CI green on PR before merge',
  );

  if (tasksInfo.mapsToExisting) {
    plan.acceptanceCriteria.push(`TASKS.md item will be auto-ticked with Done note`);
    plan.acceptanceCriteria.push(`CHANGELOG.md Unreleased entry will be added`);
  }

  if (tasksInfo.newTask) {
    plan.acceptanceCriteria.push(`New TASKS.md item will be created under Todo`);
    plan.acceptanceCriteria.push(`CHANGELOG.md Unreleased entry will be added`);
  }

  // Test steps
  plan.testSteps.push(
    'Run `npm run lint` (via Docker)',
    'Run `npm test` (via Docker)',
    'Verify CI is green on the PR',
  );

  if (type === 'feature') {
    plan.testSteps.push('Verify new feature works end-to-end in a loaded extension');
    plan.estimatedComplexity = 'medium';
  }

  if (priority === 'P0') {
    plan.estimatedComplexity = 'large';
    plan.notes.push('P0 priority — this should be addressed promptly');
  }

  return plan;
}

/**
 * Check if a file exists in the repo root.
 *
 * @param {string} relPath - Path relative to repo root
 * @returns {boolean}
 */
export function fileExists(relPath) {
  return existsSync(join(REPO_ROOT, relPath));
}

/**
 * Read a file from the repo root.
 *
 * @param {string} relPath - Path relative to repo root
 * @returns {string|null} File contents or null if missing
 */
export function readRepoFile(relPath) {
  if (!fileExists(relPath)) return null;
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

/**
 * Extract just the "what to do" from an implementation plan — used to guide
 * the agent's next edit batch.
 *
 * @param {object} plan - Output from generateImplementationPlan()
 * @returns {string} Human-readable action list
 */
export function summarizePlan(plan) {
  const lines = [];
  lines.push(`Implementation plan for ${plan.type} (priority ${plan.priority || 'none'})`);
  lines.push(`Commit message: ${plan.commitMessage}`);
  lines.push(`Suggested files: ${plan.suggestedFiles.length ? plan.suggestedFiles.join(', ') : 'none (docs only)'}`);
  if (plan.suggestedEdits.length) {
    lines.push('Suggested edits:');
    for (const edit of plan.suggestedEdits) {
      lines.push(`  - ${edit.file}: ${edit.change}`);
    }
  }
  lines.push('Acceptance criteria:');
  for (const ac of plan.acceptanceCriteria) {
    lines.push(`  - ${ac}`);
  }
  lines.push('Test steps:');
  for (const step of plan.testSteps) {
    lines.push(`  - ${step}`);
  }
  if (plan.notes.length) {
    lines.push('Notes:');
    for (const note of plan.notes) {
      lines.push(`  - ${note}`);
    }
  }
  return lines.join('\n');
}

/**
 * Full implementation flow: given an issue, produce a plan and summary.
 *
 * @param {object} issue - GitHub issue object
 * @param {object} classification - Output from classifyIssue()
 * @param {object} tasksInfo - Output from mapsToTASKS()
 * @returns {object} { plan, summary }
 */
export function implement(issue, classification, tasksInfo) {
  const plan = generateImplementationPlan(issue, classification, tasksInfo);
  return { plan, summary: summarizePlan(plan) };
}
