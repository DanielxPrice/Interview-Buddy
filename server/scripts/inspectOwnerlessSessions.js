
"use strict";

require("dotenv").config();

const { admin, db } = require("../src/firebaseAdmin");

async function main() {
  console.log("Firebase project:", admin.app().options.projectId);
  console.log("Mode: READ ONLY");
  console.log("");

  const snapshot = await db.collection("sessions").get();

  let missingOwnerCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const userId = data.userId;

    if (typeof userId === "string" && userId.trim()) {
      continue;
    }

    missingOwnerCount += 1;

    const fields = Object.keys(data).sort();

    const possibleOwnerFields = [
      "uid",
      "ownerUid",
      "ownerId",
      "firebaseUid",
      "userUID",
      "user_id",
      "createdBy",
      "user",
    ].filter((field) =>
      Object.prototype.hasOwnProperty.call(data, field)
    );

    console.log(`Session: ${doc.id}`);
    console.log(`  userId type: ${typeof userId}`);
    console.log(`  Fields: ${fields.join(", ")}`);
    console.log(
      `  Other possible ownership fields: ${
        possibleOwnerFields.join(", ") || "none"
      }`
    );
    console.log("");
  }

  console.log("Summary:");
  console.log(`  Total sessions scanned: ${snapshot.size}`);
  console.log(`  Sessions without valid userId: ${missingOwnerCount}`);
  console.log("");
  console.log("Inspection complete. No data modified.");
}

main().catch((error) => {
  console.error("Inspection failed:", error.message);
  process.exitCode = 1;
});
