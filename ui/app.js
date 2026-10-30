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

async function call(action, payload) {
  try {
    const result = await window.raumcast(action, payload);
    if (!result.ok) throw new Error(result.error);
    return result.data;
  } catch (error) {
    $('error').textContent = error.message;
    $('error').hidden = false;
    return null;
  }
}
async function command(action, payload) {
  if (localBusy && ['start', 'stop', 'refresh'].includes(action)) return;
  const control = ['start', 'stop', 'refresh'].includes(action);
  if (control) localBusy = true;
  $('error').hidden = true;
  render();
  try { await call(action, payload); }
  finally { if (control) localBusy = false; await poll(); }
}
function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function canConnect(room) {
  return room.available && !room.ambiguous && !room.session && !snapshot.busy && !localBusy && !snapshot.initializationError && snapshot.phase !== 'pending';
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
    button.onclick = () => { prefixFilter = prefix; selectedName = undefined; render(); $('search').focus(); };
    return button;
  }));
}
function render() {
  if (!snapshot) return;
  const { phase, owned, rooms } = snapshot;
  renderPrefixes(rooms);
  const target = rooms.find(r => r.name === owned);
  const label = target?.label || owned || '';
  const titles = { idle:'Zur Bildschirmübertragung bereit', starting:`Bildschirm für ${label} auswählen`, pending:`Verbindung mit ${label} angefragt`, active:`Sitzung gemeldet: ${label}`, uncertain:`Verbindung mit ${label} nicht bestätigt`, stopping:'Übertragung wird beendet …' };
  const instructions = {
    idle:'Wähle einen Raum. Danach bestätigst du deinen Bildschirm im Systemdialog.',
    starting:'Bitte den Bildschirmdialog bestätigen oder abbrechen. Die Anfrage kann etwas dauern.',
    pending:'Noch keine aktive Sitzung bestätigt. Prüfe den Bildschirmdialog oder beende die Anfrage.',
    active:'Prüfe das Bild im Raum. Dieses Fenster kannst du jetzt minimieren.',
    uncertain:'Der Sitzungsstatus ist unklar. Die Übertragung könnte noch laufen. Du kannst sie weiterhin beenden; bei Problemen schließe Raumcast.',
    stopping:'Die Verbindung zum Empfänger wird beendet.',
  };
  $('connection').textContent = titles[phase];
  $('instruction').textContent = instructions[phase];
  $('dot').className = `dot ${phase === 'active' ? 'active' : phase === 'idle' ? '' : 'pending'}`;
  $('mode').hidden = !snapshot.demo;
  $('demo-note').hidden = !snapshot.demo;
  $('stop').hidden = !owned;
  $('stop').textContent = phase === 'pending' ? 'Anfrage beenden' : 'Übertragung beenden';
  $('stop').disabled = snapshot.busy || localBusy;
  $('refresh').disabled = snapshot.busy || !!owned || localBusy || !!snapshot.initializationError;
  if (snapshot.issue || snapshot.initializationError) {
    $('error').textContent = snapshot.initializationError || snapshot.issue;
    $('error').hidden = false;
  }
  const query = $('search').value.trim().toLocaleLowerCase('de');
  visible = rooms.filter(r => (prefixFilter === '*' || r.prefix === prefixFilter) && (!favoritesOnly || r.favorite) && `${r.label} ${r.code} ${r.name}`.toLocaleLowerCase('de').includes(query))
    .sort((a,b) => Number(b.available)-Number(a.available) || Number(b.favorite)-Number(a.favorite) || b.lastUsed-a.lastUsed || a.label.localeCompare(b.label, 'de', { numeric:true }));
  if (selectedName === undefined) selectedName = visible[0]?.name ?? null;
  else if (!visible.some(room => room.name === selectedName)) selectedName = null;
  $('count').textContent = `${rooms.filter(r => r.available).length} Empfänger verfügbar · ${visible.length} angezeigt`;
  $('empty').hidden = visible.length > 0;
  $('empty').firstElementChild.textContent = query || favoritesOnly || prefixFilter !== '*' ? 'Keine passenden Räume' : 'Suche nach Räumen …';
  const signature = JSON.stringify([visible, selectedName, snapshot.busy, localBusy, phase, owned, snapshot.initializationError]);
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
    connect.append(element('strong', '', room.label), element('small', '', room.name));
    connect.title = `Bildschirm an ${room.label} übertragen`;
    connect.onclick = () => command('start', { name:room.name });
    const badge = element('span', 'badge', room.ambiguous ? 'Mehrdeutig' : !room.available ? 'Nicht verfügbar' : room.name === owned ? 'Ausgewählt' : room.session ? 'Belegt' : 'Verfügbar');
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
  if (next) { snapshot = next; render(); }
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
  render(); $('search').focus();
}
$('all').onclick = () => filter(false);
$('favorites').onclick = () => filter(true);
$('refresh').onclick = () => command('refresh');
$('stop').onclick = () => command('stop');
$('cancel-rename').onclick = () => $('rename-dialog').close();
$('rename-form').onsubmit = async event => {
  event.preventDefault();
  await command('preference', { name:renameTarget, alias:$('alias').value });
  $('rename-dialog').close(); $('search').focus();
};
void poll();
setInterval(poll, 800);
