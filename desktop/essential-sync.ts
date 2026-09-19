import {
  mergeSync,
  validateSync,
  type SyncItem,
  type SyncKind,
} from "../core/sync";
import type { Vault } from "./vault";
import type { DesktopAuth } from "./auth";
type Baseline = { data: SyncItem[]; revision: number };
/** Only allowlisted collections cross the network. Queue prevents local races. */
export class EssentialSync {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private vault: Vault,
    private auth: DesktopAuth,
  ) {}
  exchange(owner: string, kind: SyncKind, input: unknown) {
    const key = `essential-${owner}-${kind}`,
      data = validateSync(kind, input);
    const operation = (this.queues.get(key) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const base = await this.vault.read<Baseline>(key, {
          data: [],
          revision: 0,
        });
        try {
          if ((await this.auth.user())?.id !== owner)
            throw Error("Account changed.");
          const remote = (await this.auth.cloud("/sync/" + kind)) as Baseline;
          const merged = mergeSync(
            base.data,
            data,
            validateSync(kind, remote.data),
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
