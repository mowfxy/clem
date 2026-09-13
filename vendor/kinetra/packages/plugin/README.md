# Kinetra Codex Plugin

Local-first technical learning workbench for Codex. This plugin exposes
six skills that route into Kinetra's deterministic TypeScript core for
Karnaugh maps, DC/transient circuit analysis, physics diagrams, lexical
+ vector retrieval, study-plan generation, and quiz/exam generation.

The diagram skill also supports shaded charged-rod apparatus illustrations,
including attraction and repulsion. Run `npm run diagram` or
`npm run examples:diagrams` from the repository root. Supported physics models
and their limits are documented in [the diagram guide](../../docs/diagrams.md).
Deterministic output is not a guarantee that a user-supplied physical model is correct.

## Layout

```
packages/plugin/
+- .codex-plugin/
|  +- plugin.json          # Codex plugin manifest
+- assets/
|  +- kinetra-icon.svg     # composer icon
|  +- kinetra-logo.png     # logo
+- skills/
|  +- kinetra-kmap/        # Boolean minimization, Karnaugh maps
|  +- kinetra-circuits/    # DC + transient circuit solver + schematic
|  +- kinetra-diagrams/    # 2D physics diagrams (FBD, projectile, pulley, optics, fields)
|  +- kinetra-retrieval/   # Hybrid lexical + vector retrieval, benchmark
|  +- kinetra-study-plan/  # Ingest -> chunk -> mastery -> spaced study plan PDF
|  +- kinetra-assess/      # Quiz / exam / flashcard generation with mastery
+- test/
|  +- plugin_structure.test.ts   # node --test self-tests for the plugin manifest + skills
+- README.md
```

## Skills

| Skill | Purpose | Triggers on |
| --- | --- | --- |
| `kinetra-kmap` | Build a 2-4 variable K-map, simplify SOP/POS, render truth table | user asks to minimize a Boolean expression, build a K-map, or verify a truth table |
| `kinetra-circuits` | Solve DC operating point and transient for RC/RL/RLC circuits with the pure-TS SPICE-lite solver | user describes an RC/RL/RLC/RLC+source circuit and asks for V(t), I(t), or a schematic |
| `kinetra-diagrams` | Render a 2D physics diagram (free body, projectile, pulley, optics, fields) to SVG | user describes a physics setup and wants a labeled diagram |
| `kinetra-retrieval` | Ingest a local corpus, build a hybrid (lexical + vector) index, run benchmark | user wants to query local lecture notes, papers, or transcripts |
| `kinetra-study-plan` | Build a spaced-repetition study plan PDF from a topic list, track mastery over time | user wants a study plan, syllabus tracker, or revision schedule |
| `kinetra-assess` | Generate quiz / exam / flashcards from topics, score attempts, update mastery | user wants practice questions, an exam, or flashcards for a topic |

## How to test

From the repo root:

```bash
node --test --experimental-strip-types packages/plugin/test/plugin_structure.test.ts
```

This validates the manifest, the skill folders, the YAML frontmatter, the
`agents/openai.yaml` UI metadata, the assets, and that every skill
description is non-empty and unique.
