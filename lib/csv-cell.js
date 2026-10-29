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