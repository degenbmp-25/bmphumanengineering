/**
 * Tool contracts.
 *
 * Per the OpenAI metadata guidance, descriptions are written for SELECTION:
 *   - start with "Use this when..."
 *   - call out the disallowed cases
 *   - describe user intent, not implementation
 *   - annotations reflect ACTUAL behavior
 *
 * The tool names are the primary signal the model uses, so they are
 * domain.action pairs: "fitness.*", never "do_thing".
 */

import { z } from "zod";

export const assessmentSchema = z.object({
  trainingYears: z.enum(["under_1", "1_to_3", "3_to_5", "5_plus"])
    .describe("How many years have you trained seriously and consistently?"),
  sessionsPerWeek: z.number().int().min(0).max(7)
    .describe("How many training sessions per week do you currently complete?"),
  movementControl: z.number().int().min(0).max(10)
    .describe("0-10. How much of a full, controlled range of motion can you own?"),
  painFree: z.number().int().min(0).max(10)
    .describe("0-10. How often are you free of aches or pains that limit your training?"),
  nutritionConsistency: z.number().int().min(0).max(10)
    .describe("0-10. How reliably do you hit your nutrition targets?"),
  proteinAdequacy: z.number().int().min(0).max(10)
    .describe("0-10. Do you get enough protein without excessive effort?"),
  mealTimingConsistency: z.number().int().min(0).max(10)
    .describe("0-10. How consistent is your eating schedule?"),
  sleepHours: z.number().min(4).max(10)
    .describe("Typical hours of sleep per night (4-10)."),
  stressLevel: z.number().int().min(1).max(10)
    .describe("1-10. Current chronic stress level, where 10 is maximum."),
  recoveryPractices: z.number().int().min(0).max(10)
    .describe("0-10. How consistent are your deliberate recovery practices?"),
  goal: z.enum(["body_composition", "strength", "energy", "longevity", "performance"])
    .describe("The primary outcome the user wants to prioritise right now."),
});

export type AssessmentInput = z.infer<typeof assessmentSchema>;

export const ASSESSMENT_TOOL = {
  name: "fitness.assess_performance_profile",
  title: "Assess Performance Profile",
  description:
    "Use this when a user wants a structured read on their training, nutrition, and recovery, " +
    "or asks where they should focus first. Returns three pillar scores (Bulletproof Body, " +
    "Fuel with Freedom, Recharge and Restore), the single biggest lever, and up to three " +
    "prioritised actions. Do NOT use for medical diagnosis, injury treatment, or nutrition " +
    "therapy. Do not use when the user is asking only about general fitness information, " +
    "exercise form, or a single exercise's technique — answer those directly instead. " +
    "This is coaching assessment, not clinical assessment.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    "openai/toolInvocation/invoking": "Scoring your three performance pillars",
    "openai/toolInvocation/invoked": "Performance profile ready",
  },
  inputSchema: assessmentSchema,
} as const;

export const MICROCYCLE_TOOL = {
  name: "fitness.build_training_microcycle",
  title: "Build Training Microcycle",
  description:
    "Use this when a user wants a week of training built around their goal, a specific split, " +
    "or their current session frequency. Returns a day-by-day week with session length, blocks, " +
    "intensity, what to track, and the rules for adjusting if the week goes sideways. " +
    "Do NOT use for injury rehabilitation, post-surgical programming, or return-from-injury plans — " +
    "those need a clinician. Do not use to prescribe a program for a condition the user has " +
    "disclosed. Use fitness.assess_performance_profile first when you have not yet seen the " +
    "user's training history, because the plan adapts to it.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    "openai/toolInvocation/invoking": "Building your training week",
    "openai/toolInvocation/invoked": "Training week ready",
  },
  inputSchema: z.object({
    goal: z.enum(["body_composition", "strength", "energy", "longevity", "performance"])
      .describe("The primary outcome to build the week around."),
    sessionsPerWeek: z.number().int().min(1).max(6)
      .describe("How many training sessions per week to program (1-6)."),
    sessionsAre: z.enum(["established", "rebuilding", "returning"])
      .describe("'established' = consistent for 1+ years; 'rebuilding' = consistent for months but " +
        "capacity is down; 'returning' = after a long layoff."),
    equipment: z.enum(["full_gym", "home_gym", "minimal", "bodyweight"])
      .describe("Available equipment. Determines exercise selection."),
    notes: z.string().max(500).optional()
      .describe("Optional context the user gave: time constraints, injuries to work around, " +
        "schedule, preferences."),
  }),
} as const;

export const FUEL_PLAN_TOOL = {
  name: "fitness.build_fuel_plan",
  title: "Build Fuel Plan",
  description:
    "Use this when a user wants a nutrition structure, wants to fix eating consistency, or asks " +
    "how to eat for their goal. Returns protein targets per kg of bodyweight, three or four " +
    "reliable meal anchors, freedom rules that keep it sustainable, and a recovery protocol for " +
    "missed meals and bad weeks. Do NOT use for clinical nutrition, therapeutic diets, " +
    "medication-related diet changes, disordered eating treatment, or allergy-driven plans — " +
    "refer those to a registered dietitian or clinician. Do not use to calculate calorie targets " +
    "for someone with an eating disorder history.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    "openai/toolInvocation/invoking": "Building your fuel plan",
    "openai/toolInvocation/invoked": "Fuel plan ready",
  },
  inputSchema: z.object({
    goal: z.enum(["body_composition", "strength", "energy", "longevity", "performance"])
      .describe("The primary outcome the plan should support."),
    consistency: z.number().int().min(0).max(10)
      .describe("0-10. How reliable is the user's eating right now? Low values produce a " +
        "simplified plan; high values produce a plan that focuses on flexibility."),
    flexibilityIsTheConstraint: z.boolean()
      .describe("True when the user's main problem is rigidity or social/travel disruption, " +
        "rather than lack of knowledge. Changes the tone and the rules."),
    notes: z.string().max(500).optional()
      .describe("Optional context: dietary preferences, schedule, what has failed before."),
  }),
} as const;

export const TREND_TOOL = {
  name: "fitness.get_progress_trend",
  title: "Get Progress Trend",
  description:
    "Use this when a user asks how they have been progressing, wants to compare recent " +
    "assessments, or asks whether something is working. Returns up to five recent pillar " +
    "scores, overall scores, and the change between them. Do NOT use before the user has " +
    "completed at least two assessments — there is no trend yet and the honest answer is " +
    "that one data point is not a trend. Only returns stored derived scores, never raw answers.",
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    "openai/toolInvocation/invoking": "Pulling your progress trend",
    "openai/toolInvocation/invoked": "Trend ready",
  },
  inputSchema: z.object({
    limit: z.number().int().min(1).max(10).default(5)
      .describe("How many recent assessments to include (1-10)."),
  }),
} as const;

export const INTEREST_TOOL = {
  name: "fitness.submit_coaching_interest",
  title: "Submit Coaching Interest",
  description:
    "Use this ONLY when a user explicitly asks to be contacted about one-to-one coaching, " +
    "or explicitly asks to apply for coaching. Collects name, email, goal, and an optional note, " +
    "then creates a lead for the coach. Do NOT use proactively, do NOT use to upsell, and do NOT " +
    "use it as a lead-capture step at the end of a free interaction — only on an explicit " +
    "request from the user. There is no in-plugin purchase: coaching is sold and scheduled " +
    "separately, so this tool only records interest.",
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  _meta: {
    "openai/toolInvocation/invoking": "Recording your coaching request",
    "openai/toolInvocation/invoked": "Request received",
  },
  inputSchema: z.object({
    name: z.string().min(1).max(120).describe("The user's name."),
    email: z.string().email().describe("The user's email address, for the coach to reply to."),
    goal: z.enum(["body_composition", "strength", "energy", "longevity", "performance"])
      .describe("The primary outcome they want coaching for."),
    note: z.string().max(1000).optional()
      .describe("Optional message. Do not include medical history, medications, diagnoses, " +
        "government identifiers, or payment details — those are rejected and not stored."),
    consentGranted: z.literal(true)
      .describe("Must be true. Confirms the user agreed to be contacted about coaching."),
  }),
} as const;
