import type { Model } from "../../core/types";
import { ModelSelector } from "../ModelSelector";
import { SettingsCard, SettingRow } from "./SettingsParts";

export type Organizer = { model?: string; reasoning?: string };

/** Settings → Proactivity. Clem's organizer runs the main thread and every job Clem does on its own (briefs,
 *  reminders, digests, folding the thread's history). The other proactive settings join this page as cards below. */
export function ProactivitySettings({ models, organizer, fallback, onChange, onConnect }: { models: Model[]; organizer?: Organizer; fallback: string; onChange: (next: Organizer) => void; onConnect: () => void }) {
  const chosen = organizer?.model && models.some((m) => m.id === organizer.model) ? organizer.model : fallback;
  const effort = organizer?.reasoning ?? models.find((m) => m.id === chosen)?.defaultReasoningEffort ?? "";
  const unset = !organizer?.model;
  return (
    <SettingsCard title="Clem’s organizer" note="It answers in your main thread, hands questions to the right subject or project, and keeps the thread’s running notes.">
      <SettingRow title="Model" description={unset ? "Uses your default model until you pick one." : models.find((m) => m.id === chosen && m.connected) ? undefined : "Not connected right now. Clem uses your default model meanwhile."}>
        <ModelSelector models={models} value={chosen} effort={effort} label="Choose Clem’s organizer model"
          onChange={(id) => onChange({ model: id, reasoning: models.find((m) => m.id === id)?.defaultReasoningEffort || undefined })}
          onEffort={(value) => onChange({ ...organizer, model: chosen || undefined, reasoning: value })} onConnect={onConnect} />
      </SettingRow>
    </SettingsCard>
  );
}
