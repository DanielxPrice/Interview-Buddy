const EXPERIENCE_LEVEL_ORDER = {
  beginner: 1,
  intermediate: 2,
  experienced: 3,
  veteran: 4,
};

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values.map(normalize).filter(Boolean);
}

function alphabeticalSort(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function experienceLevelSort(a, b) {
  const aOrder =
    EXPERIENCE_LEVEL_ORDER[normalize(a)] ?? Number.MAX_SAFE_INTEGER;
  const bOrder =
    EXPERIENCE_LEVEL_ORDER[normalize(b)] ?? Number.MAX_SAFE_INTEGER;

  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return alphabeticalSort(a, b);
}

/**
 * Express can represent a repeated query parameter as an array, while the
 * frontend may also choose to send a comma-separated tag list. Support both
 * forms so the backend contract stays simple:
 *
 *   ?tags=tree&tags=bfs
 *   ?tags=tree,bfs
 */
function parseSelectedTags(value) {
  const values = Array.isArray(value) ? value : [value];

  return [
    ...new Set(
      values
        .flatMap((entry) => String(entry || "").split(","))
        .map(normalize)
        .filter(Boolean)
    ),
  ];
}

function getMatchingTagCount(question, selectedTags) {
  const questionTags = new Set(normalizeArray(question.tags));

  return selectedTags.reduce(
    (count, tag) => count + (questionTags.has(tag) ? 1 : 0),
    0
  );
}

function matchesRequiredSetup(question, setup) {
  const jobRole = normalize(setup.jobRole);
  const experienceLevel = normalize(setup.experienceLevel);

  const jobRoles = new Set(normalizeArray(question.jobRoles));
  const experienceLevels = new Set(normalizeArray(question.experienceLevels));

  return jobRoles.has(jobRole) && experienceLevels.has(experienceLevel);
}

function collectUniqueValues(
  questions,
  field,
  sortFunction = alphabeticalSort
) {
  const seen = new Set();
  const values = [];

  questions.forEach((question) => {
    const entries = Array.isArray(question[field]) ? question[field] : [];

    entries.forEach((entry) => {
      const value = String(entry || "").trim();
      const key = normalize(value);

      if (value && !seen.has(key)) {
        seen.add(key);
        values.push(value);
      }
    });
  });

  return values.sort(sortFunction);
}

/**
 * Order tags by how many active questions contain them. A tag is counted at
 * most once per question. Tags with the same frequency are sorted
 * alphabetically so the order remains deterministic.
 */
function collectTagsByFrequency(questions) {
  const tagCounts = new Map();
  const displayValues = new Map();

  questions.forEach((question) => {
    const tags = Array.isArray(question.tags) ? question.tags : [];
    const tagsInQuestion = new Set();

    tags.forEach((entry) => {
      const value = String(entry || "").trim();
      const key = normalize(value);

      if (!key) {
        return;
      }

      if (!displayValues.has(key)) {
        displayValues.set(key, value);
      }

      tagsInQuestion.add(key);
    });

    tagsInQuestion.forEach((key) => {
      tagCounts.set(key, (tagCounts.get(key) || 0) + 1);
    });
  });

  return [...tagCounts.keys()]
    .sort((a, b) => {
      const countDifference = tagCounts.get(b) - tagCounts.get(a);

      if (countDifference !== 0) {
        return countDifference;
      }

      return alphabeticalSort(displayValues.get(a), displayValues.get(b));
    })
    .map((key) => displayValues.get(key));
}

/**
 * Build the setup-page options from active questions for a selected mode.
 * The repository already limits the input to the requested mode, so this
 * function only extracts the role, experience, and tag metadata available in
 * those stored questions.
 */
function buildQuestionSetupOptions(questions) {
  const activeQuestions = questions.filter(
    (question) => question && question.active !== false
  );

  return {
    jobRoles: collectUniqueValues(activeQuestions, "jobRoles"),
    experienceLevels: collectUniqueValues(
      activeQuestions,
      "experienceLevels",
      experienceLevelSort
    ),
    tags: collectTagsByFrequency(activeQuestions),
  };
}

/**
 * Select questions using the stored Firestore metadata.
 *
 * A question is eligible only when:
 *   1. it is active;
 *   2. its jobRoles contains the selected job role;
 *   3. its experienceLevels contains the selected experience level; and
 *   4. at least one stored question tag matches a selected tag.
 *
 * Eligible questions are ordered by the number of matching tags first. The
 * existing priority field is only a tie-breaker, so a two-tag match always
 * outranks a one-tag match.
 */
function selectQuestions(questions, setup, limit = 10) {
  const selectedTags = parseSelectedTags(setup.tags);

  if (!setup.jobRole || !setup.experienceLevel || selectedTags.length === 0) {
    return [];
  }

  return questions
    .filter((question) => question && question.active !== false)
    .filter((question) => matchesRequiredSetup(question, setup))
    .map((question) => ({
      question,
      matchingTagCount: getMatchingTagCount(question, selectedTags),
    }))
    .filter(({ matchingTagCount }) => matchingTagCount >= 1)
    .sort((a, b) => {
      if (b.matchingTagCount !== a.matchingTagCount) {
        return b.matchingTagCount - a.matchingTagCount;
      }

      const priorityDifference =
        Number(b.question.priority || 0) - Number(a.question.priority || 0);

      if (priorityDifference !== 0) {
        return priorityDifference;
      }

      return String(a.question.id || "").localeCompare(
        String(b.question.id || "")
      );
    })
    .slice(0, limit)
    .map(({ question }) => question);
}

module.exports = {
  buildQuestionSetupOptions,
  parseSelectedTags,
  selectQuestions,
};
