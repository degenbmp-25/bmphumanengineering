/**
 * Training microcycle and nutrition fuel plan generation.
 *
 * Pure functions. The method here is deliberately conservative and generic:
 * it is the plugin-safe subset of a kinesiology program, not a client's
 * medical or clinical plan. Anything condition-specific belongs in 1:1
 * coaching, which is exactly what the plugin funnels toward.
 */

import type { AssessmentInput, AssessmentResult } from "./pillars.js";

export interface Microcycle {
  weekLabel: string;
  days: TrainingDay[];
  /** What the client should track and report back. */
  tracking: string[];
  /** Where this week should be adjusted if something goes wrong. */
  adjustmentRules: string[];
}

export interface TrainingDay {
  day: string;
  focus: string;
  sessionMinutes: number;
  blocks: { name: string; detail: string; sets?: string }[];
  intensity: "low" | "moderate" | "high";
}

export const TRAINING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const FOCUS_BY_SPLIT: Record<number, { focus: string; days: string[] }[]> = {
  // Key = sessions per week. The total number of days across all entries
  // MUST equal the key, or the plan silently over-schedules the user.
  2: [
    { focus: "Full body strength", days: ["Monday", "Wednesday"] },
  ],
  3: [
    { focus: "Lower body strength", days: ["Monday"] },
    { focus: "Upper body strength", days: ["Wednesday"] },
    { focus: "Full body + conditioning", days: ["Saturday"] },
  ],
  4: [
    { focus: "Lower body strength", days: ["Monday"] },
    { focus: "Upper body push", days: ["Tuesday"] },
    { focus: "Upper body pull", days: ["Thursday"] },
    { focus: "Conditioning + core", days: ["Saturday"] },
  ],
  5: [
    { focus: "Lower body strength", days: ["Monday"] },
    { focus: "Upper body push", days: ["Tuesday"] },
    { focus: "Upper body pull", days: ["Wednesday"] },
    { focus: "Lower body strength", days: ["Friday"] },
    { focus: "Conditioning + core", days: ["Saturday"] },
  ],
};

function splitFor(sessions: number): { focus: string; days: string[] }[] {
  const bucket = sessions <= 2 ? 2 : sessions === 3 ? 3 : sessions === 4 ? 4 : 5;
  return FOCUS_BY_SPLIT[bucket];
}

export function generateMicrocycle(input: AssessmentInput, result: AssessmentResult): Microcycle {
  const split = splitFor(input.sessionsPerWeek);
  const isBaseBuilding = result.pillars.find((p) => p.key === "body")!.score < 55;
  const isRecoveryDebt = result.pillars.find((p) => p.key === "restore")!.score < 55;

  const sessionMinutes = isBaseBuilding ? 40 : isRecoveryDebt ? 45 : 55;

  const days: TrainingDay[] = TRAINING_DAYS.map((day) => {
    const match = split.find((s) => s.days.includes(day));
    if (!match) {
      return {
        day,
        focus: "Recovery + mobility",
        sessionMinutes: 20,
        intensity: "low",
        blocks: [
          { name: "Mobility flow", detail: "Hips, thoracic spine, shoulders. Slow and unloaded." },
          { name: "Zone 2 walk", detail: "20-30 min, conversational pace. This is not optional." },
          { name: "Breath downshift", detail: "5 min slow nasal exhale breathing before bed." },
        ],
      };
    }

    const isLower = match.focus.toLowerCase().includes("lower");
    const intensity: TrainingDay["intensity"] = isBaseBuilding ? "moderate" : "high";

    return {
      day,
      focus: match.focus,
      sessionMinutes,
      intensity,
      blocks: [
        {
          name: "Warm-up",
          detail: "5-8 min. Ramp: easy cardio, then 2-3 ramp sets of the first movement.",
        },
        {
          name: "Primary work",
          detail: isBaseBuilding
            ? "2-3 main movements, 2 sets each, 8-12 reps, 3-4 sec per rep. Leave 2 reps in reserve on every set."
            : "3-4 main movements, 3 sets each, 5-10 reps. Top set at most 1 rep shy of failure.",
          sets: isBaseBuilding ? "2 sets" : "3 sets",
        },
        {
          name: "Accessory",
          detail: isLower
            ? "Single-leg work, hinges, calf/soleus, core anti-rotation. 2 sets, 10-15 reps."
            : "Pull work, pressing, arms, and rear delts. 2 sets, 10-15 reps.",
          sets: "2 sets",
        },
        {
          name: "Downshift",
          detail: "3 min easy cardio + 2 min nasal-only breathing.",
        },
      ],
    };
  });

  return {
    weekLabel: `Week 1 — ${isBaseBuilding ? "base building" : "progressive"}`,
    days,
    tracking: [
      "Session completion (done / skipped / partial)",
      "Reps and load on your two main lifts",
      "Hours slept the night before each session",
      "Any ache that changed the session, and by how much",
      "Energy 1-10 at the start of each session",
    ],
    adjustmentRules: [
      "Missed two sessions in a row: drop the next week to 80% volume before adding anything.",
      "Ache that changes your movement: back off 20% and reassess before progressing.",
      "Sleep under 6 hours twice in a week: cut intensity, keep frequency.",
      "Progress only one variable per week — reps, or load. Never both.",
    ],
  };
}

export interface FuelPlan {
  /** Flexible targets, not a rigid protocol. */
  proteinAnchorGramsPerKg: { min: number; target: number };
  mealAnchors: { name: string; detail: string }[];
  /** The freedom rules that make it sustainable. */
  freedomRules: string[];
  /** What to do when it goes wrong. */
  recoveryProtocol: string[];
  /** Honest limits of this plan. */
  limits: string;
}

export function generateFuelPlan(input: AssessmentInput, result: AssessmentResult): FuelPlan {
  const fuelScore = result.pillars.find((p) => p.key === "fuel")!.score;
  const isStruggling = fuelScore < 55;
  const isStrong = fuelScore >= 75;

  // We do not have bodyweight in the assessment, deliberately — it is health
  // adjacent data we do not need to collect. We express protein per kg of
  // bodyweight and let the user apply their own number.
  const proteinTarget = input.goal === "body_composition" ? 1.8 : input.goal === "strength" ? 2.0 : 1.6;

  return {
    proteinAnchorGramsPerKg: {
      min: Math.round((proteinTarget - 0.3) * 10) / 10,
      target: proteinTarget,
    },
    mealAnchors: isStruggling
      ? [
          { name: "Anchor 1 — first meal", detail: "Protein + carbs within 2 hours of waking. This sets the tone for the day." },
          { name: "Anchor 2 — midday", detail: "The meal you are most likely to skip. Make it the most reliable one." },
          { name: "Anchor 3 — post-training", detail: "Protein + carbs within two hours after the session." },
        ]
      : [
          { name: "Anchor 1 — first meal", detail: "Protein + carbs within 2 hours of waking." },
          { name: "Anchor 2 — midday", detail: "Steady, not skipped. Most of your day of food lands here." },
          { name: "Anchor 3 — post-training", detail: "Protein + carbs within two hours after the session." },
          { name: "Anchor 4 — evening", detail: "Protein + slow carbs. This is your sleep-food." },
        ],
    freedomRules: isStrong
      ? [
          "Keep one meal completely untracked every week. It is the pressure valve that keeps the system intact.",
          "Eat out twice a week without apology. Pre-decide your protein for that meal, then stop thinking about it.",
          "Travel is not a break from the system. Protein first at every meal, and you are fine.",
        ]
      : [
          "You are not on a diet. You are building three reliable meals. Everything else is untracked.",
          "One meal a day is deliberately free. Removing that rule is how people quit coaching.",
          "When you miss a meal, the next meal is a normal meal. It is not a make-up meal and it is not a failure.",
        ],
    recoveryProtocol: [
      "A skipped meal: eat the next meal as planned and move on. No compensation, no punishment.",
      "A bad day: the next meal is your anchor. That is the whole protocol.",
      "A bad week: cut nothing, change one thing — usually a meal anchor.",
      "Travel or a social week: keep protein at the first meal and let the rest flex.",
    ],
    limits:
      "This is a general nutrition structure, not a medical or clinical nutrition plan. " +
      "It does not account for diagnosed conditions, medications, allergies, disordered eating history, " +
      "pregnancy, or clinical nutrient deficiencies. If any of those apply, this plan is not appropriate " +
      "for you without a registered dietitian or clinician.",
  };
}
