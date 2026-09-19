/**
 * @test-harness/th-browser
 *
 * Browser automation capability seam — Playwright-based web page interaction.
 * Enables the Agent Loop to perform real browser operations (click, type, navigate)
 * instead of simple HTTP fetching.
 */

// Service Definition
export { BrowserDriverDefinition } from "./definition.js";

// Types
export type {
  BrowserDriver,
  BrowserLaunchOptions,
  NavigationOptions,
  ElementActionOptions,
  FormData,
  ScreenshotOptions,
  PageInfo,
  PerformanceMetrics,
  ConsoleMessage,
  NetworkRequest,
  DiscoveredFeature,
  ElementInfo,
  DistilledElement,
  DistilledPage,
  FindElementResult,
} from "./types.js";

// Generalization Layer
export type {
  SiteProfile,
  AuthPattern,
  FormPattern,
  NavigationPattern,
  SiteConstraints,
  CachedElement,
} from "./site-profile.js";
export { createDefaultSiteProfile } from "./site-profile.js";
export { SiteProfileCapabilityDefinition } from './site-profile-capability.js';
export type {
  SiteProfileCapability,
  SiteProfileCapabilityBinding,
  SiteProfileCapabilityRecord,
} from './site-profile-capability.js';
export { SmartLocator } from "./smart-locator.js";
export type { SmartLocatorOptions } from "./smart-locator.js";
export { DISTILL_SCRIPT, formatDistilledForLLM } from "./distill-dom.js";
export {
  loadSiteProfile,
  saveSiteProfile,
  persistSiteCache,
  loadSiteCache,
  readSiteProfileProjection,
  writeSiteProfileProjection,
  siteProfileProjectionFileName,
} from "./site-profile-store.js";
export type { SiteProfileData, SiteProfileProjection } from "./site-profile-store.js";
export { enrichSiteProfile } from "./site-profile-enricher.js";
export type { SessionActivity, EnrichmentResult } from "./site-profile-enricher.js";

// Provider
export { PlaywrightBrowserProvider } from "./playwright-provider.js";
export type { PlaywrightBrowserProviderConfig } from "./playwright-provider.js";
export { PlaywrightMCPProvider } from "./playwright-mcp-provider.js";
export type { PlaywrightMCPConfig } from "./playwright-mcp-provider.js";
