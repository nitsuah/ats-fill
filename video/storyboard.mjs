/**
 * Feature-tour storyboard: the single source of truth for what the YouTube
 * walkthrough shows and says. Shared by the capture spec
 * (tests/e2e/feature-video.spec.mjs), which renders one 1920x1080 frame per
 * beat, and the ffmpeg build (scripts/build-feature-video.mjs), which turns
 * frames into per-feature shorts, the combined cut, and YouTube chapters.
 *
 * Every beat `id` must have a matching capture in the spec. Hold times are
 * derived from caption length (see holdSeconds) unless a beat sets `hold`.
 */

export const STORE_URL = 'https://chromewebstore.google.com/detail/ats-fill/amofaeopfmaicbiijgjaojenedkkadmn';
export const REPO_URL = 'https://github.com/nitsuah/ats-fill';
export const SITE_URL = 'https://nitsuah.github.io/ats-fill/';

export const INTRO = {
  id: 'intro',
  kicker: 'Feature tour',
  title: 'The same 20 questions on 47 different forms.',
  body: 'ats-fill is a free, local-first Chrome extension that fills job applications from a profile you save once, then tracks every application. Here is everything it does.',
  hold: 8,
};

export const OUTRO = {
  id: 'outro',
  kicker: 'Get it',
  title: 'Add ats-fill to Chrome.',
  body: 'Free and open source (MIT). No server, no account, no subscription. You review every field and press submit.',
  hold: 8,
};

export const SEGMENTS = [
  {
    slug: 'profile',
    title: 'Your profile, saved once',
    summary: 'Resume, contact details and the answers every form asks for.',
    beats: [
      {
        id: 'profile-resume',
        title: 'Upload your resume once',
        body: 'PDF, DOCX or pasted text. Contact details, work history and standard answers like work authorization, start date and salary range are saved in Chrome, on your device.',
      },
      {
        id: 'profile-memory',
        title: 'Memory you can audit',
        body: 'Answers you correct on real forms are remembered. Review, edit, ignore or delete each one. Sensitive demographic fields stay off unless you opt in.',
      },
    ],
  },
  {
    slug: 'form-fill',
    title: 'Fill a real application',
    summary: 'Detect the form, preview every answer, fill it in place.',
    beats: [
      {
        id: 'fill-ats-page',
        title: 'Land on an application',
        body: 'Greenhouse, Lever, Ashby and Workday are detected automatically. ats-fill reads the job description straight from the page.',
      },
      {
        id: 'fill-dashboard',
        title: 'Open ats-fill',
        body: 'The home screen shows the detected ATS, whether your resume, profile and memory are ready, and how the last fill went.',
      },
      {
        id: 'fill-preview',
        title: 'Review before anything is typed',
        body: 'Preview every answer it will use, search them, and fix anything first. Questions it cannot answer are flagged, not guessed.',
      },
      {
        id: 'fill-filled',
        title: 'Filled in place. You press submit.',
        body: 'Fields are filled on the page itself. File uploads, attestations and the submit button stay yours: ats-fill never submits an application.',
      },
    ],
  },
  {
    slug: 'job-search',
    title: 'Search 16 job boards at once',
    summary: 'One search box, deduped results, one-click save.',
    beats: [
      {
        id: 'search-sources',
        title: 'One search box, 16 boards',
        body: 'Nine keyless boards work out of the box, including Remotive, We Work Remotely and HN Who’s Hiring. Toggle any source on or off with its chip.',
      },
      {
        id: 'search-results',
        title: 'Deduped results, ready to save',
        body: 'Each card shows pay, location and a source-confidence hint. One click saves the job to your pipeline with its description attached.',
      },
      {
        id: 'search-filters',
        title: 'Filter before you read',
        body: 'Narrow by remote, employment type and region, set a pay range, and hide listings that don’t publish salary at all.',
      },
      {
        id: 'search-custom-sources',
        title: 'Bring your own boards',
        body: 'Add keys for Adzuna, USAJOBS, Reed and Jooble, or any RSS feed: a state workforce board, a niche community, an internal careers page.',
      },
    ],
  },
  {
    slug: 'pipeline',
    title: 'Track every application',
    summary: 'A pipeline board that lives in your browser.',
    beats: [
      {
        id: 'pipeline-board',
        title: 'Every application on one board',
        body: 'Drafts, submitted, interview, offer. Jobs you fill or save land here automatically. Import or export CSV whenever you like.',
      },
      {
        id: 'pipeline-card',
        title: 'Verdicts and scorecards',
        body: 'Each job keeps its pay band, location, notes, verdict and scorecard, so you remember why you applied when the recruiter calls.',
      },
      {
        id: 'pipeline-add',
        title: 'Capture any job in seconds',
        body: 'Save the job on the current tab, or paste a description. With a Gemini key, clean up or summarize the JD before saving it.',
      },
      {
        id: 'pipeline-dark',
        title: 'Light or dark',
        body: 'Follows your system theme, for late-night application sessions too.',
        hold: 5.5,
      },
    ],
  },
  {
    slug: 'interview-prep',
    title: 'Prepare for the interview',
    summary: 'Practice questions from the actual job description.',
    beats: [
      {
        id: 'prep-questions',
        title: 'Questions from the actual JD',
        body: 'Interview Prep turns a saved job’s description and your profile into likely questions, each with a suggested answer structure.',
      },
      {
        id: 'prep-answer',
        title: 'Draft answers next to each question',
        body: 'Write STAR stories against each question. Answers are saved locally per job, ready for the next round.',
      },
    ],
  },
  {
    slug: 'analytics',
    title: 'Learn what’s working',
    summary: 'Analytics computed locally from your own pipeline.',
    beats: [
      {
        id: 'analytics-overview',
        title: 'Response rate by source',
        body: 'See which boards actually lead to replies, not just applications, computed locally from your own pipeline.',
      },
      {
        id: 'analytics-detail',
        title: 'Pay bands and response time',
        body: 'Which salary ranges get answers, and how long employers usually take, so you know when to follow up.',
      },
    ],
  },
  {
    slug: 'privacy',
    title: 'Private by design',
    summary: 'No server, no account, no telemetry.',
    beats: [
      {
        id: 'privacy-byok',
        title: 'AI is optional and uses your own key',
        body: 'Gemini powers resume parsing, answer drafting and interview prep with a key you supply. Fill, tracking, search and analytics work without it.',
      },
      {
        id: 'privacy-controls',
        title: 'Your data, your controls',
        body: 'Everything stays in Chrome’s local storage. Export to CSV, clear the cache, or delete everything in one click.',
      },
    ],
  },
];

export const FPS = 30;
export const CROSSFADE = 0.8;
export const TITLE_HOLD = 4;

/**
 * Seconds a frame stays on screen: time to read the caption at a relaxed
 * ~2.6 words/s plus time to look at the product shot itself.
 */
export function holdSeconds(item) {
  if (item.hold) return item.hold;
  const words = `${item.title} ${item.body}`.split(/\s+/).length;
  return Math.min(11, Math.max(6, Math.round((words / 2.6 + 2.5) * 2) / 2));
}
