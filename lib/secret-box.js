/**
 * lib/secret-box.js — Encrypt/decrypt user-entered OAuth client secrets at rest.
 *
 * - AES-GCM 256 with a non-extractable CryptoKey (extractable: false)
 * - Key persisted in IndexedDB (structured clone of the CryptoKey object)
 * - Random 12-byte IV per encryption
 * - Stored format: { v: 1, iv: base64, ct: base64 }
 * - On first read of a plaintext value, migrates it (encrypts and rewrites)
 * - Decryption failure → treat as unset (user must re-enter)
 */

const KEY_NAME = 'ats-fill-secret-key';
const STORE_NAME = 'ats-fill-secrets';
const DB_NAME = 'ats-fill-encryption';

/** @type {IDBDatabase | null} */
let dbPromise = null;

// Allow injection of a custom key store for testing (like chrome.storage.local mock)
let _keyStore = null;

/**
 * Set a custom key store implementation (for testing).
 * The store must have `async get(key)` and `async put(key, value)` methods.
 * @param {object} store
 */
export function __setKeyStoreForTesting(store) {
  _keyStore = store;
}

/**
 * Reset internal state (for testing).
 * @returns {void}
 */
export function __resetForTesting() {
  dbPromise = null;
}

/**
 * Get the encryption key from the key store, creating it if needed.
 * @returns {Promise<CryptoKey>}
 */
async function getOrCreateKey() {
  // Test mode: use injected key store
  if (_keyStore) {
    let key = await _keyStore.get(KEY_NAME);
    if (!key) {
      key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false, // extractable: false
        ['encrypt', 'decrypt']
      );
      await _keyStore.put(KEY_NAME, key);
    }
    return key;
  }

  // Production mode: use IndexedDB
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(KEY_NAME);
    request.onsuccess = () => {
      const key = request.result;
      if (key) {
        resolve(key);
      } else {
        // Key doesn't exist, create it
        createAndStoreKey(db).then(resolve).catch(reject);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Generate a new AES-GCM 256 key and store it in IndexedDB.
 * @param {IDBDatabase} db
 * @returns {Promise<CryptoKey>}
 */
async function createAndStoreKey(db) {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // extractable: false
    ['encrypt', 'decrypt']
  );
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(key, KEY_NAME);
    request.onsuccess = () => resolve(key);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Open (or create) the IndexedDB and return the database.
 * @returns {Promise<IDBDatabase>}
 */
function getDb() {
  if (dbPromise) return dbPromise;
  const indexedDB = globalThis.indexedDB;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * Convert ArrayBuffer to base64 string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Encrypt a plaintext secret.
 * @param {string} plaintext
 * @returns {Promise<{v: number, iv: string, ct: string}>}
 */
export async function encryptSecret(plaintext) {
  if (!plaintext) return null;
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const encoded = new globalThis.TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    v: 1,
    iv: toBase64(iv),
    ct: toBase64(ciphertext),
  };
}

/**
 * Decrypt a secret from the stored format.
 * Returns null if the value is not in encrypted format (plaintext migration)
 * or if decryption fails (tampered/corrupted).
 * @param {string | {v: number, iv: string, ct: string} | null | undefined} stored
 * @returns {Promise<string | null>} Plaintext secret, or null if not decryptable
 */
export async function decryptSecret(stored) {
  if (!stored) return null;

  // If it's a plain string (not our encrypted format), it's a legacy plaintext value.
  // Return it so the caller can migrate (encrypt and rewrite).
  if (typeof stored === 'string') {
    return stored;
  }

  // Expect { v: 1, iv: string, ct: string }
  if (stored.v !== 1 || !stored.iv || !stored.ct) {
    return null; // Unknown format → treat as unset
  }

  try {
    const key = await getOrCreateKey();
    const iv = fromBase64(stored.iv);
    const ct = fromBase64(stored.ct);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ct
    );
    return new globalThis.TextDecoder().decode(plaintext);
  } catch {
    // Decryption failed (tampered, wrong key, corrupted) → treat as unset
    return null;
  }
}

/**
 * Check if a stored value is in encrypted format.
 * @param {unknown} stored
 * @returns {boolean}
 */
export function isEncryptedFormat(stored) {
  return (
    stored !== null &&
    typeof stored === 'object' &&
    stored !== undefined &&
    'v' in stored &&
    'iv' in stored &&
    'ct' in stored
  );
}

/**
 * Clear the encryption key from IndexedDB (for testing/reset).
 * @returns {Promise<void>}
 */
export async function clearKey() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(KEY_NAME);
    request.onsuccess = () => {
      dbPromise = null; // Force re-open on next use
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}