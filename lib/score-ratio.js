export const MAX_SCORECARD_LENGTH = 200;

const isDigit = (c) => c >= '0' && c <= '9';
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';

/**
 * Find the first "<number> / <number>" in text with a linear scan (no regex
 * backtracking). Input is capped at MAX_SCORECARD_LENGTH.
 * @param {unknown} text
 * @returns {{score:number,max:number}|null}
 */
export function parseScoreRatio(text) {
  const s = String(text || '').slice(0, MAX_SCORECARD_LENGTH);
  for (let slash = s.indexOf('/'); slash !== -1; slash = s.indexOf('/', slash + 1)) {
    let end = slash;
    while (end > 0 && isSpace(s[end - 1])) end--;
    let start = end;
    while (start > 0 && isDigit(s[start - 1])) start--;
    if (start === end) continue;
    if (start > 1 && s[start - 1] === '.' && isDigit(s[start - 2])) {
      start--;
      while (start > 0 && isDigit(s[start - 1])) start--;
    }
    let i = slash + 1;
    while (i < s.length && isSpace(s[i])) i++;
    let j = i;
    while (j < s.length && isDigit(s[j])) j++;
    if (j === i) continue;
    if (s[j] === '.' && isDigit(s[j + 1])) {
      j++;
      while (j < s.length && isDigit(s[j])) j++;
    }
    return { score: Number(s.slice(start, end)), max: Number(s.slice(i, j)) };
  }
  return null;
}