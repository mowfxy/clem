// Plugin self-tests for Kinetra Codex plugin.
// Validates manifest shape, skill frontmatter, agent yaml metadata,
// asset references, and the most rigorous check: every named export
// referenced by a SKILL.md actually exists in the claimed core module.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const CORE_ROOT = join(REPO_ROOT, "packages", "core", "src");

// ---------- helpers ----------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function listSkillsDir() {
  return readdirSync(join(PLUGIN_ROOT, "skills"))
    .filter((name) => statSync(join(PLUGIN_ROOT, "skills", name)).isDirectory());
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

function stripBom(text) {
  return text && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function parseFrontmatter(text) {
  const cleaned = stripBom(text);
  const m = cleaned.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key === "name") fm.name = value;
    if (key === "description") fm.description = value;
  }
  return fm;
}

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walkFiles(full);
    else yield full;
  }
}

function listExports(sourceFile) {
  const text = readText(sourceFile);
  const out = new Set();
  const re = /^export\s+(?:async\s+)?(?:function|const|let|var|class|type|interface)\s+([A-Za-z_$][\w$]*)/gm;
  for (const m of text.matchAll(re)) out.add(m[1]);
  const re2 = /^export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'][^"']+["']/gm;
  for (const m of text.matchAll(re2)) {
    for (const name of m[1].split(",")) {
      const n = name.trim().split(/\s+as\s+/)[0].trim();
      if (n) out.add(n);
    }
  }
  return out;
}

function parseSkillImports(skillText) {
  const cleaned = stripBom(skillText);
  const re = /import\s*(?:type\s*)?\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  const out = [];
  for (const m of cleaned.matchAll(re)) {
    const names = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    const cleanedNames = names.map((n) => n.replace(/^type\s+/, "").trim());
    out.push({ fromPath: m[2], names: cleanedNames });
  }
  return out;
}

function resolveImportPath(fromPath) {
  // Skill file lives at packages/plugin/skills/<skill>/SKILL.md.
  // Imports use "../../../../core/src/<x>.js" so the relative path
  // from SKILL.md resolves to packages/core/src/<x>.ts at the repo root.
  // Strip the leading "../../../../core/src/" and join with CORE_ROOT.
  const prefix = "../../../../core/src/";
  if (!fromPath.startsWith(prefix)) return null;
  const rest = fromPath.slice(prefix.length);
  return join(CORE_ROOT, rest.replace(/\.js$/, ".ts"));
}

// ---------- manifest ----------

test("manifest: parses, has required fields, valid semver", () => {
  const manifestPath = join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
  const m = readJson(manifestPath);

  assert.equal(m.name, "kinetra");
  assert.match(String(m.version), SEMVER_RE, "version must be strict semver");
  assert.equal(m.license, "Apache-2.0");
  assert.ok(typeof m.description === "string" && m.description.length > 0,
    "manifest.description must be non-empty");
  const author = m.author;
  assert.ok(author && typeof author.name === "string" && author.name.length > 0,
    "manifest.author.name must be non-empty");
  assert.equal(m.skills, "./skills/");
  assert.ok(Array.isArray(m.keywords) && m.keywords.length > 0,
    "manifest.keywords must be a non-empty array");

  const iface = m.interface;
  assert.ok(iface, "manifest.interface must exist");
  for (const field of ["displayName", "shortDescription", "longDescription", "developerName"]) {
    const v = iface[field];
    assert.ok(typeof v === "string" && v.length > 0,
      "manifest.interface." + field + " must be a non-empty string");
  }
  assert.equal(iface.category, "Developer Tools");
  assert.deepEqual(iface.capabilities, ["Read", "Write"]);
  assert.equal(iface.composerIcon, "./assets/kinetra-icon.svg");
  assert.equal(iface.logo, "./assets/kinetra-logo.png");
  assert.match(String(iface.websiteURL), /^https:\/\//);
  assert.match(String(iface.privacyPolicyURL), /^https:\/\//);
  assert.match(String(iface.termsOfServiceURL), /^https:\/\//);
  assert.match(String(iface.brandColor), /^#[0-9A-Fa-f]{6}$/);

  const prompts = iface.defaultPrompt;
  assert.ok(Array.isArray(prompts) && prompts.length > 0 && prompts.length <= 3,
    "defaultPrompt must have 1-3 entries");
  for (const p of prompts) {
    assert.ok(p.length > 0 && p.length <= 128,
      "defaultPrompt entry too long: " + p.length);
  }

  const iconPath = join(PLUGIN_ROOT, String(iface.composerIcon).replace(/^\.\//, ""));
  const logoPath = join(PLUGIN_ROOT, String(iface.logo).replace(/^\.\//, ""));
  assert.ok(existsSync(iconPath), "icon missing: " + iconPath);
  assert.ok(existsSync(logoPath), "logo missing: " + logoPath);
  assert.ok(statSync(iconPath).size > 0, "icon file is empty");
  assert.ok(statSync(logoPath).size > 0, "logo file is empty");

  assert.equal(m.hooks, undefined, "hooks must not be declared");
  assert.equal(m.apps, undefined, "apps must not be declared");
  assert.equal(m.mcpServers, undefined, "mcpServers must not be declared");
});

// ---------- skill frontmatter + agent yaml ----------

const skills = listSkillsDir();

function parseSimpleYamlFlat(text) {
  const cleaned = stripBom(text);
  const out = {};
  for (const rawLine of cleaned.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

function parseNestedInterface(text) {
  const cleaned = stripBom(text);
  const out = {};
  const lines = cleaned.split(/\r?\n/);
  let inInterface = false;
  for (const rawLine of lines) {
    if (!inInterface) {
      if (/^interface:\s*(#.*)?$/.test(rawLine)) { inInterface = true; continue; }
      continue;
    }
    if (!rawLine.trim()) continue;
    const kv = rawLine.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*(#.*)?$/);
    if (!kv) { inInterface = false; continue; }
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

test("skills: every skill has SKILL.md, agents/openai.yaml, valid frontmatter", () => {
  assert.ok(skills.length >= 1, "at least one skill required");
  for (const skill of skills) {
    const skillMd = join(PLUGIN_ROOT, "skills", skill, "SKILL.md");
    const yaml = join(PLUGIN_ROOT, "skills", skill, "agents", "openai.yaml");
    assert.ok(existsSync(skillMd), "missing SKILL.md for " + skill);
    assert.ok(existsSync(yaml), "missing agents/openai.yaml for " + skill);

    const fm = parseFrontmatter(readText(skillMd));
    assert.equal(fm.name, skill, "SKILL.md frontmatter name must match folder");
    assert.ok(typeof fm.description === "string" && fm.description.length >= 80,
      "SKILL.md description must be >= 80 chars (got " + (fm.description ? fm.description.length : 0) + ")");
    assert.ok(typeof fm.description === "string" && fm.description.length <= 700,
      "SKILL.md description must be <= 700 chars (got " + fm.description.length + ")");

    const agentRaw = readText(yaml);
    const flat = parseSimpleYamlFlat(agentRaw);
    const nested = parseNestedInterface(agentRaw);
    const displayName = nested.display_name || flat["display_name"];
    const shortDesc = nested.short_description || flat["short_description"];
    assert.ok(displayName && typeof displayName === "string" && displayName.length > 0,
      "agents/openai.yaml missing display_name for " + skill);
    assert.ok(shortDesc && typeof shortDesc === "string" && shortDesc.length > 0,
      "agents/openai.yaml missing short_description for " + skill);
    assert.ok(shortDesc.length <= 200,
      "short_description too long for " + skill + ": " + shortDesc.length);
  }
});

test("skills: names and short_descriptions are unique across the plugin", () => {
  const seenNames = new Set();
  const seenDescs = new Set();
  for (const skill of skills) {
    const fm = parseFrontmatter(readText(join(PLUGIN_ROOT, "skills", skill, "SKILL.md")));
    assert.ok(!seenNames.has(fm.name), "duplicate skill name " + fm.name);
    seenNames.add(fm.name);
    const agentRaw = readText(join(PLUGIN_ROOT, "skills", skill, "agents", "openai.yaml"));
    const flat = parseSimpleYamlFlat(agentRaw);
    const nested = parseNestedInterface(agentRaw);
    const sd = nested.short_description || flat["short_description"] || "";
    assert.ok(!seenDescs.has(sd), "duplicate short_description: " + sd);
    seenDescs.add(sd);
  }
});

// ---------- API path resolution ----------

test("skills: every imported name from a core module exists in that module", () => {
  const failures = [];
  for (const skill of skills) {
    const skillMd = join(PLUGIN_ROOT, "skills", skill, "SKILL.md");
    const text = readText(skillMd);
    const imports = parseSkillImports(text);
    for (const imp of imports) {
      const abs = resolveImportPath(imp.fromPath);
      if (abs === null) {
        failures.push(skill + ": non-core import '" + imp.fromPath + "' (expected ../../../../core/src/ prefix)");
        continue;
      }
      if (!existsSync(abs)) {
        failures.push(skill + ": import path not found " + imp.fromPath + " -> " + abs);
        continue;
      }
      const exports = listExports(abs);
      for (const name of imp.names) {
        if (!exports.has(name)) failures.push(skill + ": " + imp.fromPath + " does not export " + name);
      }
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

// ---------- asset existence ----------

test("assets: every asset file is non-empty", () => {
  const dir = join(PLUGIN_ROOT, "assets");
  if (!existsSync(dir)) return;
  for (const f of walkFiles(dir)) {
    assert.ok(statSync(f).size > 0, "empty asset: " + relative(PLUGIN_ROOT, f));
  }
});

// ---------- README sanity ----------

test("README.md exists and references every skill", () => {
  const readme = join(PLUGIN_ROOT, "README.md");
  assert.ok(existsSync(readme));
  const text = readText(readme);
  for (const skill of skills) {
    assert.ok(text.includes(skill), "README.md does not mention " + skill);
  }
});
