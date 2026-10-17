const { db } = require("../firebaseAdmin");

let cachedConfig = null;

async function getAiConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const snapshot = await db
    .collection("serverConfig")
    .doc("ai")
    .get();

  if (!snapshot.exists) {
    const error = new Error(
      "AI configuration was not found in Firestore at serverConfig/ai."
    );
    error.statusCode = 503;
    throw error;
  }

  const config = snapshot.data();

  if (!config.anthropicApiKey) {
    const error = new Error(
      "Anthropic API key is missing from Firestore configuration."
    );
    error.statusCode = 503;
    throw error;
  }

  cachedConfig = config;

  return cachedConfig;
}

module.exports = {
  getAiConfig,
};