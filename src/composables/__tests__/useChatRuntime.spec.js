/**
 * The UI's accessor to the chat runtime.
 *
 * Run directly with Node:
 *   node --test src/composables/__tests__/useChatRuntime.spec.js
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_ACTIONS } from '../../services/dm/runtime.js';
import { DM_ERROR, DmError } from '../../services/dm/errors.js';
import { publishChatRuntime, useChatRuntime } from '../useChatRuntime.js';

const fakeRuntime = (me) => {
  const calls = [];
  const runtime = { me, calls };
  for (const name of CHAT_ACTIONS) {
    runtime[name] = (...args) => {
      calls.push([name, ...args]);
      return name === 'checkPayable' || name === 'requestState' ? `${me}:${name}` : Promise.resolve(`${me}:${name}`);
    };
  }
  return runtime;
};

test('the facade covers every action of the runtime', () => {
  const chat = useChatRuntime();
  for (const name of CHAT_ACTIONS) assert.equal(typeof chat[name], 'function', name);
});

test('without a runtime nothing is available and actions reject with NO_IDENTITY', async () => {
  publishChatRuntime(null);
  const chat = useChatRuntime();
  assert.equal(chat.available.value, false);
  assert.equal(chat.me.value, null);
  await assert.rejects(chat.sendText('a', 'b'), (e) => DmError.is(e, DM_ERROR.NO_IDENTITY));
  await assert.rejects(chat.partnerReachability('a'), (e) => DmError.is(e, DM_ERROR.NO_IDENTITY));
  assert.equal(chat.requestState('x'), null);
  assert.deepEqual(chat.checkPayable({}, 'w'), { ok: false, reason: DM_ERROR.NO_IDENTITY });
});

test('calls go to the CURRENT runtime, also after it was replaced', async () => {
  const chat = useChatRuntime();
  const first = fakeRuntime('first');
  const second = fakeRuntime('second');

  publishChatRuntime(first);
  assert.equal(chat.available.value, true);
  assert.equal(chat.me.value, 'first');
  assert.equal(await chat.sendText('p', 'hi', { replyTo: 'r' }), 'first:sendText');
  assert.deepEqual(first.calls[0], ['sendText', 'p', 'hi', { replyTo: 'r' }]);

  publishChatRuntime(second);
  assert.equal(await chat.requestMoney('p', { amountSats: 1 }), 'second:requestMoney');
  assert.equal(chat.checkPayable({}, 'w'), 'second:checkPayable');
  assert.equal(chat.requestState('x'), 'second:requestState');
  assert.equal(first.calls.length, 1, 'the replaced runtime is not called again');

  publishChatRuntime(null);
  assert.equal(chat.available.value, false);
});
