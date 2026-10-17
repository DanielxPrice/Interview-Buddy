require("dotenv").config();

const app = require("./app");

const port = Number(process.env.PORT || 5001);


app.listen(port, () => {
  console.log(`Interview Buddy API listening on http://localhost:${port}`);
});
