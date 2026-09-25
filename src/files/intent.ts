/** Whether a message sent while a file is open asks to change that file, rather than a question
 *  about it. Questions and requests for something new (flashcards, a summary…) go to the chat. */
const ASK = /^(what|why|how|who|when|where|which|whats|what's|explain|summari[sz]e|tell me|describe|is|are|does|do|did|can you explain|help me understand|walk me through|compare|quiz me|teach)\b/i;
const MAKE_NEW = /\b(flashcards?|quiz|questions for me|notes for me|a summary|summary of|study guide|worksheet|mind ?map|(?:a |another |second )?new (?:pdf|document|file|version as a separate))\b/i;
const EDIT = /^(?:(?:please|pls|can you|could you|would you|now|also|and|ok|okay|then|just|so)\s+)*(change|replace|fix|correct|rewrite|reword|rephrase|edit|update|make|add|insert|remove|delete|drop|cut|shorten|lengthen|expand|extend|simplify|translate|rename|swap|turn|set|bold|italici[sz]e|capitali[sz]e|highlight|move|put|write|reorder|format|convert|increase|decrease|renumber|redo|restyle|improve|include|merge|split|recolou?r|resize|shrink|enlarge|clean up|tidy|polish)\b/i;
/** Wishes and complaints about the document that mean “change it”: “it should…”, “the diagram is wrong”, “I want…”. */
const WISH = /^(?:(?:please|pls|ok|okay|and|also|but|now|hmm|no)[,\s]+)*(?:i (?:want|need|'d like|would like|prefer)|it (?:should|needs|must|has to)|(?:this|that|the \w+(?: \w+)?) (?:is|are|looks?|seems?) (?:wrong|off|too|missing|incorrect|bad|ugly|confusing|messy|unclear)|there(?:'s| is| are) (?:a |an )?(?:mistake|error|typo|problem)|(?:more|less) (?:detail|details|text|pages?|space|examples?|diagrams?|figures?)|make (?:it|this|the)|longer|shorter|bigger|smaller|use (?:a|an|the|more|fewer))\b/i;
/** Words that point at the document itself, for requests typed without a file open. */
const DOCUMENT = /\b(it|this|that|the (?:pdf|document|doc|file|report|worksheet|summary|handout|notes|sheet|page|section|diagram|figure|chart|table|title|intro(?:duction)?|conclusion))\b/i;

export function isEditRequest(message: string) {
  const text = message.trim().replace(/^["'“]+/, "");
  if (!text || ASK.test(text) || /\?\s*$/.test(text) && !EDIT.test(text)) return false;
  if (MAKE_NEW.test(text) && !/\b(in|to|into) (this|the) (file|pdf|document|slide|deck|sheet)/i.test(text)) return false;
  return EDIT.test(text) || WISH.test(text);
}

/** A change to a document that is not open: it must name or point at the document, not just be any instruction. */
export function isDocumentChange(message: string) {
  return isEditRequest(message) && DOCUMENT.test(message);
}
