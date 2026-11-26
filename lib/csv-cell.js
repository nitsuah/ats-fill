/**
 * Spreadsheet-safe CSV cell. A value that a spreadsheet would read as a
 * formula (leading = + - @, or a leading tab/CR, optionally after whitespace)
 * gets a "'" prefix so it stays literal text, then the usual CSV quoting.
 * Note: a legitimate value that starts with "-" or "+" is also prefixed.
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let text = String(value);
  if (/^[\t\r\n ]*[=+\-@]|^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Build the tracker export CSV text (header plus one row per application).
 * @param {Array<Record<string, any>>} applications
 * @returns {string}
 */
export function buildTrackerCsv(applications) {
  const header = 'Company,Role Title,Status,Date,Employment Type,Remote,Location,Pay Min,Pay Max,Salary Range,Scorecard,Verdict,URL,Notes';
  const rows = applications.map((a) =>
    [
      a.company,
      a.title,
      a.status,
      a.date,
      a.employment_type,
      a.remote ? 'Yes' : 'No',
      a.location,
      a.pay_min,
      a.pay_max,
      a.salary_range,
      a.scorecard,
      a.verdict,
      a.url,
      a.description || a.jd_snippet || '',
    ]
      .map((v) => csvCell(v))
      .join(',')
  );
  return [header, ...rows].join('\n');
}
