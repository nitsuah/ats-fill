/**
 * github-issue-to-pr — Issue classifier.
 *
 * Takes a GitHub issue object and returns a classification:
 * - type: "bug" | "feature" | "chore" | "docs"
 * - priority: "P0" | "P1" | "P2" | "P3" | "P4" | "none"
 * - relatesToTASKS: boolean — does this issue map to a TASKS.md item?
 * - title: short extracted title
 * - summary: one-line summary
 */

// Heuristic keywords for classification
const BUG_KEYWORDS = /(bug|issue|defect|broken|error|fail|crash|hang|not working|doesn't work)/i;
const FEATURE_KEYWORDS = /(feature|enhancement|improvement|add|new |support|integrate|create|implement)/i;
const CHORE_KEYWORDS = /(chore|task|refactor|cleanup|update |bump|update|dependency|config|optimiz|maintenance)/i;
const DOCS_KEYWORDS = /(docs|documentation|readme|website|wiki)/i;

// Heuristic for TASKS.md mapping
const TASKS_MAPPING_KEYWORDS = /(task|track|P[0-4]|priority|roadmap|quarter|milestone)/i;

/**
 * Classify a GitHub issue.
 *
 * @param {object} issue - GitHub issue object from the API
 * @returns {object} Classification result
 */
export function classifyIssue(issue) {
  const title = (issue.title || '').trim();
  const body = (issue.body || '').trim();
  const labels = (issue.labels || []).map(l => l.name.toLowerCase());
  const text = `${title} ${body}`;

  // Determine type by keyword priority: bug > feature > chore > docs
  let type = 'feature'; // default
  if (BUG_KEYWORDS.test(text)) type = 'bug';
  else if (FEATURE_KEYWORDS.test(text)) type = 'feature';
  else if (CHORE_KEYWORDS.test(text)) type = 'chore';
  else if (DOCS_KEYWORDS.test(text)) type = 'docs';

  // Determine priority from labels or body text
  let priority = 'P3'; // default
  if (labels.includes('P0') || /P0/.test(text)) priority = 'P0';
  else if (labels.includes('P1') || /P1/.test(text)) priority = 'P1';
  else if (labels.includes('P2') || /P2/.test(text)) priority = 'P2';

  // Check if issue relates to TASKS.md items
  let relatesToTASKS = false;
  if (TASKS_MAPPING_KEYWORDS.test(text)) relatesToTASKS = true;

  // Extract a short title (first 60 chars if long)
  let extractedTitle = title;
  if (extractedTitle.length > 60) {
    extractedTitle = extractedTitle.slice(0, 57) + '...';
  }

  // One-line summary: use first sentence of body, or title if body is short
  let summary;
  if (body) {
    const firstSentence = body.match(/^[.!?;:]\s*[A-Z]/);
    summary = firstSentence
      ? body.substring(0, firstSentence.index + 40).trimEnd()
      : body.split('.')[0].substring(0, 80).trim() + '...';
  } else {
    summary = extractedTitle;
  }
  if (summary.length > 100) summary = summary.substring(0, 97) + '...';

  return {
    type,
    priority,
    relatesToTASKS,
    title: extractedTitle,
    summary,
  };
}

/**
 * Determine if an issue should auto-complete a TASKS.md item.
 *
 * An issue maps to TASKS.md if:
 * 1. It has an explicit reference like "Closes #42" or "Fixes #15"
 * 2. It contains TASKS_MAPPING_KEYWORDS and has a priority that aligns
 * 3. It's a bug/feature that clearly addresses an existing tracked item
 *
 * @param {object} issue - GitHub issue object
 * @param {Array<string>} tasks - Parsed TASKS.md todo items
 * @returns {object} { mapsToExisting, newTask }
 */
export function mapsToTASKSMD(issue, tasks = []) {
  const classification = classifyIssue(issue);
  const titleLower = (issue.title || '').toLowerCase();
  const bodyLower = (issue.body || '').toLowerCase();

  // Check for explicit "Closes #NN" or "Fixes #NN"
  const closesRef = bodyLower.match(/closes? #(\d+)/i) ||
                    bodyLower.match(/fixe?s? #(\d+)/i);
  if (closesRef) {
    const refIssueNum = Number(closesRef[1]);
    const mapsTo = tasks.some(t => String(t.number) === String(refIssueNum));
    return { mapsToExisting: mapsTo, newTask: !mapsTo, refIssueNum };
  }

  // Check if any existing TASKS.md item title is mentioned in the issue
  for (const task of tasks) {
    if (task.title.toLowerCase().includes(titleLower) ||
        task.title.toLowerCase().includes(bodyLower.substring(0, 50))) {
      return { mapsToExisting: true, newTask: false, refIssueNum: task.number };
    }
  }

  // For new issues without explicit mapping, classify by type/priority
  if (classification.relatesToTASKS || classification.priority === 'P0' || classification.priority === 'P1') {
    return { mapsToExisting: false, newTask: true, refIssueNum: null };
  }

  return { mapsToExisting: false, newTask: false, refIssueNum: null };
}

/**
 * Extract priority from a TASKS.md item line.
 *
 * TASKS.md items can have format:
 *   - [ ] TASK: description (Priority: P1)
 *   - [ ] TASK: description [P2]
 *   - [ ] description
 *
 * @param {string} line - A TASKS.md todo line
 * @returns {string|null} Priority tag or null
 */
export function extractTASKSPriority(line) {
  const m = line.match(/P[0-4]/i);
  return m ? m[0].toUpperCase() : null;
}

/**
 * Determine if a PR branch name is valid.
 *
 * @param {string} name - Branch name to validate
 * @returns {boolean} Whether the branch name is valid
 */
export function isValidBranchName(name) {
  // Git branch name restrictions:
  // - Maximum 255 bytes
  // - Cannot start with a slash
  // - Cannot contain: ~ ^ : ? * [ ] ( ) spaces
  const invalid = /[~^:?*\[\]()\s]/;
  return !invalid.test(name) && name.length <= 255;
}