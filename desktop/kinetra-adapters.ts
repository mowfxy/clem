import { parseExpr } from "../vendor/kinetra/packages/core/src/math/expression";
import { evaluate } from "../vendor/kinetra/packages/core/src/math/eval";
import { integrate } from "../vendor/kinetra/packages/core/src/math/calculus";
import {
  renderVectorField,
  renderScalarField,
  type VectorFieldModel,
  type ScalarFieldModel,
} from "../vendor/kinetra/packages/core/src/diagram/fields";
import { ingestText } from "../vendor/kinetra/packages/core/src/ingest/text";
import { chunkText } from "../vendor/kinetra/packages/core/src/ingest/chunk";
import {
  makeHybridIndex,
  addToHybridIndex,
  searchHybrid,
} from "../vendor/kinetra/packages/core/src/retrieval/hybrid";
/** JSON-friendly adapters. Expressions use Kinetra's parser, never eval or new Function. */
export function integrateExpression(
  expression: string,
  variable: string,
  from: number,
  to: number,
) {
  const ast = parseExpr(expression);
  if (![from, to].every(Number.isFinite)) throw Error("Finite bounds required");
  return integrate((x) => evaluate(ast, { vars: { [variable]: x } }), from, to);
}
export function vectorField(
  model: Omit<VectorFieldModel, "field"> & {
    xExpression: string;
    yExpression: string;
  },
) {
  const x = parseExpr(model.xExpression),
    y = parseExpr(model.yExpression);
  return renderVectorField({
    ...model,
    field: (p) => ({
      x: evaluate(x, { vars: { x: p.x, y: p.y } }),
      y: evaluate(y, { vars: { x: p.x, y: p.y } }),
    }),
  });
}
export function scalarField(
  model: Omit<ScalarFieldModel, "field"> & { expression: string },
) {
  const ast = parseExpr(model.expression);
  return renderScalarField({
    ...model,
    field: (p) => evaluate(ast, { vars: { x: p.x, y: p.y } }),
  });
}
/** Returns source text and locators; it does not read files or save an index. */
export function retrieve(
  documents: { title: string; text: string }[],
  query: string,
  limit = 5,
) {
  if (
    documents.length > 30 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw Error("Invalid retrieval size");
  const idx = makeHybridIndex();
  for (const doc of documents)
    for (const chunk of chunkText(ingestText(doc.text, doc.title)))
      addToHybridIndex(idx, chunk);
  return searchHybrid(idx, query, limit);
}
/** Printable revision dates. Subject mastery remains in Mowr's subject records. */
export function studySchedule(
  topics: string[],
  start: string,
  intervals = [1, 3, 7, 14, 30],
) {
  const at = Date.parse(start);
  if (
    !Number.isFinite(at) ||
    topics.length > 100 ||
    intervals.length > 30 ||
    intervals.some((d) => !Number.isInteger(d) || d < 0 || d > 3650)
  )
    throw Error("Invalid study schedule");
  return topics.map((topic) => ({
    topic,
    reviews: intervals.map((days) =>
      new Date(at + days * 86400000).toISOString().slice(0, 10),
    ),
  }));
}
