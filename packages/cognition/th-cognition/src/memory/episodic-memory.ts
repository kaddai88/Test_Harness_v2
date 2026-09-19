/**
 * Episodic Memory — long-term memory of specific experiences/events.
 * 
 * Stores detailed records of past sessions, actions, and outcomes:
 * - What happened (actions, observations)
 * - When it happened (timestamp, session context)
 * - How it turned out (success, failure, findings)
 * 
 * Analogous to human episodic memory: "I remember when..."
 * Used for learning from past experiences and avoiding repeated mistakes.
 */

export type EpisodeType = 
  | 'session_summary'      // Overall session outcome
  | 'action_sequence'      // Series of actions and results
  | 'bug_found'           // Bug discovery with context
  | 'recovery_success'    // Successfully recovered from error
  | 'recovery_failure'    // Failed to recover
  | 'site_discovery'      // Learned something about a site
  | 'test_pattern';       // Effective testing pattern

export interface Episode {
  id: string;
  type: EpisodeType;
  timestamp: number;
  sessionId: string;
  targetUrl: string;
  
  // What happened
  description: string;
  actions: Array<{
    tool: string;
    input: Record<string, unknown>;
    success: boolean;
    duration?: number;
  }>;
  
  // Outcome
  outcome: 'success' | 'failure' | 'partial' | 'neutral';
  findings?: Array<{
    severity: string;
    title: string;
    description: string;
  }>;
  
  // Context
  pageUrl?: string;
  pageTitle?: string;
  pageSnapshot?: string; // Aria snapshot at time of episode
  
  // Metadata
  tags: string[];
  confidence: number; // 0-1, how reliable this memory is
  accessCount: number; // How often this memory has been recalled
  lastAccessed: number;
}

export class EpisodicMemory {
  private episodes: Map<string, Episode> = new Map();
  private storagePath: string;
  
  constructor(storagePath: string = '.cognition/episodes.json', private readonly persistent: boolean = true) {
    this.storagePath = storagePath;
    if (this.persistent) this.load();
  }
  
  /**
   * Store a new episode in memory.
   */
  store(episode: Omit<Episode, 'id' | 'accessCount' | 'lastAccessed'>): string {
    const id = this.generateId();
    const fullEpisode: Episode = {
      ...episode,
      id,
      accessCount: 0,
      lastAccessed: Date.now(),
    };
    
    this.episodes.set(id, fullEpisode);
    this.save();
    
    return id;
  }
  
  /**
   * Recall a specific episode by ID.
   */
  recall(episodeId: string): Episode | undefined {
    const episode = this.episodes.get(episodeId);
    if (episode) {
      episode.accessCount++;
      episode.lastAccessed = Date.now();
    }
    return episode;
  }
  
  /**
   * Search for episodes matching criteria.
   */
  search(criteria: {
    type?: EpisodeType;
    targetUrl?: string;
    tags?: string[];
    outcome?: Episode['outcome'];
    since?: number;
    limit?: number;
  }): Episode[] {
    let results = Array.from(this.episodes.values());
    
    // Filter by type
    if (criteria.type) {
      results = results.filter(e => e.type === criteria.type);
    }
    
    // Filter by URL
    if (criteria.targetUrl) {
      results = results.filter(e => e.targetUrl === criteria.targetUrl);
    }
    
    // Filter by tags (any match)
    if (criteria.tags && criteria.tags.length > 0) {
      results = results.filter(e => 
        criteria.tags!.some(tag => e.tags.includes(tag))
      );
    }
    
    // Filter by outcome
    if (criteria.outcome) {
      results = results.filter(e => e.outcome === criteria.outcome);
    }
    
    // Filter by time
    if (criteria.since) {
      results = results.filter(e => e.timestamp >= criteria.since!);
    }
    
    // Sort by relevance (access count + recency)
    results.sort((a, b) => {
      const recencyA = (Date.now() - a.lastAccessed) / 1000 / 60 / 60; // hours
      const recencyB = (Date.now() - b.lastAccessed) / 1000 / 60 / 60;
      const scoreA = a.accessCount * 0.7 + (1 / (recencyA + 1)) * 0.3;
      const scoreB = b.accessCount * 0.7 + (1 / (recencyB + 1)) * 0.3;
      return scoreB - scoreA;
    });
    
    // Limit results
    if (criteria.limit) {
      results = results.slice(0, criteria.limit);
    }
    
    // Update access stats
    for (const episode of results) {
      episode.accessCount++;
      episode.lastAccessed = Date.now();
    }
    return results;
  }
  
  /**
   * Get all episodes for a specific site.
   */
  getSiteEpisodes(targetUrl: string, limit: number = 50): Episode[] {
    return this.search({ targetUrl, limit });
  }
  
  /**
   * Get recent episodes across all sites.
   */
  getRecent(limit: number = 20): Episode[] {
    const results = Array.from(this.episodes.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    
    return results;
  }
  
  /**
   * Get episodes by type.
   */
  getByType(type: EpisodeType, limit: number = 50): Episode[] {
    return this.search({ type, limit });
  }
  
  /**
   * Update an existing episode.
   */
  update(episodeId: string, updates: Partial<Episode>): boolean {
    const episode = this.episodes.get(episodeId);
    if (!episode) return false;
    
    Object.assign(episode, updates);
    this.save();
    return true;
  }
  
  /**
   * Delete an episode.
   */
  delete(episodeId: string): boolean {
    const deleted = this.episodes.delete(episodeId);
    if (deleted) this.save();
    return deleted;
  }
  
  /**
   * Get total episode count.
   */
  count(): number {
    return this.episodes.size;
  }
  
  /**
   * Clear all episodes.
   */
  clear(): void {
    this.episodes.clear();
    this.save();
  }
  
  /**
   * Export all episodes for backup/analysis.
   */
  export(): Episode[] {
    return Array.from(this.episodes.values());
  }
  
  /**
   * Import episodes from backup.
   */
  import(episodes: Episode[]): void {
    for (const episode of episodes) {
      this.episodes.set(episode.id, episode);
    }
    this.save();
  }
  
  private generateId(): string {
    return `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  private load(): void {
    try {
      const fs = require('fs');
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const episodes: Episode[] = JSON.parse(data);
        for (const episode of episodes) {
          this.episodes.set(episode.id, episode);
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
      const data = Array.from(this.episodes.values());
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore save errors
    }
  }
}
