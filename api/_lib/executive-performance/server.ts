/**
 * Executive Performance — ChatGPT plugin MCP server.
 *
 * A remote, public HTTPS MCP server exposing coaching tools to ChatGPT.
 *
 * Security posture:
 *   - No local file access beyond the plugin's own data dir.
 *   - The privacy layer rejects restricted data before anything is stored.
 *   - Assessment inputs are never persisted.
 *   - The server is stateless with respect to the request: it derives and returns.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { assess, DISCLAIMER, CLINICAL_ESCALATION, needsClinicalNote } from "./lib/pillars.js";
import { generateMicrocycle, generateFuelPlan } from "./lib/methodology.js";
import { resolveUserId } from "./lib/identity.js";
import { assertNoRestrictedData, CONSENT_PURPOSE, type ConsentRecord } from "./lib/privacy.js";
import type { StoreLike, StorageCapabilities } from "./store-memory.js";
import {
  ASSESSMENT_TOOL,
  MICROCYCLE_TOOL,
  FUEL_PLAN_TOOL,
  TREND_TOOL,
  INTEREST_TOOL,
  assessmentSchema,
} from "./tools.js";


type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
};

function textResult(text: string, structured?: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: "text", text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function buildServer(store: StoreLike, capabilities: StorageCapabilities): McpServer {
  const server = new McpServer(
    { name: "executive-performance", version: "1.0.0" },
    {
      instructions:
        "Executive Performance provides structured performance coaching across three pillars: " +
        "Bulletproof Body, Fuel with Freedom, and Recharge and Restore. Use it to assess a user's " +
        "current state, build a training week, build a nutrition structure, and track progress. " +
        "It is coaching, not medicine. When a user discloses an active medical condition or symptoms " +
        "that interfere with training, do not produce a program — say that a clinician should be " +
        "consulted first, and still offer general structure once they are cleared.",
    }
  );

  // ---------------------------------------------------------------- assessment
  server.registerTool(
    ASSESSMENT_TOOL.name,
    {
      title: ASSESSMENT_TOOL.title,
      description: ASSESSMENT_TOOL.description,
      inputSchema: ASSESSMENT_TOOL.inputSchema as unknown as z.ZodRawShape,
      outputSchema: {
        overall: z.number(),
        primaryLever: z.string(),
        pillars: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            score: z.number(),
            band: z.string(),
          })
        ),
        recommendations: z.array(
          z.object({
            pillar: z.string(),
            title: z.string(),
            detail: z.string(),
            action: z.string(),
            priority: z.number(),
          })
        ),
        disclaimer: z.string(),
      } as unknown as z.ZodRawShape,
      annotations: ASSESSMENT_TOOL.annotations,
      _meta: ASSESSMENT_TOOL._meta,
    },
    async (raw, extra) => {
      const input = assessmentSchema.parse(raw);
      assertNoRestrictedData(input);

      const clinical = needsClinicalNote({
        ...input,
        hasActiveDiagnosis: (raw as Record<string, unknown>).hasActiveDiagnosis === true,
        symptomsInterfereWithTraining:
          (raw as Record<string, unknown>).symptomsInterfereWithTraining === true,
      });

      const result = assess(input);

      const text = [
        `Performance profile — overall ${result.overall}/100`,
        "",
        ...result.pillars.map(
          (p) => `• ${p.label}: ${p.score}/100 (${p.band})`
        ),
        "",
        `Primary lever: ${result.primaryLever.label} (${result.primaryLever.score}/100)`,
        "",
        ...result.recommendations.map(
          (r, i) => `${i + 1}. [${r.pillar.toUpperCase()}] ${r.title}\n   ${r.detail}\n   Do this: ${r.action}`
        ),
        "",
        clinical ? CLINICAL_ESCALATION : "",
        result.disclaimer,
      ]
        .filter(Boolean)
        .join("\n");

      // Only derived values are stored, and only with consent.
      // Identity resolution fails closed: without a resolvable caller we store nothing.
      const identity = resolveUserId(extra);
      if (identity.ok && store.hasValidConsent(identity.userId)) {
        await store.saveAnalytics({
          userId: identity.userId,
          createdAt: new Date().toISOString(),
          goal: input.goal,
          overall: result.overall,
          pillars: result.pillars.map((p) => ({ key: p.key, score: p.score, band: p.band })),
          primaryLever: result.primaryLever.key,
        });
      }

      return textResult(text, {
        overall: result.overall,
        primaryLever: result.primaryLever.label,
        pillars: result.pillars.map((p) => ({
          key: p.key,
          label: p.label,
          score: p.score,
          band: p.band,
        })),
        recommendations: result.recommendations.map((r) => ({
          pillar: r.pillar,
          title: r.title,
          detail: r.detail,
          action: r.action,
          priority: r.priority,
        })),
        disclaimer: result.disclaimer,
      });
    }
  );

  // --------------------------------------------------------------- microcycle
  server.registerTool(
    MICROCYCLE_TOOL.name,
    {
      title: MICROCYCLE_TOOL.title,
      description: MICROCYCLE_TOOL.description,
      inputSchema: MICROCYCLE_TOOL.inputSchema as unknown as z.ZodRawShape,
      annotations: MICROCYCLE_TOOL.annotations,
      _meta: MICROCYCLE_TOOL._meta,
    },
    async (raw) => {
      const input = MICROCYCLE_TOOL.inputSchema.parse(raw);
      assertNoRestrictedData(input);

      // Build a synthetic assessment so the microcycle adapts to goal + volume.
      const synthetic = {
        trainingYears: (input.sessionsAre === "established" ? "5_plus" : "3_to_5") as
          | "under_1" | "1_to_3" | "3_to_5" | "5_plus",
        sessionsPerWeek: input.sessionsPerWeek,
        movementControl: input.sessionsAre === "established" ? 8 : input.sessionsAre === "rebuilding" ? 6 : 4,
        painFree: input.sessionsAre === "established" ? 8 : 6,
        nutritionConsistency: 5,
        proteinAdequacy: 5,
        mealTimingConsistency: 5,
        sleepHours: 7,
        stressLevel: 5,
        recoveryPractices: 5,
        goal: input.goal,
      };

      const plan = generateMicrocycle(synthetic, assess(synthetic));
      const text = [
        plan.weekLabel,
        "",
        ...plan.days.map(
          (d) =>
            `${d.day} — ${d.focus} (${d.sessionMinutes} min, ${d.intensity})\n` +
            d.blocks.map((b) => `   • ${b.name}: ${b.detail}${b.sets ? ` (${b.sets})` : ""}`).join("\n")
        ),
        "",
        "Track:",
        ...plan.tracking.map((t) => ` - ${t}`),
        "",
        "Adjustments:",
        ...plan.adjustmentRules.map((t) => ` - ${t}`),
        "",
        DISCLAIMER,
      ].join("\n");

      return textResult(text, plan as unknown as Record<string, unknown>);
    }
  );

  // ---------------------------------------------------------------- fuel plan
  server.registerTool(
    FUEL_PLAN_TOOL.name,
    {
      title: FUEL_PLAN_TOOL.title,
      description: FUEL_PLAN_TOOL.description,
      inputSchema: FUEL_PLAN_TOOL.inputSchema as unknown as z.ZodRawShape,
      annotations: FUEL_PLAN_TOOL.annotations,
      _meta: FUEL_PLAN_TOOL._meta,
    },
    async (raw) => {
      const input = FUEL_PLAN_TOOL.inputSchema.parse(raw);
      assertNoRestrictedData(input);

      const synthetic = {
        trainingYears: "3_to_5" as const,
        sessionsPerWeek: 4,
        movementControl: 6,
        painFree: 7,
        nutritionConsistency: input.consistency,
        proteinAdequacy: Math.max(0, input.consistency - 1),
        mealTimingConsistency: input.consistency,
        sleepHours: 7,
        stressLevel: 5,
        recoveryPractices: 5,
        goal: input.goal,
      };

      const plan = generateFuelPlan(synthetic, assess(synthetic));
      const text = [
        `Fuel plan — protein ${plan.proteinAnchorGramsPerKg.min}-${plan.proteinAnchorGramsPerKg.target} g/kg bodyweight`,
        "",
        "Anchors:",
        ...plan.mealAnchors.map((a) => ` - ${a.name}: ${a.detail}`),
        "",
        "Freedom rules:",
        ...plan.freedomRules.map((r) => ` - ${r}`),
        "",
        "When it goes wrong:",
        ...plan.recoveryProtocol.map((r) => ` - ${r}`),
        "",
        plan.limits,
      ].join("\n");

      return textResult(text, plan as unknown as Record<string, unknown>);
    }
  );

  // -------------------------------------------------------------------- trend
  server.registerTool(
    TREND_TOOL.name,
    {
      title: TREND_TOOL.title,
      description: TREND_TOOL.description,
      inputSchema: TREND_TOOL.inputSchema as unknown as z.ZodRawShape,
      annotations: TREND_TOOL.annotations,
      _meta: TREND_TOOL._meta,
    },
    async (raw, extra) => {
      const input = TREND_TOOL.inputSchema.parse(raw);
      const identity = resolveUserId(extra);
      if (!identity.ok) {
        return textResult(
          "I can't read your progress history because this connection isn't signed in as you. " +
            "Progress is tied to your account, so it can't be shown to an unidentified caller. " +
            "Reconnect the plugin and try again."
        );
      }
      const trend = store.getTrend(identity.userId, input.limit);

      if (trend.length < 2) {
        return textResult(
          "There isn't a trend yet. A trend needs at least two assessments, and right now there " +
            "is " +
            (trend.length === 0 ? "none" : "one") +
            ". Run fitness.assess_performance_profile again after a week or two of work, and " +
            "then this will show the real change. One data point is not a trend — saying " +
            "otherwise would be making it up."
        );
      }

      const first = trend[trend.length - 1];
      const latest = trend[0];
      const delta = Math.round((latest.overall - first.overall) * 10) / 10;

      const text = [
        `Progress over ${trend.length} assessments: ${first.overall} → ${latest.overall} (${delta >= 0 ? "+" : ""}${delta})`,
        "",
        ...trend
          .map(
            (t, i) =>
              `${t.createdAt.slice(0, 10)} — overall ${t.overall} | ` +
              t.pillars.map((p) => `${p.key} ${p.score}`).join(" | ")
          )
          .join("\n"),
      ].join("\n");

      return textResult(text, { trend: trend as unknown as Record<string, unknown> });
    }
  );

  // ------------------------------------------------------------------ interest
  server.registerTool(
    INTEREST_TOOL.name,
    {
      title: INTEREST_TOOL.title,
      description: INTEREST_TOOL.description,
      inputSchema: INTEREST_TOOL.inputSchema as unknown as z.ZodRawShape,
      annotations: INTEREST_TOOL.annotations,
      _meta: INTEREST_TOOL._meta,
    },
    async (raw) => {
      const input = INTEREST_TOOL.inputSchema.parse(raw);
      assertNoRestrictedData(input);

      const lead = await store.saveLead({
        email: input.email,
        name: input.name,
        goal: input.goal,
        note: input.note,
      });

      // HONESTY GATE: never claim a capture the deployment cannot deliver.
      if (!capabilities.retainsLeads) {
        const handoff = [
          "I've got what you told me, but this connection is not holding onto it between " +
            "sessions, so I can't promise someone will reach out on its own.",
          "",
          "The fastest way to get a reply is to email us directly:",
          "",
          "  kvnmiller11@gmail.com",
          "",
          `Include: ${lead.goal}`,
          "",
          "Nothing is charged for the conversation, and nothing is scheduled automatically.",
        ].join("\n");

        return textResult(handoff, {
          leadId: lead.id,
          status: lead.status,
          retained: false,
          handoffRequired: true,
        });
      }

      const text = [
        "Request received.",
        "",
        `Reference: ${lead.id}`,
        `Goal: ${lead.goal}`,
        "",
        "What happens next: a coach reviews your request and reaches out directly at " +
          `${lead.email}. Nothing is charged here, and nothing is scheduled automatically — ` +
          "coaching is set up with you directly.",
        "",
        "We store your name, email, goal, and note so we can reply. We do not store your " +
          "medical information, and we do not share your details with anyone.",
      ].join("\n");

      return textResult(text, { leadId: lead.id, status: lead.status, retained: true });
    }
  );

  // ------------------------------------------------------------------- consent
  server.registerTool(
    "fitness.set_privacy_consent",
    {
      title: "Set Privacy Consent",
      description:
        "Use this when a user asks what is stored, agrees to have their progress tracked, or " +
        "asks to stop tracking. Stores the user's consent decision for derived performance " +
        "scores and, separately, for a coaching-contact record. Only ever called in response " +
        "to an explicit user decision — never proactively, and never as a default prompt at " +
        "the end of a conversation.",
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        "openai/toolInvocation/invoking": "Recording your privacy choice",
        "openai/toolInvocation/invoked": "Privacy choice saved",
      },
      inputSchema: z.object({
        storeProgressScores: z.boolean()
          .describe("True to store derived pillar scores so progress can be tracked over time."),
        allowCoachingContact: z.boolean()
          .describe("True to allow a coaching lead to be stored and contacted."),
        optOut: z.boolean().optional()
          .describe("True to delete all stored data for this user and stop tracking."),
      }) as unknown as z.ZodRawShape,
    },
    async (raw, extra) => {
      const input = z
        .object({
          storeProgressScores: z.boolean(),
          allowCoachingContact: z.boolean(),
          optOut: z.boolean().optional(),
        })
        .parse(raw);

      const identity = resolveUserId(extra);
      if (!identity.ok) {
        return textResult(
          "I can't record your privacy choice because this connection isn't signed in as you. " +
            "Consent has to be tied to your account, so it can't be saved for an unidentified " +
            "caller. Reconnect the plugin and try again."
        );
      }
      const uid = identity.userId;

      if (input.optOut) {
        const consent: ConsentRecord = {
          grantedAt: new Date().toISOString(),
          purpose: "opted out",
          analytics: false,
          contact: false,
        };
        await store.saveConsent(uid, consent);
        return textResult("Done. Tracking is off and stored data for this profile has been removed.");
      }

      const consent: ConsentRecord = {
        grantedAt: new Date().toISOString(),
        purpose: CONSENT_PURPOSE,
        analytics: input.storeProgressScores,
        contact: input.allowCoachingContact,
      };
      await store.saveConsent(uid, consent);

      return textResult(
        "Saved. Here is exactly what that means:\n" +
          (input.storeProgressScores
            ? " - Your derived pillar scores and overall score are stored so you can see progress over time.\n"
            : " - Progress scores are not stored.\n") +
          (input.allowCoachingContact
            ? " - Your name, email, goal, and note are stored only if you ask to be contacted about coaching.\n"
            : " - Coaching contact details are not stored.\n") +
          " - Your assessment answers are never stored.\n" +
          " - We never store medical information, and we never share your details with anyone.\n" +
          " - Stored data is automatically deleted after 180 days."
      );
    }
  );

  return server;
}
