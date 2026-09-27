import { createContext } from "react";

/** Visuals stay in their chat; the save button on one adds it to the Visuals page (or takes it off again). */
export type VisualSaves = { saved: (spec: unknown) => boolean; toggle: (spec: unknown) => void };
export const VisualSaveContext = createContext<VisualSaves | null>(null);
