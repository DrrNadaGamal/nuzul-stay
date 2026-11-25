import test from 'node:test';
import assert from 'node:assert/strict';
import { STR, SRV } from '../public/i18n.js';

test('en and ar key sets are identical', () => {
  const en = Object.keys(STR.en).sort(), ar = Object.keys(STR.ar).sort();
  assert.deepEqual(en, ar);
  for (const k of en) {
    assert.ok(STR.en[k] && STR.ar[k], k + ' non-empty');
  }
});
test('no translation leaks english placeholders', () => {
  for (const [k, v] of Object.entries(STR.ar)) {
    if (/^[a-z.]+$/.test(v)) assert.fail(k + ' untranslated: ' + v);
  }
});
test('server error map covers both languages with same rules', () => {
  assert.ok(Array.isArray(SRV.ar) && SRV.ar.length >= 5);
  for (const [re] of SRV.ar) assert.ok(re instanceof RegExp);
});
