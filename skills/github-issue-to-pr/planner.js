/**
 * github-issue-to-pr — Branch and PR planning.
 *
 * Generates branch names, PR titles, and PR bodies from issue data.
 * Follows the project's conventions in CLAUDE.md and the L6 agent's branch discipline.
 */

/**
 * Slugify a title for use in a branch name.
 *
 * Keeps only alphanumeric characters and hyphens, lowercase.
 *
 * @param {string} title
 * @returns {string}
 */
export function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Generate a branch name from the issue number and title.
 *
 * Format: fix/<issue-number>-<slugified-title>
 * The prefix "fix/" is used regardless of issue type, following the
 * user-approved convention. Keeps branch names consistent and predictable.
 *
 * @param {number} issueNumber
 * @param {string} title
 * @returns {string}
 */
export function generateBranchName(issueNumber, title) {
  const slug = slugify(title);
  // Truncate if too long
  const maxSlugLen = 60;
  const finalSlug = slug.length > maxSlugLen ? slug.substring(0, maxSlugLen) : slug;
  return `fix/${issueNumber}-${finalSlug}`;
}

/**
 * Generate a commit message from the issue classification.
 *
 * Uses conventional commit format: <type>(<scope>): <summary>
 *
 * @param {object} classification - Output from classifyIssue()
 * @param {string} summary - Short summary (usually the issue title)
 * @returns {string}
 */
export function generateCommitMessage(classification, summary) {
  const { type } = classification;
  const scope = 'extension';
  const truncated = summary.length > 72 ? summary.substring(0, 69) + '...' : summary;
  return `${type}(${scope}): ${truncated}`;
}

/**
 * Generate a PR title from the issue.
 *
 * Format: <type>: <short summary>
 * Matches conventional commit style expected by release tooling.
 *
 * @param {object} issue - GitHub issue object
 * @param {object} classification - Output from classifyIssue()
 * @returns {string}
 */
export function generatePRTitle(issue, classification) {
  const { type } = classification;
  let summary = issue.title.trim();
  if (summary.length > 60) {
    summary = summary.substring(0, 57) + '...';
  }
  return `${type}: ${summary}`;
}

/**
 * Generate a PR description from the issue and classification.
 *
 * Uses the existing PR template structure:
 * - Summary (from issue title/body)
 * - Tracked work (auto-checked based on TASKS.md mapping)
 * - Testing notes
 *
 * @param {object} issue - GitHub issue object
 * @param {object} classification - Output from classifyIssue()
 * @param {object} tasksInfo - { mapsToExisting, newTask, refIssueNum }
 * @returns {string}
 */
export function generatePRDescription(issue, classification, tasksInfo) {
  const { type, priority } = classification;

  // Build the summary section
  const summary = issue.body
    ? issue.body.split('\n\n')[0]
    : issue.title;

  // Tracked work section
  let trackedWork = '';
  if (tasksInfo.mapsToExisting) {
    trackedWork = `- [ ] TASKS.md item auto-ticked with Done note
- [ ] CHANGELOG.md Unreleased entry added
- [ ] FEATURES.md updated if claim changed`;
  } else if (tasksInfo.newTask) {
    trackedWork = `- [ ] TASKS.md new item created under Todo
- [ ] CHANGELOG.md Unreleased entry added
- [ ] PR description includes "Closes #${issue.number}" if applicable`;
  } else {
    trackedWork = `- [ ] No tracked TASKS.md item (issue type: ${type}, priority: ${priority || 'none'})
- [ ] CHANGELOG.md Unreleased entry added if relevant`;
  }

  return `## Summary

${summary}

Fixes #${issue.number}

## Tracked work

${trackedWork}

## Testing

<!-- Commands or steps run to validate this change: -->
- [ ] \`npm run lint\` (via Docker)
- [ ] \`npm test\` (via Docker)
- [ ] CI green on PR

## Notes

- Issue type: **${type}**
- Priority: **${priority || 'none'}**
- Auto-generated from issue #${issue.number} by the github-issue-to-pr skill.
`;
}

/**
 * Extract acceptance criteria from the issue body.
 *
 * Looks for "Acceptance Criteria:", "AC:", or checklist items.
 *
 * @param {object} issue - GitHub issue object
 * @returns {Array<string>|null}
 */
export function extractAcceptanceCriteria(issue) {
  const body = issue.body || '';
  const lines = body.split('\n');
  const criteria = [];
  let inCriteria = false;

  for (const line of lines) {
    // Detect acceptance criteria section headers
    if (/acceptance criteria|ac:|expected.*outcome|definition of done/i.test(line)) {
      inCriteria = true;
      continue;
    }

    if (inCriteria) {
      // Stop if we hit another section header
      if (line.match(/^(##|###|## )/i) || line.match(/^-\s*\[/) && criteria.length > 0) {
        break;
      }

      // Collect checklist items or plain lines
      const checkboxMatch = line.match(/^-\s*\[.\]\s*(.+)/);
      if (checkboxMatch) {
        criteria.push(checkboxMatch[1].trim());
      } else if (line.trim() && !line.startsWith('#')) {
        criteria.push(line.trim());
      }
    }
  }

  return criteria.length > 0 ? criteria : null;
}

/**
 * Plan the full PR workflow given an issue.
 *
 * Returns a plan object with all the information needed to execute.
 *
 * @param {object} issue - GitHub issue object (from getIssue)
 * @param {object} classification - Output from classifyIssue()
 * @param {Array<object>} tasks - Parsed TASKS.md todos from readTASKS()
 * @returns {object} Full execution plan
 */
export function plan(issue, classification, tasks) {
  const tasksInfo = mapsToTASKS(issue, tasks);
  const branchName = generateBranchName(issue.number, issue.title);
  const prTitle = generatePRTitle(issue, classification);
  const prDescription = generatePRDescription(issue, classification, tasksInfo);
  const acceptanceCriteria = extractAcceptanceCriteria(issue);
  const commitMessage = generateCommitMessage(classification, issue.title);

  return {
    issue,
    classification,
    branchName,
    prTitle,
    prDescription,
    acceptanceCriteria,
    tasksInfo,
    commitMessage,
    isAutoMerge: classification.type === 'chore' || classification.type === 'docs',
    requiresDocs: tasksInfo.mapsToExisting || tasksInfo.newTask,
  };
}

/**
 * Check if an issue maps to a TASKS.md item.
 *
 * (Separated from docs.js to avoid circular import — docs.js imports classifier.js,
 *  planner.js imports docs.js, so this function delegates to docs.js.)
 */
function mapsToTASKS(issue, tasks = [], classification) {
  // Check for explicit issue reference in the issue body
  const body = (issue.body || '').toLowerCase();
  const closesRef = body.match(/closes? #(\d+)/i) ||
                    body.match(/fixe?s? #(\d+)/i);

  if (closesRef) {
    const refIssueNum = Number(closesRef[1]);
    const mapsTo = tasks.some(t => String(t.number) === String(refIssueNum));
    return { mapsToExisting: mapsTo, newTask: !mapsTo, refIssueNum };
  }

  // Check title matches against existing tasks
  const titleLower = issue.title.toLowerCase();
  for (const task of tasks) {
    if (task.title.toLowerCase().includes(titleLower.substring(0, 30))) {
      return { mapsToExisting: true, newTask: false, refIssueNum: task.number };
    }
  }

  // Classify if a new task should be created
  if (classification.type === 'bug' && classification.priority === 'P0') {
    return { mapsToExisting: false, newTask: true, refIssueNum: null };
  }

  if (classification.priority === 'P1') {
    return { mapsToExisting: false, newTask: true, refIssueNum: null };
  }

  return { mapsToExisting: false, newTask: false, refIssueNum: null };
}

// Import needed functions
import { classifyIssue } from './utils/classifier.js';