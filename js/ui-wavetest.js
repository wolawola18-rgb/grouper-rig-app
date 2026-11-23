// 量浪測試版頁面：開啟感測器 → 方向檢查 → 量測 → 顯示結果 → 匯出原始資料
import { analyzeWaves } from './wave-analysis.js';
import { sensorSupport, requestSensors, keepScreenOn, WaveRecorder } from './wave-sensor.js';

const $ = (id) => document.getElementById(id);
const NO_SENSOR = '這台裝置沒有動作感測器。請用 iPhone 的 Safari 打開這一頁。';
const REASON = {
  太短: '量測不到 30 秒，請再量一次。',
  中斷: '資料中間斷掉超過 1 秒，請再量一次，量的時候不要切換 APP。',
  取樣太少: '每秒收到的資料少於 20 筆，請再量一次。',
};
const state = { rec: null, timer: null, lock: null, stop: null, endAt: 0, dur: 120 };

function showAlert(msg) {
  const el = $('alert');
  el.textContent = msg;
  el.hidden = !msg;
  if (msg) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const checked = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// 方向檢查：W3C 規格中，右緣往下（左側抬起）gamma 為正
function onLiveTilt(e) {
  if (e.gamma == null) return;
  const g = e.gamma;
  $('tilt-text').textContent = g < -2 ? '右側抬起' : g > 2 ? '左側抬起' : '平放';
  $('tilt-deg').textContent = `（傾斜 ${Math.abs(g).toFixed(1)} 度）`;
}

// 開啟感測器後等第一筆資料：'ok'、'nolinear'（只有含重力的加速度）、'none'（沒有資料）
function waitForMotion(ms) {
  return new Promise((done) => {
    const finish = (v) => { window.removeEventListener('devicemotion', on); clearTimeout(timer); done(v); };
    const on = (e) => {
      if (e.acceleration && e.acceleration.x != null) finish('ok');
      else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) finish('nolinear');
    };
    const timer = setTimeout(() => finish('none'), ms);
    window.addEventListener('devicemotion', on);
  });
}

$('btn-sensor').addEventListener('click', async () => {
  showAlert('');
  const sup = sensorSupport();
  if (!sup.secure) return showAlert('要用 https 網址打開這一頁，才讀得到感測器。');
  if (!sup.motion) return showAlert(NO_SENSOR);
  // 權限要在按下按鈕的當下要求，前面不能有 await
  const perm = await requestSensors();
  if (perm === 'denied') return showAlert('沒有取得動作感測器的權限。請關掉這個分頁，重新打開網址，再按一次「開啟感測器」，跳出詢問時按「允許」。');
  if (perm === 'unsupported') return showAlert(NO_SENSOR);
  const first = await waitForMotion(2000);
  if (first === 'none') return showAlert(NO_SENSOR);
  if (first === 'nolinear') return showAlert('這支手機不提供去掉重力的加速度，量不了上下起伏。');
  window.addEventListener('deviceorientation', onLiveTilt);
  $('tilt').hidden = false;
  $('tilt-help').hidden = false;
  const b = $('btn-sensor');
  b.textContent = '感測器已開啟';
  b.disabled = true;
  $('btn-start').disabled = false;
  $('start-help').hidden = true;
});

function stopListening() {
  if (state.stop) state.stop();
  state.stop = null;
}

function finish() {
  stopListening();
  $('run').hidden = true;
  const s = $('btn-start');
  s.hidden = false;
  s.textContent = '再量一次';
  const rec = state.rec;
  if (rec.aborted) {
    showAlert(`這次量測中斷：${rec.aborted}。請再量一次。`);
    return;
  }
  const r = analyzeWaves(rec.samples());
  renderResult(r, rec);
}

$('btn-start').addEventListener('click', async () => {
  showAlert('');
  // 螢幕常亮也趁按下按鈕的當下要求
  const lockP = keepScreenOn();
  const rec = new WaveRecorder({ rodSide: checked('side') });
  state.rec = rec;
  state.dur = Number(checked('dur'));
  const onM = (e) => rec.onMotion(e);
  const onO = (e) => rec.onOrientation(e);
  const onVis = () => {
    if (document.visibilityState === 'hidden') { rec.abort('切到別的 APP 或螢幕關了'); finish(); }
  };
  window.addEventListener('devicemotion', onM);
  window.addEventListener('deviceorientation', onO);
  document.addEventListener('visibilitychange', onVis);
  state.stop = () => {
    window.removeEventListener('devicemotion', onM);
    window.removeEventListener('deviceorientation', onO);
    document.removeEventListener('visibilitychange', onVis);
    clearInterval(state.timer);
    if (state.lock) state.lock.release();
    state.lock = null;
  };
  $('btn-start').hidden = true;
  $('sec-result').hidden = true;
  $('run').hidden = false;
  state.endAt = performance.now() + state.dur * 1000;
  const tick = () => {
    const left = Math.max(0, (state.endAt - performance.now()) / 1000);
    $('countdown').textContent = mmss(Math.ceil(left));
    $('run-info').textContent = `已收到 ${rec.count} 筆，每秒 ${Math.round(rec.rate)} 筆`;
    if (left <= 0) finish();
  };
  tick();
  state.timer = setInterval(tick, 250);
  state.lock = await lockP;
  $('lock-note').hidden = !!state.lock;
});

$('btn-cancel').addEventListener('click', () => {
  if (state.rec) state.rec.abort('你按了取消');
  finish();
});

function row(label, value, explain) {
  return `<dt>${label}</dt><dd>${value}</dd>${explain ? `<p class="ex">${explain}</p>` : ''}`;
}

function renderResult(r, rec) {
  const el = $('result');
  if (!r.ok) {
    el.innerHTML = `<p class="alert">${REASON[r.reason] || '這次量不出結果，請再量一次。'}</p>`;
  } else {
    const stable = r.coherence >= 0.5 && r.phase != null;
    const phaseText = r.phase == null ? '量不到' : `${Math.round(r.phase)} 度`;
    el.innerHTML = `<dl class="res">
      ${row('上下起伏', `${r.A.toFixed(2)} 公尺`, '最高三分之一浪的平均高度，從浪頂到浪底（示性值），海上用這個')}
      ${row('平均浪高', `${r.Hmean.toFixed(2)} 公尺`, '所有浪的平均。陸上測試請拿這個和捲尺的數字比')}
      ${row('中間值', `${r.Hmed.toFixed(2)} 公尺`, '每道浪的高度由小排到大，取正中間')}
      <p class="ex">每道的高度（公尺，照時間順序）：${r.heights.map((h) => h.toFixed(2)).join('、') || '沒有'}</p>
      ${row('週期', `${r.T.toFixed(1)} 秒`, '一道浪平均幾秒')}
      ${row('晃動角度', `${r.R.toFixed(1)} 度`, '竿子那側抬起的角度，取最高三分之一的平均')}
      ${row('左右搖比起伏早', phaseText, `一整道浪算 360 度，90 度＝早四分之一道浪。${stable ? '穩定' : '不穩定，正式版會改用預設的 90 度'}（相關程度 ${r.coherence.toFixed(2)}）`)}
      ${row('量到的浪', `${r.waves} 道`, '')}
      ${row('每秒資料', `${Math.round(r.rate)} 筆`, '')}
      ${row('品質', r.quality, '量到 12 道以上為「好」，8 到 11 道為「普通」')}
    </dl>
    <p class="note">這是測試版，數字準不準要靠陸上和船上測試確認。</p>`;
  }
  state.result = r;
  state.csvHead = [
    `# side=${rec.side}, seconds=${rec.seconds.toFixed(1)}, rate=${rec.rate.toFixed(1)}`,
    r.ok ? `# A=${r.A.toFixed(3)}, Hmean=${r.Hmean.toFixed(3)}, Hmed=${r.Hmed.toFixed(3)}, heights=${r.heights.map((h) => h.toFixed(3)).join('/')}, T=${r.T.toFixed(2)}, R=${r.R.toFixed(2)}, phase=${r.phase == null ? '' : r.phase.toFixed(1)}, coherence=${r.coherence.toFixed(3)}, waves=${r.waves}` : `# reason=${r.reason}`,
  ].join('\n');
  $('sec-result').hidden = false;
  $('sec-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('btn-export').addEventListener('click', async () => {
  if (!state.rec) return;
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const name = `wave-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
  const file = new File([`${state.csvHead}\n${state.rec.csv()}\n`], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
