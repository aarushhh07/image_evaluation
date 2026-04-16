// ════════════════════════════════════
//  CONFIG
// ════════════════════════════════════
const SHEET_URL   = "https://script.google.com/macros/s/AKfycbwc1ZB26VJY9rgiYKSi56JxB6WUsPgTi7InrmJ8mrAJJf2DRhDBbFyFGMu196hoebtB/exec";
const GITHUB_BASE = "./dataset/";

// ════════════════════════════════════
//  PROMPT / FOLDER CONFIGURATION
//  Each category must contain guided/ and patched/ subfolders.
//  baseline/ sits at dataset/baseline/
// ════════════════════════════════════
const PROMPT_TYPES  = ["colors", "contrast", "sharper"];
const PROMPT_LABELS = ["color", "contrast", "sharpness"];
const BASELINE_DIR  = "baseline";
const VARIANTS      = ["guided", "patched"];

// Permutations for 2 images (guided=0, patched=1)
const PERMS = [[0,1],[1,0]];

// ── STATE ──
let dataset   = [];   // expanded (one entry per filename × category)
let session   = [];
let cursor    = 0;
let results   = [];
let cfg       = {};
let ranks     = {};   // { pos: 'best' } — only one at a time
let skipCount = 0;
let failQueue = [];

// ════════════════════════════════════
//  PRELOAD NEXT
// ════════════════════════════════════
function preloadNext() {
  if (cursor + 1 >= session.length) return;
  const next = session[cursor + 1];
  const cat  = next.category;
  VARIANTS.forEach(v => {
    const img = new Image();
    img.src = GITHUB_BASE + `${cat}/${v}/${next.filename}`;
  });
  const b = new Image();
  b.src = GITHUB_BASE + `${BASELINE_DIR}/${next.filename}`;
}

// ════════════════════════════════════
//  BOOT — fetch images.json
// ════════════════════════════════════
(async function boot() {
  try {
    setLoadMsg("Fetching dataset…");
    const res = await fetch("images.json");
    if (!res.ok) throw new Error(`images.json returned ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0)
      throw new Error("images.json is empty or not an array");

    // Expand: if item has no category, create one entry per prompt type
    dataset = [];
    raw.forEach(item => {
      if (item.category) {
        const ci = PROMPT_TYPES.indexOf(item.category);
        dataset.push({ ...item, promptLabel: ci >= 0 ? PROMPT_LABELS[ci] : item.category });
      } else {
        PROMPT_TYPES.forEach((cat, ci) => {
          dataset.push({ ...item, category: cat, promptLabel: PROMPT_LABELS[ci] });
        });
      }
    });

    document.getElementById('stat-n').textContent    = dataset.length;
    document.getElementById('stat-sess').textContent = Math.min(dataset.length, 50);
    document.getElementById('stat-time').textContent = Math.round(Math.min(dataset.length, 50) * 0.05);

    document.getElementById('inp-count').addEventListener('input', e => {
      const v = Math.min(dataset.length, parseInt(e.target.value) || 50);
      document.getElementById('stat-sess').textContent = v;
      document.getElementById('stat-time').textContent = Math.round(v * 0.05);
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

  const count = Math.min(dataset.length, parseInt(document.getElementById('inp-count').value) || 50);
  cfg = { rater, count, sessionId: `${rater}_${Date.now()}`, startTs: Date.now() };

  // Shuffle → take count → assign permutations (balanced [0,1]/[1,0] cycle)
  const pool = [...dataset].sort(() => Math.random() - 0.5).slice(0, count);
  session = pool.map((item, i) => ({ ...item, perm: PERMS[i % 2] }));

  cursor = 0; results = []; skipCount = 0; failQueue = [];
  document.getElementById('hdr-rater').textContent = rater;
  showScreen('s-eval');
  renderItem();
}

// ════════════════════════════════════
//  RENDER ONE ITEM
// ════════════════════════════════════
function renderItem() {
  const item        = session[cursor];
  const perm        = item.perm;
  const cat         = item.category;
  const promptLabel = item.promptLabel || cat;

  // perm[pos] → index into VARIANTS (0=guided, 1=patched)
  const permuted    = perm.map(i => `${cat}/${VARIANTS[i]}/${item.filename}`);
  const letters     = ['A', 'B'];

  // ── Header progress ──
  const pct = Math.round((cursor / session.length) * 100);
  document.getElementById('prog-bar').style.width   = pct + '%';
  document.getElementById('prog-label').textContent = `${cursor} / ${session.length}`;
  document.getElementById('prog-pct').textContent   = pct + '%';
  document.getElementById('meta-n').textContent     = cursor + 1;
  document.getElementById('meta-id').textContent    = item.id ?? '—';

  // ── Prompt label badge ──
  document.getElementById('prompt-label-badge').textContent = promptLabel;
  document.getElementById('prompt-label-badge').style.display = 'inline-block';

  // ── Context prompt ──
  if (item.prompt) {
    document.getElementById('ctx-text').textContent = item.prompt;
    document.getElementById('ctx-bar').style.display = 'flex';
  } else {
    document.getElementById('ctx-bar').style.display = 'none';
  }

  // ── Question ──
  document.getElementById('eval-q').innerHTML =
    `Which image is superior with respect to <em>higher/superior</em> for <em>${promptLabel}</em>?`;

  // ── Baseline reference ──
  const baselineImg = document.getElementById('baseline-img');
  baselineImg.className = 'loading';
  baselineImg.src = GITHUB_BASE + `${BASELINE_DIR}/${item.filename}`;
  baselineImg.onload  = () => baselineImg.classList.replace('loading', 'loaded');
  baselineImg.onerror = () => {
    baselineImg.parentElement.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim);font-family:var(--mono);font-size:12px;">baseline not found</div>';
  };

  // ── Cards — only 2 ──
  ranks = {};
  const grid = document.getElementById('img-grid');
  grid.innerHTML = '';
 

  permuted.forEach((filepath, pos) => {
    const url         = GITHUB_BASE + filepath;
    const variantName = VARIANTS[perm[pos]];  // 'guided' or 'patched'
    const card        = document.createElement('div');
    card.className    = 'img-card';
    card.dataset.pos  = pos;

    card.innerHTML = `
      <div class="img-thumb">
        <img class="loading" src="${url}" alt="Image ${letters[pos]}"
          onload="this.classList.replace('loading','loaded')"
          onerror="this.closest('.img-thumb').innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:var(--dim);font-family:var(--mono);font-size:12px;flex-direction:column;gap:6px;\\'><span style=\\'font-size:24px;opacity:.4\\'>?</span>${filepath}</div>'">
        <div class="img-slot-label">${letters[pos]}</div>
        <div class="img-rank-badge badge-best" id="badge-${pos}-best">preferred</div>
      </div>
      <div class="img-footer">
        <span class="img-letter">Image ${letters[pos]}</span>
        <div class="rank-btns">
          <button class="rbtn" data-pos="${pos}" data-r="best" onclick="assign(${pos})">Prefer ✓</button>
        </div>
      </div>`;

    card.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      assign(pos);
    });

    grid.appendChild(card);
  });

  updateNextBtn();
  document.getElementById('save-ind').style.display = 'none';
  preloadNext();
}

// ════════════════════════════════════
//  RANKING LOGIC  (binary preference)
// ════════════════════════════════════
function assign(pos) {
  ranks = { [pos]: 'best' };
  refreshCards();
  updateNextBtn();
}

function assignNeither() {
  ranks = { 'neither': 'best' };
  refreshCards();
  updateNextBtn();
}

function refreshCards() {
  // Update image cards
  document.querySelectorAll('.img-card').forEach(card => {
    const pos  = parseInt(card.dataset.pos);
    const rank = ranks[pos];

    card.classList.remove('rank-best', 'rank-mid', 'rank-worst');
    if (rank) card.classList.add('rank-best');

    const badge = document.getElementById(`badge-${pos}-best`);
    if (badge) badge.classList.toggle('show', !!rank);

    card.querySelectorAll('.rbtn').forEach(btn => {
      btn.className = 'rbtn';
      if (rank) btn.classList.add('on-best');
    });
  });

  // Update "Neither" button state
  const btnNeither = document.getElementById('btn-neither');
  if (btnNeither) {
    if (ranks['neither']) {
      btnNeither.classList.add('selected');
    } else {
      btnNeither.classList.remove('selected');
    }
  }
} 

function isComplete() {
  return Object.keys(ranks).length === 1;
}

function updateNextBtn() {
  document.getElementById('btn-next').classList.toggle('ready', isComplete());
}

// ════════════════════════════════════
//  SUBMIT & ADVANCE
// ════════════════════════════════════
async function confirmAndNext() {
  if (!isComplete()) return;

  const item        = session[cursor];
  const perm        = item.perm;
  const cat         = item.category;
  const promptLabel = item.promptLabel || cat;

  const selectedKey = Object.keys(ranks)[0];
  let prefDisplay = 'neither';
  let prefVariant = 'neither';
  let rejVariant  = 'both'; // If neither is preferred, both are rejected

  if (selectedKey !== 'neither') {
    const preferredPos = parseInt(selectedKey);
    prefDisplay = ['A','B'][preferredPos];
    prefVariant = VARIANTS[perm[preferredPos]];   // 'guided' or 'patched'
    rejVariant  = VARIANTS[perm[preferredPos === 0 ? 1 : 0]];
  }

  const row = {
    session_id:        cfg.sessionId,
    annotator_id:      cfg.rater,
    timestamp:         new Date().toISOString(),
    image_id:          item.id ?? cursor,
    filename:          item.filename,
    prompt:            item.prompt ?? "",
    category:          cat,
    prompt_label:      promptLabel,
    baseline_file:     `${BASELINE_DIR}/${item.filename}`,
    guided_file:       `${cat}/guided/${item.filename}`,
    patched_file:      `${cat}/patched/${item.filename}`,
    perm_order:        JSON.stringify(perm),
    display_A:         VARIANTS[perm[0]],
    display_B:         VARIANTS[perm[1]],
    preferred_display: prefDisplay,
    preferred_variant: prefVariant,
    rejected_variant:  rejVariant,
  };

  results.push(row);
  saveRowToSheet(row);

  cursor++;
  renderItem();
}

function saveRowToSheet(row) {
  const ind = document.getElementById('save-ind');
  ind.style.display = 'flex';
  ind.className = 'saving-indicator';
  document.getElementById('save-txt').textContent = 'saving…';

  fetch(SHEET_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(row)
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
  renderItem();
  toast(`Skipped — ${session.length - cursor} remaining`);
}



// ════════════════════════════════════
//  EXPORT
// ════════════════════════════════════
function exportJSON() {
  const out = { session_id: cfg.sessionId, annotator: cfg.rater, results, exported_at: new Date().toISOString() };
  dl(JSON.stringify(out, null, 2), `eval_${cfg.rater}_${Date.now()}.json`, 'application/json');
}

function exportCSV() {
  if (!results.length) { toast("No results to export"); return; }
  const keys = Object.keys(results[0]);
  const rows = [keys, ...results.map(r => keys.map(k => `"${String(r[k]).replace(/"/g,'""')}"`))];
  dl(rows.map(r => r.join(',')).join('\n'), `eval_${cfg.rater}_${Date.now()}.csv`, 'text/csv');
}

function dl(content, name, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = name; a.click();
}

// ════════════════════════════════════
//  KEYBOARD SHORTCUTS
//  1 → prefer image A (pos 0)
//  2 → prefer image B (pos 1)
//  Enter / → → submit
// ════════════════════════════════════
document.addEventListener('keydown', e => {
  if (!document.getElementById('s-eval').classList.contains('active')) return;
  if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;

  if      (e.key === '1') assign(0);
  else if (e.key === '2') assign(1);
  else if (e.key === '3') assignNeither(); // NEW: Keyboard shortcut for Neither
  else if ((e.key === 'Enter' || e.key === 'ArrowRight') && isComplete()) confirmAndNext();
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