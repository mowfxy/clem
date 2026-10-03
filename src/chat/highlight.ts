// A small tokenizer for chat code blocks: comments, strings, numbers, keywords, built-ins and calls. It is deliberately
// shallow (one regex pass, no grammar) so it stays fast while an answer streams and never breaks on half-written code.

export type Token = { kind: 'comment' | 'string' | 'number' | 'keyword' | 'builtin' | 'call' | 'tag' | 'attr' | 'punct' | 'plain'; text: string };

const words = (s: string) => new Set(s.split(' '));
const C_KEYWORDS = 'if else for while do switch case break continue return default goto sizeof typedef struct union enum static const volatile extern inline void';
const LANGS: Record<string, { keywords: Set<string>; builtins: Set<string>; hashComment?: boolean; slashComment?: boolean; dashComment?: boolean; triple?: boolean; backtick?: boolean }> = {
  python: {
    keywords: words('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case self'),
    builtins: words('print range len int float str list dict set tuple bool sum min max abs round sorted reversed enumerate zip map filter open input isinstance type super any all iter next format repr divmod pow hash id object Exception ValueError TypeError KeyError IndexError'),
    hashComment: true, triple: true,
  },
  javascript: {
    keywords: words('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new return super switch this throw try typeof var void while with yield async await of static get set null undefined true false interface type enum implements private public protected readonly as from'),
    builtins: words('console Math JSON Object Array String Number Boolean Promise Map Set Date RegExp Error Symbol parseInt parseFloat setTimeout setInterval fetch window document require module'),
    slashComment: true, backtick: true,
  },
  c: { keywords: words(C_KEYWORDS + ' int long short char float double unsigned signed bool true false NULL nullptr class public private protected virtual template typename namespace using new delete this throw try catch auto override final std include define'), builtins: words('printf scanf malloc free cout cin endl vector string map size_t'), slashComment: true },
  java: { keywords: words(C_KEYWORDS + ' int long short char float double boolean byte true false null class interface extends implements public private protected abstract final new this super throw throws try catch finally import package var record'), builtins: words('System String Integer List ArrayList Map HashMap Math out println'), slashComment: true },
  go: { keywords: words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil'), builtins: words('fmt Println Printf len cap make new append panic error string int float64 bool byte'), slashComment: true, backtick: true },
  rust: { keywords: words('as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'), builtins: words('println format vec Vec String Option Some None Result Ok Err Box i32 i64 u32 u64 f64 usize str bool'), slashComment: true },
  shell: { keywords: words('if then else elif fi for while do done case esac in function return export local set unset echo cd sudo'), builtins: words('npm npx node git pip python python3 ls cat grep curl mkdir rm cp mv'), hashComment: true },
  sql: { keywords: words('select from where and or not insert into values update set delete create table drop alter join left right inner outer on group by order having limit as distinct union null is in like primary key foreign references index'), builtins: words('count sum avg min max coalesce now'), dashComment: true },
  json: { keywords: words('true false null'), builtins: new Set() },
};
const ALIAS: Record<string, string> = { py: 'python', python3: 'python', js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript', typescript: 'javascript', mjs: 'javascript', node: 'javascript', cpp: 'c', 'c++': 'c', h: 'c', cs: 'java', csharp: 'java', kotlin: 'java', kt: 'java', swift: 'java', bash: 'shell', sh: 'shell', zsh: 'shell', powershell: 'shell', ps1: 'shell', console: 'shell', golang: 'go', rs: 'rust', postgres: 'sql', mysql: 'sql', sqlite: 'sql' };

/** The display name for a fence's language tag ("py" → "Python"). */
export function languageName(lang: string) {
  const names: Record<string, string> = { python: 'Python', javascript: 'JavaScript', c: 'C', java: 'Java', go: 'Go', rust: 'Rust', shell: 'Shell', sql: 'SQL', json: 'JSON' };
  const key = lang.toLowerCase(), special: Record<string, string> = { ts: 'TypeScript', tsx: 'TSX', typescript: 'TypeScript', jsx: 'JSX', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', html: 'HTML', css: 'CSS', bash: 'Bash', powershell: 'PowerShell', ps1: 'PowerShell', yaml: 'YAML', yml: 'YAML', kotlin: 'Kotlin', swift: 'Swift', xml: 'XML' };
  return special[key] || names[key] || names[ALIAS[key]] || (lang ? lang[0].toUpperCase() + lang.slice(1) : 'Text');
}

function markup(code: string): Token[] {
  const out: Token[] = [];
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?[\w-]+)|([\w-:@]+)(?==)|("[^"]*"?|'[^']*'?)|(\/?>)/g;
  let last = 0, m: RegExpExecArray | null, inTag = false;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push({ kind: 'plain', text: code.slice(last, m.index) });
    if (m[1]) out.push({ kind: 'comment', text: m[1] });
    else if (m[2]) { out.push({ kind: 'tag', text: m[2] }); inTag = true; }
    else if (m[3] && inTag) out.push({ kind: 'attr', text: m[3] });
    else if (m[4] && inTag) out.push({ kind: 'string', text: m[4] });
    else if (m[5]) { out.push({ kind: 'tag', text: m[5] }); inTag = false; }
    else out.push({ kind: 'plain', text: m[0] });
    last = re.lastIndex;
  }
  if (last < code.length) out.push({ kind: 'plain', text: code.slice(last) });
  return out;
}

export function tokenize(code: string, lang: string): Token[] {
  const key = lang.toLowerCase();
  if (['html', 'xml', 'svg', 'vue'].includes(key)) return markup(code);
  const spec = LANGS[key] || LANGS[ALIAS[key]];
  if (!spec || code.length > 60_000) return [{ kind: 'plain', text: code }];
  const parts = [
    spec.triple && String.raw`[rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))`,
    spec.slashComment && String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)`,
    spec.hashComment && String.raw`#[^\n]*`,
    spec.dashComment && String.raw`--[^\n]*`,
  ].filter(Boolean) as string[];
  const strings = [String.raw`[rRbBfFuU]{0,2}"(?:\\.|[^"\\\n])*"?`, String.raw`[rRbBfFuU]{0,2}'(?:\\.|[^'\\\n])*'?`, spec.backtick && String.raw`\x60(?:\\[\s\S]|[^\x60\\])*\x60?`].filter(Boolean) as string[];
  const re = new RegExp(`(${parts.join('|') || '(?!)'})|(${strings.join('|')})|(\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)|([A-Za-z_$][\\w$]*)(\\s*\\()?|(@[\\w.]+)`, 'g');
  const out: Token[] = [];
  let last = 0, m: RegExpExecArray | null;
  const push = (kind: Token['kind'], text: string) => { const prev = out[out.length - 1]; if (prev && prev.kind === kind && kind === 'plain') prev.text += text; else out.push({ kind, text }); };
  while ((m = re.exec(code))) {
    if (m.index > last) push('plain', code.slice(last, m.index));
    if (m[1]) push(m[1].startsWith('#') || m[1].startsWith('/') || m[1].startsWith('-') ? 'comment' : 'string', m[1]);
    else if (m[2]) push('string', m[2]);
    else if (m[3]) push('number', m[3]);
    else if (m[4]) {
      const word = m[4], cmp = key === 'sql' ? word.toLowerCase() : word;
      push(spec.keywords.has(cmp) ? 'keyword' : spec.builtins.has(cmp) ? 'builtin' : m[5] ? 'call' : 'plain', word);
      if (m[5]) push('plain', m[5]);
    } else if (m[6]) push('builtin', m[6]);
    last = re.lastIndex;
  }
  if (last < code.length) push('plain', code.slice(last));
  return out;
}
