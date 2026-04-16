// ════════════════════════════════════
//  CONFIG — update these two constants
// ════════════════════════════════════
const SHEET_URL   = "https://script.google.com/macros/s/AKfycbwwCjiiXxZYsVENMlBbz3qHVmgvAOb7K8TVfHz833stLhxq9w1ans1XH-L3_T5xmOE/exec"; // ← paste your /exec URL
const GITHUB_BASE = "./triplet_dataset_sharp_500/"; // ← your repo must end with a trailing slash

// ════════════════════════════════════
//  FOLDER CONFIGURATION
// ════════════════════════════════════
// These must match the folder names in your repository exactly.
const SUBFOLDERS = ["baseline", "guided", "patched"]; 

// ════════════════════════════════════
//  PERMUTATION TABLE  (all 6 of [0,1,2])
// ════════════════════════════════════
const PERMS = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

// ── STATE ──
let dataset  = [];
let session  = [];
let cursor   = 0;
let results  = [];
let cfg      = {};
let ranks    = {};   // cardPos → 'best'|'mid'|'worst'
let skipCount = 0;
let failQueue = []; // rows that failed to send — retried on done screen
function preloadNext() {
  if (cursor + 1 >= session.length) return;
  const nextItem = session[cursor + 1];
  nextItem.perm.forEach(i => {
    const img = new Image();
    img.src = GITHUB_BASE + `${SUBFOLDERS[i]}/${nextItem.filename}`;
  });
}
// ════════════════════════════════════
//  BOOT — fetch images.json
// ════════════════════════════════════
(async function boot() {
  try {
    setLoadMsg("Fetching dataset…");
    const res = await fetch("images.json");
    if (!res.ok) throw new Error(`images.json returned ${res.status}`);
    dataset = await res.json();
    if (!Array.isArray(dataset) || dataset.length === 0)
      throw new Error("images.json is empty or not an array");

    document.getElementById('stat-n').textContent    = dataset.length;
    document.getElementById('stat-sess').textContent = Math.min(dataset.length, 50);
    document.getElementById('stat-time').textContent = Math.round(Math.min(dataset.length, 50) * 0.1);

    // live update stat-sess / stat-time as user edits count
    document.getElementById('inp-count').addEventListener('input', e => {
      const v = Math.min(dataset.length, parseInt(e.target.value) || 50);
      document.getElementById('stat-sess').textContent = v;
      document.getElementById('stat-time').textContent = Math.round(v * 0.1);
    });

    showScreen('s-setup');
  } catch(err) {
    const el = document.getElementById('load-err');
    el.style.display = 'block';
    el.textContent = `Failed to load: ${err.message}\n\nMake sure images.json is in the repo root and GitHub Pages is configured correctly.`;
    document.getElementById('load-msg').style.display = 'none';
  }
})();

function setLoadMsg(m) { document.getElementById('load-msg').textContent = m; }

// ════════════════════════════════════
//  SESSION START
// ════════════════════════════════════
function startSession() {
  const rater = document.getElementById('inp-rater').value.trim();
  if (!rater) { toast("Please enter your annotator ID"); return; }

  const mode  = document.getElementById('inp-mode').value;
  const count = Math.min(dataset.length, parseInt(document.getElementById('inp-count').value) || 50);

  cfg = { rater, mode, count, sessionId: `${rater}_${Date.now()}`, startTs: Date.now() };

  // Fisher-Yates shuffle → take first `count` → assign permutations (balanced cycle of 6)
  const pool = [...dataset].sort(() => Math.random() - 0.5).slice(0, count);
  session = pool.map((item, i) => ({ ...item, perm: PERMS[i % 6] }));

  cursor = 0; results = []; skipCount = 0; failQueue = [];
  document.getElementById('hdr-rater').textContent = rater;
  showScreen('s-eval');
  renderItem();
}

// ════════════════════════════════════
//  RENDER ONE ITEM
// ════════════════════════════════════
function renderItem() {
  const item = session[cursor];
  const perm = item.perm;
  
  // Construct paths dynamically based on permutation and the shared filename
  const permuted = perm.map(i => `${SUBFOLDERS[i]}/${item.filename}`); 
  
  const letters  = ['A','B','C'];
  const mode     = cfg.mode;

  // ── Header progress ──
  const pct = Math.round((cursor / session.length) * 100);
  document.getElementById('prog-bar').style.width   = pct + '%';
  document.getElementById('prog-label').textContent = `${cursor} / ${session.length}`;
  document.getElementById('prog-pct').textContent   = pct + '%';
  document.getElementById('meta-n').textContent     = cursor + 1;
  document.getElementById('meta-id').textContent    = item.id ?? '—';

  // ── Context prompt ──
  if (item.prompt) {
    document.getElementById('ctx-text').textContent = item.prompt;
    document.getElementById('ctx-bar').style.display = 'flex';
  } else {
    document.getElementById('ctx-bar').style.display = 'none';
  }

  // ── Question ──
  document.getElementById('eval-q').innerHTML = mode === 'rank3'
    ? 'Rank these images: <em>best → middle → worst</em>'
    : 'Which image is <em>the best</em>?';

  // ── Cards ──
  ranks = {};
  const grid = document.getElementById('img-grid');
  grid.innerHTML = '';

  permuted.forEach((filepath, pos) => {
    const url = GITHUB_BASE + filepath;
    const card = document.createElement('div');
    card.className = 'img-card';
    card.dataset.pos = pos;

    card.innerHTML = `
      <div class="img-thumb">
        <img class="loading" src="${url}" alt="Image ${letters[pos]}"
          onload="this.classList.replace('loading','loaded')"
          onerror="this.closest('.img-thumb').innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim);font-family:var(--mono);font-size:12px;flex-direction:column;gap:6px;\\'><span style=\\'font-size:24px;opacity:.4\\'>?</span>${filepath}</div>'">
        <div class="img-slot-label">${letters[pos]}</div>
        <div class="img-rank-badge badge-best" id="badge-${pos}-best">1st</div>
        <div class="img-rank-badge badge-mid"  id="badge-${pos}-mid">2nd</div>
        <div class="img-rank-badge badge-worst" id="badge-${pos}-worst">3rd</div>
      </div>
      <div class="img-footer">
        <span class="img-letter">Image ${letters[pos]}</span>
        ${mode === 'rank3' ? `
        <div class="rank-btns">
          <button class="rbtn" data-pos="${pos}" data-r="best"  onclick="assign(${pos},'best')">1st</button>
          <button class="rbtn" data-pos="${pos}" data-r="mid"   onclick="assign(${pos},'mid')">2nd</button>
          <button class="rbtn" data-pos="${pos}" data-r="worst" onclick="assign(${pos},'worst')">3rd</button>
        </div>` : `
        <div class="rank-btns">
          <button class="rbtn" data-pos="${pos}" data-r="best" onclick="assign(${pos},'best')">Best ✓</button>
        </div>`}
      </div>`;

    card.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      if (mode === 'best') assign(pos, 'best');
    });

    grid.appendChild(card);
  });

  updateNextBtn();
  document.getElementById('save-ind').style.display = 'none';
  preloadNext();
}

// ════════════════════════════════════
//  RANKING LOGIC
// ════════════════════════════════════
function assign(pos, rank) {
  if (cfg.mode === 'best') {
    ranks = {}; ranks[pos] = 'best';
  } else {
    for (const k in ranks) if (ranks[k] === rank) delete ranks[k];
    ranks[pos] = rank;
  }
  refreshCards();
  updateNextBtn();
}

function refreshCards() {
  const rankToClass = { best:'rank-best', mid:'rank-mid', worst:'rank-worst' };
  const rankNames   = ['best','mid','worst'];

  document.querySelectorAll('.img-card').forEach(card => {
    const pos  = parseInt(card.dataset.pos);
    const rank = ranks[pos];

    card.classList.remove('rank-best','rank-mid','rank-worst');
    if (rank) card.classList.add(rankToClass[rank]);

    rankNames.forEach(r => {
      const el = document.getElementById(`badge-${pos}-${r}`);
      if (el) el.classList.toggle('show', rank === r);
    });

    card.querySelectorAll('.rbtn').forEach(btn => {
      const r = btn.dataset.r;
      btn.className = 'rbtn';
      if (rank && r === rank) btn.classList.add(`on-${rank}`);
    });
  });
}

function isComplete() {
  if (cfg.mode === 'best') return Object.keys(ranks).length === 1;
  const vals = Object.values(ranks);
  return vals.includes('best') && vals.includes('mid') && vals.includes('worst');
}

function updateNextBtn() {
  document.getElementById('btn-next').classList.toggle('ready', isComplete());
}

// ════════════════════════════════════
//  SUBMIT & ADVANCE
// ════════════════════════════════════
async function confirmAndNext() {
  if (!isComplete()) return;

  const item = session[cursor];
  const perm = item.perm;

  const posToOrig = pos => perm[parseInt(pos)];
  const rankMap   = {};
  for (const [pos, rank] of Object.entries(ranks)) rankMap[rank] = posToOrig(pos);

  const row = {
    session_id:    cfg.sessionId,
    annotator_id:  cfg.rater,
    timestamp:     new Date().toISOString(),
    triple_id:     item.id ?? cursor,
    prompt:        item.prompt ?? "",
    image_A_file:  `${SUBFOLDERS[0]}/${item.filename}`,
    image_B_file:  `${SUBFOLDERS[1]}/${item.filename}`,
    image_C_file:  `${SUBFOLDERS[2]}/${item.filename}`,
    image_A_url:   GITHUB_BASE + `${SUBFOLDERS[0]}/${item.filename}`,
    image_B_url:   GITHUB_BASE + `${SUBFOLDERS[1]}/${item.filename}`,
    image_C_url:   GITHUB_BASE + `${SUBFOLDERS[2]}/${item.filename}`,
    perm_order:    JSON.stringify(perm),
    display_order: perm.map(i => ['A','B','C'][i]).join(','),
    best_orig_idx: rankMap['best']  ?? "",
    mid_orig_idx:  rankMap['mid']   ?? "",
    worst_orig_idx:rankMap['worst'] ?? "",
    best_label:    rankMap['best']  !== undefined ? ['A','B','C'][rankMap['best']] : "",
    mid_label:     rankMap['mid']   !== undefined ? ['A','B','C'][rankMap['mid']]  : "",
    worst_label:   rankMap['worst'] !== undefined ? ['A','B','C'][rankMap['worst']]: "",
    task_mode:     cfg.mode,
  };

  results.push(row);
  saveRowToSheet(row);

  cursor++;
  if (cursor >= session.length) { showDone(); return; }
  renderItem();
}

function saveRowToSheet(row) {
  const ind = document.getElementById('save-ind');
  ind.style.display = 'flex';
  ind.className = 'saving-indicator';
  document.getElementById('save-txt').textContent = 'saving…';

  fetch(SHEET_URL, {
    method: 'POST',
    mode:   'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(row)
  })
  .then(() => {
    ind.className = 'saving-indicator saved';
    document.getElementById('save-txt').textContent = 'saved ✓';
    setTimeout(() => { ind.style.display = 'none'; }, 1800);
  })
  .catch(() => {
    failQueue.push(row);
    ind.className = 'saving-indicator err';
    document.getElementById('save-txt').textContent = 'save failed — backed up locally';
    setTimeout(() => { ind.style.display = 'none'; }, 3000);
  });
}

function skipItem() {
  skipCount++;
  cursor++;
  if (cursor >= session.length) { showDone(); return; }
  renderItem();
  toast(`Skipped — ${session.length - cursor} remaining`);
}

// ════════════════════════════════════
//  DONE SCREEN
// ════════════════════════════════════
function showDone() {
  const dur = Math.round((Date.now() - cfg.startTs) / 60000);
  document.getElementById('done-sub').textContent =
    `${results.length} annotations · ${cfg.rater} · ~${dur} min`;

  const sb = document.getElementById('done-stats');
  sb.innerHTML = `
    <div class="stat-box"><div class="stat-val">${results.length}</div><div class="stat-lbl">Annotated</div></div>
    <div class="stat-box"><div class="stat-val">${skipCount}</div><div class="stat-lbl">Skipped</div></div>
    <div class="stat-box"><div class="stat-val">${dur}m</div><div class="stat-lbl">Duration</div></div>`;

  const wins = [0,0,0];
  results.forEach(r => { const b = r.best_orig_idx; if (b !== "") wins[b]++; });
  const total = results.length || 1;
  const wr = document.getElementById('win-rows');
  wr.innerHTML = '';
  ['A','B','C'].forEach((lbl, i) => {
    const pct = Math.round(wins[i] / total * 100);
    wr.innerHTML += `
      <div class="win-row">
        <span class="win-label">Image ${lbl}</span>
        <div class="win-track"><div class="win-bar bar-${lbl.toLowerCase()}" style="width:0%" data-pct="${pct}"></div></div>
        <span class="win-pct">${pct}%</span>
      </div>`;
  });
  
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.win-bar[data-pct]').forEach(b => {
      b.style.width = b.dataset.pct + '%';
    });
  }));

  if (failQueue.length > 0) {
    document.getElementById('sync-note').innerHTML =
      `${failQueue.length} row(s) failed to save. <a onclick="retryFailed()">Retry now</a> or export JSON below.`;
  } else {
    document.getElementById('sync-note').textContent = 'All responses saved to Google Sheets ✓';
  }

  showScreen('s-done');
}

async function retryFailed() {
  const q = [...failQueue]; failQueue = [];
  for (const row of q) { saveRowToSheet(row); await new Promise(r => setTimeout(r, 200)); }
  toast(`Retrying ${q.length} rows…`);
}

// ════════════════════════════════════
//  EXPORT
// ════════════════════════════════════
function exportJSON() {
  const out = { session_id: cfg.sessionId, annotator: cfg.rater, mode: cfg.mode, results, exported_at: new Date().toISOString() };
  dl(JSON.stringify(out, null, 2), `trieval_${cfg.rater}_${Date.now()}.json`, 'application/json');
}

function exportCSV() {
  if (!results.length) { toast("No results to export"); return; }
  const keys = Object.keys(results[0]);
  const rows = [keys, ...results.map(r => keys.map(k => `"${String(r[k]).replace(/"/g,'""')}"`))];
  dl(rows.map(r => r.join(',')).join('\n'), `trieval_${cfg.rater}_${Date.now()}.csv`, 'text/csv');
}

function dl(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
}

// ════════════════════════════════════
//  KEYBOARD SHORTCUTS
// ════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!document.getElementById('s-eval').classList.contains('active')) return;
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

  const mode = cfg.mode;
  if (e.key === '1') { assign(0, 'best'); }
  else if (e.key === '2') {
    if (mode === 'rank3') assign(1, 'mid');
    else assign(1, 'best');
  }
  else if (e.key === '3') {
    if (mode === 'rank3') assign(2, 'worst');
    else assign(2, 'best');
  }
  else if (e.key === '4' && mode === 'rank3') assign(0, 'mid');
  else if (e.key === '5' && mode === 'rank3') assign(1, 'worst');
  else if (e.key === '6' && mode === 'rank3') assign(2, 'mid');
  else if ((e.key === 'ArrowRight' || e.key === 'Enter') && isComplete()) confirmAndNext();
});

// ════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}