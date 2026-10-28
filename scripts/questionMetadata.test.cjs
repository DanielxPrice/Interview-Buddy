const test = require('node:test');
const assert = require('node:assert/strict');
const { buildQuestionMetadata, getOptionsFromMetadata, MODES } =
  require('../server/src/services/questionMetadataBuilder');
const { buildQuestionSetupOptions, countEligibleQuestions } = require('../server/src/services/questionSelection');
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


// Independent implementation of the same simple browser index lookup.
// Compare it against the canonical backend count over real seed configurations.
const previewCount = (metadata, mode, jobRole, experienceLevel, tags) => {
  const wanted = new Set(tags.map(key));
  return metadata.modes[mode].countIndex.reduce((sum, row) =>
    row.jobRoles.includes(key(jobRole)) &&
    row.experienceLevels.includes(key(experienceLevel)) &&
    row.tags.some((tag) => wanted.has(tag)) ? sum + row.count : sum, 0);
};

test('cached count index exactly matches backend ANY-tag count without double-counting', () => {
  const metadata = buildQuestionMetadata(questions);
  assert.equal(metadata.schemaVersion, 2);

  for (const mode of MODES) {
    const modeQuestions = questions.filter((question) => question.mode === mode);
    const roles = metadata.modes[mode].all.jobRoles;
    const levels = metadata.modes[mode].all.experienceLevels;
    const tags = metadata.modes[mode].all.tags;
    for (const role of roles) {
      for (const level of levels) {
        const tagSets = [
          [tags[0]],
          [tags[1]],
          [tags[0], tags[1]],
          [tags[0], tags[1], tags[2]],
          ['not-a-real-tag'],
        ];
        for (const selectedTags of tagSets) {
          assert.equal(
            previewCount(metadata, mode, role, level, selectedTags),
            countEligibleQuestions(modeQuestions, {
              jobRole: role, experienceLevel: level, tags: selectedTags,
            }),
            `${mode}, ${role}, ${level}, ${selectedTags.join(', ')}`
          );
        }
      }
    }
  }
});

test('overlapping tags, duplicate metadata, inactive questions, and grouped rows count correctly', () => {
  const fixture = [
    { mode: 'Code Style', active: true, jobRoles: ['Developer', 'Developer'],
      experienceLevels: ['Beginner'], tags: ['Trees', 'BFS', 'BFS'] },
    { mode: 'Code Style', active: true, jobRoles: ['Developer'],
      experienceLevels: ['Beginner'], tags: ['trees', 'bfs'] },
    { mode: 'Code Style', active: true, jobRoles: ['Developer'],
      experienceLevels: ['Beginner'], tags: ['bfs'] },
    { mode: 'Code Style', active: false, jobRoles: ['Developer'],
      experienceLevels: ['Beginner'], tags: ['trees'] },
  ];
  const metadata = buildQuestionMetadata(fixture);
  assert.equal(metadata.modes['Code Style'].countIndex.length, 2);
  assert.equal(previewCount(metadata, 'Code Style', 'DEVELOPER', 'beginner', ['trees', 'bfs']), 3);
  assert.equal(previewCount(metadata, 'Code Style', 'developer', 'Beginner', ['trees']), 2);
  assert.equal(previewCount(metadata, 'Code Style', 'developer', 'Beginner', ['invalid']), 0);
});

test('bundled count metadata stays synchronized with the seed and has no question IDs', () => {
  const bundled = require('../src/data/questionMetadata.json');
  assert.deepEqual(bundled, buildQuestionMetadata(questions));
  const serialized = JSON.stringify(bundled);
  assert.equal(serialized.includes('"id":'), false);
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
