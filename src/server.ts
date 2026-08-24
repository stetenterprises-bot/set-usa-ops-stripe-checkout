import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = createApp(config);

const host = config.stripeMode === "live" ? "0.0.0.0" : "127.0.0.1";
app.listen(config.port, host, () => {
  console.info(`SET Stripe server listening on ${host}:${config.port} in ${config.stripeMode ?? "test"} mode`);
});
