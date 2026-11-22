// secret-fields.js
// The OAuth client-secret inputs are filled asynchronously (decryption), so
// saves and connects must wait for that load, and must tell a field that never
// loaded apart from one the user deliberately cleared.

export const OAUTH_SECRET_FIELDS = [
  ['linkedin_client_secret', 'linkedin-client-secret'],
  ['google_client_secret', 'google-client-secret'],
];

let loading = Promise.resolve();

/** Remember the in-flight secret load; never rejects. */
export function trackSecretLoad(promise) {
  loading = Promise.resolve(promise).catch(() => {});
  return loading;
}

/** Resolves once the current secret load has finished (or failed). */
export function whenSecretsLoaded() {
  return loading;
}

/**
 * Value to save for one secret input: encrypted text when filled, '' when the
 * user cleared a loaded field, or undefined (leave the stored value alone) when
 * the field never loaded.
 * @param {HTMLInputElement | null} el
 * @param {(plain: string) => Promise<unknown>} encrypt
 */
export async function secretValueToSave(el, encrypt) {
  const value = el?.value.trim() || '';
  if (value) return encrypt(value);
  return el?.dataset.loaded === 'false' ? undefined : '';
}
