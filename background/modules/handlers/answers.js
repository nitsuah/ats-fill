/**
 * background/modules/handlers/answers.js - Deterministic + AI answer generation
 * Extracted from service-worker.js
 */

import { generateAnswers } from '../../../lib/gemini.js';
import { findLearnedAnswer, shouldPersistLearnedValue } from '../../../lib/form-filler.js';
import {
  getProfileFromResume,
  sanitizeLearnedDefaultsMap,
  sanitizeIgnoredLearnedDefaultsMap,
} from '../helpers.js';

export async function handleGenerateAnswers({ jd, customQuestions, pageUrl } = {}) {
  const data = await chrome.storage.local.get(['resume', 'settings', 'learnedDefaults', 'ignoredLearnedDefaults']);
  const settings = data.settings || {};
  const resume = data.resume || {};
  const ignoredLearnedDefaults = sanitizeIgnoredLearnedDefaultsMap(data.ignoredLearnedDefaults || {});
  const learnedDefaults = sanitizeLearnedDefaultsMap(data.learnedDefaults || {}, ignoredLearnedDefaults);

  if (!resume.structured) throw new Error('Profile not set up yet');

  const deterministicAnswers = buildDeterministicAnswers({
    resume: resume.structured,
    settings,
    pageUrl,
    customQuestions: customQuestions || [],
    learnedDefaults,
  });

  let answers = { ...deterministicAnswers };
  let warning = null;

  const shouldUseAi = !!settings.gemini_api_key && (String(jd || '').trim() || (customQuestions || []).length);
  if (shouldUseAi) {
    try {
      const aiAnswers = await generateAnswers({
        resume: sanitizeResumeForAi(resume.structured),
        jd,
        customQuestions: customQuestions || [],
        settings,
        apiKey: settings.gemini_api_key,
        model: settings.gemini_model,
      });
      answers = {
        ...deterministicAnswers,
        ...aiAnswers,
      };
    } catch (err) {
      warning = `AI fallback unavailable: ${err.message}. Filled the core profile fields only.`;
      console.warn('[apply-bot] Falling back to deterministic answers only.', err);
    }
  }

  // Persist last answers for preview
  await chrome.storage.local.set({ lastAnswers: answers });

  return { success: true, answers, warning, usedAi: shouldUseAi && !warning };
}

export async function getLastAnswers() {
  const data = await chrome.storage.local.get(['lastAnswers', 'lastFillReport']);
  return {
    answers: data.lastAnswers || null,
    report: data.lastFillReport || null,
  };
}

function buildDeterministicAnswers({ resume, settings, customQuestions = [], learnedDefaults = {} }) {
  const profile = getProfileFromResume(resume, settings);
  const fullName = profile.full_name;
  const salaryMin = settings.preferred_salary_min ? String(settings.preferred_salary_min) : '';
  const salaryMax = settings.preferred_salary_max ? String(settings.preferred_salary_max) : '';
  const safeLearnedDefaults = Object.fromEntries(
    Object.entries(learnedDefaults || {}).filter(([label, value]) => shouldPersistLearnedValue(label, value))
  );

  const baseAnswers = {
    first_name: fullName.split(' ')[0] || '',
    last_name: fullName.split(' ').slice(1).join(' ') || '',
    full_name: fullName,
    name: fullName,
    email: profile.email,
    phone: profile.phone,
    location: profile.location,
    address: profile.address_line1,
    address_line1: profile.address_line1,
    city: profile.city,
    state: profile.state_region,
    state_region: profile.state_region,
    zip: profile.postal_code,
    postal_code: profile.postal_code,
    linkedin: profile.linkedin,
    github: profile.github,
    portfolio: profile.portfolio,
    current_company: profile.current_company,
    current_title: profile.current_title,
    years_of_experience: profile.years_of_experience || '',
    pronouns: profile.pronouns,
    // Only include sensitive fields if opted in
    ...(profile.sensitive_optin ? {
      gender: profile.gender,
      race: profile.race,
      veteran: profile.veteran,
      disability: profile.disability,
      pronouns_sensitive: profile.pronouns_sensitive,
    } : {}),
    work_authorization: settings.work_authorization || '',
    preferred_location: profile.location,
    salary_expectation: [salaryMin, salaryMax].filter(Boolean).join(' - '),
    desired_salary_min: salaryMin,
    desired_salary_max: salaryMax,
    remote_preference: settings.preferred_remote ? 'Remote' : '',
    start_date: profile.start_date || '',
    availability: profile.availability || profile.start_date || '',
    why_company: profile.why_company_default || '',
    why_role: profile.why_role_default || '',
    additional_information: profile.additional_info_default || '',
    accommodations: profile.additional_info_default || '',
    sponsorship: profile.requires_sponsorship || '',
    requires_sponsorship: profile.requires_sponsorship || '',
  };

  return {
    ...baseAnswers,
    ...safeLearnedDefaults,
    custom_answers: buildDefaultCustomAnswers(customQuestions, baseAnswers, safeLearnedDefaults),
  };
}

// Whether a custom question is phrased to expect a strict yes/no answer
// (e.g. "Are you legally authorized to work in the US?") rather than a
// descriptive one (e.g. "What is your work authorization status?").
function wantsBinaryAnswer(lowerQuestion = '') {
  return /^\s*(are|is|do|does|did|will|would|can|could|have|has)\b/.test(lowerQuestion)
    || /\byes\s*\/\s*no\b/.test(lowerQuestion)
    || /\(\s*yes\s*(or|\/)\s*no\s*\)/.test(lowerQuestion);
}

function buildDefaultCustomAnswers(customQuestions = [], baseAnswers = {}, learnedDefaults = {}) {
  const customAnswers = {};

  for (const question of customQuestions) {
    const text = String(question || '').trim();
    const lower = text.toLowerCase();
    let answer = findLearnedAnswer(text, learnedDefaults);

    if (answer) {
      customAnswers[text] = answer;
      continue;
    }

    if (/legally authorized|authorized to work|eligible to work|work authorization/.test(lower)) {
      answer = wantsBinaryAnswer(lower) ? 'Yes' : baseAnswers.work_authorization;
    } else if (/sponsorship|sponsor|visa transfer|relocation assistance/.test(lower)) {
      const needsSponsorship = /^yes$/i.test(baseAnswers.requires_sponsorship || '');
      answer = wantsBinaryAnswer(lower) ? (needsSponsorship ? 'Yes' : 'No') : (baseAnswers.requires_sponsorship || 'No');
    } else if (/beginning of .*salary|salary range.*beginning|minimum salary/.test(lower)) {
      answer = baseAnswers.desired_salary_min;
    } else if (/end of .*salary|salary range.*end|maximum salary/.test(lower)) {
      answer = baseAnswers.desired_salary_max;
    } else if (/salary|compensation|annual base/.test(lower)) {
      answer = baseAnswers.salary_expectation;
    } else if (/why .*company|what makes you excited|why 1password|why do you want to work/.test(lower)) {
      answer = baseAnswers.why_company;
    } else if (/why .*role|good fit|why this role|strong candidate/.test(lower)) {
      answer = baseAnswers.why_role;
    } else if (/years? of (professional )?experience|how many years/.test(lower)) {
      answer = baseAnswers.years_of_experience;
    } else if (/gender|gender identity|sex at birth/.test(lower)) {
      answer = baseAnswers.gender || '';
    } else if (/race|ethnicity|ethnic background/.test(lower)) {
      answer = baseAnswers.race || '';
    } else if (/veteran|protected veteran|military service/.test(lower)) {
      answer = baseAnswers.veteran || '';
    } else if (/disability|disability status/.test(lower)) {
      answer = baseAnswers.disability || '';
    } else if (/cybersecurity saas/.test(lower)) {
      answer = wantsBinaryAnswer(lower) ? 'Yes' : baseAnswers.why_role;
    } else if (/size of company|most recently worked for/.test(lower)) {
      answer = '101-999';
    } else if (/what brought you to this job posting|how did you hear/.test(lower)) {
      answer = 'Company careers page';
    } else if (/current job title|job title/.test(lower)) {
      answer = baseAnswers.current_title;
    } else if (/current company|current employer|most recently/.test(lower)) {
      answer = baseAnswers.current_company;
    } else if (/when can you start|start date/.test(lower)) {
      answer = baseAnswers.start_date || baseAnswers.availability;
    } else if (/availability|notice period/.test(lower)) {
      answer = baseAnswers.availability || baseAnswers.start_date;
    } else if (/pronouns/.test(lower)) {
      answer = baseAnswers.pronouns;
    } else if (/additional information|accommodations/.test(lower)) {
      answer = baseAnswers.additional_information;
    } else if (/background check|recruiting privacy|i understand|i agree/.test(lower)) {
      answer = wantsBinaryAnswer(lower) ? 'Yes' : 'I understand';
    }

    if (answer) {
      customAnswers[text] = answer;
    }
  }

  return customAnswers;
}

function sanitizeResumeForAi(resume = {}) {
  const safeResume = { ...(resume || {}) };
  delete safeResume.sensitive_optin;
  delete safeResume.gender;
  delete safeResume.race;
  delete safeResume.veteran;
  delete safeResume.disability;
  delete safeResume.pronouns_sensitive;
  return safeResume;
}
