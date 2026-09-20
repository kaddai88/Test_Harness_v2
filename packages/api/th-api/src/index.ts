/**
 * @test-harness/th-api
 *
 * REST + WebSocket API server — built on Node.js `http`, no frameworks.
 */

export { APIServer } from "./server.js";
export type { APIServerOptions } from "./server.js";

export { WebSocketHandler } from "./websocket.js";
export { CutoverControlPlane, cutoverControlTokenFingerprint } from "./cutover-control.js";
export type { CutoverControlAction, CutoverControlOperation, CutoverControlPlaneOptions, CutoverControlStatus, CutoverTrafficState } from "./cutover-control.js";

// HTTP helpers (for custom route handlers)
export {
  readJsonBody,
  sendJson,
  sendText,
  applyCors,
  getPathname,
  parseQuery,
  matchRoute,
} from "./http.js";

// Route dispatchers
export { dispatchSessionRoute } from "./routes/sessions.js";
export type { SessionRouteDeps } from "./routes/sessions.js";

export { dispatchReportRoute } from "./routes/reports.js";
export type { ReportRouteDeps } from "./routes/reports.js";

export { handleHealth, handleStatus } from "./routes/health.js";
export type { HealthDeps } from "./routes/health.js";
