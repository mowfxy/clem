import {
  mergeSync,
  validateSync,
  type SyncItem,
  type SyncKind,
} from "../core/sync.ts";
import type { Vault } from "./vault";
import type { DesktopAuth } from "./auth";
type Baseline = { data: SyncItem[]; revision: number };
/** Only allowlisted collections cross the network. Queue prevents local races. */
export class EssentialSync {
  private queues = new Map<string, Promise<unknown>>();
  private vault: Vault;
  private auth: DesktopAuth;
  constructor(vault: Vault, auth: DesktopAuth) {
    this.vault = vault;
    this.auth = auth;
  }
  /** `noBaseline`: the local copy did not come from the last sync (it went missing and started again), so what it lacks
   *  was not deleted. The cloud's copy is merged in as on a new PC, and nothing is treated as a deletion. */
  exchange(owner: string, kind: SyncKind, input: unknown, { noBaseline = false }: { noBaseline?: boolean } = {}) {
    const key = `essential-${owner}-${kind}`,
      data = validateSync(kind, input);
    const operation = (this.queues.get(key) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const fresh: Baseline = { data: [], revision: 0 };
        const base = noBaseline ? fresh : await this.vault.read<Baseline>(key, fresh);
        try {
          if ((await this.auth.user())?.id !== owner)
            throw Error("Account changed.");
          // Nothing changed locally or in the cloud: no download, no upload.
          const answer = (await this.auth.cloud("/sync/" + kind + (base.revision ? "?since=" + base.revision : ""))) as Baseline & { unchanged?: boolean };
          const remote: Baseline = answer.unchanged ? base : answer;
          const merged = mergeSync(
            base.data,
            data,
            answer.unchanged ? remote.data : validateSync(kind, remote.data),
          );
          let revision = remote.revision;
          if (JSON.stringify(merged) !== JSON.stringify(remote.data)) {
            const saved = await this.auth.cloud("/sync/" + kind, {
              revision,
              data: merged,
            });
            revision = saved.revision;
          }
          await this.vault.write(key, { data: merged, revision });
          return { data: merged, error: undefined };
        } catch (error) {
          return { data, error: "Saved locally. " + (error as Error).message };
        }
      });
    this.queues.set(key, operation);
    return operation;
  }
}
