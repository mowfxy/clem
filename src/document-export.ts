import { documentBlocks, slidePages } from "../core/document-blocks";
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
  const children = blocks.map((block) => {
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
  const sections: { title: string; lines: string[] }[] = [];
  let listNumber = 0;
  for (const block of documentBlocks(content)) {
    if (block.kind === "heading" && block.level <= 2)
      sections.push({ title: block.text, lines: [] });
    else {
      if (block.kind !== "number") listNumber = 0;
      if (!sections.length) sections.push({ title, lines: [] });
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
  if (!sections.length) sections.push({ title, lines: [] });
  let number = 0;
  for (const section of sections)
    for (const [index, page] of slidePages(
      section.lines.join("\n"),
    ).entries()) {
      const slide = pptx.addSlide();
      slide.background = { color: "171717" };
      slide.addText(section.title + (index ? " · continued" : ""), {
        x: 0.7,
        y: 0.5,
        w: 11.9,
        h: 1,
        fontFace: "Georgia",
        fontSize: 28,
        color: "EEECE4",
        fit: "shrink",
      });
      slide.addText(page, {
        x: 0.7,
        y: 1.7,
        w: 11.9,
        h: 4.85,
        fontFace: "Calibri",
        fontSize: 18,
        color: "D2D3CA",
        valign: "top",
        fit: "shrink",
        margin: 0,
      });
      slide.addText(String(++number), {
        x: 11.8,
        y: 7,
        w: 0.8,
        h: 0.2,
        fontSize: 10,
        color: "999999",
        align: "right",
      });
    }
  return (await pptx.write({ outputType: "blob" })) as Blob;
}
