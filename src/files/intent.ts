/** Whether a message sent while a file is open asks to change that file, rather than a question
 *  about it. Questions and requests for something new (flashcards, a summary…) go to the chat. */
const ASK = /^(what|why|how|who|when|where|which|whats|what's|explain|summari[sz]e|tell me|describe|is|are|does|do|did|can you explain|help me understand|walk me through|compare|quiz me|teach)\b/i;
const MAKE_NEW = /\b(flashcards?|quiz|questions for me|notes for me|a summary|summary of|study guide|worksheet|mind ?map)\b/i;
const EDIT = /^(?:(?:please|pls|can you|could you|would you|now|also|and|ok|okay|then)\s+)*(change|replace|fix|correct|rewrite|reword|rephrase|edit|update|make|add|insert|remove|delete|drop|cut|shorten|lengthen|expand|simplify|translate|rename|swap|turn|set|bold|italici[sz]e|capitali[sz]e|highlight|move|put|write|reorder|format|convert|increase|decrease|renumber)\b/i;

export function isEditRequest(message: string) {
  const text = message.trim().replace(/^["'“]+/, "");
  if (!text || ASK.test(text) || /\?\s*$/.test(text) && !EDIT.test(text)) return false;
  if (MAKE_NEW.test(text) && !/\b(in|to|into) (this|the) (file|pdf|document|slide|deck|sheet)/i.test(text)) return false;
  return EDIT.test(text);
}
