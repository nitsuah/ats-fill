/**
 * Voiceover script for the feature tour: the narrator reads exactly what is on
 * screen (intro, chapter titles, each step's caption, the call to action), so
 * the copy lives in one place, video/storyboard.mjs.
 *
 * scripts/voice/narrate.mjs turns these lines into WAV clips with a local TTS
 * model; the capture spec stretches holds to fit each clip and the build
 * script mixes them into one audio track per video.
 */
import { SEGMENTS, INTRO, OUTRO } from './storyboard.mjs';

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Spell out what a TTS model would otherwise mispronounce.
const SAY = [
  [/ats-fill/gi, 'A T S fill'],
  [/\bATS\b/g, 'A T S'],
  [/\bJD\b/g, 'J D'],
  [/\bCSV\b/g, 'C S V'],
  [/\bMIT\b/g, 'M I T'],
  [/\bDOCX\b/g, 'doc X'],
  [/\bPDF\b/g, 'P D F'],
  [/\bRSS\b/g, 'R S S'],
  [/\bUSAJOBS\b/g, 'USA Jobs'],
  [/\bHN\b/g, 'Hacker News'],
  [/\bSTAR\b/g, 'star'],
  [/[’‘]/g, "'"],
  [/[“”]/g, '"'],
  [/ · /g, ', '],
];

export function speakable(text) {
  return SAY.reduce((t, [re, to]) => t.replace(re, to), text).replace(/\s+/g, ' ').trim();
}

const sentence = (title, body) => `${title.replace(/[.!?]?$/, '.')} ${body}`;

/** Every narrated line, keyed by the frame or step it belongs to. */
export function narrationLines() {
  const lines = [{ id: 'intro', text: sentence(INTRO.title, INTRO.body) }];
  SEGMENTS.forEach((segment, i) => {
    lines.push({ id: `title-${segment.slug}`, text: `Chapter ${NUMBERS[i + 1] ?? i + 1}. ${segment.title.replace(/[.!?]?$/, '.')}` });
    for (const beat of segment.beats) lines.push({ id: beat.id, text: sentence(beat.title, beat.body) });
  });
  lines.push({ id: 'outro', text: sentence(OUTRO.title, OUTRO.body) });
  return lines.map((line) => ({ ...line, caption: line.text.replace(/[’‘]/g, "'"), text: speakable(line.text) }));
}
