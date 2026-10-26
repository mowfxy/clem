// What a chat message needs before its AI is asked. A greeting or a thank-you needs none of the person's files: reading
// a linked Drive folder, PDFs and pictures for it only made "hey" wait seconds for an answer.

/** Words and phrases that are only conversation. A "yes", "ok" or "sure" is left out: it may agree to an offer
 *  ("Shall I make the PDF?"), which needs the files. */
const PHRASES = [
  "hi+", "hey+", "hello+", "hiya", "heya", "howdy", "yo", "sup", "greetings", "salam", "salaam", "salam alaikum", "assalamu alaikum", "marhaba",
  "good (?:morning|afternoon|evening|night|day)", "morning", "evening", "gm", "gn",
  "thanks?", "thank (?:you|u)", "thx", "ty", "tysm", "tyvm", "cheers", "(?:so|very) much", "a lot", "lots", "a bunch", "appreciate (?:it|that)", "i appreciate (?:it|that)",
  "cool", "nice", "great", "awesome", "perfect", "amazing", "lovely", "wow", "neat", "brilliant", "excellent",
  "lol", "lmao", "(?:ha)+h?", "(?:he)+", ":\\)", ":d",
  "bye", "goodbye", "good ?bye", "see (?:you|ya|u)(?: later| soon)?", "later", "take care", "good night", "gotta go",
  "how (?:are|r) (?:you|u|things)(?: doing| today)?", "how(?:'s| is) it going", "hows it going", "how (?:have|ve) you been", "what(?:'s| is) up", "whats up", "wassup", "wh?atsup",
  "who (?:are|r) (?:you|u)", "what(?:'s| is) your name", "what are (?:you|u)",
  "no worries", "np", "all good", "no problem", "that(?:'s| is) all", "thats all", "you(?:'re| are) welcome", "youre welcome",
  "i(?:'m| am) (?:good|fine|great|ok|okay)", "im (?:good|fine|great|ok|okay)", "(?:and|what about) (?:you|u)",
  "there", "clem", "buddy", "bro", "man", "dude", "friend", "again", "and", "too", "you", "u",
];
const ONLY_TALK = new RegExp(`^(?:(?:${PHRASES.join("|")})(?:\\s+|$))+$`, "i");

/** True when the message is only a greeting, thanks, a reaction or a goodbye: nothing in it is about the person's files. */
export function smallTalk(text: string) {
  const plain = text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}\s':)]/gu, " ").replace(/\s+/g, " ").trim();
  if (!plain || plain.split(" ").length > 8) return false;
  return ONLY_TALK.test(plain);
}

/** True when the message asks for the files sent in a subject or project chat to be kept there ("save this to the
 *  project", "add these to Biology 101's files"). Without it, files sent in a chat stay in the normal Files tab. */
export function asksToKeepInSpace(text: string, spaceName = "") {
  const plain = text.toLowerCase().replace(/[’‘]/g, "'");
  const place = ["project", "subject", "course", "class", ...(spaceName.trim() ? [spaceName.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")] : [])].join("|");
  return new RegExp(`\\b(?:save|add|put|keep|store|move|file|upload|attach)\\b[^.?!\\n]{0,60}?\\b(?:in|into|to|under|with)\\b[^.?!\\n]{0,30}?(?:${place})`, "i").test(plain);
}
