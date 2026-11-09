import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRules, getActiveRules } from './verify-deployed-firestore-rules.mjs';

test('H-SOC-07: equivalent rules with CRLF normalize correctly', () => {
  const result = compareRules('allow read: if false;\n', [
    { name: 'firestore.rules', content: 'allow read: if false;\r\n' },
  ]);
  assert.equal(result.match, true);
  assert.equal(typeof result.deployedSha256, 'string');
});
test('H-SOC-07: permissive active rules cause a mismatch', () => {
  assert.equal(compareRules('allow read: if false;\n', [
    { name: 'firestore.rules', content: 'allow read: if true;\n' },
  ]).match, false);
});
test('H-SOC-07: multiple deployed source files are not silently trusted', () => {
  assert.equal(compareRules('a', [{ content: 'a' }, { content: 'b' }]).match, false);
});
test('H-SOC-07: fetches active release and then named ruleset (read-only)', async () => {
  const requested = [];
  const result = await getActiveRules({
    projectId: 'demo-interview-buddy-tests', accessToken: 'fake-test-token',
    fetchImpl: async (url, options) => {
      requested.push([url, options.method]);
      return { ok: true, json: async () => url.includes('/releases/')
        ? { rulesetName: 'projects/demo-interview-buddy-tests/rulesets/123456' }
        : { source: { files: [{ name: 'firestore.rules', content: 'deny all' }] } } };
    },
  });
  assert.equal(result.files[0].content, 'deny all');
  assert.deepEqual(requested.map((request) => request[1]), ['GET', 'GET']);
});
