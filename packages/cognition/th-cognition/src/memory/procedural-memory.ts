/**
 * Procedural Memory — memory of how to do things (skills, strategies).
 * 
 * Stores learned procedures and action sequences:
 * - How to login to specific sites
 * - How to navigate complex forms
 * - How to recover from specific errors
 * - Effective testing sequences
 * 
 * Analogous to human procedural memory: "I know how to..."
 * These are learned skills that become automatic with practice.
 */

export type ProcedureType = 
  | 'login_sequence'      // How to login to a site
  | 'form_filling'        // How to fill complex forms
  | 'navigation_pattern'  // How to navigate to specific pages
  | 'recovery_procedure'  // How to recover from errors
  | 'testing_strategy'    // How to test specific features
  | 'workaround';         // Workaround for site-specific issues

export interface Procedure {
  id: string;
  type: ProcedureType;
  timestamp: number;
  
  // What this procedure does
  name: string;
  description: string;
  
  // Scope
  targetUrl?: string;
  siteCategory?: string;
  
  // The procedure itself: sequence of steps
  steps: Array<{
    action: string; // Tool name
    input: Record<string, unknown>;
    expectedOutcome?: string;
    alternative?: {
      action: string;
      input: Record<string, unknown>;
    };
  }>;
  
  // Effectiveness tracking
  successCount: number;
  failureCount: number;
  successRate: number;
  
  // When to use this
  preconditions: string[]; // Conditions that must be true
  triggers: string[]; // Situations that trigger this procedure
  
  // Metadata
  tags: string[];
  confidence: number;
  lastUsed: number;
  useCount: number;
}

export class ProceduralMemory {
  private procedures: Map<string, Procedure> = new Map();
  private storagePath: string;
  
  constructor(storagePath: string = '.cognition/procedures.json', private readonly persistent: boolean = true) {
    this.storagePath = storagePath;
    if (this.persistent) this.load();
  }
  
  /**
   * Store a new procedure.
   */
  store(procedure: Omit<Procedure, 'id' | 'successCount' | 'failureCount' | 'successRate' | 'useCount' | 'lastUsed'>): string {
    const id = this.generateId();
    const full: Procedure = {
      ...procedure,
      id,
      successCount: 0,
      failureCount: 0,
      successRate: 0.5, // Start with neutral expectation
      useCount: 0,
      lastUsed: 0,
    };
    
    this.procedures.set(id, full);
    this.save();
    
    return id;
  }
  
  /**
   * Get a specific procedure by ID.
   */
  get(id: string): Procedure | undefined {
    return this.procedures.get(id);
  }
  
  /**
   * Search for procedures matching criteria.
   */
  search(criteria: {
    type?: ProcedureType;
    targetUrl?: string;
    siteCategory?: string;
    tags?: string[];
    minSuccessRate?: number;
    limit?: number;
  }): Procedure[] {
    let results = Array.from(this.procedures.values());
    
    // Filter by type
    if (criteria.type) {
      results = results.filter(p => p.type === criteria.type);
    }
    
    // Filter by URL
    if (criteria.targetUrl) {
      results = results.filter(p => 
        !p.targetUrl || p.targetUrl === criteria.targetUrl
      );
    }
    
    // Filter by category
    if (criteria.siteCategory) {
      results = results.filter(p => 
        !p.siteCategory || p.siteCategory === criteria.siteCategory
      );
    }
    
    // Filter by tags
    if (criteria.tags && criteria.tags.length > 0) {
      results = results.filter(p => 
        criteria.tags!.some(tag => p.tags.includes(tag))
      );
    }
    
    // Filter by success rate
    if (criteria.minSuccessRate !== undefined) {
      results = results.filter(p => p.successRate >= criteria.minSuccessRate!);
    }
    
    // Sort by effectiveness (success rate + recency)
    results.sort((a, b) => {
      const recencyA = a.lastUsed ? (Date.now() - a.lastUsed) / 1000 / 60 / 60 : 999999;
      const recencyB = b.lastUsed ? (Date.now() - b.lastUsed) / 1000 / 60 / 60 : 999999;
      const scoreA = a.successRate * 0.7 + (1 / (recencyA + 1)) * 0.3;
      const scoreB = b.successRate * 0.7 + (1 / (recencyB + 1)) * 0.3;
      return scoreB - scoreA;
    });
    
    // Limit
    if (criteria.limit) {
      results = results.slice(0, criteria.limit);
    }
    
    return results;
  }
  
  /**
   * Get the best procedure for a specific situation.
   */
  getBest(type: ProcedureType, targetUrl?: string, tags?: string[]): Procedure | undefined {
    const results = this.search({ type, targetUrl, tags, limit: 1 });
    return results[0];
  }
  
  /**
   * Get login procedures for a site.
   */
  getLoginProcedures(targetUrl: string): Procedure[] {
    return this.search({ type: 'login_sequence', targetUrl });
  }
  
  /**
   * Get recovery procedures for an error type.
   */
  getRecoveryProcedures(errorType: string): Procedure[] {
    let results = this.search({ type: 'recovery_procedure' });
    
    // Filter by error type in triggers or tags
    results = results.filter(p => 
      p.triggers.some(t => t.toLowerCase().includes(errorType.toLowerCase())) ||
      p.tags.some(t => t.toLowerCase().includes(errorType.toLowerCase()))
    );
    
    return results;
  }
  
  /**
   * Record a successful use of a procedure.
   */
  recordSuccess(id: string): boolean {
    const proc = this.procedures.get(id);
    if (!proc) return false;
    
    proc.successCount++;
    proc.useCount++;
    proc.lastUsed = Date.now();
    proc.successRate = proc.successCount / (proc.successCount + proc.failureCount);
    this.save();
    return true;
  }
  
  /**
   * Record a failed use of a procedure.
   */
  recordFailure(id: string): boolean {
    const proc = this.procedures.get(id);
    if (!proc) return false;
    
    proc.failureCount++;
    proc.useCount++;
    proc.lastUsed = Date.now();
    proc.successRate = proc.successCount / (proc.successCount + proc.failureCount);
    this.save();
    return true;
  }
  
  /**
   * Update a procedure.
   */
  update(id: string, updates: Partial<Procedure>): boolean {
    const proc = this.procedures.get(id);
    if (!proc) return false;
    
    Object.assign(proc, updates);
    this.save();
    return true;
  }
  
  /**
   * Delete a procedure.
   */
  delete(id: string): boolean {
    const deleted = this.procedures.delete(id);
    if (deleted) this.save();
    return deleted;
  }
  
  /**
   * Get total procedure count.
   */
  count(): number {
    return this.procedures.size;
  }
  
  /**
   * Clear all procedures.
   */
  clear(): void {
    this.procedures.clear();
    this.save();
  }
  
  /**
   * Export all procedures.
   */
  export(): Procedure[] {
    return Array.from(this.procedures.values());
  }
  
  /**
   * Import procedures.
   */
  import(procedures: Procedure[]): void {
    for (const proc of procedures) {
      this.procedures.set(proc.id, proc);
    }
    this.save();
  }
  
  private generateId(): string {
    return `proc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const procedures: Procedure[] = JSON.parse(data);
        for (const proc of procedures) {
          this.procedures.set(proc.id, proc);
        }
      }
    } catch {
      // Ignore load errors
    }
  }
  
  private save(): void {
    if (!this.persistent) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Array.from(this.procedures.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
