/**
 * Kinetra composition toolkit: compose any 2D diagram from parts, with
 * relations, formulas with units, declared checks and an overlap gate.
 * Additive to the template renderers; see docs/toolkit/engine.md.
 */
export { compose } from "./compose.js";
export { KIT_PARTS as TOOLKIT_PART_CATALOG, PART_SAMPLES as TOOLKIT_PART_SAMPLES, definePart as defineToolkitPart, routeOrthogonal as toolkitRouteOrthogonal } from "./parts/index.js";
export type { Category as ToolkitPartCategory, Geo as ToolkitPartGeometry, KitDef as ToolkitKitDef, Prim as ToolkitPrim, Sample as ToolkitPartSample } from "./parts/index.js";
export type { ComposeReport, ComposeResult } from "./compose.js";
export type { CheckResult } from "./checks.js";
export { TOOLKIT_ERROR_CODES, ToolkitFailure } from "./errors.js";
export type { ToolkitErrorCode, ToolkitIssue } from "./errors.js";
export { evalQuantity as toolkitEvalQuantity, dimLabel as toolkitDimLabel, variableScope as toolkitVariableScope } from "./expr.js";
export type { TkQuantity, QDim, Scope as ToolkitScope } from "./expr.js";
export { registerPart, getPart as getToolkitPart, listParts as listToolkitParts, textBox as toolkitTextBox, lengthProp, angleProp, colorProp, strokeWidthProp, boolProp, COMMON_KEYS as TOOLKIT_COMMON_KEYS, ARROW_HEAD as TOOLKIT_ARROW_HEAD } from "./parts.js";
export type { PartDefinition, PartInstance, PartContext, ViewMap, ArrowQuantity, LinkLookup } from "./parts.js";
export type { CollisionShape } from "./geometry.js";
export { formatLabelText, measureLabelWidth } from "./text_metrics.js";
export { formatLabelMarkup, plainLabelText, renderScriptTspans as toolkitRenderScriptTspans } from "./text_metrics.js";
export * from "./style.js";
export type { ComposeModel, ElementSpec, Relation, LabelSpec, LabelPosition, CheckSpec, PointRef, NumLike, ScaleSpec, Side } from "./types.js";
