/**
 * POST /api/config/env  — write known configuration keys to the env store.
 * GET  /api/config/slack — return non-secret Slack config for form pre-fill.
 *
 * Security: only keys in ALLOWED_KEYS can be written. Unknown keys are
 * rejected. This prevents the endpoint from being used to overwrite
 * arbitrary runtime state or redirect integrations.
 */
import { saveEnvFile } from "../config/env.js";

// Exhaustive allowlist — only these keys may be written via the UI.
const ALLOWED_KEYS = new Set([
  "SLACK_BOT_TOKEN", "SLACK_WEBHOOK_URL", "SLACK_DEFAULT_CHANNEL",
  "SLACK_CHANNEL_OPS", "SLACK_CHANNEL_FINANCE", "SLACK_CHANNEL_TECH",
  "LINEAR_API_KEY", "LINEAR_TEAM_ID",
  "GOOGLE_SHEETS_CSV_URL",
  "JSON_WEBHOOK_URL",
  "LLM_PROVIDER",
  "OPENAI_API_KEY", "OPENAI_MODEL",
  "ANTHROPIC_API_KEY", "ANTHROPIC_MODEL",
  "GOOGLE_AI_API_KEY", "GOOGLE_AI_MODEL",
  "DEEPSEEK_API_KEY", "DEEPSEEK_API_URL", "DEEPSEEK_MODEL",
]);

export function registerConfigRoutes(router, appService) {
  router.get("/api/config/slack", (_req, res) => {
    res.json({
      defaultChannel:   process.env.SLACK_DEFAULT_CHANNEL || "",
      channelOps:       process.env.SLACK_CHANNEL_OPS     || "",
      channelFinance:   process.env.SLACK_CHANNEL_FINANCE || "",
      channelTech:      process.env.SLACK_CHANNEL_TECH    || "",
      hasBotToken:      Boolean(process.env.SLACK_BOT_TOKEN),
      hasWebhook:       Boolean(process.env.SLACK_WEBHOOK_URL),
    });
  });

  router.post("/api/config/env", (req, res) => {
    const vars = req.body?.vars;
    if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "Expected { vars: { KEY: value } }" }));
    }

    // Reject any key not in the allowlist
    const rejected = Object.keys(vars).filter(k => !ALLOWED_KEYS.has(k));
    if (rejected.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: `Unknown config keys: ${rejected.join(", ")}` }));
    }

    // Reject non-string values
    const invalid = Object.entries(vars).filter(([, v]) => typeof v !== "string");
    if (invalid.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "All values must be strings." }));
    }

    try {
      saveEnvFile(vars);
      if (appService && typeof appService.reloadConnectors === "function") {
        appService.reloadConnectors();
      }
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err.message || "Failed to save env values." }));
    }

    res.json({ ok: true });
  });
}
