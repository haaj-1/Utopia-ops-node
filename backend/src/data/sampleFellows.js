/**
 * sampleFellows.js — built-in demo scenarios for the onboarding agent.
 * Used when no CSV or Sheets source is provided.
 *
 * Owners by function:
 *   ops  — KYC, First stipend, QDB housing
 *   tech — Slack channels, Linear project (template), Claude.ai project live, Drive folder
 */
export const scenarios = {
  baseline: {
    label: "Baseline cohort",
    generatedAt: "2026-05-20T09:00:00+03:00",
    fellows: [
      {
        id: "fellow-sarah",
        name: "Sarah Chen",
        startDate: "2026-05-27",
        location: "Doha",
        tasks: [
          { id: "kyc",     label: "KYC",                       owner: "ops",  dueDate: "2026-05-26", status: "done",        criticality: "high"   },
          { id: "stipend", label: "First stipend",              owner: "ops",  dueDate: "2026-05-26", status: "pending",     criticality: "high"   },
          { id: "qdb",     label: "QDB housing",                owner: "ops",  dueDate: "2026-05-26", status: "done",        criticality: "high"   },
          { id: "slack",   label: "Slack channels",             owner: "tech", dueDate: "2026-05-26", status: "done",        criticality: "medium" },
          { id: "linear",  label: "Linear project (template)",  owner: "tech", dueDate: "2026-05-26", status: "pending",     criticality: "medium" },
          { id: "claude",  label: "Claude.ai project live",     owner: "tech", dueDate: "2026-05-26", status: "not_started", criticality: "high"   },
          { id: "drive",   label: "Drive folder",               owner: "tech", dueDate: "2026-05-26", status: "done",        criticality: "medium" },
        ],
      },
      {
        id: "fellow-maya",
        name: "Maya Haddad",
        startDate: "2026-05-24",
        location: "Remote",
        tasks: [
          { id: "kyc",     label: "KYC",                       owner: "ops",  dueDate: "2026-05-23", status: "blocked",  criticality: "high"   },
          { id: "stipend", label: "First stipend",              owner: "ops",  dueDate: "2026-05-23", status: "pending",  criticality: "high"   },
          { id: "qdb",     label: "QDB housing",                owner: "ops",  dueDate: "2026-05-23", status: "blocked",  criticality: "high"   },
          { id: "slack",   label: "Slack channels",             owner: "tech", dueDate: "2026-05-23", status: "done",     criticality: "medium" },
          { id: "linear",  label: "Linear project (template)",  owner: "tech", dueDate: "2026-05-23", status: "pending",  criticality: "medium" },
          { id: "claude",  label: "Claude.ai project live",     owner: "tech", dueDate: "2026-05-23", status: "pending",  criticality: "high"   },
          { id: "drive",   label: "Drive folder",               owner: "tech", dueDate: "2026-05-23", status: "done",     criticality: "medium" },
        ],
      },
      {
        id: "fellow-omar",
        name: "Omar Al-Farsi",
        startDate: "2026-06-02",
        location: "Doha",
        tasks: [
          { id: "kyc",     label: "KYC",                       owner: "ops",  dueDate: "2026-06-01", status: "done",    criticality: "high"   },
          { id: "stipend", label: "First stipend",              owner: "ops",  dueDate: "2026-06-01", status: "pending", criticality: "high"   },
          { id: "qdb",     label: "QDB housing",                owner: "ops",  dueDate: "2026-06-01", status: "done",    criticality: "high"   },
          { id: "slack",   label: "Slack channels",             owner: "tech", dueDate: "2026-06-01", status: "done",    criticality: "medium" },
          { id: "linear",  label: "Linear project (template)",  owner: "tech", dueDate: "2026-06-01", status: "done",    criticality: "medium" },
          { id: "claude",  label: "Claude.ai project live",     owner: "tech", dueDate: "2026-06-01", status: "pending", criticality: "high"   },
          { id: "drive",   label: "Drive folder",               owner: "tech", dueDate: "2026-06-01", status: "done",    criticality: "medium" },
        ],
      },
    ],
  },

  "launch-week": {
    label: "Launch week pressure",
    generatedAt: "2026-05-20T09:00:00+03:00",
    fellows: [
      {
        id: "fellow-nadia",
        name: "Nadia Rahman",
        startDate: "2026-05-22",
        location: "Doha",
        tasks: [
          { id: "kyc",     label: "KYC",                       owner: "ops",  dueDate: "2026-05-21", status: "blocked",     criticality: "high"   },
          { id: "stipend", label: "First stipend",              owner: "ops",  dueDate: "2026-05-21", status: "not_started", criticality: "high"   },
          { id: "qdb",     label: "QDB housing",                owner: "ops",  dueDate: "2026-05-21", status: "blocked",     criticality: "high"   },
          { id: "slack",   label: "Slack channels",             owner: "tech", dueDate: "2026-05-21", status: "pending",     criticality: "medium" },
          { id: "linear",  label: "Linear project (template)",  owner: "tech", dueDate: "2026-05-21", status: "pending",     criticality: "medium" },
          { id: "claude",  label: "Claude.ai project live",     owner: "tech", dueDate: "2026-05-21", status: "not_started", criticality: "high"   },
          { id: "drive",   label: "Drive folder",               owner: "tech", dueDate: "2026-05-21", status: "done",        criticality: "medium" },
        ],
      },
      {
        id: "fellow-yousef",
        name: "Yousef Mansour",
        startDate: "2026-05-23",
        location: "Remote",
        tasks: [
          { id: "kyc",     label: "KYC",                       owner: "ops",  dueDate: "2026-05-22", status: "done",    criticality: "high"   },
          { id: "stipend", label: "First stipend",              owner: "ops",  dueDate: "2026-05-22", status: "pending", criticality: "high"   },
          { id: "qdb",     label: "QDB housing",                owner: "ops",  dueDate: "2026-05-22", status: "done",    criticality: "high"   },
          { id: "slack",   label: "Slack channels",             owner: "tech", dueDate: "2026-05-22", status: "done",    criticality: "medium" },
          { id: "linear",  label: "Linear project (template)",  owner: "tech", dueDate: "2026-05-22", status: "pending", criticality: "medium" },
          { id: "claude",  label: "Claude.ai project live",     owner: "tech", dueDate: "2026-05-22", status: "pending", criticality: "high"   },
          { id: "drive",   label: "Drive folder",               owner: "tech", dueDate: "2026-05-22", status: "pending", criticality: "medium" },
        ],
      },
    ],
  },

  clean: {
    label: "Clean handoff",
    generatedAt: "2026-05-20T09:00:00+03:00",
    fellows: [
      {
        id: "fellow-lina",
        name: "Lina Barakat",
        startDate: "2026-06-04",
        location: "Doha",
        tasks: [
          { id: "kyc",     label: "KYC",                       owner: "ops",  dueDate: "2026-06-03", status: "done",    criticality: "high"   },
          { id: "stipend", label: "First stipend",              owner: "ops",  dueDate: "2026-06-03", status: "done",    criticality: "high"   },
          { id: "qdb",     label: "QDB housing",                owner: "ops",  dueDate: "2026-06-03", status: "done",    criticality: "high"   },
          { id: "slack",   label: "Slack channels",             owner: "tech", dueDate: "2026-06-03", status: "done",    criticality: "medium" },
          { id: "linear",  label: "Linear project (template)",  owner: "tech", dueDate: "2026-06-03", status: "done",    criticality: "medium" },
          { id: "claude",  label: "Claude.ai project live",     owner: "tech", dueDate: "2026-06-03", status: "pending", criticality: "high"   },
          { id: "drive",   label: "Drive folder",               owner: "tech", dueDate: "2026-06-03", status: "done",    criticality: "medium" },
        ],
      },
    ],
  },
};
