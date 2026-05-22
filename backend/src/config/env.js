/**
 * env.js — loads .env and exports a validated config object.
 *
 * All secret access in the app goes through this module.
 * Never read process.env directly outside of here.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes, createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

const ENV_PATH = ".env";
const ENCRYPTED_ENV_PATH = ".env.enc";
const ENCRYPTION_SALT = "utopia-ops-env-salt";

function deriveKey(secret) {
  return scryptSync(secret, ENCRYPTION_SALT, 32);
}

function encryptText(plaintext, secret) {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    data: ciphertext.toString("base64"),
  });
}

function decryptText(encoded, secret) {
  const key = deriveKey(secret);
  const payload = JSON.parse(encoded);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

function loadEnvLines(lines) {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    const key = trimmed.slice(0, sep).trim();
    const value = trimmed.slice(sep + 1).trim().replace(/^"|"$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function readExistingEnvLines() {
  if (existsSync(ENCRYPTED_ENV_PATH) && process.env.SECRETS_MASTER_KEY) {
    try {
      const encrypted = readFileSync(ENCRYPTED_ENV_PATH, "utf8");
      const decrypted = decryptText(encrypted, process.env.SECRETS_MASTER_KEY);
      return decrypted.split(/\r?\n/);
    } catch (err) {
      console.error("Failed to decrypt .env.enc:", err.message);
    }
  }

  if (!existsSync(ENV_PATH)) return [];
  return readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
}

function writeEncryptedEnv(lines) {
  const content = lines.join("\n");
  const ciphertext = encryptText(content, process.env.SECRETS_MASTER_KEY);
  writeFileSync(ENCRYPTED_ENV_PATH, ciphertext, "utf8");
}

export function loadEnvFile(path = ENV_PATH) {
  const lines = readExistingEnvLines();
  loadEnvLines(lines);
}

export function saveEnvFile(vars) {
  const lines = readExistingEnvLines();

  for (const [key, value] of Object.entries(vars)) {
    if (!value && value !== 0) continue;
    const safe = String(value).replace(/"/g, '\\"');
    const entry = `${key}="${safe}"`;
    const idx = lines.findIndex(l => l.trimStart().startsWith(`${key}=`));
    if (idx !== -1) lines[idx] = entry;
    else lines.push(entry);
    process.env[key] = String(value);
  }

  if (process.env.SECRETS_MASTER_KEY) {
    writeEncryptedEnv(lines);
  } else {
    writeFileSync(ENV_PATH, lines.join("\n"), "utf8");
  }
}

/**
 * Typed config object — the single source of truth for all env vars.
 * Call loadEnvFile() before accessing this.
 */
export const config = {
  // ── Server ──────────────────────────────────────────────────────────────
  get port() { return Number(process.env.PORT || 4173); },
  get nodeEnv() { return process.env.NODE_ENV || "development"; },

  // ── OpenAI ───────────────────────────────────────────────────────────────
  get openai() {
    return {
      apiKey: process.env.OPENAI_API_KEY || "",
      model: process.env.OPENAI_MODEL || "gpt-4o",
    };
  },

  // ── Anthropic ───────────────────────────────────────────────────────────
  get anthropic() {
    return {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022",
    };
  },

  // ── Google AI Studio / Gemini ─────────────────────────────────────────────
  get googleAi() {
    return {
      apiKey: process.env.GOOGLE_AI_API_KEY || "",
      model: process.env.GOOGLE_AI_MODEL || "gemini-2.5-flash",
    };
  },

  // ── DeepSeek ─────────────────────────────────────────────────────────────
  get deepseek() {
    return {
      apiKey: process.env.DEEPSEEK_API_KEY || "",
      apiUrl: process.env.DEEPSEEK_API_URL || "",
      model: process.env.DEEPSEEK_MODEL || "",
    };
  },

  // ── Active LLM provider ("openai" | "anthropic" | "deepseek") ─────────
  get llmProvider() { return process.env.LLM_PROVIDER || "openai"; },

  // ── Slack ────────────────────────────────────────────────────────────────
  get slack() {
    return {
      botToken: process.env.SLACK_BOT_TOKEN || "",
      defaultChannel: process.env.SLACK_DEFAULT_CHANNEL || "",
      webhookUrl: process.env.SLACK_WEBHOOK_URL || "",   // Incoming Webhook (optional alternative)
      signingSecret: process.env.SLACK_SIGNING_SECRET || "",

      // Per-department channels — messages are routed here automatically.
      // Falls back to defaultChannel if not set.
      channels: {
        ops:     process.env.SLACK_CHANNEL_OPS  || process.env.SLACK_DEFAULT_CHANNEL || "",
        tech:    process.env.SLACK_CHANNEL_TECH || process.env.SLACK_DEFAULT_CHANNEL || "",
      },
    };
  },

  // ── Linear ───────────────────────────────────────────────────────────────
  get linear() {
    return {
      apiKey: process.env.LINEAR_API_KEY || "",
      teamId: process.env.LINEAR_TEAM_ID || "",
    };
  },

  // ── Google Sheets ────────────────────────────────────────────────────────────
  get sheets() {
    return {
      csvUrl: process.env.GOOGLE_SHEETS_CSV_URL || "",
    };
  },

  // ── Generic downstream webhook ──────────────────────────────────────────────────
  get webhookUrl() { return process.env.JSON_WEBHOOK_URL || ""; },

  // ── Scheduler ───────────────────────────────────────────────────────────────────
  get scheduler() {
    return {
      enabled: String(process.env.SCHEDULER_ENABLED || "false").toLowerCase() === "true",
      time: process.env.SCHEDULER_TIME || "09:00",
      timezone: process.env.SCHEDULER_TIMEZONE || "Asia/Qatar",
    };
  },
};
