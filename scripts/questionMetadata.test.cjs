const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQuestionMetadata, getOptionsFromMetadata, MODES } =
  require('../server/src/services/questionMetadataBuilder');
const { buildQuestionSetupOptions } = require('../server/src/services/questionSelection');
const { createQuestionMetadataService } = require('../server/src/services/questionMetadataService');
const { relevantMetadata } = require('../functions/relevantMetadata');

const questions = require('../server/seed/questions.json');
const key = (x) => String(x || '').trim().toLowerCase();
const has = (list, value) => Array.isArray(list) && list.some((v) => key(v) === key(value));

test('generated metadata is equivalent to existing questionSelection output for every role and level', () => {
  const snapshot = buildQuestionMetadata(questions);
  for (const mode of MODES) {
    const active = questions.filter((q) => q.mode === mode && q.active !== false);
    const basic = getOptionsFromMetadata(snapshot, mode);
    assert.deepEqual(basic, buildQuestionSetupOptions(active));
    for (const role of basic.jobRoles) {
      const filteredRole = active.filter((q) => has(q.jobRoles, role));
      const expectedLevels = buildQuestionSetupOptions(filteredRole).experienceLevels;
      const roleOptions = getOptionsFromMetadata(snapshot, mode, { jobRole: role });
      assert.deepEqual(roleOptions, {
        jobRoles: basic.jobRoles,
        experienceLevels: expectedLevels,
        tags: buildQuestionSetupOptions(filteredRole).tags,
      });
      for (const level of expectedLevels) {
        const expectedTags = buildQuestionSetupOptions(
          filteredRole.filter((q) => has(q.experienceLevels, level))
        ).tags;
        assert.deepEqual(getOptionsFromMetadata(snapshot, mode, {
          jobRole: role, experienceLevel: level,
        }).tags, expectedTags);
      }
    }
    for (const level of basic.experienceLevels) {
      const expectedTags = buildQuestionSetupOptions(
        active.filter((q) => has(q.experienceLevels, level))
      ).tags;
      assert.deepEqual(getOptionsFromMetadata(snapshot, mode, {
        experienceLevel: level,
      }).tags, expectedTags);
    }
  }
});

test('metadata never contains sensitive question payload fields', () => {
  const metadata = buildQuestionMetadata(questions);
  const serialized = JSON.stringify(metadata);
  for (const field of ['correctAnswer', 'gradingCriteria', 'referenceAnswer', 'prompt', 'explanation']) {
    assert.equal(serialized.includes(`"${field}":`), false);
  }
});

test('timestamp-only edits and array reordering do not invalidate the catalog', () => {
  const a = { mode: 'Code Style', active: true, tags: ['trees', 'bfs'],
    jobRoles: ['software engineer'], experienceLevels: ['Beginner'], updatedAt: 1 };
  const b = { ...a, tags: ['BFS', 'trees'], updatedAt: 2 };
  assert.deepEqual(relevantMetadata(a), relevantMetadata(b));
  assert.notDeepEqual(relevantMetadata(a), relevantMetadata({ ...a, tags: ['graphs'] }));
  assert.notDeepEqual(relevantMetadata(a), relevantMetadata(null));
});

test('shared version prevents repeated scans and changes invalidate the server cache', async () => {
  let revision = 1;
  let reads = 0;
  let stamp = 100000;
  const service = createQuestionMetadataService({
    questionRepository: {
      findByMode: async (mode) => {
        reads += 1;
        return questions.filter((q) => q.mode === mode).slice(0, 5);
      },
    },
    catalogRepository: { getRevision: async () => revision },
    now: () => stamp,
  });
  const [first, second] = await Promise.all([service.getMetadata(), service.getMetadata()]);
  assert.deepEqual(first, second);
  assert.equal(reads, 3);
  await service.getMetadata();
  assert.equal(reads, 3);
  revision = 2;
  stamp += 11000;
  const updated = await service.getMetadata();
  assert.equal(updated.version, 2);
  assert.equal(reads, 6);
});

test('a revision change during a scan cannot publish outdated metadata', async () => {
  let revision = 1;
  const service = createQuestionMetadataService({
    questionRepository: { findByMode: async () => { revision = 2; return []; } },
    catalogRepository: { getRevision: async () => revision },
  });
  await assert.rejects(service.getMetadata(), /Catalog updated during metadata rebuild/);
  const updated = await service.getMetadata();
  assert.equal(updated.version, 2);
});
