/**
 * AppService — orchestrates the agent, connectors, and LLM.
 * Called exclusively by the route handlers.
 */
import { OnboardingAgent } from "../agent/OnboardingAgent.js";
import { parseOnboardingCsv } from "./csv.js";
import { SlackConnector } from "../integrations/SlackConnector.js";
import { LinearConnector } from "../integrations/LinearConnector.js";
import { SheetsConnector } from "../integrations/SheetsConnector.js";
import { LlmService } from "./LlmService.js";
import { config, saveEnvFile } from "../config/env.js";
import { createHmac, timingSafeEqual } from "node:crypto";

export class AppService {
  constructor({
    agent = new OnboardingAgent(),
    slack = new SlackConnector(),
    linear = new LinearConnector(),
    sheets = new SheetsConnector(),
    llm = new LlmService(),
  } = {}) {
    this.agent = agent;
    this.slack = slack;
    this.linear = linear;
    this.sheets = sheets;
    this.llm = llm;
    this.schedulerTimer = null;
    this.schedulerLastRunDate = null;
    this.schedulerLastResult = null;
    this.schedulerRunning = false;
  }

  reloadConnectors() {
    this.slack   = new SlackConnector();
    this.linear  = new LinearConnector();
    this.sheets  = new SheetsConnector();
    this.llm     = new LlmService();
  }

  connectorStatus() {
    return [
      this.slack.status(),
      this.linear.status(),
      this.sheets.status(),
      this.llm.status(),
      {
        id: "json_webhook",
        label: "JSON Webhook",
        connected: Boolean(config.webhookUrl),
        required_env: ["JSON_WEBHOOK_URL"],
        capabilities: ["send_downstream_payload"],
      },
    ];
  }

  // ── Analysis ─────────────────────────────────────────────────────────────

  startScheduler() {
    if (this.schedulerTimer) return this.schedulerStatus();
    this.schedulerTimer = setInterval(() => this._tickScheduler(), 60 * 1000);
    this.schedulerTimer.unref?.();
    this._tickScheduler();
    return this.schedulerStatus();
  }

  schedulerStatus() {
    return {
      enabled: config.scheduler.enabled,
      time: config.scheduler.time,
      timezone: config.scheduler.timezone,
      running: this.schedulerRunning,
      last_run_date: this.schedulerLastRunDate,
      last_result: this.schedulerLastResult,
    };
  }

  setSchedulerEnabled(enabled) {
    saveEnvFile({ SCHEDULER_ENABLED: enabled ? "true" : "false" });
    return this.schedulerStatus();
  }

  async runScheduledNow() {
    return this._runScheduledCycle("manual");
  }

  async _tickScheduler() {
    const { enabled, time, timezone } = config.scheduler;
    if (!enabled || this.schedulerRunning) return;

    const parts = this._timeParts(new Date(), timezone);
    if (`${parts.hour}:${parts.minute}` !== time || this.schedulerLastRunDate === parts.date) return;

    await this._runScheduledCycle("scheduled");
  }

  _timeParts(date, timezone) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(date);

    const value = (type) => parts.find((p) => p.type === type)?.value;
    return {
      date: `${value("year")}-${value("month")}-${value("day")}`,
      hour: value("hour"),
      minute: value("minute"),
    };
  }

  async _runScheduledCycle(trigger) {
    this.schedulerRunning = true;
    const result = {
      trigger,
      started_at: new Date().toISOString(),
      source: config.sheets.csvUrl ? "google_sheets" : "baseline_scenario",
      actions: {},
    };

    try {
      const agentResult = config.sheets.csvUrl
        ? await this.analyzeSheet()
        : this.linear.status().connected
          ? await this.analyzeLinear().catch(() => this.analyzeScenario("baseline"))
          : this.analyzeScenario("baseline");

      result.executive_summary = agentResult.executive_summary;
      result.risk_counts = agentResult.risk_counts;

      if (this.slack.status().connected) {
        try {
          result.actions.slack_digest = await this.postSlackDigest(agentResult);
        } catch (err) {
          result.actions.slack_digest = { error: err.message };
        }

        if (this.slack.botToken && agentResult.actions.slack_reminders.length) {
          result.actions.department_reminders = await this.postDepartmentReminders(agentResult);
        }
      }

      if (config.webhookUrl) {
        try {
          result.actions.webhook = await this.sendWebhook(agentResult);
        } catch (err) {
          result.actions.webhook = { error: err.message };
        }
      }

      result.ok = true;
    } catch (err) {
      result.ok = false;
      result.error = err.message || "Scheduled run failed.";
    } finally {
      result.finished_at = new Date().toISOString();
      this.schedulerLastRunDate = this._timeParts(new Date(), config.scheduler.timezone).date;
      this.schedulerLastResult = result;
      this.schedulerRunning = false;
    }

    return result;
  }

  analyzeScenario(key = "baseline") {
    const scenario = scenarios[key] || scenarios.baseline;
    return this.agent.run(scenario);
  }

  createFellow(name, startDate) {
    return this.agent.createFellow(name, startDate);
  }

  analyzePayload(payload) {
    return this.agent.run(payload);
  }

  analyzeCsv(csvText) {
    return this.agent.run(parseOnboardingCsv(csvText));
  }

  async analyzeSheet() {
    return this.agent.run(await this.sheets.fetchScenario());
  }

  // ── Slack ────────────────────────────────────────────────────────────────

  /** Post single digest via Bot Token or Webhook (default channel) */
  async postSlackDigest(agentResult) {
    return this.slack.postDigest(agentResult);
  }

  /** Make the bot auto-join all configured Slack channels */
  async joinSlackChannels() {
    return this.slack.joinAllChannels();
  }

  /** List all public channels in the workspace */
  async listSlackChannels() {
    return this.slack.listChannels();
  }

  /** Join a specific selection of channels by name */
  async joinSelectedChannels(channels) {
    return this.slack.joinChannels(channels);
  }

  /**
   * Send one targeted message per department to its own Slack channel.
   * Groups reminders by owner (ops / finance / tech) and posts each group
   * to the channel configured in SLACK_CHANNEL_OPS / _FINANCE / _TECH.
   */
  async postDepartmentReminders(agentResult) {
    return this.slack.postDepartmentReminders(agentResult);
  }

  /**
   * Send Slack messages only for red-risk fellows, grouped by department.
   * Used by the "Send all red" button.
   */
  async postRedAlerts(agentResult) {
    // Filter to only reminders belonging to red fellows
    const redFellowIds = new Set(
      agentResult.fellows
        .filter(f => f.risk_level === "red")
        .map(f => f.id)
    );

    const redResult = {
      ...agentResult,
      actions: {
        ...agentResult.actions,
        slack_reminders: agentResult.actions.slack_reminders.filter(
          r => redFellowIds.has(r.fellow_id)
        ),
      },
    };

    if (!redResult.actions.slack_reminders.length) {
      return [{ sent: false, error: "No red fellows to alert." }];
    }

    return this.slack.postDepartmentReminders(redResult);
  }

  // ── Linear ───────────────────────────────────────────────────────────────

  async createLinearIssues(agentResult) {
    return this.linear.createRiskIssues(agentResult);
  }

  /**
   * Create a new fellow checklist AND push it to Linear as a project.
   * Returns the agent result enriched with { linearProject, linearIssues }.
   */
  async createFellowInLinear(name, startDate) {
    const agentResult = this.agent.createFellow(name, startDate);
    const fellow = agentResult.fellows[0];
    const { project, issues } = await this.linear.createOnboardingProject(fellow);
    return {
      ...agentResult,
      linear: { project, issues },
    };
  }

  async analyzeLinear() {
    const scenario = await this.linear.fetchOnboardingScenario();
    return this.agent.run(scenario);
  }

  // ── Generic webhook ──────────────────────────────────────────────────────

  async sendWebhook(agentResult) {
    if (!config.webhookUrl) {
      throw new Error("JSON webhook is not configured. Set JSON_WEBHOOK_URL.");
    }

    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(agentResult.downstream_payload),
    });

    if (!response.ok) {
      throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
    }

    return { ok: true, status: response.status };
  }

  async handleSlackCommand(req) {
    this._verifySlackSignature(req);

    const parsed = this._parseSlackCommandText(String(req.body?.text || "").trim());
    const agentResult = this.createFellow(parsed.name, parsed.startDate);

    return {
      response_type: "ephemeral",
      text: this._formatSlackCommandResponse(agentResult),
    };
  }

  _parseSlackCommandText(text) {
    const match = text.match(/(.+?)(?:\s*\|\s*|\s+)(\d{4}-\d{2}-\d{2})$/);
    if (!match) {
      throw new Error('Use: /onboard-fellow "Fellow Name" 2026-06-10 or Name | 2026-06-10');
    }
    return {
      name: match[1].replace(/^"|"$/g, "").trim(),
      startDate: match[2],
    };
  }

  _formatSlackCommandResponse(agentResult) {
    const fellow = agentResult.fellows[0];
    const byOwner = fellow.tasks.reduce((groups, task) => {
      groups[task.owner] = groups[task.owner] || [];
      groups[task.owner].push(`${task.label} due ${task.due_date}`);
      return groups;
    }, {});

    const lines = [
      `Checklist generated for *${fellow.name}* starting *${fellow.start_date}*.`,
      agentResult.executive_summary,
      "",
      ...Object.entries(byOwner).map(([owner, tasks]) =>
        `*${owner.toUpperCase()}*: ${tasks.join("; ")}`
      ),
      "",
      "Open the dashboard to review, edit, or send department reminders.",
    ];

    return lines.join("\n");
  }

  _verifySlackSignature(req) {
    const secret = config.slack.signingSecret;
    if (!secret) return;

    const timestamp = req.headers["x-slack-request-timestamp"];
    const signature = req.headers["x-slack-signature"];
    if (!timestamp || !signature) throw new Error("Missing Slack signature.");

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (ageSeconds > 60 * 5) throw new Error("Slack request timestamp is too old.");

    const base = `v0:${timestamp}:${req.rawBody || ""}`;
    const expected = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;
    const expectedBuf = Buffer.from(expected);
    const actualBuf = Buffer.from(signature);
    if (expectedBuf.length !== actualBuf.length || !timingSafeEqual(expectedBuf, actualBuf)) {
      throw new Error("Invalid Slack signature.");
    }
  }

  // ── LLM ──────────────────────────────────────────────────────────────────

  /**
   * Generate an AI-written message.
   * If `department` is provided (ops | finance | tech), generates a message
   * targeted at that department's tasks only.
   * Otherwise generates a general ops digest.
   */
  async generateLlmMessage(agentResult, prompt, department) {
    const systemPrompt = [
      "You are an operations assistant for Utopia Studio, a fellow onboarding program based in Doha.",
      "Owners by function: Ops owns KYC, first stipend, and QDB housing.",
      "Tech owns Slack channels (fellow-facing + studio-only), Linear project loaded from template, Claude.ai project live, and Drive folder structured per template.",
      "Every item must be complete by 17:00 Doha time the day before the fellow's start date.",
      "Anything still red on the morning of start is escalated immediately.",
      "You will be given a draft message. Your job is to lightly polish the wording to make it more natural and professional — do NOT change the structure, remove any fellows, remove any tasks, or change any facts.",
      "Keep the same format: greeting, context paragraph, bullet list of tasks, closing line.",
      "Every fellow and every task in the draft must appear in your output.",
      "Escalated items (🔴) must remain marked as escalated.",
      "Be polite, formal, and direct. No sign-offs, no extra commentary.",
    ].join(" ");

    const userPrompt = prompt || (
      department
        ? this._buildDepartmentLlmPrompt(agentResult, department)
        : this._buildDefaultLlmPrompt(agentResult)
    );

    const message = await this.llm.generateMessage(systemPrompt, userPrompt);
    return {
      message,
      provider: this.llm.provider,
      department: department || "all",
    };
  }

  async generateAllDepartmentMessages(agentResult) {
    const departments = ["ops", "tech"];
    const results = {};

    for (const dept of departments) {
      try {
        const { message } = await this.generateLlmMessage(agentResult, null, dept);
        const reminders = agentResult.actions.slack_reminders.filter(r => r.owner === dept);
        results[dept] = { message, reminders: reminders.length };
      } catch (err) {
        results[dept] = { error: err.message };
      }
    }

    return results;
  }

  _buildDefaultLlmPrompt(agentResult) {
    const { executive_summary, risk_counts, actions } = agentResult;
    const topEscalation = actions.escalations[0];

    const lines = [
      `Write a Slack message for the ops team based on this onboarding status:`,
      `Summary: ${executive_summary}`,
      `Risk counts: ${risk_counts.red} red, ${risk_counts.amber} amber, ${risk_counts.green} green.`,
    ];

    if (topEscalation) {
      lines.push(
        `Top escalation: ${topEscalation.fellow_name} is ${topEscalation.risk_level}. ` +
        `Reason: ${topEscalation.reason}. Next step: ${topEscalation.recommended_next_step}`
      );
    }

    return lines.join("\n");
  }

  _buildDepartmentLlmPrompt(agentResult, department) {
    // Use the pre-built draft from the agent as the base — LLM only polishes wording
    const draft = agentResult.slack_drafts?.[department];
    if (draft) {
      return `Here is the draft message for the ${department} team. Lightly polish the wording to make it more natural and professional. Do not change the structure, remove any fellows, remove any tasks, or alter any facts. Every item in the draft must appear in your output:\n\n${draft}`;
    }

    // Fallback if no pre-built draft
    const deptLabel = { ops: "Ops Team", tech: "Tech Team" }[department] || department;
    const reminders = agentResult.actions.slack_reminders.filter(r => r.owner === department);
    const ownershipContext = {
      ops:  "Ops owns: KYC, First stipend, and QDB housing.",
      tech: "Tech owns: Slack channels, Linear project (template), Claude.ai project live, and Drive folder.",
    }[department] || "";

    const allFellows = agentResult.fellows.map(f =>
      `${f.name} (starts ${f.start_date}, risk: ${f.risk_level})`
    ).join(", ");

    if (!reminders.length) {
      return [
        `Write a polite, formal Slack message to the ${deptLabel}.`,
        ownershipContext,
        `Fellows in onboarding: ${allFellows}.`,
        `No tasks are currently flagged. Ask them to confirm all items are on track and will be complete by 17:00 Doha the day before each fellow's start date.`,
      ].join("\n");
    }

    const taskLines = reminders.map(r => {
      const isRed = r.days_until_due < 0 || r.timing_label?.includes("overdue");
      const prefix = isRed ? "🔴 ESCALATED —" : "•";
      return `${prefix} ${r.fellow_name}: ${r.task} — ${r.timing_label || "pending"}. Fellow starts ${r.start_date}.`;
    }).join("\n");

    return [
      `Write a polite, formal Slack message to the ${deptLabel} covering all of these tasks:`,
      ownershipContext,
      taskLines,
      `All items must be complete by 17:00 Doha the day before each fellow's start date.`,
    ].join("\n");
  }
}
