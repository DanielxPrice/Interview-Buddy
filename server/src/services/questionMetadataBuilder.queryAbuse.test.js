"use strict";

const { buildQuestionMetadata, getOptionsFromMetadata, countIndexedQuestions } = require("./questionMetadataBuilder");
const { countEligibleQuestions } = require("./questionSelection");

describe("SEC-05 question catalog metadata index", () => {
  const questions = [
    { id: "q1", mode: "Quiz Style", active: true, jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["trees", "bfs"], correctAnswer: "secret" },
    { id: "q2", mode: "Quiz Style", active: true, jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["bfs"] },
    { id: "q3", mode: "Quiz Style", active: false, jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["trees"] },
    { id: "q4", mode: "Quiz Style", active: true, jobRoles: ["Full Stack", "Backend Developer"], experienceLevels: ["Beginner", "Experienced"], tags: ["trees"] },
    { id: "q5", mode: "Code Style", active: true, jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["bfs"], referenceAnswer: "private" },
  ];

  test.each([
    ["Backend Developer", "Beginner", ["trees"], 2],
    ["Backend Developer", "Beginner", ["trees", "bfs"], 3],
    ["Backend Developer", "Beginner", ["bfs"], 2],
    ["Backend Developer", "Experienced", ["trees"], 1],
    ["Unknown", "Beginner", ["trees"], 0],
  ])("indexed counts preserve ANY-tag semantics (%s, %s, %j)", (jobRole, experienceLevel, tags, count) => {
    const metadata = buildQuestionMetadata(questions);
    const setup = { jobRole, experienceLevel, tags };
    expect(countIndexedQuestions(metadata, "Quiz Style", setup)).toBe(count);
    expect(countIndexedQuestions(metadata, "Quiz Style", setup)).toBe(
      countEligibleQuestions(questions.filter((q) => q.mode === "Quiz Style"), setup)
    );
  });

  test("metadata options stay compatible without exposing private grading fields", () => {
    const metadata = buildQuestionMetadata(questions);
    expect(getOptionsFromMetadata(metadata, "Quiz Style", {
      jobRole: "backend developer", experienceLevel: "beginner",
    })).toEqual(expect.objectContaining({
      jobRoles: expect.arrayContaining(["Backend Developer"]),
      tags: expect.arrayContaining(["trees", "bfs"]),
    }));
    expect(JSON.stringify(metadata)).not.toContain("secret");
    expect(JSON.stringify(metadata)).not.toContain("private");
    expect(countIndexedQuestions({ modes: {} }, "Quiz Style", {
      jobRole: "Backend Developer", experienceLevel: "Beginner", tags: ["trees"],
    })).toBeNull();
  });
});
