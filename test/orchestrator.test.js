/**
 * orchestrator.test.js — unit tests for OnboardingAgent.
 *
 * Tests use inline scenario data (no sampleFellows dependency) so they
 * remain self-contained and don't break when demo data changes.
 *
 * Run with: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { OnboardingAgent } from "../backend/src/agent/OnboardingAgent.js";

// ── Shared inline scenarios ───────────────────────────────────────────────

// A fellow with mixed task statuses — some done, some blocked/overdue
const scenarioWithRisk = {
  label: "Test: fellow with risk",
  generatedAt: "2026-05-20T09:00:00+03:00",
  fellows: [{
    id: "fellow-maya", name: "Maya Haddad", startDate: "2026-05-24", location: "Doha",
    tasks: [
      { id: "kyc",    label: "KYC",          owner: "ops",  dueDate: "2026-05-23", status: "blocked",  criticality: "high"   },
      { id: "slack",  label: "Slack channels", owner: "tech", dueDate: "2026-05-23", status: "done",     criticality: "medium" },
      { id: "claude", label: "Claude.ai project live", owner: "tech", dueDate: "2026-05-23", status: "pending", criticality: "high" },
    ],
  }],
};

// A fellow with all tasks done — should produce no escalations
const scenarioClean = {
  label: "Test: clean handoff",
  generatedAt: "2026-05-20T09:00:00+03:00",
  fellows: [{
    id: "fellow-lina", name: "Lina Barakat", startDate: "2026-06-04", location: "Doha",
    tasks: [
      { id: "kyc",    label: "KYC",          owner: "ops",  dueDate: "2026-06-03", status: "done", criticality: "high"   },
      { id: "slack",  label: "Slack channels", owner: "tech", dueDate: "2026-06-03", status: "done", criticality: "medium" },
      { id: "claude", label: "Claude.ai project live", owner: "tech", dueDate: "2026-06-03", status: "done", criticality: "high" },
    ],
  }],
};

// ── Tests ─────────────────────────────────────────────────────────────────

test("agent emits a pack-compatible onboarding payload", () => {
  const result = new OnboardingAgent().run(scenarioWithRisk);

  // Verify the output shape matches the expected contract
  assert.equal(result.pack_id, "utopia-studio-cobuild-onboarding-monitor");
  assert.equal(result.downstream_payload.event_type, "onboarding_risk_assessment.completed");
  assert.ok(Array.isArray(result.actions.slack_reminders));
  assert.ok(Array.isArray(result.actions.escalations));
  assert.ok(result.slack_drafts);
  assert.ok(typeof result.setup_summary === "string");
});

test("clean scenario produces no escalations", () => {
  const result = new OnboardingAgent().run(scenarioClean);

  assert.equal(result.risk_counts.red, 0);
  assert.equal(result.risk_counts.amber, 0);
  assert.equal(result.actions.escalations.length, 0);
});

test("blocked high-criticality task triggers red risk", () => {
  const result = new OnboardingAgent().run(scenarioWithRisk);

  // KYC is blocked + high criticality → fellow should be red
  assert.ok(result.risk_counts.red >= 1);
  assert.ok(result.actions.escalations.some((e) => e.risk_level === "red"));
});

test("createFellow builds a 7-task checklist with correct owners and statuses", () => {
  const result = new OnboardingAgent().createFellow("Aisha Khan", "2026-06-10");
  const fellow = result.fellows[0];
  const taskIds = fellow.tasks.map((t) => t.id);

  assert.equal(fellow.name, "Aisha Khan");
  assert.equal(fellow.start_date, "2026-06-10");

  // All 7 standard tasks must be present in order
  assert.deepEqual(taskIds, ["kyc", "stipend", "qdb", "slack", "linear", "claude", "drive"]);

  // All tasks start as not_started with a due date and owner
  assert.ok(fellow.tasks.every((t) => t.owner && t.due_date && t.status === "not_started"));

  // Ops owns KYC/stipend/QDB, tech owns the rest
  assert.ok(result.actions.slack_reminders.some((r) => r.owner === "ops"));
  assert.ok(result.actions.slack_reminders.some((r) => r.owner === "tech"));

  // Slack drafts and setup summary must be present
  assert.ok(result.slack_drafts?.ops);
  assert.ok(result.slack_drafts?.tech);
  assert.ok(typeof result.setup_summary === "string");
  assert.ok(result.onboarding_checklist.some((c) => c.name === "Aisha Khan"));
});
