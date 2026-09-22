export type Provider = 'OpenAI' | 'Anthropic' | 'Google' | 'xAI';
export type Model = { description?:string; isDefault?:boolean; defaultReasoningEffort?:string; reasoningEfforts?:{reasoningEffort:string;description:string}[]; id: string; name: string; provider: Provider; connected: boolean; context: number; specialties: string[]; tools: string[]; evaluation?: { score: number; measuredAt: string } };
export type Subtask = { reasoning?:string; id: string; title: string; instructions: string; output: string; model: string; dependsOn: string[]; status: 'pending' | 'running' | 'complete' | 'failed'; result?: string };
export type Plan = { id: string; goal: string; lead: string; tasks: Subtask[]; approved: boolean; revision: number; kind?: 'long'|'skill'; origin?: 'starter'|'lead'|'skill'; skillId?:string };
export type Skill = { id: string; name: string; description: string; category: string; icon: string; steps: string[]; builtin: boolean };
export type Space = { id: string; name: string; kind: 'project' | 'subject'; description: string; memory: string; sources: string[] };
export type Message = { id: string; role: 'user' | 'assistant'; content: string; visual?: boolean; plan?: Plan; attachments?: string[] };
export type Chat = { pinned?: boolean; id: string; title: string; spaceId: string | null; messages: Message[]; updated: number };
export type StoredFile = { remote?:boolean; id: string; name: string; size: number; type: string; created: number; spaceId: string | null };
export type VisualRecord = { id: string; chatId: string; title: string; created: number };
export type Automation = {model?:string;nextRun?:number;lastRun?:number;lastError?:string; id: string; name: string; prompt: string; schedule: string; enabled: boolean; spaceId: string | null };

export type StudyItem={question:string;answer:string;choices?:string[];correct?:number};
export type StudySet={id:string;spaceId:string;chatId?:string;kind:'quiz'|'flashcards';title:string;items:StudyItem[];created:number;attempts:{at:number;correct:number;total:number}[]};
