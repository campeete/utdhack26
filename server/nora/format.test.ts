import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkFormatted } from './format.ts';

const notes = 'fw logs: admin login from unknown host 03:12 sunday, monday backup ran after';

test('a faithful draft passes', () => {
  const f = checkFormatted(notes, { title: 'Admin login from unknown host on Sunday', source: 'Firewall logs', text: 'Firewall logs show an admin login from an unknown host at 03:12 on Sunday. The Monday backup ran after it.' });
  assert.equal(f.source, 'Firewall logs');
});

test('a draft with an invented time or IP is rejected', () => {
  assert.throws(() => checkFormatted(notes, { title: 'Admin login', source: 'Firewall logs', text: 'An admin logged in from 10.0.0.5 at 03:12.' }), /not in your notes/);
  assert.throws(() => checkFormatted(notes, { title: 'Admin login at 04:00', source: 'x', text: 'y' }), /not in your notes/);
});

test('a malformed answer is rejected', () => {
  assert.throws(() => checkFormatted(notes, { title: '', source: 'x', text: 'y' }), /no title/);
  assert.throws(() => checkFormatted(notes, 'nonsense'), /no title/);
});

import { checkReplacement } from './format.ts';
test('a replacement draft may not invent numbers', () => {
  const inputs = "Restore from Monday's backup\nMonday's backup predates the intrusion\nThe backup started at 04:05, after the 03:12 session.";
  assert.equal(checkReplacement(inputs, { title: 'Pause the restore', assumption: 'A restore point before 03:12 exists' }).title, 'Pause the restore');
  assert.throws(() => checkReplacement(inputs, { title: 'Restore the 22:00 snapshot', assumption: 'x' }), /not in the record/);
});
