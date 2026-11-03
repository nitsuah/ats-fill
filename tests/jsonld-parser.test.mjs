import test from 'node:test';
import assert from 'node:assert/strict';

import { parseJobPostingJsonLd } from '../lib/jd-parser.js';

test('parseJobPostingJsonLd extracts a full JobPosting', () => {
  const result = parseJobPostingJsonLd([{
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: 'Staff Software Engineer',
    description: '<p>Build <b>great</b> things &amp; ship</p>',
    datePosted: '2026-05-20',
    employmentType: 'FULL_TIME',
    hiringOrganization: { '@type': 'Organization', name: 'Globex' },
    jobLocation: {
      '@type': 'Place',
      address: { '@type': 'PostalAddress', addressLocality: 'Austin', addressRegion: 'TX', addressCountry: 'US' },
    },
    baseSalary: {
      '@type': 'MonetaryAmount',
      currency: 'USD',
      value: { '@type': 'QuantitativeValue', minValue: 150000, maxValue: 190000, unitText: 'YEAR' },
    },
    url: 'https://globex.com/careers/123',
  }]);

  assert.equal(result.title, 'Staff Software Engineer');
  assert.equal(result.company, 'Globex');
  assert.equal(result.location, 'Austin, TX, US');
  assert.equal(result.employment_type, 'Full-time');
  assert.equal(result.salary_range, '$150,000 - $190,000');
  assert.equal(result.description, 'Build great things & ship');
  assert.equal(result.remote, false);
});

test('parseJobPostingJsonLd finds a posting nested in @graph and detects remote', () => {
  const result = parseJobPostingJsonLd([{
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', name: 'Careers' },
      {
        '@type': 'JobPosting',
        title: 'Remote Designer',
        jobLocationType: 'TELECOMMUTE',
        employmentType: ['CONTRACTOR'],
        hiringOrganization: 'Acme',
        baseSalary: { currency: 'USD', value: { unitText: 'HOUR', minValue: 60 } },
      },
    ],
  }]);

  assert.equal(result.title, 'Remote Designer');
  assert.equal(result.company, 'Acme');
  assert.equal(result.remote, true);
  assert.equal(result.employment_type, 'Contract');
  assert.equal(result.salary_range, '$60/hr');
});

test('parseJobPostingJsonLd returns null when no JobPosting is present', () => {
  assert.equal(parseJobPostingJsonLd([{ '@type': 'Organization', name: 'Globex' }]), null);
  assert.equal(parseJobPostingJsonLd([]), null);
});

test('parseJobPostingJsonLd accepts an @type array in a nested @graph posting', () => {
  const result = parseJobPostingJsonLd([{
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': ['WebPage', 'JobPosting'],
        title: 'Array Type Engineer',
        hiringOrganization: { '@type': 'Organization', name: 'Acme Labs' },
      },
    ],
  }]);

  assert.equal(result.title, 'Array Type Engineer');
  assert.equal(result.company, 'Acme Labs');
});
