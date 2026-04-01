const { runBuyingBot } = require("../Bot - Buying/src/buyingBot");

runBuyingBot().catch((error) => {
  console.error("Automation run failed.");
  console.error(error.message);
  process.exitCode = 1;
});
