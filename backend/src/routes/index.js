/**
 * routes/index.js — mounts all route groups onto the router.
 *
 * Import this once in server.js and pass it the appService instance.
 */
import { registerHealthRoutes } from "./health.js";
import { registerConnectorRoutes } from "./connectors.js";
import { registerAnalyzeRoutes } from "./analyze.js";
import { registerActionRoutes } from "./actions.js";
import { registerConfigRoutes } from "./config.js";

export function registerAllRoutes(router, appService) {
  registerHealthRoutes(router);
  registerConnectorRoutes(router, appService);
  registerAnalyzeRoutes(router, appService);
  registerActionRoutes(router, appService);
  registerConfigRoutes(router, appService);
}
