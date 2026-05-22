/**
 * GET /api/health
 * Simple liveness check.
 */
export function registerHealthRoutes(router) {
  router.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "utopia-ops-os" });
  });
}
