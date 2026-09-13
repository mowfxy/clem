export interface Complex { re: number; im: number; }

export function c(re: number, im: number = 0): Complex { return { re, im }; }
export function add(a: Complex, b: Complex): Complex { return { re: a.re + b.re, im: a.im + b.im }; }
export function sub(a: Complex, b: Complex): Complex { return { re: a.re - b.re, im: a.im - b.im }; }
export function mul(a: Complex, b: Complex): Complex { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
export function div(a: Complex, b: Complex): Complex {
  const den = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den };
}
export function abs(a: Complex): number { return Math.hypot(a.re, a.im); }
export function arg(a: Complex): number { return Math.atan2(a.im, a.re); }
export function conj(a: Complex): Complex { return { re: a.re, im: -a.im }; }
export function exp(a: Complex): Complex {
  const r = Math.exp(a.re);
  return { re: r * Math.cos(a.im), im: r * Math.sin(a.im) };
}
