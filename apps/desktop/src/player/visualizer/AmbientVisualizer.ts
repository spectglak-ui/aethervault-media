// 0.6.0 — Fond animé AetherFy : maillage low-poly facetté (style
// « verre noir ») adapté au dégradé de l'overlay (#0d0b12 → #17131f →
// #2b1e57, reflets lavande). Les basses font onduler et frapper la
// surface (onde radiale sur les kicks), les médiums accélèrent la
// houle, les aigus allument arêtes et reflets spéculaires.
// 0.6.1 — mode pause : l'énergie audio s'estompe en douceur vers une
// houle résiduelle lente (transition ~0,5 s), au lieu de figer le
// canvas d'un coup (clearRect).

export type SpectrumFrame = {
  bands: number[];
  bass: number;
  mid: number;
  treble: number;
  pulse: number;
};

const COLS = 22;
const ROWS = 13;
const TAU = Math.PI * 2;

const DARK: readonly number[] = [13, 11, 18];     // #0d0b12
const PURPLE: readonly number[] = [43, 30, 87];   // #2b1e57
const EDGE: readonly number[] = [205, 195, 255];  // arêtes lavande
const SPEC: readonly number[] = [232, 228, 255];  // reflets

/** Houle de fond : somme de sinusoïdes (bruit cheap, régulier, sans dep). */
function field(u: number, v: number, t: number): number {
  return (
    Math.sin(u * 1.7 + t * 0.9) * Math.cos(v * 1.3 - t * 0.6) * 0.55 +
    Math.sin((u + v) * 2.1 - t * 1.2) * 0.28 +
    Math.cos(u * 3.9 + t * 1.6) * Math.sin(v * 3.1 + t * 1.05) * 0.18 +
    Math.sin(u * 6.7 - v * 5.3 + t * 2.2) * 0.1
  );
}

export class AmbientVisualizer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private running = false;
  private raf = 0;
  private smoothBass = 0;
  private smoothMid = 0;
  private smoothTreble = 0;
  private pulse = 0;
  /** 0.6.1 : true = lecture, false = pause (transition d'énergie). */
  private active = true;
  private energy = 1;
  private curTreble = 0;
  private curPulse = 0;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private t = 0;
  private lastNow = 0;
  private readonly n = (COLS + 1) * (ROWS + 1);
  private zs = new Float32Array(this.n);
  private xs = new Float32Array(this.n);
  private ys = new Float32Array(this.n);

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D non supporté");
    this.ctx = ctx;
    addEventListener("resize", this.resize);
    this.resize();
  }

  private resize = () => {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = window.innerWidth * this.dpr;
    this.canvas.height = window.innerHeight * this.dpr;
  };

  /** 0.6.1 : pilote la transition lecture ↔ pause. */
  setActive(active: boolean) {
    this.active = active;
  }

  setFrame(f: SpectrumFrame) {
    const a = (target: number, current: number) =>
      current + (target - current) * (target > current ? 0.45 : 0.08);
    this.smoothBass = a(f.bass, this.smoothBass);
    this.smoothMid = a(f.mid, this.smoothMid);
    this.smoothTreble = a(f.treble, this.smoothTreble);
    this.pulse = Math.max(this.pulse * 0.92, f.pulse);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastNow = performance.now();
    const tick = () => {
      if (!this.running) return;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  destroy() {
    this.stop();
    removeEventListener("resize", this.resize);
  }

  private idx(ix: number, iy: number) {
    return iy * (COLS + 1) + ix;
  }

  private draw() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastNow) / 1000));
    this.lastNow = now;

    // 0.6.1 : l'énergie suit la pause/lecture en douceur (~0,5 s).
    this.energy += ((this.active ? 1 : 0) - this.energy) * Math.min(1, dt * 2.2);
    const e = this.energy;
    const bass = this.smoothBass * e;
    const mid = this.smoothMid * e;
    this.curTreble = this.smoothTreble * e;
    this.curPulse = this.pulse * e;

    // La houle ne s'arrête jamais : vitesse plancher en pause.
    if (!this.reduced) this.t += dt * (0.18 + 0.35 * e + mid * 1.1);

    const amp = 0.1 + 0.16 * e + bass * 0.85 + this.curPulse * 0.4;
    const kickPhase = (now / 1000) * 9;

    for (let iy = 0; iy <= ROWS; iy++) {
      const v = iy / ROWS;
      for (let ix = 0; ix <= COLS; ix++) {
        const u = ix / COLS;
        const i = this.idx(ix, iy);
        let z = amp * field(u * TAU, v * TAU, this.t);
        const d = Math.hypot(u - 0.5, (v - 0.5) * 0.8);
        z += this.curPulse * 0.45 * Math.sin(d * 9 - kickPhase) * Math.exp(-d * 2.4);
        this.zs[i] = z;
        this.xs[i] = (u + z * 0.045 * (u - 0.5)) * w;
        this.ys[i] = (v + z * 0.045 * (v - 0.5)) * h;
      }
    }

    ctx.clearRect(0, 0, w, h);
    const lx = -0.45, ly = -0.55, lz = 0.7;
    for (let iy = 0; iy < ROWS; iy++) {
      for (let ix = 0; ix < COLS; ix++) {
        this.tri(ix, iy, ix + 1, iy, ix, iy + 1, lx, ly, lz);
        this.tri(ix + 1, iy, ix + 1, iy + 1, ix, iy + 1, lx, ly, lz);
      }
    }
  }

  private tri(
    ax: number, ay: number,
    bx: number, by: number,
    cx: number, cy: number,
    lx: number, ly: number, lz: number,
  ) {
    const A = this.idx(ax, ay);
    const B = this.idx(bx, by);
    const C = this.idx(cx, cy);
    const { ctx, xs, ys, zs } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const k = 2.2;
    const u1 = (xs[B] - xs[A]) / w, v1 = (ys[B] - ys[A]) / h, w1 = (zs[B] - zs[A]) * k;
    const u2 = (xs[C] - xs[A]) / w, v2 = (ys[C] - ys[A]) / h, w2 = (zs[C] - zs[A]) * k;
    let nx = v1 * w2 - w1 * v2;
    let ny = w1 * u2 - u1 * w2;
    let nz = u1 * v2 - v1 * u2;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

    const lam = Math.max(0, nx * lx + ny * ly + nz * lz);
    const spec =
      Math.pow(lam, 12) * (0.3 + this.curTreble * 0.9) +
      this.curPulse * 0.1 * Math.pow(lam, 3);
    const shade = 0.18 + 0.82 * lam;

    let r = DARK[0] + (PURPLE[0] - DARK[0]) * shade + SPEC[0] * spec;
    let g = DARK[1] + (PURPLE[1] - DARK[1]) * shade + SPEC[1] * spec;
    let b = DARK[2] + (PURPLE[2] - DARK[2]) * shade + SPEC[2] * spec;
    r = Math.min(255, r); g = Math.min(255, g); b = Math.min(255, b);

    ctx.beginPath();
    ctx.moveTo(xs[A], ys[A]);
    ctx.lineTo(xs[B], ys[B]);
    ctx.lineTo(xs[C], ys[C]);
    ctx.closePath();
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fill();

    const ea = 0.1 + 0.35 * spec + 0.1 * this.curTreble;
    ctx.strokeStyle = `rgba(${EDGE[0]},${EDGE[1]},${EDGE[2]},${ea.toFixed(3)})`;
    ctx.lineWidth = Math.max(1, this.dpr * 0.75);
    ctx.stroke();
  }
}