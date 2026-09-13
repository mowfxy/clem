/**
 * Plot specification. The AI emits these specs; the renderer consumes them.
 */

import type { Expr } from "../math/expression.js";

export type PlotType =
  | "function2d"
  | "parametric2d"
  | "polar"
  | "scatter"
  | "histogram"
  | "piecewise2d"
  | "vector-field2d"
  | "complex"
  | "surface3d"
  | "contour";

export interface AxisSpec {
  label?: string;
  unit?: string;
  scale?: "linear" | "log" | "symlog";
  limits?: [number, number];
  grid?: boolean;
  ticks?: number[];
}

export interface FunctionSpec {
  expression: Expr;
  label: string;
  color?: string;
  style?: "solid" | "dashed" | "dotted";
}

export interface DataPoint {
  x: number;
  y: number;
  yerr?: number;
  xerr?: number;
  label?: string;
}

export interface PlotSpec {
  id: string;
  title: string;
  type: PlotType;
  xRange: [number, number];
  yRange?: [number, number];
  xAxis: AxisSpec;
  yAxis: AxisSpec;
  functions?: FunctionSpec[];
  parametric?: { x: Expr; y: Expr; var: string; tRange: [number, number]; label: string; color?: string };
  polar?: { expression: Expr; var: string; tRange: [number, number] };
  data?: DataPoint[];
  histogram?: { bins: number[]; counts: number[]; label: string };
  vectorField?: { xExpr: Expr; yExpr: Expr; xVar: string; yVar: string; gridSize: number; xRange: [number, number]; yRange: [number, number] };
  surface?: { xExpr: Expr; yExpr: Expr; zExpr: Expr; xVar: string; yVar: string; xRange: [number, number]; yRange: [number, number] };
  showLegend?: boolean;
  size?: { width: number; height: number };
}
