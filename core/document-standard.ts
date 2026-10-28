/**
 * How Clem writes deliverable documents (reports, papers, briefs, notes, PDFs). A document is
 * the artifact itself, not a chat message about it, so it never addresses the requester.
 */
export const documentStandard = `DOCUMENT STANDARD (for reports, papers, briefs, notes, handouts, proposals, PDFs and any other deliverable document):
- Write the document itself, not a message about it. No greeting, preamble ("Here is your report…", "Sure!"), sign-off, offer ("Let me know…", "I hope this helps"), or mention of the conversation or of who asked for it.
- Impersonal register: third person, written about the subject itself ("Kinetic friction opposes…", "This guide covers…"). Do not use "I", "you" or "your". Use "we" only for an organisation's own proposal. Letters, memos, instructions, handouts and worksheets may address their reader directly.
- Precise and neutral: no hype, rhetorical questions, exclamation marks, emojis or filler. Define terms and abbreviations at first use. Report numbers with sensible significant figures.
- Structure follows the kind and the content, never a report template by default. Notes, guides and handouts follow the topics in their source's order (definitions, explanations, worked examples, summaries), with no abstract, Method, Findings or Recommendations sections. Only a /report technical report or a paper uses report sections (Summary, Introduction, Method, Findings, Discussion, Conclusions). Always: a specific title; descriptive headings in sentence case; tables for comparisons; figures where they carry information, each referred to in the text; references last when sources were used.
- Do not number headings yourself; Clem numbers sections, figures and pages.`;

const documentWords = /\b(report|paper|white ?paper|brief(?:ing)?|memo|proposal|essay|documentation|manual|handout|worksheet|study guide|summary document|literature review|lab report|case study|policy|specification|spec|minutes|article|pdf|docx|word document)\b/i;
/** True when the request asks for a deliverable document rather than a conversational answer. */
export function documentIntent(request: string) {
  return /^\/pdf\b/i.test(request.trim()) || (documentWords.test(request) && /\b(write|draft|create|make|prepare|produce|generate|compose|give me|i (?:want|need)|turn .* into|as a)\b/i.test(request));
}

export type DocumentKind = "report" | "paper" | "brief" | "notes" | "proposal" | "manual" | "handout" | "worksheet" | "letter" | "memo" | "document";
const addressed = new Set(["letter", "memo", "handout", "worksheet", "manual"]);
const strip = (text: string) =>
  text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, " ")
    .replace(/^>.*$/gm, " ")
    .replace(/[“"][^”"\n]{0,300}[”"]/g, " ");
const conversational = /\b(here(?:'s| is| are) (?:your|the|a) (?:report|document|pdf|summary|overview|analysis|notes|draft)|i hope (?:this|that|it) helps|let me know|feel free to|as (?:you )?requested|you asked|i(?:'ve| have) (?:prepared|created|written|put together|compiled|included)|i(?:'ll| will) (?:now|walk|explain|cover)|let's (?:dive|explore|look|take)|great question|happy to help|sure[,!]|certainly[,!]|absolutely[,!]|in this (?:chat|conversation))\b/i;
const secondPerson = /\b(you|your|yours|yourself|you're|you've|you'll)\b/gi;
const firstPerson = /(?<!\b(?:[Pp]hase|[Pp]art|[Tt]ype|[Cc]lass|[Ss]tage|[Cc]hapter|[Ss]ection|[Aa]ppendix|[Vv]olume|[Gg]rade|[Ll]evel|[Ww]orld [Ww]ar|[Ss]chedule|[Tt]ier|[Ff]igure|[Tt]able|[Aa]rticle|[Tt]itle|[Kk]ing|[Pp]ope|[Ee]lizabeth|[Hh]enry|[Ll]ouis)\s)\bI\b(?![.-]\w)|\b(?:I'm|I've|I'll|I'd|myself)\b/g;
const emoji = /\p{Extended_Pictographic}/u;
/** Text standing in for a picture the document should show: a figure described, omitted or left for the reader to find. */
const figureWords = String.raw`(?:figures?|diagrams?|graphs?|sketch(?:es)?|pictures?|plots?|contour (?:maps?|plots?|sketches)|illustrations?|images?)`;
const missingFigure = new RegExp([
  String.raw`\b(?:described|explained|given) in words\b[^.]{0,60}\b(?:rather than|instead of)\b`,
  String.raw`\b(?:rather than|instead of) (?:being )?(?:re-?)?(?:drawn|redrawn|sketched|reproduced)\b`,
  String.raw`\bnot (?:re-?)?(?:drawn|redrawn|reproduced|shown|included) here\b`,
  String.raw`\b${figureWords} (?:is |are )?(?:omitted|not (?:shown|included|reproduced))\b`,
  String.raw`\[(?:insert |add |placeholder: ?)?${figureWords}[^\]]{0,60}\]`,
  String.raw`\bsee the (?:original|worksheet|lecture|slides?|source|textbook|handout)\b[^.]{0,30}\bfor the ${figureWords}`,
].join("|"), "i");

/** Finds conversational or personal phrasing in document text. Empty when the text meets the standard. */
export function voiceProblems(parts: { where: string; text: string }[], kind: DocumentKind | string = "report") {
  const problems: string[] = [];
  for (const { where, text } of parts) {
    if (!text) continue;
    const plain = strip(text);
    const excerpt = (index: number) => '"…' + plain.slice(Math.max(0, index - 30), index + 40).replace(/\s+/g, " ").trim() + '…"';
    const chat = conversational.exec(plain);
    if (chat) problems.push(`${where}: conversational phrasing ${excerpt(chat.index)}`);
    if (!addressed.has(kind)) {
      const you = new RegExp(secondPerson.source, "gi").exec(plain);
      if (you) problems.push(`${where}: addresses the reader ("${you[0]}") ${excerpt(you.index)}`);
    }
    const me = new RegExp(firstPerson.source, "g").exec(plain);
    if (me) problems.push(`${where}: first person ("${me[0]}") ${excerpt(me.index)}`);
    if (emoji.test(plain)) problems.push(`${where}: contains emoji`);
    const lost = missingFigure.exec(plain);
    if (lost) problems.push(`${where}: a picture is described or left out instead of drawn ${excerpt(lost.index)}. Draw it as a figure (a crop of the source, or a Kinetra figure: graphs, regions and contour maps with clem visual) and remove the sentence`);
    const bang = /[A-Za-z)]!(?=\s|$)/.exec(plain);
    if (bang) problems.push(`${where}: exclamation mark ${excerpt(bang.index)}`);
  }
  return problems;
}
