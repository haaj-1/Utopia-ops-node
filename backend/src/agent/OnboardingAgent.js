/**
 * OnboardingAgent — core workflow orchestrator.
 *
 * Two entry points:
 *   createFellow(name, startDate) — build a fresh checklist from the standard template
 *   run(scenario)                 — assess existing fellows from any data source
 *
 * Output includes: risk classification, Slack drafts, escalations,
 * Linear issue payloads, and a downstream webhook payload.
 */
import { RiskPolicy } from "./RiskPolicy.js";

// Standard 7-task checklist. All tasks due 1 day before start (17:00 Doha).
// Owners: ops = KYC/stipend/housing, tech = Slack/Linear/Claude/Drive
const TASK_TEMPLATE = [
  { id: "kyc",     label: "KYC",                      owner: "ops",  daysBefore: 1, criticality: "high"   },
  { id: "stipend", label: "First stipend",             owner: "ops",  daysBefore: 1, criticality: "high"   },
  { id: "qdb",     label: "QDB housing",               owner: "ops",  daysBefore: 1, criticality: "high"   },
  { id: "slack",   label: "Slack channels",            owner: "tech", daysBefore: 1, criticality: "medium" },
  { id: "linear",  label: "Linear project (template)", owner: "tech", daysBefore: 1, criticality: "medium" },
  { id: "claude",  label: "Claude.ai project live",    owner: "tech", daysBefore: 1, criticality: "high"   },
  { id: "drive",   label: "Drive folder",              owner: "tech", daysBefore: 1, criticality: "medium" },
];

export class OnboardingAgent {
  constructor({ riskPolicy = new RiskPolicy() } = {}) {
    this.riskPolicy = riskPolicy;
  }

  /** Generate a fresh checklist for a new fellow and run it through the pipeline. */
  createFellow(name, startDate) {
    if (!name || !startDate) throw new Error("name and startDate are required.");

    const start = new Date(`${startDate}T09:00:00+03:00`);
    if (isNaN(start.getTime())) throw new Error(`Invalid startDate: ${startDate}. Use YYYY-MM-DD.`);

    const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");

    const tasks = TASK_TEMPLATE.map(t => {
      const due = new Date(start);
      due.setDate(due.getDate() - t.daysBefore);
      return { id: t.id, label: t.label, owner: t.owner, dueDate: due.toISOString().slice(0, 10), status: "not_started", criticality: t.criticality };
    });

    return this.run({
      type: "new_fellow",
      label: `New fellow: ${name}`,
      generatedAt: new Date().toISOString(),
      fellows: [{ id: `fellow-${id}`, name, startDate, location: "Doha", tasks }],
    });
  }

  /**
   * Main pipeline: validate → assess → classify → build actions → return result.
   * @param {object} options.now  Override current time (useful in tests)
   */
  run(scenario, options = {}) {
    this._validateScenario(scenario);
    const now = new Date(options.now || scenario.generatedAt || new Date().toISOString());
    const fellows = scenario.fellows.map((f) => this._assessFellow(f, now));
    const riskCounts = this._countRisks(fellows);

    // For new fellows and Linear syncs, include ALL open tasks in reminders.
    // For CSV/Sheets, only surface overdue/blocked/due-soon tasks.
    const includeAllOpenTasks = scenario.type === "new_fellow" || scenario.type === "linear_sync";
    const actions = this._buildActions(fellows, now, { includeAllOpenTasks });

    return {
      pack_id: "utopia-studio-cobuild-onboarding-monitor",
      pack_family: "studio_cobuild",
      module: "M1 Onboarding",
      generated_at: now.toISOString(),
      source: { scenario: scenario.label || "Uploaded onboarding data", input_contract: "fellow profile + onboarding task status" },
      executive_summary: this._summarize(riskCounts, fellows),
      risk_counts: riskCounts,
      fellows,
      onboarding_checklist: fellows.map((f) => ({
        id: f.id, name: f.name, start_date: f.start_date, location: f.location,
        tasks: f.tasks.map(({ id, label, owner, due_date, status, criticality }) => ({ id, label, owner, due_date, status, criticality })),
      })),
      slack_drafts: this._buildSlackDrafts(fellows),
      setup_summary: this._buildSetupSummary(fellows),
      actions,
      downstream_payload: this._buildDownstreamPayload(actions),
    };
  }

  _assessFellow(fellow, now) {
    const tasks = fellow.tasks.map((t) => this.riskPolicy.assessTask(t, now));
    const incomplete = tasks.filter((t) => t.status !== "done");
    return {
      id: fellow.id,
      name: fellow.name,
      location: fellow.location || "Unknown",
      start_date: fellow.startDate,
      days_until_start: this.riskPolicy.daysBetween(now, new Date(`${fellow.startDate}T09:00:00+03:00`)),
      risk_level: this.riskPolicy.classify(tasks),
      risk_score: tasks.reduce((s, t) => s + t.risk_points, 0),
      completion_rate: tasks.length === 0 ? 100 : Math.round(((tasks.length - incomplete.length) / tasks.length) * 100),
      blockers: tasks.filter((t) => t.status === "blocked" || t.is_overdue),
      missing_items: incomplete.map((t) => t.label),
      recommended_nudge: this._buildNudge(fellow.name, tasks, this.riskPolicy.classify(tasks)),
      tasks,
    };
  }

  _buildActions(fellows, now, { includeAllOpenTasks = false } = {}) {
    const reminders = [], escalations = [];

    fellows.forEach((fellow) => {
      const riskyTasks = fellow.tasks.filter(
        (t) => t.status !== "done" && (includeAllOpenTasks || t.is_overdue || t.due_soon || t.status === "blocked")
      );

      riskyTasks.forEach((task) => {
        reminders.push({
          type: "slack_reminder",
          fellow_id: fellow.id, fellow_name: fellow.name,
          owner: task.owner, channel: task.owner_channel,
          task: task.label, due_date: task.due_date, start_date: fellow.start_date,
          days_until_due: task.days_until_due,
          days_before_start: this._daysBeforeStart(fellow.start_date, task.due_date),
          timing_label: this._timingLabel(task),
          message: this._buildSlackMessage(fellow, task),
        });

        // One escalation per risky task so the panel shows the full picture
        if (task.is_overdue || task.status === "blocked" || fellow.risk_level !== "green") {
          const isRed = task.is_overdue || task.status === "blocked";
          escalations.push({
            type: "ops_escalation",
            fellow_id: fellow.id, fellow_name: fellow.name,
            risk_level: isRed ? "red" : fellow.risk_level,
            owner: task.owner,
            reason: `${task.label} is ${task.status_label.toLowerCase()}`,
            recommended_next_step: isRed
              ? "Escalate in today's ops standup and assign a same-day owner."
              : "Ask owner for ETA and re-check within 24 hours.",
            generated_at: now.toISOString(),
          });
        }
      });
    });

    return {
      slack_reminders: reminders,
      escalations,
      linear_updates: escalations.map((item) => ({
        fellow_id: item.fellow_id,
        title: `[${item.risk_level.toUpperCase()}] Onboarding risk for ${item.fellow_name}`,
        description: `${item.reason}. ${item.recommended_next_step}`,
        priority: item.risk_level === "red" ? "urgent" : "high",
      })),
    };
  }

  /** Structured payload for downstream webhook / second-agent handoff. */
  _buildDownstreamPayload(actions) {
    return {
      event_type: "onboarding_risk_assessment.completed",
      routing_key: "studio.cobuild.m1.onboarding",
      consumers: ["slack_messaging_agent", "linear_update_agent", "ops_dashboard_agent"],
      schema_version: "1.0",
      high_priority_items: actions.escalations.map(({ fellow_id, fellow_name, risk_level, owner, reason, recommended_next_step }) =>
        ({ fellow_id, fellow_name, risk_level, owner, reason, recommended_next_step })
      ),
    };
  }

  /** Pre-written Slack messages per department. LLM polishes these on request. */
  _buildSlackDrafts(fellows) {
    return ["ops", "tech"].reduce((drafts, owner) => {
      const teamLabel = owner === "ops" ? "Ops Team" : "Tech Team";
      const teamTasks = fellows.flatMap((f) =>
        f.tasks.filter((t) => t.owner === owner && t.status !== "done").map((t) => ({ fellow: f, task: t }))
      );

      if (!teamTasks.length) {
        drafts[owner] = `Hi ${teamLabel},\n\nAll onboarding items for your function are currently on track. Please confirm your checklist is complete ahead of each fellow's start date.`;
        return drafts;
      }

      const taskLines = teamTasks.map(({ fellow, task }) => {
        const isRed = task.is_overdue || task.status === "blocked";
        if (isRed) {
          const msg = task.is_overdue
            ? `overdue — was due ${task.due_date}. Requires immediate action.`
            : `needs to be done by 17:00 Doha time on ${task.due_date}. Requires immediate action.`;
          return `🔴 ${fellow.name} (starts ${fellow.start_date}) — ${task.label}: ${msg}`;
        }
        const statusNote = task.status === "not_started" ? "to be started" : task.status_label.toLowerCase();
        return `• ${fellow.name} (starts ${fellow.start_date}) — ${task.label}: ${statusNote}.`;
      }).join("\n");

      drafts[owner] = [
        `Hi ${teamLabel},`, ``,
        `Please action the following onboarding items for your function:`, ``,
        taskLines, ``,
        `Please update your progress on Linear once each item is complete. Thank you.`,
      ].join("\n");

      return drafts;
    }, {});
  }

  _buildSetupSummary(fellows) {
    const focused = fellows.map((f) => {
      const open = f.tasks.filter((t) => t.status !== "done");
      if (!open.length) return null;
      return `${f.name} starts ${f.start_date} and still has: ${open.map((t) => `${t.label} (${t.is_overdue ? "overdue" : t.status_label.toLowerCase()})`).join("; ")}`;
    }).filter(Boolean);

    if (!focused.length) return "All fellows currently in setup are on track.";
    return `${focused.join(" ")} Target: full setup by day 1. All tasks must be complete by 17:00 Doha the day before start.`;
  }

  _buildNudge(name, tasks, riskLevel) {
    const top = tasks.filter((t) => t.status !== "done").sort((a, b) => b.risk_points - a.risk_points)[0];
    if (!top) return `${name} is on track. No reminder needed today.`;
    const urgency = riskLevel === "red" ? "Please resolve today" : "Please confirm owner and ETA";
    return `${urgency}: ${top.label} is ${top.status_label.toLowerCase()} for ${name}.`;
  }

  _buildSlackMessage(fellow, task) {
    const isRed = task.is_overdue || task.status === "blocked";
    if (isRed) {
      const msg = task.is_overdue
        ? `overdue — was due ${task.due_date}. Requires immediate action.`
        : `needs to be done by 17:00 Doha time on ${task.due_date}. Requires immediate action.`;
      return `🔴 ${task.label} for ${fellow.name} (starts ${fellow.start_date}): ${msg}`;
    }
    const statusNote = task.status === "not_started" ? "to be started" : task.status_label.toLowerCase();
    return `${task.label} for ${fellow.name} (starts ${fellow.start_date}): ${statusNote}.`;
  }

  _daysBeforeStart(startDate, dueDate) {
    const start = new Date(`${startDate}T09:00:00+03:00`);
    const due   = new Date(`${dueDate}T17:00:00+03:00`);
    return Math.max(0, this.riskPolicy.daysBetween(due, start));
  }

  _timingLabel(task) {
    if (task.is_overdue)           return `overdue by ${Math.abs(task.days_until_due)} day(s)`;
    if (task.days_until_due === 0) return "target is today";
    return `target in ${task.days_until_due} day(s)`;
  }

  _countRisks(fellows) {
    return fellows.reduce((c, f) => { c[f.risk_level]++; return c; }, { green: 0, amber: 0, red: 0 });
  }

  _summarize(counts, fellows) {
    const atRisk = fellows.filter((f) => f.risk_level !== "green").map((f) => `${f.name} is ${f.risk_level}`).join("; ");
    if (!atRisk) return `All ${fellows.length} fellow onboarding tracks are healthy. No escalation needed today.`;
    return `${counts.red} red, ${counts.amber} amber, ${counts.green} green. Priority attention: ${atRisk}.`;
  }

  _validateScenario(scenario) {
    if (!scenario || !Array.isArray(scenario.fellows)) throw new Error("Expected onboarding scenario with fellows array.");
    scenario.fellows.forEach((f) => {
      if (!f.name || !f.startDate || !Array.isArray(f.tasks)) throw new Error("Each fellow needs name, startDate, and tasks.");
    });
  }
}
