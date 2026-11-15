/**
 * Executive Performance — assessment engine
 *
 * Pure functions, no I/O, no persistence. Fully unit-testable.
 *
 * Three pillars mirror the coaching methodology (see vault/projects/health-coaching-website/handoff.md):
 *   1. Bulletproof Body  — build capacity and kill aches/pains
 *   2. Fuel with Freedom — nutrition as freedom, not restriction
 *   3. Recharge and Restore — recovery inputs matched to output
 */

export const SCALE_MAX = 100;

export interface AssessmentInput {
  /** Self-reported training age bucket. */
  trainingYears: "under_1" | "1_to_3" | "3_to_5" | "5_plus";
  /** Sessions per week, 0-7. */
  sessionsPerWeek: number;
  /** 0-10. How much of a full, controlled range of motion you can own. */
  movementControl: number;
  /** 0-10. How consistently you are free of aches/pains that limit training. */
  painFree: number;
  /** 0-10. How reliably you hit your protein and meal targets. */
  nutritionConsistency: number;
  /** 0-10. How reliably you meet your macro needs without rigid restriction. */
  proteinAdequacy: number;
  /** 0-10. How consistent your eating schedule is (not food quality). */
  mealTimingConsistency: number;
  /** Hours of sleep on a typical night, 4-10. */
  sleepHours: number;
  /** Perceived chronic stress, 1-10 (10 = max). */
  stressLevel: number;
  /** 0-10. Deliberate recovery practices (mobility, sauna, breathwork, etc). */
  recoveryPractices: number;
  /** Primary goal, drives the emphasis weighting. */
  goal: "body_composition" | "strength" | "energy" | "longevity" | "performance";
}

export interface PillarScore {
  key: "body" | "fuel" | "restore";
  label: string;
  score: number;
  band: "critical" | "weak" | "developing" | "strong";
}

export interface AssessmentResult {
  overall: number;
  pillars: PillarScore[];
  /** The single pillar doing the most limiting work on the goal. */
  primaryLever: PillarScore;
  recommendations: Recommendation[];
  /** Non-medical coaching disclaimer surfaced with every result. */
  disclaimer: string;
}

export interface Recommendation {
  pillar: "body" | "fuel" | "restore";
  title: string;
  detail: string;
  /** Concrete, coachable action for the next 7 days. */
  action: string;
  priority: 1 | 2 | 3;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 10) / 10;

export function band(score: number): PillarScore["band"] {
  if (score < 35) return "critical";
  if (score < 55) return "weak";
  if (score < 75) return "developing";
  return "strong";
}

const TRAINING_BASE: Record<AssessmentInput["trainingYears"], number> = {
  under_1: 32,
  "1_to_3": 48,
  "3_to_5": 63,
  "5_plus": 76,
};

export function scoreBody(i: AssessmentInput): number {
  const base = TRAINING_BASE[i.trainingYears];
  const volume = clamp(i.sessionsPerWeek, 0, 7) * 4.5;
  const control = clamp(i.movementControl, 0, 10) * 1.8;
  const painFree = clamp(i.painFree, 0, 10) * 2.2;
  return round(clamp(base + volume + control + painFree, 0, SCALE_MAX));
}

export function scoreFuel(i: AssessmentInput): number {
  const consistency = clamp(i.nutritionConsistency, 0, 10) * 6;
  const protein = clamp(i.proteinAdequacy, 0, 10) * 3.2;
  const timing = clamp(i.mealTimingConsistency, 0, 10) * 1.8;
  return round(clamp(consistency + protein + timing, 0, SCALE_MAX));
}

export function scoreRestore(i: AssessmentInput): number {
  const sleep = clamp(i.sleepHours, 4, 10);
  // 7h+ saturates; below 6h falls off steeply.
  let sleepPoints: number;
  if (sleep >= 7) sleepPoints = 70;
  else if (sleep >= 6.5) sleepPoints = 58;
  else if (sleep >= 6) sleepPoints = 44;
  else if (sleep >= 5) sleepPoints = 28;
  else sleepPoints = 15;
  const stressRelief = (10 - clamp(i.stressLevel, 1, 10)) * 2.6;
  const practices = clamp(i.recoveryPractices, 0, 10) * 1.4;
  return round(clamp(sleepPoints + stressRelief + practices, 0, SCALE_MAX));
}

/** Goal weighting: which pillar the score should lean on. */
const GOAL_WEIGHTS: Record<AssessmentInput["goal"], Record<string, number>> = {
  body_composition: { body: 0.35, fuel: 0.45, restore: 0.2 },
  strength: { body: 0.5, fuel: 0.3, restore: 0.2 },
  energy: { body: 0.25, fuel: 0.35, restore: 0.4 },
  longevity: { body: 0.3, fuel: 0.3, restore: 0.4 },
  performance: { body: 0.4, fuel: 0.25, restore: 0.35 },
};

export const DISCLAIMER =
  "This is performance coaching, not medical advice, diagnosis, or treatment. " +
  "It is not a substitute for a licensed clinician. If you have a medical condition, " +
  "are pregnant, are recovering from injury or surgery, or are managing a diagnosed " +
  "condition, consult a qualified healthcare professional before changing your training, " +
  "nutrition, or sleep. Do not use this to make medical decisions.";

/** Guardrail: refuse to run on inputs that imply clinical territory. */
export const CLINICAL_ESCALATION =
  "Some of your answers point to something that needs clinical attention rather than " +
  "coaching — for example persistent pain, dizziness, or a diagnosis you are actively " +
  "managing. Please talk to your doctor first. I can still help with general training, " +
  "nutrition, and recovery structure once you're cleared.";

function buildRecommendations(i: AssessmentInput, body: number, fuel: number, restore: number): Recommendation[] {
  const recs: Recommendation[] = [];

  if (body < 55) {
    recs.push({
      pillar: "body",
      title: "Rebuild the base before you load it",
      detail:
        "Your capacity and pain-free range of motion are the constraint right now. " +
        "Pushing volume on a foundation that leaks will cost you more than it returns.",
      action:
        "Hold 2-3 sessions/week focused on controlled tempo and full-range reps. " +
        "Cut any set you cannot own. Add one 10-minute mobility block daily for the " +
        "areas that ache most.",
      priority: 1,
    });
  } else if (body < 75) {
    recs.push({
      pillar: "body",
      title: "Progressive overload, deliberately dosed",
      detail:
        "You have a working base. The gain now comes from small, tracked increases " +
        "rather than a new program.",
      action:
        "Add reps or load to your two main lifts before adding anything new. " +
        "One variable per week. Log it — if you can't log it, you can't progress it.",
      priority: 2,
    });
  }

  if (fuel < 55) {
    recs.push({
      pillar: "fuel",
      title: "Consistency before precision",
      detail:
        "Fuel isn't working because the rules are too tight, not because the rules are " +
        "wrong. Freedom means you can eat the same way on a Tuesday in Miami as on a " +
        "Sunday at home.",
      action:
        "Pick the three meals that repeat most and make those reliable. Protein first " +
        "at each. Leave one meal deliberately untracked — it keeps the system sustainable.",
      priority: 1,
    });
  } else if (fuel < 75) {
    recs.push({
      pillar: "fuel",
      title: "Widen the margin",
      detail:
        "Your nutrition is holding. The edge now is tolerance — being able to eat out, " +
        "travel, and eat socially without the week falling apart.",
      action:
        "Plan one high-risk meal each week in advance and pre-decide your protein and " +
        "carbs for it. Repeat the same restaurant twice to test it.",
      priority: 3,
    });
  }

  if (restore < 55) {
    recs.push({
      pillar: "restore",
      title: "Recovery is the training, not the break from it",
      detail:
        "Sleep and stress are the biggest leaks in your output right now. More training " +
        "on this recovery is borrowed performance with interest.",
      action:
        "Fix the wake time first — same time daily, including weekends. Then add a " +
        "10-minute wind-down before bed. Track the wake time, not the bedtime.",
      priority: 1,
    });
  } else if (restore < 75) {
    recs.push({
      pillar: "restore",
      title: "Match recovery to load",
      detail:
        "Recovery is adequate but generic. Precise recovery beats generous recovery.",
      action:
        "Pair one recovery practice with each hard training day: mobility after " +
        "lower body, breathwork or sauna after upper. Same week, same order, every time.",
      priority: 2,
    });
  }

  if (recs.length === 0) {
    recs.push({
      pillar: "body",
      title: "Maintain, then find one more edge",
      detail:
        "All three pillars are in strong territory. The remaining gains come from " +
        "specificity — one targeted adaptation rather than broad change.",
      action:
        "Pick the one metric closest to your goal and add a single weekly stressor " +
        "against it. Review in 14 days and adjust only that variable.",
      priority: 3,
    });
  }

  const order: Record<number, number> = { 1: 0, 2: 1, 3: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 3);
}

export function assess(input: AssessmentInput): AssessmentResult {
  const body = scoreBody(input);
  const fuel = scoreFuel(input);
  const restore = scoreRestore(input);
  const w = GOAL_WEIGHTS[input.goal];

  const overall = round(clamp(body * w.body + fuel * w.fuel + restore * w.restore, 0, SCALE_MAX));

  const pillars: PillarScore[] = [
    { key: "body", label: "Bulletproof Body", score: body, band: band(body) },
    { key: "fuel", label: "Fuel with Freedom", score: fuel, band: band(fuel) },
    { key: "restore", label: "Recharge and Restore", score: restore, band: band(restore) },
  ];

  const primaryLever = pillars.reduce((min, p) => (p.score < min.score ? p : min));

  return {
    overall,
    pillars,
    primaryLever,
    recommendations: buildRecommendations(input, body, fuel, restore),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Heuristic check for inputs that indicate clinical territory.
 * Deliberately conservative: it escalates on explicit medical flags only.
 */
export function needsClinicalNote(input: AssessmentInput & { hasActiveDiagnosis?: boolean; symptomsInterfereWithTraining?: boolean }): boolean {
  if (input.hasActiveDiagnosis) return true;
  if (input.symptomsInterfereWithTraining) return true;
  return false;
}
