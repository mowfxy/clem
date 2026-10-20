import { useEffect, useState, type ReactNode } from "react";
import { openPackage } from "./package";
import { parsePptx, PptxView, type PptxModel } from "./pptx";
import { parseDocx, DocxView, type DocxModel } from "./docx";
import { parseXlsx, XlsxView, type XlsxModel } from "./xlsx";
import "./office-preview.css";

/**
 * Word, PowerPoint and Excel files shown as what they are: pages, slides and formatted sheets with calculated values.
 * Read from the file's own bytes, so a file the person uploaded and one Clem made look right with no Office installed,
 * and an edit made in the panel shows at once. `fallback` (the plain text view) is shown if the file cannot be drawn.
 */
type Drawn = { kind: "docx"; model: DocxModel } | { kind: "pptx"; model: PptxModel } | { kind: "xlsx"; model: XlsxModel & { dispose: () => void } } | { error: string };

export default function OfficePreview({ blob, name, changed, fallback }: { blob: Blob; name: string; changed: Set<string>; fallback: ReactNode }) {
  const [drawn, setDrawn] = useState<Drawn>();
  useEffect(() => {
    let live = true, dispose = () => {};
    setDrawn(undefined);
    (async () => {
      const pkg = await openPackage(blob);
      dispose = () => pkg.dispose();
      const next: Drawn = /\.pptx$/i.test(name) ? { kind: "pptx", model: parsePptx(pkg) } : /\.xlsx$/i.test(name) ? { kind: "xlsx", model: { ...parseXlsx(pkg), dispose: () => pkg.dispose() } } : { kind: "docx", model: parseDocx(pkg) };
      if (live) setDrawn(next); else pkg.dispose();
    })().catch((error) => { console.warn("Office preview:", error); if (live) setDrawn({ error: (error as Error).message }); });
    return () => { live = false; dispose(); };
  }, [blob, name]);
  if (!drawn) return <p className="fp-note">Drawing the preview…</p>;
  if ("error" in drawn) return <>{fallback}</>;
  return drawn.kind === "pptx" ? <PptxView model={drawn.model} changed={changed} /> : drawn.kind === "xlsx" ? <XlsxView model={drawn.model} changed={changed} /> : <DocxView model={drawn.model} changed={changed} />;
}
