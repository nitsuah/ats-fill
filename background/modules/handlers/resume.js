/**
 * background/modules/handlers/resume.js - Resume attachment handlers
 * Extracted from service-worker.js
 */

import { getSavedResumeAttachment } from '../helpers.js';

export async function handleGetResumeAttachment() {
  const data = await chrome.storage.local.get('resume');
  const attachment = getSavedResumeAttachment(data.resume || {});
  if (!attachment) {
    throw new Error('No saved resume attachment is available yet.');
  }

  return { success: true, attachment };
}

export async function handleRemoveResumeAttachment() {
  const data = await chrome.storage.local.get('resume');
  const resume = data.resume || {};

  await chrome.storage.local.set({
    resume: {
      ...resume,
      excerpt: null,
      attachment: null,
      attachmentRemoved: true,
    },
  });

  return { success: true };
}
