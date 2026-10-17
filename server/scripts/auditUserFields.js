require("dotenv").config();

const {
  db,
} = require("../src/firebaseAdmin");

const REQUIRED_FIELDS = [
  "uid",
  "username",
  "usernameLower",
  "email",
  "role",
  "settings",
  "createdAt",
  "updatedAt",
];

async function main() {
  console.log(
    "\nAuditing Firestore user fields...\n"
  );

  const snapshot = await db
    .collection("users")
    .get();

  let completeUsers = 0;
  let incompleteUsers = 0;

  for (const document of snapshot.docs) {
    const data = document.data();

    const missingFields =
      REQUIRED_FIELDS.filter(
        (field) =>
          data[field] === undefined
      );
    
    if (
        data.settings &&
        data.settings.theme === undefined
    ) {
        missingFields.push(
            "settings.theme"
    );
    }

    if (missingFields.length === 0) {
      completeUsers += 1;

      console.log(
        `PASS | ${data.email || document.id}`
      );

      continue;
    }

    incompleteUsers += 1;

    console.log(
      `\nFAIL | ${data.email || document.id}`
    );

    console.log(
      `UID: ${document.id}`
    );

    console.log(
      `Missing fields: ${missingFields.join(", ")}`
    );
  }

  console.log(
    "\nField audit summary"
  );

  console.log(
    "------------------------------"
  );

  console.log(
    `Users scanned: ${snapshot.size}`
  );

  console.log(
    `Complete users: ${completeUsers}`
  );

  console.log(
    `Incomplete users: ${incompleteUsers}`
  );

  if (incompleteUsers > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(
    "User field audit failed:",
    error.message || error
  );

  process.exitCode = 1;
});