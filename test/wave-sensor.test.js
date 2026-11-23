import test from 'node:test';
import assert from 'node:assert/strict';
import { WaveRecorder } from '../js/wave-sensor.js';

const motion = (ts, up) => ({ timeStamp: ts, acceleration: { x: 0, y: 0, z: up }, accelerationIncludingGravity: { x: 0, y: 0, z: up + 9.81 } });

test('垂直加速度＝沿重力方向的分量', () => {
  const r = new WaveRecorder({ rodSide: 'right' }); r.onOrientation({ gamma: 2 }); r.onMotion(motion(0, 0.5));
  assert.equal(r.samples().av[0], 0.5);
});
test('竿子在右邊：右側抬起（gamma 為負）算正', () => {
  const r = new WaveRecorder({ rodSide: 'right' }); r.onOrientation({ gamma: -3 }); r.onMotion(motion(0, 0));
  assert.equal(r.samples().roll[0], 3);
  const l = new WaveRecorder({ rodSide: 'left' }); l.onOrientation({ gamma: -3 }); l.onMotion(motion(0, 0));
  assert.equal(l.samples().roll[0], -3);
});
test('事件沒有時間戳記時改用 performance.now()', () => {
  const r = new WaveRecorder({ rodSide: 'right' });
  const e = { acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 } };
  r.onMotion(e); const until = performance.now() + 5; while (performance.now() < until); r.onMotion(e);
  const t = r.samples().t;
  assert.ok(Number.isFinite(t[0]) && t[1] > t[0], JSON.stringify(t));
});
test('中斷後不再收資料', () => {
  const r = new WaveRecorder({ rodSide: 'right' }); r.abort('切到別的 APP'); r.onMotion(motion(0, 1));
  assert.equal(r.samples().t.length, 0); assert.equal(r.aborted, '切到別的 APP');
});
