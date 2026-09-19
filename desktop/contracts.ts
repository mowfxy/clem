import { z } from "zod";

export const scopeSchema = z
  .string()
  .regex(/^(chat|project|subject):[a-zA-Z0-9_-]{1,100}$/);
export const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({
    action: z.literal("login"),
    email: z.email(),
    password: z.string().min(1).max(128),
  }),
  z.object({
    action: z.literal("signup"),
    email: z.email(),
    password: z.string().min(12).max(128),
  }),
  z.object({ action: z.literal("logout") }),
  z.object({ action: z.literal("reset"), email: z.email() }),
  z.object({ action: z.literal("google") }),
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
  z.object({ action: z.literal("providerStatus") }),
  z.object({ action: z.literal("providerLogin") }),
  z.object({ action: z.literal("providerLogout") }),
  z.object({ action: z.literal("linkFolder"), scope: scopeSchema }),
  z.object({ action: z.literal("folders"), scope: scopeSchema }),
  z.object({ action: z.literal("unlinkFolder"), id: z.string().uuid() }),
  z.object({
    action: z.literal("chat"),
    id: z.string().uuid(),
    scope: scopeSchema,
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
  z.object({
    action: z.literal("memorySave"),
    scope: scopeSchema,
    key: z.string().min(1).max(100),
    text: z.string().min(1).max(2000),
    kind: z.enum(["fact", "preference"]),
    sharedWith: z.array(scopeSchema).max(10),
  }),
  z.object({ action: z.literal("memoryForget"), id: z.string().uuid() }),
  z.object({ action: z.literal("memoryToggle"), enabled: z.boolean() }),
  z.object({ action: z.literal("securityInfo") }),
  z.object({
    action: z.literal("passwordChange"),
    password: z.string().min(12).max(128),
  }),
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
  entitlement: { active: boolean; reason: string };
  error?: string;
  mfaFactor?: string;
};
export type DesktopBridge = {
  onAttachment: (
    listener: (event: {
      id: string;
      bytes: Uint8Array;
      name: string;
      mime: string;
    }) => void,
  ) => () => void;
  invoke: (request: DesktopRequest) => Promise<any>;
  onChat: (
    listener: (event: {
      id: string;
      type: string;
      text?: string;
      error?: string;
    }) => void,
  ) => () => void;
};
