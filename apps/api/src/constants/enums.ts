// Single source of truth for all enum values used across the API.
// Update here — all route handlers pick it up automatically.

export const PROJECT_TYPE_VALUES = ['general', 'web_app', 'mobile', 'api', 'automation'] as const;
export type ProjectType = typeof PROJECT_TYPE_VALUES[number];

/** All types selectable by users when creating/editing a project. */
export const SELECTABLE_PROJECT_TYPES = ['web_app', 'mobile', 'api', 'automation', 'general'] as const;
export type SelectableProjectType = typeof SELECTABLE_PROJECT_TYPES[number];

// ─── Communication channels ──────────────────────────────────────────────────

export const COMMUNICATION_CHANNEL_VALUES = ['upwork', 'email', 'slack', 'call', 'other'] as const;
export type CommunicationChannel = typeof COMMUNICATION_CHANNEL_VALUES[number];

// ─── Prompt stages ────────────────────────────────────────────────────────────

export const PROMPT_STAGE_VALUES = [
  'brief_extraction',
  'epic_generation',
  'journey_generation',
  'task_decomposition',
] as const;
export type PromptStage = typeof PROMPT_STAGE_VALUES[number];

// ─── AI providers ─────────────────────────────────────────────────────────────

export const AI_PROVIDER_VALUES = ['anthropic', 'openai'] as const;
export type AIProvider = typeof AI_PROVIDER_VALUES[number];

// ─── Project status ───────────────────────────────────────────────────────────

export const PROJECT_STATUS_VALUES = ['draft', 'in_review', 'approved', 'synced'] as const;
export type ProjectStatus = typeof PROJECT_STATUS_VALUES[number];

// ─── User roles ───────────────────────────────────────────────────────────────

export const USER_ROLE_VALUES = ['admin', 'pm'] as const;
export type UserRole = typeof USER_ROLE_VALUES[number];

export const ORG_ROLE_VALUES = ['owner', 'admin', 'pm'] as const;
export type OrgRole = typeof ORG_ROLE_VALUES[number];
