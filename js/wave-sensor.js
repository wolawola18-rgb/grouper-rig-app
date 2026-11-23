// 量浪的瀏覽器端：要求感測器權限、收集動作與傾斜資料、讓螢幕保持亮著。
// WaveRecorder 只吃事件物件，不直接碰 window，所以可以用假的事件在 Node 裡測試。

export function sensorSupport() {
  const w = globalThis;
  const motion = typeof w.DeviceMotionEvent !== 'undefined';
  const orientation = typeof w.DeviceOrientationEvent !== 'undefined';
  const needsPermission = motion && typeof w.DeviceMotionEvent.requestPermission === 'function';
  return { motion, orientation, needsPermission, secure: !!w.isSecureContext };
}

// 只能在按鈕的 click 處理函式裡呼叫：iPhone 規定要使用者按下按鈕的當下才可以要求權限。
// 兩個權限要同時發出，不能等第一個回來才要第二個，否則第二個會失去「使用者剛按下」的資格。
export async function requestSensors() {
  const w = globalThis;
  if (typeof w.DeviceMotionEvent === 'undefined') return 'unsupported';
  const asks = [];
  if (typeof w.DeviceMotionEvent.requestPermission === 'function') asks.push(w.DeviceMotionEvent.requestPermission());
  if (typeof w.DeviceOrientationEvent?.requestPermission === 'function') asks.push(w.DeviceOrientationEvent.requestPermission());
  try {
    const res = await Promise.all(asks);
    return res.every((r) => r === 'granted') ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

// 讓螢幕在量測時不要自動關掉；瀏覽器不支援或拒絕時回傳 null
export async function keepScreenOn() {
  try {
    if (globalThis.navigator?.wakeLock?.request) {
      const s = await globalThis.navigator.wakeLock.request('screen');
      return { release: () => s.release().catch(() => {}) };
    }
  } catch {
    // 交給呼叫端顯示「請把自動鎖定改長」
  }
  return null;
}

// 收集一次量測的資料。
// av：沿重力方向的加速度（往上為正）；roll：竿子那側抬起為正（手機頂端朝船頭時，手機右緣＝船的右舷）。
// W3C 規格：手機往右側傾（右緣往下）gamma 為正，所以竿子在右邊時「竿子那側抬起」＝ −gamma。
export class WaveRecorder {
  constructor({ rodSide }) {
    this.side = rodSide === 'left' ? 'left' : 'right';
    this.t = []; this.av = []; this.roll = []; this.raw = [];
    this.gamma = null; this.beta = null;
    this.noLinear = false; // 手機不提供去掉重力的加速度
    this._aborted = null;
  }

  onOrientation(e) {
    if (this._aborted) return;
    if (e.gamma != null) this.gamma = e.gamma;
    if (e.beta != null) this.beta = e.beta;
  }

  onMotion(e) {
    if (this._aborted) return;
    const a = e.acceleration, ag = e.accelerationIncludingGravity;
    if (!a || a.x == null || !ag || ag.x == null) { this.noLinear = true; return; }
    const gx = ag.x - a.x, gy = ag.y - a.y, gz = ag.z - a.z;
    const gn = Math.sqrt(gx * gx + gy * gy + gz * gz);
    if (!(gn > 0)) return;
    const gamma = this.gamma ?? 0;
    // 有些瀏覽器的事件沒有時間戳記（0 或缺少），改用頁面時鐘，否則所有資料會擠在同一個時間點
    const ts = e.timeStamp > 0 ? e.timeStamp : globalThis.performance.now();
    this.t.push(ts);
    this.av.push((a.x * gx + a.y * gy + a.z * gz) / gn);
    this.roll.push(this.side === 'right' ? -gamma : gamma);
    this.raw.push([ts, a.x, a.y, a.z, ag.x, ag.y, ag.z, this.gamma, this.beta]);
  }

  abort(reason) { this._aborted = reason; }

  samples() { return { t: [...this.t], av: [...this.av], roll: [...this.roll] }; }

  get count() { return this.t.length; }
  get seconds() { const n = this.t.length; return n < 2 ? 0 : (this.t[n - 1] - this.t[0]) / 1000; }
  get rate() { const s = this.seconds; return s > 0 ? (this.t.length - 1) / s : 0; }
  get aborted() { return this._aborted; }

  // 原始資料（逗號分隔），給使用者匯出回傳分析
  csv() {
    const head = 't_ms,ax,ay,az,agx,agy,agz,gamma,beta';
    const fmt = (v) => (v == null ? '' : Number(v).toFixed(4));
    return [head, ...this.raw.map((r) => r.map(fmt).join(','))].join('\n');
  }
}
