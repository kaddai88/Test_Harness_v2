import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type CutoverTrafficState =
  | "normal"
  | "freeze-entry"
  | "frozen"
  | "read-only"
  | "mutation-enabled";

export type CutoverControlAction =
  | "freeze-entry"
  | "confirm-frozen"
  | "release-read-only"
  | "enable-mutation"
  | "abort-restore-normal";

export type CutoverControlOperation = "queue-pause" | "queue-resume";

export interface CutoverControlStatus {
  readonly state: CutoverTrafficState;
  readonly newSessionAdmission: "enabled" | "blocked";
  readonly mutationCapableTraffic: "enabled" | "blocked";
  readonly readOnlyTraffic: "enabled";
  readonly changedAt: string;
  readonly transitionCount: number;
}

export interface CutoverControlPlaneOptions {
  readonly token?: string;
  readonly auditPath?: string;
  readonly now?: () => Date;
}

interface AuditRecord extends CutoverControlStatus {
  readonly format: "p6-cutover-control-audit-v1";
  readonly action?: CutoverControlAction;
  readonly operation?: CutoverControlOperation;
  readonly actor: string;
  readonly phase?: "requested" | "applied";
  readonly details?: unknown;
}

const allowedTransitions: Readonly<Record<CutoverTrafficState, readonly CutoverControlAction[]>> = {
  normal: ["freeze-entry"],
  "freeze-entry": ["confirm-frozen", "abort-restore-normal"],
  frozen: ["release-read-only", "enable-mutation", "abort-restore-normal"],
  "read-only": ["enable-mutation", "abort-restore-normal"],
  "mutation-enabled": ["abort-restore-normal"],
};

function nextState(action: CutoverControlAction): CutoverTrafficState {
  switch (action) {
    case "freeze-entry": return "freeze-entry";
    case "confirm-frozen": return "frozen";
    case "release-read-only": return "read-only";
    case "enable-mutation": return "mutation-enabled";
    case "abort-restore-normal": return "normal";
  }
}

function controlsFor(state: CutoverTrafficState): Pick<CutoverControlStatus,
  "newSessionAdmission" | "mutationCapableTraffic" | "readOnlyTraffic"> {
  const enabled = state === "normal" || state === "mutation-enabled";
  return {
    newSessionAdmission: enabled ? "enabled" : "blocked",
    mutationCapableTraffic: enabled ? "enabled" : "blocked",
    readOnlyTraffic: "enabled",
  };
}

function requiredExistingParent(auditPath: string): void {
  const parent = path.dirname(auditPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error(`Cutover audit parent does not exist: ${parent}`);
  }
}

/**
 * Single-process traffic guard. It provides no authorization semantics: callers
 * must invoke it only after the separately recorded stop-point decision.
 */
export class CutoverControlPlane {
  private state: CutoverTrafficState = "normal";
  private changedAt: string;
  private transitionCount = 0;
  private auditCreated = false;
  private readonly token: string | null;
  private readonly auditPath: string | null;
  private readonly now: () => Date;

  constructor(options: CutoverControlPlaneOptions = {}) {
    this.token = options.token?.trim() || null;
    this.auditPath = options.auditPath ? path.resolve(options.auditPath) : null;
    this.now = options.now ?? (() => new Date());
    this.changedAt = this.now().toISOString();
  }

  status(): CutoverControlStatus {
    return {
      state: this.state,
      ...controlsFor(this.state),
      changedAt: this.changedAt,
      transitionCount: this.transitionCount,
    };
  }

  permitsMutationRequest(method: string | undefined): boolean {
    return method === "GET" || method === "HEAD" || method === "OPTIONS"
      || this.status().mutationCapableTraffic === "enabled";
  }

  transition(action: CutoverControlAction, token: string | undefined, actor: string | undefined): CutoverControlStatus {
    const normalizedActor = this.authorize(token, actor);
    if (!allowedTransitions[this.state].includes(action)) {
      throw new Error(`Invalid cutover control transition: ${this.state} -> ${action}`);
    }
    const target = nextState(action);
    const changedAt = this.now().toISOString();
    const next: CutoverControlStatus = {
      state: target,
      ...controlsFor(target),
      changedAt,
      transitionCount: this.transitionCount + 1,
    };
    this.appendAudit({ format: "p6-cutover-control-audit-v1", action, actor: normalizedActor, ...next });
    this.state = target;
    this.changedAt = changedAt;
    this.transitionCount += 1;
    return this.status();
  }

  async performOperation<T>(
    operation: CutoverControlOperation,
    token: string | undefined,
    actor: string | undefined,
    work: () => Promise<T>,
    details: (result: T) => unknown,
  ): Promise<T> {
    const normalizedActor = this.authorize(token, actor);
    this.appendAudit({ format: "p6-cutover-control-audit-v1", operation, actor: normalizedActor,
      phase: "requested", ...this.status() });
    const result = await work();
    this.appendAudit({ format: "p6-cutover-control-audit-v1", operation, actor: normalizedActor,
      phase: "applied", details: details(result), ...this.status() });
    return result;
  }

  private authorize(token: string | undefined, actor: string | undefined): string {
    this.assertConfiguredToken(token);
    const normalizedActor = actor?.trim();
    if (!normalizedActor) throw new Error("Cutover control actor is required");
    return normalizedActor;
  }

  private assertConfiguredToken(candidate: string | undefined): void {
    if (!this.token || !this.auditPath) throw new Error("Cutover controls are not configured");
    const actual = Buffer.from(candidate ?? "");
    const expected = Buffer.from(this.token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error("Invalid cutover control token");
    }
  }

  private appendAudit(record: AuditRecord): void {
    const auditPath = this.auditPath;
    if (!auditPath) throw new Error("Cutover controls are not configured");
    requiredExistingParent(auditPath);
    const line = `${JSON.stringify(record)}\n`;
    if (!this.auditCreated) {
      fs.writeFileSync(auditPath, line, { encoding: "utf8", flag: "wx" });
      this.auditCreated = true;
      return;
    }
    fs.appendFileSync(auditPath, line, { encoding: "utf8", flag: "a" });
  }
}

export function cutoverControlTokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
