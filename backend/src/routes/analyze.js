/**
 * Analyze routes — run the onboarding agent against various data sources.
 *
 * GET  /api/analyze/scenario?key=baseline   built-in demo scenario
 * POST /api/analyze/json                    raw JSON payload
 * POST /api/analyze/new-fellow              generate checklist from name + startDate
 * POST /api/analyze/new-fellow-linear       generate checklist AND push to Linear
 * POST /api/analyze/csv                     CSV text body
 * POST /api/analyze/sheets                  pull from Google Sheets CSV URL
 * POST /api/analyze/linear                  pull live status from Linear projects
 */
export function registerAnalyzeRoutes(router, appService) {
  // Built-in demo scenario
  router.get("/api/analyze/scenario", async (req, res) => {
    const key = req.query.key || "baseline";
    res.json(appService.analyzeScenario(key));
  });

  // Raw JSON payload
  router.post("/api/analyze/json", async (req, res) => {
    res.json(appService.analyzePayload(req.body));
  });

  // Generate a fresh onboarding checklist from simple operator inputs
  router.post("/api/analyze/new-fellow", async (req, res) => {
    const { name, startDate } = req.body;
    res.json(appService.createFellow(name, startDate));
  });

  // Generate checklist AND create a Linear project with all tasks
  router.post("/api/analyze/new-fellow-linear", async (req, res) => {
    const { name, startDate } = req.body;
    res.json(await appService.createFellowInLinear(name, startDate));
  });

  // CSV upload (text/csv body)
  router.post("/api/analyze/csv", async (req, res) => {
    res.json(appService.analyzeCsv(req.rawBody));
  });

  // Pull from Google Sheets
  router.post("/api/analyze/sheets", async (_req, res) => {
    res.json(await appService.analyzeSheet());
  });

  // Pull live onboarding status from Linear projects
  router.post("/api/analyze/linear", async (_req, res) => {
    try {
      res.json(await appService.analyzeLinear());
    } catch (err) {
      if (err.message?.includes("No onboarding projects")) {
        // Return a clean empty result — not an error
        res.json({
          fellows: [],
          risk_counts: { green: 0, amber: 0, red: 0 },
          executive_summary: "No onboarding projects found in Linear.",
          actions: { slack_reminders: [], escalations: [], linear_updates: [] },
          slack_drafts: {},
          setup_summary: "",
          source: { scenario: "Live Linear data" },
          _empty: true,
        });
      } else {
        throw err;
      }
    }
  });
}
