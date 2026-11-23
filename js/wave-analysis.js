// 量浪的純計算：把手機收集到的加速度與傾斜角度，換算成上下起伏、週期、晃動角度與兩者的時間差。
// 不碰畫面、不碰感測器，所以可以在 Node 裡測試。

const FS = 10; // 重新取樣的頻率（每秒 10 點）
const MAX_GAP_MS = 1000; // 相鄰兩筆資料隔超過 1 秒，視為中斷
const MIN_SECONDS = 30;
const MIN_RATE = 20; // 每秒至少 20 筆
const WELCH_SEG = 256;

// 帶通權重：只留週期約 2 到 20 秒的擺動（浪的範圍），兩端用餘弦慢慢降到 0，減少振鈴
function bandWeight(f) {
  if (f < 0.05) return 0;
  if (f < 0.08) return 0.5 * (1 - Math.cos((Math.PI * (f - 0.05)) / 0.03));
  if (f <= 0.4) return 1;
  if (f < 0.55) return 0.5 * (1 + Math.cos((Math.PI * (f - 0.4)) / 0.15));
  return 0;
}

const nextPow2 = (n) => { let p = 1; while (p < n) p *= 2; return p; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

// 線性內插成等間隔：t 是毫秒（遞增），回傳從 t[0] 開始、每 1000/fs 毫秒一點的陣列
export function resample(t, x, fs = FS) {
  const n = Math.floor(((t[t.length - 1] - t[0]) / 1000) * fs) + 1;
  const out = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const tt = t[0] + (i * 1000) / fs;
    while (j < t.length - 2 && t[j + 1] < tt) j++;
    const span = t[j + 1] - t[j];
    const f = span > 0 ? (tt - t[j]) / span : 0;
    out[i] = x[j] + Math.min(1, Math.max(0, f)) * (x[j + 1] - x[j]);
  }
  return out;
}

// 原地 FFT（長度必須是 2 的次方），正轉換用 e^(−i…)
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

// 去掉平均與線性趨勢
function detrend(x) {
  const n = x.length, out = new Float64Array(n);
  const tm = (n - 1) / 2, xm = mean(x);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (i - tm) * (x[i] - xm); den += (i - tm) * (i - tm); }
  const b = den > 0 ? num / den : 0;
  for (let i = 0; i < n; i++) out[i] = x[i] - xm - b * (i - tm);
  return out;
}

// 兩端各 10% 套餘弦窗
function taper(x) {
  const n = x.length, m = Math.max(1, Math.round(n * 0.1));
  for (let i = 0; i < m; i++) {
    const w = 0.5 * (1 - Math.cos((Math.PI * i) / m));
    x[i] *= w; x[n - 1 - i] *= w;
  }
  return x;
}

// 帶通（integrate＝true 時再除以 (2πf)²，把加速度換成位移；加速度往上為正，位移也往上為正）
function bandPass(x, fs, integrate) {
  const n = x.length, L = nextPow2(2 * n);
  const re = new Float64Array(L), im = new Float64Array(L);
  re.set(taper(detrend(x)));
  fft(re, im);
  for (let k = 0; k < L; k++) {
    const f = ((k <= L / 2 ? k : L - k) * fs) / L;
    let g = bandWeight(f);
    if (integrate) g = f > 0 ? -g / (2 * Math.PI * f) ** 2 : 0;
    re[k] *= g; im[k] *= g;
  }
  // 反轉換：取共軛、正轉換、再取共軛並除以 L
  for (let k = 0; k < L; k++) im[k] = -im[k];
  fft(re, im);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = re[i] / L;
  return out;
}

// 上零交越分析：從下往上穿過 0 算一道浪；H＝這道浪最高減最低，T＝兩次穿越的時間差（秒）
export function zeroUpCross(x, fs = FS) {
  const cross = [];
  for (let i = 1; i < x.length; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) cross.push({ i, t: (i - 1 + -x[i - 1] / (x[i] - x[i - 1])) / fs });
  }
  const waves = [];
  for (let c = 0; c + 1 < cross.length; c++) {
    let hi = -Infinity, lo = Infinity;
    for (let i = cross[c].i; i < cross[c + 1].i; i++) { if (x[i] > hi) hi = x[i]; if (x[i] < lo) lo = x[i]; }
    waves.push({ H: hi - lo, T: cross[c + 1].t - cross[c].t });
  }
  return waves;
}

// 中間值：由小排到大取中間；偶數個取中間兩個的平均
export function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// 最高三分之一的平均（示性值）
function topThird(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => b - a);
  return mean(s.slice(0, Math.max(1, Math.round(s.length / 3))));
}

// Welch 法交叉頻譜：在起伏功率最大的頻率，算左右搖領先起伏幾度與兩者的相關程度（0–1）
function crossPhase(eta, phi) {
  const L = WELCH_SEG, step = L / 2, half = L / 2;
  const See = new Float64Array(half), Spp = new Float64Array(half), Sr = new Float64Array(half), Si = new Float64Array(half);
  let segs = 0;
  for (let s = 0; s + L <= eta.length; s += step) {
    const er = new Float64Array(L), ei = new Float64Array(L), pr = new Float64Array(L), pi = new Float64Array(L);
    const me = mean(eta.subarray(s, s + L)), mp = mean(phi.subarray(s, s + L));
    for (let i = 0; i < L; i++) {
      const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (L - 1)));
      er[i] = (eta[s + i] - me) * w; pr[i] = (phi[s + i] - mp) * w;
    }
    fft(er, ei); fft(pr, pi);
    for (let k = 1; k < half; k++) {
      See[k] += er[k] * er[k] + ei[k] * ei[k];
      Spp[k] += pr[k] * pr[k] + pi[k] * pi[k];
      // conj(Η)·Φ
      Sr[k] += er[k] * pr[k] + ei[k] * pi[k];
      Si[k] += er[k] * pi[k] - ei[k] * pr[k];
    }
    segs++;
  }
  if (!segs) return { phase: null, coherence: 0 };
  let kp = 1;
  for (let k = 2; k < half; k++) if (See[k] > See[kp]) kp = k;
  if (!(See[kp] > 0) || !(Spp[kp] > 0)) return { phase: null, coherence: 0 };
  const coherence = (Sr[kp] * Sr[kp] + Si[kp] * Si[kp]) / (See[kp] * Spp[kp]);
  const phase = (((Math.atan2(Si[kp], Sr[kp]) * 180) / Math.PI) + 360) % 360;
  return { phase, coherence };
}

export function analyzeWaves({ t, av, roll }) {
  const n = t.length;
  if (n < 2) return { ok: false, reason: '太短' };
  for (let i = 1; i < n; i++) if (t[i] - t[i - 1] > MAX_GAP_MS) return { ok: false, reason: '中斷' };
  const seconds = (t[n - 1] - t[0]) / 1000;
  if (seconds < MIN_SECONDS) return { ok: false, reason: '太短' };
  const rate = (n - 1) / seconds;
  if (rate < MIN_RATE) return { ok: false, reason: '取樣太少' };

  const eta = bandPass(resample(t, av), FS, true);
  const phi = bandPass(resample(t, roll), FS, false);
  // 兩端套過窗、也受頻域積分的頭尾效應影響，只用中間 80%
  const a = Math.round(eta.length * 0.1), b = Math.round(eta.length * 0.9);
  const etaMid = eta.subarray(a, b), phiMid = phi.subarray(a, b);

  const hw = zeroUpCross(etaMid);
  const rw = zeroUpCross(phiMid);
  // 陸上測試每次高度相同，要比平均或中間值；最高三分之一會把單道誤差放大
  const heights = hw.map((w) => w.H);
  const Hmean = heights.length ? mean(heights) : 0;
  const Hmed = median(heights);
  const A = topThird(heights);
  const T = hw.length ? mean(hw.map((w) => w.T)) : 0;
  const R = topThird(rw.map((w) => w.H / 2));
  const { phase, coherence } = crossPhase(etaMid, phiMid);
  const waves = hw.length;
  const quality = waves >= 12 ? '好' : waves >= 8 ? '普通' : '不好';
  return { ok: true, A, Hmean, Hmed, heights, T, R, phase, coherence, waves, rate, seconds, quality };
}
