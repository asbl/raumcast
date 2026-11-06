// Served only from the session's unguessable loopback URL. The privileged
// receiver bridge is provided by Puppeteer on that page, never by this script.
export const audioControls = `
const volume = document.querySelector('#receiver-volume');
const percent = document.querySelector('#volume-value');
const mute = document.querySelector('#receiver-mute');
const quieter = document.querySelector('#volume-down');
const louder = document.querySelector('#volume-up');
const range = document.querySelector('#volume-range');
const ticks = document.querySelector('#volume-ticks');
const error = document.querySelector('#volume-error');
let busy = false, state, fullRange = false, dragging = false;
const queue = [];
const format = value => Number(value).toLocaleString('de-DE', {maximumFractionDigits:1}) + ' %';
function preview(value) {
  volume.value = String(Math.round(value * 10) / 10);
  percent.textContent = format(volume.value);
  volume.setAttribute('aria-valuetext', percent.textContent);
}
function render(value) {
  state = value;
  let desired = value.level;
  for (const item of queue) {
    if (item.action === 'volume') desired = item.patch.level ?? desired;
    if (item.action === 'adjust') desired = Math.max(0, Math.min(1, desired + item.patch.delta));
  }
  const shown = Math.round(desired * 1000) / 10;
  if (shown > 40) fullRange = true;
  const fixed = value.controlType === 'fixed';
  volume.disabled = mute.disabled = quieter.disabled = louder.disabled = fixed;
  volume.max = fullRange ? '100' : '40';
  range.textContent = fullRange ? 'Feinbereich 0–40 %' : 'Gesamten Bereich 0–100 % anzeigen';
  range.setAttribute('aria-pressed', String(fullRange));
  range.disabled = shown > 40 && fullRange;
  range.title = range.disabled ? 'Für den Feinbereich zuerst die Lautstärke auf höchstens 40 % einstellen.' : '';
  const marks = fullRange ? [0,20,40,60,80,100] : [0,10,20,30,40];
  ticks.replaceChildren(...marks.map(mark => { const label = document.createElement('span'); label.textContent = mark; return label; }));
  preview(shown);
  mute.textContent = value.muted ? 'Ton einschalten' : 'Stumm';
  mute.setAttribute('aria-pressed', String(value.muted));
}
async function command(action, patch) {
  if (action === 'status' && busy) return;
  const last = queue.at(-1);
  if (action === 'adjust' && last?.action === 'adjust') last.patch.delta = Math.max(-1, Math.min(1, last.patch.delta + patch.delta));
  else if (action === 'volume' && last?.action === 'volume') last.patch = patch;
  else queue.push({action, patch});
  if (busy) return;
  busy = true;
  while (queue.length) {
    const next = queue.shift();
    try {
      const result = await window.raumcastAudio(next.action, next.patch);
      if (!result.ok) throw new Error(result.error);
      if (!dragging) render(result.data); else state = result.data;
      error.textContent = '';
    } catch (e) { if (state && !dragging) render(state); error.textContent = e.message; }
  }
  busy = false;
}
function adjust(delta) {
  preview(Math.max(0, Math.min(Number(volume.max), Number(volume.value) + delta)));
  command('adjust', {delta:delta/100});
}
volume.addEventListener('pointerdown', () => { dragging = true; });
volume.addEventListener('pointerup', () => { dragging = false; });
volume.addEventListener('pointercancel', () => { dragging = false; command('status'); });
volume.addEventListener('blur', () => { dragging = false; command('status'); });
volume.addEventListener('keydown', event => {
  const delta = {ArrowLeft:-0.1, ArrowDown:-0.1, ArrowRight:0.1, ArrowUp:0.1}[event.key];
  if (delta !== undefined) { event.preventDefault(); adjust(delta); }
});
volume.addEventListener('input', () => preview(volume.value));
volume.addEventListener('change', () => command('volume', {level:Number(volume.value)/100}));
quieter.addEventListener('click', () => adjust(-0.5));
louder.addEventListener('click', () => adjust(0.5));
range.addEventListener('click', () => { fullRange = !fullRange; if (state) render(state); });
mute.addEventListener('click', () => { if (state) command('mute'); });
command('status');
setInterval(() => { if (!dragging) command('status'); }, 3000);
`;

export const audioControlsCss = `
:root { color-scheme:light dark; font:16px system-ui,sans-serif; --bg:#f5f6f8; --card:#fff; --text:#172631; --muted:#60717e; --accent:#116b60; --border:#dce3e8; }
* { box-sizing:border-box; }
body { margin:0; padding:clamp(20px,5vw,56px); background:var(--bg); color:var(--text); }
main { max-width:800px; margin:auto; }
h1 { font-size:clamp(24px,4vw,32px); margin:0 0 12px; }
p { color:var(--muted); line-height:1.6; }
.volume-panel { margin-top:28px; padding:clamp(20px,4vw,36px); background:var(--card); border:1px solid var(--border); border-radius:18px; }
label { font-size:17px; font-weight:650; }
#volume-value { display:block; font-size:44px; font-weight:700; font-variant-numeric:tabular-nums; margin:12px 0; }
#receiver-volume { width:100%; height:52px; margin:4px 0; accent-color:var(--accent); cursor:pointer; }
#volume-ticks { display:flex; justify-content:space-between; color:var(--muted); font-size:13px; padding:0 9px; }
.volume-actions { display:flex; flex-wrap:wrap; gap:12px; margin-top:26px; }
button { min-height:48px; padding:10px 20px; border:1px solid var(--border); border-radius:10px; font:inherit; color:var(--text); background:var(--card); cursor:pointer; }
#volume-down,#volume-up { min-width:120px; font-size:20px; font-weight:650; }
#volume-range { margin-top:10px; font-size:14px; }
button:hover:enabled { border-color:var(--accent); }
button:disabled,input:disabled { opacity:.5; cursor:default; }
button:focus-visible,input:focus-visible { outline:3px solid #68b4a7; outline-offset:3px; }
#volume-error { color:#a12c30; }
@media(prefers-color-scheme:dark) { :root { --bg:#172126; --card:#202e35; --text:#e7eef1; --muted:#a4b5c0; --accent:#78ceba; --border:#384952; } }
`;
