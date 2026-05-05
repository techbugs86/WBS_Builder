// Single source of truth for all enum values used across the frontend.
// Update here — all consumers pick it up automatically.

export const PROJECT_TYPE_VALUES = ['general', 'web_app', 'mobile', 'api', 'automation'] as const;
export type ProjectType = typeof PROJECT_TYPE_VALUES[number];

/** All types selectable by users when creating/editing a project. */
export const PROJECT_TYPE_VALUES_SELECTABLE = ['web_app', 'mobile', 'api', 'automation', 'general'] as const;
export type SelectableProjectType = typeof PROJECT_TYPE_VALUES_SELECTABLE[number];

export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  web_app:    'Web App',
  mobile:     'Mobile',
  api:        'API / Backend',
  automation: 'Automation',
  general:    'Other / General',
};

// ─── Communication channels ──────────────────────────────────────────────────

export const COMMUNICATION_CHANNEL_VALUES = ['upwork', 'email', 'slack', 'call', 'other'] as const;
export type CommunicationChannel = typeof COMMUNICATION_CHANNEL_VALUES[number];

export const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  upwork: 'Upwork',
  email:  'Email',
  slack:  'Slack',
  call:   'Call',
  other:  'Other',
};

export const CHANNEL_PLACEHOLDERS: Record<CommunicationChannel, string> = {
  upwork: 'Upwork job URL or contract ID',
  email:  'Email thread subject or reference',
  slack:  'Slack channel or message link',
  call:   'Meeting notes or recording link',
  other:  'Reference or link',
};

// ─── Prompt stages ────────────────────────────────────────────────────────────

export const PROMPT_STAGE_VALUES = [
  'brief_extraction',
  'epic_generation',
  'journey_generation',
  'task_decomposition',
] as const;
export type PromptStage = typeof PROMPT_STAGE_VALUES[number];

export const PROMPT_STAGE_LABELS: Record<PromptStage, string> = {
  brief_extraction:   'Brief Extraction',
  epic_generation:    'Epic Generation',
  journey_generation: 'Journey Generation',
  task_decomposition: 'Task Decomposition',
};

// ─── AI providers ─────────────────────────────────────────────────────────────

export const AI_PROVIDER_VALUES = ['anthropic', 'openai'] as const;
export type AIProvider = typeof AI_PROVIDER_VALUES[number];

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI (GPT)',
};

// ─── Project status ───────────────────────────────────────────────────────────

export const PROJECT_STATUS_VALUES = ['draft', 'in_review', 'approved', 'synced'] as const;
export type ProjectStatus = typeof PROJECT_STATUS_VALUES[number];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft:     'Draft',
  in_review: 'In Review',
  approved:  'Approved',
  synced:    'Synced',
};

// ─── User roles ───────────────────────────────────────────────────────────────

export const USER_ROLE_VALUES = ['admin', 'pm'] as const;
export type UserRole = typeof USER_ROLE_VALUES[number];

export const ORG_ROLE_VALUES = ['owner', 'admin', 'pm'] as const;
export type OrgRole = typeof ORG_ROLE_VALUES[number];
