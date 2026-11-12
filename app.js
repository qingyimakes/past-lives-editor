/* Still editor.
   The repo is the database: this page reads and writes Content/source.json
   through the GitHub API. Nothing else is hosted, and nothing calls an AI API.

   The middle of the page is not a drawing of the app: it is the published web
   page (Web/index.html) opened as ?preview in an iframe, sent the post being
   edited — any status — converted by build.js the way Content/build.py
   converts a published one. What you see there is what readers will see. */

const S = {
  src: null, qid: null, lang: 'en', dirty: false,
  gh: JSON.parse(localStorage.getItem('pl.gh') || 'null'),
  device: localStorage.getItem('pl.device') || 'std',
  view: localStorage.getItem('pl.view') === 'feed' ? 'feed' : 'thread',  // which screen the preview opens on
  open: new Set(),          // comments expanded in the side panel, by voice
  sha: null,
};
const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c;
                          if (h !== undefined) n.innerHTML = h; return n; };
const esc = (s) => (s ?? '').replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
const STATUSES = ['draft', 'published', 'hidden', 'archived'];
const KEYS = ['A', 'B', 'C', 'D'];
const MIN_OPTIONS = 3, MAX_OPTIONS = 3;   // every post has exactly three options (A–C)

/// Points, not pixels — the same units the app lays out in. The desktop sizes
/// are the web page's own breakpoints: the sidebar arrives at 900, the wide
/// thread at 1180.
const DEVICES = [
  { id: 'se',      name: 'iPhone SE',         w: 375,  h: 667 },
  { id: 'std',     name: 'iPhone 16 / 17',    w: 393,  h: 852 },
  { id: 'promax',  name: 'iPhone 17 Pro Max', w: 440,  h: 956 },
  { id: 'tablet',  name: 'Tablet',            w: 820,  h: 1180, flat: true },
  { id: 'laptop',  name: 'Laptop',            w: 1280, h: 800,  flat: true },
  { id: 'desktop', name: 'Desktop',           w: 1440, h: 900,  flat: true },
];
const device = () => DEVICES.find(d => d.id === S.device) || DEVICES[1];

/// Scale the device down to the room the middle column has, so the whole
/// screen is always visible rather than clipped.
function fitDevice() {
  const frame = $('#device-frame'), stage = $('#stage'), main = $('.main');
  const d = device(), bezel = d.flat ? 2 : 20;
  frame.classList.toggle('flat', !!d.flat);
  frame.style.setProperty('--pw', d.w + 'px');
  frame.style.setProperty('--ph', d.h + 'px');
  const roomW = main.clientWidth - 24, roomH = window.innerHeight - 70;
  const narrow = window.innerWidth <= 900;
  const scale = Math.min(1, roomW / (d.w + bezel), narrow ? 1 : roomH / (d.h + bezel));
  frame.style.transform = `scale(${scale})`;
  stage.style.height = Math.round((d.h + bezel) * scale) + 'px';
  stage.style.width  = Math.round((d.w + bezel) * scale) + 'px';
}
window.addEventListener('resize', fitDevice);

function setStatus(msg, warn) {
  const n = $('#status');
  n.textContent = msg;
  n.style.color = warn ? 'var(--danger)' : '';
  // A merge that worked should read as an event, not as the same grey line.
  n.classList.remove('said');
  if (!warn) { void n.offsetWidth; n.classList.add('said'); setTimeout(() => n.classList.remove('said'), 2600); }
}
function markDirty() {
  if (!S.dirty) { S.dirty = true; $('#btnSave').classList.add('dirty'); setStatus('unsaved changes'); }
  queuePreview();
}
function markClean() { S.dirty = false; $('#btnSave').classList.remove('dirty'); }

/* ── GitHub ─────────────────────────────────────────────────────────────── */
const api = (p, opt = {}) => fetch(`https://api.github.com/${p}`, {
  ...opt, headers: { Accept: 'application/vnd.github+json',
                     Authorization: `Bearer ${S.gh.token}`, ...(opt.headers || {}) } });
// A path's slashes stay slashes: GitHub does not read %2F as a directory.
const ghPath = (p) => p.split('/').map(encodeURIComponent).join('/');

/// Base64 both ways, in UTF-8 and in slices: spreading 400 KB of bytes into
/// String.fromCharCode overflows the call stack, which is how Save broke.
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

/// source.json as build.py and the founder's hand edits write it — one-space
/// indent, a closing newline — so a save changes only the lines that changed.
const serialise = (src) => JSON.stringify(src, null, 1) + '\n';

function showConnectError(text) {
  const n = $('#connectMsg');
  n.textContent = text || '';
  n.classList.toggle('hide', !text);
}

async function ghLoad() {
  if (!S.gh) return false;
  if (S.dirty && !confirm('Reloading drops your unsaved changes. Reload anyway?')) return false;
  setStatus('loading…');
  showConnectError('');
  const { repo, branch, path } = S.gh;
  const r = await api(`repos/${repo}/contents/${ghPath(path)}?ref=${encodeURIComponent(branch)}`);
  if (!r.ok) {
    const why = {
      401: 'token rejected — it is wrong, expired, or was copied with a space',
      403: 'token lacks Contents permission on this repo (needs Read and write)',
      404: `not found — check the repo name, that the branch is "${branch}", ` +
           `and that the token lists this repository under Repository access`,
      409: 'empty repository — push a first commit before connecting',
    }[r.status] || (await r.text()).slice(0, 140);
    setStatus(`GitHub ${r.status}: ${why}`, true);
    showConnectError(`GitHub ${r.status} — ${why}`);
    return false;
  }
  const j = await r.json();
  // Over 1 MB the contents API leaves `content` empty; the blob carries it.
  let b64 = j.content;
  if (!b64 && j.sha) {
    const b = await api(`repos/${repo}/git/blobs/${j.sha}`);
    if (!b.ok) { setStatus(`GitHub ${b.status} reading the file`, true); return false; }
    b64 = (await b.json()).content;
  }
  S.sha = j.sha;
  try { S.src = JSON.parse(fromBase64(b64)); }
  catch (e) { setStatus(`${path} is not valid JSON: ${e.message}`, true); return false; }
  markClean();
  loadTaste();
  $('#repoLine').textContent = `${repo} · ${branch}`;
  opened();
  setStatus(`loaded ${S.src.questions.length} posts`);
  return true;
}

/// The editors' ratings, summarised (Tools/editor-feedback-summary.mjs), beside
/// source.json in the private repo. Only its "For the drafter" section goes
/// into the AI prompts. Best effort: no file, no section, no change.
async function loadTaste() {
  S.taste = '';
  try {
    const { repo, branch, path } = S.gh;
    const p = path.replace(/[^/]*$/, '') + 'editor-feedback-summary.md';
    const r = await api(`repos/${repo}/contents/${ghPath(p)}?ref=${encodeURIComponent(branch)}`);
    if (!r.ok) return;
    const md = fromBase64((await r.json()).content || '');
    const m = /## For the drafter\n([\s\S]*?)(?=\n## |$)/.exec(md);
    S.taste = m ? m[1].trim() : '';
  } catch (e) { S.taste = ''; }
}

async function ghSave() {
  if (!S.src) return setStatus('nothing loaded', true);
  if (!S.gh || !S.sha) return setStatus('opened from a file — use Download to keep your changes', true);
  const problems = check();
  if (problems.length) {
    if (!confirm(`${problems.length} problem(s) found:\n\n${problems.slice(0,8).join('\n')}\n\nSave anyway?`)) return;
  }
  setStatus('saving…');
  const body = {
    message: `content: ${S.qid || 'edit'}`,
    branch: S.gh.branch, sha: S.sha,
    content: toBase64(serialise(S.src)),
  };
  let r;
  try {
    r = await api(`repos/${S.gh.repo}/contents/${ghPath(S.gh.path)}`,
                  { method: 'PUT', body: JSON.stringify(body) });
  } catch (e) { return setStatus(`save failed: ${e.message}`, true); }
  if (r.status === 409 || r.status === 422)
    return setStatus(`save refused (${r.status}): source.json changed on GitHub since you loaded it. ` +
                     `Download your copy, then Reload.`, true);
  if (!r.ok) return setStatus(`save failed: ${r.status} ${(await r.text()).slice(0,120)}`, true);
  S.sha = (await r.json()).content.sha;
  markClean();
  setStatus('saved to GitHub');
}

/* ── Checks — the rules the Python validator enforces, run before you save ── */
function check() {
  const out = [];
  if (!S.src) return ['nothing loaded'];
  const ids = new Set();
  for (const q of S.src.questions) {
    const at = (m) => out.push(`${q.id}: ${m}`);
    if (ids.has(q.id)) at('duplicate id'); ids.add(q.id);
    if (!STATUSES.includes(q.status)) at(`bad status "${q.status}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date || '')) at('bad date');
    if (q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS) at(`needs ${MIN_OPTIONS} or ${MAX_OPTIONS} options`);
    q.options.forEach((o, i) => { if (o.key !== KEYS[i]) at(`option ${i + 1} should be ${KEYS[i]}`);
                                  if (!o.label?.en?.trim()) at(`option ${o.key} has no label`); });
    if (q.baselinePct || q.joined) at('has invented vote data');
    const seen = new Set();
    for (const r of q.responses) {
      if (seen.has(r.voice)) at(`${r.voice} appears twice`); seen.add(r.voice);
      if (!S.src.voices.some(v => v.id === r.voice)) at(`unknown voice ${r.voice}`);
      if (!q.options.some(o => o.key === r.option)) at(`${r.voice}: bad option ${r.option}`);
      if (!r.quote?.text?.en?.trim()) at(`${r.voice}: no quote`);
      else if (!r.quote?.source?.en?.trim()) at(`${r.voice}: quote has no source`);
      if (!r.claim?.en?.trim()) at(`${r.voice}: no claim`);
    }
    const spread = new Set(q.responses.map(r => r.option));
    if (q.status === 'published' && spread.size < 2) at('all voices hold one option — no disagreement');
  }
  return out;
}

/* ── Sidebar ────────────────────────────────────────────────────────────── */
const listed = () => {
  const f = $('#filter').value;
  return S.src.questions.filter(q => f === 'all' || q.status === f)
                        .sort((a, b) => b.date.localeCompare(a.date));
};
function renderList() {
  const list = $('#list'); list.innerHTML = '';
  const qs = listed();
  const tally = {};
  for (const q of S.src.questions) tally[q.status] = (tally[q.status] || 0) + 1;
  const sum = el('div', 'muted');
  sum.style.margin = '0 0 10px';
  sum.innerHTML = STATUSES.filter(s => tally[s])
    .map(s => `<span class="dot s-${s}"></span>${tally[s]} ${s}`).join(' &nbsp; ');
  list.appendChild(sum);
  if (!qs.length) list.appendChild(el('p', 'muted', 'Nothing here.'));
  for (const q of qs) {
    const b = el('button', 'q-item' + (q.id === S.qid ? ' sel' : ''));
    b.innerHTML = `<span class="dot s-${q.status}"></span>${esc((q.title.en || '(untitled)').slice(0, 62))}` +
                  `<div class="muted">${q.date} · ${q.status} · ${q.responses.length} comments</div>`;
    b.onclick = () => select(q.id);
    list.appendChild(b);
    const quick = el('div', 'row');
    quick.style.cssText = 'margin:-2px 0 8px 12px';
    const flip = (to, label) => {
      const x = el('button', 'tiny', label);
      x.onclick = (e) => { e.stopPropagation(); q.status = to; markDirty(); renderList(); renderPost(); };
      quick.appendChild(x);
    };
    if (q.status !== 'published') flip('published', 'Publish');
    if (q.status === 'published') flip('hidden', 'Hide');
    if (q.status !== 'archived')  flip('archived', 'Archive');
    list.appendChild(quick);
  }
}
function select(id) { S.qid = id; S.open.clear(); renderList(); renderPost(); }
/// After a load: keep the post you were on if it is still there, otherwise the
/// newest one in the list.
function opened() {
  if (!S.src.questions.some(q => q.id === S.qid)) S.qid = (listed()[0] || S.src.questions[0])?.id || null;
  S.open.clear(); renderList(); renderPost();
}
const current = () => S.src?.questions.find(q => q.id === S.qid);

/* ── The post: preview in the middle, its fields on the right ───────────── */
function renderPost() {
  const q = current();
  const has = !!q;
  $('#postCtl').classList.toggle('hide', !has);
  $('#inspectBody').classList.toggle('hide', !has);
  $('#inspectEmpty').classList.toggle('hide', has);
  $('#stage').classList.toggle('hide', !has);
  $('.pv-bar').classList.toggle('hide', !has);
  $('#stageEmpty').classList.toggle('hide', has);
  if (!q) return;
  renderPostControls(q);
  renderViewTabs();
  renderInspector(q);
  ensurePreview();
  sendPreview();
}

/// Left panel: where you are — language, status, date. The post's coordinates,
/// not its content.
function renderPostControls(q) {
  const tabs = $('#langTabs'); tabs.innerHTML = '';
  for (const l of ['en', 'zh']) {
    const b = el('button', S.lang === l ? 'on' : '', l === 'en' ? 'EN' : '中文');
    b.onclick = () => { S.lang = l; renderPost(); }; tabs.appendChild(b);
  }
  const st = $('#pStatus'); st.innerHTML = '';
  for (const v of STATUSES) { const o = el('option', '', v); o.value = v; if (q.status === v) o.selected = true; st.appendChild(o); }
  st.onchange = () => { q.status = st.value; markDirty(); renderList(); };

  const d = $('#pDate'); d.value = q.date;
  d.onchange = () => { if (!d.value) return; q.date = d.value; markDirty(); renderList(); };
}

/// The web page has two screens for a question, and they are not the same card.
function renderViewTabs() {
  const vt = $('#viewTabs'); vt.innerHTML = '';
  for (const [id, label] of [['thread', 'Thread'], ['feed', 'Feed']]) {
    const b = el('button', S.view === id ? 'on' : '', label);
    b.onclick = () => { S.view = id; localStorage.setItem('pl.view', id); renderViewTabs(); sendPreview(); };
    vt.appendChild(b);
  }
}

/* ── Fields ─────────────────────────────────────────────────────────────── */
/// A text box bound to obj[key][lang] (or obj[key] when `plain`), written on
/// every keystroke so the preview follows the typing.
function textBox(obj, key, { rows = 1, ph = '', plain = false, cls = '' } = {}) {
  const n = rows > 1 ? el('textarea', cls) : el('input', cls);
  if (rows > 1) n.rows = rows;
  n.placeholder = ph;
  n.value = plain ? (obj[key] ?? '') : (obj[key]?.[S.lang] ?? '');
  n.addEventListener('input', () => {
    if (plain) obj[key] = n.value.trim();
    else { obj[key] = obj[key] || { en: '', zh: '' }; obj[key][S.lang] = n.value; }
    markDirty();
  });
  // Stray spaces never reach the file; they are kept only while typing.
  if (!plain) n.addEventListener('change', () => {
    const v = n.value.trim();
    if (v !== n.value) { n.value = v; obj[key][S.lang] = v; markDirty(); }
  });
  if (rows > 1) { const fit = () => { n.style.height = 'auto'; n.style.height = n.scrollHeight + 2 + 'px'; };
                  n.addEventListener('input', fit); requestAnimationFrame(fit); }
  return n;
}
/// A labelled field with its Claude buttons beside the label.
function field(label, input, tools = []) {
  const f = el('div', 'field');
  const head = el('div', 'label-row');
  head.appendChild(el('label', '', esc(label)));
  if (tools.length) {
    const t = el('div', 'tools');
    for (const [name, fn] of tools) t.appendChild(btn(name, fn));
    head.appendChild(t);
  }
  f.appendChild(head); f.appendChild(input);
  return f;
}

/// Right panel: what you are editing. Everything that changes the post itself
/// lives here, so nothing overlaps the preview.
function renderInspector(q) {
  $('#iId').textContent = q.id;
  renderShape(q);

  const qa = $('#iQuestion'); qa.innerHTML = '';
  qa.appendChild(field('Title', textBox(q, 'title', { rows: 2, ph: 'Question title', cls: 'serif big' }),
    [['rewrite', () => openAI('field', q, { key: 'title', label: 'question title' })]]));
  qa.appendChild(field('Setup', textBox(q, 'why', { rows: 4, ph: 'What makes this live right now' }),
    [['rewrite', () => openAI('field', q, { key: 'why', label: 'question setup' })],
     ['shorter', () => openAI('field', q, { key: 'why', label: 'question setup', how: 'Make it shorter and sharper.' })],
     ['longer',  () => openAI('field', q, { key: 'why', label: 'question setup', how: 'Give it one more sentence of grounding.' })]]));

  renderOptions(q);
  renderResponses(q);

  $('#btnAddComments').onclick = () => openAI('responses', q);
  $('#btnDelete').onclick = () => {
    if (!confirm(`Delete "${q.title.en}"? This cannot be undone from here.\n\n` +
                 `To take a post down, set its status to hidden or archived instead — old votes reference its id.`)) return;
    S.src.questions = S.src.questions.filter(x => x !== q);
    S.qid = null; markDirty(); renderList(); renderPost();
  };
}

function renderShape(q) {
  const spread = new Set(q.responses.map(r => r.option));
  $('#iShape').textContent =
    `${q.status} · ${q.options.length} options · ${q.responses.length} comments · ` +
    (spread.size < 2 ? 'no disagreement' : `${spread.size} sides taken`);
}

const keyChip = (key) => {
  const st = S.src.optionStyle[key] || {};
  const k = el('span', 'i-key', key);
  k.style.background = st.fill || ''; k.style.color = st.ink || '';
  return k;
};

function renderOptions(q) {
  const box = $('#iOptions'); box.innerHTML = '';
  q.options.forEach((o, i) => {
    const row = el('div', 'optedit');
    row.appendChild(keyChip(o.key));
    row.appendChild(textBox(o, 'label', { rows: 2, ph: `Answer ${o.key}` }));
    // Only the last option comes off, and only when nobody holds it, so keys
    // stay A, B, C in order and no voice is left pointing at nothing.
    const last = i === q.options.length - 1;
    if (last && q.options.length > MIN_OPTIONS) {
      const held = q.responses.filter(r => r.option === o.key).length;
      const x = btn('Remove', () => {
        if (held) return setStatus(`${held} voice(s) hold ${o.key} — move them first`, true);
        q.options.pop(); markDirty(); renderPost();
      }, 'danger');
      x.title = held ? `${held} voice(s) hold ${o.key}` : `remove option ${o.key}`;
      row.appendChild(x);
    }
    box.appendChild(row);
  });
  if (q.options.length < MAX_OPTIONS) {
    const key = KEYS[q.options.length];
    box.appendChild(btn(`+ option ${key}`, () => {
      q.options.push({ key, label: { en: '', zh: '' } }); markDirty(); renderPost();
    }));
  }
}

/// The order the web page shows replies in: furthest reach first, otherwise
/// as written (Web/index.html threadRows).
const weight = (vid) => S.src.voices.find(v => v.id === vid)?.reach?.weight ?? 0;
const threadOrder = (q) => q.responses.map((r, i) => ({ r, i }))
  .sort((a, b) => weight(b.r.voice) - weight(a.r.voice) || a.i - b.i).map(x => x.r);

function renderResponses(q) {
  const list = $('#iResponses'); list.innerHTML = '';
  if (!q.responses.length) list.appendChild(el('p', 'muted', 'No comments yet.'));
  for (const r of threadOrder(q)) {
    const v = S.src.voices.find(x => x.id === r.voice);
    const item = el('details', 'c-item');
    item.open = S.open.has(r.voice);
    const sum = el('summary');
    const key = keyChip(r.option);
    key.title = 'move this voice to the next option';
    key.onclick = (e) => { e.preventDefault(); e.stopPropagation(); cycleOption(q, r); };
    sum.appendChild(key);
    sum.appendChild(el('span', 'nm', esc(v?.name?.[S.lang] || v?.name?.en || r.voice)));
    if (!r.quote?.text?.en?.trim() || !r.quote?.source?.en?.trim()) sum.appendChild(el('span', 'badge warn', 'no quote'));
    item.appendChild(sum);
    item.addEventListener('toggle', () => {
      if (item.open) { S.open.add(r.voice); focusPreview(q, r); } else S.open.delete(r.voice);
    });

    const body = el('div', 'c-body');
    // Which option this voice holds: the whole disagreement model.
    const sel = el('select');
    for (const o of q.options) {
      const op = el('option', '', `${o.key} · ${esc(o.label?.[S.lang] || o.label?.en || '')}`);
      op.value = o.key; if (o.key === r.option) op.selected = true; sel.appendChild(op);
    }
    sel.onchange = () => { r.option = sel.value; markDirty(); renderPost(); };
    body.appendChild(field('Voted for', sel));

    // The quote is required, and the source line is what makes it a quote.
    r.quote = r.quote || { text: { en: '', zh: '' }, source: { en: '', zh: '' }, url: '', verified: false };
    body.appendChild(field('Quote — verbatim, never paraphrased',
      textBox(r.quote, 'text', { rows: 3, ph: 'Verbatim quote', cls: 'serif' })));
    body.appendChild(field('Source', textBox(r.quote, 'source', { ph: 'Author, Work I.2, trans. Name' })));
    const url = textBox(r.quote, 'url', { ph: 'https://…', plain: true });
    body.appendChild(field('Source link', url));
    body.appendChild(el('div', 'badge' + (r.quote.verified ? ' ok' : ''),
      r.quote.verified ? 'verified against source' : 'not yet verified'));

    const name = v?.name?.en || r.voice;
    body.appendChild(field('Claim', textBox(r, 'claim', { rows: 2, ph: 'One-line summary of the position' }),
      [['rewrite', () => openAI('field', q, { key: 'claim', label: `${name}'s claim`, obj: r })],
       ['shorter', () => openAI('field', q, { key: 'claim', label: `${name}'s claim`, obj: r, how: 'Make it shorter and blunter.' })]]));
    body.appendChild(field('Detail', textBox(r, 'detail', { rows: 4, ph: 'Explain the quote, sum up the voice, tie it to the question' }),
      [['rewrite', () => openAI('field', q, { key: 'detail', label: `${name}'s detail`, obj: r })],
       ['longer',  () => openAI('field', q, { key: 'detail', label: `${name}'s detail`, obj: r, how: 'Add one more sentence of substance.' })]]));

    const foot = el('div', 'row');
    foot.appendChild(btn('Remove comment', () => {
      if (!confirm(`Remove ${name} from this post?`)) return;
      q.responses = q.responses.filter(x => x !== r); markDirty(); renderPost();
    }, 'danger'));
    body.appendChild(foot);
    item.appendChild(body);
    list.appendChild(item);
  }
}

/// Move a voice to the next option.
function cycleOption(q, r) {
  const keys = q.options.map(o => o.key);
  r.option = keys[(keys.indexOf(r.option) + 1) % keys.length];
  markDirty(); renderPost();
}
function btn(label, fn, cls) { const b = el('button', (cls || '') + ' tiny', label); b.onclick = fn; return b; }

/* ── Preview: the web page itself ───────────────────────────────────────── */
/// Where the published page lives. Next to the editor on GitHub Pages (same
/// origin, qingyimakes.github.io); in this repo, Web/ beside Editor/ — serve
/// the repo root (the still-editor launch entry does).
function previewSrc() {
  if (location.hostname.endsWith('github.io')) return 'https://qingyimakes.github.io/still/?preview';
  return new URL('../Web/index.html?preview', location.href).href;
}
const PV = { ready: false, timer: 0, waited: 0 };
function ensurePreview() {
  const f = $('#preview');
  if (f.dataset.src) return;
  f.dataset.src = previewSrc();
  PV.ready = false;
  f.src = f.dataset.src;
  fitDevice();
  // A page without ?preview (the live site before this change is published)
  // loads as itself and never answers. Say so instead of showing it as yours.
  clearTimeout(PV.waited);
  PV.waited = setTimeout(() => {
    if (!PV.ready) $('#pvNote').textContent = 'The web page did not answer — it needs the ?preview mode published.';
  }, 6000);
}
window.addEventListener('message', (ev) => {
  const f = $('#preview');
  if (ev.source !== f.contentWindow || ev.data?.type !== 'still-preview-ready') return;
  PV.ready = true; $('#pvNote').textContent = '';
  sendPreview();
});
function queuePreview() { clearTimeout(PV.timer); PV.timer = setTimeout(sendPreview, 180); }
function sendPreview() {
  clearTimeout(PV.timer);
  const q = current();
  if (!q || !PV.ready) return;
  const { content, problems } = buildContent(S.src, q.id);
  const mine = problems.filter(p => p.startsWith(q.id + ':'));
  $('#pvNote').textContent = mine.length ? `not shown: ${mine.slice(0, 2).join(' · ')}` : '';
  $('#pvNote').classList.toggle('warn', mine.length > 0);
  const f = $('#preview');
  f.contentWindow.postMessage({ type: 'still-preview', content, open: q.id, view: S.view, lang: S.lang },
                              new URL(f.dataset.src).origin);
}
/// Scroll the preview to a comment opened in the side panel.
function focusPreview(q, r) {
  const f = $('#preview');
  if (!PV.ready || S.view !== 'thread') return;
  f.contentWindow.postMessage({ type: 'still-preview-focus', response: responseId(q, r) },
                              new URL(f.dataset.src).origin);
}

/* ── AI: prompt out, JSON back. Nothing is called. ──────────────────────── */
let aiMode = null, aiCtx = null;
function openAI(mode, q, ctx) {
  aiMode = mode; aiCtx = { q, ...ctx };
  const voices = S.src.voices.map(v => v.id);
  let p, title;
  if (mode === 'new')       { p = promptNewPost(voices, S.taste); title = 'Generate a whole post'; }
  else if (mode === 'responses') { p = promptResponses(q, voices, 3, S.taste); title = 'Add comments'; }
  else {
    const obj = ctx.obj || q;
    const context = `Title: ${q.title.en}\nSetup: ${q.why.en}\nOptions: ${q.options.map(o => o.key + ' — ' + o.label.en).join(' · ')}`;
    p = promptRewrite(ctx.how || 'Rewrite it more sharply, keeping the meaning and the register.',
                      ctx.label, obj[ctx.key] || { en: '', zh: '' }, context);
    title = `Rewrite — ${ctx.label}`;
  }
  $('#aiTitle').textContent = title; $('#aiPrompt').textContent = p;
  $('#aiReply').value = ''; aiNote('');
  $('#sheetAI').classList.remove('hide');
}

/// Claude does not always fence the block, and does not always keep the
/// wrapper. Read what it actually sent: a fenced block, bare JSON, or JSON
/// sitting inside prose.
function parseReply(text) {
  const raw = (text || '').trim();
  if (!raw) throw new Error('Nothing pasted yet.');
  const tries = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) tries.push(fenced[1]);
  tries.push(raw);
  const span = firstJsonSpan(raw);
  if (span) tries.push(span);
  for (const t of tries) { try { return JSON.parse(t.trim()); } catch (e) {} }
  throw new Error('Could not read that as JSON — paste the whole block, braces included.');
}

/// The first balanced { … } or [ … ], ignoring braces inside strings.
function firstJsonSpan(s) {
  const start = s.search(/[{[]/);
  if (start < 0) return null;
  const close = { '{': '}', '[': ']' };
  const stack = [s[start]];
  let inStr = false, esc = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      if (close[stack.pop()] !== c) return null;
      if (!stack.length) return s.slice(start, i + 1);
    }
  }
  return null;
}

/// Say what went wrong and keep the sheet open, so a rejected paste is never
/// mistaken for a merge that did nothing.
function aiFail(msg) {
  const n = $('#aiMsg');
  n.textContent = msg;
  n.style.color = 'var(--danger)';
  n.style.fontWeight = '500';
  return false;
}
function aiNote(msg) { const n = $('#aiMsg'); n.textContent = msg; n.style.color = ''; n.style.fontWeight = ''; }

/// Accept the shapes Claude actually returns: the documented wrapper, a bare
/// array of comments, or a single comment object.
function asList(data, ...keys) {
  if (Array.isArray(data)) return data;
  return keyList(data, ...keys);
}
/// Only named keys — never the top-level array, which is the comment list.
function keyList(obj, ...keys) {
  for (const k of keys) if (Array.isArray(obj?.[k])) return obj[k];
  return null;
}

/// The quote rule, applied before anything is merged rather than halfway
/// through — a rejected batch leaves the post exactly as it was.
function quoteProblem(r) {
  if (!r || typeof r !== 'object') return 'a comment is not an object';
  if (!r.voice) return 'a comment has no "voice"';
  if (!r.option) return `${r.voice}: no "option"`;
  if (!r.claim?.en?.trim()) return `${r.voice}: no claim`;
  if (!r.quote?.text?.en?.trim()) return `${r.voice}: no quote — rejected`;
  if (!r.quote?.source?.en?.trim()) return `${r.voice}: quote has no source — rejected`;
  return null;
}

function mergeReply() {
  let data;
  try { data = parseReply($('#aiReply').value); }
  catch (e) { return aiFail(String(e.message || e)); }

  if (aiMode === 'field') return mergeField(data);
  if (aiMode === 'responses') return mergeResponses(data, aiCtx.q);
  if (aiMode === 'new') return mergeNewPost(data);
}

function mergeField(data) {
  const obj = aiCtx.obj || aiCtx.q;
  if (typeof data?.en !== 'string' || typeof data?.zh !== 'string')
    return aiFail('Expected {"en":"…","zh":"…"} — both languages are required.');
  obj[aiCtx.key] = { en: data.en, zh: data.zh };
  aiDone('rewrote ' + aiCtx.label);
}

function mergeResponses(data, q) {
  const incoming = asList(data, 'responses', 'comments') || (data?.voice ? [data] : null);
  if (!incoming) return aiFail('No comments in that reply — expected {"responses":[ … ]}.');
  if (!incoming.length) return aiFail('That reply carries an empty list of comments.');

  const newVoices = keyList(data, 'newVoices', 'voices') || [];
  const known = new Set([...S.src.voices.map(v => v.id), ...newVoices.map(v => v?.id)]);
  const have = new Set(q.responses.map(r => r.voice));

  const problems = [], fresh = [], dup = [];
  for (const r of incoming) {
    const why = quoteProblem(r);
    if (why) { problems.push(why); continue; }
    if (!q.options.some(o => o.key === r.option)) { problems.push(`${r.voice}: option ${r.option} is not on this question`); continue; }
    if (!known.has(r.voice)) { problems.push(`${r.voice}: unknown voice — it needs a "newVoices" entry`); continue; }
    if (have.has(r.voice)) { dup.push(r.voice); continue; }
    fresh.push(r); have.add(r.voice);
  }
  // Nothing is merged unless all of it can be.
  if (problems.length) return aiFail(problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` (+${problems.length - 3} more)` : ''));
  if (!fresh.length) return aiFail(`already on this post: ${dup.join(', ')} — ask Claude for different voices.`);

  addVoices(newVoices);
  for (const r of fresh) { r.quote.verified = false; q.responses.push(r); }
  aiDone(`added ${fresh.length} comment${fresh.length > 1 ? 's' : ''}` +
         (dup.length ? ` · skipped ${dup.length} already here` : ''), fresh[0].voice);
}

function mergeNewPost(data) {
  const q = data?.question && data.question.title ? { ...data.question } : data;
  if (!q?.title?.en) return aiFail('That reply has no question title.');
  if (!Array.isArray(q.options) || q.options.length < MIN_OPTIONS || q.options.length > MAX_OPTIONS)
    return aiFail(`A post needs ${MIN_OPTIONS} or ${MAX_OPTIONS} options; that reply has ${q.options?.length ?? 'none'}.`);
  const responses = keyList(q, 'responses') || keyList(data, 'responses') || [];
  const newVoices = keyList(q, 'newVoices', 'voices') || keyList(data, 'newVoices', 'voices') || [];
  const known = new Set([...S.src.voices.map(v => v.id), ...newVoices.map(v => v?.id)]);
  const problems = [];
  for (const r of responses) {
    const why = quoteProblem(r);
    if (why) problems.push(why);
    else if (!known.has(r.voice)) problems.push(`${r.voice}: unknown voice — it needs a "newVoices" entry`);
  }
  if (problems.length) return aiFail(problems.slice(0, 3).join(' · ') + (problems.length > 3 ? ` (+${problems.length - 3} more)` : ''));

  addVoices(newVoices);
  let id = q.id || 'q-untitled';
  while (S.src.questions.some(x => x.id === id)) id += '-2';
  responses.forEach(r => { r.quote.verified = false; });
  const post = { id, date: q.date || new Date().toISOString().slice(0, 10), status: 'draft',
                 title: q.title, why: q.why || { en: '', zh: '' }, options: q.options,
                 works: q.works || [], responses };
  S.src.questions.unshift(post); S.qid = id; S.open.clear();
  aiDone(`created "${q.title.en.slice(0, 40)}" with ${responses.length} comment${responses.length === 1 ? '' : 's'}`);
}

function aiDone(what, showVoice) {
  markDirty();
  $('#sheetAI').classList.add('hide');
  aiNote('');
  // A merged comment sorts by reach, so a new voice with no weight lands at
  // the bottom of a long thread. Open it, or the merge looks like nothing.
  if (showVoice) S.open.add(showVoice);
  renderList(); renderPost();
  const problems = check();
  setStatus(problems.length ? `${what} — ${problems.length} problem(s), press Check` : what);
}
function addVoices(list) {
  for (const v of list) {
    if (!v.id || S.src.voices.some(x => x.id === v.id)) continue;
    S.src.voices.push({ id: v.id, name: v.name, kind: v.kind || 'philosophy', type: v.type || 'person',
                        origin: v.origin || { en: '', zh: '' }, wiki: v.wiki || null,
                        reach: v.reach || null, works: v.works || [] });
  }
}

/* ── Wiring ─────────────────────────────────────────────────────────────── */
const deviceSel = $('#device');
for (const d of DEVICES) {
  const o = el('option', '', `${d.name} · ${d.w}×${d.h}`);
  o.value = d.id; if (d.id === device().id) o.selected = true; deviceSel.appendChild(o);
}
deviceSel.onchange = () => {
  S.device = deviceSel.value; localStorage.setItem('pl.device', S.device); fitDevice();
};

$('#filter').onchange = renderList;
$('#btnLoad').onclick = () => S.gh ? ghLoad() : $('#sheetConnect').classList.remove('hide');
$('#btnSave').onclick = ghSave;
$('#btnNew').onclick = () => { if (!S.src) return setStatus('load something first', true); openAI('new', null); };
$('#btnCheck').onclick = () => {
  const p = check();
  alert(p.length ? `${p.length} problem(s):\n\n${p.join('\n')}` : 'All checks pass.');
};
$('#btnDownload').onclick = () => {
  if (!S.src) return setStatus('nothing loaded', true);
  const blob = new Blob([serialise(S.src)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'source.json'; a.click();
  if (!S.sha) markClean();
};
$('#btnConnect').onclick = () => {
  // The token stays where it is: shown as set, never written back into the page.
  if (S.gh) { $('#inRepo').value = S.gh.repo; $('#inBranch').value = S.gh.branch;
              $('#inPath').value = S.gh.path; $('#inToken').value = '';
              $('#inToken').placeholder = 'token saved in this browser — paste a new one to replace it'; }
  $('#sheetConnect').classList.remove('hide');
};
$('#btnConnectCancel').onclick = () => $('#sheetConnect').classList.add('hide');
/// Accept what people actually paste: a full github.com URL, a trailing .git,
/// stray slashes or spaces. Only complain when there is genuinely no repo.
function normaliseRepo(raw) {
  let v = (raw || '').trim();
  v = v.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  v = v.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = v.split('/').filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
}

$('#btnConnectSave').onclick = async () => {
  const typed = $('#inRepo').value, token = $('#inToken').value.trim() || S.gh?.token || '';
  const repo = normaliseRepo(typed);
  if (!repo) {
    return showConnectError(typed.trim()
      ? `Could not read a repository from "${typed.trim()}". It needs both parts — qingyimakes/philosophy-app.`
      : 'Repository is empty. It should be qingyimakes/philosophy-app.');
  }
  $('#inRepo').value = repo;
  if (!token) return showConnectError('Paste a token. Create one at github.com → Settings → Developer settings → Fine-grained tokens.');
  const was = S.gh;
  S.gh = { repo, branch: $('#inBranch').value.trim() || 'main',
           path: $('#inPath').value.trim() || 'Content/source.json', token };
  showConnectError('connecting…');
  // Keep the sheet open unless it actually worked, so a failure is visible.
  if (await ghLoad()) {
    localStorage.setItem('pl.gh', JSON.stringify(S.gh));
    $('#inToken').value = '';
    $('#sheetConnect').classList.add('hide');
  } else if (was) S.gh = was;
};
$('#btnLocal').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (S.dirty && !confirm('Opening a file drops your unsaved changes. Open anyway?')) return;
  try { openLocal(JSON.parse(await f.text()), `${f.name} (local — use Download to save)`); }
  catch (err) { showConnectError(`${f.name} is not valid JSON: ${err.message}`); }
  e.target.value = '';
};
/// A source.json from disk or from this site (?src=): no GitHub, Download saves.
function openLocal(src, line) {
  if (!Array.isArray(src?.questions) || !Array.isArray(src?.voices))
    return showConnectError('That is not a source.json — it has no questions or voices.');
  S.src = src; S.sha = null; markClean();
  $('#repoLine').textContent = line;
  $('#sheetConnect').classList.add('hide');
  opened(); setStatus('opened — Save is off; use Download');
}
$('#btnCopy').onclick = async () => {
  await navigator.clipboard.writeText($('#aiPrompt').textContent);
  $('#btnCopy').textContent = 'Copied'; setTimeout(() => $('#btnCopy').textContent = 'Copy prompt', 1200);
};
$('#btnMerge').onclick = mergeReply;
$('#btnAICancel').onclick = () => $('#sheetAI').classList.add('hide');
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/// ?src=<path> opens a source.json served beside the editor — on this
/// computer, Editor/?src=../Content/source.json with the repo root served.
/// Same origin only: the editor never fetches content from anywhere else.
async function boot() {
  const want = new URLSearchParams(location.search).get('src');
  if (want) {
    const url = new URL(want, location.href);
    if (url.origin !== location.origin) return setStatus('?src must be on this site', true);
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status}`);
      return openLocal(await r.json(), `${url.pathname} (local — use Download to save)`);
    } catch (e) { setStatus(`could not open ${want}: ${e.message}`, true); }
  }
  if (S.gh) ghLoad(); else $('#sheetConnect').classList.remove('hide');
}
renderPost();
boot();
