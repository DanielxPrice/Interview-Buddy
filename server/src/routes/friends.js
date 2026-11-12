
"use strict";

const express = require("express");

const PUBLIC_REPOSITORY_ERRORS = new Set([
  "invalid-friend-uid",
  "self-friend-request",
  "friend-user-not-found",
  "friend-user-unavailable",
  "already-friends",
  "friend-request-declined",
  "friend-request-pending",
  "friend-request-forbidden",
  "friend-request-not-found",
  "friend-request-finalized",
  "friendship-not-accepted",
  "friendship-data-invalid",
  "invalid-friend-status",
]);

function hasControlChars(value) {
  return [...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
  );
}

function validUid(uid) {
  return (
    typeof uid === "string" &&
    uid.length > 0 &&
    uid.length <= 128 &&
    uid.trim() === uid &&
    !uid.includes("/") &&
    !hasControlChars(uid)
  );
}

function publicRelationship(record) {
  return {
    id: record.id,
    requesterUid: record.requesterUid,
    recipientUid: record.recipientUid,
    status: record.status,
  };
}

function publicUser(profile, uid) {
  if (
    !profile ||
    profile.deleting === true ||
    profile.status === "deleting" ||
    typeof profile.username !== "string" ||
    !profile.username.trim()
  ) {
    return null;
  }

  return {
    uid,
    username: profile.username.trim(),
  };
}

function createFriendsRouter({ userRepository, friendshipRepository }) {
  const router = express.Router();

  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });

  const handle = (fn) => async (req, res, next) => {
    if (!req.user?.uid) {
      return res.status(401).json({
        code: "auth-token-required",
        error: "Authentication is required.",
      });
    }

    try {
      await fn(req, res);
    } catch (error) {
      if (
        PUBLIC_REPOSITORY_ERRORS.has(error?.code) &&
        [400, 403, 404, 409, 503].includes(error.statusCode)
      ) {
        return res.status(error.statusCode).json({
          code: error.code,
          error: error.message,
        });
      }

      return next(error);
    }
  };

  // Send a request by username.
  // Repeating an existing pending request is idempotent.
  router.post("/requests", handle(async (req, res) => {
    const username = req.body?.username;

    if (
      typeof username !== "string" ||
      !username.trim() ||
      username.trim().length > 128 ||
      hasControlChars(username)
    ) {
      return res.status(400).json({
        code: "invalid-friend-username",
        error: "A valid username is required.",
      });
    }

    const recipient = await userRepository.findByUsername(
      username.trim()
    );

    if (!recipient) {
      return res.status(404).json({
        code: "friend-user-not-found",
        error: "No account was found with that username.",
      });
    }

    const recipientUid = recipient.id || recipient.uid;

    if (!validUid(recipientUid)) {
      throw new Error(
        "Friend search returned a profile without a valid UID."
      );
    }

    if (recipientUid === req.user.uid) {
      return res.status(400).json({
        code: "self-friend-request",
        error: "You cannot send a friend request to yourself.",
      });
    }

    if (
      recipient.deleting === true ||
      recipient.status === "deleting"
    ) {
      return res.status(409).json({
        code: "friend-user-unavailable",
        error: "This account is unavailable for friend requests.",
      });
    }

    const record = await friendshipRepository.createRequest(
      req.user.uid,
      recipientUid
    );

    return res.status(200).json({
      request: publicRelationship(record),
    });
  }));

  // List pending incoming and outgoing friend requests.
  router.get("/requests", handle(async (req, res) => {
    const [incoming, outgoing] = await Promise.all([
      friendshipRepository.listIncomingRequests(
        req.user.uid,
        "pending"
      ),
      friendshipRepository.listOutgoingRequests(
        req.user.uid,
        "pending"
      ),
    ]);

    const toPublicEntries = (records, otherUidField) =>
      Promise.all(
        records.map(async (record) => {
          const otherUid = record[otherUidField];
          const profile = await userRepository.findById(otherUid);

          return {
            ...publicRelationship(record),
            user: publicUser(profile, otherUid),
          };
        })
      );

    const [publicIncoming, publicOutgoing] = await Promise.all([
      toPublicEntries(incoming, "requesterUid"),
      toPublicEntries(outgoing, "recipientUid"),
    ]);

    return res.json({
      incoming: publicIncoming,
      outgoing: publicOutgoing,
    });
  }));

  // Only the authenticated recipient can accept.
  router.post(
    "/requests/:requesterUid/accept",
    handle(async (req, res) => {
      if (!validUid(req.params.requesterUid)) {
        return res.status(400).json({
          code: "invalid-friend-uid",
          error: "Invalid requester UID.",
        });
      }

      const record = await friendshipRepository.acceptRequest(
        req.params.requesterUid,
        req.user.uid,
        req.user.uid
      );

      return res.json({
        request: publicRelationship(record),
      });
    })
  );

  // Only the authenticated recipient can decline.
  router.post(
    "/requests/:requesterUid/decline",
    handle(async (req, res) => {
      if (!validUid(req.params.requesterUid)) {
        return res.status(400).json({
          code: "invalid-friend-uid",
          error: "Invalid requester UID.",
        });
      }

      const record = await friendshipRepository.declineRequest(
        req.params.requesterUid,
        req.user.uid,
        req.user.uid
      );

      return res.json({
        request: publicRelationship(record),
      });
    })
  );

  // Return accepted friends, never private profile information.
  router.get("/", handle(async (req, res) => {
    const relationships = await friendshipRepository.listFriends(
      req.user.uid
    );

    const friends = await Promise.all(
      relationships.map(async ({ friendUid }) => {
        const profile = await userRepository.findById(friendUid);
        return publicUser(profile, friendUid);
      })
    );

    return res.json({
      friends: friends.filter(Boolean),
    });
  }));

  // Remove an accepted friendship.
  // The repository already handles repeat removals safely.
  router.delete("/:uid", handle(async (req, res) => {
    if (
      !validUid(req.params.uid) ||
      req.params.uid === req.user.uid
    ) {
      return res.status(400).json({
        code: "invalid-friend-uid",
        error: "Invalid friend UID.",
      });
    }

    const removed = await friendshipRepository.removeFriendship(
      req.user.uid,
      req.params.uid
    );

    return res.json({ removed });
  }));

  return router;
}

module.exports = createFriendsRouter;
