// Application-facing surface contains capabilities only; storage/composition is internal.
export type {
  CognitionAuthorityCreateInput, CognitionAuthorityTarget, CognitionAuthorityRecord,
  CognitionAuthorityService, CognitionAuthorityUpdateInput, CognitionSiteSnapshot,
  ManualEpisodeInput, KnowledgeConfidenceAdjustment,
} from './cognition.js';
export type {
  SiteProfileAuthorityCreateInput, SiteProfileAuthorityRecord, SiteProfileAuthorityScope,
  SiteProfileAuthorityEnsureInput, SiteProfileAuthorityImportInput,
  SiteProfileAuthorityService, SiteProfileAuthorityUpdateInput,
} from './site-profile.js';
export type {
  MetadataFieldOwnerService, MetadataOwner, MetadataOwnerMutation,
  P2EMetadataFieldOwnerService,
} from './metadata.js';
export type {
  AuthorityCommandDomain, AuthorityExportCommand, ExplicitAuthorityCommand,
  ExplicitCommandActor, LegacyImportCommand,
} from './commands.js';
export type { AuthorityIdempotencyRequest } from './idempotency.js';
export type AuthorityServices = ReturnType<typeof import('./composition.js').createAuthorityServices>;
