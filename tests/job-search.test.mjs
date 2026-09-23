import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import {
  normalizeRemotiveJob,
  normalizeArbeitnowJob,
  normalizeAdzunaJob,
  normalizeUsaJobsJob,
  normalizeMuseJob,
  normalizeRemoteOkJob,
  normalizeJobicyJob,
  normalizeWorkingNomadsJob,
  normalizeReedJob,
  normalizeJoobleJob,
  normalizeHnComment,
  normalizeWwrJob,
  normalizeRemoteCoJob,
  normalizeLinkedInJob,
  normalizeIndeedJob,
  normalizeHackajobJob,
  parseHackajobJsonLd,
  parseLinkedInVoyagerResponse,
  normalizeCustomRssJob,
  buildCustomJobSources,
  dedupeJobs,
  jobMatchesQuery,
  detectAtsLabelFromUrl,
  searchJobs,
  listJobSources,
  resolveActiveSources,
  parseJobPay,
  jobPassesPayFilter,
} from '../lib/job-search.js';

test('normalizeRemotiveJob maps the common schema and strips HTML', () => {
  const job = normalizeRemotiveJob({
    id: 42,
    url: 'https://remotive.com/remote-jobs/software-dev/widget-eng-42',
    title: 'Senior Engineer',
    company_name: 'Widget Co',
    candidate_required_location: 'USA Only',
    salary: '$120k - $150k',
    job_type: 'full_time',
    publication_date: '2026-05-30T10:00:00',
    tags: ['react', 'node'],
    description: '<p>Build <b>things</b>&amp; ship</p>',
  });

  assert.equal(job.id, 'remotive:42');
  assert.equal(job.title, 'Senior Engineer');
  assert.equal(job.company, 'Widget Co');
  assert.equal(job.location, 'USA Only');
  assert.equal(job.salary, '$120k - $150k');
  assert.equal(job.remote, true);
  assert.equal(job.source, 'Remotive');
  assert.deepEqual(job.tags, ['react', 'node']);
  assert.equal(job.description, 'Build things & ship');
});

test('normalizeArbeitnowJob infers remote and reads unix timestamps', () => {
  const job = normalizeArbeitnowJob({
    slug: 'acme-dev',
    company_name: 'Acme',
    title: 'Backend Dev',
    description: 'Cool role',
    remote: true,
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    tags: ['go'],
    job_types: ['full_time'],
    location: 'Berlin',
    created_at: 1748000000,
  });

  assert.equal(job.id, 'arbeitnow:acme-dev');
  assert.equal(job.remote, true);
  assert.equal(job.source, 'Arbeitnow');
  assert.equal(job.atsLabel, 'Greenhouse');
  assert.match(job.posted, /^20\d\d-/);
});

test('normalizeAdzunaJob maps schema, salary range, and employment type', () => {
  const job = normalizeAdzunaJob({
    id: 9,
    title: 'Data Engineer',
    company: { display_name: 'Initech' },
    location: { display_name: 'Remote, US' },
    salary_min: 110000,
    salary_max: 140000,
    contract_time: 'full_time',
    redirect_url: 'https://www.adzuna.com/land/ad/9',
    created: '2026-05-28T00:00:00Z',
    description: 'Pipelines',
  });

  assert.equal(job.id, 'adzuna:9');
  assert.equal(job.company, 'Initech');
  assert.equal(job.source, 'Adzuna');
  assert.equal(job.salary, '$110,000 - $140,000');
  assert.equal(job.employment_type, 'Full-time');
  assert.equal(job.remote, true);
});

test('normalizeUsaJobsJob maps the nested federal-job descriptor', () => {
  const job = normalizeUsaJobsJob({
    MatchedObjectId: 'ABC123',
    MatchedObjectDescriptor: {
      PositionTitle: 'IT Specialist',
      OrganizationName: 'Department of Commerce',
      PositionURI: 'https://www.usajobs.gov/job/123',
      PositionLocationDisplay: 'Washington, DC',
      PositionRemuneration: [{ MinimumRange: '90000', MaximumRange: '120000', RateIntervalCode: 'PA' }],
      PositionSchedule: [{ Name: 'Full-Time' }],
      PublicationStartDate: '2026-05-15',
      UserArea: { Details: { JobSummary: 'Serve the public.' } },
    },
  });

  assert.equal(job.id, 'usajobs:ABC123');
  assert.equal(job.title, 'IT Specialist');
  assert.equal(job.company, 'Department of Commerce');
  assert.equal(job.source, 'USAJOBS');
  assert.equal(job.salary, '$90,000 - $120,000');
  assert.equal(job.employment_type, 'Full-time');
  assert.equal(job.atsLabel, 'USAJOBS');
});

test('USAJOBS source is registered and gated on email + key + headerInjection', () => {
  const sources = listJobSources({});
  assert.ok(sources.find((s) => s.id === 'usajobs'));
  assert.equal(sources.find((s) => s.id === 'usajobs').available, false);

  const withCreds = listJobSources({ usajobs: { email: 'me@example.com', apiKey: 'k', headerInjection: true } });
  assert.equal(withCreds.find((s) => s.id === 'usajobs').available, true);

  const withoutInjection = listJobSources({ usajobs: { email: 'me@example.com', apiKey: 'k' } });
  assert.equal(withoutInjection.find((s) => s.id === 'usajobs').available, false);
});

test('detectAtsLabelFromUrl recognizes known applicant tracking systems', () => {
  assert.equal(detectAtsLabelFromUrl('https://jobs.lever.co/foo/bar'), 'Lever');
  assert.equal(detectAtsLabelFromUrl('https://acme.icims.com/jobs/9'), 'iCIMS');
  assert.equal(detectAtsLabelFromUrl('https://example.com/careers/9'), null);
});

test('jobMatchesQuery requires every token to appear somewhere', () => {
  const job = normalizeRemotiveJob({ title: 'React Engineer', company_name: 'Globex', tags: ['frontend'] });
  assert.equal(jobMatchesQuery(job, 'react'), true);
  assert.equal(jobMatchesQuery(job, 'react frontend'), true);
  assert.equal(jobMatchesQuery(job, 'react rust'), false);
  assert.equal(jobMatchesQuery(job, ''), true);
});

test('dedupeJobs removes same company+title and same url duplicates', () => {
  const jobs = [
    { title: 'Engineer', company: 'Acme', url: 'https://a.com/1' },
    { title: 'engineer', company: 'ACME', url: 'https://b.com/2' }, // dup by company+title
    { title: 'Designer', company: 'Acme', url: 'https://a.com/1' }, // dup by url
    { title: 'Designer', company: 'Globex', url: 'https://c.com/3' },
  ];
  const out = dedupeJobs(jobs);
  assert.equal(out.length, 2);
  assert.equal(out[0].title, 'Engineer');
  assert.equal(out[1].company, 'Globex');
});

test('searchJobs merges sources, dedupes, sorts by recency, and reports source status', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('remotive.com')) {
      return {
        ok: true,
        json: async () => ({ jobs: [
          { id: 1, url: 'https://remotive.com/1', title: 'Platform Engineer', company_name: 'Acme', publication_date: '2026-05-20T00:00:00' },
        ] }),
      };
    }
    return {
      ok: true,
      json: async () => ({ data: [
        { slug: 'acme-plat', url: 'https://x.com/2', title: 'Platform Engineer', company_name: 'Acme', remote: true, created_at: 1700000000, location: 'Remote' },
        { slug: 'glx-fe', url: 'https://x.com/3', title: 'Frontend Engineer', company_name: 'Globex', remote: true, created_at: 1780272000, location: 'Remote' },
      ] }),
    };
  };

  const { jobs, sources } = await searchJobs('engineer', { fetchImpl });

  // Acme Platform Engineer appears in both sources → deduped to one.
  assert.equal(jobs.length, 2);
  // Newest (Globex, created_at 1780272000) sorts first.
  assert.equal(jobs[0].company, 'Globex');
  assert.equal(sources.find((s) => s.name === 'Remotive').ok, true);
  assert.equal(sources.find((s) => s.name === 'Arbeitnow').count, 2);
});

test('searchJobs includes Adzuna only when credentials are supplied', async () => {
  let adzunaCalled = false;
  const fetchImpl = async (url) => {
    if (url.includes('api.adzuna.com')) {
      adzunaCalled = true;
      return { ok: true, json: async () => ({ results: [
        { id: 7, title: 'ML Engineer', company: { display_name: 'Initech' }, location: { display_name: 'Remote' }, redirect_url: 'https://adzuna/7', created: '2026-05-29T00:00:00Z' },
      ] }) };
    }
    if (url.includes('remotive.com')) return { ok: true, json: async () => ({ jobs: [] }) };
    return { ok: true, json: async () => ({ data: [] }) };
  };

  const withoutCreds = await searchJobs('engineer', { fetchImpl });
  assert.equal(adzunaCalled, false);
  assert.equal(withoutCreds.sources.some((s) => s.name === 'Adzuna'), false);

  const withCreds = await searchJobs('engineer', {
    fetchImpl,
    config: { adzuna: { appId: 'id', appKey: 'key', country: 'us' } },
  });
  assert.equal(adzunaCalled, true);
  assert.equal(withCreds.sources.find((s) => s.name === 'Adzuna').ok, true);
  assert.ok(withCreds.jobs.some((j) => j.source === 'Adzuna'));
});

test('listJobSources reports availability based on supplied credentials', () => {
  const noKeys = listJobSources({});
  assert.equal(noKeys.find((s) => s.id === 'remotive').available, true);
  assert.equal(noKeys.find((s) => s.id === 'adzuna').available, false);

  const withKeys = listJobSources({ adzuna: { appId: 'a', appKey: 'b' } });
  assert.equal(withKeys.find((s) => s.id === 'adzuna').available, true);
});

test('resolveActiveSources honors the sources allow-list and availability', () => {
  // Allow-list narrows to one source.
  const only = resolveActiveSources({}, ['remotive']).map((s) => s.id);
  assert.deepEqual(only, ['remotive']);

  // Unavailable sources are dropped even if explicitly listed.
  const dropped = resolveActiveSources({}, ['adzuna', 'arbeitnow']).map((s) => s.id);
  assert.deepEqual(dropped, ['arbeitnow']);

  // No allow-list → every available (keyless) source.
  const all = resolveActiveSources({}).map((s) => s.id);
    assert.deepEqual(all, ['remotive', 'arbeitnow', 'themuse', 'remoteok', 'jobicy', 'workingnomads', 'hn-hiring', 'weworkremotely', 'remoteco', 'indeed', 'hackajob']);
});

test('resolveActiveSources allows session sources in explicit selection', () => {
  // Session source (linkedin) should be included when explicitly selected
  // even without sessionActive set - the run function handles detection.
  const selected = resolveActiveSources({}, ['linkedin', 'remotive']);
  assert.ok(selected.find((s) => s.id === 'linkedin'), 'linkedin included when explicitly requested');
  assert.ok(selected.find((s) => s.id === 'remotive'), 'remotive included when explicitly requested');

  // Non-session source (adzuna) should still be gated on availability
  const gatedOut = resolveActiveSources({}, ['adzuna', 'linkedin']);
  assert.ok(gatedOut.find((s) => s.id === 'linkedin'), 'linkedin bypasses available()');
  assert.equal(gatedOut.find((s) => s.id === 'adzuna'), undefined, 'adzuna still gated on api key');

  // No allow-list should still respect sessionActive
  const noSession = resolveActiveSources({});
  assert.equal(noSession.find((s) => s.id === 'linkedin'), undefined, 'linkedin excluded without allow-list when no sessionActive');
});



test('normalizeMuseJob maps The Muse shape and strips HTML', () => {
  const job = normalizeMuseJob({
    id: 55,
    name: 'Product Designer',
    company: { name: 'Globex' },
    locations: [{ name: 'New York, NY' }],
    categories: [{ name: 'Design and UX' }],
    publication_date: '2026-05-22T00:00:00Z',
    refs: { landing_page: 'https://www.themuse.com/jobs/globex/product-designer' },
    contents: '<p>Design <b>things</b></p>',
  });
  assert.equal(job.id, 'themuse:55');
  assert.equal(job.company, 'Globex');
  assert.equal(job.source, 'The Muse');
  assert.equal(job.location, 'New York, NY');
  assert.deepEqual(job.tags, ['Design and UX']);
  assert.equal(job.description, 'Design things');
});

test('searchJobs only queries the selected sources', async () => {
  const hits = [];
  const fetchImpl = async (url) => {
    if (url.includes('remotive.com')) { hits.push('remotive'); return { ok: true, json: async () => ({ jobs: [] }) }; }
    if (url.includes('arbeitnow.com')) { hits.push('arbeitnow'); return { ok: true, json: async () => ({ data: [] }) }; }
    return { ok: true, json: async () => ({}) };
  };
  await searchJobs('dev', { fetchImpl, sources: ['arbeitnow'] });
  assert.deepEqual(hits, ['arbeitnow']);
});

test('parseJobPay reads ranges, k-suffixes, and hourly rates', () => {
  assert.deepEqual(parseJobPay('$130,000 - $176,000'), { min: 130000, max: 176000, hourly: false });
  assert.deepEqual(parseJobPay('$120k'), { min: 120000, max: 120000, hourly: false });
  assert.equal(parseJobPay('$50/hr').hourly, true);
  assert.equal(parseJobPay(''), null);
  assert.equal(parseJobPay('competitive'), null);
});

test('jobPassesPayFilter overlaps ranges and keeps unknown-salary jobs', () => {
  const annual = { enabled: true, mode: 'annual', min: 100, max: 200 }; // $100k–$200k
  assert.equal(jobPassesPayFilter({ salary: '$130,000 - $176,000' }, annual), true);
  assert.equal(jobPassesPayFilter({ salary: '$60,000' }, annual), false);
  assert.equal(jobPassesPayFilter({ salary: '' }, annual), true); // unknown → keep
  assert.equal(jobPassesPayFilter({ salary: '$60,000' }, { enabled: false }), true); // disabled

  // Hourly mode converts an hourly posting and compares in $/hr.
  const hourly = { enabled: true, mode: 'hourly', min: 40, max: 80 };
  assert.equal(jobPassesPayFilter({ salary: '$50/hr' }, hourly), true);
  assert.equal(jobPassesPayFilter({ salary: '$20/hr' }, hourly), false);
});

test('searchJobs throws only when every source fails', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  // Only include sources that can actually fail (not the graceful-return ones)
  await assert.rejects(
    () => searchJobs('engineer', { fetchImpl, sources: ['remotive', 'arbeitnow', 'themuse'] }),
    /unavailable/i
  );
});

test('normalizeRemoteOkJob maps the RemoteOK shape, skips header row', () => {
  const job = normalizeRemoteOkJob({
    id: 99,
    position: 'DevOps Engineer',
    company: 'Stackio',
    url: 'https://remoteok.com/l/99',
    location: 'Worldwide',
    description: 'Deploy all things',
    tags: ['devops', 'kubernetes'],
    epoch: 1748000000,
    salary_min: 100000,
    salary_max: 150000,
    currency: 'USD',
  });

  assert.equal(job.id, 'remoteok:99');
  assert.equal(job.title, 'DevOps Engineer');
  assert.equal(job.company, 'Stackio');
  assert.equal(job.source, 'Remote OK');
  assert.equal(job.remote, true);
  assert.equal(job.salary, '$100,000 - $150,000');
  assert.match(job.posted, /^20\d\d-/);
  assert.deepEqual(job.tags, ['devops', 'kubernetes']);
});

test('normalizeJobicyJob maps Jobicy shape with salary and geo', () => {
  const job = normalizeJobicyJob({
    id: 42,
    url: 'https://jobicy.com/jobs/42',
    jobTitle: 'ML Engineer',
    companyName: 'DataCo',
    jobIndustry: ['Data Science'],
    jobType: ['full_time'],
    jobGeo: 'USA',
    jobExcerpt: 'Build models',
    pubDate: '2026-05-28 10:00:00',
    annualSalaryMin: 120000,
    annualSalaryMax: 160000,
    salaryCurrency: 'USD',
  });

  assert.equal(job.id, 'jobicy:42');
  assert.equal(job.title, 'ML Engineer');
  assert.equal(job.company, 'DataCo');
  assert.equal(job.source, 'Jobicy');
  assert.equal(job.remote, true);
  assert.equal(job.salary, '$120,000 - $160,000');
  assert.equal(job.location, 'USA');
  assert.deepEqual(job.tags, ['Data Science']);
});

test('normalizeWorkingNomadsJob maps Working Nomads shape', () => {
  const job = normalizeWorkingNomadsJob({
    id: 77,
    title: 'Frontend Developer',
    company_name: 'NomadCorp',
    url: 'https://workingnomads.com/jobs/77',
    location: 'Remote',
    salary: '$80k - $110k',
    pub_date: '2026-05-10T00:00:00Z',
    description: 'Build UIs',
    tags: ['react', 'typescript'],
  });

  assert.equal(job.id, 'workingnomads:77');
  assert.equal(job.title, 'Frontend Developer');
  assert.equal(job.company, 'NomadCorp');
  assert.equal(job.source, 'Working Nomads');
  assert.equal(job.remote, true);
  assert.equal(job.salary, '$80k - $110k');
  assert.deepEqual(job.tags, ['react', 'typescript']);
});

test('normalizeReedJob maps Reed shape with GBP salary and employment type', () => {
  const job = normalizeReedJob({
    jobId: 123,
    jobTitle: 'Software Engineer',
    employerName: 'Brit Tech Ltd',
    locationName: 'London',
    minimumSalary: 60000,
    maximumSalary: 80000,
    fullTime: true,
    jobUrl: 'https://www.reed.co.uk/jobs/software-engineer-123',
    date: '2026-05-20T00:00:00Z',
    jobDescription: 'Build great software',
  });

  assert.equal(job.id, 'reed:123');
  assert.equal(job.title, 'Software Engineer');
  assert.equal(job.company, 'Brit Tech Ltd');
  assert.equal(job.source, 'Reed');
  assert.equal(job.salary, '£60,000 - £80,000');
  assert.equal(job.employment_type, 'Full-time');
  assert.equal(job.location, 'London');
});

test('normalizeJoobleJob maps Jooble shape', () => {
  const job = normalizeJoobleJob({
    title: 'Backend Engineer',
    company: 'GlobalCorp',
    location: 'Remote',
    salary: '$130,000',
    snippet: 'Write APIs',
    type: 'Full-time',
    link: 'https://jooble.org/desc/1',
    updated: '2026-05-25T00:00:00+00:00',
  });

  assert.equal(job.title, 'Backend Engineer');
  assert.equal(job.company, 'GlobalCorp');
  assert.equal(job.source, 'Jooble');
  assert.equal(job.remote, true);
  assert.equal(job.salary, '$130,000');
  assert.equal(job.employment_type, 'Full-time');
});

test('new keyless sources are registered and available by default', () => {
  const sources = listJobSources({});
  const ids = sources.map((s) => s.id);
  assert.ok(ids.includes('remoteok'), 'remoteok missing');
  assert.ok(ids.includes('jobicy'), 'jobicy missing');
  assert.ok(ids.includes('workingnomads'), 'workingnomads missing');
  assert.equal(sources.find((s) => s.id === 'remoteok').available, true);
  assert.equal(sources.find((s) => s.id === 'jobicy').available, true);
  assert.equal(sources.find((s) => s.id === 'workingnomads').available, true);
});

test('Reed source is registered and gated on API key', () => {
  const sources = listJobSources({});
  assert.ok(sources.find((s) => s.id === 'reed'));
  assert.equal(sources.find((s) => s.id === 'reed').available, false);

  const withKey = listJobSources({ reed: { apiKey: 'my-reed-key' } });
  assert.equal(withKey.find((s) => s.id === 'reed').available, true);
});

test('Jooble source is registered and gated on API key', () => {
  const sources = listJobSources({});
  assert.ok(sources.find((s) => s.id === 'jooble'));
  assert.equal(sources.find((s) => s.id === 'jooble').available, false);

  const withKey = listJobSources({ jooble: { apiKey: 'my-jooble-key' } });
  assert.equal(withKey.find((s) => s.id === 'jooble').available, true);
});

test('jobPassesPayFilter hides unknown-salary jobs when hideUnknown is set', () => {
  const filter = { enabled: true, mode: 'annual', min: 50, max: 200, hideUnknown: true };
  assert.equal(jobPassesPayFilter({ salary: '' }, filter), false, 'empty salary should be hidden');
  assert.equal(jobPassesPayFilter({ salary: 'competitive' }, filter), false, 'unparseable salary should be hidden');
  assert.equal(jobPassesPayFilter({ salary: '$100,000' }, filter), true, 'parseable in-range salary should pass');

  // Without hideUnknown, unknown salary still passes.
  const filterNoHide = { enabled: true, mode: 'annual', min: 50, max: 200, hideUnknown: false };
  assert.equal(jobPassesPayFilter({ salary: '' }, filterNoHide), true);
});

// ── New source tests ─────────────────────────────────────────────────────────

test('normalizeHnComment — pipe-delimited format maps correctly', () => {
  const raw = {
    objectID: '12345',
    comment_text: 'Acme Corp | Senior Engineer | Remote | Full-time | $120k-$150k',
    created_at: '2026-05-30T10:00:00Z',
  };
  const job = normalizeHnComment(raw);
  assert.equal(job.id, 'hn:12345');
  assert.equal(job.company, 'Acme Corp');
  assert.equal(job.title, 'Senior Engineer');
  assert.equal(job.location, 'Remote');
  assert.equal(job.remote, true);
  assert.equal(job.url, 'https://news.ycombinator.com/item?id=12345');
  assert.equal(job.source, "HN: Who's Hiring");
  assert.match(job.posted, /^20\d\d-/);
});

test('normalizeHnComment — colon format fallback', () => {
  const raw = {
    objectID: '67890',
    comment_text: 'WidgetCo: Looking for a Backend Developer. Must know Go.',
    created_at: '2026-06-01T08:00:00Z',
  };
  const job = normalizeHnComment(raw);
  assert.equal(job.id, 'hn:67890');
  assert.equal(job.company, 'WidgetCo');
  assert.ok(job.title.toLowerCase().includes('looking') || job.title.toLowerCase().includes('backend'));
  assert.equal(job.source, "HN: Who's Hiring");
});

test('normalizeWwrJob — title parsing splits "Category: Role at Company" correctly', () => {
  const mockItem = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Design & UX: Product Designer at Figma' },
        link: { textContent: 'https://weworkremotely.com/jobs/1' },
        guid: null,
        pubDate: { textContent: 'Mon, 02 Jun 2026 10:00:00 +0000' },
        description: { textContent: 'Work on design systems' },
      };
      return data[sel] || null;
    },
  };
  const job = normalizeWwrJob(mockItem);
  assert.equal(job.title, 'Product Designer');
  assert.equal(job.company, 'Figma');
  assert.equal(job.remote, true);
  assert.equal(job.source, 'We Work Remotely');
  assert.equal(job.url, 'https://weworkremotely.com/jobs/1');
});

test('normalizeRemoteCoJob — title parsing splits "Role at Company"', () => {
  const mockItem = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Senior Backend Engineer at Stripe' },
        link: { textContent: 'https://remote.co/job/123' },
        guid: null,
        pubDate: { textContent: 'Mon, 02 Jun 2026 10:00:00 +0000' },
        description: { textContent: 'Work on payments infrastructure' },
      };
      return data[sel] || null;
    },
  };
  const job = normalizeRemoteCoJob(mockItem);
  assert.equal(job.title, 'Senior Backend Engineer');
  assert.equal(job.company, 'Stripe');
  assert.equal(job.remote, true);
  assert.equal(job.source, 'remote.co');
});

test('normalizeCustomRssJob splits "Title at Company" and falls back to the source label', () => {
  const withCompany = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Program Analyst at Tennessee Department of Labor' },
        link: { textContent: 'https://jobs4tn.gov/jobs/1' },
        guid: null,
        pubDate: { textContent: 'Mon, 02 Jun 2026 10:00:00 +0000' },
        description: { textContent: 'Remote-eligible state government role.' },
      };
      return data[sel] || null;
    },
  };
  const job = normalizeCustomRssJob(withCompany, { id: 'custom-jobs4tn', label: 'JOBS4TN' });
  assert.equal(job.title, 'Program Analyst');
  assert.equal(job.company, 'Tennessee Department of Labor');
  assert.equal(job.remote, true);
  assert.equal(job.source, 'JOBS4TN');
  assert.equal(job.url, 'https://jobs4tn.gov/jobs/1');
  assert.equal(job.id, 'custom-jobs4tn:https://jobs4tn.gov/jobs/1');

  const withoutCompany = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Warehouse Associate' },
        link: { textContent: 'https://jobs4tn.gov/jobs/2' },
        guid: null,
        pubDate: { textContent: '' },
        description: { textContent: 'On-site, Nashville TN.' },
      };
      return data[sel] || null;
    },
  };
  const job2 = normalizeCustomRssJob(withoutCompany, { id: 'custom-jobs4tn', label: 'JOBS4TN' });
  assert.equal(job2.title, 'Warehouse Associate');
  assert.equal(job2.company, 'JOBS4TN');
  assert.equal(job2.remote, false);
});

test('buildCustomJobSources registers user-configured RSS sources as run-able entries', () => {
  const entries = buildCustomJobSources([
    { id: 'custom-jobs4tn', label: 'JOBS4TN', url: 'https://jobs4tn.gov/rss' },
    { label: '', url: '' }, // dropped — no url
  ]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'custom-jobs4tn');
  assert.equal(entries[0].label, 'JOBS4TN');
  assert.equal(entries[0].keyless, true);
  assert.equal(entries[0].custom, true);
  assert.equal(typeof entries[0].run, 'function');
});

test('buildCustomJobSources derives a stable id from the label when none is given', () => {
  const entries = buildCustomJobSources([{ label: 'JOBS4TN', url: 'https://jobs4tn.gov/rss' }]);
  assert.match(entries[0].id, /^custom-jobs4tn-/);

  const again = buildCustomJobSources([{ label: 'JOBS4TN', url: 'https://jobs4tn.gov/rss' }]);
  assert.equal(again[0].id, entries[0].id, 'the derived id is stable across calls for the same input');
});

test('buildCustomJobSources gives same-label sources distinct ids when their URLs differ', () => {
  const entries = buildCustomJobSources([
    { label: 'Jobs', url: 'https://a.example/rss' },
    { label: 'Jobs', url: 'https://b.example/rss' },
  ]);
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].id, entries[1].id, 'same-label sources with different URLs must not collide');
  assert.match(entries[0].id, /^custom-jobs-/);
  assert.match(entries[1].id, /^custom-jobs-/);
});

test('buildCustomJobSources drops non-https custom source URLs', () => {
  const entries = buildCustomJobSources([
    { id: 'custom-insecure', label: 'Insecure', url: 'http://insecure.example/rss' },
    { id: 'custom-secure', label: 'Secure', url: 'https://secure.example/rss' },
    { id: 'custom-bogus', label: 'Bogus', url: 'not a url' },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ['custom-secure']);
});

test('listJobSources and resolveActiveSources include custom sources from config', () => {
  const config = { customSources: [{ id: 'custom-jobs4tn', label: 'JOBS4TN', url: 'https://jobs4tn.gov/rss' }] };

  const sources = listJobSources(config);
  const custom = sources.find((s) => s.id === 'custom-jobs4tn');
  assert.ok(custom, 'custom source is listed');
  assert.equal(custom.available, true);
  assert.equal(custom.custom, true);

  const active = resolveActiveSources(config).map((s) => s.id);
  assert.ok(active.includes('custom-jobs4tn'));

  // Without customSources in config, nothing custom appears.
  assert.equal(listJobSources({}).some((s) => s.custom), false);
});

test('searchJobs fetches and normalizes results from a custom RSS source', async () => {
  const rssXml = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Program Analyst at Tennessee Department of Labor</title>
      <link>https://jobs4tn.gov/jobs/1</link>
      <pubDate>Mon, 02 Jun 2026 10:00:00 +0000</pubDate>
      <description>Remote-eligible.</description>
    </item>
  </channel></rss>`;
  const fetchImpl = async (url) => {
    if (String(url).includes('jobs4tn.gov')) {
      return { ok: true, headers: { get: () => null }, text: async () => rssXml };
    }
    return { ok: true, json: async () => ({ jobs: [], data: [] }) };
  };
  const config = { customSources: [{ id: 'custom-jobs4tn', label: 'JOBS4TN', url: 'https://jobs4tn.gov/rss' }] };

  // fetchCustomRssSource parses the RSS body with DOMParser, which Node doesn't
  // provide natively — install jsdom's implementation for this test only.
  const originalDomParser = globalThis.DOMParser;
  globalThis.DOMParser = new JSDOM().window.DOMParser;
  try {
    const { jobs, sources } = await searchJobs('analyst', { fetchImpl, config, sources: ['custom-jobs4tn'] });
    assert.equal(sources.length, 1);
    assert.equal(sources[0].ok, true);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].source, 'JOBS4TN');
    assert.equal(jobs[0].company, 'Tennessee Department of Labor');
  } finally {
    if (originalDomParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = originalDomParser;
  }
});

test('normalizeLinkedInJob — maps entityUrn to id and url, uses companyMap', () => {
  const raw = {
    entityUrn: 'urn:li:fsd_jobPosting:9876543',
    title: 'Staff Engineer',
    formattedLocation: 'San Francisco, CA',
    workRemoteAllowed: true,
    listedAt: 1748736000000,
    description: { text: 'Build scalable systems.' },
    companyDetails: { company: 'urn:li:fs_miniCompany:42' },
  };
  const companyMap = { 'urn:li:fs_miniCompany:42': 'Acme Corp' };
  const job = normalizeLinkedInJob(raw, companyMap);
  assert.equal(job.id, 'linkedin:9876543');
  assert.equal(job.url, 'https://www.linkedin.com/jobs/view/9876543/');
  assert.equal(job.company, 'Acme Corp');
  assert.equal(job.title, 'Staff Engineer');
  assert.equal(job.remote, true);
  assert.equal(job.atsLabel, 'LinkedIn');
  assert.equal(job.source, 'LinkedIn');
  assert.match(job.posted, /^20\d\d-/);
});

test('parseLinkedInVoyagerResponse — builds companyMap from included, returns job array', () => {
  const data = {
    included: [
      {
        $type: 'com.linkedin.voyager.dash.organization.Company',
        entityUrn: 'urn:li:fs_miniCompany:99',
        name: 'TechCorp',
      },
      {
        $type: 'com.linkedin.voyager.dash.jobs.JobPosting',
        entityUrn: 'urn:li:fsd_jobPosting:111',
        title: 'Frontend Developer',
        formattedLocation: 'Remote',
        workRemoteAllowed: true,
        listedAt: 1748736000000,
        description: { text: 'Build UIs' },
        companyDetails: { company: 'urn:li:fs_miniCompany:99' },
      },
    ],
  };
  const jobs = parseLinkedInVoyagerResponse(data);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'linkedin:111');
  assert.equal(jobs[0].company, 'TechCorp');
  assert.equal(jobs[0].title, 'Frontend Developer');
  assert.equal(jobs[0].source, 'LinkedIn');
});

test('listJobSources — linkedin source present, session-gated on sessionActive', () => {
  const noSession = listJobSources({});
  const linkedin = noSession.find((s) => s.id === 'linkedin');
  assert.ok(linkedin, 'linkedin source should be present');
  assert.equal(linkedin.available, false);
  assert.equal(linkedin.session, true);
  assert.equal(linkedin.keyless, false);

  const withSession = listJobSources({ linkedin: { sessionActive: true } });
  assert.equal(withSession.find((s) => s.id === 'linkedin').available, true);
});

test('listJobSources — hn-hiring, weworkremotely, remoteco present and available by default', () => {
  const sources = listJobSources({});
  const hn = sources.find((s) => s.id === 'hn-hiring');
  const wwr = sources.find((s) => s.id === 'weworkremotely');
  const rc = sources.find((s) => s.id === 'remoteco');
  assert.ok(hn, 'hn-hiring should be present');
  assert.ok(wwr, 'weworkremotely should be present');
  assert.ok(rc, 'remoteco should be present');
  assert.equal(hn.available, true);
  assert.equal(wwr.available, true);
  assert.equal(rc.available, true);
  assert.equal(hn.keyless, true);
  assert.equal(wwr.keyless, true);
  assert.equal(rc.keyless, true);
});

test('searchJobs includes Remote OK, Jobicy, and Working Nomads as default active sources', async () => {
  const queried = [];
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('remoteok.com')) { queried.push('remoteok'); return { ok: true, json: async () => ([{ legal: true }]) }; }
    if (url.includes('jobicy.com')) { queried.push('jobicy'); return { ok: true, json: async () => ({ jobs: [] }) }; }
    if (url.includes('workingnomads.com')) { queried.push('workingnomads'); return { ok: true, json: async () => ([]) }; }
    if (url.includes('remotive.com')) return { ok: true, json: async () => ({ jobs: [] }) };
    if (url.includes('arbeitnow.com')) return { ok: true, json: async () => ({ data: [] }) };
    if (url.includes('themuse.com')) return { ok: true, json: async () => ({ results: [] }) };
    return { ok: true, json: async () => ({}) };
  };

  await searchJobs('dev', { fetchImpl });
  assert.ok(queried.includes('remoteok'), 'Remote OK not queried');
  assert.ok(queried.includes('jobicy'), 'Jobicy not queried');
  assert.ok(queried.includes('workingnomads'), 'Working Nomads not queried');
});

test('normalizeIndeedJob normalizes RSS item to standard shape', () => {
  const rssItem = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Senior Software Engineer' },
        link: { textContent: 'https://www.indeed.com/viewjob?jk=abc123' },
        pubDate: { textContent: 'Mon, 27 Jun 2026 10:00:00 GMT' },
        description: { textContent: 'Role at Acme Corp<br/><b>Location:</b> San Francisco, CA<br/><b>Salary:</b> $150,000 - $180,000 a year<br/>Remote: Yes' },
        guid: { textContent: 'abc123' },
      };
      return data[sel] || null;
    },
  };
  const job = normalizeIndeedJob(rssItem);
  assert.equal(job.title, 'Senior Software Engineer');
  assert.equal(job.company, 'Acme Corp');
  assert.equal(job.location, 'San Francisco, CA');
  assert.equal(job.remote, true);
  assert.equal(job.salary_min, 150000);
  assert.equal(job.salary_max, 180000);
  assert.equal(job.salary_interval, 'yearly');
  assert.equal(job.url, 'https://www.indeed.com/viewjob?jk=abc123');
  assert.equal(job.source, 'Indeed');
  assert.ok(job.id.startsWith('indeed:'));
});

test('normalizeIndeedJob handles missing salary and remote', () => {
  const rssItem = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Junior Dev' },
        link: { textContent: 'https://www.indeed.com/viewjob?jk=xyz789' },
        pubDate: { textContent: 'Mon, 27 Jun 2026 10:00:00 GMT' },
        description: { textContent: '<b>Company:</b> Beta Inc<br/><b>Location:</b> Austin, TX<br/>No salary listed' },
        guid: { textContent: 'xyz789' },
      };
      return data[sel] || null;
    },
  };
  const job = normalizeIndeedJob(rssItem);
  assert.equal(job.title, 'Junior Dev');
  assert.equal(job.company, 'Beta Inc');
  assert.equal(job.location, 'Austin, TX');
  assert.equal(job.remote, false);
  assert.equal(job.salary_min, undefined);
  assert.equal(job.salary_max, undefined);
  assert.equal(job.salary_interval, 'yearly');
});

test('normalizeIndeedJob handles HTML entities and malformed data', () => {
  const rssItem = {
    querySelector: (sel) => {
      const data = {
        title: { textContent: 'Engineer & Designer' },
        link: { textContent: 'https://www.indeed.com/viewjob?jk=ent123' },
        pubDate: { textContent: 'Mon, 27 Jun 2026 10:00:00 GMT' },
        description: { textContent: '<b>Company:</b> Test & Co<br/><b>Location:</b> New York, NY<br/><b>Salary:</b> $50/hr<br/>Remote option' },
        guid: { textContent: 'ent123' },
      };
      return data[sel] || null;
    },
  };
  const job = normalizeIndeedJob(rssItem);
  assert.equal(job.title, 'Engineer & Designer');
  assert.equal(job.company, 'Test & Co');
  assert.equal(job.location, 'New York, NY');
  assert.equal(job.remote, true);
  assert.equal(job.salary_min, 50);
  assert.equal(job.salary_max, 50);
  assert.equal(job.salary_interval, 'hourly');
});

test('searchJobs includes Indeed as default active source', async () => {
  const queried = [];
  const fetchImpl = async (url, opts = {}) => {
    if (url.includes('indeed.com/rss')) { queried.push('indeed'); return { ok: true, text: async () => `<?xml version="1.0"?><rss><channel><item><title>Test</title><link>https://indeed.com/viewjob?jk=1</link><pubDate>Mon, 27 Jun 2026 10:00:00 GMT</pubDate><description><b>Company:</b> Test<br/><b>Location:</b> NYC</description><guid>1</guid></item></channel></rss>` }; }
    if (url.includes('remotive.com')) return { ok: true, json: async () => ({ jobs: [] }) };
    if (url.includes('arbeitnow.com')) return { ok: true, json: async () => ({ data: [] }) };
    if (url.includes('themuse.com')) return { ok: true, json: async () => ({ results: [] }) };
    return { ok: true, json: async () => ({}) };
  };

  await searchJobs('dev', { fetchImpl });
  assert.ok(queried.includes('indeed'), 'Indeed not queried');
});

test('normalizeHackajobJob maps JSON-LD JobPosting to common schema', () => {
  const job = normalizeHackajobJob({
    '@type': 'JobPosting',
    title: 'Senior Engineer, Platform Services',
    description: '<p>Build <b>great</b> things &amp; ship</p>',
    url: 'https://hackajob.com/job/abc123-senior-engineer',
    identifier: { '@type': 'PropertyValue', name: 'hackajob', value: 'abc123' },
    datePosted: '2026-09-01T16:07:03Z',
    employmentType: 'FULL_TIME',
    jobLocationType: 'TELECOMMUTE',
    hiringOrganization: { '@type': 'Organization', name: 'Stord' },
    applicantLocationRequirements: { '@type': 'Country', name: 'United States' },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', minValue: 140000, maxValue: 190000, unitText: 'YEAR' },
    },
    skills: ['Site Reliability Engineer', 'Product Engineer'],
  });

  assert.equal(job.id, 'hackajob:abc123');
  assert.equal(job.title, 'Senior Engineer, Platform Services');
  assert.equal(job.company, 'Stord');
  assert.equal(job.location, 'United States');
  assert.equal(job.remote, true);
  assert.equal(job.source, 'Hackajob');
  assert.equal(job.employment_type, 'Full-time');
  assert.equal(job.salary, '$140k - $190k');
  assert.equal(job.salary_min, 140000);
  assert.equal(job.salary_max, 190000);
  assert.equal(job.salary_interval, 'yearly');
  assert.equal(job.posted, '2026-09-01T16:07:03.000Z');
  assert.deepEqual(job.tags, ['Site Reliability Engineer', 'Product Engineer']);
  assert.equal(job.description, 'Build great things & ship');
});

test('normalizeHackajobJob handles hourly salary and missing location', () => {
  const job = normalizeHackajobJob({
    title: 'Contract Designer',
    description: 'Remote contract role',
    url: 'https://hackajob.com/job/xyz-contract-designer',
    identifier: { value: 'xyz' },
    employmentType: 'CONTRACTOR',
    baseSalary: {
      currency: 'USD',
      value: { minValue: 60, maxValue: 80, unitText: 'HOUR' },
    },
  });

  assert.equal(job.remote, true);
  assert.equal(job.employment_type, 'Contract');
  assert.equal(job.salary, '$60 - $80/hr');
  assert.equal(job.salary_interval, 'hourly');
  assert.equal(job.location, 'Remote');
});

test('parseHackajobJsonLd extracts JobPosting from detail page HTML', () => {
  const html = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Acme"}}</script></head></html>`;
  const parsed = parseHackajobJsonLd(html);
  assert.ok(parsed);
  assert.equal(parsed.title, 'Engineer');
  assert.equal(parsed.hiringOrganization.name, 'Acme');
});

test('parseHackajobJsonLd returns null for non-JobPosting or malformed HTML', () => {
  assert.equal(parseHackajobJsonLd('<html><body>no json</body></html>'), null);
  assert.equal(parseHackajobJsonLd('<script type="application/ld+json">{"@type":"Organization"}</script>'), null);
  assert.equal(parseHackajobJsonLd('<script type="application/ld+json">not json</script>'), null);
});

test('Hackajob source is registered and available by default', () => {
  const sources = listJobSources({});
  const hackajob = sources.find((s) => s.id === 'hackajob');
  assert.ok(hackajob, 'Hackajob source not registered');
  assert.equal(hackajob.keyless, true);
  assert.equal(hackajob.available, true);
});
