/**
 * TestSessionJobProcessor — executes AI-driven website tests.
 *
 * DSH-style architecture:
 * 1. Load test session from persistence
 * 2. LLM generates test plan from user instructions
 * 3. Execute browser actions step by step
 * 4. Stream progress via WebSocket
 * 5. Save findings and results
 */
import type { Job, JobProcessor } from "@test-harness/th-queue";
import type { JobData } from "@test-harness/th-queue";
import type {
  DatabaseRepositories,
} from "@test-harness/th-persistence";
import type { AuthorityServices, SiteProfileAuthorityRecord } from '@test-harness/th-persistence/authority';
import type { LLMProvider } from "@test-harness/th-protocol";
import type {
  SessionStatusReason,
  SessionStatus,
  PostProcessingStatus,
} from "@test-harness/th-protocol";
import type { AgentResult } from "@test-harness/th-agent";
import {
  AgentTurnStartedEvent,
  AgentStreamChunkEvent,
  AgentFinalAssistantCommitEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  type SessionTarget,
  type SessionConfig,
  type Finding,
} from "@test-harness/th-protocol";
import { normalizeCanonicalOrigin, THContainer, valueProvider } from "@test-harness/th-core";
import {
  BrowserDriverDefinition,
  PlaywrightBrowserProvider,
  SiteProfileCapabilityDefinition,
  enrichSiteProfile,
  createDefaultSiteProfile,
  type CachedElement,
  type SiteProfileCapabilityRecord,
} from "@test-harness/th-browser";
import type { SiteHints } from "@test-harness/th-agent";
import { ToolRegistry, createAllTools, createMCPModeTools, createReportFindingTool, closeBrowser } from "@test-harness/th-tools";
import { AgentLoop, createDurableSessionPersistenceStore } from "@test-harness/th-agent";
import { mapStreamEventToActivity } from "../stream-transport.js";
import { calculateScore } from "@test-harness/th-report";
import fs from "node:fs";

export interface TestSessionJobProcessorOptions {
  repos: DatabaseRepositories;
  authority: AuthorityServices;
  llm: LLMProvider;
  wsHandler?: { broadcast(event: { type: string; [key: string]: unknown }): void };
}
/**
 * Worker log level from env: TH_LOG_LEVEL=debug enables debug output.
 * Default info — session lifecycle, status changes, errors.
 */
const WORKER_LOG_LEVEL: "info" | "debug" =
  (process.env.TH_LOG_LEVEL as "info" | "debug") === "debug" ? "debug" : "info";

function wlog(msg: string): void {
  console.log(`[Worker] ${msg}`);
}
function wdebug(msg: string): void {
  if (WORKER_LOG_LEVEL === "debug") console.log(`[Worker] ${msg}`);
}
function wwarn(msg: string): void {
  console.warn(`[Worker] ⚠ ${msg}`);
}
function werror(msg: string): void {
  console.error(`[Worker] ✗ ${msg}`);
}

interface ExecutionStopEvidence {
  readonly kind: "never_started" | "confirmed";
}

class CancellationObserver {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setInterval> | null = null;
  private requested = false;

  constructor(
    private readonly repos: DatabaseRepositories,
    private readonly sessionId: string,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get cancellationRequested(): boolean {
    return this.requested;
  }

  start(): void {
    this.timer = setInterval(() => {
      void this.poll();
    }, 2000);
  }

  private async poll(): Promise<void> {
    try {
      const session = await this.repos.sessions.findById(this.sessionId);
      if (session?.status === "cancelling" || session?.status === "cancelled") {
        this.requested = true;
        if (!this.controller.signal.aborted) {
          this.controller.abort({ reason: "user_cancel" });
        }
      }
    } catch {
      // A transient polling error must not invent a terminal outcome.
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

function confirmExecutionStop(
  observer: CancellationObserver,
  planningStarted: boolean,
  agentSettled: boolean,
): ExecutionStopEvidence | null {
  // The worker creates evidence only after every operation it started has
  // settled and no new execution work can begin. Intent/result alone is not
  // sufficient; the call boundary supplies the stop fact.
  if (!observer.cancellationRequested || !agentSettled) return null;
  return { kind: planningStarted ? "confirmed" : "never_started" };
}

async function convergeCancellation(
  repos: DatabaseRepositories,
  sessionId: string,
  evidence: ExecutionStopEvidence | null,
): Promise<boolean> {
  if (!evidence) return false;
  const result = await repos.sessions.transitionStatus(sessionId, {
    expected: ["cancelling"],
    target: "cancelled",
    reason: "user_cancel_quiesced",
    sideEffects: {
      terminalAt: new Date().toISOString(),
      postProcessingStatus: "not_applicable",
    },
  });
  return result.applied || result.currentState === "cancelled";
}

function postProcessingStatusFor(status: string): PostProcessingStatus {
  return status === "cancelled" ? "not_applicable" : "pending";
}

async function terminalizeWorkerResult(
  repos: DatabaseRepositories,
  sessionId: string,
  result: AgentResult,
  evidence: ExecutionStopEvidence | null,
): Promise<{ applied: boolean; status: string; allowPostProcessing: boolean }> {
  const current = await repos.sessions.findById(sessionId);
  if (!current) return { applied: false, status: "failed", allowPostProcessing: false };
  const currentState = current.status === "pending" ? "queued" : current.status;
  const status = result.status === "completed" ? "completed" : result.status === "cancelled" ? "cancelled" : "failed";
  if (status === "cancelled" && !evidence) return { applied: false, status: currentState, allowPostProcessing: false };
  const reason: SessionStatusReason = result.status === "completed" ? "completion_success" : result.status === "cancelled" ? "user_cancel_quiesced" : result.reason === "execution_timeout" ? "execution_timeout" : result.reason === "worker_shutdown" ? "worker_shutdown" : result.reason === "system_error" ? "system_error" : "failure_exception";
  const initialPostProcessingStatus = postProcessingStatusFor(status);
  const transition = await repos.sessions.transitionStatus(sessionId, {
    expected: ["running", "cancelling"], target: status, reason,
    sideEffects: { terminalAt: new Date().toISOString(), postProcessingStatus: initialPostProcessingStatus },
  });
  if (transition.applied) return { applied: true, status, allowPostProcessing: initialPostProcessingStatus === "pending" };
  if (transition.currentState === "cancelling" && evidence) {
    const converged = await convergeCancellation(repos, sessionId, evidence);
    return { applied: converged, status: converged ? "cancelled" : "cancelling", allowPostProcessing: false };
  }
  return { applied: false, status: transition.currentState, allowPostProcessing: false };
}
export class TestSessionJobProcessor implements JobProcessor<JobData> {
  private readonly repos: DatabaseRepositories;
  private readonly authority: AuthorityServices;
  private readonly llm: LLMProvider;
  private readonly wsHandler?: { broadcast(event: { type: string; [key: string]: unknown }): void };

  constructor(opts: TestSessionJobProcessorOptions) {
    this.repos = opts.repos;
    this.authority = opts.authority;
    this.llm = opts.llm;
    this.wsHandler = opts.wsHandler;
  }

  private broadcast(type: string, sessionId: string, data: Record<string, unknown>): void {
    wdebug(`broadcast ${type} for ${sessionId.slice(0,8)}`);
    this.wsHandler?.broadcast({ type, sessionId, ...data });
  }

  /** Launch a headless Chrome browser (legacy mode only). MCP mode doesn't need this. */
  private async launchBrowser(container: THContainer): Promise<boolean> {
    try {
      // Use local Playwright (legacy fallback mode)
      const chromePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      ];

      let executablePath: string | undefined;
      for (const path of chromePaths) {
        if (path && fs.existsSync(path)) {
          executablePath = path;
          break;
        }
      }

      const browserProvider = new PlaywrightBrowserProvider({ executablePath });
      container.register(BrowserDriverDefinition, valueProvider(browserProvider));
      await browserProvider.launch({ headless: true });
      wdebug('using local Playwright');
      return true;
    } catch (err) {
      wdebug('browser not available: ' + (err instanceof Error ? err.message : String(err)));
      return false;
    }
  }

  async process(job: Job<JobData>): Promise<unknown> {
    const { sessionId, targetUrl, instructions } = job.data;

    if (!sessionId || !targetUrl) {
      throw new Error("test:execute requires sessionId and targetUrl in job data");
    }

    const session = await this.repos.sessions.findById(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    const requestMetadata = await this.authority.metadata.request.read(sessionId);

    const observer = new CancellationObserver(this.repos, sessionId);
    observer.start();
    let planningStarted = false;
    let agentSettled = false;
    const disposables: Array<{ dispose(): void }> = [];

    try {
      // ── Ensure site profile exists in DB ──
    const canonicalOrigin = normalizeCanonicalOrigin(session.targetUrl);
    const ensuredProfile = await this.authority.sites.ensure({
      canonicalOrigin,
      name: new URL(canonicalOrigin).hostname,
      idempotency: { idempotencyKey: `worker-site-ensure:${sessionId}` },
    });
    let siteProfile = ensuredProfile.result.record;
    if (ensuredProfile.result.created) wlog(`created site profile: ${canonicalOrigin} (${siteProfile.id})`);

      // Update status to planning
      const planningTransition = await this.repos.sessions.transitionStatus(sessionId, {
        expected: ["pending" as SessionStatus, "queued"],
        target: "planning",
        reason: "lifecycle_start",
      });
      if (!planningTransition.applied) {
        if (planningTransition.currentState === "cancelling") {
          await convergeCancellation(this.repos, sessionId, { kind: "never_started" });
        }
        return { sessionId, skipped: true };
      }
      planningStarted = true;
      await this.repos.sessions.updateStartedAt(sessionId);
      this.broadcast("session:update", sessionId, { status: "planning", message: "AI is generating test plan..." });
      const collectedFindings: Finding[] = [];
      const collectedActivities: Record<string, unknown>[] = [];

      // ── Build container & dependencies ──
      const container = new THContainer();
      container.register(SiteProfileCapabilityDefinition, valueProvider({
        binding: { profileId: siteProfile.id, canonicalOrigin, sessionId },
        read: async () => toSiteProfileCapabilityRecord(
          await requiredSiteProfile(this.authority.sites.findById(siteProfile.id), siteProfile.id),
        ),
        updateName: async (name: string, key: string) => toSiteProfileCapabilityRecord((await this.authority.sites.update({
          scope: { kind: 'profile', profileId: siteProfile.id },
          name,
          idempotency: { idempotencyKey: key },
        })).result),
        replaceLocatorCache: async (entries: readonly CachedElement[], key: string) =>
          toSiteProfileCapabilityRecord((await this.authority.sites.replaceLocatorCache({
            scope: { kind: 'profile', profileId: siteProfile.id },
            entries,
            idempotency: { idempotencyKey: key },
          })).result),
      }));
      const useMCPTools = process.env.BROWSER_MODE === "mcp";

      // ── Tool registry ──
      const registry = new ToolRegistry();
      if (useMCPTools) {
        // MCP mode: connect to Playwright MCP server directly, no wrapper needed
        const mcpUrl = process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:3001/sse";
        const mcpTools = await createMCPModeTools(mcpUrl, container);
        for (const tool of mcpTools) {
          registry.register(tool);
        }
        wlog(`MCP mode: ${mcpTools.length} tools registered`);
      } else {
        // Legacy mode: launch local Playwright + use wrapper tools
        const browserReady = await this.launchBrowser(container);
        if (!browserReady) {
          wlog('crawling without browser');
        }
        for (const tool of createAllTools(container)) {
          registry.register(tool);
        }
      }
      registry.register(createReportFindingTool(collectedFindings, sessionId));

      // ── Status: planning → running ──
      // Tooling is ready; the AgentLoop is about to start actual test execution.
      const runningTransition = await this.repos.sessions.transitionStatus(sessionId, {
        expected: ["planning"],
        target: "running",
        reason: "lifecycle_start",
      });
      if (!runningTransition.applied) {
        if (runningTransition.currentState === "cancelling") {
          await convergeCancellation(this.repos, sessionId, {
            kind: planningStarted ? "confirmed" : "never_started",
          });
        }
        return { sessionId, skipped: true };
      }
      this.broadcast("session:update", sessionId, { status: "running", message: "Test execution started" });

      // ── Build SessionTarget / SessionConfig from session ──
      const targetConfig = (session.targetConfig ?? {}) as Record<string, unknown>;
      const rawConfig = (session.scanConfig ?? {}) as Record<string, unknown>;

      const target: SessionTarget = {
        url: session.targetUrl,
        scope: (targetConfig.scope as SessionTarget["scope"]) ?? "page",
      };

      const config: SessionConfig = {
        strategy: typeof rawConfig.strategy === "string" ? rawConfig.strategy : "adaptive",
        maxTurns: typeof rawConfig.maxTurns === "number" ? rawConfig.maxTurns : 99,
        maxRetriesPerAction: typeof rawConfig.maxRetriesPerAction === "number" ? rawConfig.maxRetriesPerAction : 3,
        instructions: requestMetadata?.instructions as string | undefined ?? instructions,
        testType: typeof rawConfig.testType === "string" ? rawConfig.testType as any : undefined,
        llm: {
          provider: this.llm.id,
          model:
            (rawConfig.model as string | undefined) ??
            process.env.QWEN_MODEL ??
            process.env.OPENAI_MODEL ??
            process.env.OLLAMA_MODEL ??
            "qwen-plus",
          temperature: 0.1,
        },
      };

      // ─ Bridge Agent Loop events to WebSocket ──
      disposables.push(
        container.events.on(AgentTurnStartedEvent, (d) => {
          const activity = {
            kind: "turn_started",
            turn: d.turnNumber,
            timestamp: Date.now(),
          };
          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        container.events.on(AgentStreamChunkEvent, (d) => {
          // Legacy compatibility fields and v1 envelope are both derived from
          // the same producer event; mapping does not regenerate identity/seq.
          const activity = mapStreamEventToActivity(d, sessionId, Date.now());
          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        container.events.on(AgentFinalAssistantCommitEvent, (d) => {
          this.broadcast("agent:final_assistant_commit", sessionId, {
            commit: d.commit,
          });
        }),
        container.events.on(AgentToolCallEvent, (d) => {
          const activity = {
            kind: "tool_call",
            tool: d.toolName,
            input: d.input,
            turn: d.turnNumber,
            timestamp: Date.now(),
          };
          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        container.events.on(AgentToolResultEvent, (d) => {
          const activity: Record<string, unknown> = {
            kind: "tool_result",
            tool: d.toolName,
            success: d.success,
            turn: d.turnNumber,
            timestamp: Date.now(),
          };

          // Capture screenshot data if available
          const resultData = d.data as { images?: Array<{ data: string; mimeType: string }> } | undefined;
          if (resultData?.images && resultData.images.length > 0) {
            const img = resultData.images[0];
            if (img) {
              activity.screenshot = img.data;
              activity.screenshotMimeType = img.mimeType;
            }
          }

          this.broadcast("agent:activity", sessionId, activity);
          collectedActivities.push(activity);
        }),
        // Workflow state change event
        container.events.on("agent:workflow_state" as any, (d: any) => {
          this.broadcast("agent:workflow_state", sessionId, {
            previousState: d.previousState,
            newState: d.newState,
            message: d.message,
            timestamp: Date.now(),
          });
        }),
      );

      // ── Build SiteHints from profile ──
      const siteHints: SiteHints | undefined = (() => {
        try {
          return { name: siteProfile.name };
        } catch {
          return undefined;
        }
      })();

      // ── Run the Agent Loop ──
      const loop = new AgentLoop();

      // Extract uploaded images from session metadata for vision-capable LLMs
      const uploadedImages = (requestMetadata?.uploadedImages as string[] | undefined) ?? [];
      
      const result = await loop.run({
        sessionId: sessionId,
        target,
        config,
        llm: this.llm,
        toolRegistry: registry,
        eventBus: container.events,
        container,
        siteHints,
        sessionPersistenceStore: createDurableSessionPersistenceStore(this.authority.metadata.p2e),
        signal: observer.signal,
        images: uploadedImages,
        cognition: { siteId: siteProfile.id, sessionTimestamp: Date.parse(session.createdAt),
          learnedEntities: this.authority.cognition },
      });
      agentSettled = true;

      // ── Persist results through the single terminalization helper ──
      const stopEvidence = confirmExecutionStop(observer, planningStarted, agentSettled);
      const terminal = await terminalizeWorkerResult(
        this.repos,
        sessionId,
        result,
        stopEvidence,
      );
      if (!terminal.applied) {
        // The persisted state is authoritative. A rejected terminal CAS never
        // grants this worker post-processing permission.
        return { sessionId, status: terminal.status, skipped: true };
      }
      const status = terminal.status;

      if (status === 'completed') {
        await this.authority.sites.incrementMetric({
          scope: { kind: 'session', profileId: siteProfile.id, sessionId },
        });
        siteProfile = await requiredSiteProfile(this.authority.sites.findById(siteProfile.id), siteProfile.id);
      }

      // A cancelled terminalization has no normal post-processing permission.
      // Release event subscriptions/browser resources before returning.
      if (!terminal.allowPostProcessing) {
        disposables.forEach((d) => d.dispose());
        if (useMCPTools) {
          const mcpUrl = process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:3001/sse";
          await closeBrowser(mcpUrl);
        }
        return {
          sessionId,
          status,
          summary: result.summary,
          findingCount: collectedFindings.length,
        };
      }

      // Generate execution summary only after a successful terminal CAS.
      let executionSummary = null;
      if (terminal.allowPostProcessing) {
        const ppStarted = await this.repos.sessions.transitionPostProcessingStatus(sessionId, {
          expected: ["pending"],
          target: "running",
        });
        if (!ppStarted.applied) {
          return { sessionId, status, skipped: true };
        }
        try {
          executionSummary = await this.generateExecutionSummary(
            collectedActivities,
            collectedFindings,
            result.summary ?? "",
          );
          await this.repos.sessions.transitionPostProcessingStatus(sessionId, {
            expected: ["running"],
            target: "success",
          });
        } catch (err) {
          werror('failed to generate execution summary: ' + (err instanceof Error ? err.message : String(err)));
          await this.repos.sessions.transitionPostProcessingStatus(sessionId, {
            expected: ["running"],
            target: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const score = calculateScore(collectedFindings);
      await this.authority.metadata.workerResult.replace({
        sessionId,
        fields: {
          summary: result.summary ?? "",
          findings: collectedFindings,
          turns: result.turns,
          activities: collectedActivities,
          score,
          executionSummary,
        },
      });

      this.broadcast("session:update", sessionId, { status });
      this.broadcast("session:finding", sessionId, { findings: collectedFindings });
      this.broadcast("session:completed", sessionId, {
        status,
        summary: result.summary ?? "",
        findingCount: collectedFindings.length,
      });

      // ── Self-learning: enrich site profile from this session ──
      try {
        const existingCache = parseLocatorCache(siteProfile.elementCache);
        const siteProfileForEnrich = {
          ...createDefaultSiteProfile(siteProfile.name, canonicalOrigin),
          elementCache: existingCache,
          updatedAt: Date.parse(siteProfile.updatedAt),
        };

        const enrichment = enrichSiteProfile(
          siteProfileForEnrich,
          targetUrl,
          collectedActivities.map(a => ({
            kind: a.kind as string,
            tool: a.tool as string | undefined,
            input: a.input as Record<string, unknown> | undefined,
            success: a.success as boolean | undefined,
            turn: a.turn as number | undefined,
            timestamp: a.timestamp as number | undefined,
          })),
          [] // No SmartLocator cache in MCP mode
        );

        wdebug(`site profile enrichment: ${enrichment.summary}`);
        siteProfile = (await this.authority.sites.replaceLocatorCache({
          scope: { kind: 'profile', profileId: siteProfile.id },
          entries: siteProfileForEnrich.elementCache,
          idempotency: { idempotencyKey: `worker-site-cache:${siteProfile.id}:${sessionId}` },
        })).result;
      } catch (err) {
        wwarn(`site profile enrichment failed: ${err}`);
      }

      // Close browser to prevent orphan windows
      if (useMCPTools) {
        const mcpUrl = process.env.PLAYWRIGHT_MCP_URL ?? "http://localhost:3001/sse";
        await closeBrowser(mcpUrl);
      }

      return {
        sessionId,
        status,
        summary: result.summary,
        findingCount: collectedFindings.length,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[TestSessionJobProcessor] Session ${sessionId} failed:`, errorMsg);
      disposables.forEach((d) => d.dispose());
      const evidence = confirmExecutionStop(observer, planningStarted, true);
      const terminal = await terminalizeWorkerResult(this.repos, sessionId, {
        sessionId,
        status: "failed",
        reason: "failure_exception",
        turns: 0,
        error: err instanceof Error ? err : new Error(errorMsg),
      }, evidence);
      if (terminal.applied) {
        this.broadcast("session:failed", sessionId, {
          status: terminal.status,
          error: errorMsg,
        });
      }
      throw err;
    } finally {
      observer.stop();
    }
  }

  /**
   * Generate a structured execution summary from activities and findings.
   * Creates a table format with test cases and screenshots.
   */
  private async generateExecutionSummary(
    activities: Array<Record<string, unknown>>,
    findings: Finding[],
    finalSummary: string
  ): Promise<Record<string, unknown> | null> {
    if (activities.length === 0) return null;

    // Group activities into test cases based on tool calls
    const testCases: Array<{
      name: string;
      action: string;
      result: string;
      screenshot?: string;
      screenshotMimeType?: string;
    }> = [];

    let currentTestCase: typeof testCases[0] | null = null;
    let currentToolInput: Record<string, unknown> | undefined;

    for (const activity of activities) {
      if (activity.kind === 'tool_call') {
        const toolName = activity.tool as string;
        const input = activity.input as Record<string, unknown> | undefined;

        // Start a new test case for significant actions
        if (['browser_click', 'browser_type', 'browser_fill_form', 'browser_navigate', 'browser_select_option', 'browser_check', 'browser_uncheck'].includes(toolName)) {
          // Save previous test case
          if (currentTestCase) {
            testCases.push(currentTestCase);
          }

          // Create new test case with basic description
          let actionDesc = '';
          if (toolName === 'browser_click') {
            actionDesc = `Click: ${input?.element ?? input?.ref ?? 'unknown element'}`;
          } else if (toolName === 'browser_type') {
            actionDesc = `Type "${input?.text ?? ''}" into ${input?.element ?? input?.ref ?? 'unknown field'}`;
          } else if (toolName === 'browser_fill_form') {
            actionDesc = 'Fill form with data';
          } else if (toolName === 'browser_navigate') {
            actionDesc = `Navigate to ${input?.url ?? 'unknown URL'}`;
          } else if (toolName === 'browser_select_option') {
            actionDesc = `Select option "${input?.value ?? input?.option ?? 'unknown'}" from ${input?.element ?? input?.ref ?? 'dropdown'}`;
          } else if (toolName === 'browser_check') {
            actionDesc = `Check checkbox: ${input?.element ?? input?.ref ?? 'unknown'}`;
          } else if (toolName === 'browser_uncheck') {
            actionDesc = `Uncheck checkbox: ${input?.element ?? input?.ref ?? 'unknown'}`;
          }

          currentTestCase = {
            name: toolName,
            action: actionDesc,
            result: 'pending',
          };
          currentToolInput = input;
        }
      } else if (activity.kind === 'tool_result' && currentTestCase) {
        // Update test case with result and screenshot
        currentTestCase.result = activity.success ? 'success' : 'failed';
        if (activity.screenshot) {
          currentTestCase.screenshot = activity.screenshot as string;
          currentTestCase.screenshotMimeType = activity.screenshotMimeType as string;
        }
      }
    }

    // Add last test case
    if (currentTestCase) {
      testCases.push(currentTestCase);
    }

    // Use LLM to generate better action descriptions based on context
    if (testCases.length > 0) {
      try {
        const descriptionPrompt = `You are analyzing test execution logs. Based on the sequence of actions below, generate a concise, descriptive summary for EACH action that explains what was done and its purpose.

Current descriptions:
${testCases.map((tc, i) => `${i + 1}. ${tc.action} [${tc.result}]`).join('\n')}

Agent's overall summary:
${finalSummary}

For each action, provide a 1-sentence description that includes:
- What specific element/feature was interacted with
- What the action accomplished (e.g., "opened the project creation form", "submitted the login credentials")
- Any notable outcome

Respond with a JSON array of strings, one per action:
["description 1", "description 2", ...]

Respond with ONLY the JSON array, no markdown.`;

        const response = await this.llm.complete({
          model: (this.llm as any).defaultModel ?? 'qwen-plus',
          messages: [{ role: 'user', content: descriptionPrompt }],
          temperature: 0.3,
          maxTokens: 2000,
        });

        const content = response.content.trim();
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const descriptions = JSON.parse(jsonMatch[0]);
          if (Array.isArray(descriptions)) {
            for (let i = 0; i < Math.min(descriptions.length, testCases.length); i++) {
              const desc = descriptions[i];
              const testCase = testCases[i];
              if (desc && typeof desc === 'string' && testCase) {
                testCase.action = desc;
              }
            }
          }
        }
      } catch (err) {
        wwarn('LLM action description generation failed, using basic descriptions: ' + (err instanceof Error ? err.message : String(err)));
      }
    }

    // Generate overview and conclusion using LLM
    const prompt = `You just completed a test session. Based on the following data, generate a concise summary.

Test cases executed: ${testCases.length}
Findings discovered: ${findings.length}
${findings.map((f, i) => `${i+1}. [${f.severity}] ${f.title}`).join('\n')}

Agent's final summary:
${finalSummary}

Generate a JSON object with this structure:
{
  "overview": "1-2 sentence overview of what was tested",
  "conclusion": "1-2 sentence conclusion"
}

Respond with ONLY the JSON object, no markdown.`;

    let overview = '';
    let conclusion = '';

    try {
      const response = await this.llm.complete({
        model: (this.llm as any).defaultModel ?? 'qwen-plus',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const content = response.content.trim();
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        overview = parsed.overview ?? '';
        conclusion = parsed.conclusion ?? '';
      }
    } catch (err) {
      werror('LLM summary generation failed: ' + (err instanceof Error ? err.message : String(err)));
    }

    return {
      overview,
      conclusion,
      testCases,
      findings: findings.length,
    };
  }
}

function parseLocatorCache(value: string): CachedElement[] {
  try {
    const parsed = JSON.parse(value || '[]') as unknown;
    return Array.isArray(parsed) ? parsed as CachedElement[] : [];
  } catch {
    return [];
  }
}

async function requiredSiteProfile<T>(value: Promise<T | null>, profileId: string): Promise<T> {
  const profile = await value;
  if (!profile) throw new Error(`SiteProfile not found: ${profileId}`);
  return profile;
}

function toSiteProfileCapabilityRecord(row: SiteProfileAuthorityRecord): SiteProfileCapabilityRecord {
  if (!row.canonicalOriginKey) throw new Error(`SiteProfile ${row.id} has no canonical origin`);
  return {
    id: row.id,
    canonicalOrigin: row.canonicalOriginKey,
    name: row.name,
    elementCache: parseLocatorCache(row.elementCache),
    testCount: row.testCount,
    lastTestedAt: row.lastTestedAt,
    updatedAt: row.updatedAt,
  };
}
