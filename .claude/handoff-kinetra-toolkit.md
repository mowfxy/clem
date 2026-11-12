# Handoff: wire the upgraded Kinetra (composition toolkit) into Clem, lean prompts, then PR

The user asked for four things: (1) wire the upgraded Kinetra fully into Clem, (2) make the AI know exactly how to use Clem without dumbness, (3) keep instructions lean, so the AI gets only what it needs, and (4) prefer Kinetra over the generic ```visual diagrams. When that is done, check the integration in the main app and open a PR.
The PR must also include the two earlier threads' uncommitted work: `.claude/handoff-figures-memory-files.md` and `HANDOFF-maths-edits.md`. Read both. Everything is uncommitted on `main`, so branch before committing.

## Where the upgrade is
- Upstream Kinetra: `C:\Users\moham\Desktop\Vibe\VibeTooling\Kinetra`, branch `main` at `00c2bd4`. It merged the toolkit: `compose(model)`, 92 parts, the router, checks, the overlap gate, the `kinetra-compose` skill, `docs/toolkit/{rules,parts,engine}.md` and 30 proof examples in `examples/toolkit/proof/*.json`.
- Clem's vendored copy was upstream `d2bb98f` plus the Clem patches in `vendor/kinetra/CLEM_PATCHES.md`.
- I did a 3-way merge in a scratch clone (`...\scratchpad\kmerge`, branch `clem`). Upstream did not touch any Clem-patched core file. The one conflict, in kinetra-circuits SKILL.md, keeps Clem's renderCircuit step 5 and adds upstream's step 6.

## DONE (uncommitted, in this checkout)
- Copied into `vendor/kinetra/`:
  - `packages/core/src/toolkit/` (with `parts/`) and the `toolkit/index.js` export in `core/src/index.ts`
  - `core/test/toolkit/`, `core/tsconfig.toolkit.json`
  - `cli/src/workflows/compose.ts` and `cli/src/bin/kinetra.ts`
  - `plugin/skills/kinetra-compose/`, the merged `kinetra-circuits/SKILL.md` and the plugin `README.md`
  - `docs/toolkit/*.md` (without HANDOFF) and `examples/toolkit/`
- Deliberately NOT taken:
  - `kinetra-textbook-diagrams`: it needs Python/cairo, which Clem can't run.
  - Upstream's `kinetra-diagrams/SKILL.md`, `docs/diagrams.md` and `plugin.json` text: they point at that Python skill. I reverted them to Clem's versions.
- Clem patch so that `renderScene2D` no longer re-places labels for callers that place their own:
  - `Scene2DModel.fixedLabels?: boolean` plus a `queue()` helper in `vendor/kinetra/packages/core/src/diagram/scene2d.ts`.
  - The toolkit's `compose.ts` sets `scene.fixedLabels = true`.
- Two toolkit tests were adapted to Clem's patches; the code is unchanged.
  - `parts_behaviour.test.ts` reads pins via `layoutSchematic(...).pins`, because Clem's schematic draws its wires as one path.
  - `priority_fixes.test.ts`: Clem's parser now gives `-3^2 = -9`.
  - Result: all 944 toolkit tests pass in the scratch merge. They were not yet re-run from the Clem vendor path (`node --experimental-strip-types --import ./vendor/kinetra/scripts/_register.mjs --test vendor/kinetra/packages/core/test/toolkit/*.test.ts`).
  - The upstream `compat` goldens were not copied: Clem's renderer output intentionally differs.
- TODO for CLEM_PATCHES.md: add the fixedLabels patch and the two test changes.
- Unrelated fix the user reported mid-task: the "Keep 7" backup select was glitchy. It now uses a drawn chevron, a 36px height, centred text, and the same frame as the Off/Daily/Weekly switch (`src/settings/settings-window.css`, `.st select.backup-keep`). Not yet checked visually; `scripts/verify/backups.mjs` may help.

## TODO: wiring (desktop/)
1. `desktop/kinetra-adapters.ts`: add
   - `compose(model)`: return the SVG string when `ok`. Otherwise throw one Error listing every issue as `code [elements]: message Fix: suggestion`, so figure, PDF and chat errors go back to the model.
   - `composeCheck(model)`: return `{ok, checks:[label/expected/actual/pass], errors}` for stating what was verified.
   - `composeParts(names | category)`: return only the requested parts from `TOOLKIT_PART_CATALOG`: type, aliases, description, options, anchors. This is the lean on-demand reference; never send all of parts.md.
   - Import from `../vendor/kinetra/packages/core/src/toolkit/index`.
   - The worker imports adapters, so `clem` covers it.
   - `scripts/build-kinetra.mjs` already picks up the api for `toolkit/*`. It also loads every skill directory, so kinetra-compose gets in automatically.
2. `desktop/kinetra-runtime.ts` `kinetraTool`: make `{"action":"skill","name":"kinetra-compose"}` (alias "compose") return a Clem version: the SKILL.md rules and quick reference, plus how to call `{"module":"clem","fn":"compose","args":[model]}` and composeParts. Drop the import/npm lines. You can bundle the rules.md cheat-sheet through build-kinetra.mjs into generated/kinetra.json.
3. `desktop/kinetra-recipes.ts`: add topic-filtered compose recipes from `vendor/kinetra/examples/toolkit/proof/*.json`:
   - Recipe shape: `{name:"composed: Mohr's circle", figure:{module:"clem",fn:"compose",args:[model]}}`.
   - Add `recipeTopics` regexes, e.g. beam/shear/bending moment, truss, Mohr, stress–strain, Carnot/P-V, Bode, root locus, step response, block diagram/feedback, FSM/state machine, datapath, phasor/three-phase, op-amp, Wheatstone, Venturi/Bernoulli, refraction/TIR, standing wave, Minkowski, energy levels.
   - Skip the huge generated ones (15 dipole, maybe 23 root-locus) or keep them reachable only via the recipes action.
   - Make sure `tests/desktop/kinetra.test.ts` renders them through the real worker.
4. Extend the `kinetraIntent` regex in kinetra-runtime.ts with those engineering terms.
5. Check that `src/chat/KinetraFigure.tsx`, `answer-review.ts` figureProblems, PDF/docx/pptx figure validation and `/figure` accept `fn:"compose"`. Grep for any allowlist of clem fns.

## TODO: lean prompts and Kinetra first
- One failing desktop test is the budget: "Claude and Grok always see every tool". `systemPrompt(kinetraCompact)` + GROK_NOTE must be ≤ 24000 (`GROK_RULES_MAX`, `desktop/grok.ts`). kinetraCompact is 21971 chars.
- Plan:
  - Move the "Design:" paragraph (2414 chars) of `buildInstructions` into a `design` file guide in `desktop/file-guides.ts`. Send it via `fileGuidesFor` when the request describes a look (font, colour, columns, margins, page size, "like a …", modern, minimal) and via `{"action":"skill","name":"design"}`. Leave one line in the compact guide.
  - Compress "Figures in PDFs" (3498 chars) to about 1800 and add the compose route there.
- Other budgets: `capabilityIndex` < 2200 and `cliSystemPrompt(kinetraCliBrief)` < 3000.
- Add the compose route, in one short phrase each, to:
  - `figureLanguage` (core/answer-format.ts)
  - `visualChoice` and the figures playbook (core/clem-skills.ts)
  - the capabilityIndex "Figures" line
  - the kinetra-runtime "Chat figures" line
- The phrase: any technical figure no recipe covers (beams, trusses, Mohr, P–V, Bode, block diagrams, state machines, datapaths, phasors, op-amps…) → clem compose; ask for the kinetra-compose skill and composeParts first. A ```visual diagram is never used when Kinetra can draw it.

## Then
- Run `npm test`, `npm run test:desktop`, `npx tsc -b` and `tsc -p desktop/tsconfig.json`.
- Check it in the app safely. Follow the user's memory rule: never restart the installed Clem. Use the fixture `node --experimental-strip-types --import ./vendor/kinetra/scripts/_register.mjs scripts/verify/chat-files-popup.mjs` and render a ```kinetra compose figure there.
- Branch (e.g. `kinetra-toolkit-integration`), commit everything (both earlier handoffs' work + this), push, and open the PR with `gh`. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR footer: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
