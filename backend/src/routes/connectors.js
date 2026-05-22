/**
 * GET /api/connectors/status
 * Returns live connection status for every external integration.
 *
 * POST /api/connectors/linear/teams
 * Fetches all teams from Linear using the provided (or saved) API key.
 * Used by the dashboard to let the operator pick their team ID without
 * leaving the page.
 */
export function registerConnectorRoutes(router, appService) {
  router.get("/api/connectors/status", (_req, res) => {
    res.json({ connectors: appService.connectorStatus() });
  });

  // Fetch Linear teams — accepts { apiKey } in body (uses saved key if omitted)
  router.post("/api/connectors/linear/teams", async (req, res) => {
    const apiKey = req.body?.apiKey || appService.linear.apiKey;
    if (!apiKey) {
      return res.json({ error: "Paste your Linear API key first, then click Fetch team ID." });
    }

    try {
      const response = await fetch("https://api.linear.app/graphql", {
        method: "POST",
        headers: {
          Authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "{ teams { nodes { id name } } }" }),
      });
      const payload = await response.json();
      if (payload.errors?.length) {
        return res.json({ error: `Linear error: ${payload.errors[0].message}` });
      }
      res.json({ teams: payload.data?.teams?.nodes || [] });
    } catch (err) {
      res.json({ error: err.message || "Could not reach Linear API." });
    }
  });
}
