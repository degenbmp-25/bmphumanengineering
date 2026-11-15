/**
 * Ephemeral storage — no filesystem, no `node:` built-ins beyond crypto.
 *
 * This module is deliberately free of `node:fs` so it can be imported by a
 * serverless runtime without dragging the filesystem along. The file-backed
 * store lives in store.ts and is only used by the self-hosted server, which
 * has a writable disk.
 *
 * The split exists so a serverless deployment can mount a store that tells the
 * truth about itself: `capabilities.retainsLeads` is false, and the request
 * tool checks it before promising a user that someone will be in touch.
 */

import {
  assertNoRestrictedData,
  redactNote,
  isConsentValid,
  type AnalyticsRecord,
  type ConsentRecord,
  type LeadRecord,
} from "./lib/privacy.js";

/**
 * UUID without `node:crypto`, so this module stays importable on any runtime
 * (Node, edge, workerd). `globalThis.crypto.randomUUID` is available in Node
 * 19+ and in every edge runtime.
 */
function randomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for older runtimes.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * What this deployment can actually persist. Callers MUST consult this before
 * promising a user that something was stored.
 */
export interface StorageCapabilities {
  /** True when written records survive a restart or a cold start. */
  durable: boolean;
  /** True when a coaching lead is retained server-side. */
  retainsLeads: boolean;
  /** Human-readable description of where records live. */
  recordStore: string;
}

/**
 * The storage contract the MCP server depends on. Both implementations satisfy
 * it, so tool logic never needs to know which one it is talking to.
 */
export interface StoreLike {
  readonly capabilities: StorageCapabilities;
  init(): Promise<void>;
  saveConsent(userId: string, consent: ConsentRecord): Promise<void>;
  hasValidConsent(userId: string): boolean;
  saveAnalytics(record: AnalyticsRecord): Promise<void>;
  saveLead(
    lead: Omit<LeadRecord, "id" | "createdAt" | "status"> & { note?: string }
  ): Promise<LeadRecord>;
  getTrend(userId: string, limit?: number): AnalyticsRecord[];
  countLeads(): number;
}

/**
 * Ephemeral store for serverless hosts, where the filesystem does not persist
 * between invocations.
 *
 * It behaves exactly like the file store within a single invocation, and its
 * `capabilities` say plainly that nothing survives. Callers that would
 * otherwise promise a user "we stored your request" must check
 * `capabilities.retainsLeads` and offer a handoff instead.
 */
export class MemoryStore implements StoreLike {
  readonly capabilities: StorageCapabilities = {
    durable: false,
    retainsLeads: false,
    recordStore: "this session only — nothing is written to disk",
  };

  private analytics: AnalyticsRecord[] = [];
  private leads: LeadRecord[] = [];
  private consents = new Map<string, ConsentRecord>();

  async init(): Promise<void> {
    /* nothing to load */
  }

  async saveConsent(userId: string, consent: ConsentRecord): Promise<void> {
    assertNoRestrictedData(consent);
    this.consents.set(userId, consent);
  }

  hasValidConsent(userId: string): boolean {
    return isConsentValid(this.consents.get(userId));
  }

  async saveAnalytics(record: AnalyticsRecord): Promise<void> {
    assertNoRestrictedData(record);
    this.analytics.push(record);
  }

  async saveLead(
    lead: Omit<LeadRecord, "id" | "createdAt" | "status"> & { note?: string }
  ): Promise<LeadRecord> {
    assertNoRestrictedData({ email: lead.email, name: lead.name, goal: lead.goal });
    const record: LeadRecord = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      email: lead.email,
      name: lead.name,
      goal: lead.goal,
      note: lead.note ? redactNote(lead.note) : undefined,
      status: "new",
    };
    this.leads.push(record);
    return record;
  }

  getTrend(userId: string, limit = 5): AnalyticsRecord[] {
    return this.analytics
      .filter((r) => r.userId === userId)
      .slice(-limit)
      .reverse();
  }

  countLeads(): number {
    return this.leads.length;
  }
}
