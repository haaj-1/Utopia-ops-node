/**
 * SlackConnector — posts Slack messages in two modes:
 *
 *  Bot Token  (SLACK_BOT_TOKEN)   — uses chat.postMessage, required for per-department routing
 *  Incoming Webhook (SLACK_WEBHOOK_URL) — simpler, single-channel fallback for the daily digest
 *
 * Department routing: ops → SLACK_CHANNEL_OPS, tech → SLACK_CHANNEL_TECH
 * Falls back to SLACK_DEFAULT_CHANNEL if a department channel is not set.
 */
import { config } from "../config/env.js";

export class SlackConnector {
  constructor({
    botToken      = config.slack.botToken,
    defaultChannel = config.slack.defaultChannel,
    webhookUrl    = config.slack.webhookUrl,
    channels      = config.slack.channels,
  } = {}) {
    this.botToken       = botToken;
    this.defaultChannel = defaultChannel;
    this.webhookUrl     = webhookUrl;
    this.channels       = channels; // { ops, tech }
  }

  status() {
    const hasBotToken = Boolean(this.botToken);
    const hasWebhook  = Boolean(this.webhookUrl);
    return {
      id: "slack",
      label: "Slack",
      connected: hasBotToken || hasWebhook,
      modes: { bot_token: hasBotToken, incoming_webhook: hasWebhook },
      required_env: ["SLACK_BOT_TOKEN", "or SLACK_WEBHOOK_URL"],
      capabilities: ["post_daily_digest", "post_department_reminders", "slash_command_trigger"],
    };
  }

  // ── Daily digest (one message, default channel) ──────────────────────────

  async postDigest(agentResult, options = {}) {
    const text = this._formatDigest(agentResult);
    if (this.botToken) {
      const channel = options.channel || this.defaultChannel;
      this._assertChannel(channel, "SLACK_DEFAULT_CHANNEL");
      return this._postMessage(channel, text);
    }
    return this._postViaWebhook(text);
  }

  // ── Per-department reminders ─────────────────────────────────────────────
  /**
   * Groups all slack_reminders by owner department and sends one message
   * per department to its dedicated channel.
   *
   * Returns an array of results: { department, channel, sent, result|error }
   */
  async postDepartmentReminders(agentResult) {
    this._assertBotToken();

    // Group reminders by owner
    const byDept = {};
    for (const reminder of agentResult.actions.slack_reminders) {
      const dept = reminder.owner || "ops";
      if (!byDept[dept]) byDept[dept] = [];
      byDept[dept].push(reminder);
    }

    const results = [];

    for (const [dept, reminders] of Object.entries(byDept)) {
      const channel = this.channels[dept] || this.defaultChannel;
      if (!channel) {
        results.push({ department: dept, channel: null, sent: false, error: `No channel configured for ${dept}` });
        continue;
      }

      const text = this._formatDepartmentMessage(dept, reminders);
      try {
        const result = await this._postMessage(channel, text);
        results.push({ department: dept, channel, sent: true, result });
      } catch (err) {
        results.push({ department: dept, channel, sent: false, error: err.message });
      }
    }

    return results;
  }

  // ── Auto-join all configured channels ───────────────────────────────────
  async joinAllChannels() {
    return this.joinChannels([
      this.defaultChannel,
      ...Object.values(this.channels),
    ]);
  }

  // ── Join a specific list of channels ─────────────────────────────────────
  async joinChannels(channelList) {
    this._assertBotToken();

    const targets = channelList
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i); // dedupe

    const results = { joined: [], already: [], failed: [] };

    for (const channel of targets) {
      try {
        const res = await fetch("https://slack.com/api/conversations.join", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.botToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel }),
        });
        const payload = await res.json();

        if (payload.ok) {
          results.joined.push(channel);
        } else if (payload.error === "already_in_channel") {
          results.already.push(channel);
        } else {
          results.failed.push({ channel, error: payload.error });
        }
      } catch (err) {
        results.failed.push({ channel, error: err.message });
      }
    }

    return results;
  }

  // ── List all public channels in the workspace ─────────────────────────────
  async listChannels() {
    this._assertBotToken();

    const res = await fetch(
      "https://slack.com/api/conversations.list?types=public_channel&limit=200&exclude_archived=true",
      { headers: { Authorization: `Bearer ${this.botToken}` } }
    );
    const payload = await res.json();

    if (!payload.ok) {
      throw new Error(`Slack API error: ${payload.error}`);
    }

    return (payload.channels || []).map(ch => ({
      id: ch.id,
      name: ch.name,
      is_member: ch.is_member,
      num_members: ch.num_members,
    }));
  }

  // ── Bot Token internals ──────────────────────────────────────────────────

  async _postMessage(channel, text) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel, text }),
    });

    const payload = await response.json();
    if (!payload.ok) {
      throw new Error(`Slack API error: ${payload.error || response.statusText}`);
    }
    return payload;
  }

  // ── Incoming Webhook internals ───────────────────────────────────────────

  async _postViaWebhook(text) {
    if (!this.webhookUrl) {
      throw new Error("Slack is not configured. Set SLACK_BOT_TOKEN or SLACK_WEBHOOK_URL.");
    }
    const response = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error(`Slack webhook error: ${response.status} ${response.statusText}`);
    }
    return { ok: true };
  }

  // ── Message formatters ───────────────────────────────────────────────────

  _formatDigest(agentResult) {
    const lines = [
      "*Utopia Ops — daily onboarding briefing*",
      agentResult.executive_summary,
      "",
    ];

    if (agentResult.actions.escalations.length) {
      lines.push("*Escalations requiring action:*");
      agentResult.actions.escalations.forEach((item) => {
        const urgency = item.risk_level === "red" ? "🔴" : "🟡";
        lines.push(`${urgency} *${item.fellow_name}* — ${item.reason}. ${item.recommended_next_step}`);
      });
    } else {
      lines.push("✅ No escalations today — all fellows on track.");
    }

    return lines.join("\n");
  }

  _formatDepartmentMessage(dept, reminders) {
    const deptLabel = { ops: "Ops", tech: "Tech" }[dept] || dept;
    const lines = [
      `*Utopia Ops — ${deptLabel} onboarding actions*`,
      `You have *${reminders.length}* item${reminders.length !== 1 ? "s" : ""} requiring attention:`,
      "",
    ];

    reminders.forEach((r) => {
      const isOverdue = r.days_until_due < 0;
      const urgency = isOverdue ? "🔴 Overdue" : "🟡 Due soon";
      lines.push(`${urgency} — *${r.fellow_name}*: ${r.task} (${r.timing_label || `due ${r.due_date}`})`);
      lines.push(`  → ${r.message}`);
      lines.push("");
    });

    lines.push("Please update status or confirm ETA. Reply in thread if blocked.");
    return lines.join("\n");
  }

  // ── Guards ───────────────────────────────────────────────────────────────

  _assertBotToken() {
    if (!this.botToken) {
      throw new Error("Per-department Slack routing requires a Bot Token. Set SLACK_BOT_TOKEN.");
    }
  }

  _assertChannel(channel, envVar) {
    if (!channel) throw new Error(`Slack channel not configured. Set ${envVar}.`);
  }
}
