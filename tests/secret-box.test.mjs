/**
 * tests/secret-box.test.mjs — Tests for lib/secret-box.js
 *
 * Uses a simple in-memory key store abstraction that matches the test helper interface.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, isEncryptedFormat, clearKey, __resetForTesting, __setKeyStoreForTesting } from '../lib/secret-box.js';

// Simple in-memory key store for testing
function createKeyStore() {
  const data = new Map();
  return {
    async get(key) {
      return data.get(key);
    },
    async put(key, value) {
      data.set(key, value);
    },
  };
}

let keyStore = null;

test.beforeEach(() => {
  keyStore = createKeyStore();
  __setKeyStoreForTesting(keyStore);
  __resetForTesting();
});

test.afterEach(() => {
  __setKeyStoreForTesting(null);
  __resetForTesting();
  keyStore = null;
});

// Test round-trip encryption/decryption
test('secret-box: round-trip encrypt and decrypt', async () => {
  const plaintext = 'my-super-secret-client-secret-123';
  const encrypted = await encryptSecret(plaintext);
  assert.ok(encrypted);
  assert.ok(isEncryptedFormat(encrypted));
  assert.equal(encrypted.v, 1);
  assert.ok(encrypted.iv);
  assert.ok(encrypted.ct);

  const decrypted = await decryptSecret(encrypted);
  assert.equal(decrypted, plaintext);
});

// Test IV uniqueness - each encryption should produce different IV/ciphertext
test('secret-box: IV uniqueness - multiple encryptions produce different output', async () => {
  const plaintext = 'same-secret';
  const results = [];
  for (let i = 0; i < 5; i++) {
    const encrypted = await encryptSecret(plaintext);
    results.push(encrypted);
  }
  // All IVs should be different
  const ivs = results.map(r => r.iv);
  const uniqueIvs = new Set(ivs);
  assert.equal(uniqueIvs.size, 5, 'All IVs should be unique');

  // All ciphertexts should be different (due to different IVs)
  const cts = results.map(r => r.ct);
  const uniqueCts = new Set(cts);
  assert.equal(uniqueCts.size, 5, 'All ciphertexts should be unique');

  // But all should decrypt to the same plaintext
  for (const enc of results) {
    const decrypted = await decryptSecret(enc);
    assert.equal(decrypted, plaintext);
  }
});

// Test plaintext migration - existing plaintext value gets encrypted on first read
test('secret-box: plaintext migration - legacy plaintext value returned for re-encryption', async () => {
  // Simulate a legacy plaintext value in storage
  const legacyPlaintext = 'legacy-secret-value';
  const decrypted = await decryptSecret(legacyPlaintext);
  assert.equal(decrypted, legacyPlaintext, 'Plaintext value should be returned as-is for migration');

  // After migration, the caller should encrypt it and store the encrypted format
  const encrypted = await encryptSecret(legacyPlaintext);
  assert.ok(isEncryptedFormat(encrypted));

  // Next read should decrypt the encrypted format
  const decryptedAgain = await decryptSecret(encrypted);
  assert.equal(decryptedAgain, legacyPlaintext);
});

// Test tampered/corrupted data - decryption failure returns null
test('secret-box: tampered data - decryption failure returns null (treated as unset)', async () => {
  const plaintext = 'original-secret';
  const encrypted = await encryptSecret(plaintext);

  // Tamper with the ciphertext
  const tampered = { ...encrypted, ct: 'dGFtcGVyZWQ=' }; // "tampered" in base64
  const result = await decryptSecret(tampered);
  assert.equal(result, null, 'Tampered ciphertext should return null');

  // Tamper with the IV
  const tamperedIv = { ...encrypted, iv: 'dGFtcGVyZWQ=' };
  const result2 = await decryptSecret(tamperedIv);
  assert.equal(result2, null, 'Tampered IV should return null');

  // Wrong version
  const wrongVersion = { ...encrypted, v: 999 };
  const result3 = await decryptSecret(wrongVersion);
  assert.equal(result3, null, 'Wrong version should return null');

  // Missing fields
  const missingFields = { v: 1, iv: encrypted.iv };
  const result4 = await decryptSecret(missingFields);
  assert.equal(result4, null, 'Missing ct should return null');

  const missingIv = { v: 1, ct: encrypted.ct };
  const result5 = await decryptSecret(missingIv);
  assert.equal(result5, null, 'Missing iv should return null');
});

// Test empty/null handling
test('secret-box: empty/null input returns null', async () => {
  assert.equal(await encryptSecret(''), null);
  assert.equal(await encryptSecret(null), null);
  assert.equal(await encryptSecret(undefined), null);

  assert.equal(await decryptSecret(null), null);
  assert.equal(await decryptSecret(undefined), null);
  assert.equal(await decryptSecret(''), null);
});

// Test isEncryptedFormat
test('secret-box: isEncryptedFormat detects encrypted format', async () => {
  const encrypted = await encryptSecret('test');
  assert.ok(isEncryptedFormat(encrypted));
  assert.ok(!isEncryptedFormat('plaintext'));
  assert.ok(!isEncryptedFormat(null));
  assert.ok(!isEncryptedFormat(undefined));
  assert.ok(!isEncryptedFormat({ v: 1 })); // missing iv, ct
  assert.ok(!isEncryptedFormat({ v: 1, iv: 'a' })); // missing ct
  assert.ok(!isEncryptedFormat({ v: 1, ct: 'a' })); // missing iv
});

// Test key persistence across calls
test('secret-box: key persists across operations', async () => {
  const plaintext = 'persistent-secret';
  const encrypted1 = await encryptSecret(plaintext);
  const decrypted1 = await decryptSecret(encrypted1);
  assert.equal(decrypted1, plaintext);

  // Key should be stored in our key store
  const storedKey = await keyStore.get('ats-fill-secret-key');
  assert.ok(storedKey, 'Key should be stored in key store');
});
// --- IndexedDB path -------------------------------------------------------
// A small fake IndexedDB: transactions run one at a time (as readwrite
// transactions on one store do), requests settle asynchronously, and
// oncomplete fires after every queued request has run.
function fakeIndexedDB() {
  const data = new Map();
  let chain = Promise.resolve();
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    transaction() {
      const queue = [];
      const tx = { oncomplete: null, onabort: null, onerror: null, error: null };
      const request = (fn) => {
        const r = {};
        queue.push(() => {
          r.result = fn();
          if (r.onsuccess) r.onsuccess();
        });
        return r;
      };
      const store = {
        get: (k) => request(() => data.get(k)),
        add: (v, k) => request(() => {
          if (data.has(k)) throw new Error('ConstraintError');
          data.set(k, v);
        }),
        put: (v, k) => request(() => { data.set(k, v); }),
        delete: (k) => request(() => { data.delete(k); }),
      };
      tx.objectStore = () => store;
      chain = chain.then(() => new Promise((done) => {
        setTimeout(() => {
          while (queue.length) queue.shift()();
          if (tx.oncomplete) tx.oncomplete();
          done();
        }, 0);
      }));
      return tx;
    },
  };
  return {
    data,
    open() {
      const r = {};
      setTimeout(() => {
        r.result = db;
        if (r.onsuccess) r.onsuccess();
      }, 0);
      return r;
    },
  };
}

test('secret-box: two contexts racing on an empty store share one key', async () => {
  __setKeyStoreForTesting(null);
  const fake = fakeIndexedDB();
  const prev = globalThis.indexedDB;
  globalThis.indexedDB = fake;
  try {
    __resetForTesting();
    const a = encryptSecret('from-context-a');
    __resetForTesting(); // a second extension context with its own module state
    const b = encryptSecret('from-context-b');
    const [ca, cb] = await Promise.all([a, b]);

    __resetForTesting(); // a third context reads both back
    assert.equal(await decryptSecret(ca), 'from-context-a');
    assert.equal(await decryptSecret(cb), 'from-context-b');
    assert.equal(fake.data.size, 1);
  } finally {
    globalThis.indexedDB = prev;
  }
});

test('secret-box: clearKey deletes the stored key', async () => {
  __setKeyStoreForTesting(null);
  const fake = fakeIndexedDB();
  const prev = globalThis.indexedDB;
  globalThis.indexedDB = fake;
  try {
    __resetForTesting();
    const stored = await encryptSecret('to-be-orphaned');
    assert.equal(fake.data.size, 1);
    await clearKey();
    assert.equal(fake.data.size, 0);
    // Without the old key the ciphertext reads as unset
    assert.equal(await decryptSecret(stored), null);
  } finally {
    globalThis.indexedDB = prev;
  }
});
