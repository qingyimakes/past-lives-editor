/* Past Lives editor.
   The repo is the database: this page reads and writes Content/source.json
   through the GitHub API. Nothing else is hosted, and nothing calls an AI API. */

const S = {
  src: null, qid: null, lang: 'en', dirty: false,
  gh: JSON.parse(localStorage.getItem('pl.gh') || 'null'),
  device: localStorage.getItem('pl.device') || 'std',
  sha: null,
};
const $ = (s) => document.querySelector(s);
const el = (t, c, h) => { const n = document.createElement(t); if (c) n.className = c;
                          if (h !== undefined) n.innerHTML = h; return n; };
const esc = (s) => (s ?? '').replace(/[<>&]/g, m => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[m]));
const STATUSES = ['draft', 'published', 'hidden', 'archived'];

/// Points, not pixels — the same units the app lays out in.
const DEVICES = [
  { id: 'se',      name: 'iPhone SE',        w: 375, h: 667 },
  { id: 'mini',    name: 'iPhone 13 mini',   w: 375, h: 812 },
  { id: 'std',     name: 'iPhone 16 / 17',   w: 393, h: 852 },
  { id: 'plus',    name: 'iPhone 16 Plus',   w: 430, h: 932 },
  { id: 'promax',  name: 'iPhone 17 Pro Max',w: 440, h: 956 },
];
const device = () => DEVICES.find(d => d.id === S.device) || DEVICES[2];

/// Scale the device down when the window is shorter than it is, so the whole
/// screen is always visible rather than clipped.
function fitPhone() {
  const phone = document.querySelector('.phone'), stage = $('#stage');
  if (!phone || !stage) return;
  const d = device(), frame = d.h + 20;                 // 10px bezel each side
  const scale = Math.min(1, (window.innerHeight - 28) / frame);
  phone.style.setProperty('--pw', d.w + 'px');
  phone.style.setProperty('--ph', d.h + 'px');
  phone.style.transform = `scale(${scale})`;
  stage.style.height = Math.round(frame * scale) + 'px';
  stage.style.width  = Math.round((d.w + 20) * scale) + 'px';
}
window.addEventListener('resize', fitPhone);

function setStatus(msg, warn) {
  const n = $('#status'); n.textContent = msg; n.style.color = warn ? 'var(--danger)' : '';
}
function markDirty() { S.dirty = true; setStatus('unsaved changes'); }

/* ── GitHub ─────────────────────────────────────────────────────────────── */
const api = (p, opt = {}) => fetch(`https://api.github.com/${p}`, {
  ...opt, headers: { Accept: 'application/vnd.github+json',
                     Authorization: `Bearer ${S.gh.token}`, ...(opt.headers || {}) } });

function showConnectError(text) {
  const n = $('#connectMsg');
  n.textContent = text || '';
  n.classList.toggle('hide', !text);
}

async function ghLoad() {
  if (!S.gh) return false;
  setStatus('loading…');
  showConnectError('');
  const { repo, branch, path } = S.gh;
  const r = await api(`repos/${repo}/contents/${encodeURIComponent(path)}?ref=${branch}`);
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
  S.sha = j.sha;
  S.src = JSON.parse(new TextDecoder().decode(
    Uint8Array.from(atob(j.content.replace(/\n/g, '')), c => c.charCodeAt(0))));
  S.dirty = false;
  $('#repoLine').textContent = `${repo} · ${branch}`;
  renderList(); if (!S.qid) selectFirst();
  setStatus(`loaded ${S.src.questions.length} posts`);
  return true;
}

async function ghSave() {
  if (!S.gh) return setStatus('not connected', true);
  const problems = check();
  if (problems.length) {
    if (!confirm(`${problems.length} problem(s) found:\n\n${problems.slice(0,8).join('\n')}\n\nSave anyway?`)) return;
  }
  setStatus('saving…');
  const body = {
    message: `content: ${S.qid || 'edit'}`,
    branch: S.gh.branch, sha: S.sha,
    content: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(S.src, null, 1)))),
  };
  const r = await api(`repos/${S.gh.repo}/contents/${encodeURIComponent(S.gh.path)}`,
                      { method: 'PUT', body: JSON.stringify(body) });
  if (!r.ok) return setStatus(`save failed: ${r.status} ${(await r.text()).slice(0,120)}`, true);
  S.sha = (await r.json()).content.sha;
  S.dirty = false;
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
    if (q.options.length !== 4) at('needs exactly 4 options');
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
function renderList() {
  const f = $('#filter').value, list = $('#list'); list.innerHTML = '';
  const qs = S.src.questions.filter(q => f === 'all' || q.status === f)
                            .sort((a, b) => b.date.localeCompare(a.date));
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
    b.innerHTML = `<span class="dot s-${q.status}"></span>${esc(q.title.en.slice(0, 62))}` +
                  `<div class="muted">${q.date} · ${q.responses.length} comments</div>`;
    b.onclick = () => { S.qid = q.id; renderList(); renderPost(); };
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
const selectFirst = () => { const q = S.src.questions[0]; if (q) { S.qid = q.id; renderList(); renderPost(); } };
const current = () => S.src?.questions.find(q => q.id === S.qid);

/* ── Editable helpers ───────────────────────────────────────────────────── */
// Binds a node to obj[key][lang]; writes back on blur.
function bind(node, obj, key, ph) {
  node.contentEditable = 'true';
  node.dataset.ph = ph || '';
  node.textContent = (obj[key]?.[S.lang]) ?? '';
  node.addEventListener('blur', () => {
    const v = node.textContent.trim();
    obj[key] = obj[key] || { en: '', zh: '' };
    if (obj[key][S.lang] !== v) { obj[key][S.lang] = v; markDirty(); }
  });
  return node;
}
function tools(node, buttons) {
  const bar = el('div', 'tools');
  for (const [label, fn] of buttons) { const b = el('button', '', label); b.onclick = fn; bar.appendChild(b); }
  node.classList.add('blk'); node.appendChild(bar); return node;
}

/* ── The post, drawn the way the app draws it ───────────────────────────── */
function renderPost() {
  const q = current(); const stage = $('#stage'); stage.innerHTML = '';
  const ctl = $('#postCtl');
  if (!q) { ctl.classList.add('hide'); stage.innerHTML = '<p class="muted">Select a post.</p>'; return; }
  ctl.classList.remove('hide');
  renderPostControls(q);

  const phone = el('div', 'phone');
  phone.innerHTML = `<div class="statusbar"><span>9:41</span><span>▲ ᯤ ▮</span></div>
                     <div class="wordmark">Past Lives</div>`;
  const scroll = el('div', 'scroll');

  // ── question card
  const card = el('div', 'qcard');
  const head = el('div', 'qhead');
  head.appendChild(el('div', 'qdate', dateLabel(q.date)));
  head.appendChild(el('div', 'qicons', '♡ &nbsp; ⚑'));
  card.appendChild(head);

  card.appendChild(tools(bind(el('h1', 'qtitle'), q, 'title', 'Question title'),
    [['rewrite', () => openAI('field', q, { key: 'title', label: 'question title' })]]));
  card.appendChild(tools(bind(el('div', 'qwhy'), q, 'why', 'What makes this live right now'),
    [['rewrite', () => openAI('field', q, { key: 'why', label: 'question setup' })],
     ['shorter', () => openAI('field', q, { key: 'why', label: 'question setup', how: 'Make it shorter and sharper.' })],
     ['longer',  () => openAI('field', q, { key: 'why', label: 'question setup', how: 'Give it one more sentence of grounding.' })]]));

  const opts = el('div', 'opts');
  for (const o of q.options) {
    const st = S.src.optionStyle[o.key];
    const row = el('div', 'optrow');
    row.style.boxShadow = `inset 0 0 0 1px ${st.line}33`;
    const dot = el('div', 'optdot', o.key);
    dot.style.background = st.fill; dot.style.color = st.ink;
    row.appendChild(dot);
    row.appendChild(bind(el('div', 'optlabel'), o, 'label', `Answer ${o.key}`));
    opts.appendChild(row);
  }
  card.appendChild(opts);
  card.appendChild(el('div', 'qlead', S.src.strings[S.lang].lead));
  scroll.appendChild(card);

  // ── thread
  scroll.appendChild(el('div', 'threadhead', S.lang === 'zh' ? '讨论 · 按影响力排序' : 'Comments from the past lives'));
  const chips = el('div', 'filters');
  chips.appendChild(el('div', 'fchip on', S.lang === 'zh' ? '全部' : 'All'));
  for (const o of q.options) chips.appendChild(el('div', 'fchip', o.key));
  scroll.appendChild(chips);

  const byWeight = [...q.responses].sort((a, b) => weight(b.voice) - weight(a.voice));
  for (const r of byWeight) scroll.appendChild(renderResponse(q, r));

  phone.appendChild(scroll);
  stage.appendChild(phone);
  fitPhone();
}

/// Language, status, date and the destructive actions — all in the side panel
/// so nothing overlaps the device.
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
  d.onchange = () => { q.date = d.value; markDirty(); renderList(); };

  $('#btnAddComments').onclick = () => openAI('responses', q);
  $('#btnDelete').onclick = () => {
    if (!confirm(`Delete "${q.title.en}"? This cannot be undone from here.`)) return;
    S.src.questions = S.src.questions.filter(x => x !== q);
    S.qid = null; markDirty(); renderList(); renderPost();
  };
}

function renderResponse(q, r) {
  const v = S.src.voices.find(x => x.id === r.voice) || { name: { en: r.voice, zh: r.voice }, origin: {} };
  const st = S.src.optionStyle[r.option];
  const opt = q.options.find(o => o.key === r.option);
  const row = el('div', 'resprow');
  row.appendChild(el('div', 'avatar', (v.name[S.lang] || v.name.en || '?').slice(0, 1)));

  const body = el('div', 'rbody');
  body.appendChild(el('div', 'rname', esc(v.name[S.lang] || v.name.en)));
  body.appendChild(el('div', 'rmeta',
    `${esc(kindLabel(v.kind))} &nbsp; ${esc(v.origin?.[S.lang] || v.origin?.en || '')}`));

  // which option this voice holds — editable, and the whole disagreement model
  const pill = el('div', 'rpill', `${S.lang === 'zh' ? '投给 ' : 'Voted for '}${r.option} · ${esc(opt?.label[S.lang] || '')}`);
  pill.style.background = st.bg; pill.style.color = st.text; pill.style.cursor = 'pointer';
  pill.title = 'click to move this voice to another option';
  pill.onclick = () => {
    const keys = q.options.map(o => o.key);
    r.option = keys[(keys.indexOf(r.option) + 1) % keys.length];
    markDirty(); renderPost();
  };
  body.appendChild(pill);

  // quote — required, and the source line is what makes it a quote
  r.quote = r.quote || { text: { en: '', zh: '' }, source: { en: '', zh: '' }, url: '', verified: false };
  const qb = el('div', 'rquote');
  qb.appendChild(bind(el('div', 'qt'), r.quote, 'text', 'Verbatim quote — never paraphrase here'));
  const srcLine = el('div', 'qs');
  srcLine.appendChild(document.createTextNode(S.lang === 'zh' ? '引用了 ' : 'Quoting '));
  const srcEd = bind(el('span'), r.quote, 'source', 'Author, Work I.2, trans. Name');
  srcEd.style.textDecoration = 'underline';
  srcLine.appendChild(srcEd);
  qb.appendChild(srcLine);
  const url = el('input'); url.value = r.quote.url || ''; url.placeholder = 'https://en.wikisource.org/wiki/…';
  url.style.marginTop = '8px'; url.style.fontSize = '12px';
  url.onchange = () => { r.quote.url = url.value.trim(); r.quote.verified = false; markDirty(); };
  qb.appendChild(url);
  if (!r.quote.text?.en?.trim()) qb.appendChild(el('div', 'badge warn', 'no quote — this will not pass the check'));
  else qb.appendChild(el('div', 'badge' + (r.quote.verified ? ' ok' : ''),
        r.quote.verified ? 'verified against source' : 'not yet verified'));
  body.appendChild(qb);

  body.appendChild(tools(bind(el('div', 'rclaim'), r, 'claim', 'One-line summary of the position'),
    [['rewrite', () => openAI('field', q, { key: 'claim', label: `${v.name.en}'s claim`, obj: r })],
     ['shorter', () => openAI('field', q, { key: 'claim', label: `${v.name.en}'s claim`, obj: r, how: 'Make it shorter and blunter.' })]]));
  body.appendChild(tools(bind(el('div', 'rdetail'), r, 'detail', 'Explain the quote, sum up the voice, tie it to the question'),
    [['rewrite', () => openAI('field', q, { key: 'detail', label: `${v.name.en}'s detail`, obj: r })],
     ['longer',  () => openAI('field', q, { key: 'detail', label: `${v.name.en}'s detail`, obj: r, how: 'Add one more sentence of substance.' })]]));

  if (v.reach?.note) body.appendChild(el('div', 'rreach', esc(v.reach.note[S.lang] || v.reach.note.en)));

  const ctl = el('div', 'respctl');
  ctl.appendChild(btn('Remove', () => {
    q.responses = q.responses.filter(x => x !== r); markDirty(); renderPost();
  }, 'danger tiny'));
  body.appendChild(ctl);

  row.appendChild(body);
  return row;
}

const weight = (vid) => S.src.voices.find(v => v.id === vid)?.reach?.weight ?? 0;
const kindLabel = (k) => S.src.kinds[k]?.[S.lang] || k || '';
function dateLabel(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  return S.lang === 'zh'
    ? `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
    : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}
function btn(label, fn, cls) { const b = el('button', (cls || '') + ' tiny', label); b.onclick = fn; return b; }

/* ── AI: prompt out, JSON back. Nothing is called. ──────────────────────── */
let aiMode = null, aiCtx = null;
function openAI(mode, q, ctx) {
  aiMode = mode; aiCtx = { q, ...ctx };
  const voices = S.src.voices.map(v => v.id);
  let p, title;
  if (mode === 'new')       { p = promptNewPost(voices); title = 'Generate a whole post'; }
  else if (mode === 'responses') { p = promptResponses(q, voices, 3); title = 'Add comments'; }
  else {
    const obj = ctx.obj || q;
    const context = `Title: ${q.title.en}\nSetup: ${q.why.en}\nOptions: ${q.options.map(o => o.key + ' — ' + o.label.en).join(' · ')}`;
    p = promptRewrite(ctx.how || 'Rewrite it more sharply, keeping the meaning and the register.',
                      ctx.label, obj[ctx.key] || { en: '', zh: '' }, context);
    title = `Rewrite — ${ctx.label}`;
  }
  $('#aiTitle').textContent = title; $('#aiPrompt').textContent = p;
  $('#aiReply').value = ''; $('#aiMsg').textContent = '';
  $('#sheetAI').classList.remove('hide');
}

function parseReply(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return JSON.parse((m ? m[1] : text).trim());
}

function mergeReply() {
  let data;
  try { data = parseReply($('#aiReply').value); }
  catch (e) { $('#aiMsg').textContent = 'Could not read that as JSON.'; return; }

  try {
    if (aiMode === 'field') {
      const obj = aiCtx.obj || aiCtx.q;
      if (!data.en || !data.zh) throw new Error('needs both en and zh');
      obj[aiCtx.key] = { en: data.en, zh: data.zh };
    } else if (aiMode === 'responses') {
      addVoices(data.newVoices || []);
      const have = new Set(aiCtx.q.responses.map(r => r.voice));
      for (const r of data.responses || []) {
        if (have.has(r.voice)) continue;
        requireQuote(r); aiCtx.q.responses.push(r); have.add(r.voice);
      }
    } else if (aiMode === 'new') {
      addVoices(data.newVoices || []);
      (data.responses || []).forEach(requireQuote);
      if (S.src.questions.some(q => q.id === data.id)) data.id += '-2';
      const q = { id: data.id, date: data.date, status: 'draft', title: data.title, why: data.why,
                  options: data.options, works: data.works || [], responses: data.responses || [] };
      S.src.questions.unshift(q); S.qid = q.id;
    }
  } catch (e) { $('#aiMsg').textContent = String(e.message || e); return; }

  markDirty(); $('#sheetAI').classList.add('hide'); renderList(); renderPost();
  const problems = check();
  setStatus(problems.length ? `merged — ${problems.length} problem(s), press Check` : 'merged');
}
function addVoices(list) {
  for (const v of list) {
    if (!v.id || S.src.voices.some(x => x.id === v.id)) continue;
    S.src.voices.push({ id: v.id, name: v.name, kind: v.kind || 'philosophy', type: v.type || 'person',
                        origin: v.origin || { en: '', zh: '' }, wiki: v.wiki || null,
                        reach: v.reach || null, works: v.works || [] });
  }
}
function requireQuote(r) {
  if (!r.quote?.text?.en?.trim() || !r.quote?.source?.en?.trim())
    throw new Error(`${r.voice}: every comment needs a quote with a source — rejected`);
  r.quote.verified = false;
}

/* ── Wiring ─────────────────────────────────────────────────────────────── */
const deviceSel = $('#device');
for (const d of DEVICES) {
  const o = el('option', '', `${d.name} · ${d.w}×${d.h}`);
  o.value = d.id; if (d.id === S.device) o.selected = true; deviceSel.appendChild(o);
}
deviceSel.onchange = () => {
  S.device = deviceSel.value; localStorage.setItem('pl.device', S.device); fitPhone();
};

$('#filter').onchange = renderList;
$('#btnLoad').onclick = ghLoad;
$('#btnSave').onclick = ghSave;
$('#btnNew').onclick = () => { if (!S.src) return setStatus('load something first', true); openAI('new', null); };
$('#btnCheck').onclick = () => {
  const p = check();
  alert(p.length ? `${p.length} problem(s):\n\n${p.join('\n')}` : 'All checks pass.');
};
$('#btnDownload').onclick = () => {
  const blob = new Blob([JSON.stringify(S.src, null, 1)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'source.json'; a.click();
};
$('#btnConnect').onclick = () => {
  if (S.gh) { $('#inRepo').value = S.gh.repo; $('#inBranch').value = S.gh.branch;
              $('#inPath').value = S.gh.path; $('#inToken').value = S.gh.token; }
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
  const typed = $('#inRepo').value, token = $('#inToken').value.trim();
  const repo = normaliseRepo(typed);
  if (!repo) {
    return showConnectError(typed.trim()
      ? `Could not read a repository from "${typed.trim()}". It needs both parts — qingyimakes/past-lives.`
      : 'Repository is empty. It should be qingyimakes/past-lives.');
  }
  $('#inRepo').value = repo;
  if (!token) return showConnectError('Paste a token. Create one at github.com → Settings → Developer settings → Fine-grained tokens.');
  S.gh = { repo, branch: $('#inBranch').value.trim() || 'main',
           path: $('#inPath').value.trim() || 'Content/source.json', token };
  showConnectError('connecting…');
  // Keep the sheet open unless it actually worked, so a failure is visible.
  if (await ghLoad()) {
    localStorage.setItem('pl.gh', JSON.stringify(S.gh));
    $('#sheetConnect').classList.add('hide');
  }
};
$('#btnLocal').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  S.src = JSON.parse(await f.text()); S.sha = null;
  $('#repoLine').textContent = `${f.name} (local — use Download to save)`;
  $('#sheetConnect').classList.add('hide');
  renderList(); selectFirst(); setStatus('opened from disk');
};
$('#btnCopy').onclick = async () => {
  await navigator.clipboard.writeText($('#aiPrompt').textContent);
  $('#btnCopy').textContent = 'Copied'; setTimeout(() => $('#btnCopy').textContent = 'Copy prompt', 1200);
};
$('#btnMerge').onclick = mergeReply;
$('#btnAICancel').onclick = () => $('#sheetAI').classList.add('hide');
window.addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

if (S.gh) ghLoad(); else $('#sheetConnect').classList.remove('hide');
