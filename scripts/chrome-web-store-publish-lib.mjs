const ACTIVE_SUBMISSION_STATES = new Set([
  "PENDING_REVIEW",
  "STAGED",
  "PUBLISHED",
  "PUBLISHED_TO_TESTERS",
]);

function hasExactVersion(revision, version) {
  return Array.isArray(revision?.distributionChannels)
    && revision.distributionChannels.some((channel) => channel?.crxVersion === version);
}

/**
 * Return why a release can be treated as an idempotent no-op, or null.
 * Only exact version matches in a confirmed published or active submission
 * are accepted. Rejected, cancelled, and unknown submission states are not.
 */
export function existingReleaseState(status, version) {
  if (hasExactVersion(status?.publishedItemRevisionStatus, version)) {
    return "published";
  }

  const submitted = status?.submittedItemRevisionStatus;
  if (ACTIVE_SUBMISSION_STATES.has(submitted?.state) && hasExactVersion(submitted, version)) {
    return `submitted:${submitted.state}`;
  }

  return null;
}

/**
 * Run the release flow with injected operations so its idempotency boundary
 * can be tested without credentials or network access.
 */
export async function publishIfNeeded({
  version,
  fetchStatus,
  upload,
  publish,
  onSkip = () => {},
}) {
  if (typeof version !== "string" || version.trim() === "") {
    throw new TypeError("A non-empty manifest version is required.");
  }

  const status = await fetchStatus();
  const existingState = existingReleaseState(status, version);
  if (existingState) {
    onSkip({ version, state: existingState });
    return { skipped: true, state: existingState };
  }

  const uploaded = await upload();
  const published = await publish(uploaded);
  return { skipped: false, uploaded, published };
}
