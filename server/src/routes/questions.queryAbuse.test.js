"use strict";

const express = require("express");
const request = require("supertest");
const createQuestionRouter = require("./questions");
const { buildQuestionMetadata } = require("../services/questionMetadataBuilder");

const sourceQuestions = [
  { id: "a", mode: "Quiz Style", active: true, prompt: "One", jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["trees", "bfs"], correctAnswer: "NEVER_EXPOSE" },
  { id: "b", mode: "Quiz Style", active: true, prompt: "Two", jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["bfs"] },
  { id: "c", mode: "Quiz Style", active: false, jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["trees"] },
];

function setup({ withMetadata = true } = {}) {
  const questionRepository = { findByMode: jest.fn(async () => sourceQuestions), findById: jest.fn() };
  const questionQuotaService = { getStatus: jest.fn(), consume: jest.fn() };
  const sessionRepository = { assignQuestions: jest.fn(), findById: jest.fn() };
  const metadata = buildQuestionMetadata(sourceQuestions);
  const questionMetadataService = withMetadata ? {
    getMetadata: jest.fn().mockResolvedValue({ version: 3, ...metadata }),
    getVersion: jest.fn().mockResolvedValue(3),
  } : undefined;
  const app = express();
  app.use((req, _res, next) => { req.user = { uid: "user-1", role: "user" }; next(); });
  app.use("/api/questions", createQuestionRouter({
    questionRepository, questionQuotaService, sessionRepository, questionMetadataService,
  }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ code: error.code || "SERVER_ERROR" }));
  return { app, questionRepository, questionMetadataService, questionQuotaService };
}

const query = { mode: "Quiz Style", jobRole: "Backend Developer", experienceLevel: "Beginner", tags: ["trees", "bfs"] };

describe("SEC-05 question preview query abuse protections", () => {
  test("count uses cached public index, not repeated private question scans", async () => {
    const f = setup();
    for (let i = 0; i < 3; i += 1) {
      const response = await request(f.app).get("/api/questions/count").query({ ...query, fresh: "1" });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ availableCount: 2 });
      expect(response.text).not.toContain("NEVER_EXPOSE");
    }
    expect(f.questionRepository.findByMode).not.toHaveBeenCalled();
    expect(f.questionMetadataService.getMetadata).toHaveBeenCalledTimes(3);
    expect(f.questionQuotaService.consume).not.toHaveBeenCalled();
  });

  test("options use metadata for role and level filtering without question scans", async () => {
    const f = setup();
    const response = await request(f.app).get("/api/questions/options").query({
      mode: "Quiz Style", jobRole: "Backend Developer", experienceLevel: "Beginner",
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      jobRoles: ["Backend Developer"], experienceLevels: ["Beginner"], tags: ["bfs", "trees"],
    });
    expect(response.text).not.toContain("NEVER_EXPOSE");
    expect(f.questionRepository.findByMode).not.toHaveBeenCalled();
  });

  test("legacy preview fallback does not let fresh=1 bypass the server cache", async () => {
    const f = setup({ withMetadata: false });
    for (let i = 0; i < 3; i += 1) {
      const response = await request(f.app).get("/api/questions/count").query({ ...query, fresh: "1" });
      expect(response.status).toBe(200);
      expect(response.body.availableCount).toBe(2);
    }
    expect(f.questionRepository.findByMode).toHaveBeenCalledTimes(1);
  });

  test("count and options reject oversized filters before database access", async () => {
    const f = setup();
    const tooLong = "x".repeat(121);
    const response = await request(f.app).get("/api/questions/count").query({ ...query, jobRole: tooLong });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("QUESTION_PREVIEW_FILTER_INVALID");
    const options = await request(f.app).get("/api/questions/options").query({ mode: "Quiz Style", experienceLevel: tooLong });
    expect(options.status).toBe(400);
    expect(options.body.code).toBe("QUESTION_PREVIEW_FILTER_INVALID");
    expect(f.questionMetadataService.getMetadata).not.toHaveBeenCalled();
    expect(f.questionRepository.findByMode).not.toHaveBeenCalled();
  });

  test("count rejects oversized tag lists and unexpected complex tags", async () => {
    const f = setup();
    const overCount = await request(f.app).get("/api/questions/count").query({
      ...query, tags: Array.from({ length: 31 }, (_, i) => `tag-${i}`),
    });
    expect(overCount.status).toBe(400);
    expect(overCount.body.code).toBe("QUESTION_PREVIEW_FILTER_INVALID");
    expect(f.questionMetadataService.getMetadata).not.toHaveBeenCalled();
  });

  test("metadata failures fail closed instead of scanning private questions", async () => {
    const f = setup();
    f.questionMetadataService.getMetadata.mockRejectedValue(new Error("Metadata unavailable"));
    const response = await request(f.app).get("/api/questions/count").query(query);
    expect(response.status).toBe(500);
    expect(f.questionRepository.findByMode).not.toHaveBeenCalled();
    expect(f.questionQuotaService.consume).not.toHaveBeenCalled();
  });
});
