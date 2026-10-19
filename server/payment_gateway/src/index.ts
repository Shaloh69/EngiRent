import { ConfigError, loadConfig } from "./config";
import { createApp } from "./app";
import { createForwarder } from "./forward";
import { createPayMongo } from "./paymongo";

try {
  const cfg = loadConfig(process.env);
  const app = createApp(cfg, createPayMongo(cfg.paymongoSecretKey), createForwarder(cfg));
  app.listen(cfg.port, () => {
    console.log(
      `[gateway] ${cfg.env} gateway listening on ${cfg.port}; webhook ${cfg.webhookSecret ? "configured" : "NOT configured (answers 503)"}; transfers ${cfg.sourceAccount ? "configured" : "not configured"}`,
    );
  });
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`[gateway] REFUSING TO START: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
