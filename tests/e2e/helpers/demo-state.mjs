/**
 * Deterministic, fictional extension state for product screenshots and the
 * local preview harness (scripts/preview).
 *
 * This data is intentionally synthetic: it makes the UI look meaningfully used
 * without ever putting a developer's personal profile, resume, API key, or
 * application history into committed screenshots. Every company, person, and
 * URL path below is invented; hosts point at real ATS domains only so the
 * analytics "source" breakdown has something realistic to group by.
 */

// Screenshot clock: 2026-09-24T15:00:00Z. Dates below are relative to this.
export const DEMO_NOW = 1790262000000;

function app(fields) {
  return {
    employment_type: 'Full-time',
    remote: true,
    answers_generated: true,
    fill_report: null,
    first_response_at: '',
    ...fields,
    description: fields.jd_snippet,
  };
}

export const DEMO_APPLICATIONS = [
  app({
    id: 'demo-app-001', company: 'Northstar Labs', title: 'Senior Platform Engineer',
    url: 'https://boards.greenhouse.io/northstarlabs/jobs/4410021', status: 'interview', sort_order: 9000,
    date: '2026-09-08', updated_at: '2026-09-22T14:00:00.000Z', first_response_at: '2026-09-12T14:00:00.000Z',
    jd_snippet: 'Own the internal developer platform: paved-road CI/CD, golden-path templates, and the reliability tooling 200 engineers ship on.',
    location: 'Remote · US', pay_min: 175000, pay_max: 210000, salary_range: '$175,000 – $210,000',
    scorecard: '5/5', verdict: 'strong_yes',
  }),
  app({
    id: 'demo-app-002', company: 'Pine Ridge Analytics', title: 'DevOps Engineer II',
    url: 'https://jobs.ashbyhq.com/pineridge/devops-engineer', status: 'offer', sort_order: 8800,
    date: '2026-08-26', updated_at: '2026-09-23T13:15:00.000Z', first_response_at: '2026-09-01T15:30:00.000Z',
    jd_snippet: 'Scale CI/CD, observability, and infrastructure automation for a fast-growing data platform.',
    location: 'Remote · US', pay_min: 160000, pay_max: 190000, salary_range: '$160,000 – $190,000',
    scorecard: '4/5', verdict: 'strong_yes',
  }),
  app({
    id: 'demo-app-003', company: 'Meridian Systems', title: 'Cloud Infrastructure Engineer',
    url: 'https://jobs.lever.co/meridian/cloud-infrastructure-engineer', status: 'interview', sort_order: 8600,
    date: '2026-09-02', updated_at: '2026-09-19T16:30:00.000Z', first_response_at: '2026-09-09T16:30:00.000Z',
    jd_snippet: 'Build and operate secure multi-region cloud platforms used by engineering teams worldwide.',
    location: 'Washington, DC · Hybrid', pay_min: 150000, pay_max: 185000, salary_range: '$150,000 – $185,000',
    scorecard: '4/5', verdict: 'lean_yes',
  }),
  app({
    id: 'demo-app-004', company: 'Atlas Health', title: 'Site Reliability Engineer',
    url: 'https://atlashealth.wd5.myworkdayjobs.com/careers/job/sre', status: 'submitted', sort_order: 8400,
    date: '2026-09-17', updated_at: '2026-09-17T11:00:00.000Z',
    jd_snippet: 'Improve platform reliability and on-call health across regulated healthcare workloads.',
    location: 'Remote · US', pay_min: 145000, pay_max: 180000, salary_range: '$145,000 – $180,000',
    scorecard: '3/5', verdict: 'neutral',
  }),
  app({
    id: 'demo-app-005', company: 'Lumen & Loom', title: 'Infrastructure Engineer',
    url: 'https://boards.greenhouse.io/lumenloom/jobs/881203', status: 'submitted', sort_order: 8200,
    date: '2026-09-15', updated_at: '2026-09-15T09:20:00.000Z',
    jd_snippet: 'Terraform, Kubernetes, and a lot of curiosity: help a design-tools startup run its first real platform.',
    location: 'New York, NY · Hybrid', pay_min: 155000, pay_max: 185000, salary_range: '$155,000 – $185,000',
    scorecard: '4/5', verdict: 'lean_yes',
  }),
  app({
    id: 'demo-app-006', company: 'Harborline Freight', title: 'Platform Engineer',
    url: 'https://jobs.lever.co/harborline/platform-engineer', status: 'pending', sort_order: 8000,
    date: '2026-09-05', updated_at: '2026-09-12T10:00:00.000Z',
    jd_snippet: 'Modernize logistics infrastructure: migrate legacy services to containers and build self-serve tooling.',
    location: 'Remote · US', pay_min: 140000, pay_max: 170000, salary_range: '$140,000 – $170,000',
    scorecard: '3/5', verdict: 'neutral',
  }),
  app({
    id: 'demo-app-007', company: 'Quarry Robotics', title: 'Staff DevOps Engineer',
    url: 'https://jobs.ashbyhq.com/quarry/staff-devops', status: 'filled', sort_order: 7800,
    date: '2026-09-23', updated_at: '2026-09-23T18:40:00.000Z',
    jd_snippet: 'Lead build, release, and fleet-update infrastructure for autonomous field robots.',
    location: 'Pittsburgh, PA · Onsite', remote: false, pay_min: 190000, pay_max: 230000, salary_range: '$190,000 – $230,000',
    scorecard: '4/5', verdict: 'research',
  }),
  app({
    id: 'demo-app-008', company: 'Fernwood Bank', title: 'Cloud Security Engineer',
    url: 'https://fernwood.wd1.myworkdayjobs.com/en-US/careers/job/cloud-security', status: 'drafted', sort_order: 7600,
    date: '2026-09-24', updated_at: '2026-09-24T08:10:00.000Z', answers_generated: false,
    jd_snippet: 'Harden AWS landing zones, automate guardrails, and partner with app teams on least-privilege IAM.',
    location: 'Charlotte, NC · Hybrid', remote: false, pay_min: 150000, pay_max: 175000, salary_range: '$150,000 – $175,000',
    scorecard: '3/5', verdict: 'lean_yes',
  }),
  app({
    id: 'demo-app-009', company: 'Tidewater Energy', title: 'Automation Engineer',
    url: 'https://boards.greenhouse.io/tidewater/jobs/550012', status: 'drafted', sort_order: 7400,
    date: '2026-09-24', updated_at: '2026-09-24T07:45:00.000Z', answers_generated: false,
    jd_snippet: 'Python-heavy automation for grid telemetry pipelines and deployment workflows.',
    location: 'Remote · US', pay_min: 130000, pay_max: 155000, salary_range: '$130,000 – $155,000',
    scorecard: '2/5', verdict: 'neutral',
  }),
  app({
    id: 'demo-app-010', company: 'Brightwell Education', title: 'Senior SRE',
    url: 'https://jobs.lever.co/brightwell/senior-sre', status: 'rejected', sort_order: 7200,
    date: '2026-08-18', updated_at: '2026-09-03T12:00:00.000Z', first_response_at: '2026-09-03T12:00:00.000Z',
    jd_snippet: 'Keep a K-12 learning platform fast and available through back-to-school traffic spikes.',
    location: 'Remote · US', pay_min: 150000, pay_max: 175000, salary_range: '$150,000 – $175,000',
    scorecard: '3/5', verdict: 'lean_no',
  }),
  app({
    id: 'demo-app-011', company: 'Copperline Media', title: 'Platform Reliability Engineer',
    url: 'https://jobs.ashbyhq.com/copperline/pre', status: 'retired', sort_order: 7000,
    date: '2026-08-12', updated_at: '2026-09-10T12:00:00.000Z',
    jd_snippet: 'Streaming infrastructure reliability for live events.',
    location: 'Los Angeles, CA · Hybrid', remote: false, pay_min: 140000, pay_max: 165000, salary_range: '$140,000 – $165,000',
    scorecard: '2/5', verdict: 'no',
  }),
  app({
    id: 'demo-app-012', company: 'Sable Aerospace', title: 'Build & Release Engineer',
    url: 'https://sable.wd1.myworkdayjobs.com/careers/job/build-release', status: 'interview', sort_order: 6800,
    date: '2026-08-29', updated_at: '2026-09-16T15:00:00.000Z', first_response_at: '2026-09-06T15:00:00.000Z',
    jd_snippet: 'Own the build farm and release pipeline for flight-software teams.',
    location: 'Denver, CO · Hybrid', remote: false, pay_min: 145000, pay_max: 175000, salary_range: '$145,000 – $175,000',
    scorecard: '4/5', verdict: 'lean_yes',
  }),
];

export const DEMO_INTERVIEW_PREP = {
  questions: [
    {
      question: 'Walk us through a paved-road platform you built. How did you get teams to actually adopt it?',
      type: 'behavioral',
      hint: 'They want adoption strategy, not just architecture — metrics, migration, and developer empathy.',
      answer: 'At Northstar I built golden-path service templates. Adoption went from 3 to 41 services in two quarters because we migrated the first five teams ourselves and published build-time wins weekly.',
    },
    {
      question: 'Our CI takes 40 minutes on main. Where do you start?',
      type: 'technical',
      hint: 'Show a measurement-first approach: profile, cache, parallelize, then cut scope.',
      answer: '',
    },
    {
      question: 'A deploy you approved caused a Sev-1 at 2am. What happens in the first hour and the first week?',
      type: 'situational',
      hint: 'Incident command, rollback-first, blameless follow-up, and the systemic fix.',
      answer: '',
    },
    {
      question: 'Why Northstar, and why platform work now?',
      type: 'motivation',
      hint: 'Tie their mission and scale to where you want to grow.',
      answer: '',
    },
  ],
  updatedAt: DEMO_NOW - 3600_000,
};

export const DEMO_INTERVIEW_PREP_QUARRY = {
  questions: [
    {
      question: 'Our robots take OTA updates in the field over flaky LTE. How would you design a release pipeline that can never brick a unit?',
      type: 'technical',
      hint: 'A/B partitions, staged rollouts, health-gated promotion, and an automatic rollback path.',
      answer: 'Dual-slot images with a watchdog-confirmed boot, a 1% → 10% → 100% ring rollout gated on fleet health metrics, and delta updates signed at build time so a bad package never leaves CI.',
    },
    {
      question: 'Tell us about a time you made a slow build fast. What did you measure first?',
      type: 'behavioral',
      hint: 'Numbers before and after; how you found the real bottleneck.',
      answer: '',
    },
    {
      question: 'A firmware team wants to skip the release train for a "tiny" fix. How do you respond?',
      type: 'situational',
      hint: 'Balance speed with safety; offer a fast lane with guardrails rather than a flat no.',
      answer: '',
    },
    {
      question: 'What draws you from cloud platforms to robotics infrastructure?',
      type: 'motivation',
      hint: 'Connect your platform experience to physical-world stakes.',
      answer: '',
    },
  ],
  updatedAt: DEMO_NOW - 7200_000,
};

export const DEMO_STATE = {
  settings: {
    privacy_consent: true,
    privacy_consent_at: '2026-01-15T12:00:00.000Z',
    gemini_model: 'auto',
    preferred_salary_min: 150000,
    preferred_salary_max: 210000,
    preferred_remote: true,
    work_authorization: 'US Citizen',
    sponsorship: 'No',
    start_date: '2 weeks',
  },
  resume: {
    structured: {
      name: 'Jordan Morgan',
      email: 'jordan.morgan@example.test',
      phone: '(555) 010-0142',
      location: 'Arlington, VA',
      linkedin: 'https://www.linkedin.com/in/jordan-morgan-demo',
      github: 'https://github.com/jordan-morgan-demo',
      portfolio: 'https://jordan-morgan.example.test',
      current_company: 'Northstar Labs',
      current_title: 'Systems Engineer',
      summary: 'Systems engineer focused on cloud platforms, automation, reliability, and developer tooling.',
      years_of_experience: 10,
      skills: ['Cloud Infrastructure', 'Python', 'TypeScript', 'AWS', 'Kubernetes', 'Terraform'],
      experience: [
        {
          title: 'Systems Engineer',
          company: 'Northstar Labs',
          location: 'Arlington, VA',
          start_date: '2022-04',
          end_date: 'Present',
          bullets: [
            'Built cloud automation and internal developer tooling.',
            'Improved deployment reliability across distributed services.',
          ],
        },
        {
          title: 'Platform Engineer',
          company: 'Blue Harbor Software',
          location: 'Washington, DC',
          start_date: '2018-06',
          end_date: '2022-03',
          bullets: [
            'Automated infrastructure operations with Python and Terraform.',
            'Supported production Kubernetes workloads.',
          ],
        },
      ],
      education: [
        {
          degree: 'B.S. Computer Science',
          institution: 'Example State University',
          year: '2018',
        },
      ],
      certifications: ['AWS Certified Solutions Architect'],
      languages: ['English'],
    },
    excerpt: 'Jordan Morgan — Systems Engineer — Cloud infrastructure, automation, Python, TypeScript, AWS, Kubernetes, Terraform.',
    attachment: {
      name: 'jordan-morgan-resume.txt',
      mimeType: 'text/plain',
      source: 'upload',
      updatedAt: '2026-01-15T12:00:00.000Z',
      preview: 'Jordan Morgan — Systems Engineer — Cloud infrastructure, automation, Python, TypeScript, AWS, Kubernetes, Terraform.',
      downloadMode: 'text',
      data: '',
      text: 'Jordan Morgan\nSystems Engineer · Arlington, VA\n\nSUMMARY\nSystems engineer focused on cloud platforms, automation, reliability, and developer tooling.\n\nEXPERIENCE\nNorthstar Labs — Systems Engineer (2022–Present)\n• Built cloud automation and internal developer tooling.\n• Improved deployment reliability across distributed services.\n\nBlue Harbor Software — Platform Engineer (2018–2022)\n• Automated infrastructure operations with Python and Terraform.\n• Supported production Kubernetes workloads.',
    },
  },
  applications: DEMO_APPLICATIONS,
  learnedDefaults: {
    'Are you authorized to work in the United States?': 'Yes',
    'Will you now or in the future require visa sponsorship?': 'No',
    'Are you willing to work remotely?': 'Yes',
    'What is your preferred salary range?': '$160,000 – $200,000',
    'When can you start?': 'Two weeks after accepting an offer',
    'How did you hear about us?': 'Company careers page',
    'Are you open to occasional travel?': 'Yes, up to 10%',
  },
  ignoredLearnedDefaults: {},
  lastAnswers: {
    'Full name': 'Jordan Morgan',
    Email: 'jordan.morgan@example.test',
    'Why are you interested in this role?': 'The role combines cloud reliability, automation, and developer tooling with a product-focused engineering team.',
    'Describe your experience with infrastructure automation.': 'I have built repeatable infrastructure and deployment automation using Python, Terraform, and cloud-native tooling.',
  },
  lastFillReport: {
    filled: 23,
    preserved: 2,
    unresolved: [
      { label: 'Are you open to relocation to Denver?', reason: 'No saved answer — review before submitting' },
      { label: 'Upload a cover letter', reason: 'File fields are left for you' },
    ],
  },
  lastTrackedApplicationId: 'demo-app-007',
  'interview_prep_demo-app-001': DEMO_INTERVIEW_PREP,
  'interview_prep_demo-app-007': DEMO_INTERVIEW_PREP_QUARRY,
};

/** Fixed job-search results so the Search screen can be shown without network. */
export const DEMO_JOBS = [
  { id: 'demo:1', title: 'Senior Platform Engineer', company: 'Kestrel Cloud', location: 'Remote · US', salary: '$170k – $205k', remote: true, url: 'https://boards.greenhouse.io/kestrel/jobs/1', atsLabel: 'Greenhouse', source: 'Remotive', employment_type: 'Full-time', posted: '2026-09-23', tags: ['Kubernetes', 'Go', 'Terraform'], description: 'Build the paved road for 300 engineers: CI/CD, service templates, and golden-path observability.' },
  { id: 'demo:2', title: 'Site Reliability Engineer', company: 'Orchard Payments', location: 'New York, NY · Hybrid', salary: '$160k – $195k', remote: false, url: 'https://jobs.lever.co/orchard/sre', atsLabel: 'Lever', source: 'The Muse', employment_type: 'Full-time', posted: '2026-09-22', tags: ['AWS', 'SLOs', 'On-call'], description: 'Own availability for card processing at 20k TPS with a strong blameless culture.' },
  { id: 'demo:3', title: 'DevOps Engineer', company: 'Glasshouse Health', location: 'Remote · US', salary: '$140k – $165k', remote: true, url: 'https://jobs.ashbyhq.com/glasshouse/devops', atsLabel: 'Ashby', source: 'Jobicy', employment_type: 'Full-time', posted: '2026-09-22', tags: ['Terraform', 'HIPAA', 'GitHub Actions'], description: 'Automate HIPAA-compliant infrastructure for a telehealth platform.' },
  { id: 'demo:4', title: 'Infrastructure Engineer', company: 'Wren Robotics', location: 'Boston, MA', salary: '$155k – $185k', remote: false, url: 'https://boards.greenhouse.io/wren/jobs/4', atsLabel: 'Greenhouse', source: 'Arbeitnow', employment_type: 'Full-time', posted: '2026-09-21', tags: ['Python', 'Bazel', 'Linux'], description: 'Build fleet-update and simulation infrastructure for warehouse robots.' },
  { id: 'demo:5', title: 'Cloud Engineer (Contract)', company: 'Bluebird Civic', location: 'Remote · US', salary: '$85 – $105 / hr', remote: true, url: 'https://jobs.lever.co/bluebird/cloud', atsLabel: 'Lever', source: 'RemoteOK', employment_type: 'Contract', posted: '2026-09-20', tags: ['Azure', 'Bicep'], description: 'Six-month engagement migrating civic services to managed Kubernetes.' },
  { id: 'demo:6', title: 'Staff Platform Engineer', company: 'Tessellate', location: 'Remote · Americas', salary: '$200k – $240k', remote: true, url: 'https://jobs.ashbyhq.com/tessellate/staff-platform', atsLabel: 'Ashby', source: 'Working Nomads', employment_type: 'Full-time', posted: '2026-09-19', tags: ['Kubernetes', 'Rust', 'Platform'], description: 'Set platform direction for a data-infra company; mentor a team of six.' },
];

/** Per-source result counts reported alongside DEMO_JOBS (drives the chip heatmap). */
export const DEMO_SEARCH_SOURCES = [
  { id: 'remotive', label: 'Remotive', ok: true, count: 14 },
  { id: 'weworkremotely', label: 'We Work Remotely', ok: true, count: 12 },
  { id: 'remoteok', label: 'Remote OK', ok: true, count: 11 },
  { id: 'themuse', label: 'The Muse', ok: true, count: 9 },
  { id: 'hn-hiring', label: "HN: Who's Hiring", ok: true, count: 7 },
  { id: 'jobicy', label: 'Jobicy', ok: true, count: 6 },
  { id: 'linkedin', label: 'LinkedIn', ok: true, count: 5 },
  { id: 'workingnomads', label: 'Working Nomads', ok: true, count: 4 },
  { id: 'arbeitnow', label: 'Arbeitnow', ok: true, count: 3 },
  { id: 'hackajob', label: 'Hackajob', ok: true, count: 3 },
  { id: 'remoteco', label: 'remote.co', ok: true, count: 2 },
  { id: 'indeed', label: 'Indeed', ok: true, count: 0 },
];

/** What the active tab reports: a Greenhouse application page for a tracked job. */
export const DEMO_ACTIVE_TAB = {
  url: 'https://boards.greenhouse.io/quarryrobotics/jobs/7781200',
  ats: 'Greenhouse',
  job: {
    company: 'Quarry Robotics',
    title: 'Staff DevOps Engineer',
    url: 'https://boards.greenhouse.io/quarryrobotics/jobs/7781200',
    location: 'Pittsburgh, PA',
    employment_type: 'Full-time',
    remote: false,
    salary_range: '$190,000 – $230,000',
    jd: 'Lead build, release, and fleet-update infrastructure for autonomous field robots.',
  },
};

export async function seedDemoState(page) {
  await page.evaluate(async (state) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(state);
  }, DEMO_STATE);
}
