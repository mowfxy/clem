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
  } = await import("docx");
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
            font: part.startsWith("`") ? "Consolas" : "Calibri",
          }),
      );
  const children = documentBlocks(content).map((block) => {
    if (block.kind === "table")
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: block.rows.map(
          (row, i) =>
            new TableRow({
              tableHeader: i === 0,
              children: row.map(
                (cell) =>
                  new TableCell({
                    children: [new Paragraph({ children: runs(cell) })],
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
      spacing: { after: 140, line: 280 },
    });
  });
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
      styles: { default: { document: { run: { font: "Calibri", size: 23 } } } },
      sections: [{ children }],
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
  for (const block of documentBlocks(content)) {
    if (block.kind === "heading" && block.level <= 2)
      sections.push({ title: block.text, lines: [] });
    else {
      if (!sections.length) sections.push({ title, lines: [] });
      sections
        .at(-1)!
        .lines.push(
          block.kind === "table"
            ? block.rows.map((row) => row.join("  |  ")).join("\n")
            : (block.kind === "bullet"
                ? "� "
                : block.kind === "number"
                  ? "� "
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
      slide.addText(section.title + (index ? " � continued" : ""), {
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
