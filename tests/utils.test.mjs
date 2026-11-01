import test from 'node:test';
import assert from 'node:assert/strict';

const EXPECTED_URL = 'https://jobs.example/application?id=1';
const MISMATCHED_URL = 'https://jobs.example/application?id=2';

async function withChrome(chromeMock, run) {
  const previous = globalThis.chrome;
  globalThis.chrome = chromeMock;
  try {
    const { sendToActiveTab } = await import('../lib/utils.js');
    await run(sendToActiveTab);
  } finally {
    if (previous === undefined) delete globalThis.chrome;
    else globalThis.chrome = previous;
  }
}

test('sendToActiveTab fails closed when the active tab has no URL', async () => {
  let getCalls = 0;
  let scriptCalls = 0;
  await withChrome({
    tabs: {
      async query() { return [{ id: 9 }]; },
      async get() { getCalls += 1; return { url: EXPECTED_URL }; },
      sendMessage() { throw new Error('must not send'); },
    },
    scripting: { async executeScript() { scriptCalls += 1; return []; } },
    runtime: { lastError: null },
  }, async (sendToActiveTab) => {
    await assert.rejects(sendToActiveTab({ type: 'FILL_FORM' }), /Could not verify the current application URL/);
  });
  assert.equal(getCalls, 0);
  assert.equal(scriptCalls, 0);
});

test('sendToActiveTab aborts when tabs.get reports a URL change after tabs.query', async () => {
  let scriptCalls = 0;
  let sendCalls = 0;
  await withChrome({
    tabs: {
      async query() { return [{ id: 9, url: EXPECTED_URL }]; },
      async get() { return { id: 9, url: MISMATCHED_URL }; },
      sendMessage() { sendCalls += 1; },
    },
    scripting: { async executeScript() { scriptCalls += 1; return []; } },
    runtime: { lastError: null },
  }, async (sendToActiveTab) => {
    await assert.rejects(sendToActiveTab({ type: 'FILL_FORM' }), /navigated or changed/);
  });
  assert.equal(scriptCalls, 0);
  assert.equal(sendCalls, 0);
});

test('sendToActiveTab delegates FILL_FORM to document-targeted delivery for the verified tab URL', async () => {
  const sends = [];
  await withChrome({
    runtime: { lastError: null },
    tabs: {
      async query() { return [{ id: 9, url: EXPECTED_URL }]; },
      async get() { return { id: 9, url: EXPECTED_URL }; },
      sendMessage(tabId, message, options, callback) {
        sends.push({ tabId, message, documentId: options.documentId });
        if (options.documentId === 'top-doc') {
          callback({ success: true, filled: 0 });
          return;
        }
        callback({ success: true, filled: 2 });
      },
    },
    scripting: {
      async executeScript() {
        return [
          { frameId: 0, documentId: 'top-doc', result: { href: EXPECTED_URL } },
          { frameId: 4, documentId: 'form-doc', result: { href: 'https://forms.example/application' } },
        ];
      },
    },
  }, async (sendToActiveTab) => {
    const response = await sendToActiveTab({ type: 'FILL_FORM' });
    assert.deepEqual(response, { success: true, filled: 2 });
  });
  assert.deepEqual(sends.map((send) => send.tabId), [9, 9]);
  assert.deepEqual(sends.map((send) => send.documentId), ['top-doc', 'form-doc']);
  assert.ok(sends.every((send) => send.message.type === 'FILL_FORM'));
  assert.ok(sends.every((send) => send.message.expectedUrl === EXPECTED_URL));
  assert.ok(sends.every((send) => !('expectedTopDocumentId' in send.message)));
});

test('esc encodes HTML metacharacters exactly once', async () => {
  const { esc } = await import('../lib/utils.js');
  assert.equal(esc('& < > "'), '&amp; &lt; &gt; &quot;');
  assert.equal(esc('&amp;'), '&amp;amp;');
  assert.equal(esc(0), '');
});

test('escAttr encodes quotes including apostrophes', async () => {
  const { escAttr } = await import('../lib/utils.js');
  assert.equal(escAttr(`& < > " '`), '&amp; &lt; &gt; &quot; &#39;');
  assert.equal(escAttr(`&#39;`), '&amp;#39;');
});


test('stripHtml decodes uppercase-X hexadecimal numeric entities', async () => {
  const { stripHtml } = await import('../lib/utils.js');
  assert.equal(stripHtml('&#X41; &#x1F4BB;'), 'A 💻');
});
