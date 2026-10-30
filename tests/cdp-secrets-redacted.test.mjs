import test from 'node:test';
import assert from 'node:assert/strict';
import { readApplications, sendMessage } from '../scripts/tracker/cdp.mjs';

function makeEvaluateStub(response) {
  return async () => response;
}

function makeEvaluateStubWithSecret(secretValue) {
  const apps = [{
    id: 'app-1',
    company: 'TestCorp',
    status: 'applied',
    secretField: secretValue,
    apiKey: 'sk-' + 'x'.repeat(24),
    normalField: 'safe'
  }];
  return async () => apps;
}

test('readApplications redacts secret fields from returned records', async () => {
  const secret = 'sk-' + 'x'.repeat(24);
  const evaluate = makeEvaluateStubWithSecret(secret);
  const apps = await readApplications(evaluate);

  assert.equal(apps.length, 1);
  assert.equal(apps[0].company, 'TestCorp');
  assert.equal(apps[0].status, 'applied');
  assert.equal(apps[0].normalField, 'safe');

  // Secret fields should be redacted/omitted
  assert.ok(!('secretField' in apps[0]), 'secretField must be redacted from response');
  assert.ok(!('apiKey' in apps[0]), 'apiKey must be redacted from response');
});

test('readApplications redacts secret fields with zero-width space in key', async () => {
  const secret = 'sk-' + 'x'.repeat(24);
  const apps = [{
    id: 'app-1',
    company: 'TestCorp',
    status: 'applied',
    'apiKey\u200B': secret, // zero-width space appended
    normalField: 'safe'
  }];
  const evaluate = makeEvaluateStub(apps);
  const result = await readApplications(evaluate);

  assert.ok(!('apiKey\u200B' in result[0]), 'apiKey with zero-width space must be redacted');
});

test('readApplications redacts secret fields with case variation in key', async () => {
  const secret = 'sk-' + 'x'.repeat(24);
  const apps = [{
    id: 'app-1',
    company: 'TestCorp',
    status: 'applied',
    ApiKey: secret, // different case
    normalField: 'safe'
  }];
  const evaluate = makeEvaluateStub(apps);
  const result = await readApplications(evaluate);

  assert.ok(!('ApiKey' in result[0]), 'ApiKey (case variant) must be redacted');
});

test('readApplications returns ordinary fields unchanged when no secrets present', async () => {
  const apps = [{
    id: 'app-1',
    company: 'TestCorp',
    status: 'applied',
    normalField: 'safe'
  }];
  const evaluate = makeEvaluateStub(apps);
  const result = await readApplications(evaluate);

  assert.deepEqual(result, apps);
});

test('sendMessage does not include secret fields in logged message', async () => {
  let capturedMsg = null;
  const evaluate = async (expr) => {
    if (expr.startsWith('chrome.runtime.sendMessage')) {
      const match = expr.match(/sendMessage\((.+)\)/);
      if (match) {
        capturedMsg = JSON.parse(match[1]);
      }
    }
    return { success: true };
  };

  const payload = {
    id: 'app-1',
    company: 'TestCorp',
    apiKey: 'sk-' + 'y'.repeat(24),
    normalField: 'safe'
  };

  await sendMessage(evaluate, 'TEST_TYPE', payload);

  assert.ok(capturedMsg, 'message was sent');
  assert.equal(capturedMsg.type, 'TEST_TYPE');
  assert.equal(capturedMsg.payload.company, 'TestCorp');
  assert.equal(capturedMsg.payload.normalField, 'safe');

  // Secret fields should not be in the sent message
  assert.ok(!('apiKey' in capturedMsg.payload), 'apiKey must not be sent in message');
});