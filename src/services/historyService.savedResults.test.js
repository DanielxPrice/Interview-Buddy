
import { auth } from "../config/firebase";

import {
  historyService,
} from "./historyService";

jest.mock("../config/firebase", () => ({
  auth: {
    currentUser: {
      getIdToken: jest.fn().mockResolvedValue(
        "test-token"
      ),
    },
  },
}));

describe(
  "SEC-03 completed interview History details",
  () => {
    beforeEach(() => {
      jest.clearAllMocks();

      auth.currentUser = {
        getIdToken: jest.fn().mockResolvedValue(
          "test-token"
        ),
      };
    });

    test("fetches saved results from the authenticated details endpoint", async () => {
      const responseBody = {
        id: "session-1",

        breakdown: [
          {
            questionId: "q1",
            feedback: "Good",
          },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseBody,
      });

      await expect(
        historyService.getCompletedSessionResults(
          "session-1"
        )
      ).resolves.toEqual(
        responseBody
      );

      expect(
        global.fetch
      ).toHaveBeenCalledWith(
        "http://localhost:5001/api/sessions/session-1/results",
        {
          headers: {
            Authorization: "Bearer test-token",
          },
        }
      );
    });

    test("requires an authenticated session", async () => {
      auth.currentUser = null;

      await expect(
        historyService.getCompletedSessionResults(
          "session-1"
        )
      ).rejects.toThrow(/sign in/i);
    });

    test("does not fetch without a session ID", async () => {
      global.fetch = jest.fn();

      await expect(
        historyService.getCompletedSessionResults(
          ""
        )
      ).rejects.toThrow(/session ID/i);

      expect(
        global.fetch
      ).not.toHaveBeenCalled();
    });
  }
);
