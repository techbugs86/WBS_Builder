import type { Epic } from '../ai/index.js';

/**
 * Classify an epic into a priority tier (1 = highest, 4 = lowest).
 *
 * The LLM is unreliable at structural ordering — it tends to alphabetize or
 * echo the brief's narrative order. This deterministic post-sort enforces
 * the project's "foundation → core value → supporting → growth" rubric so
 * the team always sees auth at the top and notifications at the bottom.
 */
function tierOf(epic: Epic): number {
  const title = (epic.title ?? '').toLowerCase();
  const desc = (epic.description ?? '').toLowerCase().slice(0, 400);
  const both = `${title} ${desc}`;

  // Tier 0 — IDENTITY (top of the list, always). Auth / user account / sign-up.
  // Every other epic eventually filters by user_id, and that field doesn't
  // exist without Auth. A dev can demo Auth end-to-end with nothing else built;
  // the reverse isn't true. So Auth MUST sit at #1 above any other foundation.
  if (epic.domain === 'auth') return 0;
  if (/\b(auth|authent|sign[- ]?in|sign[- ]?up|register|registration|login|sso|oauth|onboard|account creation|user account|user identity|user management)\b/.test(title)) return 0;

  // Tier 1 — OTHER FOUNDATIONS. Payments, POS, core data model, third-party
  // backbones. They gate downstream epics but depend on the user identity
  // from Tier 0 to be useful.
  if (/\b(payment|billing|checkout|transactions?|refund|chargeback|stripe|paypal|invoicing|subscription billing|pos integration|payment gateway)\b/.test(both)) return 1;
  if (/\b(api foundation|core data model|database schema|backend foundation)\b/.test(both)) return 1;

  // Tier 4 — Engagement / growth. Retention layered on top of a working product;
  // these shouldn't block the first release.
  if (epic.domain === 'notifications') return 4;
  if (/\b(notification|push notif|email campaign|marketing|referral|campaign|analytics dashboard|retention|onboarding email)\b/.test(title)) return 4;

  // Tier 3 — Supporting features. Admin tools, dashboards, settings, history.
  if (epic.domain === 'admin') return 3;
  if (/\b(dashboard|admin|manager|moderation|settings|preferences|history|reporting|audit log|export)\b/.test(title)) return 3;

  // Tier 2 — Core value. Default tier for the headline product capability.
  return 2;
}

/**
 * Reorder epics by priority tier. Stable within each tier — items in the
 * same tier retain the LLM's original relative order, so the model can
 * still influence ordering between e.g. two Tier 2 epics.
 */
export function sortEpicsByPriority<T extends Epic>(epics: T[]): T[] {
  return [...epics]
    .map((e, originalIndex) => ({ e, originalIndex, tier: tierOf(e) }))
    .sort((a, b) => a.tier - b.tier || a.originalIndex - b.originalIndex)
    .map((x) => x.e);
}
