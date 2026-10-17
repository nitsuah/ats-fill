/**
 * github-issue-to-pr — Tracking docs utilities.
 *
 * Functions for reading and updating TASKS.md, CHANGELOG.md, and FEATURES.md
 * according to the project's conventions documented in CLAUDE.md.
 *
 * All paths are relative to the repository root.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { classifyIssue } from './classifier.js';

const REPO_ROOT = process.cwd();

/**
 * Read TASKS.md and parse todo items.
 *
 * Returns array of objects: { number: <int>, title: <string>, line: <int> }
 * Only includes items under the ## Todo section with - [ ] prefix.
 */
export function readTASKS() {
  const path = join(REPO_ROOT, 'docs', 'TASKS.md');
  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const todos = [];
  let inTodoSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect section boundaries
    if (trimmed.startsWith('## ')) {
      if (trimmed === '## Todo' || trimmed.startsWith('## Todo ')) {
        inTodoSection = true;
      } else if (inTodoSection) {
        // We've left the Todo section
        break;
      }
    }

    if (!inTodoSection) continue;

    // Parse todo item: "- [ ] TASK: description (Priority: P1)" or similar
    const todoMatch = trimmed.match(/^- \[ \] (.+)$/);
    if (!todoMatch) continue;

    const itemText = todoMatch[1];
    let title = itemText;
    let priority = null;

    // Extract priority if present: "(Priority: P1)" or "[P2]"
    const priorityMatch = itemText.match(/\(Priority:\s*(P[0-4])\)|\[(P[0-4])\]/i);
    if (priorityMatch) {
      priority = (priorityMatch[1] || priorityMatch[2]).toUpperCase();
      // Remove priority from title for cleaner display
      title = itemText.replace(/\s*\(Priority:\s*P[0-4]\)\s*|\s*\[P[0-4]\]\s*/i, '').trim();
    }

    // Extract issue number if present: "(Issue #157)" or "[#157]"
    const issueMatch = itemText.match(/(?:\(Issue\s+#(\d+)\))|(?:\[#(\d+)\])/i);
    let number = null;
    if (issueMatch) {
      number = parseInt(issueMatch[1] || issueMatch[2], 10);
    }

    todos.push({
      number,
      title,
      priority,
      line: i + 1, // 1-indexed for editor compatibility
      raw: line,
    });
  }

  return todos;
}

/** Update a TASKS.md todo item by line number. */
export function updateTASKSItem(lineNumber, newContent) {
  const path = join(REPO_ROOT, 'docs', 'TASKS.md');
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  lines[lineNumber - 1] = newContent; // Convert to 0-index
  writeFileSync(path, lines.join('\n'), 'utf8');
}

/** Mark a TASKS.md item as done with a Done note. */
export function completeTASKSItem(item, doneNote) {
  const { line, title } = item;
  const path = join(REPO_ROOT, 'docs', 'TASKS.md');
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');

  // Replace "- [ ]" with "- [x]" and append the done note
  const oldLine = lines[line - 1];
  const newLine = oldLine.replace(/^- \[ \]/, '- [x]') +
    ` Done ${new Date().toISOString().slice(0, 10)}: ${doneNote}`;

  lines[line - 1] = newLine;
  writeFileSync(path, lines.join('\n'), 'utf8');
}

/** Add a new TASKS.md item under the Todo section. */
export function addTASKSItem(title, priority = 'P3') {
  const path = join(REPO_ROOT, 'docs', 'TASKS.md');
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');

  // Find the Todo section and insert after the header
  let insertAt = lines.findIndex(l => l.trim() === '## Todo');
  if (insertAt === -1) insertAt = lines.findIndex(l => l.trim().startsWith('## Todo'));
  if (insertAt === -1) {
    // Fallback: append before any done section or at end
    insertAt = lines.findIndex(l => l.trim().startsWith('## Done'));
    if (insertAt === -1) insertAt = lines.length;
  }

  // Insert after the Todo header
  const priorityText = priority ? ` (Priority: ${priority})` : '';
  const newItem = `- [ ] TASK: ${title}${priorityText}`;
  lines.splice(insertAt + 1, 0, newItem);
  writeFileSync(path, lines.join('\n'), 'utf8');
}

/**
 * Read CHANGELOG.md and find the Unreleased section.
 *
 * Returns { content: string, unreleasedIndex: number } where
 * unreleasedIndex is the line number where the Unreleased section starts.
 */
export function readCHANGELOG() {
  const path = join(REPO_ROOT, 'docs', 'CHANGELOG.md');
  if (!existsSync(path)) return { content: '', unreleasedIndex: -1 };

  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');

  // Find the Unreleased section header
  let unreleasedIndex = lines.findIndex(l => l.trim() === '## [Unreleased]');
  if (unreleasedIndex === -1) {
    unreleasedIndex = lines.findIndex(l => l.trim().startsWith('## [Unreleased]'));
  }

  return { content, unreleasedIndex: unreleasedIndex !== -1 ? unreleasedIndex : -1 };
}

/** Add an entry to the Unreleased section of CHANGELOG.md. */
export function addCHANGELOGEntry(entry) {
  const path = join(REPO_ROOT, 'docs', 'CHANGELOG.md');
  const { content, unreleasedIndex } = readCHANGELOG();
  const lines = content.split('\n');

  if (unreleasedIndex === -1) {
    // No Unreleased section - create one after the header
    const headerIndex = lines.findIndex(l => l.trim() === '# Changelog');
    if (headerIndex === -1) {
      // Fallback: prepend to file
      lines.unshift('# Changelog', '', '## [Unreleased]', entry, '');
    } else {
      lines.splice(headerIndex + 2, 0, '## [Unreleased]', entry, '');
    }
  } else {
    // Insert after the Unreleased header
    lines.splice(unreleasedIndex + 1, 0, entry);
  }

  writeFileSync(path, lines.join('\n'), 'utf8');
}

/**
 * Read FEATURES.md and parse feature categories.
 *
 * Returns array of category objects: { name: string, features: string[] }
 * Each feature is expected to be a bullet: "- **Feature Name**: Description"
 */
export function readFEATURES() {
  const path = join(REPO_ROOT, 'docs', 'FEATURES.md');
  if (!existsSync(path)) return [];

  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  const categories = [];
  let currentCategory = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect category headers: ### 🔧 Category Name or ### Category Name
    const categoryMatch = trimmed.match(/^###\s*([^\s]+.*)$/);
    if (categoryMatch) {
      if (currentCategory) categories.push(currentCategory);
      currentCategory = { name: categoryMatch[1], features: [] };
      continue;
    }

    // Detect feature bullets: - **Feature Name**: Description
    const featureMatch = trimmed.match(/^- \+\+(.+?)\+\+:\s*(.+)$/);
    if (featureMatch && currentCategory) {
      currentCategory.features.push({
        name: featureMatch[1].trim(),
        description: featureMatch[2].trim(),
        raw: line,
      });
    }
  }

  if (currentCategory) categories.push(currentCategory);
  return categories;
}

/** Update a FEATURES.md feature description by matching its name. */
export function updateFEATURESFeature(categoryName, featureName, newDescription) {
  const path = join(REPO_ROOT, 'docs', 'FEATURES.md');
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');

  let inCategory = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    // Track when we're in the right category
    if (trimmed.startsWith('### ')) {
      const catMatch = trimmed.match(/^###\s*(.+)$/);
      inCategory = catMatch && catMatch[1].trim() === categoryName;
      continue;
    }

    // Look for the feature within this category
    if (inCategory && trimmed.startsWith('- **')) {
      const featureMatch = trimmed.match(/^- \+\+(.+?)\+\+:/);
      if (featureMatch && featureMatch[1].trim() === featureName) {
        // Replace the description part
        const prefix = lines[i].slice(0, lines[i].indexOf(':**') + 3);
        lines[i] = prefix + ` ${newDescription}`;
        break;
      }
    }
  }

  writeFileSync(path, lines.join('\n'), 'utf8');
}

/**
 * Determine if a PR affects tracking docs.
 *
 * Checks whether the PR modifies TASKS.md, CHANGELOG.md, or FEATURES.md.
 * Used for the pre-merge check required by CLAUDE.md.
 *
 * @param {Array<string>} files - Array of changed file paths from getPRFiles()
 * @returns {boolean} Whether any tracking docs were modified
 */
export function affectsTrackingDocs(files) {
  const trackingDocs = new Set([
    'docs/TASKS.md',
    'docs/CHANGELOG.md',
    'docs/FEATURES.md',
  ]);

  return files.some(file => trackingDocs.has(file));
}

/** Generate a Done note for completing a TASKS.md item. */
export function generateDoneNote(issue, prNumber) {
  const { title, type } = classifyIssue(issue);
  const date = new Date().toISOString().slice(0, 10);
  const prRef = prNumber ? ` (see #${prNumber})` : '';
  return `${type}: ${title}${prRef}`;
}