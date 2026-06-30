import type { MemoryService, Memory } from '@memory-stack/core';
import { RelationType } from '@memory-stack/core';

export interface ProcessorConfig {
  // Relation Discovery
  relationDiscovery: {
    enabled: boolean;
    similarityThreshold: number; // 0-1, create relation if above
    maxRelationsPerMemory: number;
    runIntervalMinutes: number;
  };
  // Decay Processing
  decayProcessing: {
    enabled: boolean;
    runIntervalMinutes: number;
  };
  // Consolidation
  consolidation: {
    enabled: boolean;
    similarityThreshold: number; // Very high threshold for merging
    minMemoriesForConsolidation: number;
    runIntervalMinutes: number;
  };
}

export const DEFAULT_PROCESSOR_CONFIG: ProcessorConfig = {
  relationDiscovery: {
    enabled: true,
    // 0.6 surfaces genuinely-related (paraphrased) memories; 0.75 was empirically
    // too strict — real related facts top out around ~0.6 cosine, so the default
    // discovered nothing out-of-the-box. Distractors stay well below (~0.3).
    similarityThreshold: 0.6,
    maxRelationsPerMemory: 5,
    runIntervalMinutes: 60, // Every hour
  },
  decayProcessing: {
    enabled: true,
    runIntervalMinutes: 360, // Every 6 hours
  },
  consolidation: {
    enabled: false, // Disabled by default - destructive
    similarityThreshold: 0.95,
    minMemoriesForConsolidation: 3,
    runIntervalMinutes: 1440, // Daily
  },
};

export interface ProcessingStats {
  lastRun: Date | null;
  relationsCreated: number;
  memoriesDecayed: number;
  memoriesConsolidated: number;
  errors: string[];
}

export interface SchedulerConfig {
  mode: 'interval' | 'scheduled' | 'disabled';
  intervalMinutes: number;
  scheduledTime: string | null; // "HH:MM"
  onNewMemory: boolean;
}

const DEFAULT_SCHEDULER: SchedulerConfig = {
  mode: 'interval',
  intervalMinutes: 60,
  scheduledTime: null,
  onNewMemory: false,
};

export class MemoryProcessor {
  private memoryService: MemoryService;
  private config: ProcessorConfig;
  private stats: ProcessingStats;
  private intervals: NodeJS.Timeout[] = [];
  private running = false;
  private embeddingRunning = false;
  private scheduler: SchedulerConfig = { ...DEFAULT_SCHEDULER };
  private scheduledTimer: NodeJS.Timeout | null = null;

  constructor(memoryService: MemoryService, config: Partial<ProcessorConfig> = {}) {
    this.memoryService = memoryService;
    this.config = { ...DEFAULT_PROCESSOR_CONFIG, ...config };
    this.stats = {
      lastRun: null,
      relationsCreated: 0,
      memoriesDecayed: 0,
      memoriesConsolidated: 0,
      errors: [],
    };
  }

  getSchedule(): SchedulerConfig {
    return { ...this.scheduler };
  }

  setSchedule(config: Partial<SchedulerConfig>): SchedulerConfig {
    this.scheduler = { ...this.scheduler, ...config };

    // Restart timers with new config
    this.stop();
    if (this.scheduler.mode !== 'disabled') {
      this.start();
    }

    return this.getSchedule();
  }

  /**
   * Embed a specific set of memories (e.g. just-imported rows). Targeted, so it
   * is unaffected by the global rescan's salience window / 5000 cap — imported
   * memories on large stores still get embedded. Bounded concurrency.
   */
  async embedByIds(ids: ReadonlyArray<{ id: string; namespace: string }>): Promise<number> {
    const embedder = this.memoryService.getEmbeddingService();
    if (!embedder.isEnabled() || ids.length === 0) return 0;
    let done = 0;
    const CONC = 5;
    for (let i = 0; i < ids.length; i += CONC) {
      const batch = ids.slice(i, i + CONC);
      const results = await Promise.all(batch.map((id) => this.embedSingleMemory(id).catch(() => false)));
      done += results.filter(Boolean).length;
    }
    return done;
  }

  /**
   * Generate embedding for a single memory (used for on-new-memory mode)
   */
  async embedSingleMemory(memoryId: { id: string; namespace: string }): Promise<boolean> {
    const embedder = this.memoryService.getEmbeddingService();
    if (!embedder.isEnabled()) return false;

    try {
      await this.memoryService.connect();
      const memory = await this.memoryService.getMemory(memoryId);
      if (!memory) return false;

      const vector = await embedder.embed(memory.content);
      if (vector) {
        await this.memoryService.storeEmbedding(memoryId, vector);
        return true;
      }
    } catch (e) {
      console.error('[Processor] Single embed error:', e);
    }
    return false;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    console.log('[Processor] Starting memory processor...');

    // Relation Discovery
    if (this.config.relationDiscovery.enabled) {
      const interval = setInterval(
        () => this.runRelationDiscovery(),
        this.config.relationDiscovery.runIntervalMinutes * 60 * 1000
      );
      this.intervals.push(interval);
      console.log(`[Processor] Relation discovery: every ${this.config.relationDiscovery.runIntervalMinutes} min`);
    }

    // Decay Processing
    if (this.config.decayProcessing.enabled) {
      const interval = setInterval(
        () => this.runDecayProcessing(),
        this.config.decayProcessing.runIntervalMinutes * 60 * 1000
      );
      this.intervals.push(interval);
      console.log(`[Processor] Decay processing: every ${this.config.decayProcessing.runIntervalMinutes} min`);
    }

    // Consolidation
    if (this.config.consolidation.enabled) {
      const interval = setInterval(
        () => this.runConsolidation(),
        this.config.consolidation.runIntervalMinutes * 60 * 1000
      );
      this.intervals.push(interval);
      console.log(`[Processor] Consolidation: every ${this.config.consolidation.runIntervalMinutes} min`);
    }

    // Scheduled time mode
    if (this.scheduler.scheduledTime) {
      this.scheduleAtTime(this.scheduler.scheduledTime);
    }

    // Run initial processing after startup
    setTimeout(() => this.runAll(), 5000);
  }

  private scheduleAtTime(timeStr: string): void {
    const parts = timeStr.split(':').map(Number);
    const hours = parts[0] ?? 0;
    const mins = parts[1] ?? 0;
    const now = new Date();
    const next = new Date();
    next.setHours(hours, mins, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);

    const delay = next.getTime() - now.getTime();
    console.log(`[Processor] Scheduled run at ${timeStr} (in ${Math.round(delay / 60000)} min)`);

    this.scheduledTimer = setTimeout(() => {
      this.runAll();
      // Reschedule for next day
      this.scheduleAtTime(timeStr);
    }, delay);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals = [];

    if (this.scheduledTimer) {
      clearTimeout(this.scheduledTimer);
      this.scheduledTimer = null;
    }

    console.log('[Processor] Stopped memory processor');
  }

  async runAll(): Promise<void> {
    console.log('[Processor] Running all processing tasks...');

    if (this.config.relationDiscovery.enabled) {
      await this.runRelationDiscovery();
    }

    if (this.config.decayProcessing.enabled) {
      await this.runDecayProcessing();
    }

    if (this.config.consolidation.enabled) {
      await this.runConsolidation();
    }

    this.stats.lastRun = new Date();

    // Notify webhook subscribers that a processing run finished (fire-and-forget).
    try {
      const { getWebhookService } = await import('./webhooks.js');
      void getWebhookService()?.emit('processor.completed', this.getStats());
    } catch {
      // webhooks unavailable — ignore
    }
  }

  /**
   * Generate embeddings for memories that don't have them yet.
   * Uses OpenAI text-embedding-3-small (1536 dimensions).
   */
  async runEmbeddingGeneration(): Promise<number> {
    const embedder = this.memoryService.getEmbeddingService();
    if (!embedder.isEnabled()) {
      console.log('[Processor] Skipping embedding generation: no OPENAI_API_KEY');
      return 0;
    }

    // Concurrency guard: this scans the store in batches; overlapping runs (e.g.
    // several imports firing it at once) would pile up and saturate the process.
    if (this.embeddingRunning) {
      return 0;
    }
    this.embeddingRunning = true;

    console.log('[Processor] Running embedding generation...');
    let generated = 0;

    try {
      await this.memoryService.connect();
      const memories = await this.memoryService.searchMemories({ limit: 5000 });

      // Process in batches of 20
      const batchSize = 20;
      for (let i = 0; i < memories.length; i += batchSize) {
        const batch = memories.slice(i, i + batchSize);
        const textsToEmbed: { memory: Memory; text: string }[] = [];

        for (const memory of batch) {
          // Check if already has embedding in Qdrant
          const alreadyEmbedded = await this.memoryService.hasEmbedding(memory.id);
          if (alreadyEmbedded) continue;
          textsToEmbed.push({ memory, text: memory.content });
        }

        if (textsToEmbed.length === 0) continue;

        // Embed the batch via the shared EmbeddingService (same model/dims used
        // for query embedding), then persist vectors to Qdrant.
        const vectors = await embedder.embedBatch(textsToEmbed.map((t) => t.text));
        if (vectors.every((v) => v === null)) {
          console.error('[Processor] Embedding batch failed; aborting run');
          break;
        }

        for (let j = 0; j < textsToEmbed.length; j++) {
          const vector = vectors[j];
          const entry = textsToEmbed[j];
          if (!vector || !entry) continue;
          await this.memoryService.storeEmbedding(entry.memory.id, vector);
          generated++;
        }

        console.log(`[Processor] Generated embeddings (batch ${Math.floor(i / batchSize) + 1})`);

        // Rate limit: 500ms between batches
        if (i + batchSize < memories.length) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      console.log(`[Processor] Embedding generation complete: ${generated} new embeddings`);
    } catch (error) {
      const msg = `Embedding generation error: ${error}`;
      console.error('[Processor]', msg);
      this.stats.errors.push(msg);
    } finally {
      this.embeddingRunning = false;
    }

    return generated;
  }

  async runRelationDiscovery(opts: { namespace?: string; limit?: number } = {}): Promise<number> {
    console.log(`[Processor] Running relation discovery${opts.namespace ? ` (namespace=${opts.namespace})` : ''}...`);
    let created = 0;

    try {
      await this.memoryService.connect();

      // Generate embeddings first (required for similarity search)
      await this.runEmbeddingGeneration();

      // Scope to a namespace and cap the working set so the run stays bounded
      // (avoids request timeouts on large stores) and never links across namespaces.
      const memories = await this.memoryService.searchMemories({
        ...(opts.namespace ? { namespace: opts.namespace } : {}),
        limit: opts.limit ?? 200,
      });

      for (const memory of memories) {
        // Skip if already has max relations
        const existingRelations = await this.memoryService.getRelations(memory.id);
        if (existingRelations.length >= this.config.relationDiscovery.maxRelationsPerMemory) {
          continue;
        }

        // Find similar memories (requires embeddings in Qdrant)
        let similar;
        try {
          similar = await this.memoryService.findSimilar(
            memory.id,
            this.config.relationDiscovery.maxRelationsPerMemory + 1,
            memory.id.namespace
          );
        } catch (e) {
          // Skip if memory has no embedding (Bad Request from Qdrant)
          continue;
        }

        for (const result of similar) {
          // Skip self
          if (result.memory.id.id === memory.id.id &&
              result.memory.id.namespace === memory.id.namespace) {
            continue;
          }

          // Never create cross-namespace edges (auto-discovery links within a namespace).
          if (result.memory.id.namespace !== memory.id.namespace) {
            continue;
          }

          // Check threshold
          if ((result.score ?? 0) < this.config.relationDiscovery.similarityThreshold) {
            continue;
          }

          // Check if relation already exists
          const hasRelation = existingRelations.some(
            r => (r.toMemory.id === result.memory.id.id && r.toMemory.namespace === result.memory.id.namespace) ||
                 (r.fromMemory.id === result.memory.id.id && r.fromMemory.namespace === result.memory.id.namespace)
          );

          if (hasRelation) continue;

          // Create relation
          try {
            await this.memoryService.createRelation(
              memory.id,
              result.memory.id,
              RelationType.RELATED_TO,
              result.score ?? 0.8,
              true, // bidirectional
              { autoDiscovered: true, discoveredAt: new Date().toISOString() }
            );
            created++;
            this.stats.relationsCreated++;
          } catch (e) {
            // Relation might already exist
          }
        }
      }

      console.log(`[Processor] Relation discovery complete: ${created} relations created`);
    } catch (error) {
      const msg = `Relation discovery error: ${error}`;
      console.error('[Processor]', msg);
      this.stats.errors.push(msg);
    }

    return created;
  }

  async runDecayProcessing(): Promise<number> {
    console.log('[Processor] Running decay processing...');
    let processed = 0;

    try {
      await this.memoryService.connect();

      const now = new Date();

      // Page through ALL memories instead of only the top-1000 by salience, so the
      // long tail also decays. The 1-hour guard makes re-encountering a row (whose
      // salience shifted its page position mid-pass) a no-op, so paging is safe.
      const PAGE = 1000;
      for (let offset = 0; ; offset += PAGE) {
        const memories = await this.memoryService.searchMemories({ limit: PAGE, offset });
        if (memories.length === 0) break;

        for (const memory of memories) {
          // Calculate time since last decay calculation
          const lastDecay = new Date(memory.metadata.lastDecayCalculation);
          const hoursSinceDecay = (now.getTime() - lastDecay.getTime()) / (1000 * 60 * 60);

          if (hoursSinceDecay < 1) continue; // Skip if less than an hour

          // Calculate new effective salience
          // decay = salience * e^(-decayRate * hours)
          const decayFactor = Math.exp(-memory.metadata.decayRate * hoursSinceDecay / 720); // 720 = 30 days in hours
          const newEffectiveSalience = memory.metadata.salience * decayFactor;

          // Update if changed significantly. Persist the decayed value WITHOUT
          // resetting the base salience (effectiveSalience + lastDecayCalculation only).
          if (Math.abs(newEffectiveSalience - memory.metadata.effectiveSalience) > 0.01) {
            await this.memoryService.updateMemory(memory.id, {
              effectiveSalience: newEffectiveSalience,
              lastDecayCalculation: now,
            });
            processed++;
            this.stats.memoriesDecayed++;
          }
        }

        if (memories.length < PAGE) break;
      }

      console.log(`[Processor] Decay processing complete: ${processed} memories processed`);
    } catch (error) {
      const msg = `Decay processing error: ${error}`;
      console.error('[Processor]', msg);
      this.stats.errors.push(msg);
    }

    return processed;
  }

  async runConsolidation(): Promise<number> {
    console.log('[Processor] Running consolidation...');
    let consolidated = 0;

    try {
      await this.memoryService.connect();

      // Get memories grouped by namespace
      const memories = await this.memoryService.searchMemories({ limit: 500 });

      // Group by namespace
      const byNamespace = new Map<string, typeof memories>();
      for (const memory of memories) {
        const ns = memory.id.namespace;
        if (!byNamespace.has(ns)) {
          byNamespace.set(ns, []);
        }
        byNamespace.get(ns)!.push(memory);
      }

      // Find highly similar clusters within each namespace
      for (const [namespace, nsMemories] of byNamespace) {
        if (nsMemories.length < this.config.consolidation.minMemoriesForConsolidation) {
          continue;
        }

        // Simple clustering: find memories with very high similarity
        const processed = new Set<string>();

        for (const memory of nsMemories) {
          if (processed.has(memory.id.id)) continue;

          const similar = await this.memoryService.findSimilar(memory.id, 10, namespace);
          const cluster = similar.filter(
            s => (s.score ?? 0) >= this.config.consolidation.similarityThreshold &&
                 !processed.has(s.memory.id.id)
          );

          if (cluster.length >= this.config.consolidation.minMemoriesForConsolidation - 1) {
            // Real, NON-destructive consolidation: keep the highest-salience
            // memory as the canonical "primary", link each near-duplicate to it
            // with a SUPERSEDES relation, and demote the duplicate's salience so
            // it decays/ranks below the primary. We intentionally do NOT delete
            // duplicates — consolidation must never lose user data.
            const members = [memory, ...cluster.map((c) => c.memory)];
            const primary = members.reduce((best, m) =>
              m.metadata.effectiveSalience > best.metadata.effectiveSalience ? m : best
            );

            // Existing edges, fetched once, so re-runs are idempotent: without this
            // each scheduled run would add a duplicate SUPERSEDES edge AND halve the
            // duplicate's salience again, compounding toward zero.
            const primaryRels = await this.memoryService.getRelations(primary.id);

            for (const item of cluster) {
              const dup = item.memory;
              if (dup.id.id === primary.id.id) continue;

              const alreadyConsolidated = primaryRels.some(
                (r) =>
                  r.relationType === RelationType.SUPERSEDES &&
                  r.toMemory.id === dup.id.id &&
                  r.toMemory.namespace === dup.id.namespace
              );
              if (alreadyConsolidated) {
                processed.add(dup.id.id);
                continue;
              }

              try {
                await this.memoryService.createRelation(
                  primary.id,
                  dup.id,
                  RelationType.SUPERSEDES,
                  item.score ?? 1,
                  false,
                  { reason: 'consolidation', similarity: item.score ?? null }
                );
                // Demote the duplicate so the primary surfaces first. Only done once
                // (guarded above) so salience cannot be repeatedly halved.
                const demoted = Math.max(0, dup.metadata.salience * 0.5);
                await this.memoryService.updateMemory(dup.id, { salience: demoted });
                this.stats.memoriesConsolidated++;
              } catch (e) {
                console.error('[Processor] Consolidation merge error:', e);
              }
              processed.add(dup.id.id);
            }
            processed.add(memory.id.id);
            consolidated++;

            console.log(`[Processor] Consolidated cluster of ${members.length} → primary ${primary.id.id}`);
          }
        }
      }

      console.log(`[Processor] Consolidation complete: ${consolidated} clusters consolidated`);
    } catch (error) {
      const msg = `Consolidation error: ${error}`;
      console.error('[Processor]', msg);
      this.stats.errors.push(msg);
    }

    return consolidated;
  }

  getStats(): ProcessingStats & { config: ProcessorConfig } {
    return {
      ...this.stats,
      config: this.config,
    };
  }

  updateConfig(config: Partial<ProcessorConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      relationDiscovery: { ...this.config.relationDiscovery, ...config.relationDiscovery },
      decayProcessing: { ...this.config.decayProcessing, ...config.decayProcessing },
      consolidation: { ...this.config.consolidation, ...config.consolidation },
    };

    // Restart if running
    if (this.running) {
      this.stop();
      this.start();
    }
  }
}

// Singleton accessor for auto-embed from routes
let _processorInstance: MemoryProcessor | null = null;

export function setProcessorInstance(processor: MemoryProcessor): void {
  _processorInstance = processor;
}

export function getProcessor(): MemoryProcessor | null {
  return _processorInstance;
}
