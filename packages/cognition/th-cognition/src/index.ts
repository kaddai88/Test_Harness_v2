/**
 * @test-harness/th-cognition
 *
 * DSH-style cognitive capabilities for AI-driven testing.
 * 
 * This package implements the core principles of Dynamic Self-Healing (DSH):
 * - Memory: Remember past experiences and knowledge
 * - Learning: Improve strategies based on outcomes
 * - Self-Healing: Automatically recover from failures
 * - Context Awareness: Understand current situation with historical perspective
 */

// ─── Memory System ───
export { WorkingMemory } from "./memory/working-memory.js";
export { EpisodicMemory, type Episode, type EpisodeType } from "./memory/episodic-memory.js";
export { SemanticMemory, type SemanticKnowledge, type KnowledgeType } from "./memory/semantic-memory.js";
export { ProceduralMemory, type Procedure, type ProcedureType } from "./memory/procedural-memory.js";

// ─── Learning System ───
export { ReinforcementLearner, type RewardSignal } from "./learning/reinforcement-learner.js";
export { PatternRecognizer, type Pattern, type PatternType } from "./learning/pattern-recognizer.js";
export { KnowledgeDistiller, type DistilledKnowledge } from "./learning/knowledge-distiller.js";

// ─── Self-Healing System ───
export { ErrorRecovery, type RecoveryStrategy, type ErrorType } from "./healing/error-recovery.js";
export { StrategyAdapter, type StrategyAdjustment } from "./healing/strategy-adapter.js";
export { KnowledgeUpdater, type UpdateAction } from "./healing/knowledge-updater.js";

// ─── Context System ───
export { ContextAwareness, type ContextState } from "./context/context-awareness.js";
export { ExperienceRetriever, type RetrievedExperience } from "./context/experience-retriever.js";

// ─── Cognitive Engine ───
export { CognitiveEngine, type CognitiveConfig } from "./cognitive-engine.js";

// Shared Cognition identity and provenance contracts
export {
  createCognitionEntityIdentity,
  createCognitionPatternIdentity,
  validateCognitionScope,
  validateCognitionIdentityInput,
  validateCognitionProvenance,
  readLegacyCognitionId,
} from "./identity.js";
export type {
  CognitionEntityKind,
  CognitionScope,
  CanonicalCognitionEntityIdentity,
  CognitionSourceOccurrenceIdentity,
  CognitionProvenance,
  CognitionPatternIdentityInput,
  CognitionIdentityInput,
  LegacyCognitionId,
} from "./identity.js";
export { mapLegacyCognitionRows } from "./legacy-mapping.js";
export type {
  LegacyCognitionEpisodeInput,
  LegacyCognitionKnowledgeInput,
  LegacyCognitionProcedureInput,
  LegacyCognitionPatternInput,
  LegacyCognitionInput,
  CognitionLegacyMapping,
  CognitionLegacyMappingReport,
} from "./legacy-mapping.js";
export type {
  CognitionLearnedEntityPort,
  CognitionSessionLookup,
  CognitionSessionRecord,
} from './authority-port.js';
