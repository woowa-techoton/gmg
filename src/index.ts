import "dotenv/config";
import { loadConfig } from "./config.js";
import { createGmgSlackApp } from "./slack/app.js";

const config = loadConfig();
const { app } = createGmgSlackApp(config);

if (config.socketMode) {
  await app.start();
} else {
  await app.start(config.port);
}

console.log("GMG Slack bot is running.");
