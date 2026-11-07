import { structureResume } from '../../lib/resume-parser.js';
import {
  getLearnedMemoryKey,
  isIgnoredLearnedPrompt,
  shouldPersistLearnedValue,
} from '../../lib/form-filler.js';

export const MAX_RESUME_EXCERPT_LENGTH = 1000;
export const MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH = 1200;
export const MAX_RESUME_ATTACHMENT_DATA_LENGTH = 1_500_000;
export const MAX_RESUME_ATTACHMENT_TEXT_LENGTH = 200_000;

export function matchesDomain(hostname, domain) {
  return hostname === domain || hostname.endsWith('.' + domain);
}

export function detectAtsFromUrl(url) {
  if (!url) return null;
  try {
    const { hostname, pathname, search } = new URL(url);
    const path = `${pathname} ${search}`.toLowerCase();

    if (matchesDomain(hostname, 'greenhouse.io') && /\/jobs\/|job_app|application/.test(path)) return 'Greenhouse';
    if ((matchesDomain(hostname, 'ashbyhq.com') || matchesDomain(hostname, 'ashby.io')) && /\/application|\/jobs\/|\/job\//.test(path)) return 'Ashby';
    if (matchesDomain(hostname, 'lever.co') && /\/postings\/|\/jobs\/|\/apply/.test(path)) return 'Lever';
    if (matchesDomain(hostname, 'linkedin.com') && /\/jobs\/view\//.test(path)) return 'LinkedIn Easy Apply';
    if (matchesDomain(hostname, 'workday.com') && /\/job\/|requisition|\/apply/.test(path)) return 'Workday';
    if (matchesDomain(hostname, 'icims.com') && /\/jobs\/|\/job\//.test(path)) return 'iCIMS';
    if (matchesDomain(hostname, 'jobvite.com') && /\/job\/|\/apply/.test(path)) return 'Jobvite';
    if ((matchesDomain(hostname, 'circle.com') || matchesDomain(hostname, 'phenompeople.com')) && /\/apply|step=|\/en\//.test(path)) return 'Phenom';
  } catch {
    // Invalid URL — ignore
  }
  return null;
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

export function firstNonEmptyNumber(...values) {
  for (const value of values) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return 0;
}

export function hasAnyProfileData(profile = {}) {
  return Object.entries(profile || {}).some(
    ([key, value]) => key !== 'sensitive_optin' && String(value || '').trim()
  );
}

export function sanitizeResumeAttachment(attachment = null) {
  if (!attachment || typeof attachment !== 'object') return null;

  const name = String(attachment.name || '').trim();
  const preview = String(attachment.preview || '').trim().slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH);
  const data = typeof attachment.data === 'string' ? attachment.data : '';
  const text = typeof attachment.text === 'string' ? attachment.text : '';
  const downloadMode = attachment.downloadMode === 'data-url' && data ? 'data-url' : 'text';

  if (!name && !preview && !data && !text) {
    return null;
  }

  return {
    name: name || 'resume-preview.txt',
    mimeType: String(attachment.mimeType || '').trim() || (downloadMode === 'data-url' ? 'application/octet-stream' : 'text/plain'),
    source: String(attachment.source || 'saved').trim() || 'saved',
    updatedAt: attachment.updatedAt || null,
    preview,
    downloadMode,
    data: downloadMode === 'data-url' ? data : '',
    text: downloadMode === 'text' ? text.slice(0, MAX_RESUME_ATTACHMENT_TEXT_LENGTH) : '',
  };
}

export function extractDataUrlMimeType(dataUrl = '') {
  const match = String(dataUrl || '').match(/^data:([^;,]+)[;,]/i);
  return match?.[1] || '';
}

export function buildResumeDownloadText(structured = {}, previewText = '') {
  const experience = Array.isArray(structured?.experience) ? structured.experience : [];
  const education = Array.isArray(structured?.education) ? structured.education : [];
  const skills = Array.isArray(structured?.skills) ? structured.skills : [];

  const lines = [
    structured?.name || '',
    [structured?.email, structured?.phone, structured?.location].filter(Boolean).join(' • '),
    structured?.summary || '',
    structured?.current_title
      ? `${structured.current_title}${structured?.current_company ? ` @ ${structured.current_company}` : ''}`
      : '',
    skills.length ? `Skills: ${skills.slice(0, 16).join(', ')}` : '',
    experience.length ? 'Experience:' : '',
    ...experience.slice(0, 3).map((item) => [item?.title, item?.company].filter(Boolean).join(' — ')),
    education.length ? 'Education:' : '',
    ...education.slice(0, 2).map((item) => [item?.degree, item?.institution || item?.school].filter(Boolean).join(' — ')),
    previewText || '',
  ].filter(Boolean);

  return lines.join('\n').trim().slice(0, MAX_RESUME_ATTACHMENT_TEXT_LENGTH);
}

export function buildResumePreviewText({ resumeRaw = '', structured = {}, fallbackPreview = '' } = {}) {
  const raw = String(resumeRaw || '').trim();
  if (raw && !raw.startsWith('data:')) {
    return raw.replace(/\r\n/g, '\n').slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH);
  }

  const preview = String(fallbackPreview || buildResumeDownloadText(structured, '') || '').trim();
  return preview.slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH);
}

export function getSavedResumeAttachment(resume = {}) {
  if (resume?.attachmentRemoved === true) {
    return null;
  }

  const storedAttachment = sanitizeResumeAttachment(resume?.attachment || null);
  if (storedAttachment) {
    return storedAttachment;
  }

  const preview = buildResumePreviewText({
    structured: resume?.structured || {},
    fallbackPreview: resume?.excerpt || '',
  });
  if (!preview) {
    return null;
  }

  return sanitizeResumeAttachment({
    name: 'resume-preview.txt',
    mimeType: 'text/plain',
    source: 'saved',
    updatedAt: null,
    preview,
    downloadMode: 'text',
    text: buildResumeDownloadText(resume?.structured || {}, preview),
  });
}

export function buildResumeAttachment({ resumeRaw = '', resumeMeta = {}, structured = {}, previewText = '' } = {}) {
  const raw = String(resumeRaw || '');
  if (!raw.trim()) {
    return null;
  }

  const meta = resumeMeta && typeof resumeMeta === 'object' ? resumeMeta : {};
  const isDataUrl = raw.startsWith('data:');
  const source = meta.source === 'paste' ? 'paste' : 'upload';
  const attachment = {
    name: String(meta.name || (source === 'paste' ? 'resume-paste.txt' : 'resume-upload')).trim() || 'resume-preview.txt',
    mimeType: isDataUrl
      ? (extractDataUrlMimeType(raw) || String(meta.type || '').trim() || 'application/octet-stream')
      : (String(meta.type || '').trim() || 'text/plain'),
    source,
    updatedAt: new Date().toISOString(),
    preview: String(previewText || '').trim().slice(0, MAX_RESUME_ATTACHMENT_PREVIEW_LENGTH),
    downloadMode: 'text',
    data: '',
    text: '',
  };

  if (isDataUrl && raw.length <= MAX_RESUME_ATTACHMENT_DATA_LENGTH) {
    attachment.downloadMode = 'data-url';
    attachment.data = raw;
    return sanitizeResumeAttachment(attachment);
  }

  attachment.text = (
    !isDataUrl && raw.length <= MAX_RESUME_ATTACHMENT_TEXT_LENGTH
      ? raw
      : buildResumeDownloadText(structured, previewText)
  ).slice(0, MAX_RESUME_ATTACHMENT_TEXT_LENGTH);

  return sanitizeResumeAttachment(attachment);
}

export function getResumeAttachmentSummary(resume = {}) {
  const attachment = getSavedResumeAttachment(resume);
  if (!attachment) {
    return null;
  }

  return {
    name: attachment.name,
    source: attachment.source,
    updatedAt: attachment.updatedAt,
    preview: attachment.preview,
    hasDownload: !!(attachment.data || attachment.text || attachment.preview),
    downloadLabel: attachment.downloadMode === 'data-url' ? 'Download copy' : 'Download preview',
  };
}

export function sanitizeLearnedDefaultsMap(map = {}, ignoredMap = {}) {
  return Object.fromEntries(
    Object.entries(map || {}).filter(([label, value]) => {
      return shouldPersistLearnedValue(label, value) && !isIgnoredLearnedPrompt(label, ignoredMap);
    })
  );
}

export function sanitizeIgnoredLearnedDefaultsMap(map = {}) {
  return Object.fromEntries(
    Object.entries(map || {}).map(([key, value]) => {
      const question = String(value?.question || key || '').trim();
      const answer = String(value?.answer || value || '').trim();
      const normalizedKey = getLearnedMemoryKey(question);
      return [normalizedKey, {
        question,
        answer,
        ignored_at: value?.ignored_at || null,
      }];
    }).filter(([key, value]) => key && value.question)
  );
}

export function trimLearnedDefaultsMap(map = {}) {
  return Object.fromEntries(Object.entries(map || {}).slice(-75));
}

export function trimIgnoredLearnedDefaultsMap(map = {}) {
  return Object.fromEntries(
    Object.entries(map || {})
      .sort((a, b) => String(b[1]?.ignored_at || '').localeCompare(String(a[1]?.ignored_at || '')))
      .slice(0, 100)
  );
}

export function mergeStructuredResume(existingResume, incomingResume) {
  const existing = structureResume(existingResume || {});
  const incoming = structureResume(incomingResume || {});

  return {
    ...existing,
    ...incoming,
    name: firstNonEmpty(incoming.name, existing.name),
    email: firstNonEmpty(incoming.email, existing.email),
    phone: firstNonEmpty(incoming.phone, existing.phone),
    location: firstNonEmpty(incoming.location, existing.location),
    address_line1: firstNonEmpty(incoming.address_line1, existing.address_line1),
    city: firstNonEmpty(incoming.city, existing.city),
    state_region: firstNonEmpty(incoming.state_region, existing.state_region),
    postal_code: firstNonEmpty(incoming.postal_code, existing.postal_code),
    linkedin: firstNonEmpty(incoming.linkedin, existing.linkedin),
    github: firstNonEmpty(incoming.github, existing.github),
    portfolio: firstNonEmpty(incoming.portfolio, existing.portfolio),
    pronouns: firstNonEmpty(incoming.pronouns, existing.pronouns),
    current_company: firstNonEmpty(incoming.current_company, existing.current_company),
    current_title: firstNonEmpty(incoming.current_title, existing.current_title),
    summary: firstNonEmpty(incoming.summary, existing.summary),
    years_of_experience: Math.max(Number(existing.years_of_experience) || 0, Number(incoming.years_of_experience) || 0),
    skills: incoming.skills?.length ? incoming.skills : existing.skills,
    experience: incoming.experience?.length ? incoming.experience : existing.experience,
    education: incoming.education?.length ? incoming.education : existing.education,
    certifications: incoming.certifications?.length ? incoming.certifications : existing.certifications,
    languages: incoming.languages?.length ? incoming.languages : existing.languages,
    // Parser never populates these extension-owned fields; preserve existing values.
    why_company_default: firstNonEmpty(incoming.why_company_default, existing.why_company_default),
    why_role_default: firstNonEmpty(incoming.why_role_default, existing.why_role_default),
    additional_info_default: firstNonEmpty(incoming.additional_info_default, existing.additional_info_default),
    start_date: firstNonEmpty(incoming.start_date, existing.start_date),
    availability: firstNonEmpty(incoming.availability, existing.availability),
    requires_sponsorship: firstNonEmpty(incoming.requires_sponsorship, existing.requires_sponsorship),
    work_authorization: firstNonEmpty(incoming.work_authorization, existing.work_authorization),
  };
}

export function applyProfileOverrides(resume, profile = {}, settings = {}) {
  const next = structureResume({ ...(resume || {}) });
  next.name = firstNonEmpty(profile.full_name, profile.name, next.name);
  next.email = firstNonEmpty(profile.email, next.email);
  next.phone = firstNonEmpty(profile.phone, next.phone);
  next.location = firstNonEmpty(profile.location, next.location);
  next.address_line1 = firstNonEmpty(profile.address_line1, next.address_line1, next.address);
  next.city = firstNonEmpty(profile.city, next.city);
  next.state_region = firstNonEmpty(profile.state_region, profile.state, next.state_region, next.state);
  next.postal_code = firstNonEmpty(profile.postal_code, profile.zip, next.postal_code, next.zip);
  next.linkedin = firstNonEmpty(profile.linkedin, next.linkedin);
  next.github = firstNonEmpty(profile.github, next.github);
  next.portfolio = firstNonEmpty(profile.portfolio, next.portfolio);
  next.pronouns = firstNonEmpty(profile.pronouns, next.pronouns);
  next.sensitive_optin = profile.sensitive_optin === true;
  next.gender = next.sensitive_optin ? firstNonEmpty(profile.gender, next.gender) : '';
  next.race = next.sensitive_optin ? firstNonEmpty(profile.race, next.race) : '';
  next.veteran = next.sensitive_optin ? firstNonEmpty(profile.veteran, next.veteran) : '';
  next.disability = next.sensitive_optin ? firstNonEmpty(profile.disability, next.disability) : '';
  if (next.sensitive_optin && !next.pronouns) next.pronouns = firstNonEmpty(profile.pronouns_sensitive, next.pronouns_sensitive);
  next.pronouns_sensitive = next.sensitive_optin ? firstNonEmpty(profile.pronouns_sensitive, next.pronouns_sensitive) : '';
  next.current_company = firstNonEmpty(profile.current_company, next.current_company, next.experience?.[0]?.company);
  next.current_title = firstNonEmpty(profile.current_title, next.current_title, next.experience?.[0]?.title);
  next.years_of_experience = firstNonEmptyNumber(profile.years_of_experience, next.years_of_experience);
  next.why_company_default = firstNonEmpty(profile.why_company_default, next.why_company_default);
  next.why_role_default = firstNonEmpty(profile.why_role_default, next.why_role_default);
  next.additional_info_default = firstNonEmpty(profile.additional_info_default, next.additional_info_default);
  next.start_date = firstNonEmpty(profile.start_date, next.start_date);
  next.availability = firstNonEmpty(profile.availability, next.availability);
  next.requires_sponsorship = firstNonEmpty(profile.requires_sponsorship, next.requires_sponsorship);

  if (!Array.isArray(next.experience)) next.experience = [];
  if (next.current_company || next.current_title) {
    if (!next.experience[0]) next.experience[0] = { company: '', title: '', start: '', end: 'Present', description: '' };
    next.experience[0].company = firstNonEmpty(next.current_company, next.experience[0].company);
    next.experience[0].title = firstNonEmpty(next.current_title, next.experience[0].title);
  }

  if (settings.work_authorization && !next.work_authorization) {
    next.work_authorization = settings.work_authorization;
  }

  return next;
}

export function getProfileFromResume(resume = {}, settings = {}) {
  const currentExperience = Array.isArray(resume?.experience) ? resume.experience[0] || {} : {};
  const base = {
    full_name: resume?.name || '',
    email: resume?.email || '',
    phone: resume?.phone || '',
    location: resume?.location || '',
    address_line1: resume?.address_line1 || '',
    city: resume?.city || '',
    state_region: resume?.state_region || '',
    postal_code: resume?.postal_code || '',
    linkedin: resume?.linkedin || '',
    github: resume?.github || '',
    portfolio: resume?.portfolio || '',
    current_company: resume?.current_company || currentExperience.company || '',
    current_title: resume?.current_title || currentExperience.title || '',
    years_of_experience: resume?.years_of_experience ? String(resume.years_of_experience) : '',
    pronouns: resume?.pronouns || '',
    why_company_default: resume?.why_company_default || '',
    why_role_default: resume?.why_role_default || '',
    additional_info_default: resume?.additional_info_default || '',
    start_date: resume?.start_date || '',
    availability: resume?.availability || '',
    requires_sponsorship: resume?.requires_sponsorship || '',
    work_authorization: settings.work_authorization || '',
  };
  if (resume?.sensitive_optin) {
    base.sensitive_optin = true;
    base.gender = resume.gender || '';
    base.race = resume.race || '';
    base.veteran = resume.veteran || '';
    base.disability = resume.disability || '';
    base.pronouns_sensitive = resume.pronouns_sensitive || '';
  } else {
    base.sensitive_optin = false;
    base.gender = '';
    base.race = '';
    base.veteran = '';
    base.disability = '';
    base.pronouns_sensitive = '';
  }
  return base;
}

export function getProfileCompleteness(profile = {}) {
  const requiredKeys = ['full_name', 'email', 'phone', 'location', 'linkedin', 'current_company', 'current_title', 'work_authorization'];
  const completed = requiredKeys.filter((key) => String(profile[key] || '').trim()).length;
  return { completed, total: requiredKeys.length };
}
