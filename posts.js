/* Drafts Desk posts - the long-post pipeline screens. Loaded before the main script, runs after it, shares its globals
   (S, esc, $, gh, raw, put, toast, render, snip, copy, loadDoc, DD). */

const b64d = b => decodeURIComponent(escape(atob(String(b).replace(/\s/g, ''))));
const enc = p => encodeURI(p);

async function listDirs(dir){
  const r = await gh('/contents/' + enc(dir));
  if(r.status === 404) return [];
  if(!r.ok) throw new Error(dir + ' ' + r.status);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}
async function getJson(path){ const r = await gh('/contents/' + enc(path)); return r.ok ? r.json() : null; }

/** read a text file into S.docs, treating a missing file as empty when okMissing */
async function ensureDoc(path, okMissing){
  if(S.docs[path] !== undefined) return;
  S.docs[path] = null;
  try{ S.docs[path] = await raw(path); }
  catch(e){ S.docs[path] = (okMissing && /404/.test(String(e.message))) ? '' : 'Could not load this file (' + e.message + ').'; }
  render();
}

/* ---------- loading ---------- */
async function loadPosts(){
  if(!S.pipe){ try{ S.pipe = JSON.parse(await raw('pipeline.json')); }catch(e){ S.pipe = null; } }
  const dirs = (await listDirs('drafts')).filter(d => d.type === 'dir').map(d => d.name);
  const sts = await Promise.all(dirs.map(n => raw('drafts/' + n + '/status.json').then(t => JSON.parse(t)).catch(() => null)));
  const old = S.pp || {}; S.pp = {};
  sts.forEach(st => {
    if(!st || !st.slug) return;
    S.pp[st.slug] = st;
    if(!old[st.slug] || old[st.slug].updated !== st.updated) invalidate(st.slug);
    const pn = S.pending[st.slug]; if(pn && pn.u !== st.updated) delete S.pending[st.slug];
  });
  Object.keys(S.pending).forEach(k => { if(Date.now() - S.pending[k].t > 240000) delete S.pending[k]; });
  if(S.reader && S.reader.type === 'post') await loadFiles(S.reader.slug);
}
function invalidate(slug){
  Object.keys(S.docs).forEach(k => { if(k.indexOf('drafts/' + slug + '/') === 0) delete S.docs[k]; });
  delete S.files[slug];
}
async function loadFiles(slug){
  if(S.files[slug]) return;
  try{
    const [a, b] = await Promise.all([listDirs('drafts/' + slug + '/_source'), listDirs('drafts/' + slug)]);
    S.files[slug] = {src: new Set(a.map(f => f.name)), docx: b.some(f => f.name === 'draft.docx')};
  }catch(e){ S.files[slug] = {src: new Set(), docx: false}; }
}

/* ---------- helpers ---------- */
const stepInfo = p => { const ss = S.pipe.tracks[p.track].steps; return {ss, cur: ss.find(s => s.id === p.step) || ss[0], track: S.pipe.tracks[p.track].label}; };
function pstate(p){ const pn = S.pending[p.slug]; return (pn && pn.u === p.updated) ? 'queued' : p.state; }
const schip = st => { const [l, c] = DD.POST_STATE[st] || [st, '']; return '<span class="chip ' + c + '">' + esc(l) + '</span>'; };
const anyRunning = () => Object.values(S.pp || {}).some(p => p.state === 'running') || Object.keys(S.pending).length > 0;
const needsYou = () => Object.values(S.pp || {}).filter(p => ['waiting', 'ready', 'error'].includes(pstate(p))).length;
const bufKey = (slug, n) => slug + '|' + n;
function ta(slug, name, init, ph, big){
  return '<textarea class="' + (big ? 'big' : '') + '" data-buf="' + esc(bufKey(slug, name)) + '" data-init="' + esc(init || '') + '" placeholder="' + esc(ph || '') + '"></textarea>';
}
const bval = (slug, name, init) => { const k = bufKey(slug, name); return S.buf[k] !== undefined ? S.buf[k] : (init || ''); };
const docOf = (slug, f) => S.docs['drafts/' + slug + '/_source/' + f];
const back = '<div class="row" style="margin-bottom:10px"><button class="btn sm ghost" onclick="history.back()">&larr; Back</button></div>';

/* ---------- commands ---------- */
function cmdName(slug, action){
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return 'commands/' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + slug + '-' + action + '.json';
}
async function sendCmd(slug, action, params, msg){
  try{
    await put(cmdName(slug, action), JSON.stringify({slug, action, params: params || {}, handled: false, ts: new Date().toISOString()}, null, 2) + '\n', action + ' ' + slug);
    const p = S.pp[slug];
    S.pending[slug] = {u: p ? p.updated : 'new', t: Date.now(), title: (params || {}).title || ''};
    S.pollUntil = Date.now() + 150000;
    toast(msg || 'Sent. Claude is on it, you will get a notification.', 4200);
    render();
    return true;
  }catch(e){ toast('Could not send: ' + e.message, 4200); return false; }
}
const noteOf = slug => (S.buf[bufKey(slug, 'note')] || '').trim();
async function runStep(slug){ const n = noteOf(slug); delete S.buf[bufKey(slug, 'note')]; await sendCmd(slug, 'run', {note: n}); }
async function redoStep(slug, step, label){
  const n = noteOf(slug);
  delete S.buf[bufKey(slug, 'note')];
  await sendCmd(slug, 'redo', {step, note: n}, label || 'Sent. Claude is redoing it.');
}
async function completeStep(slug, params, msg){ await sendCmd(slug, 'complete', params || {}, msg || 'Done. Moving to the next step.'); }

/* ---------- new post ---------- */
function openNew(){ S.newPost = S.newPost || {track: 'business', mode: 'scout', fromIdea: null}; go('posts'); }
function longFromIdea(id){
  const i = S.ideas.find(x => x.id === id); if(!i) return;
  S.buf['new|title'] = snip(i.body, 90); S.buf['new|seed'] = i.body;
  S.newPost = {track: 'business', mode: 'topic', fromIdea: id};
  go('posts');
}
function setNew(k, v){ S.newPost[k] = v; render(); }
async function startPost(){
  const n = S.newPost, track = n.track, scout = track === 'business' && n.mode === 'scout';
  const title = (S.buf['new|title'] || '').trim(), seed = (S.buf['new|seed'] || '').trim(), persona = (S.buf['new|persona'] || '').trim();
  if(!scout && !title){ toast('Add a topic or working title'); return; }
  if(Object.values(S.pending).some(x => x.u === 'new' && (x.title || '') === (scout ? '' : title))){ toast('That post is already being started'); return; }
  let slug = DD.slugify(scout ? 'new post topic scout' : title), k = 2;
  while(S.pp[slug] || S.pending[slug]) slug = DD.slugify(scout ? 'new post topic scout' : title) + '-' + (k++);
  const ok = await sendCmd(slug, 'start', {track, mode: scout ? 'scout' : 'topic', title: scout ? '' : title, topic: title, seed, persona}, scout ? 'Started. Claude is researching topics.' : 'Started. Add your raw material next.');
  if(ok){
    if(n.fromIdea) put('decisions/' + n.fromIdea + '.json', JSON.stringify({action: 'long', slug, ts: new Date().toISOString(), handled: false}, null, 2) + '\n', 'long ' + n.fromIdea).catch(() => {});
    ['new|title', 'new|seed', 'new|persona'].forEach(x => delete S.buf[x]);
    S.newPost = null; render();
  }
}

/* ---------- posts list ---------- */
function postCard(p){
  const info = stepInfo(p), st = pstate(p), stg = DD.stages(info.ss, p), cur = stg.find(g => g.current) || stg[stg.length - 1];
  return '<div class="card tap" data-post="' + esc(p.slug) + '"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><b style="min-width:0">' + esc(p.title || p.slug) + '</b>' + schip(st) + '</div>' +
    '<div class="muted">' + esc(info.track) + ' &middot; Step ' + cur.n + ' of ' + stg.length + ' &middot; ' + esc(info.cur.label) + '</div>' +
    '<div class="bar">' + stg.map(g => '<i class="seg ' + (g.done ? 'done' : g.current ? 'cur' : '') + '"></i>').join('') + '</div>' +
    '<div class="muted" style="font-size:13px">Updated ' + esc(DD.relTime(p.updated)) + '</div></div>';
}
function vNew(){
  const n = S.newPost, bus = n.track === 'business', scout = bus && n.mode === 'scout';
  const seg = (k, v, l) => '<button class="btn sm ' + (n[k] === v ? '' : 'ghost') + '" onclick="setNew(\'' + k + '\',\'' + v + '\')">' + l + '</button>';
  let h = '<div class="card soft"><b>New long post</b><label>Track</label><div class="row">' + seg('track', 'business', 'Inflektion Point') + seg('track', 'personal', 'Personal') + '</div>';
  if(bus) h += '<label>How do you want to start?</label><div class="row">' + seg('mode', 'scout', 'Find a topic for me') + seg('mode', 'topic', 'I already have a topic') + '</div>';
  if(scout) h += '<label>Any steer? (optional, for example "first-time managers")</label>' + ta('new', 'persona', '', 'Leave empty to let Claude pick');
  else h += '<label>' + (bus ? 'The question or topic' : 'Working title') + '</label>' + ta('new', 'title', '', 'What is this post about?') +
    '<label>Your first notes (optional, you can add them in the next step)</label>' + ta('new', 'seed', '', 'Bullets, sentences, dictated is fine');
  return h + '<div class="row" style="margin-top:12px"><button class="btn" onclick="startPost()">Start</button><button class="btn ghost" onclick="S.newPost=null;render()">Cancel</button></div></div>';
}
function vPosts(){
  if(!S.pipe) return '<div class="empty">' + (S.loaded ? 'The pipeline file could not be loaded. Tap Refresh.' : 'Loading...') + '</div>';
  let h = '<div class="row" style="justify-content:space-between;margin-bottom:6px"><h2 style="margin:6px 0">Long posts</h2>' + (S.newPost ? '' : '<button class="btn sm" onclick="openNew()">+ New post</button>') + '</div>';
  if(S.newPost) h += vNew();
  const live = Object.values(S.pp).filter(p => p.state !== 'done').sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  Object.keys(S.pending).filter(s => !S.pp[s]).forEach(s => {
    h += '<div class="card"><b>' + esc(S.pending[s].title || 'New post') + '</b> ' + schip('queued') + '<div class="muted">Starting up, this takes under a minute.</div></div>';
  });
  h += live.map(postCard).join('');
  if(!live.length && !Object.keys(S.pending).length && !S.newPost) h += '<div class="empty"><img src="mascot.png" alt=""><div>No long posts in progress.<br>Tap New post to start one, or turn a short idea into one from Review.</div></div>';
  const doneN = Object.values(S.pp).filter(p => p.state === 'done').length;
  if(doneN) h += '<p class="muted" style="text-align:center">' + doneN + ' published post' + (doneN > 1 ? 's' : '') + ' live in Library.</p>';
  return h;
}

/* ---------- post detail ---------- */
function openPost(slug){ S.reader = {type: 'post', slug, file: null, edit: false}; loadFiles(slug).then(render); render(); window.scrollTo(0, 0); }
function openFile(slug, file){ S.reader.file = file; S.reader.edit = false; ensureDoc('drafts/' + slug + '/_source/' + file, false); render(); window.scrollTo(0, 0); }

function vPost(r){
  const p = S.pp[r.slug];
  if(!p || !S.pipe) return back + '<p class="muted">Loading...</p>';
  if(r.file) return vFile(r, p);
  const info = stepInfo(p), st = pstate(p), stg = DD.stages(info.ss, p), cur = stg.find(g => g.current) || stg[stg.length - 1];
  let h = back + '<div class="card"><h2 style="margin-top:0">' + esc(p.title || p.slug) + '</h2><div class="row"><span class="chip">' + esc(info.track) + '</span>' + schip(st) + '</div><div class="stepper">' +
    stg.map(g => '<div class="stg ' + (g.done ? 'done' : g.current ? 'cur' : '') + '"><span class="dot">' + (g.done ? '&#10003;' : g.n) + '</span>' + esc(g.label) + '</div>').join('') + '</div></div>';
  h += '<div class="card soft"><div class="muted">Step ' + cur.n + ' of ' + stg.length + '</div><h3 style="margin:2px 0 8px">' + esc(info.cur.label) + '</h3>' + panelBody(p, st, info) + '</div>';
  const f = S.files[p.slug], arts = S.pipe.artifacts.filter(a => f && f.src.has(a.file));
  if(arts.length) h += '<div class="card"><b>Files</b><div class="row" style="margin-top:8px">' + arts.map(a => '<button class="btn sm ghost" onclick="openFile(\'' + esc(p.slug) + '\',\'' + esc(a.file) + '\')">' + esc(a.label) + '</button>').join('') + '</div></div>';
  const lg = (p.log || []).slice(-6).reverse();
  if(lg.length) h += '<div class="card"><b>Activity</b>' + lg.map(l => '<div class="item"><div class="tx">' + esc((S.pipe.tracks[p.track].steps.find(s => s.id === l.step) || {label: l.step}).label) + ' &middot; ' + esc(l.event) + '</div><span class="muted">' + esc(DD.relTime(l.ts)) + '</span></div>').join('') + '</div>';
  return h;
}

function panelBody(p, st, info){
  const step = info.cur, slug = p.slug, q = esc(slug);
  if(st === 'queued') return '<p>Sent. Claude will pick this up in under a minute and you will get a notification when it is done.</p>';
  if(st === 'running') return '<p>Claude is working on <b>' + esc(step.label) + '</b>. This usually takes a few minutes. You can close the app, you will get a notification.</p><p class="muted">' + esc(step.desc || '') + '</p><button class="btn sm ghost" onclick="load()">Check now</button>';
  if(st === 'error') return '<div class="q"><b>Something went wrong</b><br>' + esc(p.error || 'Unknown error') + '</div><div class="row"><button class="btn sm" onclick="runStep(\'' + q + '\')">Retry</button></div>';
  if(st === 'done'){ const u = (p.meta || {}).url; return '<p>Published and archived.</p>' + (u ? '<a class="btn sm" style="text-decoration:none" target="_blank" rel="noopener" href="' + esc(u) + '">Open on Substack</a>' : ''); }
  if(st === 'ready') return '<p>' + esc(step.desc || '') + '</p><label>Any instruction for this step? (optional)</label>' + ta(slug, 'note', '', 'For example, keep it shorter') + '<div style="margin-top:10px"><button class="btn" onclick="runStep(\'' + q + '\')">Run it</button></div>';
  return waitingPanel(p, step, q);
}

function laptopCard(p){
  const q = esc(p.slug), f = S.files[p.slug] || {docx: false};
  return '<div class="card"><b>Prefer the laptop?</b><p class="muted" style="margin:6px 0">Open this app in your laptop browser and tap Edit, it gives you a big editor. Or work in Word, which is optional.</p>' +
    '<div class="row"><button class="btn sm ghost" onclick="sendCmd(\'' + q + '\',\'export\',{file:\'draft\'},\'Making the .docx, you will get a notification.\')">Send to laptop (.docx)</button>' +
    (f.docx ? '<button class="btn sm ghost" onclick="downloadDocx(\'' + q + '\')">Download .docx</button><button class="btn sm ghost" onclick="$(\'upl\').click()">Upload edited .docx</button><button class="btn sm" onclick="sendCmd(\'' + q + '\',\'import\',{file:\'draft\'},\'Bringing your edits into the draft.\')">Bring my edits back</button>' : '') + '</div>' +
    '<input type="file" id="upl" accept=".docx" style="display:none" onchange="uploadDocx(\'' + q + '\',this)">' +
    '<p class="muted" style="margin:8px 0 0">Terminal users can also edit <code>drafts/' + q + '/_source/draft.md</code> and push.</p></div>';
}

function waitingPanel(p, step, q){
  const slug = p.slug, src = f => 'drafts/' + slug + '/_source/' + f;
  if(step.id === 'pick'){
    ensureDoc(src('topics.md'), false);
    const t = docOf(slug, 'topics.md');
    if(t == null) return '<p class="muted">Loading topics...</p>';
    const topics = DD.parseTopics(t);
    return '<p>Pick the question you want to answer.</p>' + topics.map((o, i) => '<div class="var"><b>' + esc(o.question) + '</b><div class="row" style="margin:6px 0"><span class="chip">' + esc(o.persona) + '</span></div><div class="muted">' + esc(o.source) + '</div><div style="margin-top:8px"><button class="btn sm" onclick="pickTopic(\'' + q + '\',' + i + ')">Pick this one</button></div></div>').join('') +
      '<label>Not these? Ask for new ones</label>' + ta(slug, 'note', '', 'For example, something about hiring, or a different reader') + '<div style="margin-top:8px"><button class="btn sm ghost" onclick="redoStep(\'' + q + '\',\'topics\')">Find different topics</button></div>';
  }
  if(step.id === 'bullets'){
    ensureDoc(src('topic.md'), true); ensureDoc(src('bullets.md'), true);
    const tp = docOf(slug, 'topic.md'), bl = docOf(slug, 'bullets.md');
    if(tp == null || bl == null) return '<p class="muted">Loading...</p>';
    return '<div class="q"><b>' + (p.track === 'business' ? 'The question' : 'Working title') + '</b><br>' + esc(tp.replace(/^#.*\n+/, '').trim()) + '</div>' +
      '<p class="muted">Answer in your own words. Real examples, real numbers, short bullets are fine. Tap the microphone on your keyboard to dictate.</p>' + ta(slug, 'bullets', bl, 'Your raw material', true) +
      '<div class="row" style="margin-top:10px"><button class="btn sm ghost" onclick="saveBullets(\'' + q + '\',false)">Save</button><button class="btn sm" onclick="saveBullets(\'' + q + '\',true)">Save and draft it</button></div>';
  }
  if(step.id === 'rewrite'){
    ensureDoc(src('draft.md'), false);
    const d = docOf(slug, 'draft.md');
    const words = d ? d.split(/\s+/).filter(Boolean).length : 0;
    return '<p>' + esc(step.desc) + '</p><div class="row"><button class="btn sm" onclick="beginEdit(\'' + q + '\',\'draft.md\')">Edit draft here</button><button class="btn sm ghost" onclick="openFile(\'' + q + '\',\'draft.md\')">Read it</button></div>' +
      (d ? '<p class="muted" style="margin-top:8px">About ' + words + ' words.</p>' : '') + laptopCard(p) +
      '<label>Want Claude to redo the whole draft? Say what to change (this replaces your edits)</label>' + ta(slug, 'note', '', 'For example, open with the story, cut the second section') +
      '<div class="row" style="margin-top:8px"><button class="btn sm ghost" onclick="confirmRedoDraft(\'' + q + '\')">Redo the draft</button><button class="btn" onclick="completeStep(\'' + q + '\',{},\'Rewrite done. Claude is learning from your changes.\')">My rewrite is done, continue</button></div>';
  }
  if(step.id === 'image-confirm'){
    ensureDoc(src('image-concept.md'), false);
    const c = docOf(slug, 'image-concept.md');
    return (c == null ? '<p class="muted">Loading...</p>' : '<div class="doc">' + mdHtml(c) + '</div>') +
      '<div style="margin:10px 0"><button class="btn" onclick="confirmImage(\'' + q + '\')">Looks good, write the prompt</button></div>' +
      '<label>Want a different concept? Say what to change</label>' + ta(slug, 'note', '', 'For example, a ladder instead of a pyramid') + '<div style="margin-top:8px"><button class="btn sm ghost" onclick="redoStep(\'' + q + '\',\'image-concept\',\'Sent. Claude is reworking the concept.\')">Redirect the concept</button></div>';
  }
  if(step.id === 'engage'){
    ensureDoc(src('review.md'), true); ensureDoc('brand/linkedin-growth.md', true);
    const rv = docOf(slug, 'review.md'), cl = S.docs['brand/linkedin-growth.md'], v = DD.verdict(rv || '');
    let chk = '';
    if(cl){ const m = cl.match(/## The engagement checklist[^\n]*\n([\s\S]*?)\n## /); chk = m ? m[1] : ''; }
    return '<div class="row"><span class="chip ' + (v === 'PASS' ? 'posted' : 'warn') + '">Editor ' + esc(v || 'pending') + '</span></div>' +
      (rv ? '<div class="doc" style="margin:10px 0">' + mdHtml(rv.replace(/^\s*verdict:.*\n/i, '')) + '</div>' : '') +
      (v === 'FIX' ? '<p class="muted">Fix what it flags (tap Files below to edit the draft or LinkedIn version), then run the editor again.</p>' : '') +
      '<div class="row"><button class="btn sm ghost" onclick="redoStep(\'' + q + '\',\'editor\',\'Sent. Claude is running the editor again.\')">Run editor again</button></div>' +
      (chk ? '<h3 style="margin:14px 0 6px">Your engagement checklist</h3><div class="doc">' + mdHtml(chk) + '</div>' : '') +
      '<div style="margin-top:12px"><button class="btn" onclick="completeStep(\'' + q + '\')">Checklist done, continue</button></div>';
  }
  if(step.id === 'ship'){
    const copies = [['draft.md', 'Copy article'], ['linkedin.md', 'Copy LinkedIn'], ['geo-package.md', 'Copy SEO package'], ['image-prompt.md', 'Copy image prompt']].filter(c => (S.files[slug] || {src: new Set()}).src.has(c[0]));
    return '<p>Publish on Substack and LinkedIn yourself. Use these to copy things across, then paste the live Substack link below.</p><div class="row">' +
      copies.map(c => '<button class="btn sm ghost" onclick="copyFile(\'' + q + '\',\'' + esc(c[0]) + '\')">' + esc(c[1]) + '</button>').join('') + '</div>' +
      '<label>Live Substack link</label><input data-buf="' + esc(bufKey(slug, 'url')) + '" data-init="" placeholder="https://mydraftsfolder.substack.com/p/..." autocapitalize="none" autocorrect="off">' +
      '<div style="margin-top:10px"><button class="btn" onclick="shipIt(\'' + q + '\')">I published it, archive it</button></div>';
  }
  return '<p>' + esc(step.desc || '') + '</p><button class="btn" onclick="completeStep(\'' + q + '\')">Continue</button>';
}

/* ---------- panel actions ---------- */
async function pickTopic(slug, i){
  const t = DD.parseTopics(docOf(slug, 'topics.md') || '')[i]; if(!t) return;
  await completeStep(slug, {text: t.question}, 'Topic chosen. Add your raw material next.');
}
async function saveBullets(slug, thenDraft){
  const text = bval(slug, 'bullets', docOf(slug, 'bullets.md')).trim();
  if(!text){ toast('Write or dictate something first'); return; }
  try{
    await put('drafts/' + slug + '/_source/bullets.md', text + '\n', 'bullets ' + slug);
    S.docs['drafts/' + slug + '/_source/bullets.md'] = text + '\n'; delete S.buf[bufKey(slug, 'bullets')];
    if(S.files[slug]) S.files[slug].src.add('bullets.md');
    if(thenDraft) await completeStep(slug, {}, 'Saved. Claude is drafting the article.'); else { toast('Saved'); render(); }
  }catch(e){ toast('Could not save: ' + e.message, 4200); }
}
function confirmRedoDraft(slug){
  if(!noteOf(slug)){ toast('Say what to change first'); return; }
  if(confirm('This replaces the current draft, including any edits you made. Continue?')) redoStep(slug, 'draft', 'Sent. Claude is redrafting.');
}
async function confirmImage(slug){ const n = noteOf(slug); delete S.buf[bufKey(slug, 'note')]; await completeStep(slug, {note: n}, 'Concept confirmed. Claude is writing the prompt.'); }
async function copyFile(slug, f){ const path = 'drafts/' + slug + '/_source/' + f; await ensureDoc(path, false); const t = S.docs[path]; if(t) copy(t); else toast('Still loading, tap again'); }
async function shipIt(slug){
  const url = (S.buf[bufKey(slug, 'url')] || '').trim();
  if(!/^https?:\/\//.test(url)){ toast('Paste the live Substack link first'); return; }
  await completeStep(slug, {url}, 'Archiving. It will appear in your Library shortly.');
}

/* ---------- file viewer and editor ---------- */
async function beginEdit(slug, file){
  if(!S.reader || S.reader.type !== 'post' || S.reader.slug !== slug) S.reader = {type: 'post', slug, file: null, edit: false};
  const path = 'drafts/' + slug + '/_source/' + file;
  const j = await getJson(path);
  if(!j){ toast('Could not open the file for editing'); return; }
  delete S.buf[bufKey(slug, file)];
  S.docs[path] = b64d(j.content);
  S.reader.file = file; S.reader.edit = true; S.reader.sha = j.sha;
  render(); window.scrollTo(0, 0);
}
async function saveEdit(){
  const r = S.reader, path = 'drafts/' + r.slug + '/_source/' + r.file;
  const text = bval(r.slug, r.file, S.docs[path]);
  const body = {message: 'edit ' + r.file + ' (' + r.slug + ')', content: b64e(text), sha: r.sha};
  try{
    const res = await gh('/contents/' + enc(path), {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if(res.status === 409 || res.status === 422){ toast('This file changed somewhere else, maybe your laptop. Copy your text, tap Cancel and reopen to get the latest.', 6000); return; }
    if(!res.ok) throw new Error('save failed ' + res.status);
    delete S.buf[bufKey(r.slug, r.file)]; S.docs[path] = text; r.edit = false; toast('Saved'); render();
  }catch(e){ toast('Could not save: ' + e.message, 4200); }
}
function cancelEdit(){ const r = S.reader; delete S.buf[bufKey(r.slug, r.file)]; delete S.docs['drafts/' + r.slug + '/_source/' + r.file]; r.edit = false; ensureDoc('drafts/' + r.slug + '/_source/' + r.file, false); render(); }
function vFile(r, p){
  const path = 'drafts/' + p.slug + '/_source/' + r.file, art = S.pipe.artifacts.find(a => a.file === r.file) || {label: r.file, render: 'md'};
  const doc = S.docs[path];
  let h = back + '<div class="card"><h2 style="margin-top:0">' + esc(art.label) + '</h2><div class="muted">' + esc(p.title || p.slug) + '</div>';
  if(doc == null) return h + '<p class="muted">Loading...</p></div>';
  if(r.edit){
    return h + '<textarea class="big" data-buf="' + esc(bufKey(p.slug, r.file)) + '" data-init="' + esc(doc) + '"></textarea><div class="row" style="margin-top:10px"><button class="btn" onclick="saveEdit()">Save</button><button class="btn ghost" onclick="cancelEdit()">Cancel</button></div></div>';
  }
  h += '<div class="row" style="margin:10px 0"><button class="btn sm sky" onclick="copy(S.docs[\'' + esc(path) + '\'])">Copy</button>' + (art.editable ? '<button class="btn sm" onclick="beginEdit(\'' + esc(p.slug) + '\',\'' + esc(r.file) + '\')">Edit</button>' : '') + '</div>';
  h += (art.render === 'md' ? '<div class="doc">' + mdHtml(doc) + '</div>' : '<div class="doc pre">' + esc(doc) + '</div>') + '</div>';
  if(r.file === 'draft.md') h += laptopCard(p);
  return h;
}

/* ---------- optional .docx path ---------- */
async function downloadDocx(slug){
  try{
    const res = await gh('/contents/' + enc('drafts/' + slug + '/draft.docx'), {headers: {Accept: 'application/vnd.github.raw+json'}});
    if(!res.ok) throw new Error(res.status);
    const url = URL.createObjectURL(await res.blob()), a = document.createElement('a');
    a.href = url; a.download = slug + '-draft.docx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }catch(e){ toast('Could not download: ' + e.message, 4200); }
}
async function uploadDocx(slug, input){
  const f = input.files && input.files[0]; if(!f) return;
  try{
    const bytes = new Uint8Array(await f.arrayBuffer()); let bin = '';
    for(let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const path = 'drafts/' + slug + '/draft.docx', cur = await getJson(path);
    const body = {message: 'upload edited draft.docx (' + slug + ')', content: btoa(bin)}; if(cur) body.sha = cur.sha;
    const res = await gh('/contents/' + enc(path), {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
    if(!res.ok) throw new Error('upload failed ' + res.status);
    toast('Uploaded. Tap Bring my edits back.', 4200);
  }catch(e){ toast('Could not upload: ' + e.message, 4200); }
  input.value = '';
}
