/**
 * Action routes — trigger downstream integrations with an agent result.
 *
 * POST /api/actions/slack/digest          post single digest (default channel)
 * POST /api/actions/slack/reminders       send per-department targeted messages
 * POST /api/actions/linear/issues         create Linear risk issues
 * POST /api/actions/webhook               fire generic JSON webhook
 * POST /api/actions/llm/message           generate AI message (optional: ?department=ops)
 * POST /api/actions/llm/all-departments   generate one AI message per department
 * POST /api/actions/slack/command         Slack slash command entry point
 * GET  /api/actions/scheduler/status      scheduler status
 * POST /api/actions/scheduler/toggle      enable/disable daily run
 * POST /api/actions/scheduler/run-now     run scheduled cycle immediately
 */
export function registerActionRoutes(router, appService) {

  // Single digest to default channel (Bot Token or Webhook)
  router.post("/api/actions/slack/digest", async (req, res) => {
    const { agentResult } = req.body;
    res.json(await appService.postSlackDigest(agentResult));
  });

  // Auto-join all configured Slack channels
  router.post("/api/actions/slack/join", async (_req, res) => {
    res.json(await appService.joinSlackChannels());
  });

  // List all channels in the workspace (for the channel picker)
  router.get("/api/actions/slack/channels", async (_req, res) => {
    res.json(await appService.listSlackChannels());
  });

  // Join a specific selection of channels
  router.post("/api/actions/slack/join-selected", async (req, res) => {
    const { channels } = req.body;
    res.json(await appService.joinSelectedChannels(channels));
  });

  // Per-department targeted messages — one message per owner group
  // Sends to SLACK_CHANNEL_OPS, SLACK_CHANNEL_TECH
  router.post("/api/actions/slack/reminders", async (req, res) => {
    const { agentResult } = req.body;
    res.json({ results: await appService.postDepartmentReminders(agentResult) });
  });

  // Send only red/escalated reminders — one message per department that has red fellows
  router.post("/api/actions/slack/red-alerts", async (req, res) => {
    const { agentResult } = req.body;
    res.json({ results: await appService.postRedAlerts(agentResult) });
  });

  // Slack slash command endpoint. Example text: "Aisha Khan 2026-06-10"
  router.post("/api/actions/slack/command", async (req, res) => {
    res.json(await appService.handleSlackCommand(req));
  });

  // Create Linear issues
  router.post("/api/actions/linear/issues", async (req, res) => {
    const { agentResult } = req.body;
    res.json({ issues: await appService.createLinearIssues(agentResult) });
  });

  // Generic JSON webhook
  router.post("/api/actions/webhook", async (req, res) => {
    const { agentResult } = req.body;
    res.json(await appService.sendWebhook(agentResult));
  });

  // LLM message — pass department in body to target a specific team
  router.post("/api/actions/llm/message", async (req, res) => {
    const { agentResult, prompt, department } = req.body;
    res.json(await appService.generateLlmMessage(agentResult, prompt, department));
  });

  // Generate one LLM message per department in one call
  router.post("/api/actions/llm/all-departments", async (req, res) => {
    const { agentResult } = req.body;
    res.json(await appService.generateAllDepartmentMessages(agentResult));
  });

  router.get("/api/actions/scheduler/status", async (_req, res) => {
    res.json(appService.schedulerStatus());
  });

  router.post("/api/actions/scheduler/toggle", async (req, res) => {
    res.json(appService.setSchedulerEnabled(Boolean(req.body?.enabled)));
  });

  router.post("/api/actions/scheduler/run-now", async (_req, res) => {
    res.json(await appService.runScheduledNow());
  });
}
