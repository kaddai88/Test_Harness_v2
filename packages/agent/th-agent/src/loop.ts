/**
 * Agent Loop — the core driver that orchestrates the session.
 *
 * Implements the DSH-style Turn → Step → Model → Tool → Result pipeline.
 * Key improvements over the basic version:
 *
 * 1. Session Log: All model-visible content is stored in an append-only log.
 *    Message history is DERIVED from the log via `deriveMessages()`.
 *
 * 2. Waterfall Events: Key pipeline points use waterfall dispatch,
 *    allowing plugins to intercept and modify behavior.
 *
 * 3. Turn/Step Structure: Each turn contains one or more steps.
 *    A step is one model request + the tool calls it triggers.
 *
 * The loop runs until:
 * - The LLM returns no tool calls (session complete)
 * - Max turns reached
 * - Abort signal triggered
 * - Error occurs
 */
import type {
  LLMProvider,
  Message,
  SessionConfig,
  SessionTarget,
  ToolSchema,
} from "@test-harness/th-protocol";
import {
  AgentTurnStartedEvent,
  AgentToolCallEvent,
  AgentToolResultEvent,
  AgentPreStepEvent,
  AgentRequestEvent,
  AgentTurnStoppingEvent,
  AgentStreamChunkEvent,
  ToolsPreExecuteEvent,
  ToolsPostExecuteEvent,
} from "@test-harness/th-protocol";
import type {
  AgentContext,
  AgentResult,
  TurnResult,
} from "./context.js";
import type { ToolRegistry } from "@test-harness/th-tools";
import type { EventBusImpl } from "@test-harness/th-core";
import { getSystemPrompt, buildSessionPlanningPrompt, type SiteHints } from "./prompts/system.js";
import { SessionLog } from "./session.js";
import { StreamAssembler } from "./assembler.js";
import {
  WorkflowState,
  WORKFLOW_TRANSITIONS,
  getAllowedTools,
  getStatePrompt,
  updateWorkflowContext,
  tryTransition,
  createInitialContext,
  type WorkflowContext,
} from "./workflow.js";
import { verifyAction, getRecoveryGuidance } from "./verify.js";
import {
  createLoginGuardState,
  detectLoginRequirement,
  recordCredentialsSubmitted,
  checkLoginConfirmation,
  shouldBlockNavigation,
  describeLoginState,
  type LoginGuardState,
} from "./login.js";
import { CognitiveEngine } from "@test-harness/th-cognition";
import * as path from "path";

// P2-E I7-B-R1: Real AgentLoop integration
import {
  captureP2EDecisionProvenance,
  validateBeforeToolDispatch,
  handlePostToolExecution,
  installAuthoritativeObservation,
  isP2EActive,
  processAuthoritativeSnapshot,
} from "./agentloop-integration.js";
import { appendP2EObservationToRequest } from "./request-observation.js";

// Phase 4: Coverage-driven testing
import {
  createCoverageModel,
  registerModule,
  registerSurface,
  registerFeature,
  updateScenario,
  markScenarioPlanned,
  markScenarioSkipped,
  selectNextTarget,
  shouldFinishTesting,
  formatCoverageSummary,
  updateSurfaceCoverageStatus,
  getCoverageGaps,
  assignIntentRoles,
  resolveActionFeature,
  COVERAGE_POLICIES,
  type CoverageModel,
  type CoveragePolicy,
  type CoverageTarget,
  type ScenarioType,
  type ScenarioOutcome,
  type FeatureType,
  type TestType as CoverageTestType,
} from "./coverage.js";
import {
  extractSurfaceSignature,
  generateSurfaceKey,
  generateModuleKey,
  generateModuleName,
} from "./surface-signature.js";
import {
  generateTestPlan,
  validateTestPlan,
} from "./planner.js";

/**
 * Log levels for agent observability.
 *
 * INFO: what a developer needs to follow the test — state changes, targets,
 *       plans, actions, coverage updates, exit decisions.
 * DEBUG: full diagnostics — raw snapshots, prompts, planner internals,
 *        feature discovery details, tool registration details.
 *
 * Principle: never delete diagnostic capability, only lower default visibility.
 * Set TH_LOG_LEVEL=debug to enable debug output.
 */
export type AgentLogLevel = "info" | "debug";

/** Minimum level from env: TH_LOG_LEVEL=debug enables debug output. Default: info */
const MIN_LOG_LEVEL: AgentLogLevel =
  (process.env.TH_LOG_LEVEL as AgentLogLevel) === "debug" ? "debug" : "info";

/** Logger interface for the agent loop */
export interface AgentLogger {
  info(msg: string): void;
  /** Detailed diagnostics — hidden at default INFO level */
  debug(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  toolCall(name: string, input: unknown): void;
  toolResult(name: string, success: boolean, duration: number): void;
}

/** Default console logger with level filtering (exported for testing) */
export const defaultLogger: AgentLogger = {
  info: (msg) => console.log(`  [Agent] ${msg}`),
  debug: (msg) => {
    if (MIN_LOG_LEVEL === "debug") console.log(`  [Agent] ${msg}`);
  },
  warn: (msg) => console.warn(`  [Agent] ⚠ ${msg}`),
  error: (msg) => console.error(`  [Agent] ✗ ${msg}`),
  toolCall: (name, input) =>
    console.log(
      `  [Agent] → Tool: ${name}(${JSON.stringify(input).slice(0, 100)})`
    ),
  toolResult: (name, success, duration) =>
    console.log(`  [Agent] ← ${name}: ${success ? "✓" : "✗"} (${duration}ms)`),
};

export interface AgentLoopOptions {
  sessionId: string;
  target: SessionTarget;
  config: SessionConfig;
  llm: LLMProvider;
  toolRegistry: ToolRegistry;
  eventBus: EventBusImpl;
  container: import("@test-harness/th-core").THContainer;
  logger?: AgentLogger;
  signal?: AbortSignal;
  /** Phase 2: Site-specific hints from SiteProfile for generalized testing */
  siteHints?: SiteHints;
  /** Uploaded images (base64 data URLs) for vision-capable LLMs */
  images?: string[];
  /** Optional diagnostic hook for decision-time snapshot identity */
  onDecisionSnapshotIdentity?: (identity: import('./workflow.js').SnapshotIdentity | null) => void;
  /** P2-E I7-B-R1: session-owned identity semantics mode, pinned by the caller */
  identitySemanticsMode?: import('./identity-semantics.js').IdentitySemanticsMode;
  /** P2-E I7-B-R2: diagnostic hook for request-bound P2E provenance */
  onDecisionProvenance?: (provenance: import('./identity-semantics.js').DecisionProvenance) => void;
  /** P2-E I8-A: Global rollout policy (read ONCE at session creation) */
  rolloutPolicy?: import('./session-persistence.js').GlobalRolloutPolicy;
  /** P2-E I8-A: Session persistence store for restart recovery */
  sessionPersistenceStore?: import('./session-persistence.js').SessionPersistenceStore;
}

// ─── Phase 4: Coverage Helper Functions ──────────────────────────────────────

/** Map aria role string to CoverageFeatureType */
function ariaRoleToFeatureType(role: string): FeatureType | null {
  const r = role.toLowerCase();
  if (r === 'button') return 'button';
  if (r === 'link') return 'link';
  if (r === 'textbox' || r === 'textarea') return 'text-input';
  if (r === 'spinbutton') return 'number-input';
  if (r === 'checkbox') return 'checkbox';
  if (r === 'radio') return 'radio';
  if (r === 'combobox' || r === 'listbox') return 'dropdown';
  if (r === 'table' || r === 'grid') return 'table';
  if (r === 'tab') return 'tab';
  if (r === 'dialog' || r === 'alertdialog') return 'modal';
  return null;
}

/**
 * Discover features from an aria snapshot and register them in the coverage model.
 * Called when we first arrive on a surface, or when the surface changes significantly.
 */
function discoverFeaturesFromSnapshot(
  snapshot: string,
  surface: import('./coverage.js').CoverageSurface
): void {
  const lines = snapshot.split('\n');
  let featureIndex = 0;

  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '');
    // Match: [ref=XX] role "label" or role "label"
    const refMatch = trimmed.match(/(?:\[ref=(\w+)\]\s*)?(\w+)\s+"([^"]+)"/);
    if (!refMatch) continue;

    const ref = refMatch[1];
    const role = (refMatch[2] ?? '').toLowerCase();
    const label = (refMatch[3] ?? '').trim();

    const featureType = ariaRoleToFeatureType(role);
    if (!featureType || !label) continue;

    // Skip overly long labels — likely dynamic/placeholder content, not stable UI labels
    if (label.length > 15) continue;

    const key = ref ?? `feat_${featureIndex++}`;
    const feature = registerFeature(surface, key, label, featureType);
    // Store the aria ref for action-to-target matching
    if (ref) {
      feature.ref = ref;
    }
  }

  // Heuristic: detect search fields from textbox labels
  for (const line of lines) {
    const trimmed = line.replace(/^\s+/, '');
    const refMatch = trimmed.match(/(?:\[ref=(\w+)\]\s*)?textbox\s+"([^"]+)"/i);
    if (refMatch) {
      const label = (refMatch[2] ?? '').toLowerCase();
      const rawLabel = refMatch[2] ?? '';
      if (/search|\u641C\u7D22|filter|\u7B5B\u9009|\u67E5\u627E/.test(label)) {
        const key = refMatch[1] ?? `feat_${featureIndex++}`;
        registerFeature(surface, key, rawLabel, 'search');
      }
    }
  }
}

/**
 * Update coverage model after a successful action tool execution.
 * Marks the current target's scenario as tested with the appropriate outcome.
 */
function updateCoverageFromAction(
  model: CoverageModel,
  toolName: string,
  success: boolean,
  currentSurfaceKey?: string,
  currentTarget?: CoverageTarget | null
): void {
  if (!currentSurfaceKey || !currentTarget) return;

  // Find the target feature and update its scenario
  for (const module of model.modules) {
    const surface = module.surfaces.find(s => s.key === currentSurfaceKey);
    if (!surface) continue;

    const feature = surface.features.find(f => f.key === currentTarget.featureKey);
    if (!feature) continue;

    const scenarioType = currentTarget.scenarioType;
    const outcome: ScenarioOutcome = success ? 'pass' : 'fail';

    updateScenario(feature, scenarioType, outcome, {
      action: toolName,
      result: outcome,
      turn: 0, // Will be filled in by caller if needed
      timestamp: Date.now(),
    });

    // Update surface coverage status
    updateSurfaceCoverageStatus(surface, COVERAGE_POLICIES.smoke);
    break;
  }
}

export class AgentLoop {
  private logger: AgentLogger;

  constructor() {
    this.logger = defaultLogger;
  }

  /**
   * Run the agent loop for a scan.
   *
   * This is the main entry point — it creates the session log, context,
   * and drives the Turn → Step → Model → Tool → Result cycle.
   */
  async run(options: AgentLoopOptions): Promise<AgentResult> {
    const logger = options.logger ?? this.logger;
    const abortController = new AbortController();
    if (options.signal) {
      options.signal.addEventListener("abort", () =>
        abortController.abort()
      );
    }

    // ── P2-E I8-A: Session Semantics Pinning & Recovery ──
    // CRITICAL: Global rollout policy is read ONCE at session creation.
    // Persisted mode is the runtime correctness authority.
    // Worker restart restores persisted mode, does NOT re-read global flag.
    let sessionSemantics: import('./identity-semantics.js').SessionIdentitySemantics;
    let recoveredState: import('./identity-semantics.js').PersistedSessionState | null = null;

    if (options.sessionPersistenceStore) {
      // Attempt to recover existing session state. A stored but invalid record
      // must not be mistaken for a new session and repaired via global rollout.
      const persistedCandidate = await options.sessionPersistenceStore.load(options.sessionId);
      recoveredState = await import('./session-persistence.js').then(m =>
        m.recoverSessionState(options.sessionId, options.sessionPersistenceStore!)
      );

      if (persistedCandidate && !recoveredState) {
        throw new Error(`[I8-B-R2] persisted session ${options.sessionId} is invalid; recovery rejected`);
      }

      if (recoveredState) {
        // Session recovery: restore persisted semantics (DO NOT re-read global flag)
        sessionSemantics = recoveredState.semantics;
        logger.info(`[I8-A] Session ${options.sessionId} recovered with mode=${sessionSemantics.mode}`);
      } else {
        // New session or legacy migration: read global rollout policy ONCE
        const { createSessionState, migrateLegacySessionState } = await import('./session-persistence.js');

        if (options.rolloutPolicy) {
          // New session: resolve effective mode from the actual backend capability.
          // A caller cannot assert capability through rollout configuration.
          const { decideNewSessionMode } = await import('./rollout-compatibility.js');
          const requestedMode = options.rolloutPolicy.getMode();
          const rolloutDecision = decideNewSessionMode(
            { getMode: () => requestedMode },
            options.sessionPersistenceStore.capabilities,
          );
          sessionSemantics = {
            mode: rolloutDecision.mode,
            pinnedAt: Date.now(),
            semanticsVersion: 'p2e-v1' as const,
          };
          await createSessionState(options.sessionId, {
            getMode: () => rolloutDecision.mode,
          }, options.sessionPersistenceStore);
          logger.info(`[I8-B] Session ${options.sessionId} requested=${options.rolloutPolicy.getMode()} effective=${rolloutDecision.mode} reason=${rolloutDecision.reason}`);
        } else {
          // Legacy migration: no rollout policy, migrate to LEGACY
          const migratedState = await migrateLegacySessionState(options.sessionId, options.sessionPersistenceStore);
          sessionSemantics = migratedState.semantics;
          recoveredState = migratedState;
          logger.info(`[I8-A] Session ${options.sessionId} migrated from legacy to LEGACY`);
        }
      }
    } else {
      // No persistence store: use explicit mode or default to LEGACY
      sessionSemantics = {
        mode: options.identitySemanticsMode ?? 'LEGACY',
        pinnedAt: Date.now(),
        semanticsVersion: 'p2e-v1' as const,
      };
    }

    // Create the session log — the single source of truth
    const sessionLog = new SessionLog();

    const context: AgentContext & { workflow: WorkflowContext; workflowState: WorkflowState } = {
      sessionId: options.sessionId,
      target: options.target,
      config: options.config,
      llm: options.llm,
      toolRegistry: options.toolRegistry,
      eventBus: options.eventBus,
      container: options.container,
      sessionLog,
      state: new Map<string, unknown>([
        ["loginGuard", createLoginGuardState()],
        ["onDecisionSnapshotIdentity", options.onDecisionSnapshotIdentity],
        ["onDecisionProvenance", options.onDecisionProvenance],
      ]),
      turnCount: 0,
      stepCount: 0,
      maxTurns: options.config.maxTurns ?? 99,
      maxRetriesPerAction: options.config.maxRetriesPerAction ?? 3,
      toolFailureCounts: new Map(),
      abortSignal: abortController.signal,
      workflow: {
        ...createInitialContext(options.config.maxTurns ?? 99, options.target.url),
        sessionIdentitySemantics: sessionSemantics,
        // Restore recovered state if available
        ...(recoveredState && {
          decisionProvenance: recoveredState.lastDecisionProvenance,
          // CRITICAL (I8-A-R2): Persisted current observation is historical evidence only.
          // It is NOT authoritative after restart. Always require fresh observation.
          // This enforces: "A session's correctness mode survives restart; a browser
          // observation's authority does NOT automatically survive restart."
          currentObservation: { kind: 'none' },
          // Restore occurrence counter for restart-safe occurrence ID allocation
          occurrenceCounter: recoveredState.occurrenceCounter,
        }),
      },
      workflowState: WorkflowState.INIT,
      cognition: new CognitiveEngine({ storagePath: path.resolve(process.cwd(), '.cognition') }),
    };

    logger.info(`[STATE] session started for ${options.target.url}`);

    // ── Cognitive Engine: Session start — retrieve relevant experiences ──
    if (context.cognition) {
      const sessionStart = context.cognition.onSessionStart(options.target.url, options.config.strategy);
      if (sessionStart.prompt) {
        sessionLog.append("system/note", {
          note: `[Cognition] 历史经验:\n${sessionStart.prompt}`,
        });
        logger.debug(`[Cognition] Retrieved experiences for ${options.target.url}`);
      }
    }

    // Log the initial user message (session task)
    const availableTools = options.toolRegistry
      .getAll()
      .map((t) => t.id);

    sessionLog.append("user/message", {
      turn: 0,
      content: buildSessionPlanningPrompt(
        options.target.url,
        availableTools,
        options.config.instructions as string | undefined,
        options.siteHints
      ),
      images: options.images,
    });

    // Log a system note about session configuration
    sessionLog.append("system/note", {
      note: `Session config: strategy=${options.config.strategy}, maxTurns=${context.maxTurns}, tools=[${availableTools.join(", ")}]`,
    });

    // Main loop
    while (
      context.turnCount < context.maxTurns &&
      !abortController.signal.aborted
    ) {
      context.turnCount++;
      context.stepCount = 0;
      logger.debug(`Turn ${context.turnCount}...`);

      // Log turn start
      sessionLog.append("turn/start", { turn: context.turnCount });

      // Emit turn started event
      await options.eventBus.emit(AgentTurnStartedEvent, {
        sessionId: options.sessionId,
        turnNumber: context.turnCount,
      });

      try {
        const result = await this.executeTurn(context, logger);

        if (result.complete) {
          // Log turn end with completed reason
          sessionLog.append("turn/end", {
            turn: context.turnCount,
            reason: { kind: "completed" },
          });

          logger.info("[STATE] session complete.");
          
          // ── Cognitive Engine: Session end — save memories ──
          await this.finalizeSession(context, "completed", result.response.content, logger);
          
          return {
            sessionId: options.sessionId,
            status: "completed",
            turns: context.turnCount,
            summary: result.response.content,
          };
        }

        // Log turn end (continuing — tools need more work)
        sessionLog.append("turn/end", {
          turn: context.turnCount,
          reason: { kind: "completed" },
        });
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error(String(err));

        // Log turn end with error
        sessionLog.append("turn/end", {
          turn: context.turnCount,
          reason: { kind: "error", error: error.message },
        });

        logger.error(`Turn failed: ${error.message}`);
        
        // ── Cognitive Engine: Session end — save memories ──
        await this.finalizeSession(context, "failed", error.message, logger);
        
        return {
          sessionId: options.sessionId,
          status: "failed",
          turns: context.turnCount,
          error,
        };
      }
    }

    // Loop ended without completion
    sessionLog.append("turn/end", {
      turn: context.turnCount,
      reason: abortController.signal.aborted
        ? { kind: "aborted", reason: "User cancelled" }
        : { kind: "timeout" },
    });

    if (abortController.signal.aborted) {
      // ── Cognitive Engine: Session end — save memories ──
      await this.finalizeSession(context, "cancelled", "User cancelled", logger);
        
      return {
        sessionId: options.sessionId,
        status: "cancelled",
        turns: context.turnCount,
      };
    }
      
    // ── Cognitive Engine: Session end — save memories ──
    await this.finalizeSession(context, "timeout", "Maximum turns reached", logger);
      
    return {
      sessionId: options.sessionId,
      status: "timeout",
      turns: context.turnCount,
      summary: "Maximum turns reached",
    };
  }
  
  /**
   * Finalize session: save memories and learn from outcomes.
   */
  private async finalizeSession(
    context: AgentContext & { workflow: WorkflowContext; workflowState: WorkflowState },
    status: 'completed' | 'failed' | 'cancelled' | 'timeout',
    summary: string | undefined,
    logger: AgentLogger
  ): Promise<void> {
    if (!context.cognition) return;
      
    try {
      // Determine outcome
      const outcome = status === 'completed' ? 'success' : 'failure';
        
      // Collect actions from session log
      const actions: Array<{ tool: string; input: Record<string, unknown>; success: boolean }> = [];
      const logEntries = context.sessionLog.getEvents();
      for (const entry of logEntries) {
        if (entry.type === 'tool/result') {
          const data = entry.data as unknown as Record<string, unknown>;
          actions.push({
            tool: data.name as string,
            input: {},
            success: data.success as boolean,
          });
        }
      }
        
      // Collect findings (detected errors)
      const findings = context.workflow.detectedErrors.map(e => ({
        severity: 'medium',
        title: `操作失败: ${e.tool}`,
        description: e.error,
      }));
        
      // Save to cognitive engine
      context.cognition.onSessionEnd(
        context.target.url,
        outcome,
        findings,
        actions
      );
        
      // Log stats
      const stats = context.cognition.getStats();
      logger.debug(`[Cognition] Session saved. Memory: ${stats.episodes} episodes, ${stats.knowledge} knowledge, ${stats.procedures} procedures`);
    } catch (err) {
      logger.warn(`[Cognition] Failed to save session: ${err}`);
    }
  }

  /**
   * Execute a single turn: build messages → call LLM → execute tools.
   *
   * A turn consists of one or more steps. Each step is:
   * 1. Pre-step waterfall (plugins can modify/reject)
   * 2. Model request (with waterfall for config modification)
   * 3. Tool call execution (with waterfall for pre/post processing)
   */
  private async executeTurn(
    context: AgentContext & { workflow: WorkflowContext; workflowState: WorkflowState },
    logger: AgentLogger
  ): Promise<TurnResult> {
    const { sessionLog, eventBus } = context;

    context.stepCount++;
    const step = context.stepCount;

    // ── Workflow: Add state-specific prompt ─
    const statePrompt = getStatePrompt(context.workflowState);
    const testType = context.config.testType;
    const basePrompt = getSystemPrompt(testType);
    const enhancedSystemPrompt = basePrompt + '\n\n' + statePrompt;

    // ── Phase 4: Coverage-driven prompt injection ──
    let finalSystemPrompt = enhancedSystemPrompt;
    if (context.workflowState === WorkflowState.TEST && context.workflow.coverageInitialized && context.workflow.coverageModel && context.workflow.coveragePolicy) {
      const coverageModel = context.workflow.coverageModel;
      const coveragePolicy = context.workflow.coveragePolicy;

      const instructions = context.config.instructions as string | undefined;
      // 1. Update surface from latest snapshot
      const rawSnapshot = context.workflow.lastRawSnapshot;
      if (rawSnapshot) {
        const currentSignature = extractSurfaceSignature(rawSnapshot, context.workflow.currentPageUrl);
        const currentSurfaceKey = generateSurfaceKey(currentSignature);

        // Check if surface changed
        if (coverageModel.currentSurfaceKey) {
          const prevSurface = coverageModel.modules
            .flatMap(m => m.surfaces)
            .find(s => s.key === coverageModel.currentSurfaceKey);
          if (prevSurface) {
            // Compare using stored signature hash instead of reconstructing empty signature
            const prevHash = prevSurface.signatureHash ?? '';
            const currHash = currentSignature.hash;
            const change = prevHash === currHash ? 'same' as const :
                           prevHash ? 'major' as const : 'minor' as const;
            
            // Log surface change — same: debug (noise), major: info (important)
            if (change === 'same') {
              logger.debug(`[SURFACE] key: ${currentSurfaceKey}, change: ${change}, hash: ${prevHash.slice(0,8)}→${currHash.slice(0,8)}`);
            } else {
              logger.info(`[SURFACE] changed: ${prevHash.slice(0,8)} → ${currHash.slice(0,8)} (${change})`);
            }
            
            if (change === 'major' && currentSurfaceKey !== coverageModel.currentSurfaceKey) {
              // New surface (different URL) — register it
              const moduleKey = generateModuleKey(currentSignature);
              const moduleName = generateModuleName(currentSignature);
              registerModule(coverageModel, moduleKey, moduleName);
              const newSurface = registerSurface(
                coverageModel, moduleKey, currentSurfaceKey,
                context.workflow.currentPageUrl, currentSignature.title
              );
              newSurface.signatureHash = currHash;
              discoverFeaturesFromSnapshot(rawSnapshot, newSurface);
              // P0-B: reconcile the persistent TestIntent against the newly
              // visible surface immediately. Do not reset CoverageModel;
              // only rebind roles and invalidate the local target.
              assignIntentRoles(coverageModel, instructions);
              coverageModel.currentSurfaceKey = currentSurfaceKey;
              context.workflow.currentCoverageTarget = undefined;
              context.workflow.targetStagnationCount = 0;
              const reconciledSurface = coverageModel.modules
                .flatMap(m => m.surfaces)
                .find(s => s.key === currentSurfaceKey);
              const reconciledRoles: Record<string, number> = {};
              for (const f of reconciledSurface?.features ?? []) {
                const role = f.intentRelevance?.role ?? 'none';
                reconciledRoles[role] = (reconciledRoles[role] ?? 0) + 1;
              }
              logger.info(`[TARGET] reconciled intent after major surface: ${currentSurfaceKey} title="${newSurface.title ?? ''}" roles=${JSON.stringify(reconciledRoles)}`);
              logger.info(`[SURFACE] Registered new surface: ${currentSurfaceKey}, ${newSurface.features.length} features`);
            }
          }
        } else {
          coverageModel.currentSurfaceKey = currentSurfaceKey;
        }
      }

      // 2. Select next target using the already extracted instruction context
      const target = selectNextTarget(coverageModel, coveragePolicy, instructions, context.workflow.skippedTargets);
      context.workflow.currentCoverageTarget = target ?? undefined;

      // 3. Build coverage context for LLM
      const coverageSummary = formatCoverageSummary(coverageModel, coveragePolicy, coverageModel.currentSurfaceKey);
      const coverageLines = ['\n## Coverage-Guided Testing'];
      coverageLines.push(coverageSummary);

      // Log coverage state — summary detail at debug, gap count at info
      const gaps = getCoverageGaps(coverageModel, coveragePolicy, instructions, true);
      logger.debug(`[COVERAGE] summary: ${coverageSummary.replace(/\n/g, ' | ')}`);
      logger.info(`[COVERAGE] gaps: ${gaps.length} remaining`);

      if (target) {
        coverageLines.push('');
        coverageLines.push(`CURRENT TARGET: Test ${target.featureKey} (${target.scenarioType}) [priority: ${target.priority.level}]`);

        // Log target — feature name + intent role (role is the semantic, not score)
        let roleStr = 'none';
        let featureName = target.featureKey;
        for (const m of coverageModel.modules) {
          const s = m.surfaces.find(ss => ss.key === target.surfaceKey);
          if (!s) continue;
          const f = s.features.find(ff => ff.key === target.featureKey);
          if (f) {
            featureName = f.name;
            if (f.intentRelevance) {
              roleStr = f.intentRelevance.role;
            }
          }
          break;
        }
        logger.info(`[TARGET] ${target.featureKey} "${featureName}" scenario=${target.scenarioType} priority=${target.priority.level} role=${roleStr}`);

        // Generate a plan for this target to guide the LLM
        const plan = generateTestPlan(coverageModel, target, coveragePolicy);
        if (plan && validateTestPlan(plan)) {
          // Log plan summary at info, step details at debug
          logger.info(`[PLAN] planner=${plan.plannerLevel} steps=${plan.steps.length}`);
          for (const step of plan.steps) {
            logger.debug(`[PLAN]   - ${step.description}`);
          }

          // NOTE: Do NOT call markScenarioPlanned() here.
          // The scenario should only be marked as 'planned' after the LLM actually
          // performs a matching action. If we mark it here and the LLM does something
          // else, the scenario gets stuck in 'planned' state forever — it will keep
          // being selected by selectNextTarget() but never get tested.

          coverageLines.push('');
          coverageLines.push('Test steps:');
          for (const step of plan.steps) {
            coverageLines.push(`- ${step.description}`);
          }
        }
      } else {
        const finish = shouldFinishTesting(coverageModel, coveragePolicy, { turnsUsed: context.turnCount });
        
        // Log exit check
        logger.info(`[EXIT] complete: ${finish.shouldFinish}, reason: ${finish.reason}`);
        
        if (finish.shouldFinish) {
          context.workflow.coverageComplete = true;
          coverageLines.push('');
          coverageLines.push(`All coverage targets met (${finish.reason}). Proceed to to report.`);
        } else {
          coverageLines.push('');
          coverageLines.push('No specific target right now. Continue exploring the page.');
          coverageModel.discovery.stableTurns++;
        }
      }

      finalSystemPrompt = enhancedSystemPrompt + '\n' + coverageLines.join('\n');
    }

    // ── Step 1: Pre-step waterfall ──
    // Derive messages from session log
    const messages = sessionLog.deriveMessages(
      finalSystemPrompt,
      `T${context.turnCount}`,
    );

    // Fire pre-step waterfall — plugins can modify or reject
    const preStepResult = await eventBus.waterfall(AgentPreStepEvent, {
      sessionId: context.sessionId,
      turnNumber: context.turnCount,
      stepNumber: step,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      decision: "enter" as const,
    });

    if (preStepResult.decision === "reject") {
      return {
        complete: true,
        response: { content: "Step rejected by plugin" },
      };
    }

    // Log step start
    sessionLog.append("step/start", {
      turn: context.turnCount,
      step,
    });

    // ── Step 2: Build and fire request waterfall ──
    // P2E request-bound provenance must be captured before assembling the
    // model-visible observation and before calling the LLM. Both derive from
    // the same current ObservationOccurrence.
    if (isP2EActive(context.workflow)) {
      context.workflow = captureP2EDecisionProvenance(context.workflow);
      const captured = context.workflow.decisionProvenance;
      const provenanceHook = context.state.get('onDecisionProvenance') as
        | ((provenance: import('./identity-semantics.js').DecisionProvenance) => void)
        | undefined;
      if (captured) provenanceHook?.(captured);
      logger.debug(`[P2E-CAPTURE] request-bound provenance=${
        captured === 'LEGACY_UNAVAILABLE' ? 'LEGACY_UNAVAILABLE' :
          captured ? `${captured.occurrenceId}:${captured.observationContent.contentHash}` : 'null'
      }`);
    }

    // Get the (possibly modified) messages
    const finalMessages: Message[] = appendP2EObservationToRequest(
      preStepResult.messages.map(
        (m, i) => messages[i] ?? { role: m.role as Message["role"], content: m.content }
      ),
      context.workflow,
    );

    // Build tool schemas
    let toolSchemas: ToolSchema[] = context.toolRegistry.getSchemas();

    // ── Workflow: Filter tools based on current state ──
    const allowedTools = getAllowedTools(context.workflowState);
    if (allowedTools !== null) {
      toolSchemas = toolSchemas.filter(ts => allowedTools.includes(ts.name));
      logger.debug(`[STATE] state=${context.workflowState}, allowed tools: ${allowedTools.join(', ')}`);
    }

    // Request waterfall — plugins can modify model config
    const requestConfig = await eventBus.waterfall(AgentRequestEvent, {
      sessionId: context.sessionId,
      turnNumber: context.turnCount,
      stepNumber: step,
      model: context.config.llm.model || process.env.QWEN_MODEL || "qwen3.7-plus",
      temperature: context.config.llm.temperature ?? 0.1,
      maxTokens: undefined,
    });

    // Log request config
    sessionLog.append("request/config", {
      turn: context.turnCount,
      step,
      model: requestConfig.model,
      provider: context.config.llm.provider,
      temperature: requestConfig.temperature,
      maxTokens: requestConfig.maxTokens,
      toolCount: toolSchemas.length,
    });

    // ── P2-E I7-B-R1 Integration Point 1: Request provenance already captured ──
    // It was captured above before finalMessages was assembled and before the
    // LLM call. Do not capture again here: that would be response/execute-time
    // backfill and could replace O17 with a newer O18.

    // ── Step 3: Call LLM (streaming) ──
    const assembler = new StreamAssembler();
    let lastStreamEmit = 0;

    try {
      const stream = context.llm.stream({
        model: requestConfig.model,
        messages: finalMessages,
        tools: toolSchemas.length > 0 ? toolSchemas : undefined,
        temperature: requestConfig.temperature,
        maxTokens: requestConfig.maxTokens,
        signal: context.abortSignal,
      });

      for await (const chunk of stream) {
        assembler.push(chunk);

        // Emit streaming progress every 200ms for terminal display
        const now = Date.now();
        if (now - lastStreamEmit > 200 || assembler.done) {
          lastStreamEmit = now;
          await eventBus.emit(AgentStreamChunkEvent, {
            sessionId: context.sessionId,
            turnNumber: context.turnCount,
            partialContent: assembler.partialContent,
            toolCallCount: assembler.toolCallCount,
            done: assembler.done,
          });
        }
      }
    } catch (err) {
      // If streaming fails, log and rethrow
      logger.error(`LLM streaming failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }

    // Assemble the complete response from streaming chunks
    const response = assembler.finish(requestConfig.model);

    // Log assistant message
    sessionLog.append("assistant/message", {
      turn: context.turnCount,
      step,
      content: response.content,
      toolCalls: response.toolCalls?.map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
      })),
      usage: response.usage,
    });

    // Log step end
    sessionLog.append("step/end", {
      turn: context.turnCount,
      step,
    });

    // If no tool calls, the agent might be done — but check coverage first.
    if (!response.toolCalls || response.toolCalls.length === 0) {
      // If in TEST state with coverage model, check if testing is actually complete
      if (context.workflowState === WorkflowState.TEST && context.workflow.coverageModel && context.workflow.coveragePolicy) {
        const finish = shouldFinishTesting(
          context.workflow.coverageModel,
          context.workflow.coveragePolicy,
          { turnsUsed: context.turnCount }
        );

        if (finish.shouldFinish) {
          // Coverage complete — let the workflow transition to REPORT on the next check
          context.workflow.coverageComplete = true;
          logger.info(`[EXIT] LLM stopped but coverage complete: ${finish.reason}`);
          sessionLog.append('system/note', {
            note: `[Coverage] Complete: ${finish.reason}. Rate: ${(finish.details.coverageRate * 100).toFixed(0)}%`,
          });
        } else {
          // Coverage NOT complete — continue testing, prompt LLM to keep going
          const noToolInstructions = context.config.instructions as string | undefined;
          const gaps = getCoverageGaps(context.workflow.coverageModel, context.workflow.coveragePolicy, noToolInstructions, true);
          logger.info(`[EXIT] coverage incomplete: ${gaps.length} targets remaining — continuing`);
          const topGap = gaps[0];
          const guidance = topGap
            ? `Continue testing. Next target: test "${topGap.featureKey}" (${topGap.scenarioType}) [priority: ${topGap.priority.level}]. Do NOT stop until all coverage targets are met.`
            : `Continue testing. There are still uncovered targets. Do NOT stop until all coverage targets are met.`;
          sessionLog.appendModelContext(
            { note: guidance },
            {
              semanticKind: 'coverage_continuation',
              contextLifetime: 'next_turn',
              targetLogicalTurnId: `T${context.turnCount + 1}`,
              modelProjection: { role: 'system', content: guidance },
            },
          );
          return { complete: false, response: { content: response.content }, toolResults: [] };
        }
      }

      // Fire turn-stopping event — plugins can request continuation
      await eventBus.serial(AgentTurnStoppingEvent, {
        sessionId: context.sessionId,
        turnNumber: context.turnCount,
        shouldContinue: false,
      });

      return {
        complete: true,
        response: { content: response.content },
      };
    }

    // ── Step 4: Execute tool calls ──
    const toolResults: TurnResult["toolResults"] = [];

    // Track whether the current coverage target was matched by any action this turn
    let targetMatchedThisTurn = false;

    // P2: Preserve the legacy snapshot identity only for LEGACY sessions.
    // P2E sessions captured request-bound provenance before the model request
    // above; recapturing here would be a response-time/current-time backfill
    // and could replace O17 with a newer O18.
    if (!isP2EActive(context.workflow)) {
      const decisionSnapshotIdentity = context.workflow.currentSnapshotIdentity
        ? { ...context.workflow.currentSnapshotIdentity }
        : null;
      context.workflow.decisionSnapshotIdentity = decisionSnapshotIdentity;
      const decisionHook = context.state.get('onDecisionSnapshotIdentity') as
        | ((identity: import('./workflow.js').SnapshotIdentity | null) => void)
        | undefined;
      decisionHook?.(decisionSnapshotIdentity ? { ...decisionSnapshotIdentity } : null);
    }

    for (const toolCall of response.toolCalls) {
      // ── P2-E I7-B-R1 Integration Point 2: Immediate pre-execution validation ──
      // CRITICAL: Validate EACH observation-dependent action immediately before dispatch.
      // This is inside the loop, so multi-tool responses revalidate before every action.
      // Only active for P2E sessions; LEGACY sessions preserve existing behavior.
      if (isP2EActive(context.workflow)) {
        const preValidation = validateBeforeToolDispatch(context.workflow, toolCall);
        logger.info(preValidation.diagnostic);

        if (!preValidation.allowed) {
          // BLOCKED: Do not dispatch the tool. Record a failed result and continue.
          // This ensures blocked actions NEVER reach the executor.
          const errorMsg = `BLOCKED by P2E provenance validation: ${preValidation.errorMessage}`;
          sessionLog.append("tool/result", {
            turn: context.turnCount,
            step,
            callId: toolCall.id,
            name: toolCall.name,
            success: false,
            error: errorMsg,
            data: null,
            duration: 0,
          });
          toolResults.push({
            toolCallId: toolCall.id,
            name: toolCall.name,
            success: false,
            error: errorMsg,
            data: null,
          });
          await eventBus.emit(AgentToolResultEvent, {
            sessionId: context.sessionId,
            turnNumber: context.turnCount,
            toolName: toolCall.name,
            success: false,
            duration: 0,
          });
          continue;
        }
      }

      // Log tool call
      sessionLog.append("tool/call", {
        turn: context.turnCount,
        step,
        callId: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      });

      logger.toolCall(toolCall.name, toolCall.arguments);

      // ── LOGIN GUARD: Evidence-based login state tracking ──
      // "URL is not a login URL" does NOT mean "logged in".
      // State transitions happen only via explicit evidence (login.ts).
      const toolArgs = toolCall.arguments as Record<string, unknown>;

      // Block re-login navigation ONLY when authenticated (evidence-confirmed)
      if (toolCall.name === "browser_navigate" || toolCall.name === "navigate_to") {
        const navUrl = String(toolArgs.url ?? "");
        const loginState = context.state.get("loginGuard") as LoginGuardState | undefined;
        if (loginState) {
          const blockCheck = shouldBlockNavigation(loginState, navUrl);
          if (blockCheck.blocked) {
            logger.warn(`[LoginGuard] BLOCKED ${toolCall.name}: ${navUrl} (status: ${loginState.status})`);
            const errorMsg = `BLOCKED: ${blockCheck.reason}`;
            sessionLog.append("tool/result", {
              turn: context.turnCount, step, callId: toolCall.id,
              name: toolCall.name, success: false, error: errorMsg, data: null, duration: 0,
            });
            toolResults.push({ toolCallId: toolCall.id, name: toolCall.name, success: false, error: errorMsg, data: null });
            await eventBus.emit(AgentToolCallEvent, {
              sessionId: context.sessionId, turnNumber: context.turnCount, toolName: toolCall.name, input: toolCall.arguments });
            await eventBus.emit(AgentToolResultEvent, {
              sessionId: context.sessionId, turnNumber: context.turnCount, toolName: toolCall.name, success: false, duration: 0 });
            continue;
          }
        }
      }

      // Record credential submission (fill_form/type on login fields)
      if (toolCall.name === "browser_fill_form" || toolCall.name === "browser_type") {
        const loginState = context.state.get("loginGuard") as LoginGuardState | undefined;
        if (loginState && (loginState.status === "login_page_detected" || loginState.status === "required")) {
          const argsStr = JSON.stringify(toolArgs).toLowerCase();
          const isLoginFields = argsStr.includes("password") || argsStr.includes("密码") ||
            argsStr.includes("username") || argsStr.includes("用户");
          if (isLoginFields) {
            const updated = recordCredentialsSubmitted(loginState, context.turnCount);
            context.state.set("loginGuard", updated);
            logger.info(`[LoginGuard] Credentials submitted → ${describeLoginState(updated)}`);
          }
        }
      }

      // Emit tool call event
      await eventBus.emit(AgentToolCallEvent, {
        sessionId: context.sessionId,
        turnNumber: context.turnCount,
        toolName: toolCall.name,
        input: toolCall.arguments,
      });

      // Pre-execute waterfall — plugins can deny or modify
      const preExecute = await eventBus.waterfall(ToolsPreExecuteEvent, {
        sessionId: context.sessionId,
        toolName: toolCall.name,
        input: toolCall.arguments,
        decision: "approve" as const,
      });

      let result: { success: boolean; data?: unknown; error?: string } = {
        success: false,
        error: "definitely_not_applied: execution not dispatched",
      };
      let duration = 0;

      if (preExecute.decision === "deny") {
        result = {
          success: false,
          error: `definitely_not_applied: ${preExecute.denyReason ?? "Tool execution denied by plugin before dispatch"}`,
        };
      } else {
        // 3-stage execution pipeline: prepare → dispatch → finalize
        const prepResult = context.toolRegistry.prepare(
          toolCall.name,
          preExecute.input,
          {
            sessionId: context.sessionId,
            abortSignal: context.abortSignal,
          }
        );

        if (!prepResult.ok) {
          result = {
            success: false,
            error: `definitely_not_applied: pre-dispatch validation rejected tool input: ${prepResult.result.error}`,
          };
        } else {
          // Dispatch with timeout control. The registry normally normalizes
          // dispatch failures, but a custom/alternate registry may throw.
          // A throw after prepare cannot prove no effect, so classify it as
          // dispatch_error and let I7 invalidate current.
          let dispatchResult;
          try {
            dispatchResult = await context.toolRegistry.dispatch(
              prepResult.prepared
            );
          } catch (error) {
            result = {
              success: false,
              error: `dispatch_error: ${error instanceof Error ? error.message : String(error)}`,
            };
            duration = 0;
            logger.toolResult(toolCall.name, false, duration);
            dispatchResult = null;
          }

          if (dispatchResult) {
            // Finalize — truncate large payloads
            const finalized = context.toolRegistry.finalize(dispatchResult);

            result = {
              success: finalized.success,
              data: finalized.data,
              error: finalized.error,
            };
            duration = finalized.duration;
            logger.toolResult(toolCall.name, finalized.success, duration);
          }
        }

        // Post-execute waterfall — plugins can modify result
        const postExecute = await eventBus.waterfall(ToolsPostExecuteEvent, {
          sessionId: context.sessionId,
          toolName: toolCall.name,
          success: result.success,
          data: result.data,
          error: result.error,
          duration,
          replaced: false,
        });

        if (postExecute.replaced) {
          result = {
            success: postExecute.success,
            data: postExecute.data,
            error: postExecute.error,
          };
        }

        // Emit tool result event
        await eventBus.emit(AgentToolResultEvent, {
          sessionId: context.sessionId,
          turnNumber: context.turnCount,
          toolName: toolCall.name,
          success: result.success,
          duration,
          data: result.data,
        });
      }

      // Log tool result
      sessionLog.append("tool/result", {
        turn: context.turnCount,
        step,
        callId: toolCall.id,
        name: toolCall.name,
        success: result.success,
        data: result.data,
        error: result.error,
        duration: 0, // Duration tracked in post-execute
      });

      // Track consecutive failures per tool
      // Reset counter when switching to a different tool
      const currentTool = toolCall.name;
      const lastTool = context.state.get("lastTool") as string | undefined;

      if (lastTool && lastTool !== currentTool) {
        // Tool changed — reset all failure counters
        context.toolFailureCounts.clear();
      }
      context.state.set("lastTool", currentTool);

      if (result.success) {
        context.toolFailureCounts.set(currentTool, 0);
      } else {
        const count = (context.toolFailureCounts.get(currentTool) ?? 0) + 1;
        context.toolFailureCounts.set(currentTool, count);

        // If tool hit max retries, inject system message to force strategy change
        if (count >= context.maxRetriesPerAction) {
          const strategyGuidance = `⚠️ Tool "${currentTool}" has failed ${count} consecutive times. You MUST try a different approach — use a different tool, different selector, or different strategy. Do NOT repeat the same failing action.`;
          sessionLog.appendModelContext(
            { note: strategyGuidance },
            {
              semanticKind: 'tool_failure_strategy',
              contextLifetime: 'next_turn',
              targetLogicalTurnId: `T${context.turnCount + 1}`,
              modelProjection: { role: 'system', content: strategyGuidance },
            },
          );
          logger.warn(`${currentTool} failed ${count}x — forcing strategy change`);
        }
      }

      toolResults.push({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: result.success,
        data: result.data,
        error: result.error,
      });

      // ── P2-E I7-B-R1 Integration Point 3: Post-execution invalidation ──
      // CRITICAL: After tool execution, classify effect and invalidate current if needed.
      // Only definitely_not_applied preserves current for state-changing tools.
      // Unknown/error/timeout/transport-lost results fail closed and invalidate.
      // Only active for P2E sessions.
      if (isP2EActive(context.workflow)) {
        context.workflow = handlePostToolExecution(context.workflow, toolCall, {
          success: result.success,
          error: result.error,
        });
        logger.debug(`[P2E-INVALIDATE] tool=${toolCall.name} currentState=${context.workflow.currentObservation.kind}`);
      }

      // ── I9-A-R1: Single-source authoritative snapshot fan-out ──
      // A browser_snapshot event has one acquisition owner. LEGACY and P2E
      // projections consume that event through one explicit coordinator.
      if (toolCall.name === 'browser_snapshot' && result.success) {
        const snapshotText = (result.data as { text?: string } | undefined)?.text;
        if (snapshotText !== undefined) {
          context.workflow = processAuthoritativeSnapshot(
            context.workflow,
            toolCall.name,
            snapshotText,
            context.workflow.currentPageUrl || context.target.url,
            snapshotText.length === 0 ? 'empty' : 'complete',
            (current, snapshot) => updateWorkflowContext(
              current,
              toolCall.name,
              toolCall.arguments as Record<string, unknown>,
              result.success,
              { ...(result.data as Record<string, unknown>), ...snapshot },
              context.workflowState,
            ),
          );
        } else {
          context.workflow = updateWorkflowContext(
            context.workflow,
            toolCall.name,
            toolCall.arguments as Record<string, unknown>,
            result.success,
            result.data as Record<string, unknown> | undefined,
            context.workflowState,
          );
        }
      } else {
        // Non-snapshot tools retain their existing LEGACY workflow projection.
        context.workflow = updateWorkflowContext(
          context.workflow,
          toolCall.name,
          toolCall.arguments as Record<string, unknown>,
          result.success,
          result.data as Record<string, unknown> | undefined,
          context.workflowState,
        );
      }

      // ── LoginGuard: Update login state from evidence ──
      // Requirement detection: from initial page observation (navigate or snapshot)
      const loginState = context.state.get("loginGuard") as LoginGuardState | undefined;
      if (loginState) {
        const snapshotText = (result.data as { text?: string } | undefined)?.text ?? '';

        if (toolCall.name === "browser_navigate" || toolCall.name === "browser_snapshot") {
          const url = context.workflow.currentPageUrl || context.target.url;
          const before = loginState.status;
          let updated = detectLoginRequirement(loginState, url, snapshotText, context.turnCount);
          // Confirmation check: after credentials submitted, look for success evidence
          if (updated.status === "login_in_progress" && toolCall.name === "browser_snapshot") {
            updated = checkLoginConfirmation(updated, url, snapshotText, context.turnCount);
          }
          if (updated.status !== before) {
            context.state.set("loginGuard", updated);
            logger.info(`[LoginGuard] ${before} → ${describeLoginState(updated)}`);
          } else {
            context.state.set("loginGuard", updated);
          }
        }
      }

      // ── Action Verification: Validate action had intended effect ──
      const actionTools = ['browser_click', 'browser_type', 'browser_fill_form',
        'browser_navigate', 'browser_select_option', 'browser_check',
        'browser_uncheck', 'browser_press_key'];
      if (actionTools.includes(toolCall.name) && result.success) {
        const beforeSnapshot = context.workflow.lastSnapshot;
        const afterSnapshot = context.workflow.lastPageContent;
        const currentUrl = context.workflow.currentPageUrl;

        if (beforeSnapshot && afterSnapshot) {
          const verification = verifyAction(
            toolCall.name,
            toolCall.arguments as Record<string, unknown>,
            beforeSnapshot,
            afterSnapshot,
            currentUrl
          );

          // Track verification outcome
          if (verification.outcome !== 'success') {
            context.workflow.verificationFailures++;
            context.workflow.lastVerificationOutcome = verification.outcome;

            // Record detected errors for reporting
            if (verification.outcome === 'error_appeared') {
              context.workflow.detectedErrors.push({
                tool: toolCall.name,
                error: verification.details,
                turn: context.turnCount,
              });
            }

            // Inject recovery guidance
            const guidance = getRecoveryGuidance(verification, context.workflow.verificationFailures);
            if (guidance) {
              sessionLog.appendModelContext(
                { note: guidance },
                {
                  semanticKind: 'recovery_guidance',
                  contextLifetime: 'next_turn',
                  targetLogicalTurnId: `T${context.turnCount + 1}`,
                  modelProjection: { role: 'system', content: guidance },
                },
              );
              logger.warn(`[Verify] ${verification.outcome}: ${verification.details}`);
            }
          } else {
            // Reset failure counter on success
            context.workflow.verificationFailures = 0;
            context.workflow.lastVerificationOutcome = 'success';
          }
        }
      }

      // ── Cognitive Engine: Learn from action outcome ──
      if (context.cognition) {
        context.cognition.onBeforeAction(toolCall.name, toolCall.arguments as Record<string, unknown>);
        const cogResult = context.cognition.onAfterAction(
          toolCall.name,
          toolCall.arguments as Record<string, unknown>,
          result.success,
          result.data,
          result.error
        );

        // Inject recovery suggestions if available
        if (cogResult.recoverySuggestions && cogResult.recoverySuggestions.length > 0) {
          sessionLog.appendModelContext(
            { note: `[Cognition] 恢复建议: ${cogResult.recoverySuggestions.join('; ')}` },
            {
              semanticKind: 'cognition_guidance',
              contextLifetime: 'next_turn',
              targetLogicalTurnId: `T${context.turnCount + 1}`,
              modelProjection: { role: 'system', content: `[Cognition] 恢复建议: ${cogResult.recoverySuggestions.join('; ')}` },
            },
          );
        }

        // Inject strategy adjustment if available
        if (cogResult.strategyAdjustment) {
          sessionLog.appendModelContext(
            { note: `[Cognition] 策略调整: ${cogResult.strategyAdjustment.adjustment}` },
            {
              semanticKind: 'cognition_guidance',
              contextLifetime: 'next_turn',
              targetLogicalTurnId: `T${context.turnCount + 1}`,
              modelProjection: { role: 'system', content: `[Cognition] 策略调整: ${cogResult.strategyAdjustment.adjustment}` },
            },
          );
        }
      }

      // ── Phase 4: Update coverage from action ──
      // ④ Boundary accounting: if the coverage model isn't initialized yet
      // (actions during NAVIGATE/LOGIN), buffer the action for replay once
      // coverage is initialized — it might have been the click that actually
      // reached the test target.
      if (!context.workflow.coverageModel) {
        const interactionTools = [
          'browser_click', 'browser_type', 'browser_fill_form',
          'browser_select_option', 'browser_check', 'browser_uncheck',
          'browser_press_key',
        ];
        if (interactionTools.includes(toolCall.name)) {
          context.workflow.pendingActions.push({
            toolName: toolCall.name,
            toolArgs: toolCall.arguments as Record<string, unknown>,
            success: result.success,
            turn: context.turnCount,
          });
        }
      }
      if (context.workflow.coverageModel && context.workflow.currentCoverageTarget) {
        // Only interaction tools (not navigation) should trigger coverage update
        const interactionTools = [
          'browser_click', 'browser_type', 'browser_fill_form',
          'browser_select_option', 'browser_check', 'browser_uncheck',
          'browser_press_key',
        ];
        if (interactionTools.includes(toolCall.name)) {
          const target = context.workflow.currentCoverageTarget;
          const toolArgs = toolCall.arguments as Record<string, unknown>;

          // Use resolveActionFeature() to find which feature this action corresponds to.
          // This tries ref → name → normalized matching across ALL features in the model.
          const match = resolveActionFeature(toolCall.name, toolArgs, context.workflow.coverageModel);

          const targetRef = String(toolArgs.target ?? '');
          const elementDesc = String(toolArgs.element ?? '');

          if (match && result.success) {
            // Matched a known feature — update its coverage.
            // Key: we update the MATCHED feature, not necessarily the current target.
            // This prevents false coverage when target and action don't align.
            const matchedFeature = match.feature;

            // Track if the current target was matched (for stagnation detection)
            if (matchedFeature.key === target.featureKey) {
              targetMatchedThisTurn = true;
            }
            const outcome: ScenarioOutcome = 'pass';

            // Find the scenario to update — prefer the target's scenarioType if the
            // matched feature IS the target; otherwise use 'normal' as default.
            const scenarioType = (matchedFeature.key === target.featureKey)
              ? target.scenarioType
              : 'normal';

            // Find the feature in the model to update its scenario
            for (const mod of context.workflow.coverageModel.modules) {
              for (const surf of mod.surfaces) {
                const feat = surf.features.find(f => f.key === matchedFeature.key);
                if (feat) {
                  updateScenario(feat, scenarioType, outcome, {
                    action: toolCall.name,
                    result: outcome,
                    turn: context.turnCount,
                    timestamp: Date.now(),
                  });
                  updateSurfaceCoverageStatus(surf, context.workflow.coveragePolicy!);
                  break;
                }
              }
            }

            logger.info(`[ACTION] ${toolCall.name} → ${matchedFeature.key} "${matchedFeature.name}" method=${match.method} confidence=${match.confidence.toFixed(2)} scenario=${scenarioType}`);

            // Check if coverage is now complete
            if (context.workflow.coveragePolicy) {
              const finish = shouldFinishTesting(
                context.workflow.coverageModel,
                context.workflow.coveragePolicy,
                { turnsUsed: context.turnCount }
              );
              if (finish.shouldFinish) {
                context.workflow.coverageComplete = true;
                logger.info(`[EXIT] coverage complete: ${finish.reason} (rate ${(finish.details.coverageRate * 100).toFixed(0)}%)`);
                sessionLog.append('system/note', {
                  note: `[Coverage] Complete: ${finish.reason}. Rate: ${(finish.details.coverageRate * 100).toFixed(0)}%`,
                });
              }
            }
          } else {
            // No reliable match — do NOT mark any feature as tested.
            // This prevents false coverage from incorrect matching.
            const matchInfo = match
              ? `method=${match.method} confidence=${match.confidence.toFixed(2)} (below threshold)`
              : 'no feature matched';
            logger.info(`[ACTION] ${toolCall.name} "${elementDesc}" unmatched (${matchInfo}) — target ${target.featureKey} unchanged`);

            // ── P1 diagnostics: why did the action fail to resolve? ──
            // Three verdicts:
            //   ref_drift    — target.feature.ref exists, differs from action ref,
            //                  action ref IS in the current snapshot → snapshot lifecycle
            //   ref_unknown  — action ref is NOT in the current snapshot → LLM/Tool
            //                  saw a different snapshot version than coverage registered
            //   no_ref       — action carries no ref; resolution relied on name only
            {
              const targetSurface = context.workflow.coverageModel.modules
                .flatMap(m => m.surfaces)
                .find(s => s.key === target.surfaceKey);
              const targetFeature = targetSurface?.features.find(f => f.key === target.featureKey);
              const snapshotRefs = context.workflow.currentSnapshotRefs;
              const actionRefInSnapshot = !targetRef || snapshotRefs.includes(targetRef);
              const targetRefInSnapshot = !targetFeature?.ref || snapshotRefs.includes(targetFeature.ref);
              const refConsistent = !targetFeature?.ref || !targetRef || targetFeature.ref === targetRef;

              let verdict: string;
              if (targetRef && targetFeature?.ref && !refConsistent && actionRefInSnapshot) {
                verdict = 'ref_drift (action ref is current; feature ref is stale)';
              } else if (targetRef && !actionRefInSnapshot) {
                verdict = 'ref_unknown (action ref not in current snapshot)';
              } else if (!targetRef) {
                verdict = 'no_ref (action had no ref; name-matching only)';
              } else {
                verdict = 'resolver_miss (refs consistent; resolver returned nothing)';
              }

              const currentId = context.workflow.currentSnapshotIdentity;
              const currentIdStr = currentId ? `v${currentId.version}:${currentId.hash}` : '—';
              const decisionProvenance = context.workflow.decisionProvenance;
              const p2eDiagnostic = isP2EActive(context.workflow)
                ? (() => {
                    const current = context.workflow.currentObservation;
                    const decision = decisionProvenance;
                    const decisionOccurrence = decision && decision !== 'LEGACY_UNAVAILABLE'
                      ? decision.occurrenceId
                      : 'LEGACY_UNAVAILABLE';
                    const currentOccurrence = current.kind === 'current'
                      ? current.occurrence.occurrenceId.occurrenceId
                      : current.kind;
                    const content = decision && decision !== 'LEGACY_UNAVAILABLE'
                      ? ` decisionContent=${decision.observationContent.contractVersion}:${decision.observationContent.contentHash}`
                      : '';
                    return `decisionOccurrence=${decisionOccurrence} currentOccurrence=${currentOccurrence} currentStateKind=${current.kind}${content}`;
                  })()
                : '';
              const decidedIdStr = isP2EActive(context.workflow)
                ? p2eDiagnostic
                : context.workflow.decisionSnapshotIdentity
                  ? `v${context.workflow.decisionSnapshotIdentity.version}:${context.workflow.decisionSnapshotIdentity.hash}`
                  : '—';
              logger.info(`[ALIGN] ${isP2EActive(context.workflow) ? decidedIdStr : `current=${currentIdStr} decided=${decidedIdStr}`} target=${target.featureKey}("${targetFeature?.name ?? '?'}",ref=${targetFeature?.ref ?? '-'}) action.ref=${targetRef || '-'} snapshot.refs=${snapshotRefs.length} target.ref-in-snap=${targetRefInSnapshot} action.ref-in-snap=${actionRefInSnapshot} verdict=${verdict}`);

              // Per-turn, only for unmatched: at debug, dump the few candidate
              // features on the target surface that share the action's element type.
              const toolTypeHint: Record<string, string[]> = {
                browser_click: ['button', 'link', 'checkbox', 'radio', 'tab'],
                browser_type: ['text-input', 'search'],
                browser_fill_form: ['form', 'text-input'],
                browser_select_option: ['dropdown'],
                browser_check: ['checkbox'],
                browser_uncheck: ['checkbox'],
              };
              const hintTypes = toolTypeHint[toolCall.name];
              if (hintTypes && targetSurface) {
                const candidates = targetSurface.features
                  .filter(f => hintTypes.includes(f.type))
                  .slice(0, 6)
                  .map(f => `${f.key}("${f.name}",ref=${f.ref ?? '-'})`);
                logger.debug(`[ALIGN] same-type candidates on surface: ${candidates.join(' | ') || 'none'}`);
              }
            }

            // Any successful interaction on same surface = some discovery progress
            if (result.success) {
              context.workflow.coverageModel.discovery.stableTurns++;
            }
          }
        }
      }
    }

    // ── Target Stagnation Detection ──
    // If the current target was NOT matched by any action this turn, increment
    // the stagnation counter. After 3 consecutive misses, skip the target to
    // prevent infinite loops where the LLM can't/won't test a selected target.
    if (context.workflow.currentCoverageTarget && context.workflow.coverageModel) {
      if (targetMatchedThisTurn) {
        context.workflow.targetStagnationCount = 0;
      } else {
        context.workflow.targetStagnationCount++;
        if (context.workflow.targetStagnationCount >= 3) {
          const skippedKey = context.workflow.currentCoverageTarget.featureKey;
          const skipReason = `stagnation: selected 3 turns without a matching action`;
          if (!context.workflow.skippedTargets.includes(skippedKey)) {
            context.workflow.skippedTargets.push(skippedKey);
            logger.warn(`[TARGET] Skipping stagnated target: ${skippedKey} (${skipReason})`);

            // ② Honest coverage: record skipped outcome so it's reportable,
            // not silently dropped from coverage.
            const skippedTarget = context.workflow.currentCoverageTarget;
            for (const mod of context.workflow.coverageModel!.modules) {
              for (const surf of mod.surfaces) {
                const feat = surf.features.find(f => f.key === skippedKey);
                if (feat) {
                  markScenarioSkipped(feat, skippedTarget.scenarioType, skipReason);
                  sessionLog.append('system/note', {
                    note: `[Coverage] ${feat.key}/${skippedTarget.scenarioType} skipped: ${skipReason}`,
                  });
                  break;
                }
              }
            }
          }
          context.workflow.targetStagnationCount = 0;
        }
      }
    }

    // ── Workflow: Check state transitions ──
    const previousState = context.workflowState;
    const transitionResult = tryTransition(context.workflow, context.workflowState);

    if (transitionResult.fired) {
      // Find the matching transition to get the target state
      for (const t of WORKFLOW_TRANSITIONS) {
        if (t.from === previousState && t.key === transitionResult.transitionKey) {
          context.workflowState = t.to;
          break;
        }
      }
      // Record coverage
      if (transitionResult.transitionKey && !context.workflow.traversedTransitions.includes(transitionResult.transitionKey)) {
        context.workflow.traversedTransitions.push(transitionResult.transitionKey);
      }
      // Log invariant violations
      if (!transitionResult.invariantOk && transitionResult.invariantViolation) {
        context.workflow.invariantViolations.push(
          `${previousState}→${context.workflowState}: ${transitionResult.invariantViolation}`
        );
        logger.warn(`[STATE] invariant violation: ${transitionResult.invariantViolation}`);
      }
      logger.info(`[STATE] ${previousState} → ${context.workflowState} (${transitionResult.message})`);
      logger.debug(`[STATE] transitions traversed: [${context.workflow.traversedTransitions.join(', ')}]`);
      sessionLog.append("system/note", {
        note: `[Workflow] ${previousState} → ${context.workflowState} | coverage: [${context.workflow.traversedTransitions.join(', ')}]`,
      });

      await eventBus.emit("agent:workflow_state" as any, {
        sessionId: context.sessionId,
        previousState,
        newState: context.workflowState,
        message: transitionResult.message,
      });

      // ── Phase 4: Initialize Coverage Model when entering TEST state ──
      if (context.workflowState === WorkflowState.TEST && !context.workflow.coverageInitialized) {
        logger.info('[COVERAGE] entering TEST state — initializing coverage model');
        try {
          // Take initial snapshot
          const snapshotTool = context.toolRegistry.get('browser_snapshot');
          let snapshotText = '';
          if (snapshotTool) {
            const snapResult = await snapshotTool.execute({}, {
              sessionId: context.sessionId,
              abortSignal: context.abortSignal,
            });
            if (snapResult.success && snapResult.data) {
              const snapshotData = snapResult.data as Record<string, unknown>;
              snapshotText = String(snapshotData.text ?? '');
              context.workflow = processAuthoritativeSnapshot(
                context.workflow,
                'browser_snapshot',
                snapshotText,
                context.workflow.currentPageUrl || context.target.url,
                snapshotText.length === 0 ? 'empty' : 'complete',
                (current, snapshot) => updateWorkflowContext(
                  current,
                  'browser_snapshot',
                  {},
                  true,
                  { ...snapshotData, ...snapshot },
                  context.workflowState,
                ),
              );
              snapshotText = context.workflow.lastRawSnapshot || snapshotText;
            }
          }

          // Create coverage model and policy
          const coverageModel = createCoverageModel();
          const testType = (context.config.testType ?? 'smoke') as CoverageTestType;
          const coveragePolicy = COVERAGE_POLICIES[testType];

          context.workflow.coverageModel = coverageModel;
          context.workflow.coveragePolicy = coveragePolicy;

          // Register initial surface from snapshot
          if (snapshotText) {
            const signature = extractSurfaceSignature(snapshotText, context.workflow.currentPageUrl);
            const surfaceKey = generateSurfaceKey(signature);
            const moduleKey = generateModuleKey(signature);
            const moduleName = generateModuleName(signature);

            registerModule(coverageModel, moduleKey, moduleName);
            const surface = registerSurface(
              coverageModel, moduleKey, surfaceKey,
              context.workflow.currentPageUrl, signature.title
            );
            // Store signature hash for surface change detection
            surface.signatureHash = signature.hash;

            // Discover features from the snapshot
            discoverFeaturesFromSnapshot(snapshotText, surface);
            coverageModel.currentSurfaceKey = surfaceKey;

            // Intent Model: extract structured intent and assign intent roles
            // (primary / prerequisite / supporting / incidental / irrelevant)
            // to every feature. Roles — not keyword scores — drive scope
            // filtering and layered target selection.
            const testType = (context.config.testType ?? 'smoke') as CoverageTestType;
            const instructions = context.config.instructions as string | undefined;
            const intent = assignIntentRoles(coverageModel, instructions);
            if (intent) {
              context.workflow.testIntent = intent;
              logger.info(`[TARGET] intent modules=${JSON.stringify(intent.primaryModules)} prerequisites=${JSON.stringify(intent.prerequisites)} actions=${JSON.stringify(intent.requiredActions)}`);
            }

            // Log role distribution
            const roleCounts: Record<string, number> = {};
            for (const f of surface.features) {
              const r = f.intentRelevance?.role ?? 'none';
              roleCounts[r] = (roleCounts[r] ?? 0) + 1;
            }
            const roleStr = Object.entries(roleCounts)
              .map(([r, c]) => `${r}:${c}`)
              .join(' ');

            logger.info(`[SURFACE] ${surfaceKey}: ${surface.features.length} features discovered`);
            logger.info(`[TARGET] intent roles: ${roleStr}`);
            const primaryFeatures = surface.features.filter(f => f.intentRelevance?.role === 'primary');
            for (const f of primaryFeatures.slice(0, 5)) {
              logger.info(`[TARGET]   primary: ${f.name} (${f.type})`);
            }
            const prereqFeatures = surface.features.filter(f => f.intentRelevance?.role === 'prerequisite');
            for (const f of prereqFeatures.slice(0, 3)) {
              logger.info(`[TARGET]   prerequisite: ${f.name} (${f.type})`);
            }
            logger.debug(`[COVERAGE] policy: ${testType}, scope: ${coveragePolicy.scope}, depth: ${JSON.stringify(coveragePolicy.scenarioDepth)}`);
          }

          context.workflow.coverageInitialized = true;

          // ④ Boundary accounting: replay pending actions (performed before
          // coverage init, e.g. the click that reached the test target)
          // through resolveActionFeature() now that features are registered.
          const pending = [...context.workflow.pendingActions];
          context.workflow.pendingActions = [];
          for (const pa of pending) {
            if (!pa.success) continue;
            const paMatch = resolveActionFeature(pa.toolName, pa.toolArgs, coverageModel);
            if (paMatch) {
              // Replay: update the matched feature's normal scenario
              for (const mod of coverageModel.modules) {
                for (const surf of mod.surfaces) {
                  const feat = surf.features.find(f => f.key === paMatch.feature.key);
                  if (feat) {
                    updateScenario(feat, 'normal', 'pass', {
                      action: pa.toolName,
                      result: 'pass',
                      turn: pa.turn,
                      timestamp: Date.now(),
                    });
                    updateSurfaceCoverageStatus(surf, coveragePolicy);
                    logger.info(`[ACTION] boundary replay: ${pa.toolName} → ${feat.key} "${feat.name}" (turn ${pa.turn}, method=${paMatch.method})`);
                    break;
                  }
                }
              }
            } else {
              logger.debug(`[ACTION] boundary replay: ${pa.toolName} unmatched — dropped`);
            }
          }

          // Check if already complete (e.g., no features found)
          const finishDecision = shouldFinishTesting(coverageModel, coveragePolicy, {
            turnsUsed: context.turnCount,
          });
          if (finishDecision.shouldFinish) {
            context.workflow.coverageComplete = true;
            logger.info(`[EXIT] already complete: ${finishDecision.reason}`);
          }

          sessionLog.append('system/note', {
            note: `[Coverage] Initialized: ${testType} policy, ${coverageModel.modules.reduce((s, m) => s + m.surfaces.reduce((s2, sur) => s2 + sur.features.length, 0), 0)} features tracked`,
          });
        } catch (err) {
          logger.warn(`[COVERAGE] failed to initialize: ${err instanceof Error ? err.message : String(err)}`);
          // Fallback: mark as initialized but let legacy testPlan path handle it
          context.workflow.coverageInitialized = true;
          context.workflow.coverageComplete = true;
        }
      }
    }

    // ─ Stagnation Detection: Check for modal dialogs when stuck ──
    if (context.workflow.stagnantTurns >= 2 && context.workflowState === WorkflowState.TEST) {
      const lastTool = context.state.get("lastTool") as string | undefined;
      // If agent is stuck and last action was a click, likely a modal appeared
      if (lastTool === 'browser_click' || lastTool === 'click_element') {
        sessionLog.append("system/note", {
          note: `⚠️ STUCK DETECTION: You've been stuck for ${context.workflow.stagnantTurns} turns after clicking. A modal dialog or confirmation popup may have appeared. Use browser_snapshot to check for dialogs and browser_handle_dialog or browser_click "确认"/"确定"/"OK" button if found.`,
        });
        logger.warn(`[Stagnation] ${context.workflow.stagnantTurns} turns stuck after click — checking for modal dialogs`);
      }
    }

    // ─ Verification Failure Escalation ──
    // If multiple consecutive verification failures, force strategy change
    if (context.workflow.verificationFailures >= 3) {
      const lastOutcome = context.workflow.lastVerificationOutcome;
      let escalationNote: string;

      if (lastOutcome === 'error_appeared') {
        escalationNote = `⚠️ VERIFICATION ESCALATION: ${context.workflow.verificationFailures} consecutive actions resulted in errors. ` +
          `This may indicate a bug OR a fundamental misunderstanding of the page. ` +
          `ACTION REQUIRED: Use report_finding to document the errors, then try a completely different approach.`;
      } else if (lastOutcome === 'no_change') {
        escalationNote = `⚠️ VERIFICATION ESCALATION: ${context.workflow.verificationFailures} consecutive actions had no effect on the page. ` +
          `The element you're trying to interact with may be: disabled, covered by an overlay, in an iframe, or not actually clickable. ` +
          `ACTION REQUIRED: Take a fresh browser_snapshot and find a DIFFERENT element to interact with.`;
      } else if (lastOutcome === 'dialog_blocked') {
        escalationNote = `⚠️ VERIFICATION ESCALATION: Dialog is blocking your actions. ` +
          `You MUST handle the dialog first using browser_handle_dialog or by clicking the dialog button.`;
      } else {
        escalationNote = `⚠️ VERIFICATION ESCALATION: ${context.workflow.verificationFailures} consecutive action failures. ` +
          `STOP and reassess. Take browser_snapshot to understand the current state.`;
      }

      sessionLog.append("system/note", { note: escalationNote });
      logger.warn(`[Verify] Escalation: ${context.workflow.verificationFailures} failures, outcome=${lastOutcome}`);

      // Reset to prevent repeated escalation messages
      context.workflow.verificationFailures = 0;
    }

    // Check if workflow is done
    if (context.workflowState === WorkflowState.DONE) {
      return {
        complete: true,
        response: { content: response.content },
        toolResults,
      };
    }

    return {
      complete: false,
      response: {
        content: response.content,
        toolCalls: response.toolCalls,
      },
      toolResults,
    };
  }
}
