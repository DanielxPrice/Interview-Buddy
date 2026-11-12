"use strict";

/**
 * Data-layer contract for canonical friend requests / friendships.
 *
 * Routes and authentication belong to the application team. In particular,
 * endpoints must obtain the acting UID from the verified Firebase ID token,
 * never from an untrusted request body.
 */
class FriendshipRepository {
  constructor() {
    if (new.target === FriendshipRepository) {
      throw new Error("FriendshipRepository is an interface and cannot be instantiated directly.");
    }
  }

  async findRelationship(_firstUid, _secondUid) {
    throw new Error("findRelationship() must be implemented.");
  }

  async createRequest(_requesterUid, _recipientUid) {
    throw new Error("createRequest() must be implemented.");
  }

  async acceptRequest(_requesterUid, _recipientUid, _actorUid) {
    throw new Error("acceptRequest() must be implemented.");
  }

  async declineRequest(_requesterUid, _recipientUid, _actorUid) {
    throw new Error("declineRequest() must be implemented.");
  }

  async removeFriendship(_firstUid, _secondUid) {
    throw new Error("removeFriendship() must be implemented.");
  }

  async listIncomingRequests(_recipientUid, _status) {
    throw new Error("listIncomingRequests() must be implemented.");
  }

  async listOutgoingRequests(_requesterUid, _status) {
    throw new Error("listOutgoingRequests() must be implemented.");
  }

  async listFriends(_userUid) {
    throw new Error("listFriends() must be implemented.");
  }

  async listFriendsLeaderboard(_userUid) {
    throw new Error("listFriendsLeaderboard() must be implemented.");
  }
}

module.exports = FriendshipRepository;
