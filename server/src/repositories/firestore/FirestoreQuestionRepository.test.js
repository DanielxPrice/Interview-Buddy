const FirestoreQuestionRepository = require("./FirestoreQuestionRepository");
const { QUESTION_MODE_SCAN_LIMIT } = require("../../config/questionCatalogLimits");

describe("FirestoreQuestionRepository", () => {
  test("requires a Firestore database instance", () => {
    expect(() => new FirestoreQuestionRepository({})).toThrow(
      /requires a Firestore db instance/
    );
  });

  describe("findByMode", () => {
    test.each(["Quiz Style", "Code Style", "Theoretical Style"])(
      "queries only %s documents and returns their Firestore IDs",
      async (mode) => {
        const documents = [
          { id: "q-1", data: () => ({ mode, prompt: "First question" }) },
          { id: "q-2", data: () => ({ mode, prompt: "Second question" }) },
        ];
        const get = jest.fn().mockResolvedValue({ docs: documents });
        const limit = jest.fn().mockReturnValue({ get });
        const where = jest.fn().mockReturnValue({ limit });
        const collection = jest.fn().mockReturnValue({ where });
        const repository = new FirestoreQuestionRepository({
          db: { collection },
        });

        await expect(repository.findByMode(mode)).resolves.toEqual([
          { id: "q-1", mode, prompt: "First question" },
          { id: "q-2", mode, prompt: "Second question" },
        ]);
        expect(collection).toHaveBeenCalledWith("questions");
        expect(where).toHaveBeenCalledWith("mode", "==", mode);
        expect(limit).toHaveBeenCalledWith(QUESTION_MODE_SCAN_LIMIT + 1);
        expect(get).toHaveBeenCalledTimes(1);
      }
    );

    test("returns an empty array when the mode has no documents", async () => {
      const db = {
        collection: jest.fn(() => ({
          where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ docs: [] }) })) })),
        })),
      };
      const repository = new FirestoreQuestionRepository({ db });
      await expect(repository.findByMode("Quiz Style")).resolves.toEqual([]);
    });

    test("propagates a failed Firestore query", async () => {
      const db = {
        collection: jest.fn(() => ({
          where: jest.fn(() => ({
            limit: jest.fn(() => ({ get: jest.fn().mockRejectedValue(new Error("Firestore unavailable")) })),
          })),
        })),
      };
      const repository = new FirestoreQuestionRepository({ db });
      await expect(repository.findByMode("Quiz Style")).rejects.toThrow(
        "Firestore unavailable"
      );
    });
  });

  test("mode scans have a hard read ceiling and fail closed instead of truncating", async () => {
    const get = jest.fn().mockResolvedValue({ docs: Array.from({ length: QUESTION_MODE_SCAN_LIMIT + 1 }, (_, i) => ({
      id: `q-${i}`, data: () => ({ mode: "Code Style" }),
    })) });
    const limit = jest.fn(() => ({ get }));
    const db = { collection: () => ({ where: () => ({ limit }) }) };
    const repository = new FirestoreQuestionRepository({ db });
    await expect(repository.findByMode("Code Style")).rejects.toMatchObject({
      statusCode: 503,
      code: "QUESTION_CATALOG_TOO_LARGE",
    });
    expect(limit).toHaveBeenCalledWith(QUESTION_MODE_SCAN_LIMIT + 1);
  });

  test("metadata query uses a bounded field projection without private question data", async () => {
    const get = jest.fn().mockResolvedValue({ docs: [{
      id: "quiz-1", data: () => ({ mode: "Quiz Style", tags: ["trees"] }),
    }] });
    const limit = jest.fn(() => ({ get }));
    const select = jest.fn(() => ({ limit }));
    const where = jest.fn(() => ({ select }));
    const repo = new FirestoreQuestionRepository({ db: {
      collection: jest.fn(() => ({ where })),
    } });
    await expect(repo.findByModeMetadata("Quiz Style")).resolves.toEqual([
      { id: "quiz-1", mode: "Quiz Style", tags: ["trees"] },
    ]);
    expect(select).toHaveBeenCalledWith("mode", "active", "jobRoles", "experienceLevels", "tags");
    expect(limit).toHaveBeenCalledWith(QUESTION_MODE_SCAN_LIMIT + 1);
    expect(get).toHaveBeenCalledTimes(1);
  });

  test("metadata projection also fails closed on oversized mode collections", async () => {
    const docs = Array.from({ length: QUESTION_MODE_SCAN_LIMIT + 1 }, (_, i) => ({
      id: `q${i}`, data: () => ({}),
    }));
    const db = { collection: () => ({ where: () => ({
      select: () => ({ limit: () => ({ get: async () => ({ docs }) }) }),
    }) }) };
    const repo = new FirestoreQuestionRepository({ db });
    await expect(repo.findByModeMetadata("Quiz Style")).rejects.toMatchObject({
      code: "QUESTION_CATALOG_TOO_LARGE", statusCode: 503,
    });
  });

  describe("findById", () => {
    test("returns a document with its Firestore ID", async () => {
      const get = jest.fn().mockResolvedValue({
        exists: true,
        id: "quiz-1",
        data: () => ({ mode: "Quiz Style", prompt: "Example?" }),
      });
      const doc = jest.fn().mockReturnValue({ get });
      const collection = jest.fn().mockReturnValue({ doc });
      const repository = new FirestoreQuestionRepository({ db: { collection } });

      await expect(repository.findById("quiz-1")).resolves.toEqual({
        id: "quiz-1",
        mode: "Quiz Style",
        prompt: "Example?",
      });
      expect(collection).toHaveBeenCalledWith("questions");
      expect(doc).toHaveBeenCalledWith("quiz-1");
    });

    test("returns null when the requested document does not exist", async () => {
      const db = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn().mockResolvedValue({ exists: false }),
          })),
        })),
      };
      const repository = new FirestoreQuestionRepository({ db });
      await expect(repository.findById("missing")).resolves.toBeNull();
    });

    test("propagates a failed Firestore document read", async () => {
      const db = {
        collection: jest.fn(() => ({
          doc: jest.fn(() => ({
            get: jest.fn().mockRejectedValue(new Error("Read failed")),
          })),
        })),
      };
      const repository = new FirestoreQuestionRepository({ db });
      await expect(repository.findById("quiz-1")).rejects.toThrow("Read failed");
    });

    //Verify that findById preserves the private reference answer and grading criteria.
    test("retrieves stored reference answer and grading criteria", async () => {
      const storedQuestion = {
        mode: "Theoretical Style",
        prompt: "Explain closures.",
        referenceAnswer: "A closure retains access to its lexical scope.",
        gradingCriteria: [
          {
            name: "Accuracy",
            weight: 60,
            description: "Correctly explains lexical scope.",
          },
          {
            name: "Clarity",
            weight: 40,
            description: "Explains the concept clearly.",
          },
        ],
      };

      const get = jest.fn().mockResolvedValue({
        exists: true,
        id: "theory-123",
        data: () => storedQuestion,
      });

      const doc = jest.fn().mockReturnValue({ get });
      const collection = jest.fn().mockReturnValue({ doc });

      const repository = new FirestoreQuestionRepository({
        db: { collection },
      });

      const result = await repository.findById("theory-123");

      expect(collection).toHaveBeenCalledWith("questions");
      expect(doc).toHaveBeenCalledWith("theory-123");
      expect(get).toHaveBeenCalledTimes(1);

      expect(result).toEqual({
        id: "theory-123",
        ...storedQuestion,
      });

      expect(result.referenceAnswer)
        .toBe("A closure retains access to its lexical scope.");

      expect(result.gradingCriteria).toHaveLength(2);
    });
  });

  describe("upsertMany", () => {
    test("splits large question seeds across multiple Firestore batches", async () => {
      const committedBatches = [];
      const setCalls = [];
      const db = {
        collection: jest.fn(() => ({ doc: jest.fn((id) => ({ id })) })),
        batch: jest.fn(() => {
          const batch = {
            set: jest.fn((...args) => setCalls.push(args)),
            commit: jest.fn(async () => committedBatches.push(batch)),
          };
          return batch;
        }),
      };
      const repository = new FirestoreQuestionRepository({ db });
      const questions = Array.from({ length: 1500 }, (_, index) => ({
        id: `question-${index}`,
        mode: "Quiz Style",
        prompt: `Question ${index}`,
      }));

      await expect(repository.upsertMany(questions)).resolves.toBe(1500);
      expect(db.batch).toHaveBeenCalledTimes(4);
      expect(committedBatches).toHaveLength(4);
      expect(setCalls).toHaveLength(1504);
      const questionWrites = setCalls.filter(([ref]) => ref.id !== "questionCatalog");
      const catalogWrites = setCalls.filter(([ref]) => ref.id === "questionCatalog");
      expect(questionWrites).toHaveLength(1500);
      expect(catalogWrites).toHaveLength(4);
      const operationId = questionWrites[0][1]._metadataSeedBatchId;
      expect(operationId).toEqual(expect.any(String));
      expect(operationId).toHaveLength(36);
      expect(questionWrites.every(([, data]) => data._metadataSeedBatchId === operationId)).toBe(true);
      expect(catalogWrites.every(([, data, options]) =>
        data.version && data.updatedAt && options.merge === true
      )).toBe(true);
      expect(setCalls[0][0]).toEqual({ id: "question-0" });
      expect(setCalls[0][1]).toEqual(expect.objectContaining({
        mode: "Quiz Style",
        prompt: "Question 0",
        updatedAt: expect.any(String),
        _metadataSeedBatchId: expect.any(String),
      }));
      expect(setCalls[0][1]).not.toHaveProperty("id");
      expect(setCalls[0][2]).toEqual({ merge: true });
    });

    test("does not write for empty or invalid question batches", async () => {
      const db = { batch: jest.fn() };
      const repository = new FirestoreQuestionRepository({ db });
      await expect(repository.upsertMany([])).resolves.toBe(0);
      await expect(repository.upsertMany(null)).resolves.toBe(0);
      expect(db.batch).not.toHaveBeenCalled();
    });

    test("does not report success when a batch commit fails", async () => {
      const db = {
        collection: jest.fn(() => ({ doc: jest.fn((id) => ({ id })) })),
        batch: jest.fn(() => ({
          set: jest.fn(),
          commit: jest.fn().mockRejectedValue(new Error("Commit failed")),
        })),
      };
      const repository = new FirestoreQuestionRepository({ db });
      await expect(repository.upsertMany([{ id: "q1" }])).rejects.toThrow(
        "Commit failed"
      );
    });
  });
});
