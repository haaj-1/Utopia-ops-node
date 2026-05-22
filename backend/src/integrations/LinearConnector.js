/**
 * LinearConnector — two-way Linear integration for onboarding.
 *
 * WRITE:
 *   createOnboardingProject(fellow)
 *     Creates a Linear project "Onboarding — {name}" with one issue per
 *     checklist task, labelled by department (ops / finance / tech) and
 *     due-dated relative to the fellow's start date.
 *
 * READ:
 *   fetchOnboardingScenario()
 *     Queries all projects whose name starts with "Onboarding — ",
 *     reads their issues and states, and returns a scenario object
 *     compatible with OnboardingAgent.run().
 *
 * ESCALATE:
 *   createRiskIssues(agentResult)
 *     Original behaviour — creates a risk/escalation issue for each
 *     amber/red fellow (unchanged).
 *
 * Requires LINEAR_API_KEY and LINEAR_TEAM_ID.
 */
import { config } from "../config/env.js";

// Map Linear workflow state names → agent task statuses
const STATE_MAP = {
  "todo":        "not_started",
  "unstarted":   "not_started",
  "backlog":     "not_started",
  "in progress": "pending",
  "started":     "pending",
  "in review":   "pending",
  "done":        "done",
  "completed":   "done",
  "cancelled":   "blocked",
  "canceled":    "blocked",
  "duplicate":   "blocked",
};

// Map agent task ids → Linear issue titles (must match TASK_TEMPLATE in OnboardingAgent)
const TASK_TITLES = {
  kyc:     "KYC",
  stipend: "First stipend",
  qdb:     "QDB housing",
  slack:   "Slack channels",
  linear:  "Linear project (template)",
  claude:  "Claude.ai project live",
  drive:   "Drive folder",
};

export class LinearConnector {
  constructor({
    apiKey = config.linear.apiKey,
    teamId = config.linear.teamId,
  } = {}) {
    this.apiKey = apiKey;
    this.teamId = teamId;
  }

  status() {
    return {
      id: "linear",
      label: "Linear",
      connected: Boolean(this.apiKey && this.teamId),
      required_env: ["LINEAR_API_KEY", "LINEAR_TEAM_ID"],
      capabilities: ["create_onboarding_project", "read_onboarding_status", "create_risk_issues"],
    };
  }

  // ── WRITE: create a full onboarding project for a new fellow ─────────────

  /**
   * Creates a Linear project "Onboarding — {fellow.name}" and populates it
   * with one issue per checklist task.
   *
   * @param {object} fellow  - fellow object from OnboardingAgent.createFellow()
   *                           (fellows[0] from the agent result)
   * @returns {object}       - { project, issues[] }
   */
  async createOnboardingProject(fellow) {
    this._assertConfigured();

    // 1. Ensure department labels exist
    const labelIds = await this._ensureLabels(["ops", "tech"]);

    // 2. Create the project
    const project = await this._createProject(`Onboarding — ${fellow.name}`);

    // 3. Create one issue per task
    const issues = [];
    for (const task of fellow.tasks) {
      const labelId = labelIds[task.owner];
      const issue = await this._createProjectIssue({
        projectId: project.id,
        title: task.label,
        dueDate: task.due_date,
        labelId,
        description: [
          `**Fellow:** ${fellow.name}`,
          `**Start date:** ${fellow.start_date}`,
          `**Owner:** ${task.owner}`,
          `**Due:** ${task.due_date} (${task.days_until_due >= 0 ? task.days_until_due + " days until due" : Math.abs(task.days_until_due) + " days overdue"})`,
        ].join("\n"),
      });
      issues.push(issue);
    }

    return { project, issues };
  }

  // ── READ: fetch all onboarding projects and build a scenario ─────────────

  /**
   * Queries Linear for all projects named "Onboarding — *", reads their
   * issues and current states, and returns a scenario object that
   * OnboardingAgent.run() can consume directly.
   */
  async fetchOnboardingScenario() {
    this._assertConfigured();

    const projects = await this._fetchOnboardingProjects();
    if (!projects.length) {
      throw new Error("No onboarding projects found in Linear. Create a fellow first.");
    }

    const fellows = [];

    for (const project of projects) {
      const fellowName = project.name.replace(/^Onboarding\s*[—-]\s*/i, "").trim();
      const issues = await this._fetchProjectIssues(project.id);

      // Extract start date from the first issue description if present
      const startDate = this._extractStartDate(issues) || this._estimateStartDate(issues);

      const tasks = issues.map(issue => ({
        id:          this._taskIdFromTitle(issue.title),
        label:       issue.title,
        owner:       this._ownerFromLabels(issue.labels),
        dueDate:     issue.dueDate || startDate,
        status:      this._mapState(issue.state?.name || ""),
        criticality: this._criticalityFromTitle(issue.title),
        linearId:    issue.id,
        linearUrl:   issue.url,
      }));

      fellows.push({
        id:        `linear-${project.id}`,
        name:      fellowName,
        startDate,
        location:  "Doha",
        tasks,
        linearProjectId:  project.id,
        linearProjectUrl: project.url,
      });
    }

    return {
      type:        "linear_sync",
      label:       "Live Linear onboarding data",
      generatedAt: new Date().toISOString(),
      fellows,
    };
  }

  // ── ESCALATE: create risk issues (original behaviour, unchanged) ──────────

  async createRiskIssues(agentResult) {
    this._assertConfigured();
    const created = [];
    for (const issue of agentResult.actions.linear_updates) {
      created.push(await this._createIssue(issue));
    }
    return created;
  }

  // ── GraphQL helpers ───────────────────────────────────────────────────────

  async _gql(query, variables = {}) {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const payload = await response.json();
    if (payload.errors?.length) {
      throw new Error(`Linear API error: ${payload.errors[0].message}`);
    }
    return payload.data;
  }

  async _createProject(name) {
    const data = await this._gql(`
      mutation ProjectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          success
          project { id name url }
        }
      }
    `, {
      input: {
        name,
        teamIds: [this.teamId],
        color: "#6366f1",
      },
    });
    if (!data.projectCreate.success) throw new Error("Failed to create Linear project.");
    return data.projectCreate.project;
  }

  async _createProjectIssue({ projectId, title, dueDate, labelId, description }) {
    const input = {
      teamId: this.teamId,
      projectId,
      title,
      description,
      ...(dueDate && { dueDate }),
      ...(labelId && { labelIds: [labelId] }),
    };
    const data = await this._gql(`
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url }
        }
      }
    `, { input });
    if (!data.issueCreate.success) throw new Error(`Failed to create issue: ${title}`);
    return data.issueCreate.issue;
  }

  async _createIssue(issue) {
    const data = await this._gql(`
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier url }
        }
      }
    `, {
      input: {
        teamId: this.teamId,
        title: issue.title,
        description: issue.description,
        priority: issue.priority === "urgent" ? 1 : 2,
      },
    });
    if (data.issueCreate.errors?.length) {
      throw new Error(`Linear API error: ${data.issueCreate.errors[0].message}`);
    }
    return data.issueCreate.issue;
  }

  async _fetchOnboardingProjects() {
    const data = await this._gql(`
      query OnboardingProjects($teamId: String!) {
        team(id: $teamId) {
          projects(filter: { name: { startsWith: "Onboarding" } }) {
            nodes {
              id name url state
            }
          }
        }
      }
    `, { teamId: this.teamId });
    return (data.team?.projects?.nodes || []).filter(p =>
      /^Onboarding\s*[—-]/i.test(p.name) && p.state !== "completed" && p.state !== "cancelled"
    );
  }

  async _fetchProjectIssues(projectId) {
    const data = await this._gql(`
      query ProjectIssues($projectId: String!) {
        project(id: $projectId) {
          issues {
            nodes {
              id title url dueDate
              state { name type }
              labels { nodes { name } }
              description
            }
          }
        }
      }
    `, { projectId });
    return data.project?.issues?.nodes || [];
  }

  async _ensureLabels(names) {
    // Fetch existing labels for the team
    const data = await this._gql(`
      query TeamLabels($teamId: String!) {
        team(id: $teamId) {
          labels { nodes { id name } }
        }
      }
    `, { teamId: this.teamId });

    const existing = data.team?.labels?.nodes || [];
    const labelIds = {};

    for (const name of names) {
      const found = existing.find(l => l.name.toLowerCase() === name.toLowerCase());
      if (found) {
        labelIds[name] = found.id;
      } else {
        // Create the label
        const created = await this._gql(`
          mutation LabelCreate($input: IssueLabelCreateInput!) {
            issueLabelCreate(input: $input) {
              success
              issueLabel { id name }
            }
          }
        `, { input: { teamId: this.teamId, name, color: this._labelColor(name) } });
        labelIds[name] = created.issueLabelCreate.issueLabel.id;
      }
    }

    return labelIds;
  }

  // ── Mapping helpers ───────────────────────────────────────────────────────

  _mapState(stateName) {
    return STATE_MAP[stateName.toLowerCase()] || "not_started";
  }

  _ownerFromLabels(labels) {
    const names = (labels?.nodes || []).map(l => l.name.toLowerCase());
    if (names.includes("tech")) return "tech";
    return "ops"; // default
  }

  _taskIdFromTitle(title) {
    const t = title.toLowerCase();
    if (t.includes("kyc"))      return "kyc";
    if (t.includes("stipend"))  return "stipend";
    if (t.includes("qdb"))      return "qdb";
    if (t.includes("slack"))    return "slack";
    if (t.includes("linear"))   return "linear";
    if (t.includes("claude"))   return "claude";
    if (t.includes("drive"))    return "drive";
    return title.toLowerCase().replace(/\s+/g, "_");
  }

  _criticalityFromTitle(title) {
    const t = title.toLowerCase();
    if (t.includes("kyc") || t.includes("stipend") || t.includes("qdb") || t.includes("claude")) {
      return "high";
    }
    return "medium";
  }

  _extractStartDate(issues) {
    for (const issue of issues) {
      const match = issue.description?.match(/\*\*Start date:\*\*\s*(\d{4}-\d{2}-\d{2})/);
      if (match) return match[1];
    }
    return null;
  }

  _estimateStartDate(issues) {
    // Fall back: find the latest due date and add 4 days (minimum lead time)
    const dates = issues
      .map(i => i.dueDate)
      .filter(Boolean)
      .sort();
    if (!dates.length) return new Date().toISOString().slice(0, 10);
    const latest = new Date(dates[dates.length - 1]);
    latest.setDate(latest.getDate() + 4);
    return latest.toISOString().slice(0, 10);
  }

  _labelColor(name) {
    return { ops: "#f59e0b", tech: "#6366f1" }[name] || "#94a3b8";
  }

  _assertConfigured() {
    if (!this.apiKey || !this.teamId) {
      throw new Error("Linear is not configured. Set LINEAR_API_KEY and LINEAR_TEAM_ID.");
    }
  }
}
