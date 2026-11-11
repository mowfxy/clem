// The connectors Settings → Connectors lists beside the hand-wired Google Drive row (src/App.tsx).

export type ConnectorId = "guc" | "vps";
export type Connector = {
  id: ConnectorId;
  name: string;
  /** An Icon name from src/Icons.tsx. */
  icon: string;
  description: string;
  /** The desktop request that reports whether it is connected. */
  status: "gucStatus" | "vpsStatus";
  /** Hidden until its step ships. */
  hidden?: boolean;
};

export const connectors: Connector[] = [
  { id: "guc", name: "GUC", icon: "guc", description: "Courses, grades and announcements from CMS and the student portal.", status: "gucStatus" },
  { id: "vps", name: "Your server", icon: "settings", description: "Run Clem's background jobs on your own VPS. Coming later.", status: "vpsStatus", hidden: true },
];

export const visibleConnectors = () => connectors.filter((c) => !c.hidden);
