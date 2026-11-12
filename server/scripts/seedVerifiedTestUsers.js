
"use strict";

/**
 * Create five disposable, email-verified Interview Buddy test users.
 *
 * Run from server/:
 *   node scripts/seedVerifiedTestUsers.js --project=PROJECT_ID --live
 *   node scripts/seedVerifiedTestUsers.js --project=PROJECT_ID --live --apply
 *
 * For emulators, set BOTH FIREBASE_AUTH_EMULATOR_HOST and
 * FIRESTORE_EMULATOR_HOST, then substitute --emulator for --live.
 *
 * The credential Markdown file is stored under the repository's already
 * gitignored server/scripts/output/ directory. Never commit or share it.
 */

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ACCOUNT_COUNT = 5;

function parseArgs(argv) {
  if (argv.includes("--help")) return { help: true };

  const projectArg = argv.find((arg) => arg.startsWith("--project="));
  const project = projectArg ? projectArg.slice("--project=".length).trim() : "";
  const apply = argv.includes("--apply");
  const live = argv.includes("--live");
  const emulator = argv.includes("--emulator");
  const allowed = new Set(["--apply", "--live", "--emulator"]);

  if (projectArg) allowed.add(projectArg);
  const unexpected = argv.filter((arg) => !allowed.has(arg));

  if (!project || unexpected.length || live === emulator) {
    throw new Error(
      "Usage: node scripts/seedVerifiedTestUsers.js " +
      "--project=PROJECT_ID (--live | --emulator) [--apply]"
    );
  }

  if (project !== process.env.FIREBASE_PROJECT_ID) {
    throw new Error(
      `Project mismatch: --project=${project}, ` +
      `FIREBASE_PROJECT_ID=${process.env.FIREBASE_PROJECT_ID || "(unset)"}.`
    );
  }

  const authEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const firestoreEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  if (authEmulator !== firestoreEmulator) {
    throw new Error(
      "Refusing mixed environments. Set BOTH Firebase Auth and " +
      "Firestore emulator hosts, or unset BOTH."
    );
  }

  if (live && authEmulator) {
    throw new Error(
      "--live cannot be used while Firebase emulators are configured."
    );
  }

  if (emulator && !authEmulator) {
    throw new Error(
      "--emulator requires FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST."
    );
  }

  return { project, apply, live, emulator };
}

function makeAccounts() {
  const uniqueTag = crypto.randomBytes(5).toString("hex");

  return Array.from({ length: ACCOUNT_COUNT }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    const username = `IBTest${number}_${uniqueTag}`;

    return {
      username,
      email: `${username.toLowerCase()}@example.test`,
      password: `IB!${crypto.randomBytes(20).toString("base64url")}9aA`,
    };
  });
}

function makeReport(project, target, outputFile) {
  fs.mkdirSync(path.dirname(outputFile), {
    recursive: true,
    mode: 0o700,
  });

  const heading = [
    "# Interview Buddy - Verified Test Accounts",
    "",
    "**SENSITIVE: Contains working passwords. Do not commit, share publicly, or email.**",
    "",
    `- Firebase project: \`${project}\``,
    `- Target: ${target}`,
    `- Created (UTC): ${new Date().toISOString()}`,
    "- Email addresses use the reserved `.test` domain and have no mailbox.",
    "- These accounts are administratively marked verified for testing only.",
    "- All accounts have standard `user` privileges.",
    "",
    "| Username | Email | Password | Firebase UID | Verified | Role |",
    "| --- | --- | --- | --- | --- | --- |",
  ].join("\n") + "\n";

  fs.writeFileSync(outputFile, heading, {
    flag: "wx",
    mode: 0o600,
  });
}

async function run() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(
      "Usage: node scripts/seedVerifiedTestUsers.js " +
      "--project=PROJECT_ID (--live | --emulator) [--apply]"
    );
    return;
  }

  const target = options.live
    ? "LIVE FIREBASE"
    : "FIREBASE EMULATORS";

  console.log(`Firebase project: ${options.project}`);
  console.log(`Target: ${target}`);
  console.log(`Mode: ${options.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Accounts to create: ${ACCOUNT_COUNT}`);

  if (!options.apply) {
    console.log("No changes made and no passwords generated.");
    console.log(
      "Add --apply to create five new accounts and their Markdown file."
    );
    return;
  }

  const { admin, db } = require("../src/firebaseAdmin");

  const FirestoreUserRepository = require(
    "../src/repositories/firestore/FirestoreUserRepository"
  );

  const { DEFAULT_USER_ROLE } = require("../src/config/roles");

  const repository = new FirestoreUserRepository({
    db,
    admin,
  });

  const auth = admin.auth();
  const accounts = makeAccounts();

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const outputFile = path.join(
    __dirname,
    "output",
    `verified-test-users-${stamp}.md`
  );

  makeReport(options.project, target, outputFile);

  let successful = 0;

  console.log(`Private credentials file: ${outputFile}`);

  for (const account of accounts) {
    let createdUser;

    try {
      // Create Firebase Authentication account.
      createdUser = await auth.createUser({
        email: account.email,
        password: account.password,
        displayName: account.username,
        emailVerified: true,
        disabled: false,
      });

      // Assign default user role.
      await auth.setCustomUserClaims(createdUser.uid, {
        role: DEFAULT_USER_ROLE,
      });

      // Create Firestore profile and reserve unique username.
      const profile = await repository.createProfile({
        uid: createdUser.uid,
        username: account.username,
        email: account.email,
      });

      // Validate profile creation.
      if (
        profile.uid !== createdUser.uid ||
        profile.role !== DEFAULT_USER_ROLE
      ) {
        throw new Error(
          "Created profile failed validation."
        );
      }

      // Save account credentials to Markdown.
      fs.appendFileSync(
        outputFile,
        `| ${account.username} | ${account.email} | ` +
          `\`${account.password}\` | \`${createdUser.uid}\` | Yes | ` +
          `${DEFAULT_USER_ROLE} |\n`,
        { encoding: "utf8" }
      );

      successful += 1;

      console.log(
        `CREATED ${successful}/${ACCOUNT_COUNT}: ${account.email}`
      );

    } catch (error) {
      // Roll back Authentication if the Firestore profile
      // was not successfully created.
      if (createdUser) {
        try {
          const storedProfile = await db
            .collection("users")
            .doc(createdUser.uid)
            .get();

          if (!storedProfile.exists) {
            await auth.deleteUser(createdUser.uid);

            console.error(
              `Rolled back incomplete Auth user ${createdUser.uid}.`
            );
          } else {
            console.error(
              `Partial account retained for inspection: UID ${createdUser.uid}.`
            );
          }

        } catch (rollbackError) {
          console.error(
            `Rollback check failed for UID ${createdUser.uid}: ${rollbackError.message}`
          );
        }
      }

      console.error(
        `FAILED on ${account.email}: ${error.message}`
      );

      console.error(
        `Successful credentials already saved: ${outputFile}`
      );

      throw error;
    }
  }

  // Write final account creation summary.
  fs.appendFileSync(
    outputFile,
    `\n**Created successfully: ${successful}/${ACCOUNT_COUNT}**\n`
  );

  console.log(
    `Done: ${successful} verified users created in Auth + Firestore.`
  );

  console.log(`Credentials: ${outputFile}`);

  console.log(
    "Keep the Markdown file private; it contains plaintext passwords."
  );
}

run().catch((error) => {
  console.error(
    `Test-user seeding failed: ${error.message || error}`
  );

  process.exitCode = 1;
});
