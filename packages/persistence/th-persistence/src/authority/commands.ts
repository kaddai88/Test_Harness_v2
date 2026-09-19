export type AuthorityCommandDomain = 'cognition' | 'site-profile';

export interface ExplicitCommandActor {
  readonly actorId: string;
  readonly reason: string;
}

export interface LegacyImportCommand {
  readonly command: 'legacy-import';
  readonly domain: AuthorityCommandDomain;
  readonly mode: 'insert-only';
  readonly sourceReference: string;
  readonly scopeReference: string;
  readonly scopeProofReference: string;
  readonly actor: ExplicitCommandActor;
  readonly allowExistingAuthorityUpdate: false;
}

export interface AuthorityExportCommand {
  readonly command: 'authority-export';
  readonly domain: AuthorityCommandDomain;
  readonly destinationReference: string;
  readonly actor: ExplicitCommandActor;
}

export type ExplicitAuthorityCommand = LegacyImportCommand | AuthorityExportCommand;

/** Privileged composition ports; a string proof/actor reference alone grants no permission. */
export interface AuthorityCommandPolicy {
  authorize(command: ExplicitAuthorityCommand): Promise<boolean>;
  verifyScope(command: LegacyImportCommand): Promise<boolean>;
  audit(command: ExplicitAuthorityCommand): Promise<void>;
}

/** Preparation only. No importer, file access, or execution callback exists in 2-B. */
export class ExplicitAuthorityCommandBoundary {
  #policy: AuthorityCommandPolicy;
  constructor(policy: AuthorityCommandPolicy) { this.#policy = policy; }
  async prepare(input: unknown): Promise<ExplicitAuthorityCommand> {
    const command = validateExplicitAuthorityCommand(structuredClone(input));
    if (!await this.#policy.authorize(structuredClone(command))) throw new Error('Authority command is not authorized');
    if (command.command === 'legacy-import' && !await this.#policy.verifyScope(structuredClone(command))) {
      throw new Error('Unproven import scope');
    }
    await this.#policy.audit(structuredClone(command));
    return command;
  }
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value.trim();
}

export function validateExplicitAuthorityCommand(input: unknown): ExplicitAuthorityCommand {
  if (!input || typeof input !== 'object') throw new TypeError('Authority command must be an object');
  const command = input as Record<string, unknown>;
  if (command.command === 'legacy-import') {
    if (command.mode !== 'insert-only' || command.allowExistingAuthorityUpdate !== false) {
      throw new TypeError('Legacy import command must be explicit insert-only and must not update authority');
    }
    if (command.domain !== 'cognition' && command.domain !== 'site-profile') throw new TypeError('Unsupported authority command domain');
    const actor = command.actor as Record<string, unknown> | undefined;
    return {
      command: 'legacy-import',
      domain: command.domain,
      mode: 'insert-only',
      sourceReference: required(command.sourceReference, 'sourceReference'),
      scopeReference: required(command.scopeReference, 'scopeReference'),
      scopeProofReference: required(command.scopeProofReference, 'scopeProofReference'),
      actor: {
        actorId: required(actor?.actorId, 'actorId'),
        reason: required(actor?.reason, 'reason'),
      },
      allowExistingAuthorityUpdate: false,
    };
  }
  if (command.command === 'authority-export') {
    if (command.domain !== 'cognition' && command.domain !== 'site-profile') throw new TypeError('Unsupported authority command domain');
    const actor = command.actor as Record<string, unknown> | undefined;
    return {
      command: 'authority-export',
      domain: command.domain,
      destinationReference: required(command.destinationReference, 'destinationReference'),
      actor: {
        actorId: required(actor?.actorId, 'actorId'),
        reason: required(actor?.reason, 'reason'),
      },
    };
  }
  throw new TypeError('Unsupported authority command');
}
