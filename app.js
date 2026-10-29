'use strict';

const $ = s => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Pamięć: IndexedDB ----------

let dbPromise;
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('pisak', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('projects', { keyPath: 'id' });
      db.createObjectStore('docs', { keyPath: 'id' }).createIndex('project', 'projectId');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function store(name, mode = 'readonly') {
  return (await openDb()).transaction(name, mode).objectStore(name);
}
const dbAll = async name => req((await store(name)).getAll());
const dbGet = async (name, id) => req((await store(name)).get(id));
const dbPut = async (name, value) => req((await store(name, 'readwrite')).put(value));
const dbDel = async (name, id) => req((await store(name, 'readwrite')).delete(id));
const docsOf = async projectId => req((await store('docs')).index('project').getAll(projectId));

// Drobne ustawienia (motyw, ostatni dokument) – tylko dla wygody.
const pref = {
  get(k) { try { return localStorage.getItem('pisak-' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('pisak-' + k, v); } catch { /* brak dostępu */ } },
};

// ---------- Motyw ----------

function currentTheme() {
  return pref.get('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function applyTheme() {
  const t = currentTheme();
  document.documentElement.dataset.theme = t;
  $('meta[name="theme-color"]').content = t === 'dark' ? '#191816' : '#faf7f2';
}
function toggleTheme() {
  pref.set('theme', currentTheme() === 'dark' ? 'light' : 'dark');
  applyTheme();
}
const themeItem = () => [currentTheme() === 'dark' ? 'Tryb jasny' : 'Tryb ciemny', toggleTheme];

// ---------- Pomocnicze ----------

function ask(label, value) {
  const v = prompt(label, value);
  return v && v.trim() ? v.trim() : null;
}

function plural(n, forms = ['dokument', 'dokumenty', 'dokumentów']) {
  const a = n % 10, b = n % 100;
  const word = n === 1 ? forms[0] : a >= 2 && a <= 4 && (b < 12 || b > 14) ? forms[1] : forms[2];
  return `${n} ${word}`;
}
const PROJECTS = ['projekt', 'projekty', 'projektów'];

const fmtDate = t => new Date(t).toLocaleString('pl-PL', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

function listItem(title, meta, onClick) {
  const b = document.createElement('button');
  b.className = 'item';
  b.append(Object.assign(document.createElement('b'), { textContent: title }));
  b.append(Object.assign(document.createElement('span'), { textContent: meta }));
  b.onclick = onClick;
  return b;
}

function emptyNote(html) {
  const p = document.createElement('p');
  p.className = 'empty';
  p.innerHTML = html;
  return p;
}

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

const safeName = s => s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'dokument';

// ---------- Menu ----------

function openMenu(button, items) {
  const menu = $('#menu');
  menu.replaceChildren(...items.map(([label, action, cls]) => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.onclick = () => { closeMenu(); action(); };
    return b;
  }));
  const r = button.getBoundingClientRect();
  menu.style.top = r.bottom + 4 + 'px';
  menu.style.right = Math.max(8, innerWidth - r.right) + 'px';
  menu.hidden = false;
  $('#scrim').hidden = false;
}
function closeMenu() {
  $('#menu').hidden = true;
  $('#scrim').hidden = true;
}

// ---------- Nawigacja (hash, żeby działał przycisk „wstecz” w Androidzie) ----------

let routeSeq = 0;
async function route() {
  const seq = ++routeSeq;
  closeMenu();
  await flushSave();
  const h = location.hash;
  pref.set('last', h);
  let m;
  if ((m = h.match(/^#\/d\/(.+)$/))) return openDoc(m[1], seq);
  if ((m = h.match(/^#\/p\/(.+)$/))) return openProject(m[1], seq);
  if (h === '#/pamiec') return openStorage(seq);
  return openHome(seq);
}

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
}

function goBack() {
  if (history.length > 1) history.back();
  else location.hash = '#/';
}

// ---------- Ekran główny: projekty ----------

async function openHome(seq) {
  const projects = (await dbAll('projects')).sort((a, b) => b.updated - a.updated);
  const counts = {};
  for (const d of await dbAll('docs')) counts[d.projectId] = (counts[d.projectId] || 0) + 1;
  if (seq !== routeSeq) return;

  const list = $('#project-list');
  list.replaceChildren(...projects.map(p =>
    listItem(p.name, `${plural(counts[p.id] || 0)} · ${fmtDate(p.updated)}`, () => { location.hash = '#/p/' + p.id; })
  ));
  if (!projects.length) list.append(emptyNote('Nie masz jeszcze żadnego projektu.<br>Utwórz pierwszy przyciskiem poniżej.'));
  show('home');
}

async function newProject() {
  const name = ask('Nazwa projektu', 'Nowy projekt');
  if (!name) return;
  const now = Date.now();
  const project = { id: uid(), name, created: now, updated: now };
  await dbPut('projects', project);
  const doc = await createDoc(project.id, 'Dokument 1');
  history.pushState(null, '', '#/p/' + project.id);
  location.hash = '#/d/' + doc.id;
}

// ---------- Projekt: lista dokumentów ----------

let currentProject = null;

async function openProject(id, seq) {
  const project = await dbGet('projects', id);
  if (!project) { location.replace('#/'); return; }
  const docs = (await docsOf(id)).sort((a, b) => a.created - b.created);
  if (seq !== routeSeq) return;

  currentProject = project;
  $('#project-title').textContent = project.name;
  const list = $('#doc-list');
  list.replaceChildren(...docs.map(d =>
    listItem(d.name, 'Zmieniono ' + fmtDate(d.updated), () => { location.hash = '#/d/' + d.id; })
  ));
  if (!docs.length) list.append(emptyNote('Ten projekt nie ma jeszcze dokumentów.'));
  show('project');
}

async function createDoc(projectId, name) {
  const now = Date.now();
  const doc = { id: uid(), projectId, name, html: '<p><br></p>', created: now, updated: now };
  await dbPut('docs', doc);
  await touchProject(projectId, now);
  return doc;
}

async function touchProject(id, time) {
  const p = await dbGet('projects', id);
  if (p) { p.updated = time; await dbPut('projects', p); }
}

async function newDoc() {
  const count = (await docsOf(currentProject.id)).length;
  const name = ask('Nazwa dokumentu', `Dokument ${count + 1}`);
  if (!name) return;
  const doc = await createDoc(currentProject.id, name);
  location.hash = '#/d/' + doc.id;
}

async function renameProject() {
  const name = ask('Nowa nazwa projektu', currentProject.name);
  if (!name) return;
  currentProject.name = name;
  await dbPut('projects', currentProject);
  $('#project-title').textContent = name;
}

async function deleteProject() {
  const docs = await docsOf(currentProject.id);
  if (!confirm(`Usunąć projekt „${currentProject.name}” i ${plural(docs.length)}? Tego nie da się cofnąć.`)) return;
  for (const d of docs) await dbDel('docs', d.id);
  await dbDel('projects', currentProject.id);
  location.replace('#/');
}

// ---------- Edytor ----------

let ed = $('#editor');
let currentDoc = null;
let lastRange = null;
let saveTimer = null;
let dirty = false;

const ALLOWED = /^(P|DIV|BR|I|EM|B|STRONG|SPAN|U)$/;

// Wczytywany HTML przepuszczamy przez prosty filtr: tylko znaczniki tekstu i wyrównanie/kursywa.
function cleanHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  (function walk(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1) { child.remove(); continue; }
      walk(child);
      if (!ALLOWED.test(child.nodeName)) { child.replaceWith(...child.childNodes); continue; }
      const align = child.style.textAlign, fontStyle = child.style.fontStyle;
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      if (align) child.style.textAlign = align;
      if (fontStyle) child.style.fontStyle = fontStyle;
    }
  })(t.content);
  const out = t.innerHTML.trim();
  return out || '<p><br></p>';
}

async function openDoc(id, seq) {
  const doc = await dbGet('docs', id);
  if (!doc) { location.replace('#/'); return; }
  const project = await dbGet('projects', doc.projectId);
  if (seq !== routeSeq) return;

  currentDoc = doc;
  currentProject = project;
  // Nowy element dla każdego dokumentu – historia cofania nie miesza się między dokumentami.
  const fresh = document.createElement('div');
  fresh.id = 'editor';
  fresh.contentEditable = 'true';
  fresh.spellcheck = true;
  fresh.lang = 'pl';
  fresh.setAttribute('autocapitalize', 'sentences');
  fresh.innerHTML = cleanHtml(doc.html);
  ed.replaceWith(fresh);
  ed = fresh;
  bindEditor(ed);
  lastRange = null;

  $('#doc-title').textContent = doc.name;
  setStatus('');
  show('editor-view');
  ed.scrollTop = doc.scroll || 0;
  updateToolbar();
}

function bindEditor(el) {
  el.addEventListener('beforeinput', e => {
    // Pogrubienie i podkreślenie celowo wyłączone – tylko kursywa.
    if (e.inputType === 'formatBold' || e.inputType === 'formatUnderline') e.preventDefault();
  });
  el.addEventListener('input', onInput);
  el.addEventListener('compositionend', () => setTimeout(autocorrect, 0));
  el.addEventListener('paste', e => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) document.execCommand('insertText', false, text);
  });
  el.addEventListener('drop', e => e.preventDefault());
  el.addEventListener('scroll', () => { if (currentDoc) currentDoc.scroll = el.scrollTop; }, { passive: true });
}

const NO_AUTOCORRECT = /^(insertFromPaste|insertFromDrop|insertParagraph|insertLineBreak|insertReplacementText)$/;

function onInput(e) {
  const t = e.inputType || '';
  if (!e.isComposing && t.startsWith('insert') && !NO_AUTOCORRECT.test(t)) autocorrect();
  // Po cofnięciu przeglądarka zaznacza przywrócony tekst – kolejny znak by go nadpisał.
  if (t === 'historyUndo' || t === 'historyRedo') getSelection().collapseToEnd();
  ensureParagraph();
  scheduleSave();
  requestAnimationFrame(keepCaretVisible);
}

// Autokorekta tuż za kursorem: " → „ albo ”, ... → …
// Zamiana idzie przez execCommand, więc „Cofnij” przywraca to, co zostało wpisane.
function autocorrect() {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !ed.contains(sel.anchorNode)) return;
  let node = sel.anchorNode, off = sel.anchorOffset;
  if (node.nodeType !== 3) {
    const prev = node.childNodes[off - 1];
    if (!prev || prev.nodeType !== 3) return;
    node = prev;
    off = prev.length;
  }
  const before = node.data.slice(0, off);

  if (before.endsWith('...') && !before.endsWith('....')) {
    replaceBefore(node, off, 3, '…');
  } else if (before.endsWith('"')) {
    replaceBefore(node, off, 1, isOpening(textBefore(node, off - 1)) ? '„' : '”');
  }
}

// Tekst akapitu przed danym miejscem (także przez granice kursywy).
function textBefore(node, off) {
  const block = node.parentElement.closest('#editor > *') || ed;
  const r = document.createRange();
  r.setStart(block, 0);
  r.setEnd(node, off);
  return r.toString();
}

function isOpening(before) {
  const prev = before.slice(-1);
  return prev === '' || /[\s(\[{–—\-\/„]/.test(prev);
}

function replaceBefore(node, off, len, text) {
  const r = document.createRange();
  r.setStart(node, off - len);
  r.setEnd(node, off);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  document.execCommand('insertText', false, text);
}

// Pilnuje, żeby tekst zawsze siedział w akapitach <p>.
function ensureParagraph() {
  if (!ed.firstChild) {
    ed.innerHTML = '<p><br></p>';
    const r = document.createRange();
    r.setStart(ed.firstChild, 0);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  } else if ([...ed.childNodes].some(n => n.nodeType === 3 && n.data.trim())) {
    document.execCommand('formatBlock', false, 'p');
  }
}

function keepCaretVisible() {
  const sel = getSelection();
  if (!sel.rangeCount || !ed.contains(sel.anchorNode)) return;
  let rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.height) {
    const n = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
    rect = n.getBoundingClientRect();
  }
  const box = ed.getBoundingClientRect();
  if (rect.bottom > box.bottom - 16) ed.scrollTop += rect.bottom - box.bottom + 40;
  else if (rect.top < box.top) ed.scrollTop -= box.top - rect.top + 16;
}

// ---------- Pasek nad klawiaturą ----------

function exec(cmd, value) {
  document.execCommand(cmd, false, value);
}

const tools = {
  undo: () => exec('undo'),
  redo: () => exec('redo'),
  italic: () => exec('italic'),
  center: () => exec(document.queryCommandState('justifyCenter') ? 'justifyLeft' : 'justifyCenter'),
  dash: () => exec('insertText', '–'),
  separator: insertSeparator,
};

// Wstawia wyśrodkowany akapit „***” i ustawia kursor w nowym, zwykłym akapicie pod nim.
function insertSeparator() {
  const sel = getSelection();
  const block = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement).closest('#editor > *');
  if (block && block.textContent.trim()) {
    const r = document.createRange();
    r.selectNodeContents(block);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
    exec('insertParagraph');
  }
  if (document.queryCommandState('italic')) exec('italic');
  exec('insertText', '***');
  if (!document.queryCommandState('justifyCenter')) exec('justifyCenter');
  exec('insertParagraph');
  if (document.queryCommandState('justifyCenter')) exec('justifyLeft');
}

function restoreFocus() {
  if (document.activeElement === ed) return;
  ed.focus();
  if (lastRange) {
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(lastRange);
  }
}

function updateToolbar() {
  const inEditor = document.activeElement === ed;
  $('#t-italic').setAttribute('aria-pressed', inEditor && document.queryCommandState('italic'));
  $('#t-center').setAttribute('aria-pressed', inEditor && document.queryCommandState('justifyCenter'));
}

document.addEventListener('selectionchange', () => {
  const sel = getSelection();
  if (sel.rangeCount && ed.contains(sel.anchorNode)) {
    lastRange = sel.getRangeAt(0).cloneRange();
    updateToolbar();
  }
});

// ---------- Zapis ----------

function setStatus(text) {
  $('#status').textContent = text;
}

function scheduleSave() {
  dirty = true;
  setStatus('•');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 500);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!dirty || !currentDoc) return;
  dirty = false;
  const doc = currentDoc;
  doc.html = ed.innerHTML;
  doc.updated = Date.now();
  try {
    await dbPut('docs', doc);
    await touchProject(doc.projectId, doc.updated);
    if (doc === currentDoc && !dirty) setStatus('Zapisano');
  } catch (err) {
    dirty = true;
    setStatus('Błąd zapisu!');
    console.error(err);
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'hidden') {
    await flushSave();
    if (reloadPending) location.reload();
  } else {
    swRegistration?.update();
  }
});
addEventListener('pagehide', flushSave);

// ---------- Aktualizacje ----------

// Musi się zgadzać z VERSION w sw.js.
const APP_VERSION = 4;
const startedAt = Date.now();
let swRegistration = null;
let reloadPending = false;
let reloadNow = false;

// Nowa wersja przejęła apkę: przeładowujemy od razu, jeśli apka dopiero wystartowała
// albo ktoś ręcznie poprosił o aktualizację; w trakcie pisania – dopiero gdy wyjdziesz z apki.
async function onNewVersion() {
  await flushSave();
  if (reloadNow || Date.now() - startedAt < 10000 || document.visibilityState === 'hidden') location.reload();
  else reloadPending = true;
}

async function checkForUpdate() {
  if (!swRegistration) { alert('Aktualizacje nie są dostępne w tej przeglądarce.'); return; }
  const btn = $('#check-update');
  btn.disabled = true;
  btn.textContent = 'Sprawdzam…';
  try {
    await swRegistration.update();
  } catch {
    alert('Nie udało się sprawdzić – brak internetu?');
  }
  if (swRegistration.installing || swRegistration.waiting) {
    reloadNow = true;
    btn.textContent = 'Pobieram nową wersję…';
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Sprawdź aktualizacje';
  if (navigator.onLine) alert('Masz najnowszą wersję.');
}

// ---------- Akcje dokumentu ----------

async function renameDoc() {
  const name = ask('Nowa nazwa dokumentu', currentDoc.name);
  if (!name) return;
  currentDoc.name = name;
  await dbPut('docs', currentDoc);
  $('#doc-title').textContent = name;
}

async function deleteDoc() {
  if (!confirm(`Usunąć dokument „${currentDoc.name}”? Tego nie da się cofnąć.`)) return;
  const { id, projectId } = currentDoc;
  clearTimeout(saveTimer);
  dirty = false;
  currentDoc = null;
  await dbDel('docs', id);
  location.replace('#/p/' + projectId);
}

async function exportDoc(kind) {
  await flushSave();
  const html = ed.innerHTML;
  const name = safeName(currentDoc.name);
  if (kind === 'docx') download(name + '.docx', exportDocx(html, currentDoc.name));
  else download(name + '.txt', exportTxt(html));
}

// ---------- Kopia zapasowa ----------

// Kopia ma rozszerzenie .txt, bo Chrome na Androidzie nie pozwala udostępniać plików .json.
async function backupFile() {
  await flushSave();
  const data = {
    app: 'pisak',
    version: 1,
    exported: new Date().toISOString(),
    projects: await dbAll('projects'),
    docs: await dbAll('docs'),
  };
  const stamp = new Date().toISOString().slice(0, 10);
  return new File([JSON.stringify(data)], `pisak-kopia-${stamp}.txt`, { type: 'text/plain' });
}

const canShareFiles = () => !!navigator.canShare?.({ files: [new File([''], 'x.txt', { type: 'text/plain' })] });

async function shareBackup() {
  const file = await backupFile();
  try {
    await navigator.share({ files: [file], title: 'Kopia zapasowa Pisaka' });
  } catch (err) {
    if (err.name !== 'AbortError') alert('Nie udało się udostępnić kopii. Spróbuj „Pobierz kopię do telefonu”.');
  }
}

async function downloadBackup() {
  const file = await backupFile();
  download(file.name, file);
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== 'pisak' || !Array.isArray(data.projects) || !Array.isArray(data.docs)) {
    alert('To nie jest plik kopii zapasowej Pisaka.');
    return;
  }
  const when = data.exported ? new Date(data.exported).toLocaleString('pl-PL') : 'nieznana data';
  if (!confirm(`Wczytać kopię z ${when}?\n\n${plural(data.projects.length, PROJECTS)}, ${plural(data.docs.length)}.\nTe same projekty i dokumenty zostaną zastąpione wersją z kopii, pozostałe zostaną bez zmian.`)) return;
  for (const p of data.projects) await dbPut('projects', p);
  for (const d of data.docs) await dbPut('docs', d);
  alert('Kopia wczytana.');
  route();
}

// ---------- Pamięć i porządki ----------

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

async function cacheSize() {
  if (!('caches' in window)) return 0;
  let total = 0;
  for (const key of await caches.keys()) {
    const cache = await caches.open(key);
    for (const r of await cache.keys()) {
      const res = await cache.match(r);
      if (res) total += (await res.clone().blob()).size;
    }
  }
  return total;
}

async function openStorage(seq) {
  if (seq !== routeSeq) return;
  show('storage');
  $('#backup-share').hidden = $('#share-hint').hidden = !canShareFiles();
  await refreshStorage();
}

async function refreshStorage() {
  const projects = await dbAll('projects');
  const docs = await dbAll('docs');
  const textBytes = new Blob(docs.map(d => d.html + d.name)).size;
  $('#st-texts').textContent = `${plural(projects.length, PROJECTS)}, ${plural(docs.length)} · ${formatSize(textBytes)}`;
  $('#st-cache').textContent = formatSize(await cacheSize());
}

async function clearCache() {
  if (!navigator.onLine && !confirm('Nie masz teraz internetu. Po wyczyszczeniu apka nie uruchomi się ponownie, dopóki nie połączysz się z siecią. Wyczyścić mimo to?')) return;
  for (const key of await caches.keys()) await caches.delete(key);
  await refreshStorage();
  alert('Pamięć podręczna wyczyszczona. Twoje teksty są nienaruszone.');
}

// ---------- Dopasowanie do klawiatury ----------

function fitViewport() {
  const vv = window.visualViewport;
  document.documentElement.style.setProperty('--app-h', (vv ? vv.height : innerHeight) + 'px');
  if (vv) $('#app').style.top = vv.offsetTop + 'px';
}

// ---------- Start ----------

async function init() {
  applyTheme();
  fitViewport();
  window.visualViewport?.addEventListener('resize', () => { fitViewport(); keepCaretVisible(); });
  window.visualViewport?.addEventListener('scroll', fitViewport);
  addEventListener('resize', fitViewport);

  document.execCommand('defaultParagraphSeparator', false, 'p');
  document.execCommand('styleWithCSS', false, false);

  for (const b of document.querySelectorAll('[data-back]')) b.onclick = goBack;
  $('#new-project').onclick = newProject;
  $('#new-doc').onclick = newDoc;
  $('#doc-title').onclick = renameDoc;
  $('#scrim').onclick = closeMenu;

  $('#home-menu').onclick = e => openMenu(e.currentTarget, [
    themeItem(),
    ['Pamięć i kopie zapasowe', () => { location.hash = '#/pamiec'; }],
  ]);
  $('#backup-share').onclick = shareBackup;
  $('#backup-download').onclick = downloadBackup;
  $('#backup-import').onclick = () => $('#import-file').click();
  $('#clear-cache').onclick = clearCache;
  $('#check-update').onclick = checkForUpdate;
  $('#app-version').textContent = `Pisak, wersja ${APP_VERSION}`;
  $('#project-menu').onclick = e => openMenu(e.currentTarget, [
    ['Zmień nazwę projektu', renameProject],
    themeItem(),
    ['Usuń projekt', deleteProject, 'danger'],
  ]);
  $('#doc-menu').onclick = e => openMenu(e.currentTarget, [
    ['Zmień nazwę', renameDoc],
    ['Eksportuj jako .docx', () => exportDoc('docx')],
    ['Eksportuj jako .txt', () => exportDoc('txt')],
    themeItem(),
    ['Usuń dokument', deleteDoc, 'danger'],
  ]);
  $('#import-file').onchange = e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) importBackup(file);
  };

  // Przyciski paska nie mogą zabierać fokusu edytorowi (klawiatura musi zostać).
  const toolbar = $('#toolbar');
  toolbar.addEventListener('mousedown', e => e.preventDefault());
  toolbar.addEventListener('click', e => {
    const b = e.target.closest('[data-cmd]');
    if (!b) return;
    restoreFocus();
    tools[b.dataset.cmd]();
    updateToolbar();
  });

  addEventListener('hashchange', route);

  // Po uruchomieniu wracamy do ostatnio otwartego dokumentu.
  if (!location.hash) {
    const last = pref.get('last') || '';
    const m = last.match(/^#\/d\/(.+)$/);
    const doc = m && await dbGet('docs', m[1]);
    if (doc) {
      history.replaceState(null, '', '#/');
      history.pushState(null, '', '#/p/' + doc.projectId);
      history.pushState(null, '', last);
    }
  }
  route();

  navigator.storage?.persist?.();
  if ('serviceWorker' in navigator) {
    // Pierwsza instalacja też zmienia kontrolera – wtedy nie przeładowujemy.
    let hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) onNewVersion();
      hadController = true;
    });
    swRegistration = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  }
}

init();
