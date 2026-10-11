const SessionRepository = require("../contracts/SessionRepository");
const { db } = require("../firebaseAdmin");

class FirestoreSessionRepository extends SessionRepository {
constructor({ db, admin }) {
super();
this.admin = admin;
this.sessions = db.collection("sessions");
}

async createSession({ userId, mode, jobRole, experienceLevel }) {
const sessionData = {
userId,
mode,
jobRole,
experienceLevel,
status: "in_progress",
createdAt: new Date(),
completedAt: null,
};

```
const docRef = await this.sessions.add(sessionData);

return {
  id: docRef.id,
  ...sessionData,
};
```

}

async findById(sessionId) {
const doc = await this.sessions.doc(sessionId).get();

```
if (!doc.exists) {
  return null;
}

return {
  id: doc.id,
  ...doc.data(),
};
```

}

async listByUser(userId) {
const snapshot = await this.sessions
.where("userId", "==", userId)
.orderBy("createdAt", "desc")
.get();

```
return snapshot.docs.map((doc) => ({
  id: doc.id,
  ...doc.data(),
}));
```

}

async completeSession(sessionId) {
const sessionRef = this.sessions.doc(sessionId);
const doc = await sessionRef.get();

```
if (!doc.exists) {
  throw new Error("Session not found.");
}

await sessionRef.update({
  status: "completed",
  completedAt: new Date(),
});

return this.findById(sessionId);
```

}
}

module.exports = FirestoreSessionRepository;
