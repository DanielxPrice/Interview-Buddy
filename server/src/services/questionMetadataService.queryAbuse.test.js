"use strict";

const { createQuestionMetadataService } = require("./questionMetadataService");

function setup() {
  let time = 0;
  let revision = 1;
  const catalogRepository = { getRevision: jest.fn(async () => revision) };
  const questionRepository = {
    findByModeMetadata: jest.fn(async (mode) => [{
      id: `q-${mode}`, mode, active: true,
      jobRoles: ["Developer"], experienceLevels: ["Beginner"], tags: ["trees"],
    }]),
    findByMode: jest.fn(() => { throw new Error("Must use projection"); }),
  };
  const service = createQuestionMetadataService({
    questionRepository, catalogRepository, now: () => time,
  });
  return {
    service, questionRepository, catalogRepository,
    advance: (ms) => { time += ms; },
    setRevision: (value) => { revision = value; },
  };
}

describe("SEC-05 metadata projection and revision-aware cache", () => {
  test("cold concurrent metadata requests coalesce into three bounded projection reads", async () => {
    const f = setup();
    const [a, b, c] = await Promise.all([
      f.service.getMetadata(), f.service.getMetadata(), f.service.getMetadata(),
    ]);
    expect(a).toEqual(b);
    expect(a).toEqual(c);
    expect(a.version).toBe(1);
    expect(f.questionRepository.findByModeMetadata).toHaveBeenCalledTimes(3);
    expect(f.questionRepository.findByMode).not.toHaveBeenCalled();
    expect(f.catalogRepository.getRevision).toHaveBeenCalledTimes(2);
  });

  test("cached revision avoids repeated scans; new revision triggers one rebuild", async () => {
    const f = setup();
    await f.service.getMetadata();
    await f.service.getMetadata();
    expect(f.questionRepository.findByModeMetadata).toHaveBeenCalledTimes(3);
    f.setRevision(2);
    f.advance(10001);
    const changed = await f.service.getMetadata();
    expect(changed.version).toBe(2);
    expect(f.questionRepository.findByModeMetadata).toHaveBeenCalledTimes(6);
  });
});
