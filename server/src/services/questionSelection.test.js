const {
  buildQuestionSetupOptions,
  parseSelectedTags,
  selectQuestions,
} = require("./questionSelection");

describe("questionSelection", () => {
  test("parses comma-separated and repeated tags without duplicates", () => {
    expect(parseSelectedTags(["tree,bfs", "BFS", " queue "])).toEqual([
      "tree",
      "bfs",
      "queue",
    ]);
  });

  test("builds setup options with ordered experience levels and tags by frequency", () => {
    const result = buildQuestionSetupOptions([
      {
        active: true,
        jobRoles: ["software engineer", "backend developer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "bfs"],
      },
      {
        active: true,
        jobRoles: ["Software Engineer"],
        experienceLevels: ["Experienced", "Veteran"],
        tags: ["tree", "BFS", "queue"],
      },
      {
        active: true,
        jobRoles: ["backend developer"],
        experienceLevels: ["Beginner"],
        tags: ["tree", "arrays"],
      },
      {
        active: false,
        jobRoles: ["frontend developer"],
        experienceLevels: ["Beginner"],
        tags: ["css", "tree"],
      },
    ]);

    expect(result).toEqual({
      jobRoles: ["backend developer", "software engineer"],
      experienceLevels: [
        "Beginner",
        "Intermediate",
        "Experienced",
        "Veteran",
      ],
      tags: ["tree", "bfs", "arrays", "queue"],
    });
  });

  test("counts a tag at most once per question when ordering by frequency", () => {
    const result = buildQuestionSetupOptions([
      {
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "TREE", "bfs"],
      },
      {
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["bfs"],
      },
    ]);

    expect(result.tags).toEqual(["bfs", "tree"]);
  });

  test("requires role, experience level, and at least one matching tag", () => {
    const questions = [
      {
        id: "both-tags",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "bfs"],
        priority: 1,
      },
      {
        id: "wrong-role",
        active: true,
        jobRoles: ["frontend developer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "bfs"],
        priority: 100,
      },
      {
        id: "wrong-experience",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Experienced"],
        tags: ["tree", "bfs"],
        priority: 100,
      },
      {
        id: "wrong-tags",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["arrays"],
        priority: 100,
      },
      {
        id: "inactive",
        active: false,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "bfs"],
        priority: 100,
      },
    ];

    const result = selectQuestions(questions, {
      jobRole: "Software Engineer",
      experienceLevel: "intermediate",
      tags: ["tree", "bfs"],
    });

    expect(result.map((question) => question.id)).toEqual(["both-tags"]);
  });

  test("prioritizes questions matching more selected tags before priority", () => {
    const questions = [
      {
        id: "tree-only-high-priority",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree"],
        priority: 100,
      },
      {
        id: "tree-and-bfs-low-priority",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "bfs"],
        priority: 1,
      },
      {
        id: "bfs-only-medium-priority",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["bfs"],
        priority: 50,
      },
    ];

    const result = selectQuestions(
      questions,
      {
        jobRole: "software engineer",
        experienceLevel: "Intermediate",
        tags: ["tree", "bfs"],
      },
      3
    );

    expect(result.map((question) => question.id)).toEqual([
      "tree-and-bfs-low-priority",
      "tree-only-high-priority",
      "bfs-only-medium-priority",
    ]);
  });

  test("uses priority as a tie-breaker when tag matches are equal", () => {
    const questions = [
      {
        id: "low-priority",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree"],
        priority: 1,
      },
      {
        id: "high-priority",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree"],
        priority: 10,
      },
    ];

    const result = selectQuestions(
      questions,
      {
        jobRole: "software engineer",
        experienceLevel: "Intermediate",
        tags: ["tree"],
      },
      2
    );

    expect(result.map((question) => question.id)).toEqual([
      "high-priority",
      "low-priority",
    ]);
  });

  test("applies the final question limit after tag ranking", () => {
    const questions = [
      {
        id: "one-tag",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree"],
        priority: 100,
      },
      {
        id: "two-tags",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree", "bfs"],
        priority: 1,
      },
    ];

    const result = selectQuestions(
      questions,
      {
        jobRole: "software engineer",
        experienceLevel: "Intermediate",
        tags: ["tree", "bfs"],
      },
      1
    );

    expect(result.map((question) => question.id)).toEqual(["two-tags"]);
  });

  test("returns no questions when required setup values are missing", () => {
    const questions = [
      {
        id: "question-1",
        active: true,
        jobRoles: ["software engineer"],
        experienceLevels: ["Intermediate"],
        tags: ["tree"],
      },
    ];

    expect(
      selectQuestions(questions, {
        jobRole: "",
        experienceLevel: "Intermediate",
        tags: ["tree"],
      })
    ).toEqual([]);

    expect(
      selectQuestions(questions, {
        jobRole: "software engineer",
        experienceLevel: "",
        tags: ["tree"],
      })
    ).toEqual([]);

    expect(
      selectQuestions(questions, {
        jobRole: "software engineer",
        experienceLevel: "Intermediate",
        tags: [],
      })
    ).toEqual([]);
  });
});

describe("questionSelection H-01 negative and boundary cases", () => {
  const dataset = [
    { id: "active-1", active: true, jobRoles: ["software engineer"], experienceLevels: ["Intermediate"], tags: ["trees", "bfs"], priority: 5 },
    { id: "active-2", active: true, jobRoles: ["software engineer"], experienceLevels: ["Intermediate"], tags: ["trees"], priority: 5 },
    { id: "inactive", active: false, jobRoles: ["software engineer"], experienceLevels: ["Intermediate"], tags: ["trees", "bfs"], priority: 100 },
    { id: "wrong-role", active: true, jobRoles: ["backend developer"], experienceLevels: ["Intermediate"], tags: ["trees", "bfs"], priority: 20 },
    { id: "wrong-level", active: true, jobRoles: ["software engineer"], experienceLevels: ["Experienced"], tags: ["trees", "bfs"], priority: 20 },
  ];
  const setup = {
    jobRole: " SOFTWARE ENGINEER ",
    experienceLevel: " intermediate ",
    tags: "trees,bfs",
  };

  test("rejects unknown job roles and experience levels", () => {
    expect(selectQuestions(dataset, { ...setup, jobRole: "unknown role" })).toEqual([]);
    expect(selectQuestions(dataset, { ...setup, experienceLevel: "invalid" })).toEqual([]);
  });

  test("returns no results for unmatched or empty tag combinations", () => {
    expect(selectQuestions(dataset, { ...setup, tags: "graphs" })).toEqual([]);
    expect(selectQuestions(dataset, { ...setup, tags: " , , " })).toEqual([]);
    expect(parseSelectedTags([null, "tree,", "TREE"])).toEqual(["tree"]);
  });

  test("returns an empty result for an empty repository response", () => {
    expect(selectQuestions([], setup)).toEqual([]);
    expect(buildQuestionSetupOptions([])).toEqual({
      jobRoles: [], experienceLevels: [], tags: [],
    });
  });

  test("skips records missing filter metadata, including null documents", () => {
    const invalidRecords = [
      null,
      { id: "missing-roles", active: true, experienceLevels: ["Intermediate"], tags: ["trees"] },
      { id: "missing-levels", active: true, jobRoles: ["software engineer"], tags: ["trees"] },
      { id: "missing-tags", active: true, jobRoles: ["software engineer"], experienceLevels: ["Intermediate"] },
      { id: "wrong-type", active: true, jobRoles: "software engineer", experienceLevels: ["Intermediate"], tags: ["trees"] },
    ];
    expect(selectQuestions([...invalidRecords, dataset[0]], setup).map((q) => q.id))
      .toEqual(["active-1"]);
    expect(buildQuestionSetupOptions(invalidRecords)).toEqual({
      jobRoles: ["software engineer"],
      experienceLevels: ["Intermediate"],
      tags: ["trees"],
    });
  });

  test("does not return inactive questions even with better match and priority", () => {
    expect(selectQuestions(dataset, setup).map((q) => q.id)).toEqual([
      "active-1", "active-2",
    ]);
  });

  test("breaks equal tag-count and priority ties by question ID", () => {
    const matching = [
      { ...dataset[1], id: "z" },
      { ...dataset[1], id: "a" },
    ];
    expect(selectQuestions(matching, setup).map((q) => q.id)).toEqual(["a", "z"]);
  });

  test("limits the results after filtering, including a zero limit", () => {
    expect(selectQuestions(dataset, setup, 1).map((q) => q.id)).toEqual(["active-1"]);
    expect(selectQuestions(dataset, setup, 0)).toEqual([]);
  });
});
