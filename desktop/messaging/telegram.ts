import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { TelegramButton } from "../../core/telegram-commands.ts";

export type Pairing = { digest: string; scope: string; expires: number };
export type TelegramRoute = { chatId: number; senderId: number; scope: string };
export type TelegramEnvelope = {
  id: string;
  scope: string;
  chatId: number;
  text: string;
  attachment?: { id: string; name: string; mime: string; size: number };
};
export function pairing(scope: string) {
  const code = randomBytes(24).toString("base64url");
  return {
    code,
    record: {
      digest: createHash("sha256").update(code).digest("hex"),
      scope,
      expires: Date.now() + 300000,
    },
  };
}
export function verifyPairing(code: string, record: Pairing, now = Date.now()) {
  if (now >= record.expires || code.length > 100) return false;
  return timingSafeEqual(
    createHash("sha256").update(code).digest(),
    Buffer.from(record.digest, "hex"),
  );
}
export function telegramEnvelope(
  update: any,
  routes: TelegramRoute[],
): TelegramEnvelope | null {
  const message = update.message;
  if (
    !Number.isSafeInteger(update.update_id) ||
    message?.chat?.type !== "private" ||
    !Number.isSafeInteger(message.from?.id)
  )
    return null;
  const route = routes.find(
    (r) => r.chatId === message.chat.id && r.senderId === message.from.id,
  );
  if (!route) return null;
  const media = message.document || message.photo?.at(-1);
  let attachment;
  if (media) {
    const size = media.file_size;
    if (!Number.isSafeInteger(size) || size < 1 || size > 20_000_000)
      throw Error("Attachment exceeds the supported 20 MB limit.");
    const mime = message.document?.mime_type || "image/jpeg";
    if (
      ![
        "image/jpeg",
        "image/png",
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(mime)
    )
      throw Error("Unsupported attachment format.");
    attachment = {
      id: media.file_id,
      name: message.document?.file_name || "image.jpg",
      mime,
      size,
    };
  }
  return {
    id: "telegram:" + update.update_id,
    scope: route.scope,
    chatId: route.chatId,
    text: String(message.text || message.caption || "").slice(0, 16000),
    attachment,
  };
}
const keyboard = (buttons?: TelegramButton[][]) => buttons?.length ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text.slice(0, 64), callback_data: b.data }))) } } : {};
/** A tap on a picker button from a paired chat (anyone else's tap is ignored). */
export function telegramTap(update: any, routes: TelegramRoute[]) {
  const tap = update?.callback_query;
  const chatId = tap?.message?.chat?.id, senderId = tap?.from?.id;
  if (!tap || typeof tap.id !== "string" || typeof tap.data !== "string" || !Number.isSafeInteger(chatId) || !Number.isSafeInteger(senderId) || tap.message?.chat?.type !== "private") return null;
  const route = routes.find((r) => r.chatId === chatId && r.senderId === senderId);
  return route ? { id: tap.id, data: tap.data.slice(0, 64), chatId, messageId: Number(tap.message.message_id), scope: route.scope } : null;
}
export class TelegramClient {
  private token:string;
  constructor(token: string) {this.token=token;}
  private async call(method: string, body: unknown, signal?: AbortSignal) {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal || AbortSignal.timeout(35000),
      },
    );
    const result = (await response.json()) as any;
    if (!response.ok || !result.ok)
      throw Error("Telegram request failed. Check the bot connection.");
    return result.result;
  }
  async poll(offset: number, signal: AbortSignal) {
    return this.call(
      "getUpdates",
      { offset, timeout: 25, limit: 20, allowed_updates: ["message", "callback_query"] },
      signal,
    );
  }
  /** The commands Telegram lists in the bot's "/" menu. */
  async setCommands(commands: { command: string; description: string }[]) {
    return this.call("setMyCommands", { commands });
  }
  /** `buttons`: rows of tap buttons under the message (a picker); a tap comes back as a callback_query. */
  async sendText(chatId: number, text: string, buttons?: TelegramButton[][]) {
    if (text.length > 4096)
      throw Error("Telegram text exceeds 4096 characters.");
    return this.call("sendMessage", { chat_id: chatId, text, ...keyboard(buttons) });
  }
  /** Replaces a picker message after a tap (its text and its buttons, so the choice shows as ticked). */
  async editText(chatId: number, messageId: number, text: string, buttons?: TelegramButton[][]) {
    return this.call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4096), ...keyboard(buttons) }).catch(() => undefined);
  }
  /** Stops the tapped button's spinner, with a short note shown at the top of the chat. */
  async answerTap(id: string, text?: string) {
    return this.call("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => undefined);
  }
  async download(attachment: NonNullable<TelegramEnvelope["attachment"]>) {
    const file = await this.call("getFile", { file_id: attachment.id });
    if (
      typeof file.file_path !== "string" ||
      file.file_path.includes("..") ||
      !/^[a-zA-Z0-9_./-]+$/.test(file.file_path)
    )
      throw Error("Invalid Telegram file path.");
    const response = await fetch(
      `https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
      { signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok || !response.body)
      throw Error("Attachment download failed.");
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 20_000_000) throw Error("Attachment exceeds limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    const data = Buffer.concat(chunks);
    if (data.length !== attachment.size)
      throw Error("Attachment size changed.");
    const valid =
      attachment.mime === "application/pdf"
        ? data.subarray(0, 5).toString() === "%PDF-"
        : attachment.mime === "image/png"
          ? data
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : attachment.mime === "image/jpeg"
            ? data[0] === 255 && data[1] === 216
            : attachment.mime.includes("wordprocessing")
              ? data[0] === 80 && data[1] === 75
              : !data.includes(0);
    if (!valid)
      throw Error("Attachment contents do not match its declared format.");
    return data;
  }
  /** A picture shown inline in the chat (Telegram recompresses it; the original is not kept as a file). */
  async sendPhoto(chatId: number, name: string, bytes: Uint8Array, mime = "image/png") {
    if (bytes.length > 10_000_000)
      throw Error("Photo exceeds Telegram’s 10 MB limit.");
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set("photo", new Blob([new Uint8Array(bytes)], { type: mime }), name.replace(/[^a-zA-Z0-9._-]/g, "_"));
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendPhoto`,
      { method: "POST", body: form, signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw Error("Telegram photo delivery failed.");
  }
  async sendDocument(
    chatId: number,
    name: string,
    bytes: Uint8Array,
    mime = "application/pdf",
  ) {
    if (bytes.length > 20_000_000)
      throw Error("Document exceeds Mowr’s upload limit.");
    const form = new FormData();
    form.set("chat_id", String(chatId));
    form.set(
      "document",
      new Blob([new Uint8Array(bytes)], { type: mime }),
      name.replace(/[^a-zA-Z0-9._-]/g, "_"),
    );
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/sendDocument`,
      { method: "POST", body: form, signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok) throw Error("Telegram document delivery failed.");
  }
}
