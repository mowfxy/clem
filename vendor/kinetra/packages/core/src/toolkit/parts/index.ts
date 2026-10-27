/**
 * The toolkit part library. Importing this module registers every part.
 * See docs/toolkit/parts.md for the catalogue.
 */
import "./general.js";
import "./mechanics.js";
import "./fields.js";
import "./fluids.js";
import "./circuits.js";
import "./logic.js";
import "./plots.js";

export { KIT_PARTS, PART_SAMPLES, definePart, drawPrims, collidePrims } from "./kit.js";
export type { Category, Geo, KitDef, Prim, Sample } from "./kit.js";
export { routeOrthogonal } from "./general.js";
export { TEMPLATE_PINS } from "./circuits.js";
export { gateHeightUnits, gateTerminalsUnits } from "./logic.js";
export { autoTicks, axesMap, clipPolyline, polarMap } from "./plots.js";
