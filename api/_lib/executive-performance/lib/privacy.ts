/**
 * Privacy layer for the Executive Performance plugin.
 *
 * Design rule, taken directly from the OpenAI plugin guidelines:
 *   "Gather only the minimum data required to perform the plugin's function."
 *
 * Consequences implemented here:
 *   1. Assessment inputs (sleep, stress, pain, food) are TRANSIENT. They are used
 *      to compute scores and are never written to disk.
 *   2. Only coarse, non-identifying derived values are persisted for analytics:
 *      the three pillar scores, the band, the goal, and the goal weighting.
 *   3. Contact details are only ever stored through submit_coaching_interest,
 *      which requires an explicit, affirmative consent flag.
 *   4. No protected health information is ever accepted as a field. There is no
 *      field for diagnoses, medications, SSN, or biometrics. See
 *      assertNoRestrictedData().
 *   5. Retention is enforced: records older than the retention window are purged
 *      on every read and write.
 */

export const RETENTION_DAYS = 180;

export const RESTRICTED_FIELD_NAMES = [
  "ssn",
  "social_security",
  "social_security_number",
  "medication",
  "medications",
  "diagnosis",
  "diagnoses",
  "condition",
  "medical_record",
  "diagnosis_code",
  "icd10",
  "insurance_id",
  "policy_number",
  "card_number",
  "cvv",
  "api_key",
  "password",
  "otp",
  "mfa_code",
];

/**
 * Hard guard. If any input key looks like restricted data, we refuse the call
 * rather than storing or processing it. This is a fail-closed check.
 */
export function assertNoRestrictedData(input: unknown, path = "input"): void {
  if (input === null || typeof input !== "object") return;

  if (Array.isArray(input)) {
    input.forEach((v, i) => assertNoRestrictedData(v, `${path}[${i}]`));
    return;
  }

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[\s-]/g, "_");
    if (RESTRICTED_FIELD_NAMES.includes(normalized)) {
      throw new Error(
        `Rejected: field "${path}.${key}" is a restricted data category and must not be ` +
          `collected, transmitted, or stored by this plugin. Remove it and continue.`
      );
    }
    assertNoRestrictedData(value, `${path}.${key}`);
  }
}

export interface ConsentRecord {
  /** Timestamp of consent grant. */
  grantedAt: string;
  /** What the user agreed to, stated in plain language. */
  purpose: string;
  /** Whether analytics retention was explicitly permitted. */
  analytics: boolean;
  /** Whether a coaching-interest lead may be stored. */
  contact: boolean;
}

export const CONSENT_PURPOSE =
  "Store my derived performance pillar scores so the coach can see trends, and store my " +
  "contact details only if I explicitly ask to be contacted about coaching.";

export function isConsentValid(consent: ConsentRecord | undefined | null): boolean {
  if (!consent) return false;
  const ageDays = (Date.now() - new Date(consent.grantedAt).getTime()) / 86_400_000;
  if (Number.isNaN(ageDays) || ageDays > RETENTION_DAYS) return false;
  if (!consent.analytics && !consent.contact) return false;
  return true;
}

export interface AnalyticsRecord {
  userId: string;
  createdAt: string;
  goal: string;
  overall: number;
  pillars: { key: string; score: number; band: string }[];
  primaryLever: string;
}

export interface LeadRecord {
  id: string;
  createdAt: string;
  email: string;
  name?: string;
  goal: string;
  /** Free-text message from the user. Must be scanned before storage. */
  note?: string;
  status: "new" | "contacted" | "converted" | "closed";
}

/**
 * Lead notes are free text typed by a human, so they are the one place where
 * restricted data can sneak in. We scan for common patterns and refuse to
 * store a note that looks like it contains identifiers.
 */
export function noteContainsRestrictedData(note: string): boolean {
  const s = note.toLowerCase();
  const patterns: RegExp[] = [
    /\b\d{3}-\d{2}-\d{4}\b/, // SSN
    /\b\d{13,19}\b/, // long card-like number
    /\b(social security|ssn)\b/,
    /\b(diagnos|prescri|medication|prescription)\w*/,
    /\b(insurance|policy)\s*(#|number|id)\b/,
    /\bapi[_ -]?key\b/,
    /\bpassword\b/,
    /\b\d{3}[- ]?\d{3}[- ]?\d{4}\b/, // phone-ish, allowed but flagged separately
  ];
  return patterns.some((p) => p.test(s));
}

export function redactNote(note: string): string {
  if (!noteContainsRestrictedData(note)) return note;
  return "[redacted: note contained data that this plugin is not permitted to store]";
}

export function purgeExpired<T extends { createdAt: string }>(records: T[], now = Date.now()): T[] {
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  return records.filter((r) => {
    const t = new Date(r.createdAt).getTime();
    return !Number.isNaN(t) && t >= cutoff;
  });
}

export const PRIVACY_SUMMARY = {
  retentionDays: RETENTION_DAYS,
  assessmentInputsStored: false,
  contactStoredOnlyWithConsent: true,
  restrictedDataCollected: false,
  thirdPartySharing: "none",
} as const;
