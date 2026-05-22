import test from "node:test";
import assert from "node:assert/strict";
import { parseOnboardingCsv } from "../backend/src/services/csv.js";

test("parses onboarding CSV into fellow scenario", () => {
  const scenario = parseOnboardingCsv(`fellow_name,start_date,location,task,status,owner,due_date,criticality
Sarah Chen,2026-05-27,Doha,KYC,done,ops,2026-05-22,high
Sarah Chen,2026-05-27,Doha,Slack setup,pending,tech,2026-05-23,medium`);

  assert.equal(scenario.fellows.length, 1);
  assert.equal(scenario.fellows[0].name, "Sarah Chen");
  assert.equal(scenario.fellows[0].tasks.length, 2);
  assert.equal(scenario.fellows[0].tasks[1].owner, "tech");
});
