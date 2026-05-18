import { create } from 'zustand';
import {
  MOCK_PROJECT_DEFINITION,
  type Brief,
  type BriefWithHistory,
  type EpicWithHistory,
  type EpicStatus,
  type JourneyWithHistory,
  type JourneyStatus,
  type TaskWithHistory,
  type TaskStatus,
  type QuestionStatus,
  type SavedProject,
  type ProjectDefinition,
  type AttachedFile,
  type Version,
  type Domain,
  type AppUser,
  type PromptConfig,
  type PromptStage,
} from '../data/mockData';
import { api } from '../lib/api';
import { diffEpics, summarizeEpicDiff } from '../lib/epicDiff';
import { diffJourneys, summarizeJourneyDiff } from '../lib/journeyDiff';
import { diffTasks, summarizeTaskDiff } from '../lib/taskDiff';
import { reportClientError } from '../lib/errorReporter';

export type ChatStage = 'epics' | 'journeys' | 'tasks' | 'brief' | 'definition' | 'sync';

export interface EpicChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  timestamp: number;
}
// Backward-compatibility alias — all stages share the same message shape.
export type StageChatMessage = EpicChatMessage;

export interface SyncLogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

export interface RegenState {
  stage: string | null;
  isProcessing: boolean;
  progress: number;
  affectedIds: string[];
  challengeText: string;
  diffSummary: string;
  /** Set when a regen call fails so the UI can render an inline error. Cleared on next attempt. */
  lastError: string | null;
}

/**
 * Cascade-prompt state — set immediately after a brief challenge succeeds when
 * the project already has downstream artifacts. The Brief page renders a
 * confirm dialog from this state offering to regenerate epics → journeys →
 * tasks (with the same challenge text). Cleared by user action.
 */
export interface CascadePromptState {
  open: boolean;
  /** Original challenge text the user submitted on the brief — passed to downstream stages. */
  challengeText: string;
  /** Counts before cascade so the dialog can show "this will replace 7 epics, 22 journeys, 100 tasks". */
  counts: { epics: number; journeys: number; tasks: number };
  /** Currently-running stage during cascade execution; null when idle. */
  runningStage: 'epics' | 'journeys' | 'tasks' | null;
}

interface ProjectState {
  // Active project
  activeProjectId: string | null;
  definition: ProjectDefinition;

  // Pipeline items with version history
  brief: BriefWithHistory;
  epics: EpicWithHistory[];
  journeys: JourneyWithHistory[];
  tasks: TaskWithHistory[];

  // Regen / challenge AI state
  regenState: RegenState;
  cascadePrompt: CascadePromptState;

  // Projects list
  savedProjects: SavedProject[];

  // Loading states
  isLoadingProjects: boolean;
  isLoadingProject: boolean;
  isGenerating: string | null; // stage name

  // Sync
  syncProgress: number;
  syncLog: SyncLogEntry[];

  // Actions — definition
  setDefinitionField: <K extends keyof ProjectDefinition>(key: K, value: ProjectDefinition[K]) => void;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;

  // Actions — brief
  answerQuestion: (id: string, answer: string) => Promise<void>;
  setQuestionStatus: (id: string, status: QuestionStatus) => Promise<void>;
  restoreBriefVersion: (version: number) => Promise<void>;

  // Actions — epics
  setEpicStatus: (id: string, status: EpicStatus) => Promise<void>;
  updateEpic: (id: string, fields: { title?: string; description?: string; storyPoints?: number; domain?: Domain }) => Promise<void>;
  approveAllEpics: () => Promise<void>;
  deleteAllEpics: () => Promise<void>;
  deleteEpic: (epicKey: string) => Promise<void>;
  restoreEpicVersion: (epicKey: string, version: number) => Promise<void>;

  // Actions — journeys
  setJourneyStatus: (id: string, status: JourneyStatus) => Promise<void>;
  updateJourney: (id: string, fields: { title?: string; persona?: string; happyPath?: string; steps?: string[]; edgeCasesCount?: number }) => Promise<void>;
  approveAllJourneys: () => Promise<void>;
  deleteAllJourneys: () => Promise<void>;
  deleteJourney: (journeyKey: string) => Promise<void>;
  restoreJourneyVersion: (journeyKey: string, version: number) => Promise<void>;

  // Actions — tasks
  setTaskStatus: (id: string, status: TaskStatus) => Promise<void>;
  updateTask: (id: string, fields: { title?: string; estimateHours?: number }) => Promise<void>;
  approveAllTasks: () => Promise<void>;
  deleteAllTasks: () => Promise<void>;
  deleteTask: (taskKey: string) => Promise<void>;
  restoreTaskVersion: (taskKey: string, version: number) => Promise<void>;

  // Rewrite single item via prompt
  rewriteItem: (itemType: 'epic' | 'journey' | 'task', itemId: string, prompt: string) => Promise<void>;

  // Challenge AI (re-generate entire stage)
  challengeAI: (stage: string, text: string) => Promise<void>;
  clearRegenState: () => void;

  // Cascade after brief challenge — regenerate epics → journeys → tasks with the
  // same challenge text. Only invoked when user accepts the cascade dialog.
  cascadeRegen: () => Promise<void>;
  dismissCascadePrompt: () => void;

  // Projects API
  loadProjects: () => Promise<void>;
  createProject: (data: Partial<ProjectDefinition>) => Promise<string>;
  loadProject: (id: string) => Promise<void>;
  saveProject: (id: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  addProject: (project: SavedProject) => void;

  // Generate stages
  generateBrief: (id: string, challengeText?: string) => Promise<void>;
  generateEpics: (id: string, challengeText?: string) => Promise<void>;
  generateJourneys: (id: string, challengeText?: string) => Promise<void>;
  generateTasks: (id: string, challengeText?: string) => Promise<void>;

  // Sync
  startSync: (projectId: string) => Promise<void>;
  resetSync: () => void;

  // Auth
  currentUser: AppUser | null;
  authError: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // Prompt configs
  promptConfigs: PromptConfig[];
  loadPromptConfigs: () => Promise<void>;
  updatePromptConfig: (stage: PromptStage, fields: { systemPrompt?: string; userPromptTemplate?: string }) => Promise<void>;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Global notifications — surfaces store-action errors to the UI
  appError: string | null;
  setAppError: (msg: string | null) => void;
  /**
   * Set when loadProject fails (typically 404). ProjectWorkspace renders a
   * "Project Not Found" screen when this is set for the current URL id, so
   * the user doesn't see another project's stale data.
   */
  projectLoadError: { id: string; message: string } | null;
  clearProjectLoadError: () => void;

  // Per-stage chat history — keyed by stage then projectId. Persists to
  // localStorage so conversations survive reloads.
  epicChat: Record<string, EpicChatMessage[]>;
  journeyChat: Record<string, EpicChatMessage[]>;
  taskChat: Record<string, EpicChatMessage[]>;
  briefChat: Record<string, EpicChatMessage[]>;
  definitionChat: Record<string, EpicChatMessage[]>;
  syncChat: Record<string, EpicChatMessage[]>;
  appendEpicChat: (projectId: string, msg: Omit<EpicChatMessage, 'id' | 'timestamp'>) => void;
  clearEpicChat: (projectId: string) => void;
  appendStageChat: (stage: ChatStage, projectId: string, msg: Omit<EpicChatMessage, 'id' | 'timestamp'>) => void;
  clearStageChat: (stage: ChatStage, projectId: string) => void;
  /** Stage-aware agentic chat actions. */
  chatAboutEpics: (message: string) => Promise<void>;
  chatAboutJourneys: (message: string) => Promise<void>;
  chatAboutTasks: (message: string) => Promise<void>;
  chatAboutBrief: (message: string) => Promise<void>;
  chatAboutDefinition: (message: string) => Promise<void>;
  chatAboutSync: (message: string) => Promise<void>;
  /** Append a brand-new item via the AI without touching the existing list. */
  addEpic: (instruction: string) => Promise<void>;
  addJourney: (instruction: string) => Promise<void>;
  addTask: (instruction: string) => Promise<void>;
  isEpicChatPending: boolean;
  isJourneyChatPending: boolean;
  isTaskChatPending: boolean;
  isBriefChatPending: boolean;
  isDefinitionChatPending: boolean;
  isSyncChatPending: boolean;
}

const INITIAL_REGEN_STATE: RegenState = {
  stage: null,
  isProcessing: false,
  progress: 0,
  affectedIds: [],
  challengeText: '',
  diffSummary: '',
  lastError: null,
};

const INITIAL_CASCADE_PROMPT: CascadePromptState = {
  open: false,
  challengeText: '',
  counts: { epics: 0, journeys: 0, tasks: 0 },
  runningStage: null,
};

const EMPTY_BRIEF: BriefWithHistory = {
  current: {
    title: '',
    client: '',
    date: '',
    summary: '',
    openQuestions: [],
    assumptions: [],
    inScope: [],
    outOfScope: [],
  },
  versions: [],
};

function loadStoredUser(): AppUser | null {
  try {
    const raw = localStorage.getItem('wbs_user');
    return raw ? (JSON.parse(raw) as AppUser) : null;
  } catch {
    return null;
  }
}

function loadStoredTheme(): 'dark' | 'light' {
  const stored = localStorage.getItem('wbs_theme');
  const theme = stored === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', theme);
  return theme;
}

const EPIC_CHAT_KEY = 'wbs_epic_chat';
const JOURNEY_CHAT_KEY = 'wbs_journey_chat';
const TASK_CHAT_KEY = 'wbs_task_chat';
const BRIEF_CHAT_KEY = 'wbs_brief_chat';
const DEFINITION_CHAT_KEY = 'wbs_definition_chat';
const SYNC_CHAT_KEY = 'wbs_sync_chat';
const STAGE_KEYS: Record<ChatStage, string> = {
  epics: EPIC_CHAT_KEY,
  journeys: JOURNEY_CHAT_KEY,
  tasks: TASK_CHAT_KEY,
  brief: BRIEF_CHAT_KEY,
  definition: DEFINITION_CHAT_KEY,
  sync: SYNC_CHAT_KEY,
};

function loadStoredChat(storageKey: string): Record<string, EpicChatMessage[]> {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as Record<string, EpicChatMessage[]>) : {};
  } catch {
    return {};
  }
}
const loadStoredEpicChat = () => loadStoredChat(EPIC_CHAT_KEY);

function persistEpicChat(map: Record<string, EpicChatMessage[]>): void {
  persistStageChat('epics', map);
}
function persistStageChat(stage: ChatStage, map: Record<string, EpicChatMessage[]>): void {
  try {
    localStorage.setItem(STAGE_KEYS[stage], JSON.stringify(map));
  } catch { /* quota or private-mode — ignore */ }
}

let epicChatMsgCounter = 0;
function newEpicChatId(): string {
  epicChatMsgCounter += 1;
  return `${Date.now()}-${epicChatMsgCounter}`;
}


export const useProjectStore = create<ProjectState>((set, get) => ({
  activeProjectId: null,
  definition: MOCK_PROJECT_DEFINITION,
  brief: EMPTY_BRIEF,
  epics: [],
  journeys: [],
  tasks: [],
  regenState: INITIAL_REGEN_STATE,
  cascadePrompt: INITIAL_CASCADE_PROMPT,
  savedProjects: [],
  isLoadingProjects: false,
  isLoadingProject: false,
  isGenerating: null,
  syncProgress: 0,
  syncLog: [],
  currentUser: loadStoredUser(),
  authError: null,
  promptConfigs: [],
  theme: loadStoredTheme(),
  epicChat: loadStoredEpicChat(),
  journeyChat: loadStoredChat(JOURNEY_CHAT_KEY),
  taskChat: loadStoredChat(TASK_CHAT_KEY),
  briefChat: loadStoredChat(BRIEF_CHAT_KEY),
  definitionChat: loadStoredChat(DEFINITION_CHAT_KEY),
  syncChat: loadStoredChat(SYNC_CHAT_KEY),
  isEpicChatPending: false,
  isJourneyChatPending: false,
  isTaskChatPending: false,
  isBriefChatPending: false,
  isDefinitionChatPending: false,
  isSyncChatPending: false,

  appendStageChat: (stage, projectId, msg) => {
    const full: EpicChatMessage = { id: newEpicChatId(), timestamp: Date.now(), ...msg };
    set((state) => {
      const sliceForStage = (s: typeof state): Record<string, EpicChatMessage[]> => {
        if (stage === 'epics') return s.epicChat;
        if (stage === 'journeys') return s.journeyChat;
        if (stage === 'tasks') return s.taskChat;
        if (stage === 'brief') return s.briefChat;
        if (stage === 'definition') return s.definitionChat;
        return s.syncChat;
      };
      const slice = sliceForStage(state);
      const next = { ...slice, [projectId]: [...(slice[projectId] ?? []), full] };
      persistStageChat(stage, next);
      if (stage === 'epics') return { epicChat: next };
      if (stage === 'journeys') return { journeyChat: next };
      if (stage === 'tasks') return { taskChat: next };
      if (stage === 'brief') return { briefChat: next };
      if (stage === 'definition') return { definitionChat: next };
      return { syncChat: next };
    });
  },

  clearStageChat: (stage, projectId) => {
    set((state) => {
      const sliceForStage = (s: typeof state): Record<string, EpicChatMessage[]> => {
        if (stage === 'epics') return s.epicChat;
        if (stage === 'journeys') return s.journeyChat;
        if (stage === 'tasks') return s.taskChat;
        if (stage === 'brief') return s.briefChat;
        if (stage === 'definition') return s.definitionChat;
        return s.syncChat;
      };
      const slice = sliceForStage(state);
      const next = { ...slice };
      delete next[projectId];
      persistStageChat(stage, next);
      if (stage === 'epics') return { epicChat: next };
      if (stage === 'journeys') return { journeyChat: next };
      if (stage === 'tasks') return { taskChat: next };
      if (stage === 'brief') return { briefChat: next };
      if (stage === 'definition') return { definitionChat: next };
      return { syncChat: next };
    });
  },

  chatAboutEpics: async (message) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    get().appendEpicChat(pid, { role: 'user', text: trimmed });

    set({ isEpicChatPending: true });
    let regenAll: string | undefined;
    let rewriteOne: { epicId: string; epicTitle: string; instruction: string } | undefined;
    let addOne: { instruction: string } | undefined;
    let removeOne: { epicId: string; epicTitle: string } | undefined;
    try {
      const history = (get().epicChat[pid] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api.post<{
        reply: string;
        regenerate?: string;
        rewriteOne?: { epicId: string; epicTitle: string; instruction: string };
        addOne?: { instruction: string };
        removeOne?: { epicId: string; epicTitle: string };
      }>(`/projects/${pid}/epics/chat`, { message: trimmed, history });
      get().appendEpicChat(pid, { role: 'agent', text: res.reply });
      regenAll = res.regenerate;
      rewriteOne = res.rewriteOne;
      addOne = res.addOne;
      removeOne = res.removeOne;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat reply failed.';
      get().appendEpicChat(pid, { role: 'agent', text: `(Couldn't fetch a reply: ${msg})` });
    } finally {
      set({ isEpicChatPending: false });
    }

    // Dispatch the chosen action. Each branch pushes its own follow-up
    // messages so the chat history reads naturally.
    if (rewriteOne) {
      try {
        await get().rewriteItem('epic', rewriteOne.epicId, rewriteOne.instruction);
      } catch {
        get().appendEpicChat(pid, { role: 'agent', text: `(Couldn't rewrite "${rewriteOne.epicTitle}" — see error in the page header.)` });
      }
      return;
    }

    if (addOne) {
      try {
        await get().addEpic(addOne.instruction);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendEpicChat(pid, { role: 'agent', text: `(Couldn't add the new epic: ${msg})` });
      }
      return;
    }

    if (removeOne) {
      try {
        await get().deleteEpic(removeOne.epicId);
        get().appendEpicChat(pid, { role: 'agent', text: `Removed "${removeOne.epicTitle}". The other epics are unchanged.` });
      } catch {
        get().appendEpicChat(pid, { role: 'agent', text: `(Couldn't remove "${removeOne.epicTitle}" — see error in the page header.)` });
      }
      return;
    }

    if (regenAll) {
      try {
        await get().challengeAI('epics', regenAll);
      } catch {
        /* challengeAI surfaces its own error via regenState.lastError */
      }
    }
  },

  addEpic: async (instruction) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project — cannot add epic.');
    const res = await api.post<EpicWithHistory>(`/projects/${pid}/epics/add`, { instruction });
    set((state) => ({ epics: [...state.epics, res] }));
    get().appendEpicChat(pid, {
      role: 'agent',
      text: `Added a new epic "${res.current.title}" (${res.current.domain}, ${res.current.storyPoints} pts). The other epics are unchanged.`,
    });
  },

  // ─── Journeys chat ────────────────────────────────────────────────────────

  chatAboutJourneys: async (message) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    get().appendStageChat('journeys', pid, { role: 'user', text: trimmed });
    set({ isJourneyChatPending: true });
    let regenAll: string | undefined;
    let rewriteOne: { itemId: string; itemTitle: string; instruction: string } | undefined;
    let addOne: { instruction: string } | undefined;
    let removeOne: { itemId: string; itemTitle: string } | undefined;
    try {
      const history = (get().journeyChat[pid] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api.post<{
        reply: string;
        regenerate?: string;
        rewriteOne?: { itemId: string; itemTitle: string; instruction: string };
        addOne?: { instruction: string };
        removeOne?: { itemId: string; itemTitle: string };
      }>(`/projects/${pid}/journeys/chat`, { message: trimmed, history });
      get().appendStageChat('journeys', pid, { role: 'agent', text: res.reply });
      regenAll = res.regenerate;
      rewriteOne = res.rewriteOne;
      addOne = res.addOne;
      removeOne = res.removeOne;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat reply failed.';
      get().appendStageChat('journeys', pid, { role: 'agent', text: `(Couldn't fetch a reply: ${msg})` });
    } finally {
      set({ isJourneyChatPending: false });
    }

    if (rewriteOne) {
      try {
        const before = get().journeys.find((j) => j.current.id === rewriteOne!.itemId)?.current;
        await get().rewriteItem('journey', rewriteOne.itemId, rewriteOne.instruction);
        const after = get().journeys.find((j) => j.current.id === rewriteOne!.itemId)?.current;
        if (before && after) {
          const diff = diffJourneys([before], [after]);
          get().appendStageChat('journeys', pid, { role: 'agent', text: summarizeJourneyDiff(diff) });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('journeys', pid, { role: 'agent', text: `(Couldn't rewrite "${rewriteOne.itemTitle}": ${msg})` });
      }
      return;
    }
    if (addOne) {
      try { await get().addJourney(addOne.instruction); }
      catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('journeys', pid, { role: 'agent', text: `(Couldn't add the new journey: ${msg})` });
      }
      return;
    }
    if (removeOne) {
      try {
        await get().deleteJourney(removeOne.itemId);
        get().appendStageChat('journeys', pid, { role: 'agent', text: `Removed "${removeOne.itemTitle}". The other journeys are unchanged.` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('journeys', pid, { role: 'agent', text: `(Couldn't remove "${removeOne.itemTitle}": ${msg})` });
      }
      return;
    }
    if (regenAll) {
      const before = get().journeys.map((j) => j.current);
      try {
        await get().generateJourneys(pid, regenAll);
        const after = get().journeys.map((j) => j.current);
        const diff = diffJourneys(before, after);
        get().appendStageChat('journeys', pid, { role: 'agent', text: summarizeJourneyDiff(diff) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('journeys', pid, { role: 'agent', text: `Regeneration failed: ${msg}` });
      }
    }
  },

  addJourney: async (instruction) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project — cannot add journey.');
    const res = await api.post<JourneyWithHistory>(`/projects/${pid}/journeys/add`, { instruction });
    set((state) => ({ journeys: [...state.journeys, res] }));
    get().appendStageChat('journeys', pid, {
      role: 'agent',
      text: `Added a new journey "${res.current.title}" (persona: ${res.current.persona}). The other journeys are unchanged.`,
    });
  },

  // ─── Tasks chat ────────────────────────────────────────────────────────────

  chatAboutTasks: async (message) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const trimmed = message.trim();
    if (!trimmed) return;

    get().appendStageChat('tasks', pid, { role: 'user', text: trimmed });
    set({ isTaskChatPending: true });
    let regenAll: string | undefined;
    let rewriteOne: { itemId: string; itemTitle: string; instruction: string } | undefined;
    let addOne: { instruction: string } | undefined;
    let removeOne: { itemId: string; itemTitle: string } | undefined;
    try {
      const history = (get().taskChat[pid] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api.post<{
        reply: string;
        regenerate?: string;
        rewriteOne?: { itemId: string; itemTitle: string; instruction: string };
        addOne?: { instruction: string };
        removeOne?: { itemId: string; itemTitle: string };
      }>(`/projects/${pid}/tasks/chat`, { message: trimmed, history });
      get().appendStageChat('tasks', pid, { role: 'agent', text: res.reply });
      regenAll = res.regenerate;
      rewriteOne = res.rewriteOne;
      addOne = res.addOne;
      removeOne = res.removeOne;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat reply failed.';
      get().appendStageChat('tasks', pid, { role: 'agent', text: `(Couldn't fetch a reply: ${msg})` });
    } finally {
      set({ isTaskChatPending: false });
    }

    if (rewriteOne) {
      try {
        const before = get().tasks.find((t) => t.current.id === rewriteOne!.itemId)?.current;
        await get().rewriteItem('task', rewriteOne.itemId, rewriteOne.instruction);
        const after = get().tasks.find((t) => t.current.id === rewriteOne!.itemId)?.current;
        if (before && after) {
          const diff = diffTasks([before], [after]);
          get().appendStageChat('tasks', pid, { role: 'agent', text: summarizeTaskDiff(diff) });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('tasks', pid, { role: 'agent', text: `(Couldn't rewrite "${rewriteOne.itemTitle}": ${msg})` });
      }
      return;
    }
    if (addOne) {
      try { await get().addTask(addOne.instruction); }
      catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('tasks', pid, { role: 'agent', text: `(Couldn't add the new task: ${msg})` });
      }
      return;
    }
    if (removeOne) {
      try {
        await get().deleteTask(removeOne.itemId);
        get().appendStageChat('tasks', pid, { role: 'agent', text: `Removed "${removeOne.itemTitle}". The other tasks are unchanged.` });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('tasks', pid, { role: 'agent', text: `(Couldn't remove "${removeOne.itemTitle}": ${msg})` });
      }
      return;
    }
    if (regenAll) {
      const before = get().tasks.map((t) => t.current);
      try {
        await get().generateTasks(pid, regenAll);
        const after = get().tasks.map((t) => t.current);
        const diff = diffTasks(before, after);
        get().appendStageChat('tasks', pid, { role: 'agent', text: summarizeTaskDiff(diff) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('tasks', pid, { role: 'agent', text: `Regeneration failed: ${msg}` });
      }
    }
  },

  addTask: async (instruction) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project — cannot add task.');
    const res = await api.post<TaskWithHistory>(`/projects/${pid}/tasks/add`, { instruction });
    set((state) => ({ tasks: [...state.tasks, res] }));
    get().appendStageChat('tasks', pid, {
      role: 'agent',
      text: `Added a new task "${res.current.title}" (${res.current.estimateHours}h). The other tasks are unchanged.`,
    });
  },

  // ─── Brief chat ────────────────────────────────────────────────────────────

  chatAboutBrief: async (message) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    get().appendStageChat('brief', pid, { role: 'user', text: trimmed });
    set({ isBriefChatPending: true });
    let regenAll: string | undefined;
    try {
      const history = (get().briefChat[pid] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api.post<{ reply: string; regenerate?: string }>(`/projects/${pid}/brief/chat`, { message: trimmed, history });
      get().appendStageChat('brief', pid, { role: 'agent', text: res.reply });
      regenAll = res.regenerate;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat reply failed.';
      get().appendStageChat('brief', pid, { role: 'agent', text: `(Couldn't fetch a reply: ${msg})` });
    } finally {
      set({ isBriefChatPending: false });
    }
    if (regenAll) {
      try {
        await get().generateBrief(pid, regenAll);
        get().appendStageChat('brief', pid, {
          role: 'agent',
          text: 'Brief regenerated. Review the new summary, assumptions, and open questions.',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error';
        get().appendStageChat('brief', pid, { role: 'agent', text: `Brief regeneration failed: ${msg}` });
      }
    }
  },

  // ─── Definition chat ──────────────────────────────────────────────────────
  // No mutations — agent advises on the form but the user owns the inputs.

  chatAboutDefinition: async (message) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    get().appendStageChat('definition', pid, { role: 'user', text: trimmed });
    set({ isDefinitionChatPending: true });
    try {
      const history = (get().definitionChat[pid] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api.post<{ reply: string }>(`/projects/${pid}/definition/chat`, { message: trimmed, history });
      get().appendStageChat('definition', pid, { role: 'agent', text: res.reply });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat reply failed.';
      get().appendStageChat('definition', pid, { role: 'agent', text: `(Couldn't fetch a reply: ${msg})` });
    } finally {
      set({ isDefinitionChatPending: false });
    }
  },

  // ─── Sync chat ─────────────────────────────────────────────────────────────
  // Discussion-only — actual sync still triggered by the Sync button on the page.

  chatAboutSync: async (message) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const trimmed = message.trim();
    if (!trimmed) return;
    get().appendStageChat('sync', pid, { role: 'user', text: trimmed });
    set({ isSyncChatPending: true });
    try {
      const history = (get().syncChat[pid] ?? []).slice(-8).map((m) => ({ role: m.role, text: m.text }));
      const res = await api.post<{ reply: string }>(`/projects/${pid}/sync/chat`, { message: trimmed, history });
      get().appendStageChat('sync', pid, { role: 'agent', text: res.reply });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Chat reply failed.';
      get().appendStageChat('sync', pid, { role: 'agent', text: `(Couldn't fetch a reply: ${msg})` });
    } finally {
      set({ isSyncChatPending: false });
    }
  },

  appendEpicChat: (projectId, msg) => {
    const full: EpicChatMessage = { id: newEpicChatId(), timestamp: Date.now(), ...msg };
    set((state) => {
      const next = { ...state.epicChat, [projectId]: [...(state.epicChat[projectId] ?? []), full] };
      persistEpicChat(next);
      return { epicChat: next };
    });
  },

  clearEpicChat: (projectId) => {
    set((state) => {
      const next = { ...state.epicChat };
      delete next[projectId];
      persistEpicChat(next);
      return { epicChat: next };
    });
  },

  // ─── Definition ───────────────────────────────────────────────────────────

  setDefinitionField: (key, value) =>
    set((state) => ({ definition: { ...state.definition, [key]: value } })),

  addFiles: (files) =>
    set((state) => {
      const next: AttachedFile[] = files.map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
        name: f.name,
        size: f.size,
        type: f.type,
        previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      }));
      const existing = new Set(state.definition.attachedFiles.map((a) => `${a.name}-${a.size}`));
      const filtered = next.filter((f) => !existing.has(`${f.name}-${f.size}`));
      return {
        definition: {
          ...state.definition,
          attachedFiles: [...state.definition.attachedFiles, ...filtered],
        },
      };
    }),

  removeFile: (id) =>
    set((state) => {
      const file = state.definition.attachedFiles.find((f) => f.id === id);
      if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
      return {
        definition: {
          ...state.definition,
          attachedFiles: state.definition.attachedFiles.filter((f) => f.id !== id),
        },
      };
    }),

  // ─── Brief mutations ───────────────────────────────────────────────────────

  answerQuestion: async (id, answer) => {
    // Optimistic update
    set((state) => ({
      brief: {
        ...state.brief,
        current: {
          ...state.brief.current,
          openQuestions: state.brief.current.openQuestions.map((q) =>
            q.id === id ? { ...q, answer, status: 'answered' as QuestionStatus } : q,
          ),
        },
      },
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.post<{ current: Brief; versions: Version<Brief>[] }>(
        `/projects/${pid}/brief/questions/${id}/answer`,
        { answer, status: 'answered' },
      );
      set({ brief: res });
    } catch (err) {
      console.error('answerQuestion failed:', err);
      // Keep optimistic state — best effort
    }
  },

  setQuestionStatus: async (id, status) => {
    set((state) => ({
      brief: {
        ...state.brief,
        current: {
          ...state.brief.current,
          openQuestions: state.brief.current.openQuestions.map((q) =>
            q.id === id ? { ...q, status } : q,
          ),
        },
      },
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.post<{ current: Brief; versions: Version<Brief>[] }>(
        `/projects/${pid}/brief/questions/${id}/answer`,
        { status },
      );
      set({ brief: res });
    } catch (err) {
      console.error('setQuestionStatus failed:', err);
    }
  },

  restoreBriefVersion: async (version) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const res = await api.post<{ current: Brief; versions: Version<Brief>[] }>(
      `/projects/${pid}/brief/restore/${version}`,
    );
    set({ brief: res });
  },

  // ─── Epic mutations ────────────────────────────────────────────────────────

  setEpicStatus: async (id, status) => {
    // Optimistic
    set((state) => ({
      epics: state.epics.map((e) =>
        e.current.id === id ? { ...e, current: { ...e.current, status } } : e,
      ),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.patch<EpicWithHistory>(`/projects/${pid}/epics/${id}`, { status });
      set((state) => ({
        epics: state.epics.map((e) => (e.current.id === id ? res : e)),
      }));
    } catch {
      // Keep optimistic
    }
  },

  updateEpic: async (id, fields) => {
    set((state) => ({
      epics: state.epics.map((e) =>
        e.current.id === id ? { ...e, current: { ...e.current, ...fields } } : e,
      ),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.patch<EpicWithHistory>(`/projects/${pid}/epics/${id}`, fields);
      set((state) => ({
        epics: state.epics.map((e) => (e.current.id === id ? res : e)),
      }));
    } catch {
      // Keep optimistic
    }
  },

  approveAllEpics: async () => {
    set((state) => ({
      epics: state.epics.map((e) => ({
        ...e,
        current: { ...e.current, status: 'approved' as EpicStatus },
      })),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    const epics = get().epics;
    await Promise.allSettled(
      epics.map((e) =>
        api.patch(`/projects/${pid}/epics/${e.current.id}`, { status: 'approved' }),
      ),
    );
  },

  deleteAllEpics: async () => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project.');
    await api.del(`/projects/${pid}/epics`);
    // Cascade reflects the backend behaviour: deleting epics also wipes journeys + tasks.
    set({ epics: [], journeys: [], tasks: [] });
    // Refresh savedProjects so the sidebar's Sync green-check (which keys off project.status='synced') resets.
    await get().loadProjects();
  },

  deleteEpic: async (epicKey) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project.');
    await api.del(`/projects/${pid}/epics/${epicKey}`);
    // Cascade in-memory: drop the epic AND any journeys / tasks under it.
    // Backend already cascaded — we're just keeping the UI in sync.
    set((state) => {
      const epicId = epicKey; // epic_key === epic.current.id (the UUID)
      const journeysOfEpic = state.journeys.filter((j) => j.current.epicId === epicId).map((j) => j.current.id);
      return {
        epics:    state.epics.filter((e) => e.current.id !== epicId),
        journeys: state.journeys.filter((j) => j.current.epicId !== epicId),
        tasks:    state.tasks.filter((t) => t.current.epicId !== epicId && !journeysOfEpic.includes(t.current.journeyId)),
      };
    });
    await get().loadProjects();
  },

  restoreEpicVersion: async (epicKey, version) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const res = await api.post<EpicWithHistory>(
      `/projects/${pid}/epics/${epicKey}/restore/${version}`,
    );
    set((state) => ({
      epics: state.epics.map((e) => (e.current.id === epicKey ? res : e)),
    }));
  },

  // ─── Journey mutations ─────────────────────────────────────────────────────

  setJourneyStatus: async (id, status) => {
    set((state) => ({
      journeys: state.journeys.map((j) =>
        j.current.id === id ? { ...j, current: { ...j.current, status } } : j,
      ),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.patch<JourneyWithHistory>(`/projects/${pid}/journeys/${id}`, { status });
      set((state) => ({
        journeys: state.journeys.map((j) => (j.current.id === id ? res : j)),
      }));
    } catch {
      // Keep optimistic
    }
  },

  updateJourney: async (id, fields) => {
    set((state) => ({
      journeys: state.journeys.map((j) =>
        j.current.id === id ? { ...j, current: { ...j.current, ...fields } } : j,
      ),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.patch<JourneyWithHistory>(`/projects/${pid}/journeys/${id}`, fields);
      set((state) => ({
        journeys: state.journeys.map((j) => (j.current.id === id ? res : j)),
      }));
    } catch {
      // Keep optimistic
    }
  },

  approveAllJourneys: async () => {
    set((state) => ({
      journeys: state.journeys.map((j) => ({
        ...j,
        current: { ...j.current, status: 'approved' as JourneyStatus },
      })),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    const journeys = get().journeys;
    await Promise.allSettled(
      journeys.map((j) =>
        api.patch(`/projects/${pid}/journeys/${j.current.id}`, { status: 'approved' }),
      ),
    );
  },

  deleteAllJourneys: async () => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project.');
    await api.del(`/projects/${pid}/journeys`);
    // Cascade: deleting journeys also wipes tasks (tasks reference journeys).
    set({ journeys: [], tasks: [] });
    await get().loadProjects();
  },

  deleteJourney: async (journeyKey) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project.');
    await api.del(`/projects/${pid}/journeys/${journeyKey}`);
    // Cascade in-memory: drop the journey AND any tasks under it.
    set((state) => {
      const journeyId = journeyKey;
      return {
        journeys: state.journeys.filter((j) => j.current.id !== journeyId),
        tasks:    state.tasks.filter((t) => t.current.journeyId !== journeyId),
      };
    });
    await get().loadProjects();
  },

  restoreJourneyVersion: async (journeyKey, version) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const res = await api.post<JourneyWithHistory>(
      `/projects/${pid}/journeys/${journeyKey}/restore/${version}`,
    );
    set((state) => ({
      journeys: state.journeys.map((j) => (j.current.id === journeyKey ? res : j)),
    }));
  },

  // ─── Task mutations ────────────────────────────────────────────────────────

  setTaskStatus: async (id, status) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.current.id === id ? { ...t, current: { ...t.current, status } } : t,
      ),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.patch<TaskWithHistory>(`/projects/${pid}/tasks/${id}`, { status });
      set((state) => ({
        tasks: state.tasks.map((t) => (t.current.id === id ? res : t)),
      }));
    } catch {
      // Keep optimistic
    }
  },

  updateTask: async (id, fields) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.current.id === id ? { ...t, current: { ...t.current, ...fields } } : t,
      ),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    try {
      const res = await api.patch<TaskWithHistory>(`/projects/${pid}/tasks/${id}`, fields);
      set((state) => ({
        tasks: state.tasks.map((t) => (t.current.id === id ? res : t)),
      }));
    } catch {
      // Keep optimistic
    }
  },

  approveAllTasks: async () => {
    set((state) => ({
      tasks: state.tasks.map((t) => ({
        ...t,
        // Skip flagged tasks — those need fixing first.
        current: t.current.status === 'flagged'
          ? t.current
          : { ...t.current, status: 'approved' as TaskStatus },
      })),
    }));

    const pid = get().activeProjectId;
    if (!pid) return;

    const tasks = get().tasks.filter((t) => t.current.status !== 'flagged');
    await Promise.allSettled(
      tasks.map((t) =>
        api.patch(`/projects/${pid}/tasks/${t.current.id}`, { status: 'approved' }),
      ),
    );
  },

  deleteAllTasks: async () => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project.');
    await api.del(`/projects/${pid}/tasks`);
    set({ tasks: [] });
    await get().loadProjects();
  },

  deleteTask: async (taskKey) => {
    const pid = get().activeProjectId;
    if (!pid) throw new Error('No active project.');
    await api.del(`/projects/${pid}/tasks/${taskKey}`);
    set((state) => ({ tasks: state.tasks.filter((t) => t.current.id !== taskKey) }));
    await get().loadProjects();
  },

  restoreTaskVersion: async (taskKey, version) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    const res = await api.post<TaskWithHistory>(
      `/projects/${pid}/tasks/${taskKey}/restore/${version}`,
    );
    set((state) => ({
      tasks: state.tasks.map((t) => (t.current.id === taskKey ? res : t)),
    }));
  },

  // ─── Rewrite single item ───────────────────────────────────────────────────

  rewriteItem: async (itemType, itemId, prompt) => {
    const pid = get().activeProjectId;
    if (!pid) {
      throw new Error('No active project — cannot rewrite.');
    }

    const stageFor: Record<typeof itemType, string> = { epic: 'epics', journey: 'journeys', task: 'tasks' };

    try {
      if (itemType === 'epic') {
        const before = get().epics.find((e) => e.current.id === itemId)?.current;
        const res = await api.post<EpicWithHistory>(
          `/projects/${pid}/epics/${itemId}/rewrite`,
          { instruction: prompt },
        );
        set((state) => ({
          epics: state.epics.map((e) => (e.current.id === itemId ? res : e)),
        }));
        // Push to the per-project epic chat: user prompt + agent diff note.
        if (before) {
          get().appendEpicChat(pid, { role: 'user', text: `Rewrite "${before.title}": ${prompt}` });
          const diff = diffEpics([before], [res.current]);
          const note = summarizeEpicDiff(diff);
          get().appendEpicChat(pid, { role: 'agent', text: note });
        }
      } else if (itemType === 'journey') {
        const res = await api.post<JourneyWithHistory>(
          `/projects/${pid}/journeys/${itemId}/rewrite`,
          { instruction: prompt },
        );
        set((state) => ({
          journeys: state.journeys.map((j) => (j.current.id === itemId ? res : j)),
        }));
      } else if (itemType === 'task') {
        const res = await api.post<TaskWithHistory>(
          `/projects/${pid}/tasks/${itemId}/rewrite`,
          { instruction: prompt },
        );
        set((state) => ({
          tasks: state.tasks.map((t) => (t.current.id === itemId ? res : t)),
        }));
      }

      // Flag this single item as "affected" so VersionDropdown shows the
      // "Updated" pulse on it. Auto-clears after 8s so it doesn't stick.
      set((state) => ({
        regenState: {
          ...state.regenState,
          stage: stageFor[itemType],
          affectedIds: [itemId],
          diffSummary: `${itemType.charAt(0).toUpperCase()}${itemType.slice(1)} rewritten`,
        },
      }));
      setTimeout(() => {
        const cur = get().regenState;
        if (cur.affectedIds.includes(itemId)) {
          set((state) => ({
            regenState: {
              ...state.regenState,
              affectedIds: state.regenState.affectedIds.filter((id) => id !== itemId),
            },
          }));
        }
      }, 8000);
    } catch (err) {
      console.error('rewriteItem failed:', err);
      // Re-throw so the calling detail panel can show error UI to the user.
      throw err;
    }
  },

  // ─── Challenge AI (full stage regeneration) ────────────────────────────────

  challengeAI: async (stage, text) => {
    const pid = get().activeProjectId;
    if (!pid) {
      throw new Error('No active project — open a project before regenerating.');
    }

    set({
      regenState: {
        stage,
        isProcessing: true,
        progress: 10,
        challengeText: text,
        affectedIds: [],
        diffSummary: '',
        lastError: null,
      },
    });

    // Fake progress ticks while API call runs
    const tick = setInterval(() => {
      set((state) => {
        if (state.regenState.progress >= 85) { clearInterval(tick); return state; }
        return { regenState: { ...state.regenState, progress: state.regenState.progress + 8 } };
      });
    }, 200);

    // Snapshot the IDs that existed BEFORE regeneration so we can compute
    // which ones are "new or changed" when the new data arrives.
    const beforeIds = (() => {
      switch (stage) {
        case 'epics':    return new Set(get().epics.map((e) => e.current.id));
        case 'journeys': return new Set(get().journeys.map((j) => j.current.id));
        case 'tasks':    return new Set(get().tasks.map((t) => t.current.id));
        default:         return new Set<string>();
      }
    })();
    // Full snapshot used by the Epics chat history to produce a content-level diff.
    const epicsBefore = stage === 'epics' ? get().epics.map((e) => e.current) : [];

    try {
      if (stage === 'brief') {
        await get().generateBrief(pid, text);
        // Brief is a single document — flag its newest version's affectedIds slot
        // with a sentinel so the UI can surface "Updated" on the brief itself if needed.
        set((state) => ({
          regenState: { ...state.regenState, affectedIds: ['brief'], diffSummary: 'Brief regenerated' },
        }));
        // If downstream stages exist, offer to cascade-regenerate them so they
        // reflect the new brief content. Without this, the brief drifts out of
        // sync with epics/journeys/tasks until the user manually regens each.
        const epicsCount = get().epics.length;
        const journeysCount = get().journeys.length;
        const tasksCount = get().tasks.length;
        if (epicsCount + journeysCount + tasksCount > 0) {
          set({
            cascadePrompt: {
              open: true,
              challengeText: text,
              counts: { epics: epicsCount, journeys: journeysCount, tasks: tasksCount },
              runningStage: null,
            },
          });
        }
      } else if (stage === 'epics') {
        await get().generateEpics(pid, text);
        const after = get().epics;
        const affected = after.map((e) => e.current.id).filter((id) => !beforeIds.has(id));
        set((state) => ({
          regenState: {
            ...state.regenState,
            affectedIds: affected,
            diffSummary: `${after.length} epic${after.length !== 1 ? 's' : ''} regenerated`,
          },
        }));
        // Push user instruction + agent diff note to the Epics chat.
        get().appendEpicChat(pid, { role: 'user', text });
        const diff = diffEpics(epicsBefore, after.map((e) => e.current));
        get().appendEpicChat(pid, { role: 'agent', text: summarizeEpicDiff(diff) });
      } else if (stage === 'journeys') {
        await get().generateJourneys(pid, text);
        const after = get().journeys;
        const affected = after.map((j) => j.current.id).filter((id) => !beforeIds.has(id));
        set((state) => ({
          regenState: {
            ...state.regenState,
            affectedIds: affected,
            diffSummary: `${after.length} journey${after.length !== 1 ? 's' : ''} regenerated`,
          },
        }));
      } else if (stage === 'tasks') {
        await get().generateTasks(pid, text);
        const after = get().tasks;
        const affected = after.map((t) => t.current.id).filter((id) => !beforeIds.has(id));
        set((state) => ({
          regenState: {
            ...state.regenState,
            affectedIds: affected,
            diffSummary: `${after.length} task${after.length !== 1 ? 's' : ''} regenerated`,
          },
        }));
      }
    } catch (err) {
      console.error('challengeAI failed:', err);
      const msg = err instanceof Error ? err.message : 'AI regeneration failed.';
      set((state) => ({
        regenState: { ...state.regenState, lastError: msg, diffSummary: '' },
      }));
      reportClientError({ module: 'store.challengeAI', message: msg, err, context: { projectId: pid, stage, text } });
      // Surface the failure inline in the Epics chat so the user sees
      // a real explanation instead of a stale "no changes detected" message
      // from a diff that never had new data to compare.
      if (stage === 'epics') {
        get().appendEpicChat(pid, {
          role: 'agent',
          text: `Regeneration failed: ${msg}\n\nThe epic list was not changed. You can try again with a more specific instruction, or check Admin → Integrations if the AI provider is misconfigured.`,
        });
      }
      // Re-throw so the caller (ChallengeBar) can display its own UI feedback.
      throw err;
    } finally {
      clearInterval(tick);
      set((state) => ({
        regenState: { ...state.regenState, isProcessing: false, progress: 100 },
      }));

      // Auto-clear affectedIds after the pulse animation has had time to play.
      // Without this the badge would stay on forever until the next regen.
      setTimeout(() => {
        const current = get().regenState;
        if (current.stage === stage && !current.isProcessing) {
          set((state) => ({ regenState: { ...state.regenState, affectedIds: [] } }));
        }
      }, 8000);
    }
  },

  clearRegenState: () => set({ regenState: INITIAL_REGEN_STATE }),

  dismissCascadePrompt: () => set({ cascadePrompt: INITIAL_CASCADE_PROMPT }),

  cascadeRegen: async () => {
    const pid = get().activeProjectId;
    const { challengeText } = get().cascadePrompt;
    if (!pid) {
      set({ appError: 'No active project — cannot cascade regenerate.' });
      return;
    }

    // Sequential, not parallel — each stage depends on the previous one's
    // output. We update runningStage as we go so the dialog shows progress.
    //
    // generate* actions swallow errors and set appError internally rather than
    // throwing. So `await` returns "success" even when the stage actually
    // failed. We detect failure by snapshotting appError before each stage
    // and aborting if a new error message appears after the call.
    const errorBefore = get().appError;
    const stages = [
      { name: 'epics' as const, fn: () => get().generateEpics(pid, challengeText) },
      { name: 'journeys' as const, fn: () => get().generateJourneys(pid, challengeText) },
      { name: 'tasks' as const, fn: () => get().generateTasks(pid, challengeText) },
    ];

    for (const stage of stages) {
      set((s) => ({ cascadePrompt: { ...s.cascadePrompt, runningStage: stage.name } }));
      const errorBeforeStage = get().appError;
      try {
        await stage.fn();
      } catch (err) {
        // Belt-and-braces — a future generate* may legitimately throw.
        const msg = err instanceof Error ? err.message : `${stage.name} generation threw.`;
        set({
          appError: `Cascade failed at "${stage.name}" stage: ${msg}`,
          cascadePrompt: INITIAL_CASCADE_PROMPT,
        });
        return;
      }
      // The generate* action set appError silently — abort the cascade so the
      // user sees a clear "stopped at X" error rather than three identical
      // errors flickering as each subsequent stage also fails.
      const errorAfterStage = get().appError;
      if (errorAfterStage && errorAfterStage !== errorBeforeStage) {
        set({
          appError: `Cascade stopped at "${stage.name}" stage. ${errorAfterStage}`,
          cascadePrompt: INITIAL_CASCADE_PROMPT,
        });
        // Even on partial-success failure, refresh the project list so any
        // stages that DID complete show their new counts.
        await get().loadProjects();
        return;
      }
    }

    // All three stages completed cleanly — clear the dialog and any pre-existing
    // error message that's now stale.
    set({
      cascadePrompt: INITIAL_CASCADE_PROMPT,
      appError: errorBefore && get().appError === errorBefore ? errorBefore : null,
    });

    // Refresh savedProjects so the project list / sidebar card counts reflect
    // the new state. Without this, the list page would keep showing the
    // pre-cascade epicCount/taskCount/syncedCount until the next manual reload.
    // Mirrors the same refresh pattern used after sync completes.
    await get().loadProjects();
  },

  // ─── Projects API ──────────────────────────────────────────────────────────

  loadProjects: async () => {
    set({ isLoadingProjects: true });
    try {
      const projects = await api.get<SavedProject[]>('/projects');
      set({ savedProjects: projects });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load projects.';
      set({ appError: msg });
      reportClientError({ module: 'store.loadProjects', message: msg, err });
    } finally {
      set({ isLoadingProjects: false });
    }
  },

  createProject: async (data) => {
    const res = await api.post<{ id: string } & SavedProject>('/projects', {
      name: data.name ?? '',
      client: data.client ?? '',
      projectType: data.projectType ?? 'web_app',
      estimatedBudget: data.estimatedBudget ?? '',
      startDate: data.startDate ?? '',
      communicationChannels: data.communicationChannels ?? ['upwork'],
      channelLinks: data.channelLinks ?? {},
      contactPerson: data.contactPerson ?? '',
      rawInput: data.rawInput ?? '',
      provider: data.provider ?? 'anthropic',
    });
    set((state) => ({ savedProjects: [res, ...state.savedProjects] }));
    return res.id;
  },

  projectLoadError: null,
  clearProjectLoadError: () => set({ projectLoadError: null }),

  loadProject: async (id) => {
    // Reset the not-found flag so we don't render the error screen for the
    // previous failed id while the new fetch is in flight.
    set({ isLoadingProject: true, activeProjectId: id, projectLoadError: null });
    try {
      // Fetch in parallel but TOLERATE partial failures: a missing brief or
      // empty epics list should not prevent the Definition form from showing.
      const [projectRes, briefRes, epicsRes, journeysRes, tasksRes] = await Promise.allSettled([
        api.get<Record<string, unknown>>(`/projects/${id}`),
        api.get<BriefWithHistory | null>(`/projects/${id}/brief`),
        api.get<EpicWithHistory[]>(`/projects/${id}/epics`),
        api.get<JourneyWithHistory[]>(`/projects/${id}/journeys`),
        api.get<TaskWithHistory[]>(`/projects/${id}/tasks`),
      ]);

      // Surface any failures in console for debugging without blocking UI hydration.
      [
        ['project',  projectRes],
        ['brief',    briefRes],
        ['epics',    epicsRes],
        ['journeys', journeysRes],
        ['tasks',    tasksRes],
      ].forEach(([label, r]) => {
        const settled = r as PromiseSettledResult<unknown>;
        if (settled.status === 'rejected') {
          console.error(`[loadProject] ${label as string} fetch failed:`, settled.reason);
        }
      });

      // The project itself is required — without it, we have no definition data to show.
      if (projectRes.status !== 'fulfilled') {
        const msg = projectRes.reason instanceof Error ? projectRes.reason.message : 'Failed to load project.';
        // Wipe stale state so the previously-loaded project's data doesn't
        // leak into the UI for an id that doesn't exist.
        set({
          appError: null,
          projectLoadError: { id, message: msg },
          definition: MOCK_PROJECT_DEFINITION,
          brief: EMPTY_BRIEF,
          epics: [],
          journeys: [],
          tasks: [],
          activeProjectId: null,
        });
        reportClientError({
          module: 'store.loadProject',
          message: `Project not found or failed to load: ${msg}`,
          err: projectRes.reason,
          context: { projectId: id, path: typeof window !== 'undefined' ? window.location.pathname : undefined },
        });
        return;
      }

      const project = projectRes.value;
      const brief    = briefRes.status    === 'fulfilled' ? briefRes.value    : null;
      const epics    = epicsRes.status    === 'fulfilled' ? epicsRes.value    : [];
      const journeys = journeysRes.status === 'fulfilled' ? journeysRes.value : [];
      const tasks    = tasksRes.status    === 'fulfilled' ? tasksRes.value    : [];

      const safeParse = <T>(raw: unknown, fallback: T): T => {
        if (typeof raw !== 'string') return (raw as T) ?? fallback;
        try { return JSON.parse(raw) as T; } catch { return fallback; }
      };

      const definition: ProjectDefinition = {
        name: (project['name'] as string) ?? '',
        client: (project['client'] as string) ?? '',
        projectType: ((project['project_type'] as ProjectDefinition['projectType']) ?? 'web_app'),
        estimatedBudget: (project['estimated_budget'] as string) ?? '',
        startDate: (project['start_date'] as string) ?? '',
        communicationChannels: safeParse<ProjectDefinition['communicationChannels']>(
          project['communication_channel'],
          ['upwork'],
        ),
        channelLinks: safeParse<ProjectDefinition['channelLinks']>(
          project['channel_link'],
          {},
        ),
        contactPerson: (project['contact_person'] as string) ?? '',
        rawInput: (project['raw_input'] as string) ?? '',
        attachedFiles: [],
        // Server returns attachments_text as the concatenated extracted text
        // from all uploaded documents (or null if none). Just expose the
        // presence as a boolean — the brief generator on the server already
        // reads the full text directly from the project row.
        hasAttachments: typeof project['attachments_text'] === 'string' && (project['attachments_text'] as string).trim().length > 0,
        provider: ((project['provider'] as ProjectDefinition['provider']) ?? 'anthropic'),
      };

      set({
        definition,
        brief: brief ?? EMPTY_BRIEF,
        epics: epics ?? [],
        journeys: journeys ?? [],
        tasks: tasks ?? [],
      });
    } finally {
      set({ isLoadingProject: false });
    }
  },

  deleteProject: async (id) => {
    try {
      await api.del(`/projects/${id}`);
      set((state) => {
        const nextChat = { ...state.epicChat };
        delete nextChat[id];
        persistEpicChat(nextChat);
        return {
          savedProjects: state.savedProjects.filter((p) => p.id !== id),
          activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
          epicChat: nextChat,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete project.';
      set({ appError: msg });
      reportClientError({ module: 'store.deleteProject', message: msg, err, context: { projectId: id } });
      throw err;
    }
  },

  saveProject: async (id) => {
    const { definition } = get();
    try {
      await api.patch(`/projects/${id}`, {
        name: definition.name,
        client: definition.client,
        projectType: definition.projectType,
        estimatedBudget: definition.estimatedBudget,
        startDate: definition.startDate,
        communicationChannel: JSON.stringify(definition.communicationChannels ?? ['upwork']),
        channelLink: JSON.stringify(definition.channelLinks ?? {}),
        contactPerson: definition.contactPerson,
        rawInput: definition.rawInput,
        provider: definition.provider,
      });
      // Refresh the projects list so updatedAt is current
      await get().loadProjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save project.';
      set({ appError: msg });
      reportClientError({ module: 'store.saveProject', message: msg, err, context: { projectId: id } });
      throw err;
    }
  },

  addProject: (project) =>
    set((state) => ({ savedProjects: [project, ...state.savedProjects] })),

  // ─── Generate stages ───────────────────────────────────────────────────────

  generateBrief: async (id, challengeText) => {
    set({ isGenerating: 'brief' });
    try {
      const res = await api.post<BriefWithHistory>(`/projects/${id}/brief/generate`, {
        challengeText: challengeText ?? '',
      });
      set({ brief: res });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate brief.';
      set({ appError: `Brief generation failed: ${msg}` });
      reportClientError({ module: 'store.generateBrief', message: msg, err, context: { projectId: id, challengeText } });
    } finally {
      set({ isGenerating: null });
    }
  },

  generateEpics: async (id, challengeText) => {
    set({ isGenerating: 'epics' });

    // Poll GET /epics every 2s so the UI counter ticks up the instant the
    // backend completes its batch insert. Less useful than for journeys/tasks
    // (epic gen is one LLM call → inserts happen at the very end) but mirrors
    // the same UX pattern and surfaces partial state if the backend ever
    // adopts incremental inserts.
    const MAX_POLLS = 90;
    let pollCount = 0;
    const pollHandle = setInterval(async () => {
      if (++pollCount > MAX_POLLS) { clearInterval(pollHandle); return; }
      try {
        const fresh = await api.get<EpicWithHistory[]>(`/projects/${id}/epics`);
        if (Array.isArray(fresh) && fresh.length > 0) {
          set({ epics: fresh });
        }
      } catch {
        // Ignore poll errors — the POST will surface real failures.
      }
    }, 700);

    try {
      const res = await api.post<EpicWithHistory[]>(`/projects/${id}/epics/generate`, { challengeText: challengeText ?? '' });
      set({ epics: res });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate epics.';
      set({ appError: `Epic generation failed: ${msg}` });
      reportClientError({ module: 'store.generateEpics', message: msg, err, context: { projectId: id, challengeText } });
      throw err;
    } finally {
      clearInterval(pollHandle);
      set({ isGenerating: null });
    }
  },

  generateJourneys: async (id, challengeText) => {
    set({ isGenerating: 'journeys' });

    // Per-epic generation can take 60-90s for large projects. Poll the GET
    // endpoint every 3s so journeys stream into the UI as each epic completes.
    const MAX_POLLS = 60; // 3 minutes max
    let pollCount = 0;
    const pollHandle = setInterval(async () => {
      if (++pollCount > MAX_POLLS) { clearInterval(pollHandle); return; }
      try {
        const fresh = await api.get<JourneyWithHistory[]>(`/projects/${id}/journeys`);
        if (Array.isArray(fresh) && fresh.length > 0) {
          set({ journeys: fresh });
        }
      } catch {
        // Ignore poll errors — main POST will surface real errors.
      }
    }, 3000);

    try {
      const res = await api.post<JourneyWithHistory[]>(`/projects/${id}/journeys/generate`, { challengeText: challengeText ?? '' });
      set({ journeys: res });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate journeys.';
      set({ appError: `Journey generation failed: ${msg}` });
      reportClientError({ module: 'store.generateJourneys', message: msg, err, context: { projectId: id, challengeText } });
    } finally {
      clearInterval(pollHandle);
      set({ isGenerating: null });
    }
  },

  generateTasks: async (id, challengeText) => {
    set({ isGenerating: 'tasks' });

    // Backend writes each task to the DB as it generates it. Poll the GET
    // endpoint every 3 seconds so the user sees tasks streaming into the UI
    // instead of staring at a spinner for 30-60s. The poll stops when the
    // POST returns, or after MAX_POLLS as a safety cap.
    const MAX_POLLS = 60; // 60 polls × 3s = 3 minutes max
    let pollCount = 0;
    const pollHandle = setInterval(async () => {
      if (++pollCount > MAX_POLLS) { clearInterval(pollHandle); return; }
      try {
        const fresh = await api.get<TaskWithHistory[]>(`/projects/${id}/tasks`);
        if (Array.isArray(fresh) && fresh.length > 0) {
          set({ tasks: fresh });
        }
      } catch {
        // Ignore poll errors — main POST will surface real errors.
      }
    }, 3000);

    try {
      // Backend now returns { tasks, failures }. Stay backwards-compatible with
      // the old shape (plain array) so an out-of-sync API doesn't break the UI.
      const res = await api.post<TaskWithHistory[] | { tasks: TaskWithHistory[]; failures: string[] }>(
        `/projects/${id}/tasks/generate`,
        { challengeText: challengeText ?? '' },
      );
      const tasks = Array.isArray(res) ? res : res.tasks;
      const failures = Array.isArray(res) ? [] : (res.failures ?? []);
      set({ tasks });
      if (failures.length > 0) {
        set({
          appError: `Task generation completed with ${failures.length} journey failure(s). ${failures.slice(0, 3).join('; ')}${failures.length > 3 ? '…' : ''}`,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to generate tasks.';
      set({ appError: `Task generation failed: ${msg}` });
      reportClientError({ module: 'store.generateTasks', message: msg, err, context: { projectId: id, challengeText } });
    } finally {
      clearInterval(pollHandle);
      set({ isGenerating: null });
    }
  },

  // ─── Sync ──────────────────────────────────────────────────────────────────

  startSync: async (projectId) => {
    set({ syncProgress: 0, syncLog: [] });

    const addLog = (entry: SyncLogEntry) =>
      set((state) => ({ syncLog: [...state.syncLog, entry] }));

    addLog({
      id: `log-init-${Date.now()}`,
      timestamp: new Date().toISOString(),
      message: 'Sync initiated — connecting to ClickUp…',
      type: 'info',
    });

    try {
      const res = await api.post<{ log: Array<{ timestamp: string; message: string; type: 'info' | 'success' | 'error' }>; syncedCount: number }>(
        `/projects/${projectId}/sync`,
      );

      for (let i = 0; i < res.log.length; i++) {
        set({ syncProgress: Math.round(((i + 1) / res.log.length) * 100) });
        addLog({ ...res.log[i], id: `log-${i}-${Date.now()}` });
        await new Promise((r) => setTimeout(r, 400));
      }

      // Refresh savedProjects so the sidebar's "Sync" step picks up the new
      // 'synced' status (the backend updates project.status when sync succeeds).
      if (res.syncedCount > 0) {
        await get().loadProjects();
      }
    } catch (err) {
      addLog({
        id: `log-err-${Date.now()}`,
        timestamp: new Date().toISOString(),
        message: err instanceof Error ? err.message : 'Sync failed.',
        type: 'error',
      });
    }
  },

  resetSync: () => set({ syncProgress: 0, syncLog: [] }),

  // ─── Auth ──────────────────────────────────────────────────────────────────

  login: async (email, password) => {
    set({ authError: null });
    try {
      const res = await api.post<{ token: string; user: AppUser }>('/auth/login', { email, password });
      localStorage.setItem('wbs_token', res.token);
      localStorage.setItem('wbs_user', JSON.stringify(res.user));
      set({ currentUser: res.user, authError: null });
    } catch (err) {
      // Defensive: a failed login MUST wipe any stale session left in
      // localStorage. Without this, a user who refreshes after logout (without
      // localStorage being cleared) and types the wrong password would still
      // be "logged in" via the cached currentUser — a serious auth bypass.
      try {
        localStorage.removeItem('wbs_token');
        localStorage.removeItem('wbs_user');
      } catch { /* ignore storage errors (private mode) */ }
      set({ currentUser: null, authError: err instanceof Error ? err.message : 'Login failed.' });
      // Re-throw so the LoginPage can branch on success/failure deterministically
      // instead of inferring it from currentUser state (which is racy).
      throw err;
    }
  },

  logout: async () => {
    // Persist any unsaved local state before tearing down the session so the
    // user doesn't lose work. The Definition page is the only surface that
    // keeps a true client-side draft (all other mutations hit the API per
    // change), so we flush it via saveProject if a project is active.
    const { activeProjectId, currentUser } = get();
    if (activeProjectId) {
      try {
        await get().saveProject(activeProjectId);
      } catch {
        // Swallow — a failed save must NOT block sign-out. The user may be
        // signing out precisely because the network is broken.
      }
    }
    // Stash a "where they were" hint so post-login they can resume the same
    // project + route. Scoped per user so different accounts on the same
    // browser don't collide.
    try {
      if (currentUser?.id) {
        const hint = { projectId: activeProjectId, route: window.location.pathname + window.location.search };
        localStorage.setItem(`wbs_last_state_${currentUser.id}`, JSON.stringify(hint));
      }
    } catch { /* ignore storage errors (private mode / quota) */ }

    localStorage.removeItem('wbs_token');
    localStorage.removeItem('wbs_user');
    set({ currentUser: null, authError: null, savedProjects: [], activeProjectId: null });
  },

  // ─── Prompt configs ────────────────────────────────────────────────────────

  loadPromptConfigs: async () => {
    try {
      const configs = await api.get<PromptConfig[]>('/admin/prompts');
      set({ promptConfigs: configs });
    } catch (err) {
      console.error('loadPromptConfigs failed:', err);
    }
  },

  updatePromptConfig: async (stage, fields) => {
    const res = await api.put<PromptConfig>(`/admin/prompts/${stage}`, fields);
    set((state) => ({
      promptConfigs: state.promptConfigs.map((p) => (p.stage === stage ? res : p)),
    }));
  },

  // ─── Notifications ────────────────────────────────────────────────────────

  appError: null,
  setAppError: (msg) => set({ appError: msg }),

  // ─── Theme ────────────────────────────────────────────────────────────────

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('wbs_theme', next);
      document.documentElement.setAttribute('data-theme', next);
      return { theme: next };
    }),
}));

// Derived helpers (used by pages)
export function useActiveProject() {
  return useProjectStore((state) => state.savedProjects.find((p) => p.id === state.activeProjectId));
}
