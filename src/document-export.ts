import { documentBlocks, slidePages } from "../core/document-blocks";
type Picture = { data: Uint8Array; url: string; width: number; height: number; caption: string };
/** A chat visual as a PNG for Word and PowerPoint (drawn on paper by core/visual-print), or null when it cannot be drawn. */
async function visualPicture(spec: Record<string, unknown>): Promise<Picture | null> {
  try {
    const [{ printVisualSvg, visualCaption }, { standardFonts }, { paintSvg }] = await Promise.all([import("../core/visual-print"), import("../core/print-fonts"), import("./visuals/record")]);
    const svg = standardFonts(printVisualSvg(spec));
    const box = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg), width = box ? +box[1] : 800, height = box ? +box[2] : 440;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * 2);
    canvas.height = Math.round(height * 2);
    await paintSvg(canvas, svg);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) return null;
    return { data: new Uint8Array(await blob.arrayBuffer()), url: canvas.toDataURL("image/png"), width, height, caption: visualCaption(spec) };
  } catch {
    return null;
  }
}
export async function docxBlob(content: string, title: string) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    LevelFormat,
    BorderStyle,
    ShadingType,
    Footer,
    PageNumber,
    AlignmentType,
    ImageRun,
  } = await import("docx");
  const rule = { style: BorderStyle.SINGLE, size: 8, color: "1B1D21" };
  const hair = { style: BorderStyle.SINGLE, size: 2, color: "D9DCE0" };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const runs = (text: string) =>
    text
      .split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g)
      .filter(Boolean)
      .map(
        (part) =>
          new TextRun({
            text: part.replace(/^(\*\*|`|\*)|(?:\*\*|`|\*)$/g, ""),
            bold: part.startsWith("**"),
            italics: part.startsWith("*") && !part.startsWith("**"),
            font: part.startsWith("`") ? "Consolas" : undefined,
          }),
      );
  const blocks = documentBlocks(content);
  // The title is set once at the top; a leading heading that repeats it is dropped.
  if (blocks[0]?.kind === "heading" && blocks[0].text.trim().toLowerCase() === title.trim().toLowerCase()) blocks.shift();
  // Visuals become numbered figures with their caption below, sized to the text width (about 6.2 in).
  const pictures = await Promise.all(blocks.map((block) => (block.kind === "visual" ? visualPicture(block.spec) : null)));
  let figureNo = 0;
  const children = blocks.flatMap((block, i) => {
    if (block.kind === "visual") {
      const picture = pictures[i];
      if (!picture) return [];
      const width = Math.min(600, picture.width), height = Math.round((picture.height * width) / picture.width);
      return [
        new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, spacing: { before: 160, after: 80 }, children: [new ImageRun({ type: "png", data: picture.data, transformation: { width, height }, altText: { name: "Figure " + (figureNo + 1), description: picture.caption, title: picture.caption } })] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220 }, children: [new TextRun({ text: `Figure ${++figureNo}${picture.caption ? ": " : ""}`, bold: true, size: 19 }), new TextRun({ text: picture.caption, size: 19 })] }),
      ];
    }
    if (block.kind === "table")
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: rule, bottom: rule, left: none, right: none, insideHorizontal: hair, insideVertical: none },
        rows: block.rows.map(
          (row, i) =>
            new TableRow({
              tableHeader: i === 0,
              children: row.map(
                (cell) =>
                  new TableCell({
                    margins: { top: 60, bottom: 60, left: 110, right: 110 },
                    shading: i === 0 ? { type: ShadingType.CLEAR, fill: "F1F3F5", color: "auto" } : undefined,
                    borders: i === 0 ? { bottom: rule } : undefined,
                    children: [new Paragraph({ spacing: { after: 0 }, children: i === 0 ? runs(cell).map((r) => r) : runs(cell) })],
                  }),
              ),
            }),
        ),
      });
    if (block.kind === "code")
      return new Paragraph({
        children: block.text
          .split("\n")
          .flatMap((line, i) => [
            new TextRun({
              text: line,
              font: "Consolas",
              size: 20,
              break: i ? 1 : 0,
            }),
          ]),
        shading: { fill: "F3F3F3" },
        spacing: { after: 160 },
      });
    return new Paragraph({
      children: runs(block.text),
      ...(block.kind === "heading"
        ? {
            heading: [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
              HeadingLevel.HEADING_4,
              HeadingLevel.HEADING_5,
              HeadingLevel.HEADING_6,
            ][block.level - 1],
          }
        : {}),
      ...(block.kind === "bullet" ? { bullet: { level: 0 } } : {}),
      ...(block.kind === "number"
        ? { numbering: { reference: "mowr-numbered", level: 0 } }
        : {}),
      spacing: block.kind === "heading" ? undefined : { after: 140, line: 288 },
    });
  });
  const heading = (size: number, before: number, color = "101114") => ({ run: { font: "Calibri", size, bold: true, color }, paragraph: { spacing: { before, after: 100 }, keepNext: true } });
  return Packer.toBlob(
    new Document({
      title,
      creator: "Mowr",
      numbering: {
        config: [
          {
            reference: "mowr-numbered",
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: "left",
              },
            ],
          },
        ],
      },
      styles: {
        default: {
          document: { run: { font: "Cambria", size: 21, color: "1B1D21" } },
          title: { run: { font: "Calibri", size: 44, bold: true, color: "101114" }, paragraph: { spacing: { after: 120 } } },
          heading1: heading(30, 360, "1F4E79"),
          heading2: heading(26, 300),
          heading3: heading(23, 240),
          heading4: heading(21, 200),
        },
      },
      sections: [
        {
          properties: { page: { margin: { top: 1361, right: 1191, bottom: 1247, left: 1191 } } },
          footers: {
            default: new Footer({
              children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: "80868E", font: "Calibri" })] })],
            }),
          },
          children: [
            new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }),
            new Paragraph({
              border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: "1B1D21", space: 8 } },
              spacing: { after: 320 },
              children: [new TextRun({ text: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), font: "Calibri", size: 17, color: "5C6169" })],
            }),
            ...children,
          ],
        },
      ],
    }),
  );
}
export async function slidesBlob(content: string, title: string) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Mowr";
  pptx.title = title;
  const sections: { title: string; lines: string[]; pictures: Picture[] }[] = [];
  let listNumber = 0;
  for (const block of documentBlocks(content)) {
    if (block.kind === "heading" && block.level <= 2)
      sections.push({ title: block.text, lines: [], pictures: [] });
    else if (block.kind === "visual") {
      // Each visual gets a slide of its own after its section's text.
      const picture = await visualPicture(block.spec);
      if (!sections.length) sections.push({ title, lines: [], pictures: [] });
      if (picture) sections.at(-1)!.pictures.push(picture);
    } else {
      if (block.kind !== "number") listNumber = 0;
      if (!sections.length) sections.push({ title, lines: [], pictures: [] });
      sections
        .at(-1)!
        .lines.push(
          block.kind === "table"
            ? block.rows.map((row) => row.join("  |  ")).join("\n")
            : (block.kind === "bullet"
                ? "• "
                : block.kind === "number"
                  ? `${++listNumber}. `
                  : "") + block.text.replace(/\*\*/g, ""),
        );
    }
  }
  if (!sections.length) sections.push({ title, lines: [], pictures: [] });
  let number = 0;
  const heading = (slide: any, text: string) => slide.addText(text, { x: 0.7, y: 0.5, w: 11.9, h: 1, fontFace: "Georgia", fontSize: 28, color: "EEECE4", fit: "shrink" });
  const pageNumber = (slide: any) => slide.addText(String(++number), { x: 11.8, y: 7, w: 0.8, h: 0.2, fontSize: 10, color: "999999", align: "right" });
  for (const section of sections) {
    // A section that is only a visual goes straight to its figure slide, without an empty text slide first.
    const text = section.lines.join("\n");
    if (text.trim() || !section.pictures.length)
      for (const [index, page] of slidePages(text).entries()) {
        const slide = pptx.addSlide();
        slide.background = { color: "171717" };
        heading(slide, section.title + (index ? " · continued" : ""));
        slide.addText(page, { x: 0.7, y: 1.7, w: 11.9, h: 4.85, fontFace: "Calibri", fontSize: 18, color: "D2D3CA", valign: "top", fit: "shrink", margin: 0 });
        pageNumber(slide);
      }
    for (const picture of section.pictures) {
      // The figure keeps its proportions on a white card, the way it prints, with its caption under it.
      const slide = pptx.addSlide();
      slide.background = { color: "171717" };
      heading(slide, picture.caption && picture.caption.length <= 70 ? picture.caption : section.title);
      const room = { w: 11.9, h: 5.0 }, scale = Math.min(room.w / picture.width, room.h / picture.height);
      const w = picture.width * scale, h = picture.height * scale, x = 0.7 + (room.w - w) / 2, y = 1.6 + (room.h - h) / 2;
      slide.addShape("rect", { x: x - 0.1, y: y - 0.1, w: w + 0.2, h: h + 0.2, fill: { color: "FFFFFF" }, line: { color: "FFFFFF" } });
      slide.addImage({ data: picture.url, x, y, w, h, altText: picture.caption });
      if (picture.caption && picture.caption.length > 70) slide.addText(picture.caption, { x: 0.7, y: 6.7, w: 10.9, h: 0.5, fontFace: "Calibri", fontSize: 13, color: "B9BAB2", fit: "shrink" });
      pageNumber(slide);
    }
  }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
