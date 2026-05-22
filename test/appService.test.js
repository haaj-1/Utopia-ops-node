/**
 * appService.test.js — integration tests for the AppService layer.
 *
 * These tests exercise the service without real API credentials.
 * Connector status checks, fellow creation, and the Slack slash command
 * parser all run against the live agent logic with no external calls.
 *
 * Run with: npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { AppService } from "../backend/src/services/AppService.js";

test("reports connector status without secrets", () => {
  const service = new AppService();
  const statuses = service.connectorStatus();

  // All connectors must be present and have a required_env array
  assert.ok(statuses.some((c) => c.id === "slack"));
  assert.ok(statuses.some((c) => c.id === "linear"));
  assert.ok(statuses.every((c) => Array.isArray(c.required_env)));
});

test("creates a new fellow through the service layer", () => {
  const service = new AppService();
  const result = service.createFellow("Noor Saleh", "2026-06-15");

  assert.equal(result.fellows.length, 1);
  assert.equal(result.fellows[0].name, "Noor Saleh");
  // QDB housing is one of the 7 standard tasks
  assert.ok(result.fellows[0].tasks.some((t) => t.label === "QDB housing"));
  assert.ok(result.slack_drafts);
  assert.ok(typeof result.setup_summary === "string");
});

test("handles Slack slash command text for new fellow setup", async () => {
  const service = new AppService();
  const result = await service.handleSlackCommand({
    headers: {},
    rawBody: "text=Aisha%20Khan%202026-06-10",
    body: { text: "Aisha Khan 2026-06-10" },
  });

  assert.equal(result.response_type, "ephemeral");
  assert.match(result.text, /Checklist generated for \*Aisha Khan\*/);
  // QDB housing is an ops task and should appear in the response
  assert.match(result.text, /QDB housing/);
});

test("reports scheduler status without starting a timer", () => {
  const service = new AppService();
  const status = service.schedulerStatus();

  // Scheduler defaults: 09:00 Doha time, disabled until explicitly enabled
  assert.equal(status.time, "09:00");
  assert.equal(status.timezone, "Asia/Qatar");
  assert.equal(status.running, false);
});
