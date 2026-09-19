import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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
      { offset, timeout: 25, limit: 20, allowed_updates: ["message"] },
      signal,
    );
  }
  async sendText(chatId: number, text: string) {
    if (text.length > 4096)
      throw Error("Telegram text exceeds 4096 characters.");
    return this.call("sendMessage", { chat_id: chatId, text });
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
