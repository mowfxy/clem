import {syncSchemas} from "../core/sync.ts";
import { z } from "zod";

export const scopeSchema = z
  .string()
  .regex(/^(chat|project|subject|user):[a-zA-Z0-9_-]{1,100}$/);
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("supportSend"), category:z.enum(["Contact support","Report a bug","Suggest a feature"]), subject:z.string().trim().min(1).max(150), message:z.string().trim().min(10).max(10000) }),
  z.object({ action: z.literal("supportCases") }),
  z.object({ action: z.literal("supportReply"), id:z.string().regex(/^[\w-]{8,64}$/), body:z.string().trim().min(2).max(10000) }),
  z.object({ action: z.literal("supportSeen"), id:z.string().regex(/^[\w-]{8,64}$/) }),
  z.object({ action: z.literal("announcements") }),
  z.object({action:z.literal("essentialSync"),skills:syncSchemas.skills,notes:syncSchemas.notes}),
  z.object({ action: z.literal("browserLogin") }),
  z.object({ action: z.literal("driveConnect") }),
  z.object({ action: z.literal("logout") }),
  z.object({
    action: z.literal("mfa"),
    factorId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({ action: z.literal("username"), username: z.string().max(24) }),
  z.object({
    action: z.literal("setup"),
    step: z.number().int().min(0).max(4),
    username: z.string().max(24),
    displayName: z.string().max(80),
    memory: z.boolean(),
  }),
  z.object({ action: z.literal("checkout") }),
  z.object({ action: z.literal("providerAccounts"), refresh:z.boolean().optional() }),
  z.object({ action: z.literal("providerAutoSwitch"), enabled:z.boolean() }),
  z.object({ action: z.literal("claudeStatus") }),
  z.object({ action: z.literal("claudeLogin") }),
  z.object({ action: z.literal("claudeInstall") }),
  z.object({ action: z.literal("providerAccountAdd") }),
  z.object({ action: z.literal("providerAccountRetry"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerAccountStatus"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerAccountSelect"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerAccountRemove"), id:z.string().regex(/^(default|[a-f0-9-]{36})$/) }),
  z.object({ action: z.literal("providerStatus") }),
  z.object({ action: z.literal("providerLogin") }),
  z.object({ action: z.literal("providerLogout") }),
  z.object({ action: z.literal("linkFolder"), scope: scopeSchema }),
  z.object({ action: z.literal("folders"), scope: scopeSchema }),
  z.object({ action: z.literal("unlinkFolder"), id: z.string().uuid() }),
  z.object({ action: z.literal("folderFileRead"), scope: scopeSchema, path: z.string().min(1).max(400) }),
  z.object({ action: z.literal("folderEditApply"), scope: scopeSchema, path: z.string().min(1).max(400), find: z.string().max(200000).optional(), replace: z.string().max(200000).optional(), content: z.string().max(256000).optional(), summary: z.string().max(400).optional() }),
  z.object({ action: z.literal("folderChanges"), scope: scopeSchema.optional() }),
  z.object({ action: z.literal("folderChangeUndo"), id: z.string().uuid() }),
  z.object({ action: z.literal("pdfRender"), spec: z.string().min(2).max(600_000) }),
  z.object({ action: z.literal("shareSave"), name: z.string().min(1).max(160), data: z.instanceof(Uint8Array).refine((d) => d.length <= 105_000_000, "Share files are limited to 100 MB.") }),
  z.object({ action: z.literal("shareReveal"), path: z.string().min(3).max(600) }),
  z.object({ action: z.literal("foldersAll") }),
  z.object({ action: z.literal("folderTree"), id: z.string().uuid() }),
  z.object({ action: z.literal("folderSearch"), query: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal("folderWatch"), enabled: z.boolean().optional() }),
  z.object({ action: z.literal("captureScreen") }),
  z.object({ action: z.literal("documentPdf"), title: z.string().trim().min(1).max(160), markdown: z.string().min(1).max(300000) }),
  z.object({
    action: z.literal("chat"),
    model:z.string().regex(/^[a-zA-Z0-9._:-]{1,100}$/).optional(),
    reasoning:z.enum(["none","minimal","low","medium","high","xhigh","max","ultra"]).optional(),
    id: z.string().uuid(),
    scope: scopeSchema,
    images: z.array(z.object({ name: z.string().max(200), data: z.string().max(11_000_000).regex(/^[A-Za-z0-9+/=]+$/) })).max(4).optional(),
    messages: z
      .array(
        z.object({
          role: z.enum(["user", "assistant", "system"]),
          content: z.string().max(60000),
        }),
      )
      .min(1)
      .max(80),
  }),
  z.object({ action: z.literal("cancel"), id: z.string().uuid() }),
  z.object({ action: z.literal("memoryList"), scope: scopeSchema }),
  z.object({ action: z.literal("memoryClear"), scope: scopeSchema }),
  z.object({action:z.literal("memoryEdit"),scope:scopeSchema,expected:z.array(z.object({id:z.string().uuid(),text:z.string().max(2000)})).max(500),records:z.array(z.object({id:z.string().uuid(),text:z.string().min(1).max(2000)})).max(500)}),
  z.object({
    action: z.literal("memorySave"),
    scope: scopeSchema,
    key: z.string().min(1).max(100),
    text: z.string().min(1).max(2000),
    kind: z.enum(["fact", "preference"]),
    sharedWith: z.array(scopeSchema).max(10),
    source: z.string().max(300).optional(),
  }),
  z.object({ action: z.literal("memoryForget"), id: z.string().uuid() }),
  z.object({ action: z.literal("memoryConfirm"), id: z.string().uuid() }),
  z.object({ action: z.literal("memoryToggle"), enabled: z.boolean() }),
  z.object({ action: z.literal("securityInfo") }),
  z.object({
    action: z.literal("passwordChange"),
    password: z.string().min(12).max(128),
    currentPassword: z.string().min(1).max(128).optional(),
    nonce: z.string().regex(/^[A-Za-z0-9]{6,10}$/).optional(),
    code: z.string().regex(/^\d{6}$/).optional(),
  }),
  z.object({ action: z.literal("passwordReauth") }),
  z.object({ action: z.literal("emailChange"), email: z.email() }),
  z.object({ action: z.literal("revokeOtherSessions") }),
  z.object({ action: z.literal("mfaEnroll") }),
  z.object({
    action: z.literal("mfaRemove"),
    factorId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/),
  }),
  z.object({
    action: z.literal("unlinkGoogle"),
    password: z.string().min(1).max(128),
  }),
  z.object({ action: z.literal("telegramStatus") }),
  z.object({
    action: z.literal("telegramConnect"),
    token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,100}$/),
    scope: scopeSchema,
  }),
  z.object({ action: z.literal("telegramDisconnect") }),
  z.object({
    action: z.literal("attachmentResult"),
    id: z.string().uuid(),
    text: z.string().max(40000).optional(),
    error: z.boolean().optional(),
  }),
]);
export type DesktopRequest = z.infer<typeof requestSchema>;
export type DesktopStatus = {
  configured: boolean;
  user: null | { id: string; email: string; name: string };
  setup: {
    step: number;
    username: string;
    displayName: string;
    memory: boolean;
  };
  entitlement: { active: boolean; reason: string; message?: string; until?: string | null };
  error?: string;
  mfaFactor?: string;
};
export type DesktopBridge = {
  onAuth: (listener: () => void) => () => void;
  onAttachment: (
    listener: (event: {
      id: string;
      bytes: Uint8Array;
      name: string;
      mime: string;
    }) => void,
  ) => () => void;
  invoke: (request: DesktopRequest) => Promise<any>;
  onCapture?: (listener: (event: { bytes: Uint8Array; name: string; mime: string }) => void) => () => void;
  onFolder?: (listener: (event: import("./folder-watch").FolderEvent) => void) => () => void;
  onPack?: (listener: (event: { bytes: Uint8Array; name: string }) => void) => () => void;
  startDrag?: (path: string) => void;
  onChat: (
    listener: (event: {
      id: string;
      type: string;
      text?: string;
      file?: import("../core/types").StoredFile;
      scope?: string;
      error?: string;
    }) => void,
  ) => () => void;
};
