/**
 * Cognitive Engine — the central coordinator for all cognitive capabilities.
 * 
 * Integrates:
 * - Memory System (working, episodic, semantic, procedural)
 * - Learning System (reinforcement, pattern recognition, knowledge distillation)
 * - Self-Healing System (error recovery, strategy adaptation, knowledge updates)
 * - Context System (context awareness, experience retrieval)
 * 
 * This is the "brain" that makes the system intelligent.
 */

import { WorkingMemory } from "./memory/working-memory.js";
import { EpisodicMemory, type Episode, type EpisodeType } from "./memory/episodic-memory.js";
import { SemanticMemory, type SemanticKnowledge, type KnowledgeType } from "./memory/semantic-memory.js";
import { ProceduralMemory, type Procedure, type ProcedureType } from "./memory/procedural-memory.js";
import { ReinforcementLearner, type RewardSignal } from "./learning/reinforcement-learner.js";
import { PatternRecognizer, type Pattern, type PatternType } from "./learning/pattern-recognizer.js";
import { KnowledgeDistiller, type DistilledKnowledge } from "./learning/knowledge-distiller.js";
import { ErrorRecovery, type ErrorType, type RecoveryStrategy } from "./healing/error-recovery.js";
import { StrategyAdapter, type TestingStrategy, type StrategyAdjustment } from "./healing/strategy-adapter.js";
import { KnowledgeUpdater, type KnowledgeUpdate, type KnowledgeHealth } from "./healing/knowledge-updater.js";
import { ContextAwareness, type ContextState } from "./context/context-awareness.js";
import { ExperienceRetriever, type RetrievedExperience } from "./context/experience-retriever.js";
import type { CognitionLearnedEntityPort } from './authority-port.js';

export interface CognitiveConfig {
  storagePath?: string;
  enableLearning?: boolean;
  enableSelfHealing?: boolean;
  enableContextAwareness?: boolean;
  learnedEntityPort?: CognitionLearnedEntityPort;
  siteId?: string;
  sessionId?: string;
  sessionTimestamp?: number;
}

export class CognitiveEngine {
  // Memory systems
  readonly workingMemory: WorkingMemory;
  readonly episodicMemory: EpisodicMemory;
  readonly semanticMemory: SemanticMemory;
  readonly proceduralMemory: ProceduralMemory;
  
  // Learning systems
  readonly reinforcementLearner: ReinforcementLearner;
  readonly patternRecognizer: PatternRecognizer;
  readonly knowledgeDistiller: KnowledgeDistiller;
  
  // Self-healing systems
  readonly errorRecovery: ErrorRecovery;
  readonly strategyAdapter: StrategyAdapter;
  readonly knowledgeUpdater: KnowledgeUpdater;
  
  // Context systems
  readonly contextAwareness: ContextAwareness;
  readonly experienceRetriever: ExperienceRetriever;
  
  // Configuration
  private config: Required<Omit<CognitiveConfig, 'learnedEntityPort' | 'siteId' | 'sessionId' | 'sessionTimestamp'>>
    & Pick<CognitiveConfig, 'learnedEntityPort' | 'siteId' | 'sessionId' | 'sessionTimestamp'>;
  
  constructor(config: CognitiveConfig = {}) {
    this.config = {
      storagePath: config.storagePath || '.cognition',
      enableLearning: config.enableLearning ?? true,
      enableSelfHealing: config.enableSelfHealing ?? true,
      enableContextAwareness: config.enableContextAwareness ?? true,
      learnedEntityPort: config.learnedEntityPort,
      siteId: config.siteId,
      sessionId: config.sessionId,
      sessionTimestamp: config.sessionTimestamp,
    };

    if (config.learnedEntityPort && (!config.siteId || !config.sessionId
      || typeof config.sessionTimestamp !== 'number' || !Number.isFinite(config.sessionTimestamp))) {
      throw new TypeError('Authority-backed cognition requires explicit siteId, sessionId, and sessionTimestamp');
    }
    
    // Initialize memory systems
    this.workingMemory = new WorkingMemory();
    const persistLearnedEntities = !this.config.learnedEntityPort;
    this.episodicMemory = new EpisodicMemory(`${this.config.storagePath}/episodes.json`, persistLearnedEntities);
    this.semanticMemory = new SemanticMemory(`${this.config.storagePath}/semantic.json`, persistLearnedEntities);
    this.proceduralMemory = new ProceduralMemory(`${this.config.storagePath}/procedures.json`, persistLearnedEntities);
    
    // Initialize learning systems
    this.reinforcementLearner = new ReinforcementLearner(`${this.config.storagePath}/q-values.json`);
    this.patternRecognizer = new PatternRecognizer(`${this.config.storagePath}/patterns.json`);
    this.knowledgeDistiller = new KnowledgeDistiller();
    
    // Initialize self-healing systems
    this.errorRecovery = new ErrorRecovery(`${this.config.storagePath}/recovery.json`);
    this.strategyAdapter = new StrategyAdapter(`${this.config.storagePath}/strategies.json`);
    this.knowledgeUpdater = new KnowledgeUpdater(`${this.config.storagePath}/updates.json`);
    
    // Initialize context systems
    this.contextAwareness = new ContextAwareness(
      this.workingMemory,
      this.episodicMemory,
      this.semanticMemory,
      this.proceduralMemory,
      this.patternRecognizer
    );
    this.experienceRetriever = new ExperienceRetriever(
      this.episodicMemory,
      this.semanticMemory,
      this.proceduralMemory
    );
  }
  
  // ─── Session Lifecycle ───
  
  /**
   * Called when a new session starts.
   */
  async onSessionStart(targetUrl: string, testType?: string): Promise<{
    context: ContextState;
    experiences: RetrievedExperience;
    prompt: string;
  }> {
    // Retrieve relevant experiences
    const experiences = this.config.learnedEntityPort
      ? await this.config.learnedEntityPort.retrieveForSession({
          siteId: this.config.siteId!, sessionId: this.config.sessionId!, targetUrl, testType,
        })
      : this.experienceRetriever.retrieveForSession(targetUrl, testType);
    
    // Build initial context (without page state yet)
    const context = this.contextAwareness.buildContext(targetUrl, '', '', []);
    
    // Set initial goals
    if (testType) {
      this.contextAwareness.addGoal(`执行 ${testType} 测试`);
    }
    
    // Generate prompt injection
    const prompt = this.experienceRetriever.formatForPrompt(experiences);
    
    return { context, experiences, prompt };
  }
  
  /**
   * Called when a session ends.
   */
  async onSessionEnd(
    targetUrl: string,
    outcome: 'success' | 'failure' | 'partial',
    findings: Array<{ severity: string; title: string; description: string }>,
    actions: Array<{ tool: string; input: Record<string, unknown>; success: boolean }>
  ): Promise<void> {
    if (this.config.learnedEntityPort) {
      await this.config.learnedEntityPort.recordSession({
        siteId: this.config.siteId!, sessionId: this.config.sessionId!, targetUrl,
        timestamp: this.config.sessionTimestamp!, outcome, findings, actions,
      });
    } else {
    // Store episode
    const episode: Omit<Episode, 'id' | 'accessCount' | 'lastAccessed'> = {
      type: 'session_summary',
      timestamp: Date.now(),
      sessionId: `session_${Date.now()}`,
      targetUrl,
      description: `Session ${outcome}: ${findings.length} findings`,
      actions,
      outcome,
      findings,
      tags: [targetUrl],
      confidence: 1,
    };
    
    this.episodicMemory.store(episode);
    
    // Distill knowledge from this session
    if (this.config.enableLearning) {
      const episodes = this.episodicMemory.getSiteEpisodes(targetUrl, 50);
      const distilled = this.knowledgeDistiller.distill(episodes);
      
      for (const d of distilled) {
        this.semanticMemory.store({
          type: d.type,
          timestamp: Date.now(),
          title: d.title,
          description: d.description,
          targetUrl,
          content: d.content,
          sourceEpisodes: d.sourceEpisodes,
          confidence: d.confidence,
          verificationCount: 0,
          tags: [],
          expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
        });
      }
    }
    }
    
    // Record strategy outcome
    const strategy = this.strategyAdapter.getBestStrategy(targetUrl);
    if (strategy) {
      this.strategyAdapter.recordOutcome(strategy.name, outcome === 'success');
    }
  }
  
  // ─── Action Lifecycle ───
  
  /**
   * Called before an action is executed.
   */
  onBeforeAction(toolName: string, input: Record<string, unknown>): void {
    // Store in working memory
    this.workingMemory.set('lastAction', { tool: toolName, input, timestamp: Date.now() });
  }
  
  /**
   * Called after an action is executed.
   */
  onAfterAction(
    toolName: string,
    input: Record<string, unknown>,
    success: boolean,
    result: unknown,
    error?: string
  ): {
    recoverySuggestions?: string[];
    strategyAdjustment?: StrategyAdjustment;
  } {
    const timestamp = Date.now();
    
    // Record in working memory
    const recentActions = this.workingMemory.get<Array<{ tool: string; success: boolean; timestamp: number }>>('recentActions') || [];
    recentActions.push({ tool: toolName, success, timestamp });
    this.workingMemory.set('recentActions', recentActions.slice(-20)); // Keep last 20
    
    // Learn from outcome
    if (this.config.enableLearning) {
      const reward = success ? 0.5 : -0.5;
      const context = this.workingMemory.get<string>('currentUrl') || 'unknown';
      
      this.reinforcementLearner.learn({
        action: toolName,
        context,
        reward,
        timestamp,
        sessionId: `session_${timestamp}`,
      });
    }
    
    // Handle failure
    if (!success && error && this.config.enableSelfHealing) {
      const errorType = this.errorRecovery.classifyError(error, toolName);
      const currentUrl = this.workingMemory.get<string>('currentUrl') || '';
      const recoverySuggestions = this.errorRecovery.suggestRecovery(error, toolName, currentUrl);
      
      // Check for strategy adjustment
      const strategy = this.strategyAdapter.getBestStrategy(currentUrl);
      const recentFailures = recentActions.filter(a => !a.success).length;
      const strategyAdjustment = strategy 
        ? this.strategyAdapter.suggestAdjustment(strategy, recentFailures)
        : undefined;
      
      return { recoverySuggestions, strategyAdjustment };
    }
    
    return {};
  }
  
  // ─── Context Building ───
  
  /**
   * Build current context state.
   */
  buildContext(
    currentUrl: string,
    pageTitle: string,
    pageSnapshot: string
  ): ContextState {
    const recentActions = this.workingMemory.get<Array<{ tool: string; success: boolean; timestamp: number }>>('recentActions') || [];
    
    return this.contextAwareness.buildContext(currentUrl, pageTitle, pageSnapshot, recentActions);
  }
  
  /**
   * Get context prompt for LLM.
   */
  getContextPrompt(context: ContextState): string {
    return this.contextAwareness.formatForPrompt(context);
  }
  
  /**
   * Get experience prompt for session start.
   */
  getExperiencePrompt(targetUrl: string, testType?: string): string {
    const experiences = this.experienceRetriever.retrieveForSession(targetUrl, testType);
    return this.experienceRetriever.formatForPrompt(experiences);
  }
  
  // ─── Error Recovery ───
  
  /**
   * Get recovery suggestions for an error.
   */
  getRecoverySuggestions(errorMessage: string, toolName: string): string[] {
    const currentUrl = this.workingMemory.get<string>('currentUrl') || '';
    return this.errorRecovery.suggestRecovery(errorMessage, toolName, currentUrl);
  }
  
  /**
   * Record recovery outcome.
   */
  recordRecoveryOutcome(strategyId: string, success: boolean): void {
    this.errorRecovery.recordOutcome(strategyId, success);
  }
  
  // ─── Knowledge Management ───
  
  /**
   * Add new knowledge.
   */
  addKnowledge(
    type: KnowledgeType,
    title: string,
    description: string,
    content: Record<string, unknown>,
    targetUrl?: string
  ): string {
    return this.semanticMemory.store({
      type,
      timestamp: Date.now(),
      title,
      description,
      targetUrl,
      content,
      sourceEpisodes: [],
      confidence: 0.7,
      verificationCount: 0,
      tags: [],
    });
  }
  
  /**
   * Reinforce knowledge (when confirmed).
   */
  reinforceKnowledge(id: string): void {
    this.semanticMemory.reinforce(id);
    this.knowledgeUpdater.reinforce(id);
  }
  
  /**
   * Weaken knowledge (when contradicted).
   */
  weakenKnowledge(id: string, evidence?: string): void {
    this.semanticMemory.weaken(id);
    this.knowledgeUpdater.weaken(id, evidence);
  }
  
  /**
   * Check knowledge health.
   */
  checkKnowledgeHealth(): {
    stale: KnowledgeHealth[];
    contradicted: KnowledgeHealth[];
    unverified: KnowledgeHealth[];
  } {
    const allKnowledge = this.semanticMemory.export();
    const healthResults = this.knowledgeUpdater.checkHealth(allKnowledge);
    return this.knowledgeUpdater.getNeedsAttention(healthResults);
  }
  
  // ─── Procedure Management ───
  
  /**
   * Add a new procedure.
   */
  addProcedure(
    type: ProcedureType,
    name: string,
    description: string,
    steps: Array<{ action: string; input: Record<string, unknown> }>,
    targetUrl?: string
  ): string {
    return this.proceduralMemory.store({
      type,
      timestamp: Date.now(),
      name,
      description,
      targetUrl,
      steps,
      preconditions: [],
      triggers: [],
      tags: [],
      confidence: 0.7,
    });
  }
  
  /**
   * Record procedure outcome.
   */
  recordProcedureOutcome(id: string, success: boolean): void {
    if (success) {
      this.proceduralMemory.recordSuccess(id);
    } else {
      this.proceduralMemory.recordFailure(id);
    }
  }
  
  // ─── Pattern Management ───
  
  /**
   * Add a new pattern.
   */
  addPattern(
    type: PatternType,
    name: string,
    description: string,
    indicators: string[],
    typicalOutcome: 'success' | 'failure' | 'mixed' | 'neutral',
    targetUrl?: string
  ): string {
    return this.patternRecognizer.store({
      type,
      timestamp: Date.now(),
      name,
      description,
      indicators,
      frequency: 1,
      confidence: 0.7,
      targetUrl,
      typicalOutcome,
      sampleEpisodes: [],
      sampleSize: 1,
      tags: [],
    });
  }
  
  /**
   * Detect patterns in current context.
   */
  detectPatterns(indicators: string[], targetUrl?: string): Pattern[] {
    return this.patternRecognizer.detect(indicators, targetUrl);
  }
  
  // ─── Goal Management ───
  
  /**
   * Set active goals.
   */
  setGoals(goals: string[]): void {
    this.contextAwareness.setGoals(goals);
  }
  
  /**
   * Add a goal.
   */
  addGoal(goal: string): void {
    this.contextAwareness.addGoal(goal);
  }
  
  /**
   * Remove a goal.
   */
  removeGoal(goal: string): void {
    this.contextAwareness.removeGoal(goal);
  }
  
  /**
   * Get active goals.
   */
  getGoals(): string[] {
    return this.contextAwareness.getGoals();
  }
  
  // ─── Statistics ───
  
  /**
   * Get cognitive system statistics.
   */
  getStats(): {
    episodes: number;
    knowledge: number;
    procedures: number;
    patterns: number;
    strategies: number;
    recoveryStrategies: number;
  } {
    return {
      episodes: this.episodicMemory.count(),
      knowledge: this.semanticMemory.count(),
      procedures: this.proceduralMemory.count(),
      patterns: this.patternRecognizer.count(),
      strategies: this.strategyAdapter.getAllStrategies().length,
      recoveryStrategies: this.errorRecovery.getAllStrategies().length,
    };
  }
  
  /**
   * Export all cognitive data.
   */
  export(): {
    episodes: Episode[];
    knowledge: SemanticKnowledge[];
    procedures: Procedure[];
    patterns: Pattern[];
    strategies: TestingStrategy[];
    recoveryStrategies: RecoveryStrategy[];
  } {
    return {
      episodes: this.episodicMemory.export(),
      knowledge: this.semanticMemory.export(),
      procedures: this.proceduralMemory.export(),
      patterns: this.patternRecognizer.export(),
      strategies: this.strategyAdapter.getAllStrategies(),
      recoveryStrategies: this.errorRecovery.getAllStrategies(),
    };
  }
  
  /**
   * Clear all cognitive data.
   */
  clear(): void {
    this.workingMemory.clear();
    this.episodicMemory.clear();
    this.semanticMemory.clear();
    this.proceduralMemory.clear();
    this.reinforcementLearner.clear();
    this.patternRecognizer.clear();
    this.errorRecovery.clear();
    this.strategyAdapter.clear();
    this.knowledgeUpdater.clear();
  }
  
  // ─── User Feedback ───
  
  /**
   * Flag knowledge as inaccurate (user feedback).
   */
  flagKnowledgeAsInaccurate(id: string, reason: string): boolean {
    const knowledge = this.semanticMemory.get(id);
    if (!knowledge) return false;
    
    // Weaken the knowledge
    this.semanticMemory.weaken(id, 0.3);
    
    // Record the feedback
    this.knowledgeUpdater.weaken(id, reason);
    
    return true;
  }
  
  /**
   * Add manual experience (user-provided).
   */
  addManualExperience(data: {
    targetUrl: string;
    description: string;
    type: 'session_summary' | 'bug_found' | 'recovery_success' | 'site_discovery';
    outcome: 'success' | 'failure' | 'partial' | 'neutral';
    findings?: Array<{ severity: string; title: string; description: string }>;
  }): string {
    return this.episodicMemory.store({
      type: data.type,
      timestamp: Date.now(),
      sessionId: `manual_${Date.now()}`,
      targetUrl: data.targetUrl,
      description: data.description,
      actions: [],
      outcome: data.outcome,
      findings: data.findings,
      tags: ['manual', 'user-provided'],
      confidence: 0.9, // High confidence for user-provided data
    });
  }
  
  /**
   * Adjust knowledge weight (boost or reduce confidence).
   */
  adjustKnowledgeWeight(id: string, factor: number): boolean {
    if (factor > 0) {
      return this.semanticMemory.reinforce(id, factor);
    } else {
      return this.semanticMemory.weaken(id, Math.abs(factor));
    }
  }
  
  /**
   * Get all knowledge for a site (for user review).
   */
  getSiteKnowledgeForReview(targetUrl: string): Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    confidence: number;
    verificationCount: number;
  }> {
    const knowledge = this.semanticMemory.getSiteKnowledge(targetUrl, 100);
    return knowledge.map(k => ({
      id: k.id,
      type: k.type,
      title: k.title,
      description: k.description,
      confidence: k.confidence,
      verificationCount: k.verificationCount,
    }));
  }
}
