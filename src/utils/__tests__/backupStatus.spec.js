import { strict as assert } from 'node:assert';
import { isWalletBackedUp, walletBackupGroups } from '../backupStatus.js';

const personal = { id: 'personal', name: 'Personal', type: 'spark' };
const business = { id: 'business', name: 'Business', type: 'spark', metadata: { hasBackedUp: false } };
const arkade = { id: 'arkade', name: 'Arkade', type: 'arkade' };

// Older Spark installs have only the store flag. Explicit wallet metadata wins.
assert.equal(isWalletBackedUp(personal, true), true);
assert.equal(isWalletBackedUp(personal, false), false);
assert.equal(isWalletBackedUp(business, true), false);
assert.equal(isWalletBackedUp(arkade, true), false);

// A saved Spark phrase never marks Arkade or a connected wallet as saved.
const groups = walletBackupGroups([
  personal, business, arkade,
  { id: 'nwc', type: 'nwc', metadata: { hasBackedUp: true } },
  { id: 'lnbits', type: 'lnbits' },
], true);
assert.equal(groups.length, 2);
assert.deepEqual(groups[0], {
  key: 'spark', walletId: 'personal', type: 'spark', names: ['Personal', 'Business'], saved: false,
});
assert.equal(groups[1].saved, false);
assert.equal(groups[1].walletId, 'arkade');

// Completing Spark leaves the other phrase outstanding; removal updates the list.
business.metadata.hasBackedUp = true;
assert.deepEqual(walletBackupGroups([personal, business, arkade], true).map(g => g.saved), [true, false]);
arkade.metadata = { hasBackedUp: true };
assert.equal(walletBackupGroups([arkade])[0].saved, true);
assert.deepEqual(walletBackupGroups([]), []);
assert.deepEqual(walletBackupGroups([{ type: 'nwc' }, { type: 'lnbits' }]), []);
console.log('backupStatus: all checks passed');
