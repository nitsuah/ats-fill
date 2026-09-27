/**
 * background/modules/handlers/interview.js - Interview prep handlers
 * Extracted from service-worker.js
 */

async function getGeminiApiKey() {
  const data = await chrome.storage.local.get('settings');
  const settings = data.settings || {};
  return settings.gemini_api_key || null;
}

export async function handleGetInterviewPrep(payload) {
  const { applicationId } = payload || {};
  if (!applicationId) throw new Error('applicationId required');

  const data = await chrome.storage.local.get(`interview_prep_${applicationId}`);
  return { success: true, data: data[`interview_prep_${applicationId}`] || { questions: [] } };
}

export async function handleSaveInterviewPrep(payload) {
  const { applicationId, questions } = payload || {};
  if (!applicationId) throw new Error('applicationId required');
  if (!Array.isArray(questions)) throw new Error('questions must be an array');

  await chrome.storage.local.set({
    [`interview_prep_${applicationId}`]: { questions, updatedAt: Date.now() },
  });
  return { success: true };
}

export async function handleGenerateInterviewQuestions(payload) {
  const { job, profile, resume } = payload || {};
  if (!job) throw new Error('job context required');

  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API key not configured. Add it in AI settings.');

  const prompt = buildInterviewQuestionsPrompt(job, profile, resume);
  const response = await callGeminiWithRetry(apiKey, prompt);
  const questions = parseInterviewQuestionsResponse(response);

  return { success: true, questions };
}

export async function handleGenerateInterviewAnswer(payload) {
  const { question, type, profile, resume, job } = payload || {};
  if (!question) throw new Error('question required');

  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Gemini API key not configured. Add it in AI settings.');

  const prompt = buildInterviewAnswerPrompt(question, type, profile, resume, job);
  const response = await callGeminiWithRetry(apiKey, prompt);
  const suggestion = parseInterviewAnswerResponse(response);

  return { success: true, suggestion };
}

// ── Interview Prep Prompt Builders ────────────────────────────────────────────

function buildInterviewQuestionsPrompt(job, profile, resume) {
  const profileSummary = buildProfileSummary(profile, resume);

  return `You are an expert career coach helping a candidate prepare for a job interview.

JOB DETAILS:
Company: ${job.company || 'Unknown'}
Title: ${job.title || 'Unknown'}
Location: ${job.location || 'Not specified'}
Employment Type: ${job.employment_type || 'Not specified'}
Remote: ${job.remote ? 'Yes' : 'No'}
Description: ${job.description || job.jd_snippet || 'Not provided'}

CANDIDATE PROFILE:
${profileSummary}

Generate 8-10 likely interview questions tailored to this specific role and company. Include a mix of:
- Behavioral questions (STAR format)
- Technical/role-specific questions
- Situational/hypothetical questions
- Questions about motivation and cultural fit

For each question, provide:
1. The question text
2. The question type (behavioral, technical, situational, motivation)
3. A brief hint about what the interviewer is looking for

Return as JSON array:
[
  {"question": "...", "type": "behavioral", "hint": "..."},
  ...
]`;
}

function buildInterviewAnswerPrompt(question, type, profile, resume, job) {
  const profileSummary = buildProfileSummary(profile, resume);
  const jobSummary = buildJobSummary(job);

  return `You are an expert career coach helping a candidate draft an interview answer.

QUESTION: "${question}"
QUESTION TYPE: ${type || 'general'}

JOB CONTEXT:
${jobSummary}

CANDIDATE PROFILE:
${profileSummary}

Draft a strong answer using the STAR method (Situation, Task, Action, Result) where applicable.
Focus on specific, measurable achievements from the candidate's background.
Keep it concise (2-3 paragraphs max) and conversational.
Do NOT invent false experience - only use what's in the profile.
If the profile lacks relevant experience, suggest how to frame transferable skills.

Return ONLY the suggested answer text, no JSON, no extra commentary.`;
}

function buildProfileSummary(profile, resume) {
  const parts = [];

  if (profile) {
    if (profile.current_title) parts.push(`Current Title: ${profile.current_title}`);
    if (profile.current_company) parts.push(`Current Company: ${profile.current_company}`);
    if (profile.years_of_experience) parts.push(`Years of Experience: ${profile.years_of_experience}`);
    if (profile.skills?.length) parts.push(`Skills: ${profile.skills.join(', ')}`);
  }

  if (resume?.experience?.length) {
    parts.push('Experience:');
    for (const exp of resume.experience.slice(0, 3)) {
      const title = exp.title || '';
      const company = exp.company || '';
      const start = exp.start || '';
      const end = exp.end || 'Present';
      const desc = exp.description?.slice(0, 200) || '';
      parts.push(`  - ${title} at ${company} (${start} – ${end}): ${desc}`);
    }
  }

  if (resume?.skills?.length) {
    parts.push(`Key Skills: ${resume.skills.slice(0, 15).join(', ')}`);
  }

  return parts.length ? parts.join('\n') : 'Profile not fully configured.';
}

function buildJobSummary(job) {
  if (!job) return 'Not specified';
  const parts = [];
  if (job.company) parts.push(`Company: ${job.company}`);
  if (job.title) parts.push(`Role: ${job.title}`);
  const jd = (job.description || job.jd_snippet || 'Not specified').slice(0, 500);
  parts.push(`JD: ${jd}`);
  if (job.employment_type) parts.push(`Type: ${job.employment_type}`);
  if (job.remote) parts.push('Remote: Yes');
  return parts.join('\n');
}

// ── Interview Response Parsing ────────────────────────────────────────────────

function parseInterviewQuestionsResponse(response) {
  // 1. Try raw JSON
  try {
    const parsed = JSON.parse(response);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}

  // 2. Try fenced JSON
  try {
    const fencedMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (fencedMatch) {
      const parsed = JSON.parse(fencedMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // 3. Try bracketed array
  try {
    const bracketMatch = response.match(/\[[\s\S]*\]/);
    if (bracketMatch) {
      const parsed = JSON.parse(bracketMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}

  // 4. Last resort: fallback or throw
  const fallback = parseQuestionsFallback(response);
  if (Array.isArray(fallback) && fallback.length > 0) return fallback;

  throw new Error('Could not parse interview questions from AI response.');
}

function parseQuestionsFallback(text) {
  const questions = [];
  const lines = text.split('\n').filter(l => l.trim());
  let current = {};

  for (const line of lines) {
    if (/^\d+\./.test(line.trim())) {
      if (current.question) questions.push(current);
      current = { question: line.replace(/^\d+\.\s*/, '').trim(), type: 'general' };
    } else if (/type:/i.test(line)) {
      current.type = line.split(':')[1]?.trim() || 'general';
    } else if (/hint:/i.test(line)) {
      current.hint = line.split(':')[1]?.trim();
    }
  }
  if (current.question) questions.push(current);
  return questions.slice(0, 10);
}

function parseInterviewAnswerResponse(response) {
  const trimmed = response.trim();
  if (!trimmed) throw new Error('Empty AI response.');
  return trimmed;
}
