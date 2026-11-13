// server/src/services/codeStyleRubric.js
//
// The single source of truth for the Code Style grading rubric.
// Every Code Style question in server/seed/questions.json uses this rubric.
// After changing it, run `npm run apply-code-style-rubric` (from /server) to
// update the seed file, then reseed Firestore with `npm run seed`.
//
// Weights must total 100. See CODE_STYLE_EVALUATION.md for why each weight
// was chosen and how the change affects ELO.

const CODE_STYLE_RUBRIC = Object.freeze(
  [
    {
      name: "Core correctness",
      weight: 60,
      description:
        "Award for functioning logic that satisfies the exact stated input/output contract, required transformations, result format, ordering and value semantics. Judge the submitted code or SQL, not a prose claim. Equivalent algorithms are accepted. Do not deduct here solely for a missing written explanation or for style issues.",
    },
    {
      name: "Edge cases and robustness",
      weight: 15,
      description:
        "Award for correct behavior on the explicitly defined empty, minimal, duplicate, boundary, tie, no-result or other applicable inputs. Do not invent unstated requirements or require prose to demonstrate handling.",
    },
    {
      name: "Efficiency",
      weight: 10,
      description:
        "Award for reasonable algorithmic time and space complexity and appropriate data structures for the stated task. Judge the code itself; a separate complexity discussion is not required. Do not deduct here for naming, formatting or other readability issues.",
    },
    {
      name: "Readability and code style",
      weight: 10,
      description:
        "Award for code that is easy to read and maintain: clear, descriptive names; sensible structure and decomposition; no dead, commented-out or needlessly duplicated code; consistent formatting and indentation; and idiomatic use of the language. Accept any consistent convention (for example camelCase or snake_case) and do not require comments; do not award points for comments that only restate the code. Style cannot make up for missing logic: if the code does not genuinely attempt the task (for example an empty or placeholder function), award 0 for this criterion.",
    },
    {
      name: "Explanation",
      weight: 5,
      description:
        "Award up to five points for an optional concise, technically accurate explanation of the implementation. Missing prose costs at most these five points and must not reduce correctness, edge-case, efficiency, or readability points.",
    },
  ].map((criterion) => Object.freeze(criterion))
);

module.exports = { CODE_STYLE_RUBRIC };