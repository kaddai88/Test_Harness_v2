/**
 * Semantic Memory — long-term general knowledge about sites and testing.
 * 
 * Stores abstract, generalized knowledge:
 * - Site characteristics (login patterns, form structures)
 * - Testing patterns (what works for e-commerce sites)
 * - Bug patterns (common issues with certain frameworks)
 * - Best practices learned from experience
 * 
 * Analogous to human semantic memory: "I know that..."
 * Distilled from episodic memories through learning.
 */

export type KnowledgeType = 
  | 'site_characteristic'  // Facts about a specific site
  | 'testing_pattern'      // Effective testing approaches
  | 'bug_pattern'         // Common bug types and where to find them
  | 'recovery_strategy'   // How to recover from specific errors
  | 'best_practice';      // General testing best practices

export interface SemanticKnowledge {
  id: string;
  type: KnowledgeType;
  timestamp: number;
  
  // What we know
  title: string;
  description: string;
  
  // Scope: specific site or general
  targetUrl?: string; // If set, applies to specific site
  siteCategory?: string; // e.g., "e-commerce", "cms", "search-engine"
  
  // Content
  content: Record<string, unknown>;
  
  // Provenance
  sourceEpisodes: string[]; // Episode IDs this was distilled from
  confidence: number; // 0-1, how reliable this knowledge is
  verificationCount: number; // How many times this has been confirmed
  
  // Usage tracking
  useCount: number;
  lastUsed: number;
  
  // Expiration
  expiresAt?: number; // If set, knowledge may be outdated after this
  
  // Metadata
  tags: string[];
}

export class SemanticMemory {
  private knowledge: Map<string, SemanticKnowledge> = new Map();
  private storagePath: string;
  
  constructor(storagePath: string = '.cognition/semantic.json', private readonly persistent: boolean = true) {
    this.storagePath = storagePath;
    if (this.persistent) this.load();
  }
  
  /**
   * Store new knowledge.
   */
  store(knowledge: Omit<SemanticKnowledge, 'id' | 'useCount' | 'lastUsed'>): string {
    const id = this.generateId();
    const full: SemanticKnowledge = {
      ...knowledge,
      id,
      useCount: 0,
      lastUsed: Date.now(),
    };
    
    this.knowledge.set(id, full);
    this.save();
    
    return id;
  }
  
  /**
   * Retrieve specific knowledge by ID.
   */
  get(id: string): SemanticKnowledge | undefined {
    const item = this.knowledge.get(id);
    if (item) {
      item.useCount++;
      item.lastUsed = Date.now();
    }
    return item;
  }
  
  /**
   * Search for knowledge matching criteria.
   */
  search(criteria: {
    type?: KnowledgeType;
    targetUrl?: string;
    siteCategory?: string;
    minConfidence?: number;
    limit?: number;
  }): SemanticKnowledge[] {
    let results = Array.from(this.knowledge.values());
    
    // Filter by type
    if (criteria.type) {
      results = results.filter(k => k.type === criteria.type);
    }
    
    // Filter by URL
    if (criteria.targetUrl) {
      results = results.filter(k => 
        !k.targetUrl || k.targetUrl === criteria.targetUrl
      );
    }
    
    // Filter by category
    if (criteria.siteCategory) {
      results = results.filter(k => 
        !k.siteCategory || k.siteCategory === criteria.siteCategory
      );
    }
    
    // Filter by confidence
    if (criteria.minConfidence !== undefined) {
      results = results.filter(k => k.confidence >= criteria.minConfidence!);
    }
    
    // Filter out expired
    const now = Date.now();
    results = results.filter(k => !k.expiresAt || k.expiresAt > now);
    
    // Sort by relevance (confidence + usage)
    results.sort((a, b) => {
      const scoreA = a.confidence * 0.6 + Math.min(a.useCount / 10, 1) * 0.4;
      const scoreB = b.confidence * 0.6 + Math.min(b.useCount / 10, 1) * 0.4;
      return scoreB - scoreA;
    });
    
    // Limit
    if (criteria.limit) {
      results = results.slice(0, criteria.limit);
    }
    
    return results;
  }
  
  /**
   * Get knowledge about a specific site.
   */
  getSiteKnowledge(targetUrl: string, limit: number = 20): SemanticKnowledge[] {
    return this.search({ targetUrl, limit });
  }
  
  /**
   * Get general testing patterns.
   */
  getTestingPatterns(limit: number = 20): SemanticKnowledge[] {
    return this.search({ type: 'testing_pattern', limit });
  }
  
  /**
   * Get bug patterns.
   */
  getBugPatterns(targetUrl?: string, limit: number = 20): SemanticKnowledge[] {
    return this.search({ type: 'bug_pattern', targetUrl, limit });
  }
  
  /**
   * Get recovery strategies.
   */
  getRecoveryStrategies(errorType?: string, limit: number = 10): SemanticKnowledge[] {
    let results = this.search({ type: 'recovery_strategy', limit });
    
    if (errorType) {
      results = results.filter(k => 
        (k.content.errorType as string) === errorType ||
        (k.content.keywords as string[])?.some(kw => errorType.includes(kw))
      );
    }
    
    return results;
  }
  
  /**
   * Update existing knowledge.
   */
  update(id: string, updates: Partial<SemanticKnowledge>): boolean {
    const item = this.knowledge.get(id);
    if (!item) return false;
    
    Object.assign(item, updates);
    this.save();
    return true;
  }
  
  /**
   * Reinforce knowledge (increase confidence).
   */
  reinforce(id: string, amount: number = 0.1): boolean {
    const item = this.knowledge.get(id);
    if (!item) return false;
    
    item.confidence = Math.min(1, item.confidence + amount);
    item.verificationCount++;
    item.useCount++;
    item.lastUsed = Date.now();
    this.save();
    return true;
  }
  
  /**
   * Weaken knowledge (decrease confidence).
   */
  weaken(id: string, amount: number = 0.1): boolean {
    const item = this.knowledge.get(id);
    if (!item) return false;
    
    item.confidence = Math.max(0, item.confidence - amount);
    this.save();
    return true;
  }
  
  /**
   * Delete knowledge.
   */
  delete(id: string): boolean {
    const deleted = this.knowledge.delete(id);
    if (deleted) this.save();
    return deleted;
  }
  
  /**
   * Get total knowledge count.
   */
  count(): number {
    return this.knowledge.size;
  }
  
  /**
   * Clear all knowledge.
   */
  clear(): void {
    this.knowledge.clear();
    this.save();
  }
  
  /**
   * Export all knowledge.
   */
  export(): SemanticKnowledge[] {
    return Array.from(this.knowledge.values());
  }
  
  /**
   * Import knowledge.
   */
  import(items: SemanticKnowledge[]): void {
    for (const item of items) {
      this.knowledge.set(item.id, item);
    }
    this.save();
  }
  
  private generateId(): string {
    return `sk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const items: SemanticKnowledge[] = JSON.parse(data);
        for (const item of items) {
          this.knowledge.set(item.id, item);
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
      const data = Array.from(this.knowledge.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
