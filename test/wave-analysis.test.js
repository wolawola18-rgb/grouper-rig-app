import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWaves } from '../js/wave-analysis.js';

// 60 Hz、時間戳加 ±3 毫秒抖動；起伏 H（峰到谷）、週期 T、左右搖 R 度、左右搖領先 ph 度
function synth({ H = 1, T = 6, R = 3, ph = 90, dur = 120, noise = 0 } = {}) {
  const t = [], av = [], roll = []; let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let ms = 0; ms <= dur * 1000; ms += 1000 / 60) {
    const tt = ms + rnd() * 6, w = (2 * Math.PI) / T, x = (w * tt) / 1000;
    t.push(tt); av.push(-(H / 2) * w * w * Math.sin(x) + noise * rnd()); roll.push(R * Math.sin(x + (ph * Math.PI) / 180));
  }
  return { t, av, roll };
}

test('規則浪 1 公尺、6 秒、3 度、領先 90 度', () => {
  const r = analyzeWaves(synth());
  assert.ok(r.ok && Math.abs(r.A - 1) < 0.05 && Math.abs(r.T - 6) < 0.2 && Math.abs(r.R - 3) < 0.15, JSON.stringify(r));
  assert.ok(Math.abs(r.phase - 90) < 10 && r.coherence > 0.9 && r.waves >= 12 && r.quality === '好', JSON.stringify(r));
});
test('結果附上每道浪的高度、平均與中間值', () => {
  const r = analyzeWaves(synth({ H: 0.73, T: 5 }));
  assert.equal(r.heights.length, r.waves);
  assert.ok(Math.abs(r.Hmean - 0.73) < 0.03 && Math.abs(r.Hmed - 0.73) < 0.03, JSON.stringify(r));
});
test('中間值：偶數道取中間兩道的平均', async () => {
  const { median } = await import('../js/wave-analysis.js');
  assert.ok(Math.abs(median([0.61, 0.71, 0.68, 1.01, 1.18, 0.68, 0.64, 0.78, 0.65, 1.03]) - 0.695) < 1e-12);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([]), 0);
});
test('陸上測試：0.75 公尺、5 秒', () => {
  const r = analyzeWaves(synth({ H: 0.75, T: 5 }));
  assert.ok(Math.abs(r.A - 0.75) < 0.05, JSON.stringify(r));
});
test('只有雜訊：起伏小於 5 公分', () => {
  const r = analyzeWaves(synth({ H: 0, R: 0, noise: 0.04 }));
  assert.ok(r.A < 0.05, JSON.stringify(r));
});
test('少於 30 秒 → 太短', () => assert.equal(analyzeWaves(synth({ dur: 20 })).reason, '太短'));
test('中間斷掉 2 秒 → 中斷', () => {
  const d = synth(); const cut = (a) => a.filter((_, i) => i < 3000 || i > 3120);
  assert.equal(analyzeWaves({ t: cut(d.t), av: cut(d.av), roll: cut(d.roll) }).reason, '中斷');
});
