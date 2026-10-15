const { auditQuestions } = require("./auditQuestionSelectability");

const sample = [
  {
    id: "ranked-first", mode: "Code Style", active: true,
    jobRoles: ["software engineer"], experienceLevels: ["Intermediate"],
    tags: ["trees"], priority: 10,
  },
  {
    id: "ranked-second", mode: "Code Style", active: true,
    jobRoles: ["software engineer"], experienceLevels: ["Intermediate"],
    tags: ["trees"], priority: 1,
  },
  {
    id: "inactive", mode: "Code Style", active: false,
    jobRoles: ["software engineer"], experienceLevels: ["Intermediate"],
    tags: ["trees"], priority: 100,
  },
];

describe("H-01 local question-selectability audit", () => {
  test("reports active questions not selected within the requested limit", () => {
    const result = auditQuestions(sample, 1);
    expect(result.activeQuestions).toBe(2);
    expect(result.neverSelectedInCheckedSetups).toBe(1);
    expect(result.questions.map((q) => q.id)).toEqual(["ranked-second"]);
    expect(result.byMode["Code Style"]).toBe(1);
  });

  test("shows that the same question may be reachable with a larger limit", () => {
    const result = auditQuestions(sample, 2);
    expect(result.neverSelectedInCheckedSetups).toBe(0);
    expect(result.questions).toEqual([]);
  });
});
