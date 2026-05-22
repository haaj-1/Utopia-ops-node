/**
 * LlmService — provider-agnostic wrapper for AI text generation.
 *
 * Controlled by LLM_PROVIDER env var: "google" | "openai" | "anthropic" | "deepseek"
 * All providers expose the same interface: generateMessage(systemPrompt, userPrompt)
 *
 * Settings: temperature 0.4 (consistent output), max_tokens 512 (Slack message size)
 */
import { config } from "../config/env.js";

export class LlmService {
  constructor({
    provider       = config.llmProvider,
    openaiKey      = config.openai.apiKey,
    openaiModel    = config.openai.model,
    anthropicKey   = config.anthropic.apiKey,
    anthropicModel = config.anthropic.model,
    googleAiKey    = config.googleAi.apiKey,
    googleAiModel  = config.googleAi.model,
    deepseekKey    = config.deepseek.apiKey,
    deepseekUrl    = config.deepseek.apiUrl,
    deepseekModel  = config.deepseek.model,
  } = {}) {
    Object.assign(this, { provider, openaiKey, openaiModel, anthropicKey, anthropicModel, googleAiKey, googleAiModel, deepseekKey, deepseekUrl, deepseekModel });
  }

  status() {
    const connected =
      this.provider === "openai"    ? Boolean(this.openaiKey) :
      this.provider === "anthropic" ? Boolean(this.anthropicKey) :
      this.provider === "google"    ? Boolean(this.googleAiKey && this.googleAiModel) :
                                      Boolean(this.deepseekKey && this.deepseekUrl);
    return {
      id: "llm", label: `LLM (${this.provider})`, connected,
      required_env: this.provider === "openai"    ? ["OPENAI_API_KEY"] :
                    this.provider === "anthropic" ? ["ANTHROPIC_API_KEY", "LLM_PROVIDER=anthropic"] :
                    this.provider === "google"    ? ["GOOGLE_AI_API_KEY", "GOOGLE_AI_MODEL", "LLM_PROVIDER=google"] :
                    ["DEEPSEEK_API_KEY", "DEEPSEEK_API_URL", "LLM_PROVIDER=deepseek"],
      capabilities: ["generate_slack_message", "generate_escalation_summary"],
    };
  }

  /** Route to the configured provider. */
  async generateMessage(systemPrompt, userPrompt) {
    if (this.provider === "openai")    return this._openai(systemPrompt, userPrompt);
    if (this.provider === "anthropic") return this._anthropic(systemPrompt, userPrompt);
    if (this.provider === "google")    return this._googleAi(systemPrompt, userPrompt);
    return this._deepseek(systemPrompt, userPrompt);
  }

  // ── Google AI Studio (free tier, default) ────────────────────────────────
  // API key passed as query param; system prompt in system_instruction (not messages array)

  async _googleAi(systemPrompt, userPrompt) {
    if (!this.googleAiKey) throw new Error("Google AI is not configured. Set GOOGLE_AI_API_KEY.");
    const model = this.googleAiModel || "gemini-2.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(this.googleAiKey)}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 512 },
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(`Google AI error: ${payload.error?.message || response.statusText}`);
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Google AI error: empty response. Check your API key and model name.");
    return text.trim();
  }

  // ── DeepSeek ─────────────────────────────────────────────────────────────

  async _deepseek(systemPrompt, userPrompt) {
    if (!this.deepseekKey || !this.deepseekUrl) throw new Error("DeepSeek is not configured. Set DEEPSEEK_API_KEY and DEEPSEEK_API_URL.");

    const response = await fetch(this.deepseekUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.deepseekKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.deepseekModel || "deepseek-v4-pro",
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        thinking: { type: "enabled" }, reasoning_effort: "high",
        max_tokens: 512, temperature: 0.4, stream: false,
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(`DeepSeek error: ${payload.error?.message || response.statusText}`);
    const output = payload.choices?.[0]?.message?.content || payload.choices?.[0]?.text || payload.output || payload.text;
    if (!output) throw new Error("DeepSeek error: unexpected response format.");
    return typeof output === "string" ? output.trim() : JSON.stringify(output);
  }

  // ── OpenAI ────────────────────────────────────────────────────────────────

  async _openai(systemPrompt, userPrompt) {
    if (!this.openaiKey) throw new Error("OpenAI is not configured. Set OPENAI_API_KEY.");

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.openaiModel,
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens: 512, temperature: 0.4,
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(`OpenAI error: ${payload.error?.message || response.statusText}`);
    return payload.choices[0].message.content.trim();
  }

  // ── Anthropic ─────────────────────────────────────────────────────────────
  // Note: uses x-api-key header (not Authorization: Bearer) and requires anthropic-version

  async _anthropic(systemPrompt, userPrompt) {
    if (!this.anthropicKey) throw new Error("Anthropic is not configured. Set ANTHROPIC_API_KEY.");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": this.anthropicKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.anthropicModel,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
        max_tokens: 512,
      }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(`Anthropic error: ${payload.error?.message || response.statusText}`);
    return payload.content[0].text.trim();
  }
}
