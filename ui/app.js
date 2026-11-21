const $ = id => document.getElementById(id);
let snapshot = null;
let favoritesOnly = false;
let selectedName;
let prefixFilter = '*';
let lastPrefixes = '';
let visible = [];
let lastList = '';
let renameTarget = null;
let localBusy = false;
let commandError = '';
let viewSettingsError = '';
let settingsLoaded = false;
let lastRecent = '';
let lastHelp = '';
const bridgeStartedAt = Date.now();

async function call(action, payload) {
  try {
    if (typeof window.raumcast !== 'function') {
      // The app window loads before Puppeteer has installed its command bridge.
      // Polling retries automatically while the backend is attaching.
      if (action === 'snapshot' && Date.now() - bridgeStartedAt < 15000) return null;
      throw new Error('Verbindung zur Raumcast-Steuerung fehlt. Bitte Raumcast schließen und erneut über das Programm starten.');
    }
    const result = await window.raumcast(action, payload);
    if (!result.ok) throw new Error(result.error);
    if (action === 'viewSettings') viewSettingsError = '';
    return result.data ?? true;
  } catch (error) {
    if (action !== 'snapshot') commandError = error.message;
    if (action === 'viewSettings') viewSettingsError = `Raumfilter konnten nicht gespeichert werden: ${error.message}`;
    $('error').textContent = error.message;
    $('error').hidden = false;
    return null;
  }
}
async function command(action, payload) {
  // Until connected, let polling report connection errors and clear them on recovery.
  if (!snapshot || typeof window.raumcast !== 'function') { await poll(); return; }
  if (localBusy && ['start', 'stop', 'refresh', 'recover'].includes(action)) return;
  const control = ['start', 'stop', 'refresh', 'recover'].includes(action);
  if (control) localBusy = true;
  commandError = '';
  $('error').hidden = true;
  render();
  try { return await call(action, payload); }
  finally { if (control) localBusy = false; await poll(); }
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function setText(id, text) {
  if ($(id).textContent !== text) $(id).textContent = text;
}
function canConnect(room) {
  return room.available && !room.ambiguous && !room.session && !snapshot.busy && !localBusy && !snapshot.initializationError && !snapshot.initializing && snapshot.phase !== 'pending';
}
function saveFilters() {
  void command('viewSettings', { favoritesOnly, prefix:prefixFilter });
}
function renderHelp() {
  const { owned, phase, busy, initializing, initializationError, mode } = snapshot;
  const signature = JSON.stringify([owned, phase, busy, localBusy, initializing, initializationError, mode]);
  if (signature === lastHelp) return;
  lastHelp = signature;
  const steps = busy || localBusy ? [phase === 'starting' && mode !== 'audio' ? 'Bildschirmdialog bestätigen oder abbrechen.' : 'Vorgang abwarten.']
    : owned ? ['Bild oder Ton am Gerät prüfen.', 'Bei Problemen: Übertragung beenden und neu suchen. Falls das fehlschlägt, Raumcast schließen.']
    : initializationError ? ['Suche neu starten.', 'Falls der Fehler bleibt: Raumcast neu starten oder den Diagnosebericht weitergeben.']
    : ['Schulnetz, AirServer und dessen Cast-Funktion prüfen.', 'Keine Geräte gefunden? Cast-Suche im normalen Chrome vergleichen.'];
  if (owned && mode === 'audio') steps.push('Audioausgabe gewechselt? Übertragung neu starten. Cast verzögert den Ton.');
  $('help-steps').replaceChildren(...steps.map(step => element('li', '', step)));
  $('recover').textContent = owned ? 'Übertragung beenden und neu suchen' : 'Suche neu starten';
  $('recover').disabled = busy || localBusy || initializing;
}
function renderRecent() {
  const recent = snapshot.rooms.filter(room => room.lastUsed > 0).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 3);
  const signature = JSON.stringify([recent, snapshot.busy, localBusy, snapshot.phase, snapshot.initializing, snapshot.initializationError]);
  if (signature === lastRecent) return;
  lastRecent = signature;
  const focusedName = document.activeElement?.dataset.recentName;
  $('recent').hidden = recent.length === 0;
  $('recent-rooms').replaceChildren(...recent.map(room => {
    const status = room.ambiguous ? 'mehrdeutig' : !room.available ? 'nicht verfügbar' : room.session ? 'belegt' : '';
    const button = element('button', '', `${room.label}${status ? ' · ' + status : ''}`);
    button.disabled = !canConnect(room);
    button.dataset.recentName = room.name;
    button.onclick = () => command('start', { name:room.name });
    return button;
  }));
  if (focusedName) [...$('recent-rooms').children].find(button => button.dataset.recentName === focusedName)?.focus();
}
function renderUpdates() {
  setText('version', snapshot.version ? `Version ${snapshot.version}` : 'Version');
  const update = snapshot.update || { state:'idle' };
  const messages = { idle:'', checking:'Prüft …', current:'Kein Update verfügbar.', available:`Version ${update.latest} verfügbar.`, error:update.message };
  setText('update-status', messages[update.state] || '');
  $('check-update').disabled = update.state === 'checking';
  $('download').hidden = update.state !== 'available';
  $('update-notice').hidden = update.state !== 'available';
}
function renderPrefixes(rooms) {
  const prefixes = [...new Set(rooms.map(room => room.prefix))];
  // Keep a selected area visible if its last receiver temporarily disappears.
  if (prefixFilter !== '*' && !prefixes.includes(prefixFilter)) prefixes.push(prefixFilter);
  prefixes.sort((a, b) => (a || '\uffff').localeCompare(b || '\uffff', 'de'));
  const signature = JSON.stringify([prefixes, prefixFilter]);
  if (signature === lastPrefixes) return;
  lastPrefixes = signature;
  $('prefixes').replaceChildren(...['*', ...prefixes].map(prefix => {
    const button = element('button', prefixFilter === prefix ? 'selected' : '', prefix === '*' ? 'Alle Bereiche' : prefix || 'Ohne Kürzel');
    button.dataset.prefix = prefix;
    button.setAttribute('aria-pressed', String(prefixFilter === prefix));
    button.onclick = () => { prefixFilter = prefix; selectedName = undefined; render(); saveFilters(); $('search').focus(); };
    return button;
  }));
}
function render() {
  if (!snapshot) return;
  const { phase, owned, rooms } = snapshot;
  const recoveries = snapshot.recoveries || [];
  $('settings-warning').hidden = recoveries.length === 0;
  setText('settings-recovery', recoveries.map(item => item.message).join('\n'));
  renderHelp(); renderRecent(); renderUpdates();
  renderPrefixes(rooms);
  const target = rooms.find(r => r.name === owned);
  const label = target?.label || owned || '';
  const audio = !!owned && snapshot.mode === 'audio';
  $('audio-note').hidden = !audio;
  const titles = { idle:'Bereit', starting:`Bildschirm auswählen: ${label}`, pending:`Verbinde mit ${label} …`, active:`Bildschirm → ${label}`, buffering:`Ton für ${label} wird gepuffert …`, uncertain:`Verbindung unklar: ${label}`, stopping:'Übertragung wird beendet …' };
  const instructions = {
    idle:'', starting:'', pending:'Bildschirmdialog prüfen oder Anfrage beenden.', buffering:'',
    active:'Bild im Raum prüfen.',
    uncertain:'Übertragung könnte weiterlaufen. Beenden oder Raumcast schließen.', stopping:'',
  };
  if (audio) {
    titles.starting = `Verbinde mit ${label} …`;
    titles.active = `Computerton → ${label}`;
    instructions.pending = 'Noch nicht bestätigt. Anfrage beenden oder weiter warten.';
    instructions.active = '';
  }
  if (snapshot.busy && !owned) titles.idle = 'Gerät wird geprüft …';
  if (snapshot.initializing || snapshot.initializationError) {
    titles[phase] = snapshot.initializing ? 'Startet …' : 'Verbindung nicht bereit';
    instructions[phase] = snapshot.initializing ? '' : 'Neu suchen oder Hilfe öffnen.';
  }
  setText('connection', titles[phase]);
  setText('instruction', instructions[phase]);
  $('instruction').hidden = !instructions[phase];
  const ready = !snapshot.initializing && !snapshot.initializationError;
  $('session').dataset.phase = phase;
  $('session').dataset.mode = snapshot.mode;
  $('session').dataset.ready = String(ready);
  $('session').hidden = phase === 'idle' && ready && !snapshot.busy && !localBusy;
  $('dot').className = `dot ${phase === 'active' ? 'active' : phase === 'idle' ? '' : 'pending'}`;
  $('mode').hidden = !snapshot.demo;
  $('stop').hidden = !owned;
  $('stop').textContent = phase === 'pending' ? 'Anfrage beenden' : 'Übertragung beenden';
  $('stop').disabled = snapshot.busy || localBusy;
  $('refresh').disabled = snapshot.busy || !!owned || localBusy || !!snapshot.initializing;
  const errorMessage = snapshot.initializationError || snapshot.issue || viewSettingsError || commandError;
  setText('error', errorMessage);
  $('error').hidden = !errorMessage;
  const query = $('search').value.trim().toLocaleLowerCase('de');
  visible = rooms.filter(r => (prefixFilter === '*' || r.prefix === prefixFilter) && (!favoritesOnly || r.favorite) && `${r.label} ${r.code} ${r.name}`.toLocaleLowerCase('de').includes(query))
    .sort((a,b) => Number(b.available)-Number(a.available) || Number(b.favorite)-Number(a.favorite) || b.lastUsed-a.lastUsed || a.label.localeCompare(b.label, 'de', { numeric:true }));
  if (selectedName === undefined) selectedName = visible[0]?.name ?? null;
  else if (!visible.some(room => room.name === selectedName)) selectedName = null;
  setText('count', `${visible.length} ${visible.length === 1 ? 'Gerät' : 'Geräte'}`);
  $('count').hidden = visible.length === 0;
  $('empty').hidden = visible.length > 0;
  const filtered = !!query || favoritesOnly || prefixFilter !== '*';
  $('empty').firstElementChild.textContent = snapshot.initializing ? 'Suche läuft …' : filtered ? 'Keine Treffer' : 'Keine Geräte gefunden';
  $('empty-hint').hidden = filtered || snapshot.initializing;
  $('reset-filters').hidden = !filtered || snapshot.initializing;
  const signature = JSON.stringify([visible, selectedName, snapshot.busy, localBusy, phase, owned, audio, snapshot.initializationError, snapshot.initializing]);
  if (signature === lastList) return;
  lastList = signature;
  // Preserve keyboard focus across discovery/status updates.
  const focused = document.activeElement;
  const focusName = focused?.dataset.name;
  const focusAction = focused?.dataset.action;
  $('rooms').replaceChildren(...visible.map(room => {
    const row = element('li', `room${room.name === owned ? ' chosen' : ''}${room.name === selectedName ? ' focused' : ''}`);
    const connect = element('button', 'connect');
    connect.dataset.name = room.name;
    connect.dataset.action = 'connect';
    connect.disabled = !canConnect(room);
    connect.append(element('strong', '', room.label));
    if (room.code && room.label !== `Raum ${room.code}`) connect.append(element('small', '', room.code));
    connect.title = room.name;
    connect.onclick = () => command('start', { name:room.name });
    const badge = element('span', 'badge', room.ambiguous ? 'Mehrdeutig' : !room.available ? 'Nicht verfügbar' : room.name === owned ? phase === 'active' ? 'Aktiv' : phase === 'uncertain' ? 'Unklar' : 'Anfrage' : room.session ? 'Belegt' : '');
    badge.hidden = !badge.textContent;
    const favorite = element('button', `icon${room.favorite ? ' starred' : ''}`, room.favorite ? '★' : '☆');
    favorite.dataset.name = room.name; favorite.dataset.action = 'favorite';
    favorite.setAttribute('aria-label', `${room.label}: Favorit ${room.favorite ? 'entfernen' : 'speichern'}`);
    favorite.setAttribute('aria-pressed', String(room.favorite));
    favorite.onclick = () => command('preference', { name:room.name, favorite:!room.favorite });
    const rename = element('button', 'icon', '✎');
    rename.dataset.name = room.name; rename.dataset.action = 'rename';
    rename.setAttribute('aria-label', `${room.label} umbenennen`);
    rename.onclick = () => {
      renameTarget = room.name;
      $('original-name').textContent = room.name;
      $('alias').value = room.label;
      $('rename-error').hidden = true;
      $('rename-dialog').showModal();
      $('alias').focus(); $('alias').select();
    };
    row.append(connect, badge, favorite, rename);
    return row;
  }));
  if (focusName && focusAction) {
    [...$('rooms').querySelectorAll('button')].find(el => el.dataset.name === focusName && el.dataset.action === focusAction)?.focus();
  }
}
async function poll() {
  const next = await call('snapshot');
  if (next) {
    snapshot = next;
    if (!settingsLoaded) {
      settingsLoaded = true;
      favoritesOnly = next.viewSettings?.favoritesOnly === true;
      prefixFilter = next.viewSettings?.prefix ?? '*';
      $('all').classList.toggle('selected', !favoritesOnly); $('all').setAttribute('aria-pressed', String(!favoritesOnly));
      $('favorites').classList.toggle('selected', favoritesOnly); $('favorites').setAttribute('aria-pressed', String(favoritesOnly));
    }
    render();
  }
}
$('search').addEventListener('input', () => { selectedName = undefined; render(); });
$('search').addEventListener('keydown', event => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const previous = visible.findIndex(room => room.name === selectedName);
    const next = previous < 0 ? (event.key === 'ArrowDown' ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, previous + (event.key === 'ArrowDown' ? 1 : -1)));
    selectedName = visible[next]?.name ?? null;
    render();
    $('rooms').children[next]?.scrollIntoView({ block:'nearest' });
  }
  const selectedRoom = visible.find(room => room.name === selectedName);
  if (event.key === 'Enter' && selectedRoom && canConnect(selectedRoom)) {
    event.preventDefault(); void command('start', { name:selectedRoom.name });
  }
});
function filter(favorites) {
  favoritesOnly = favorites; selectedName = undefined;
  $('all').classList.toggle('selected', !favorites); $('all').setAttribute('aria-pressed', String(!favorites));
  $('favorites').classList.toggle('selected', favorites); $('favorites').setAttribute('aria-pressed', String(favorites));
  render(); saveFilters(); $('search').focus();
}
$('all').onclick = () => filter(false);
$('favorites').onclick = () => filter(true);
$('refresh').onclick = () => command('refresh');
$('reset-filters').onclick = () => { $('search').value = ''; prefixFilter = '*'; filter(false); };
$('stop').onclick = () => command('stop');
$('acknowledge-recovery').onclick = () => command('acknowledgeRecovery');
$('recover').onclick = async () => { await command('recover'); await loadDiagnostics(); };
$('check-update').onclick = () => command('checkUpdate');
$('download').onclick = () => command('openDownload');
$('update-notice').onclick = () => { $('about').open = true; $('download').focus(); };
async function loadDiagnostics() {
  const report = await call('diagnostics');
  $('diagnostics').value = typeof report === 'string' ? report : '';
  return typeof report === 'string';
}
$('help').addEventListener('toggle', () => { if ($('help').open) void loadDiagnostics(); });
$('copy-diagnostics').onclick = async () => {
  if (!await loadDiagnostics()) { $('copy-status').textContent = 'Diagnosebericht konnte nicht geladen werden. Bitte erneut versuchen.'; return; }
  $('diagnostic-details').open = true;
  $('diagnostics').focus(); $('diagnostics').select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  $('copy-status').textContent = copied ? 'Diagnosebericht kopiert.' : 'Der Bericht ist markiert. Kopiere ihn mit Strg+C (macOS: ⌘C).';
};
$('cancel-rename').onclick = () => $('rename-dialog').close();
$('rename-form').onsubmit = async event => {
  event.preventDefault();
  const saved = await command('preference', { name:renameTarget, alias:$('alias').value });
  if (saved == null) {
    $('rename-error').textContent = commandError || 'Der Raumname konnte nicht gespeichert werden. Bitte erneut versuchen.';
    $('rename-error').hidden = false;
    return;
  }
  $('rename-dialog').close(); $('search').focus();
};
void poll();
setInterval(poll, 800);
