export type Provider = 'OpenAI' | 'Anthropic' | 'Google' | 'xAI';
export type Model = { description?:string; isDefault?:boolean; defaultReasoningEffort?:string; reasoningEfforts?:{reasoningEffort:string;description:string}[]; id: string; name: string; provider: Provider; connected: boolean; context: number; specialties: string[]; tools: string[]; evaluation?: { score: number; measuredAt: string } };
export type Subtask = { reasoning?:string; id: string; title: string; instructions: string; output: string; model: string; dependsOn: string[]; status: 'pending' | 'running' | 'complete' | 'failed'; result?: string };
export type Plan = { id: string; goal: string; lead: string; tasks: Subtask[]; approved: boolean; revision: number; kind?: 'long'|'skill'; origin?: 'starter'|'lead'|'skill'; skillId?:string };
export type Skill = { id: string; name: string; description: string; category: string; icon: string; steps: string[]; builtin: boolean };
/** A folder made inside Mowr to organise a space's files; `parentId` nests it. */
export type SpaceFolder = { id: string; name: string; parentId: string | null; created: number };
export type Space = { id: string; name: string; kind: 'project' | 'subject'; description: string; memory: string; sources: string[]; examDate?: string; folders?: SpaceFolder[]; drive?: SpaceDrive };
/** A Google Drive folder kept in step with a space: which Drive files became which Mowr files. */
export type SpaceDrive = { folderId: string; folderName: string; lastSync?: number; error?: string; saveBack?: boolean; newFiles?: string[]; files: Record<string, { fileId: string; modified: string }> };
export type Review = { model: string; content: string; status: 'running' | 'done' | 'error' };
export type ClaimCheck = { claim: string; status: 'supported' | 'partial' | 'unsupported'; source?: string; page?: number | null; quote?: string };
export type Verification = { status: 'running' | 'done' | 'error'; claims?: ClaimCheck[]; error?: string };
export type EditOutcome = { status: 'applied' | 'dismissed' | 'undone' | 'failed'; changeId?: string; error?: string };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; visual?: boolean | string; visualParams?: Record<string, number>; plan?: Plan; attachments?: string[]; pointers?: { file: string; page?: number; text?: string; area?: boolean }[]; model?: string; review?: Review; verify?: Verification; edits?: Record<string, EditOutcome> };
export type Chat = { model?: string; reasoning?: string; pinned?: boolean; id: string; title: string; spaceId: string | null; messages: Message[]; updated: number };
/** An earlier version of an edited file, kept on this PC so the edit can be undone. */
export type FileVersion = { blob: string; at: number; summary: string; size: number };
/** `made` marks PDFs Mowr generated; their source is kept beside them so edits re-typeset the page. */
export type StoredFile = { remote?:boolean; id: string; name: string; size: number; type: string; created: number; spaceId: string | null; folderId?: string | null; made?: boolean; versions?: FileVersion[]; updated?: number };
export type VisualRecord = { id: string; chatId: string; title: string; created: number; scene?: string; params?: Record<string, number>; spec?: unknown };
export type Automation = {model?:string;nextRun?:number;lastRun?:number;lastError?:string; id: string; name: string; prompt: string; schedule: string; enabled: boolean; spaceId: string | null };

export type StudyItem={question:string;answer:string;choices?:string[];correct?:number};
export type CardState={due:number;stability:number;difficulty:number;reps:number;lapses:number;last:number};
export type StudySet={id:string;spaceId:string;chatId?:string;kind:'quiz'|'flashcards';title:string;items:StudyItem[];created:number;attempts:{at:number;correct:number;total:number}[];cards?:(CardState|null)[]};
