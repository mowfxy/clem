/**
 * How Mowr writes deliverable documents (reports, papers, briefs, notes, PDFs). A document is
 * the artifact itself, not a chat message about it, so it never addresses the requester.
 */
export const documentStandard = `DOCUMENT STANDARD (for reports, papers, briefs, notes, handouts, proposals, PDFs and any other deliverable document):
- Write the document itself, not a message about it. No greeting, preamble ("Here is your report…", "Sure!"), sign-off, offer ("Let me know…", "I hope this helps"), or mention of the conversation or of who asked for it.
- Formal, impersonal register: third person with neutral or passive constructions ("This report examines…", "The results indicate…"). Do not use "I", "you" or "your". Use "we" only for an organisation's own proposal. Letters, memos, instructions and worksheets may address their reader directly.
- Precise and neutral: no hype, rhetorical questions, exclamation marks, emojis or filler. Define terms and abbreviations at first use. State units, assumptions, data sources and limitations. Report numbers with sensible significant figures.
- Structure: a specific title; for reports a short summary first; sections with descriptive headings in sentence case (for example Introduction, Background, Method, Findings, Discussion, Conclusions, Recommendations, as the content needs); tables for comparisons; figures only when they carry information, each referred to in the text ("Figure 1 shows…"); references last when sources were used.
- Do not number headings yourself; Mowr numbers sections, figures and pages.`;

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
    const bang = /[A-Za-z)]!(?=\s|$)/.exec(plain);
    if (bang) problems.push(`${where}: exclamation mark ${excerpt(bang.index)}`);
  }
  return problems;
}
