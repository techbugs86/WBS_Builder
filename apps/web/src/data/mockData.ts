export type { UserRole, OrgRole, PromptStage, ProjectType, SelectableProjectType, CommunicationChannel, AIProvider, ProjectStatus } from '../constants/enums';
import type { SelectableProjectType, CommunicationChannel, AIProvider, ProjectStatus, OrgRole, PromptStage } from '../constants/enums';

export type TaskStatus = 'pending' | 'approved' | 'flagged';
export type CriterionType = 'functional' | 'non-functional' | 'technical';
export type EpicStatus = 'pending' | 'approved';
export type JourneyStatus = 'pending' | 'approved';
export type Domain = 'auth' | 'billing' | 'search' | 'messaging' | 'profile' | 'admin' | 'notifications';

export type QuestionStatus = 'open' | 'answered' | 'dismissed';

export interface OpenQuestion {
  id: string;
  text: string;
  status: QuestionStatus;
  answer: string;
}

export interface ProjectDefinition {
  name: string;
  client: string;
  projectType: SelectableProjectType;
  estimatedBudget: string;
  startDate: string;
  communicationChannels: CommunicationChannel[];
  channelLinks: Partial<Record<CommunicationChannel, string>>;
  contactPerson: string;
  rawInput: string;
  attachedFiles: AttachedFile[];
  /** True when the server-side project row has extracted text from at least
   *  one uploaded document. Lets the Brief page treat "no raw input but
   *  attachments exist" as a valid source so the user can generate a brief
   *  purely from a PDF/DOCX/image they uploaded. Hydrated on loadProject(). */
  hasAttachments: boolean;
  provider: AIProvider;
}

export interface AttachedFile {
  id: string;
  name: string;
  size: number;
  type: string;
  previewUrl: string | null;
}

// Generic version wrapper for any item
export interface Version<T> {
  version: number;
  createdAt: string;
  label: string;
  challengeText?: string;
  data: T;
}

export interface SavedProject {
  id: string;
  name: string;
  client: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  epicCount: number;
  taskCount: number;
  syncedCount: number;
  provider: AIProvider;
  definition?: ProjectDefinition;
}

export interface Brief {
  title: string;
  client: string;
  date: string;
  summary: string;
  openQuestions: OpenQuestion[];
  assumptions: { id: string; text: string }[];
  inScope: string[];
  outOfScope: string[];
}

export type BriefWithHistory = { current: Brief; versions: Version<Brief>[] };

export interface Epic {
  id: string;
  title: string;
  domain: Domain;
  description: string;
  storyPoints: number;
  status: EpicStatus;
}

export type EpicWithHistory = { current: Epic; versions: Version<Epic>[] };

export interface JourneyTestCase {
  name: string;
  given: string;
  when: string;
  then: string;
}

export interface Journey {
  id: string;
  epicId: string;
  persona: string;
  title: string;
  steps: string[];
  happyPath: string;
  /** Descriptive edge case strings — "condition + what happens". */
  edgeCases?: string[];
  /** Structured QA test cases in Given/When/Then form. */
  testCases?: JourneyTestCase[];
  edgeCasesCount: number;
  status: JourneyStatus;
}

export type JourneyWithHistory = { current: Journey; versions: Version<Journey>[] };

export interface AcceptanceCriterion {
  type: CriterionType;
  given: string;
  when: string;
  then: string;
}

export interface Task {
  id: string;
  wbsId: string;
  title: string;
  estimateHours: number;
  domain: Domain;
  epicId: string;
  journeyId: string;
  acceptanceCriteria: AcceptanceCriterion[];
  dependencies: string[];
  status: TaskStatus;
  assignee: string;
}

export type TaskWithHistory = { current: Task; versions: Version<Task>[] };

export interface SyncEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'warning' | 'error';
}

// ─── Auth & RBAC ──────────────────────────────────────────────────────────────

export interface AppUser {
  id: string;
  email: string;
  name: string;
  /** The user's role in their currently-active org. Sourced from the JWT. */
  role: OrgRole;
  orgId: string;
}

// Includes password only for mock auth — never expose this shape via API
export interface MockUserWithPassword extends AppUser {
  password: string;
}

// ─── Prompt Configuration ─────────────────────────────────────────────────────

export interface PromptConfig {
  id: string;
  stage: PromptStage;
  label: string;
  systemPrompt: string;
  userPromptTemplate: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

const BASE_BRIEF: Brief = {
  title: 'Freelancer Marketplace Platform',
  client: 'TalentConnect Inc.',
  date: '2026-04-15',
  summary:
    'TalentConnect wants a two-sided marketplace platform connecting freelancers with clients. The platform must support profile creation, project posting, bidding, escrow payments, and in-app messaging. The MVP focuses on the web experience with a mobile-responsive design. The client expects roughly 500 freelancers and 200 clients at launch, growing to 5,000 freelancers within 6 months.',
  openQuestions: [
    { id: 'oq-1', text: 'What payment processor should be used — Stripe or Braintree? Escrow logic differs significantly between them.', status: 'open', answer: '' },
    { id: 'oq-2', text: 'Should freelancers be able to set hourly rates AND fixed-price bids, or only fixed-price for MVP?', status: 'open', answer: '' },
    { id: 'oq-3', text: 'Is KYC/identity verification required at signup or deferred until first payout?', status: 'open', answer: '' },
    { id: 'oq-4', text: 'What is the dispute resolution process if a client rejects submitted work?', status: 'open', answer: '' },
  ],
  assumptions: [
    { id: 'as-1', text: 'Authentication will use email/password + Google OAuth. No SSO/SAML for MVP.' },
    { id: 'as-2', text: 'Platform fee is 10% deducted from freelancer payout, configurable by admin.' },
    { id: 'as-3', text: 'Messaging is real-time via WebSocket but messages are text-only for MVP (no file attachments).' },
    { id: 'as-4', text: 'Admin panel is internal-only and not accessible to clients or freelancers.' },
  ],
  inScope: [
    'Freelancer and client registration & profiles',
    'Project posting and browsing',
    'Proposal / bid submission',
    'Escrow payment flow (fund → release → payout)',
    'Real-time in-app messaging',
    'Review and rating system',
    'Admin dashboard (user management, fee config)',
    'Email notifications for key events',
  ],
  outOfScope: [
    'Mobile native apps (iOS / Android)',
    'Video calls or screen sharing',
    'File attachment in messages (deferred to v1.1)',
    'Multi-currency support (USD only for MVP)',
    'Public API for third-party integrations',
    'Automated tax form generation (1099-K)',
  ],
};

export const MOCK_BRIEF: BriefWithHistory = {
  current: BASE_BRIEF,
  versions: [
    {
      version: 1,
      createdAt: '2026-04-15T08:30:00Z',
      label: 'Original',
      data: BASE_BRIEF,
    },
  ],
};

const BASE_EPICS: Epic[] = [
  {
    id: 'epic-1',
    title: 'Authentication & Onboarding',
    domain: 'auth',
    description:
      'All flows for registering, verifying, and onboarding both freelancer and client user types. Includes email/password, Google OAuth, email verification, and role-selection after signup.',
    storyPoints: 34,
    status: 'approved',
  },
  {
    id: 'epic-2',
    title: 'Project Posting & Discovery',
    domain: 'search',
    description:
      'Clients post projects with requirements, budget, and timeline. Freelancers browse and search via full-text and faceted filters. Covers project CRUD, search index, and recommendation engine.',
    storyPoints: 55,
    status: 'pending',
  },
  {
    id: 'epic-3',
    title: 'Payments & Escrow',
    domain: 'billing',
    description:
      'End-to-end payment flow: client funds escrow at project start, milestones release funds, platform fee deducted, freelancer payout to bank. Includes Stripe integration and admin fee config.',
    storyPoints: 89,
    status: 'pending',
  },
  {
    id: 'epic-4',
    title: 'In-App Messaging',
    domain: 'messaging',
    description:
      'Real-time bidirectional messaging between freelancer and client per project. WebSocket-backed with read receipts, unread count badge, and email fallback when recipient is offline.',
    storyPoints: 42,
    status: 'pending',
  },
];

export const MOCK_EPICS: EpicWithHistory[] = BASE_EPICS.map((epic) => ({
  current: epic,
  versions: [
    {
      version: 1,
      createdAt: '2026-04-15T08:30:00Z',
      label: 'Original',
      data: epic,
    },
  ],
}));

const BASE_JOURNEYS: Journey[] = [
  {
    id: 'journey-1',
    epicId: 'epic-1',
    persona: 'New Freelancer',
    title: 'Sign up as a freelancer and complete profile',
    steps: [
      'Visit landing page and click "Join as Freelancer"',
      'Fill in name, email, password',
      'Verify email via link',
      'Select skills, hourly rate, and bio',
      'Upload profile photo',
      'Submit for review',
    ],
    happyPath: 'Freelancer completes registration in under 5 minutes and lands on their dashboard.',
    edgeCasesCount: 4,
    status: 'approved',
  },
  {
    id: 'journey-2',
    epicId: 'epic-1',
    persona: 'Returning User',
    title: 'Log in with Google OAuth and land on dashboard',
    steps: [
      'Click "Continue with Google"',
      'Authenticate with Google',
      'Platform links Google account to existing email',
      'Redirect to role-appropriate dashboard',
    ],
    happyPath: 'Existing user logs in via Google in two clicks.',
    edgeCasesCount: 2,
    status: 'pending',
  },
  {
    id: 'journey-3',
    epicId: 'epic-2',
    persona: 'Client',
    title: 'Post a new project and receive first bids',
    steps: [
      'Navigate to "Post a Project"',
      'Fill in title, description, skills needed, budget range, deadline',
      'Publish project',
      'Project appears in search results',
      'Receive email notification when first bid arrives',
    ],
    happyPath: 'Client posts project in under 10 minutes and receives first bid within 24 hours.',
    edgeCasesCount: 3,
    status: 'pending',
  },
  {
    id: 'journey-4',
    epicId: 'epic-2',
    persona: 'Freelancer',
    title: 'Discover and filter projects by skill match',
    steps: [
      'Open project search page',
      'Apply filters: budget range, skills, project type',
      'Browse paginated results',
      'Open project detail page',
      'Submit a bid',
    ],
    happyPath: 'Freelancer finds relevant projects and submits a bid in under 3 minutes.',
    edgeCasesCount: 2,
    status: 'pending',
  },
  {
    id: 'journey-5',
    epicId: 'epic-3',
    persona: 'Client',
    title: 'Fund escrow and release payment upon milestone completion',
    steps: [
      'Accept a freelancer proposal',
      'Add payment method (Stripe)',
      'Fund escrow for first milestone',
      'Review submitted milestone deliverable',
      'Release funds to freelancer',
    ],
    happyPath: 'Client funds and releases escrow without disputes.',
    edgeCasesCount: 6,
    status: 'pending',
  },
  {
    id: 'journey-6',
    epicId: 'epic-4',
    persona: 'Freelancer',
    title: 'Message client about project requirements before bidding',
    steps: [
      'Open project detail page',
      'Click "Ask a Question"',
      'Send a message to client',
      'Receive notification when client replies',
      'Continue conversation in message thread',
    ],
    happyPath: 'Freelancer and client exchange messages in real-time.',
    edgeCasesCount: 3,
    status: 'pending',
  },
];

export const MOCK_JOURNEYS: JourneyWithHistory[] = BASE_JOURNEYS.map((journey) => ({
  current: journey,
  versions: [
    {
      version: 1,
      createdAt: '2026-04-15T08:30:00Z',
      label: 'Original',
      data: journey,
    },
  ],
}));

const BASE_TASKS: Task[] = [
  {
    id: 'task-1',
    wbsId: 'WBS-001',
    title: 'Implement email/password registration endpoint',
    estimateHours: 8,
    domain: 'auth',
    epicId: 'epic-1',
    journeyId: 'journey-1',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'a visitor submits valid name, email, and password via POST /api/auth/register',
        when: 'the email is not already registered',
        then: 'a new user record is created, a verification email is sent, and the API returns 201 with user ID',
      },
      {
        type: 'functional',
        given: 'a visitor submits an email that already exists',
        when: 'POST /api/auth/register is called',
        then: 'the API returns 409 Conflict with error code EMAIL_EXISTS',
      },
      {
        type: 'non-functional',
        given: 'the auth service is under normal load (< 500 req/s)',
        when: 'POST /api/auth/register is called',
        then: 'the response is returned within 200ms at p99 as measured by load tests',
      },
      {
        type: 'non-functional',
        given: 'a single IP submits more than 10 registration attempts within 10 minutes',
        when: 'the 11th attempt is made',
        then: 'the API returns 429 Too Many Requests and the source IP is blocked for 15 minutes',
      },
      {
        type: 'technical',
        given: 'a new user record is created',
        when: 'the password is persisted',
        then: 'it is hashed with bcrypt at cost factor 12 — plaintext password is never written to the database or logs',
      },
      {
        type: 'technical',
        given: 'the registration endpoint is deployed',
        when: 'the integration test suite runs in CI',
        then: 'all happy-path, duplicate-email, and rate-limit scenarios have test coverage and all pass',
      },
    ],
    dependencies: [],
    status: 'approved',
    assignee: 'Alice Chen',
  },
  {
    id: 'task-2',
    wbsId: 'WBS-002',
    title: 'Build email verification flow',
    estimateHours: 6,
    domain: 'auth',
    epicId: 'epic-1',
    journeyId: 'journey-1',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'a user clicks the verification link in the signup email',
        when: 'the token is valid and not expired',
        then: 'the user account status changes to verified and the user is redirected to the onboarding page',
      },
      {
        type: 'functional',
        given: 'a user clicks an expired verification link',
        when: 'the token is older than 24 hours',
        then: 'the UI shows an error and offers a "Resend verification email" button',
      },
      {
        type: 'non-functional',
        given: 'a verification email is triggered',
        when: 'the email provider queue is healthy',
        then: 'the email is delivered within 60 seconds for 99% of requests',
      },
      {
        type: 'technical',
        given: 'a verification token is generated',
        when: 'it is stored in the database',
        then: 'it is a cryptographically random 32-byte hex string with an indexed expiry timestamp — no sequential or guessable IDs',
      },
    ],
    dependencies: ['WBS-001'],
    status: 'approved',
    assignee: 'Alice Chen',
  },
  {
    id: 'task-3',
    wbsId: 'WBS-003',
    title: 'Integrate Google OAuth login',
    estimateHours: 10,
    domain: 'auth',
    epicId: 'epic-1',
    journeyId: 'journey-2',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'a visitor clicks "Continue with Google"',
        when: 'they complete the Google OAuth consent screen',
        then: 'a session is created and the user is redirected to their role-appropriate dashboard',
      },
      {
        type: 'functional',
        given: 'a Google account email matches an existing email/password account',
        when: 'the user logs in via Google',
        then: 'the accounts are merged and the user sees a one-time toast confirming account linking',
      },
      {
        type: 'non-functional',
        given: 'a user initiates Google OAuth',
        when: 'the OAuth callback completes successfully',
        then: 'the total round-trip (redirect → callback → dashboard) completes within 3 seconds on a standard connection',
      },
      {
        type: 'technical',
        given: 'the Google OAuth credentials are configured',
        when: 'the application starts',
        then: 'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are read from environment variables — they are never hardcoded in source or config files',
      },
    ],
    dependencies: ['WBS-001'],
    status: 'pending',
    assignee: 'Bob Martinez',
  },
  {
    id: 'task-4',
    wbsId: 'WBS-004',
    title: 'Create project posting form and API endpoint',
    estimateHours: 12,
    domain: 'search',
    epicId: 'epic-2',
    journeyId: 'journey-3',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'an authenticated client fills in all required project fields',
        when: 'they submit the project posting form',
        then: 'a new project record is created with status "open" and appears in search results within 30 seconds',
      },
      {
        type: 'functional',
        given: 'a client submits a project with budget below the $5 minimum',
        when: 'the form is submitted',
        then: 'client-side and server-side validation both reject the submission with a specific inline error message',
      },
      {
        type: 'non-functional',
        given: 'the project posting form is submitted',
        when: 'the server processes the request',
        then: 'the API responds within 500ms and the project is indexed for search within 30 seconds',
      },
      {
        type: 'technical',
        given: 'a project is created',
        when: 'the record is persisted',
        then: 'all user-supplied text fields are sanitised to prevent XSS; a database index exists on (status, created_at) for efficient listing queries',
      },
    ],
    dependencies: ['WBS-001'],
    status: 'pending',
    assignee: 'Carol Liu',
  },
  {
    id: 'task-5',
    wbsId: 'WBS-005',
    title: 'Implement full-text project search with filters',
    estimateHours: 16,
    domain: 'search',
    epicId: 'epic-2',
    journeyId: 'journey-4',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'a freelancer types keywords in the search bar and applies skill and budget filters',
        when: 'the search query is executed',
        then: 'results are returned ranked by relevance and paginated at 20 per page',
      },
      {
        type: 'functional',
        given: 'a search query yields no results',
        when: 'the results page renders',
        then: 'an empty state with suggested categories and a "Modify filters" CTA is shown',
      },
      {
        type: 'non-functional',
        given: 'the search index contains up to 10,000 projects',
        when: 'a keyword + filter query is executed',
        then: 'results are returned within 500ms at p95',
      },
      {
        type: 'technical',
        given: 'a new project is created or updated',
        when: 'the write operation completes',
        then: 'the search index is updated asynchronously via a BullMQ job — index updates never block the API response',
      },
    ],
    dependencies: ['WBS-004'],
    status: 'pending',
    assignee: 'Carol Liu',
  },
  {
    id: 'task-6',
    wbsId: 'WBS-006',
    title: 'Stripe escrow: fund milestone on proposal acceptance',
    estimateHours: 14,
    domain: 'billing',
    epicId: 'epic-3',
    journeyId: 'journey-5',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'a client accepts a proposal and has a valid Stripe payment method',
        when: 'they confirm funding the first milestone',
        then: 'a Stripe PaymentIntent is created with manual capture, the escrow record is set to "funded", and the freelancer receives an in-app and email notification',
      },
      {
        type: 'functional',
        given: 'the Stripe charge fails (e.g. insufficient funds)',
        when: 'the payment is attempted',
        then: 'the escrow record stays in "pending" state, the client sees a specific error message, and the proposal remains active for retry',
      },
      {
        type: 'non-functional',
        given: 'a Stripe webhook event is received',
        when: 'the platform processes it',
        then: 'the event is idempotently handled within 5 seconds — duplicate webhook deliveries produce no side effects',
      },
      {
        type: 'technical',
        given: 'all Stripe interactions are implemented',
        when: 'the code is reviewed',
        then: 'the Stripe secret key is read from STRIPE_SECRET_KEY env var; webhook signatures are verified using STRIPE_WEBHOOK_SECRET; no raw card data ever touches the platform servers',
      },
    ],
    dependencies: ['WBS-003', 'WBS-004'],
    status: 'flagged',
    assignee: 'David Kim',
  },
  {
    id: 'task-7',
    wbsId: 'WBS-007',
    title: 'Build real-time WebSocket messaging service',
    estimateHours: 14,
    domain: 'messaging',
    epicId: 'epic-4',
    journeyId: 'journey-6',
    acceptanceCriteria: [
      {
        type: 'functional',
        given: 'a freelancer and client are both viewing the same message thread',
        when: 'one party sends a message',
        then: 'the message appears in the other party\'s thread within 300ms without page refresh',
      },
      {
        type: 'functional',
        given: 'a recipient is offline when a message is sent',
        when: 'the platform detects no active WebSocket connection for that user',
        then: 'an email notification is dispatched within 60 seconds containing the message preview',
      },
      {
        type: 'non-functional',
        given: 'the messaging service has 1,000 concurrent WebSocket connections',
        when: 'messages are being exchanged across all active threads',
        then: 'p99 message delivery latency stays below 300ms and memory usage stays below 512MB per server instance',
      },
      {
        type: 'technical',
        given: 'the WebSocket server is deployed behind a load balancer',
        when: 'a user\'s connection is served by a different node than their conversation partner',
        then: 'messages are still delivered correctly via a Redis pub/sub adapter — no cross-node message loss',
      },
    ],
    dependencies: ['WBS-001'],
    status: 'pending',
    assignee: 'Alice Chen',
  },
];

export const MOCK_TASKS: TaskWithHistory[] = BASE_TASKS.map((task) => ({
  current: task,
  versions: [
    {
      version: 1,
      createdAt: '2026-04-15T08:30:00Z',
      label: 'Original',
      data: task,
    },
  ],
}));

export const MOCK_SYNC_LOG: SyncEntry[] = [
  {
    id: 'log-1',
    timestamp: '2026-04-17T09:02:13Z',
    message: 'Sync initiated for project "Freelancer Marketplace Platform" — 12 tasks queued.',
    level: 'info',
  },
  {
    id: 'log-2',
    timestamp: '2026-04-17T09:02:15Z',
    message: 'WBS-001 → ClickUp task #8675309 created successfully.',
    level: 'success',
  },
  {
    id: 'log-3',
    timestamp: '2026-04-17T09:02:16Z',
    message: 'WBS-002 → ClickUp task #8675310 created successfully.',
    level: 'success',
  },
  {
    id: 'log-4',
    timestamp: '2026-04-17T09:02:17Z',
    message: 'WBS-003 → ClickUp task #8675311 created successfully.',
    level: 'success',
  },
  {
    id: 'log-5',
    timestamp: '2026-04-17T09:02:18Z',
    message: 'WBS-006 flagged: estimate (2h) is below the 4h minimum threshold. Task skipped.',
    level: 'warning',
  },
  {
    id: 'log-6',
    timestamp: '2026-04-17T09:02:19Z',
    message: 'Sync complete. 3 tasks synced, 1 skipped (flagged), 8 pending approval.',
    level: 'info',
  },
];

export const MOCK_ASSIGNEES = ['All', 'Alice Chen', 'Bob Martinez', 'Carol Liu', 'David Kim'];

export const MOCK_PROJECT_DEFINITION: ProjectDefinition = {
  name: 'Freelancer Marketplace Platform',
  client: 'TalentConnect Inc.',
  projectType: 'web_app',
  estimatedBudget: '$120,000',
  startDate: '2026-05-01',
  communicationChannels: ['upwork'],
  channelLinks: { upwork: 'https://www.upwork.com/jobs/~01abc123def456' },
  contactPerson: 'Sarah Johnson',
  rawInput: '',
  attachedFiles: [],
  hasAttachments: false,
  provider: 'anthropic',
};

export const MOCK_USERS: MockUserWithPassword[] = [
  { id: 'user-1', email: 'admin@wbs.io', password: 'admin123', name: 'Admin User', role: 'admin', orgId: 'org-1' },
  { id: 'user-2', email: 'pm@wbs.io', password: 'pm123', name: 'PM User', role: 'pm', orgId: 'org-1' },
];

export const MOCK_PROMPT_CONFIGS: PromptConfig[] = [
  {
    id: 'prompt-1',
    stage: 'brief_extraction',
    label: 'Brief Extraction',
    systemPrompt:
      'You are a senior project analyst at a software agency. Your job is to extract a structured project brief from raw client communication.\n\nExtract:\n- Project title and client name\n- A concise executive summary (2-3 sentences)\n- Open questions the PM must answer before work begins\n- Assumptions being made\n- In-scope and out-of-scope items\n\nBe precise and conservative. Flag anything ambiguous as an open question rather than an assumption.',
    userPromptTemplate:
      'Extract a structured project brief from the following client communication:\n\n{{raw_input}}\n\nReturn valid JSON matching the Brief schema.',
    version: 1,
    updatedAt: '2026-04-15T08:00:00Z',
    updatedBy: 'Admin User',
  },
  {
    id: 'prompt-2',
    stage: 'epic_generation',
    label: 'Epic Generation',
    systemPrompt:
      'You are a technical project manager generating high-level epics from a project brief.\n\nEach epic must:\n- Represent a coherent, independently deliverable scope unit\n- Be tagged with exactly one domain (auth, billing, search, messaging, profile, admin, notifications)\n- Have a story point estimate (Fibonacci: 8, 13, 21, 34, 55, 89)\n- Include a 2-3 sentence description of what it covers and why\n\nGenerate between 3 and 8 epics. Do not create epics smaller than 8 story points.',
    userPromptTemplate:
      'Generate epics for the following project brief:\n\n{{brief_json}}\n\nReturn a JSON array of Epic objects.',
    version: 1,
    updatedAt: '2026-04-15T08:00:00Z',
    updatedBy: 'Admin User',
  },
  {
    id: 'prompt-3',
    stage: 'journey_generation',
    label: 'Journey Generation',
    systemPrompt:
      'You are a UX-aware technical PM generating user journeys for a given epic.\n\nEach journey must:\n- Be tied to a specific user persona (e.g. "New Freelancer", "Client", "Admin")\n- Describe a complete, end-to-end user flow in 4-8 steps\n- Include a happy-path description (one sentence)\n- Note the number of edge cases to handle\n\nGenerate 1-3 journeys per epic. Focus on the most critical flows first.',
    userPromptTemplate:
      'Generate user journeys for the following epic:\n\n{{epic_json}}\n\nContext — full brief:\n{{brief_json}}\n\nReturn a JSON array of Journey objects.',
    version: 1,
    updatedAt: '2026-04-15T08:00:00Z',
    updatedBy: 'Admin User',
  },
  {
    id: 'prompt-4',
    stage: 'task_decomposition',
    label: 'Task Decomposition',
    systemPrompt:
      'You are a senior engineer decomposing a user journey into atomic, developer-ready tasks.\n\nEach task must:\n- Be scoped to 4-16 hours of work (flag if outside this range)\n- Have a unique WBS ID (format: WBS-NNN)\n- Include 3-6 acceptance criteria in Given/When/Then format\n- Each criterion must be typed: "functional", "non-functional", or "technical"\n- List explicit task dependencies by WBS ID\n\nFunctional criteria: what the system does for users.\nNon-functional criteria: performance, security, reliability constraints.\nTechnical criteria: implementation constraints, architectural decisions, CI/test requirements.\n\nNever write vague or untestable acceptance criteria.',
    userPromptTemplate:
      'Decompose the following user journey into atomic tasks:\n\n{{journey_json}}\n\nParent epic:\n{{epic_json}}\n\nExisting tasks (for dependency reference):\n{{existing_tasks_json}}\n\nReturn a JSON array of Task objects.',
    version: 1,
    updatedAt: '2026-04-15T08:00:00Z',
    updatedBy: 'Admin User',
  },
];

export const MOCK_SAVED_PROJECTS: SavedProject[] = [
  {
    id: 'proj-1',
    name: 'Freelancer Marketplace Platform',
    client: 'TalentConnect Inc.',
    createdAt: '2026-04-15T08:30:00Z',
    updatedAt: '2026-04-17T09:02:19Z',
    status: 'synced',
    epicCount: 4,
    taskCount: 7,
    syncedCount: 3,
    provider: 'anthropic',
    definition: MOCK_PROJECT_DEFINITION,
  },
  {
    id: 'proj-2',
    name: 'Internal HR Portal',
    client: 'Acme Corp',
    createdAt: '2026-04-10T11:00:00Z',
    updatedAt: '2026-04-12T15:45:00Z',
    status: 'approved',
    epicCount: 3,
    taskCount: 12,
    syncedCount: 0,
    provider: 'openai',
  },
  {
    id: 'proj-3',
    name: 'E-commerce Checkout Redesign',
    client: 'ShopFast Ltd.',
    createdAt: '2026-04-08T09:15:00Z',
    updatedAt: '2026-04-08T14:20:00Z',
    status: 'in_review',
    epicCount: 2,
    taskCount: 8,
    syncedCount: 0,
    provider: 'anthropic',
  },
  {
    id: 'proj-4',
    name: 'Mobile App MVP',
    client: 'StartupXYZ',
    createdAt: '2026-04-01T10:00:00Z',
    updatedAt: '2026-04-01T10:00:00Z',
    status: 'draft',
    epicCount: 0,
    taskCount: 0,
    syncedCount: 0,
    provider: 'anthropic',
  },
];
