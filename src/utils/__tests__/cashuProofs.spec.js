import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Amount } from '@cashu/cashu-ts';
import { plainProof, plainProofs } from '../cashuProofs.js';

const base = { id: '009a1f293253e41e', secret: 'secret', C: '02c0' };

test('every way an amount arrives becomes a number', () => {
  for (const amount of [8, '8', Amount.from(8), structuredClone(Amount.from(8))]) {
    assert.deepEqual(plainProof({ ...base, amount }), { ...base, amount: 8 });
  }
});

test('JSON of a plain proof keeps the amount a number', () => {
  const json = JSON.stringify(plainProof({ ...base, amount: Amount.from(32) }));
  assert.equal(JSON.parse(json).amount, 32);
});

test('other proof fields travel along unchanged', () => {
  const dleq = { e: 'aa', s: 'bb', r: 'cc' };
  assert.deepEqual(plainProof({ ...base, amount: '2', dleq, witness: 'w' }), { ...base, amount: 2, dleq, witness: 'w' });
});

test('anything that is not a usable proof is left out', () => {
  const unusable = [
    null,
    'proof',
    { ...base, amount: 0 },
    { ...base, amount: -4 },
    { ...base, amount: 1.5 },
    { ...base, amount: 'eight' },
    { ...base, amount: '9007199254740993' },
    { id: base.id, secret: base.secret, amount: 8 },
  ];
  assert.deepEqual(plainProofs([...unusable, { ...base, amount: '4' }]), [{ ...base, amount: 4 }]);
  assert.deepEqual(plainProofs(undefined), []);
});
