import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  TelegramClient,
  pairing,
  verifyPairing,
  telegramEnvelope,
  type Pairing,
  type TelegramRoute,
  type TelegramEnvelope,
} from "./telegram";
import type { Vault } from "../vault";
type Config = {
  token: string;
  offset: number;
  routes: TelegramRoute[];
  pair?: Pairing;
  enabled: boolean;
  seen: string[];
  error?: string;
};
export class TelegramService {
  private controller: AbortController | null = null;
  private owner = "";
  constructor(
    private vault: Vault,
    private process: (
      owner: string,
      envelope: TelegramEnvelope,
      bytes?: Buffer,
    ) => Promise<{
      text: string;
      document?: { name: string; mime: string; bytes: Uint8Array };
    }>,
  ) {}
  stop() {
    this.controller?.abort();
    this.controller = null;
    this.owner = "";
  }
  async status(owner: string) {
    const config = await this.vault.read<Config | null>(
      "telegram-" + owner,
      null,
    );
    return {
      enabled: !!config?.enabled,
      routes: config?.routes || [],
      error: config?.error,
    };
  }
  async connect(owner: string, token: string, scope: string) {
    this.stop();
    const p = pairing(scope);
    await this.vault.write("telegram-" + owner, {
      token,
      offset: 0,
      routes: [],
      pair: p.record,
      enabled: true,
      seen: [],
    } satisfies Config);
    this.start(owner);
    return { code: p.code };
  }
  /** The part of the connection worth keeping with the Mowr account: the bot and its paired chats. */
  async linkable(owner: string) {
    const config = await this.vault.read<Config | null>("telegram-" + owner, null);
    return config?.enabled && config.routes.length ? JSON.stringify({ token: config.token, routes: config.routes }) : null;
  }
  /** Restores a connection kept with the Mowr account when this PC has none. */
  async adoptLinked(owner: string, data: string) {
    if (await this.vault.read<Config | null>("telegram-" + owner, null)) return false;
    const linked = JSON.parse(data) as { token?: unknown; routes?: unknown };
    if (typeof linked.token !== "string" || !Array.isArray(linked.routes)) return false;
    await this.vault.write("telegram-" + owner, { token: linked.token, offset: 0, routes: linked.routes as TelegramRoute[], enabled: true, seen: [] } satisfies Config);
    return true;
  }
  async disconnect(owner: string) {
    this.stop();
    await this.vault.write("telegram-" + owner, null);
  }
  start(owner: string) {
    if (this.owner === owner && this.controller) return;
    this.stop();
    this.owner = owner;
    const controller = new AbortController();
    this.controller = controller;
    void this.loop(owner, controller.signal).catch(() => {});
  }
  private async loop(owner: string, signal: AbortSignal) {
    const key = "telegram-" + owner;
    while (!signal.aborted) {
      const config = await this.vault.read<Config | null>(key, null);
      if (!config?.enabled) return;
      const client = new TelegramClient(config.token);
      try {
        const updates = await client.poll(config.offset, signal);
        for (const update of updates) {
          signal.throwIfAborted();
          const message = update.message,
            match = String(message?.text || "").match(
              /^\/start\s+([A-Za-z0-9_-]+)$/,
            );
          if (
            match &&
            message.chat?.type === "private" &&
            Number.isSafeInteger(message.from?.id) &&
            config.pair &&
            verifyPairing(match[1], config.pair)
          ) {
            config.routes = [
              {
                chatId: message.chat.id,
                senderId: message.from.id,
                scope: config.pair.scope,
              },
            ];
            delete config.pair;
            config.offset = update.update_id + 1;
            await this.vault.write(key, config);
            await client.sendText(
              message.chat.id,
              "Paired with Mowr. Requests run on your PC while Mowr is open. Send /pdf followed by your request for a PDF response.",
            );
            continue;
          }
          let envelope;
          try {
            envelope = telegramEnvelope(update, config.routes);
          } catch {
            config.offset = update.update_id + 1;
            signal.throwIfAborted();
            await this.vault.write(key, config);
            continue;
          }
          if (envelope && !config.seen.includes(envelope.id)) {
            // Claim before inference. An uncertain send is never automatically retried.
            config.seen = [...config.seen.slice(-499), envelope.id];
            config.offset = update.update_id + 1;
            await this.vault.write(key, config);
            const job = "telegram-job-" + owner + "-" + update.update_id;
            await this.vault.write(job, {
              status: "running",
              scope: envelope.scope,
              source: envelope.id,
            });
            try {
              const bytes = envelope.attachment
                ? await client.download(envelope.attachment)
                : undefined;
              const result = await this.process(owner, envelope, bytes);
              signal.throwIfAborted();
              for (let i = 0; i < result.text.length; i += 4000)
                await client.sendText(
                  envelope.chatId,
                  result.text.slice(i, i + 4000),
                );
              if (result.document)
                await client.sendDocument(
                  envelope.chatId,
                  result.document.name,
                  result.document.bytes,
                  result.document.mime,
                );
              await this.vault.write(job, {
                status: "complete",
                scope: envelope.scope,
              });
            } catch {
              await this.vault.write(job, {
                status: "interrupted",
                scope: envelope.scope,
              });
              if(signal.aborted)return;
              config.error =
                "A Telegram request was interrupted. It was not automatically retried.";
              await this.vault.write(key, config);
              if (!signal.aborted)
                await client.sendText(
                  envelope.chatId,
                  "This request did not complete. Check Mowr on your PC and send a new request when ready.",
                );
            }
          }
          config.offset = Math.max(config.offset, update.update_id + 1);
          signal.throwIfAborted();
          await this.vault.write(key, config);
        }
      } catch {
        if (signal.aborted) return;
        await delay(10000, undefined, { signal }).catch(() => {});
      }
    }
  }
}
