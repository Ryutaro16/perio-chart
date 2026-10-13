'use strict';

/* ================= 基本 ================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const pad2 = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtDate = (s) => (s ? s.replace(/-/g, '/') : '');
const fmtPct = (v) => (v == null ? '—' : Math.round(v) + '%');
function ageAt(birth, date) {
  if (!birth) return null;
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = (date || today()).split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

/* ================= 歯の定義 ================= */
// 画面の左→右（患者の右→左）
const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const ALL = [...UPPER, ...LOWER];
const SITES = ['bd', 'bc', 'bm', 'ld', 'lc', 'lm'];
const PL = ['m', 'd', 'b', 'l'];
const quad = (t) => Math.floor(t / 10);
const isUpper = (t) => quad(t) <= 2;
const isPtRight = (t) => quad(t) === 1 || quad(t) === 4;
const isMid = (t) => t === 21 || t === 31;
const isMolar = (t) => t % 10 >= 6;
const toothName = (t) => ({ 1: '右上', 2: '左上', 3: '左下', 4: '右下' })[quad(t)] + (t % 10);
const sideName = (t, side) => (side === 'b' ? '頬側' : isUpper(t) ? '口蓋側' : '舌側');
const POS = { d: '遠心', c: '中央', m: '近心' };
const siteName = (t, k) => `${toothName(t)}　${sideName(t, k[0])} ${POS[k[1]]}`;
// 画面の左→右の順に並べた部位キー
const screenKeys = (t, side) => (isPtRight(t) ? [side + 'd', side + 'c', side + 'm'] : [side + 'm', side + 'c', side + 'd']);

// 根分岐部：上顎大臼歯＝頬側・近心口蓋・遠心口蓋、下顎大臼歯＝頬側・舌側
const FURC_NAME = { b: '頬側', mp: '近心口蓋', dp: '遠心口蓋', l: '舌側' };
const ROMAN = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };
const furcKeys = (t) => (isUpper(t) ? ['b', 'mp', 'dp'] : ['b', 'l']);
function furcAt(t, side, pos) {
  if (!isMolar(t)) return null;
  if (side === 'b') return pos === 'c' ? 'b' : null;
  if (isUpper(t)) return pos === 'm' ? 'mp' : pos === 'd' ? 'dp' : null;
  return pos === 'c' ? 'l' : null;
}

/* ================= 測定順 ================= */
const ORDERS = {
  z: {
    label: '上顎を頬側→口蓋側、次に下顎を頬側→舌側',
    desc: '上顎頬側 右上→左上 → 上顎口蓋側 左上→右上 → 下顎頬側 左下→右下 → 下顎舌側 右下→左下',
    segs: [['b', UPPER, 1], ['l', UPPER, -1], ['b', LOWER, -1], ['l', LOWER, 1]],
  },
  loop: {
    label: '頬側を一周 → 舌側を一周',
    desc: '上顎頬側 右上→左上 → 下顎頬側 左下→右下 → 下顎舌側 右下→左下 → 上顎口蓋側 左上→右上（一筆書き）',
    segs: [['b', UPPER, 1], ['b', LOWER, -1], ['l', LOWER, 1], ['l', UPPER, -1]],
  },
};
function buildSeq(order) {
  const seq = [];
  for (const [side, row, dir] of (ORDERS[order] || ORDERS.z).segs) {
    for (const t of dir > 0 ? row : [...row].reverse()) {
      const keys = screenKeys(t, side);
      for (const k of dir > 0 ? keys : [...keys].reverse()) seq.push({ t, k });
    }
  }
  return seq;
}
const MOB_SEQ = [...UPPER, ...[...LOWER].reverse()];
const FURC_SEQ = MOB_SEQ.filter(isMolar).flatMap((t) => furcKeys(t).map((f) => ({ t, f })));

/* ================= データベース（IndexedDB） ================= */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('perio-chart-v2', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('patients', { keyPath: 'id' });
        d.createObjectStore('exams', { keyPath: 'id' }).createIndex('patientId', 'patientId');
        d.createObjectStore('settings', { keyPath: 'key' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); },
  req(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  all(name) { return this.req(this.store(name).getAll()); },
  get(name, key) { return this.req(this.store(name).get(key)); },
  put(name, val) { return this.req(this.store(name, 'readwrite').put(val)); },
  byPatient(pid) { return this.req(this.store('exams').index('patientId').getAll(pid)); },
};

// 音声の案内の初期設定（設定画面で項目ごとにオン・オフ）
const GUIDE_DEFAULTS = {
  enabled: true, fail: true, area: true, start: true, // 全体／聞き取れなかったとき／エリアが変わったとき／始めたとき
  boundary: true, tooth: true, missing: true, done: true, // ポケットの道案内：区切り／歯の番号／欠損歯／全部位の完了
  echo: false, okBeep: false, // 確認：復唱／正しく入ったときの小さな音
  where: true, modeVoice: true, foot: false, // 操作：「今どこ？」／声でモード切り替え／フットスイッチ
  rate: 'mid', // 声の速さ
};
let settings = { key: 'settings', clinicName: '', order: 'z', lastBackupAt: null, lastExaminer: '', guide: { ...GUIDE_DEFAULTS } };
async function loadSettings() {
  const s = await DB.get('settings', 'settings');
  if (s) settings = { ...settings, ...s };
  settings.guide = { ...GUIDE_DEFAULTS, ...((s && s.guide) || {}) };
  if ((settings.guideVer || 1) < 2) { settings.guide.echo = false; settings.guideVer = 2; if (s) await saveSettings(); } // 2026-10-12 復唱は初期オフに（龍太郎の判断）
}
const saveSettings = () => DB.put('settings', settings);

/* ================= 検査データ ================= */
const blankTooth = () => ({ missing: false, mob: null, ppd: {}, bop: {}, pus: {}, pl: {}, fur: {} });
function newExam(patientId, date, examiner, prev, carryOver = false) {
  const teeth = {};
  const carry = { ppd: {}, bop: {}, pus: {}, mob: {}, fur: {}, pl: {} };
  for (const t of ALL) {
    teeth[t] = blankTooth();
    const pt = prev && prev.teeth[t];
    if (!pt) continue;
    if (pt.missing) { teeth[t].missing = true; continue; }
    if (!carryOver) continue;
    // 前回の値を写し、「引き継ぎ（未確定）」の印を付ける
    const th = teeth[t];
    for (const k of SITES) {
      if (pt.ppd[k] != null) { th.ppd[k] = pt.ppd[k]; carry.ppd[ck(t, k)] = true; }
      if (pt.bop[k]) { th.bop[k] = true; carry.bop[ck(t, k)] = true; }
      if (pt.pus[k]) { th.pus[k] = true; carry.pus[ck(t, k)] = true; }
    }
    if (pt.mob != null) { th.mob = pt.mob; carry.mob[ck(t)] = true; }
    for (const [f, v] of Object.entries(pt.fur || {})) if (v != null) { th.fur[f] = v; carry.fur[ck(t, f)] = true; }
    for (const f of PL) if (pt.pl[f]) { th.pl[f] = true; carry.pl[ck(t, f)] = true; }
  }
  return {
    id: uid(), patientId, date, examiner, note: '', teeth, pcrNone: false, carry, carriedFrom: carryOver && prev ? prev.date : null,
    createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null,
  };
}

// 前回から引き継いで、まだ確定していない値の印（exam.carry[種類]['歯:部位'] = true）
const CARRY_TYPES = ['ppd', 'bop', 'pus', 'mob', 'fur', 'pl'];
const ck = (t, k = '') => `${t}:${k}`;
const isCarried = (ex, type, t, k = '') => !!(ex.carry && ex.carry[type] && ex.carry[type][ck(t, k)]);
function unCarry(ex, type, t, k = '') { if (ex.carry && ex.carry[type]) delete ex.carry[type][ck(t, k)]; }
function carriedCount(ex, types = CARRY_TYPES) {
  if (!ex.carry) return 0;
  let n = 0;
  for (const ty of types) for (const key of Object.keys(ex.carry[ty] || {})) if (!ex.teeth[Number(key.split(':')[0])].missing) n++;
  return n;
}

// 旧データ（pcrDone）にも対応
const plaqueNone = (ex) => (ex.pcrNone !== undefined ? ex.pcrNone : !!ex.pcrDone);
const hasPlaque = (ex) => ALL.some((t) => Object.values(ex.teeth[t].pl).some(Boolean));

function calcStats(ex) {
  let present = 0, sites = 0, sum = 0, ge4 = 0, ge6 = 0, bop = 0, pl = 0, furT = 0, bopAny = 0;
  for (const t of ALL) {
    const th = ex.teeth[t];
    if (th.missing) continue;
    present++;
    for (const k of SITES) {
      const v = th.ppd[k];
      if (v == null) continue;
      sites++; sum += v;
      if (v >= 4) ge4++;
      if (v >= 6) ge6++;
    }
    for (const k of SITES) if (th.bop[k]) bopAny++;
    for (const s of PL) if (th.pl[s]) pl++;
    if (Object.values(th.fur || {}).some((v) => v > 0)) furT++;
  }
  return {
    present, sites,
    mean: sites ? sum / sites : null,
    ge4pct: sites ? (ge4 / sites) * 100 : null,
    ge6: sites ? ge6 : null,
    // BOP％ ＝ 出血部位 ÷（現在歯数×6）。ポケットも出血も未入力なら未検査（—）
    // 紙から取り込んだ検査は出血を取り込んでいないので、記録なし（—）
    boppct: ex.source !== 'paper' && present && (sites || bopAny) ? (bopAny / (present * 6)) * 100 : null,
    // プラークが1面でもあれば計算。0面のときは「付着なし」を押した場合だけ0%、それ以外は未検査（—）
    pcr: present && (pl > 0 || plaqueNone(ex)) ? (pl / (present * 4)) * 100 : null,
    furT,
  };
}
function statsHTML(s) {
  return `<span>現在歯数 <b>${s.present}</b></span>
    <span>測定部位 <b>${s.sites}</b> / ${s.present * 6}</span>
    <span>平均PPD <b>${s.mean == null ? '—' : s.mean.toFixed(1)}</b>${s.mean == null ? '' : 'mm'}</span>
    <span>4mm以上 <b>${fmtPct(s.ge4pct)}</b></span>
    <span>6mm以上 <b>${s.ge6 == null ? '—' : s.ge6}</b>部位</span>
    <span>BOP <b>${fmtPct(s.boppct)}</b></span>
    <span>PCR <b>${fmtPct(s.pcr)}</b></span>
    <span>分岐部病変 <b>${s.furT}</b>歯</span>`;
}

/* ================= チャート描画 ================= */
function pcrSVG(t, th, ex) {
  const up = isUpper(t), r = isPtRight(t);
  const map = { top: up ? 'b' : 'l', bottom: up ? 'l' : 'b', left: r ? 'd' : 'm', right: r ? 'm' : 'd' };
  const pts = { top: '0,0 30,0 15,15', bottom: '0,30 30,30 15,15', left: '0,0 0,30 15,15', right: '30,0 30,30 15,15' };
  return `<svg class="pcrsvg" viewBox="0 0 30 30">${Object.keys(pts).map((p) => {
    const s = map[p];
    return `<polygon points="${pts[p]}" data-t="${t}" data-surf="${s}" class="${th.pl[s] ? 'on' : ''}${ex && isCarried(ex, 'pl', t, s) ? ' c' : ''}"/>`;
  }).join('')}</svg>`;
}

const DIFF_MIN = 2; // 前回との差を表示する変化の大きさ（mm）
function diffCounts(ex, prev) {
  let better = 0, worse = 0;
  if (!prev) return { better, worse };
  for (const t of ALL) {
    const th = ex.teeth[t], pt = prev.teeth[t];
    if (th.missing || !pt || pt.missing) continue;
    for (const k of SITES) {
      if (th.ppd[k] == null || pt.ppd[k] == null) continue;
      const d = th.ppd[k] - pt.ppd[k];
      if (d >= DIFF_MIN) worse++; else if (d <= -DIFF_MIN) better++;
    }
  }
  return { better, worse };
}
// その検査より前の、いちばん新しい検査
async function findPrevExam(ex) {
  const list = (await DB.byPatient(ex.patientId))
    .filter((e) => !e.deletedAt && e.id !== ex.id && (e.date < ex.date || (e.date === ex.date && e.createdAt < ex.createdAt)))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return list[0] || null;
}

function chartHTML(exam, o = {}) {
  const T = exam.teeth;
  // 引き継いだ値の薄い表示は画面だけ。印刷（o.print）では通常の濃さにする
  const carried = (type, t, k) => !o.print && isCarried(exam, type, t, k);
  const subCells = (row, side, cls, cell) => row.map((t) => screenKeys(t, side).map((k, i) => {
    const c = [cls];
    if (i === 0) c.push('tl');
    if (i === 0 && isMid(t)) c.push('mid');
    if (T[t].missing) { c.push('miss'); return `<td class="${c.join(' ')}"></td>`; }
    return cell(t, T[t], k, c);
  }).join('')).join('');

  const ppdRow = (row, side, label) => `<tr><th class="lab">${label}</th>${subCells(row, side, 's', (t, th, k, c) => {
    const v = th.ppd[k];
    if (v >= 6) c.push('p6'); else if (v >= 4) c.push('p4');
    if (o.cursor && o.cursor.t === t && o.cursor.k === k) c.push('cur');
    if (o.ctx && quad(t) === o.ctx.q && k[0] === o.ctx.side) c.push('ctxrow');
    if (carried('ppd', t, k)) c.push('c');
    const dot = (type) => (th[type][k] ? `<i class="${type}${carried(type, t, k) ? ' c' : ''}"></i>` : '');
    // 前回との差（DIFF_MIN mm以上変わった部位だけ）。深くなった＝悪化、浅くなった＝改善
    let dif = '';
    const pt = o.prev && o.prev.teeth[t];
    if (pt && !pt.missing && pt.ppd[k] != null && v != null && Math.abs(v - pt.ppd[k]) >= DIFF_MIN) {
      const d = v - pt.ppd[k];
      dif = `<i class="dif ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</i>`;
    }
    return `<td class="${c.join(' ')}" data-t="${t}" data-k="${k}">${v ?? ''}${dot('bop')}${dot('pus')}${dif}</td>`;
  })}</tr>`;

  const furRow = (row, side) => `<tr><th class="lab">分岐部</th>${subCells(row, side, 'f', (t, th, k, c) => {
    const f = furcAt(t, side, k[1]);
    if (!f) { c.push('fx'); return `<td class="${c.join(' ')}"></td>`; }
    const v = (th.fur || {})[f];
    if (v) c.push('on');
    if (o.furCursor && o.furCursor.t === t && o.furCursor.f === f) c.push('cur');
    if (carried('fur', t, f)) c.push('c');
    return `<td class="${c.join(' ')}" data-t="${t}" data-f="${f}">${v ? ROMAN[v] : ''}</td>`;
  })}</tr>`;

  const toothRow = (row, cls, label, cell) => `<tr><th class="lab">${label}</th>${row.map((t) => {
    const th = T[t];
    const c = [cls];
    if (isMid(t)) c.push('mid');
    if (th.missing) c.push('miss');
    const [inner, attrs] = cell(t, th, c);
    return `<td colspan="3" class="${c.join(' ')}" ${attrs}>${inner}</td>`;
  }).join('')}</tr>`;
  const numRow = (row, label) => toothRow(row, 'num', label, (t) => [String(t % 10), `data-tooth="${t}"`]);
  const mobRow = (row) => toothRow(row, 'mob', '動揺度', (t, th, c) => {
    if (th.missing) return ['', ''];
    if (o.mobCursor === t) c.push('cur');
    if (carried('mob', t)) c.push('c');
    return [th.mob ?? '', `data-mob="${t}"`];
  });
  const pcrRow = (row) => toothRow(row, 'pcr', 'プラーク', (t, th) => (th.missing ? ['', ''] : [pcrSVG(t, th, o.print ? null : exam), '']));

  return `<table class="chart${o.mini ? ' compact' : ''}"><colgroup><col class="labc">${'<col>'.repeat(48)}</colgroup>
    ${pcrRow(UPPER)}${mobRow(UPPER)}${furRow(UPPER, 'b')}${ppdRow(UPPER, 'b', '頬側')}${numRow(UPPER, '上顎')}${ppdRow(UPPER, 'l', '口蓋側')}${furRow(UPPER, 'l')}
    <tr class="gap"><td colspan="49"></td></tr>
    ${furRow(LOWER, 'l')}${ppdRow(LOWER, 'l', '舌側')}${numRow(LOWER, '下顎')}${ppdRow(LOWER, 'b', '頬側')}${furRow(LOWER, 'b')}${mobRow(LOWER)}${pcrRow(LOWER)}
  </table>`;
}

/* ================= 画面共通 ================= */
const app = () => $('#app');
let view = { name: 'list' };
function openDialog(html, wide = false) {
  const d = $('#dlg');
  d.onclose = null;
  d.classList.toggle('wide', wide);
  d.innerHTML = html;
  d.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeDialog));
  if (!d.open) d.showModal();
}
function closeDialog() { const d = $('#dlg'); if (d.open) d.close(); }
// ブラウザ標準の confirm/alert は環境によって表示されないため、アプリ内の画面で聞く
function askConfirm(msg, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    openDialog(`<div class="dlg-body"><p class="dlg-msg">${esc(msg).replace(/\n/g, '<br>')}</p>
      <div class="dlg-actions"><button class="btn" data-ans="0">キャンセル</button>
      <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-ans="1">${esc(okLabel)}</button></div></div>`);
    const d = $('#dlg');
    d.onclose = () => resolve(false);
    d.querySelectorAll('[data-ans]').forEach((b) => (b.onclick = () => { d.onclose = null; closeDialog(); resolve(b.dataset.ans === '1'); }));
  });
}
function notify(msg) {
  return new Promise((resolve) => {
    openDialog(`<div class="dlg-body"><p class="dlg-msg">${esc(msg).replace(/\n/g, '<br>')}</p>
      <div class="dlg-actions"><button class="btn primary" data-ok>OK</button></div></div>`);
    const d = $('#dlg');
    d.onclose = () => resolve();
    $('[data-ok]', d).onclick = closeDialog;
  });
}

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) { if (g.dataset.go === 'list') showList(); else if (g.dataset.go === 'settings') showSettings(); return; }
  if (e.target.closest('[data-act="backup"]')) exportBackup();
});

function backupBanner(n) {
  if (!n) return '';
  const last = settings.lastBackupAt;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (days !== null && days < 7) return '';
  return `<div class="banner">${days === null ? 'まだバックアップがありません。' : `最後のバックアップから${days}日経っています。`}
    iPadの故障・紛失に備えて、院内PCへ保存してください。<button class="btn" data-act="backup">今すぐバックアップ</button></div>`;
}

/* ================= 患者一覧 ================= */
async function showList() {
  view = { name: 'list' };
  const [patients, exams] = await Promise.all([DB.all('patients'), DB.all('exams')]);
  const info = {};
  for (const e of exams) {
    if (e.deletedAt) continue;
    const i = (info[e.patientId] ||= { n: 0, last: '', list: [] });
    i.n++;
    i.list.push(e);
    if (e.date > i.last) i.last = e.date;
  }
  // 最新の検査の要点（BOP・4mm以上）と、前回からの変化
  const KEY = [['boppct', 'BOP'], ['ge4pct', '4mm以上']];
  for (const i of Object.values(info)) {
    i.list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    const [s0, s1] = i.list.slice(0, 2).map(calcStats);
    i.keys = KEY.map(([k, l]) => {
      const v = s0[k], pv = s1 ? s1[k] : null;
      const d = v == null || pv == null ? 0 : Math.round(v) - Math.round(pv);
      return `<span class="kchip">${l} <b>${fmtPct(v)}</b>${d ? `<i class="${d > 0 ? 'bad' : 'good'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</i>` : ''}</span>`;
    }).join('');
  }
  const byKana = (a, b) => (a.kana || a.name).localeCompare(b.kana || b.name, 'ja');
  const sortPatients = () => patients.sort(settings.patientSort === 'recent'
    ? (a, b) => ((info[b.id] || {}).last || '').localeCompare((info[a.id] || {}).last || '') || byKana(a, b)
    : byKana);
  sortPatients();
  app().innerHTML = `
    <header class="bar brandbar"><span class="logo" aria-hidden="true"></span><h1>ペリオチャート <span class="ver">v2</span></h1><div class="grow"></div><button class="btn ghost" data-go="settings">設定・バックアップ</button></header>
    <main class="wrap">
      ${backupBanner(patients.length)}
      <div class="row-tools">
        <label class="searchbox"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg><input id="q" class="search" type="search" placeholder="氏名・ふりがな・カルテ番号で検索" autocomplete="off"></label>
        <button class="btn big" id="paperp">📷 紙から取り込み</button>
        <button class="btn primary big" id="addp">＋ 新規患者</button>
      </div>
      ${patients.length > 1 ? `<div class="sortbar"><span class="sub">並べ方</span><div class="segtabs"><button class="seg${settings.patientSort === 'recent' ? '' : ' on'}" data-sort="kana">50音順</button><button class="seg${settings.patientSort === 'recent' ? ' on' : ''}" data-sort="recent">最近の検査順</button></div><span class="sub grow" id="pcount"></span></div>` : ''}
      <div class="card list" id="plist"></div>
    </main>`;
  const draw = () => {
    const q = $('#q').value.trim().toLowerCase();
    const rows = patients.filter((p) => !q || [p.name, p.kana, p.chartNo].some((v) => (v || '').toLowerCase().includes(q)));
    if ($('#pcount')) $('#pcount').textContent = q ? `${rows.length}人 / 全${patients.length}人` : `全${patients.length}人`;
    $('#plist').innerHTML = rows.length
      ? rows.map((p) => {
        const i = info[p.id] || { n: 0, last: '' };
        return `<button class="prow" data-pid="${p.id}"><span class="avatar" aria-hidden="true">${esc((p.name || '？').trim().charAt(0))}</span>
          <span class="pname">${esc(p.name)}<small>${p.chartNo ? `No.${esc(p.chartNo)}　` : ''}${esc(p.kana || '')}</small></span>
          ${i.n ? `<span class="pkeys">${i.keys}</span>` : ''}
          <span class="pmeta">${i.n ? `${fmtDate(i.last)}<small>検査 全${i.n}回</small>` : '<small>検査なし</small>'}</span><span class="chev">›</span></button>`;
      }).join('')
      : patients.length ? '<p class="empty">該当する患者がいません</p>'
        : `<div class="empty first"><b>まだ患者が登録されていません</b><p>「＋ 新規患者」から登録してください。試しに使うときは、架空の患者で始められます。</p>
          <div class="row-tools center"><button class="btn" id="demo1">見本の患者を追加して試す</button><button class="btn" data-go="settings">バックアップから読み込む</button></div></div>`;
    if ($('#demo1')) $('#demo1').onclick = async () => {
      const { patient, exams } = makeDemo();
      await DB.put('patients', patient);
      for (const ex of exams) await DB.put('exams', ex);
      showPatient(patient.id);
    };
  };
  draw();
  $('#q').addEventListener('input', draw);
  document.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => {
    settings.patientSort = b.dataset.sort; saveSettings(); sortPatients(); draw();
    document.querySelectorAll('[data-sort]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#addp').onclick = () => patientDialog(null, (p) => showPatient(p.id));
  $('#paperp').onclick = () => showPaperList();
  $('#plist').onclick = (e) => { const b = e.target.closest('[data-pid]'); if (b) showPatient(b.dataset.pid); };
}

function patientDialog(p, onSaved) {
  const isNew = !p;
  p = p ? { ...p } : { id: uid(), chartNo: '', name: '', kana: '', birth: '', note: '', createdAt: Date.now() };
  openDialog(`<form class="dlg-body" id="pf"><h2>${isNew ? '新規患者' : '患者情報の編集'}</h2>
    <label class="field"><span>カルテ番号</span><input name="chartNo" value="${esc(p.chartNo)}" inputmode="numeric" autocomplete="off"></label>
    <label class="field"><span>氏名 <em>必須</em></span><input name="name" value="${esc(p.name)}" required autocomplete="off"></label>
    <label class="field"><span>ふりがな</span><input name="kana" value="${esc(p.kana)}" autocomplete="off"></label>
    <label class="field"><span>生年月日</span><input name="birth" type="date" value="${esc(p.birth)}"></label>
    <label class="field"><span>メモ</span><input name="note" value="${esc(p.note)}" autocomplete="off"></label>
    <div class="dlg-actions"><button type="button" class="btn" data-close>キャンセル</button><button class="btn primary" type="submit">保存</button></div></form>`);
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    for (const k of ['chartNo', 'name', 'kana', 'birth', 'note']) p[k] = (f.get(k) || '').trim();
    if (!p.name) return;
    p.updatedAt = Date.now();
    await DB.put('patients', p);
    closeDialog();
    onSaved(p);
  };
}

/* ================= 患者ごとの検査一覧（時系列） ================= */
let patientTab = 'chart'; // 経過の表示：'chart'（過去のチャートを新しい順に）／'graph'（推移のグラフ）
// 経過のチャート1回分：検査日・チャート（前回との差の印つき）・数値のまとめ
function historyCardHTML(e, prev) {
  const s = calcStats(e);
  // ポケットの深さの内訳（測った部位に対する割合）
  const ge6pct = s.sites ? (s.ge6 / s.sites) * 100 : null;
  const le3 = s.sites ? 100 - s.ge4pct : null;
  const mid = s.sites ? s.ge4pct - ge6pct : null;
  const dc = diffCounts(e, prev);
  return `<section class="hcard">
    <div class="hhead"><b>${fmtDate(e.date)}</b>${e.examiner ? `<span class="sub">検査者：${esc(e.examiner)}</span>` : ''}
      ${prev ? `<span class="sub">前回 ${fmtDate(prev.date)} との差：<i class="dif dn">−</i>改善 ${dc.better}部位　<i class="dif up">+</i>悪化 ${dc.worse}部位</span>` : '<span class="sub">初回の検査</span>'}
      <div class="grow"></div><button class="btn" data-open="${e.id}">開く</button><button class="btn" data-print="${e.id}">印刷</button></div>
    <div class="hchart">${chartHTML(e, { prev, mini: true })}</div>
    <div class="hstats">
      <span>PCR <b>${fmtPct(s.pcr)}</b></span><span>BOP <b>${fmtPct(s.boppct)}</b></span>
      <span>PPD 〜3mm <b>${fmtPct(le3)}</b>・4〜5mm <b>${fmtPct(mid)}</b>・6mm以上 <b>${fmtPct(ge6pct)}</b></span>
      <span>平均PPD <b>${s.mean == null ? '—' : s.mean.toFixed(1)}</b>${s.mean == null ? '' : 'mm'}</span>
      <span>現在歯数 <b>${s.present}</b>本</span><span>分岐部病変 <b>${s.furT}</b>歯</span>
    </div>
  </section>`;
}
// 患者画面の上の要点：最新の検査の4つの数値と、前回からの変化（改善＝青▼、悪化＝橙▲）
function kpiHTML(live) {
  if (!live.length) return '';
  const [s0, s1] = live.slice(0, 2).map(calcStats);
  const tiles = ['boppct', 'ge4pct', 'pcr', 'mean'].map((k) => {
    const m = TRENDS.find((x) => x.key === k);
    const v = s0[k], pv = s1 ? s1[k] : null;
    let d = '';
    if (v != null && pv != null) {
      const diff = m.pct ? Math.round(v) - Math.round(pv) : Math.round((v - pv) * 10) / 10;
      if (diff) { const good = diff < 0; d = `<i class="${good ? 'good' : 'bad'}">${diff < 0 ? '▼' : '▲'}${m.pct ? Math.abs(diff) : Math.abs(diff).toFixed(1)}</i>`; }
      else d = '<i class="same">＝</i>';
    }
    return `<div class="kpi"><span>${m.label}</span><b>${fmtTrend(m, v)}</b>${d}</div>`;
  }).join('');
  return `<div class="kpis"><div class="kpicap">最新 ${fmtDate(live[0].date)}${live[1] ? `<small>前回 ${fmtDate(live[1].date)} と比べて</small>` : ''}</div>${tiles}</div>`;
}
async function showPatient(pid, showDeleted = false) {
  const p = await DB.get('patients', pid);
  if (!p) return showList();
  view = { name: 'patient', pid, showDeleted };
  const exams = (await DB.byPatient(pid)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  const live = exams.filter((e) => !e.deletedAt), dead = exams.filter((e) => e.deletedAt);
  const rows = (showDeleted ? dead : live).map((e) => {
    const s = calcStats(e);
    return `<tr><td class="d">${fmtDate(e.date)}</td><td>${s.present}</td><td>${s.mean == null ? '—' : s.mean.toFixed(1)}</td>
      <td>${fmtPct(s.ge4pct)}</td><td>${s.ge6 == null ? '—' : s.ge6}</td><td>${fmtPct(s.boppct)}</td><td>${fmtPct(s.pcr)}</td><td>${s.furT}</td>
      <td>${esc(e.examiner || '')}</td>
      <td class="acts">${showDeleted
        ? `<button class="btn" data-restore="${e.id}">元に戻す</button>`
        : `<button class="btn primary" data-open="${e.id}">開く</button><button class="btn" data-print="${e.id}">印刷</button><button class="btn danger" data-del="${e.id}">削除</button>`}</td></tr>`;
  }).join('');
  app().innerHTML = `
    <header class="bar"><button class="btn ghost" data-go="list">‹ 患者一覧</button><div class="grow"></div><button class="btn" id="editp">患者情報を編集</button></header>
    <main class="wrap">
      <div class="card pinfo"><div class="pn">${esc(p.name)} <small>様</small></div><div class="pk">${esc(p.kana || '')}</div>
        <dl><div><dt>カルテ番号</dt><dd>${esc(p.chartNo || '—')}</dd></div>
        <div><dt>生年月日</dt><dd>${p.birth ? `${fmtDate(p.birth)}（${ageAt(p.birth)}歳）` : '—'}</dd></div>
        ${p.note ? `<div><dt>メモ</dt><dd>${esc(p.note)}</dd></div>` : ''}</dl>${kpiHTML(live)}</div>
      <div class="row-tools"><h2>${showDeleted ? '削除した検査' : '検査の記録（新しい順）'}</h2><div class="grow"></div>
        ${showDeleted ? '<button class="btn" id="tglDel">‹ 検査の記録に戻る</button>' : '<button class="btn primary big" id="newx">＋ 新しい検査を始める</button>'}</div>
      <div class="card tablewrap">${rows
        ? `<table class="xt"><thead><tr><th>検査日</th><th>現在歯数</th><th>平均PPD</th><th>4mm以上</th><th>6mm以上</th><th>BOP</th><th>PCR</th><th>分岐部</th><th>検査者</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="empty">${showDeleted ? '削除した検査はありません。' : 'まだ検査がありません。「＋ 新しい検査を始める」から入力してください。'}</p>`}</div>
      ${!showDeleted && dead.length ? `<p><button class="btn ghost" id="tglDel">削除した検査（${dead.length}件）を表示</button></p>` : ''}
      ${!showDeleted && live.length ? `<div class="row-tools trendhead"><h2>経過</h2>
          <div class="segtabs"><button class="seg${patientTab === 'chart' ? ' on' : ''}" data-ptab="chart">チャート</button><button class="seg${patientTab === 'graph' ? ' on' : ''}" data-ptab="graph">グラフ</button></div>
          <div class="grow"></div><button class="btn" id="prtTrend">経過を印刷（患者さん用）</button></div>
        ${patientTab === 'chart'
          ? `<div class="hist">${live.map((e, i) => historyCardHTML(e, live[i + 1] || null)).join('')}</div>`
          : `<div class="tgrid-cards">${trendCardsHTML([...live].reverse())}</div>${live.length < 2 ? '<p class="sub">2回目の検査から、推移と前回からの変化が出ます。</p>' : ''}`}` : ''}
    </main>`;
  $('#editp').onclick = () => patientDialog(p, () => showPatient(pid));
  if ($('#prtTrend')) $('#prtTrend').onclick = () => printTrend(p, [...live].reverse());
  document.querySelectorAll('[data-ptab]').forEach((b) => (b.onclick = () => { patientTab = b.dataset.ptab; showPatient(pid); }));
  if ($('#newx')) $('#newx').onclick = () => newExamDialog(p, live[0]);
  if ($('#tglDel')) $('#tglDel').onclick = () => showPatient(pid, !showDeleted);
  $('main').onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const find = (id) => exams.find((x) => x.id === id);
    if (b.dataset.open) openEditor(b.dataset.open);
    else if (b.dataset.print) await printExam(p, find(b.dataset.print));
    else if (b.dataset.del) {
      const ex = find(b.dataset.del);
      if (!(await askConfirm(`${fmtDate(ex.date)} の検査を削除しますか？\n（「削除した検査」からいつでも元に戻せます）`, '削除する', true))) return;
      ex.deletedAt = Date.now();
      await DB.put('exams', ex);
      showPatient(pid);
    } else if (b.dataset.restore) {
      const ex = find(b.dataset.restore);
      ex.deletedAt = null;
      await DB.put('exams', ex);
      showPatient(pid, true);
    }
  };
}

function newExamDialog(p, prev) {
  openDialog(`<form class="dlg-body" id="nf"><h2>新しい検査</h2>
    <label class="field"><span>検査日</span><input type="date" name="date" value="${today()}" required></label>
    <label class="field"><span>検査者</span><input name="examiner" value="${esc(settings.lastExaminer)}" autocomplete="off"></label>
    ${prev ? `<label class="check"><input type="checkbox" name="carry"><span>前回（${fmtDate(prev.date)}）のデータを引き継ぐ
        <small>ポケット・出血・排膿・動揺度・分岐部・プラーク。引き継いだ値は薄い色で表示され、確定するまで「未確定」になります</small></span></label>
      <p class="hint">欠損歯は前回から自動で引き継ぎます。</p>` : ''}
    <div class="dlg-actions"><button type="button" class="btn" data-close>キャンセル</button><button class="btn primary">入力を始める</button></div></form>`);
  $('#nf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const ex = newExam(p.id, f.get('date') || today(), (f.get('examiner') || '').trim(), prev, f.get('carry') === 'on');
    settings.lastExaminer = ex.examiner;
    await saveSettings();
    await DB.put('exams', ex);
    closeDialog();
    openEditor(ex.id);
  };
}

/* ================= 入力画面 ================= */
const ed = {
  exam: null, patient: null, mode: 'ppd', cur: 0, mob: 0, fur: 0, seq: [], saveTimer: null,
  plRange: 'all', plFaces: new Set(), // プラーク一括入力の選択
  flash: '', undo: null, // 直前の一括操作のお知らせと取り消し用データ
  bulkVal: 3, // 「空欄を全部◯に」の数字（開くたびに3から）
  mobBulk: 0, // 動揺度の一括入力の数字（開くたびに0から）
};
const PL_RANGES = [['all', '全顎'], ['1', '右上'], ['2', '左上'], ['3', '左下'], ['4', '右下']];
const PL_FACES = [['m', '近心'], ['d', '遠心'], ['b', '頬側'], ['l', '舌側・口蓋側']];
const MODES = [['ppd', 'ポケット'], ['bop', '出血'], ['mob', '動揺度'], ['fur', '分岐部'], ['pcr', 'プラーク']];

function nextOpen(list, i, dir, toothOf) {
  for (let j = i + dir; j >= 0 && j < list.length; j += dir) if (!ed.exam.teeth[toothOf(list[j])].missing) return j;
  return i;
}
const stepPPD = (dir) => nextOpen(ed.seq, ed.cur, dir, (s) => s.t);
const stepMob = (dir) => nextOpen(MOB_SEQ, ed.mob, dir, (t) => t);
const stepFur = (dir) => nextOpen(FURC_SEQ, ed.fur, dir, (s) => s.t);
function firstEmpty(list, toothOf, isEmpty) {
  const T = ed.exam.teeth;
  let i = list.findIndex((x) => !T[toothOf(x)].missing && isEmpty(x));
  if (i < 0) i = list.findIndex((x) => !T[toothOf(x)].missing);
  return Math.max(i, 0);
}
const ppdComplete = () => ed.seq.every((s) => ed.exam.teeth[s.t].missing || (ed.exam.teeth[s.t].ppd[s.k] != null && !isCarried(ed.exam, 'ppd', s.t, s.k)));

async function openEditor(examId) {
  const exam = await DB.get('exams', examId);
  const patient = await DB.get('patients', exam.patientId);
  view = { name: 'editor', examId };
  voiceStop(true);
  for (const t of ALL) exam.teeth[t].fur ||= {};
  if (exam.pcrNone === undefined) { exam.pcrNone = !!exam.pcrDone && !hasPlaque(exam); delete exam.pcrDone; }
  Object.assign(ed, { exam, patient, mode: 'ppd', seq: buildSeq(settings.order), flash: '', undo: null, bulkVal: 3, mobBulk: 0, plRange: 'all', plFaces: new Set() });
  ed.cur = firstEmpty(ed.seq, (s) => s.t, (s) => exam.teeth[s.t].ppd[s.k] == null);
  ed.mob = firstEmpty(MOB_SEQ, (t) => t, (t) => exam.teeth[t].mob == null);
  ed.fur = firstEmpty(FURC_SEQ, (s) => s.t, (s) => exam.teeth[s.t].fur[s.f] == null);
  app().innerHTML = `<div class="editor">
    <header class="bar">
      <button class="btn ghost" id="back">‹ ${esc(patient.name)} 様</button>
      <label class="mini">検査日 <input type="date" id="exdate" value="${esc(exam.date)}"></label>
      <label class="mini">検査者 <input id="exby" value="${esc(exam.examiner || '')}" autocomplete="off"></label>
      <div class="grow"></div>
      <span id="savest" class="savest">保存済み</span>
      <button class="btn" id="difbtn" hidden></button>
      <button class="btn mic" id="mic">🎤 ポケット</button>
      <button class="btn mic" id="micbop">🎤 出血</button>
      <button class="btn" id="prt">印刷</button>
      <button class="btn primary" id="done">完了</button>
    </header>
    <div class="ed-main"><div id="stats" class="stats"></div><div id="chart"></div></div>
    <div class="voicebar" id="voicebar" hidden></div>
    <div class="pad" id="pad"></div>
  </div>`;
  ed.prev = await findPrevExam(exam);
  ed.showDiff = !!ed.prev;
  const difbtn = $('#difbtn');
  difbtn.hidden = !ed.prev;
  difbtn.onclick = () => { ed.showDiff = !ed.showDiff; refresh(); };
  const leave = async () => { voiceStop(true); await flushSave(); showPatient(patient.id); };
  $('#mic').onclick = () => voiceToggle('ppd');
  $('#micbop').onclick = () => voiceToggle('bop');
  $('#back').onclick = leave;
  $('#done').onclick = async () => { await flushSave(); if (await finishCheck(exam)) leave(); };
  $('#prt').onclick = async () => { await flushSave(); await printExam(patient, exam); };
  $('#exdate').onchange = (e) => { if (e.target.value) { exam.date = e.target.value; touch(false); } };
  $('#exby').oninput = (e) => { exam.examiner = e.target.value.trim(); touch(false); };
  $('#chart').onclick = onChartTap;
  $('#pad').onclick = onPadTap;
  refresh();
}

// 「完了」のときの入力漏れの確認。漏れがなければそのまま終える。項目を押すと、その入力に戻る
async function finishCheck(ex) {
  const T = ex.teeth, present = ALL.filter((t) => !T[t].missing);
  const gaps = [];
  const ppdLeft = present.reduce((n, t) => n + SITES.filter((k) => T[t].ppd[k] == null).length, 0);
  if (ppdLeft) gaps.push(['ppd', `ポケット：<b>${ppdLeft}部位</b>が未入力`]);
  const mobLeft = present.filter((t) => T[t].mob == null).length;
  if (mobLeft) gaps.push(['mob', `動揺度：<b>${mobLeft}歯</b>が未入力`]);
  if (!hasPlaque(ex) && !plaqueNone(ex)) gaps.push(['pcr', 'プラーク：未入力（付いていなければ「付着なし」）']);
  const carried = carriedCount(ex);
  if (carried) gaps.push(['carry', `前回から引き継いで<b>まだ確定していない値が${carried}か所</b>（薄い色の値）`]);
  if (!ex.examiner) gaps.push(['by', '検査者が未入力']);
  if (!gaps.length) return true;
  return new Promise((resolve) => {
    openDialog(`<div class="dlg-body"><h2>入力漏れの確認</h2>
      <p class="sub">次の項目がまだです。押すとその入力に戻ります。測っていない項目なら、このまま終えてかまいません。</p>
      <div class="gaplist">${gaps.map(([m, t]) => `<button class="gapitem" data-gap="${m}">${t}<span>›</span></button>`).join('')}</div>
      <div class="dlg-actions"><button class="btn" data-ans="0">入力に戻る</button><div class="grow"></div><button class="btn primary" data-ans="1">このまま終える</button></div></div>`);
    const d = $('#dlg');
    d.onclose = () => resolve(false);
    d.querySelectorAll('[data-ans]').forEach((b) => (b.onclick = () => { d.onclose = null; closeDialog(); resolve(b.dataset.ans === '1'); }));
    d.querySelectorAll('[data-gap]').forEach((b) => (b.onclick = () => {
      d.onclose = null; closeDialog(); resolve(false);
      const m = b.dataset.gap;
      if (m === 'by') { $('#exby').focus(); return; }
      if (m === 'carry') { // 引き継いだまま確定していない値：ポケットにあればその部位へ、なければその値のある入力へ
        const i = ed.seq.findIndex((st) => !T[st.t].missing && isCarried(ex, 'ppd', st.t, st.k));
        if (i >= 0) { ed.mode = 'ppd'; ed.cur = i; } else {
          const ty = CARRY_TYPES.find((x) => carriedCount(ex, [x]));
          ed.mode = { bop: 'bop', pus: 'ppd', mob: 'mob', fur: 'fur', pl: 'pcr' }[ty] || 'ppd';
        }
        ed.flash = '薄い色の値が、前回から引き継いでまだ確定していない値です';
        refresh();
        return;
      }
      ed.mode = m;
      if (m === 'ppd') { const i = ed.seq.findIndex((st) => !T[st.t].missing && T[st.t].ppd[st.k] == null); if (i >= 0) ed.cur = i; }
      refresh();
    }));
  });
}

function refresh() {
  const m = ed.mode;
  $('#chart').innerHTML = chartHTML(ed.exam, {
    cursor: m === 'ppd' ? ed.seq[ed.cur] : null,
    ctx: voice.on && voice.mode === 'bop' ? voice.ctx : null,
    mobCursor: m === 'mob' ? MOB_SEQ[ed.mob] : null,
    furCursor: m === 'fur' ? FURC_SEQ[ed.fur] : null,
    prev: ed.showDiff ? ed.prev : null,
  });
  let diffNote = '';
  if (ed.prev) {
    const b = $('#difbtn');
    b.textContent = ed.showDiff ? '✓ 前回比' : '前回比';
    b.classList.toggle('on', ed.showDiff);
    if (ed.showDiff) {
      const dc = diffCounts(ed.exam, ed.prev);
      diffNote = `<span class="difnote">前回（${fmtDate(ed.prev.date)}）比・${DIFF_MIN}mm以上：<i class="dif dn">−</i>改善 <b>${dc.better}</b>部位　<i class="dif up">+</i>悪化 <b>${dc.worse}</b>部位</span>`;
    }
  }
  $('#stats').innerHTML = statsHTML(calcStats(ed.exam)) + diffNote;
  $('#pad').innerHTML = padHTML();
  ed.flash = '';
  if (voice.on) renderVoice(); // 帯の「次」の場所を合わせる
}

function touch(redraw = true) {
  ed.exam.updatedAt = Date.now();
  const s = $('#savest');
  if (s) { s.textContent = '保存中…'; s.classList.add('busy'); }
  clearTimeout(ed.saveTimer);
  ed.saveTimer = setTimeout(flushSave, 400);
  if (redraw) refresh();
}
async function flushSave() {
  clearTimeout(ed.saveTimer);
  ed.saveTimer = null;
  if (!ed.exam) return;
  await DB.put('exams', ed.exam);
  const s = $('#savest');
  if (s) { s.textContent = '保存済み'; s.classList.remove('busy'); }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && ed.saveTimer) flushSave(); });

function padHTML() {
  const tabs = `<div class="tabs">${MODES.map(([m, l]) => `<button class="tab${ed.mode === m ? ' on' : ''}" data-mode="${m}">${l}</button>`).join('')}</div>`;
  const T = ed.exam.teeth;
  const nav = (extra = '') => `<button class="tool" data-act="prev">◀ 戻る</button><button class="tool" data-act="next">進む ▶</button><button class="tool" data-act="clear">消去</button>${extra}`;
  let body = '';
  if (ed.mode === 'ppd') {
    const c = ed.seq[ed.cur], th = T[c.t];
    body = `<div class="pad-status">${flashHTML()}${ppdComplete() ? '<span class="ok">✓ 全部位入力済み</span>' : ''}<span>入力中：<strong>${siteName(c.t, c.k)}</strong></span>
        <span class="tip">出血があるときは「出血」→ 数字 の順に押します</span></div>
      <div class="keys n12">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<button class="key${n >= 6 ? ' hi6' : n >= 4 ? ' hi4' : ''}${th.ppd[c.k] === n ? ' sel' : ''}" data-num="${n}">${n}</button>`).join('')}</div>
      <div class="keys tools7">
        <button class="tool bopt${th.bop[c.k] ? ' on' : ''}" data-act="bop">● 出血</button>
        <button class="tool pust${th.pus[c.k] ? ' on' : ''}" data-act="pus">▲ 排膿</button>
        ${nav(`<button class="tool" data-act="missing">${toothName(c.t)}を欠損に</button>`)}
        ${fillGroup(ed.bulkVal, 1, 12)}
      </div>`;
  } else if (ed.mode === 'bop') {
    const n = ALL.reduce((a, t) => a + (T[t].missing ? 0 : SITES.filter((k) => T[t].bop[k]).length), 0);
    const voiceBop = voice.on && voice.mode === 'bop' && voice.ctx;
    body = `<div class="pad-status">${flashHTML()}${voiceBop
      ? `<span>いま出血 <strong>${n}</strong>部位。下の地図を押すと、声で入れる列を切り替えられます</span>`
      : `<span>チャートのポケットの欄を<strong>タップすると出血</strong>が付きます。もう一度タップで外れます</span><span class="tip">いま出血 ${n}部位。声で入れるときは上の「🎤 出血」</span>`}
        <button class="tool undo bopclear" data-act="bopclear">出血の記録をすべて消す</button></div>
      ${voice.on && voice.mode === 'bop' && voice.ctx ? areaMapHTML(voice.ctx) : ''}`;
  } else if (ed.mode === 'mob') {
    const t = MOB_SEQ[ed.mob];
    body = `<div class="pad-status">${flashHTML()}<span>入力中：<strong>${toothName(t)} の動揺度</strong></span></div>
      <div class="keys n4">${[0, 1, 2, 3].map((n) => `<button class="key${T[t].mob === n ? ' sel' : ''}" data-num="${n}">${n}</button>`).join('')}</div>
      <div class="keys tools">${nav(`<button class="tool" data-act="missing">${toothName(t)}を欠損に</button>`)}${fillGroup(ed.mobBulk, 0, 3)}</div>`;
  } else if (ed.mode === 'fur') {
    const c = FURC_SEQ[ed.fur];
    if (T[c.t].missing) {
      body = `<div class="pad-status">${flashHTML()}<span>大臼歯がすべて欠損のため、分岐部の入力はありません</span></div>`;
    } else {
      const v = T[c.t].fur[c.f];
      body = `<div class="pad-status">${flashHTML()}<span>入力中：<strong>${toothName(c.t)}　${FURC_NAME[c.f]}の分岐部</strong></span><span class="tip">Lindhe分類（Ⅰ〜Ⅲ度）。病変がなければ「なし」</span></div>
        <div class="keys n4">${[[0, 'なし'], [1, 'Ⅰ度'], [2, 'Ⅱ度'], [3, 'Ⅲ度']].map(([n, l]) => `<button class="key${(v || 0) === n && v != null ? ' sel' : ''}" data-num="${n}">${l}</button>`).join('')}</div>
        <div class="keys tools">${nav()}</div>`;
    }
  } else if (ed.mode === 'pcr') {
    const canApply = ed.plFaces.size > 0;
    body = `<div class="pad-status">${flashHTML()}<span>まとめて：<strong>範囲と面を選んで「付ける」</strong></span>
        <span class="tip">1か所ずつはチャートの三角をタップ。歯番号をタップでその歯の4面を切り替え</span></div>
      <div class="bulk top"><span class="blab">範囲</span><div class="keys n7">
        ${rangeBtn('1')}${rangeBtn('2')}${rangeBtn('all')}<span></span><span></span>
        ${hasPlaque(ed.exam) ? '<span></span>' : `<button class="tool${plaqueNone(ed.exam) ? ' on' : ''}" data-act="pcrnone">${plaqueNone(ed.exam) ? '✓ 付着なし（PCR 0%）' : '付着なし（PCR 0%）'}</button>`}
        <button class="tool" data-act="pcrclear">すべて消す</button>
        ${rangeBtn('4')}${rangeBtn('3')}
      </div></div>
      <div class="bulk"><span class="blab">面</span><div class="keys n7">
        ${PL_FACES.map(([v, l]) => `<button class="tool${ed.plFaces.has(v) ? ' on' : ''}" data-face="${v}">${l}</button>`).join('')}
        <button class="tool apply" data-act="plon" ${canApply ? '' : 'disabled'}>付ける</button>
        <button class="tool" data-act="ploff" ${canApply ? '' : 'disabled'}>外す</button>
        <button class="tool" data-act="plfaces">面の選択を解除</button>
      </div></div>`;
  }
  return tabs + body;
}

// プラークの範囲ボタン（歯列の位置どおり：上段 右上・左上・全顎、下段 右下・左下）
function rangeBtn(v) {
  const l = PL_RANGES.find(([k]) => k === v)[1];
  return `<button class="tool${ed.plRange === v ? ' on' : ''}" data-range="${v}">${l}</button>`;
}
// 引き継ぎ中の印（出血・排膿・プラーク）は、1回目のタップで「確定」、2回目から付け外し
function tapFlag(type, t, k, holder) {
  if (isCarried(ed.exam, type, t, k)) unCarry(ed.exam, type, t, k);
  else holder[k] = !holder[k];
}
// 8つの列を歯列の並び（チャートと同じ向き）で並べる
function areaMapHTML(ctx) {
  const cell = (q, side) => {
    const on = ctx.q === q && ctx.side === side;
    const lab = side === 'b' ? '頬側' : q <= 2 ? '口蓋側' : '舌側';
    return `<button class="area${on ? ' on' : ''}" data-area="${q}${side}">${QNAME[q]} ${lab}</button>`;
  };
  return `<div class="areamap">
    <div class="ablock"><div class="ajaw">上顎</div><div class="agrid">${cell(1, 'b')}${cell(2, 'b')}${cell(1, 'l')}${cell(2, 'l')}</div></div>
    <div class="ablock"><div class="ajaw">下顎</div><div class="agrid">${cell(4, 'l')}${cell(3, 'l')}${cell(4, 'b')}${cell(3, 'b')}</div></div>
  </div>`;
}
function flashHTML() {
  if (!ed.flash) return '';
  return `<span class="flash">${ed.flash}</span>${ed.undo ? '<button class="tool undo" data-act="undo">↶ 取り消す</button>' : ''}`;
}
function fillGroup(v, min, max) {
  return `<div class="fillgrp">
    <button class="tool step" data-act="bulkdown" ${v <= min ? 'disabled' : ''}>－</button>
    <button class="tool fill" data-act="fill">空欄を全部<b>${v}</b>に</button>
    <button class="tool step" data-act="bulkup" ${v >= max ? 'disabled' : ''}>＋</button>
  </div>`;
}
function fillEmptyMob() {
  const T = ed.exam.teeth;
  const filled = MOB_SEQ.filter((t) => !T[t].missing && T[t].mob == null);
  if (!filled.length) { ed.flash = '空欄はありません'; return; }
  for (const t of filled) T[t].mob = ed.mobBulk;
  ed.undo = { kind: 'mob', filled };
  ed.flash = `空欄 ${filled.length}歯に${ed.mobBulk}を入れました。動揺のある歯をタップして直してください`;
}
function fillEmptyPPD() {
  const T = ed.exam.teeth, filled = [];
  for (const s of ed.seq) {
    const th = T[s.t];
    if (!th.missing && th.ppd[s.k] == null) { th.ppd[s.k] = ed.bulkVal; filled.push(s); }
  }
  if (!filled.length) { ed.flash = '空欄はありません'; return; }
  ed.undo = { kind: 'ppd', filled };
  ed.flash = `空欄 ${filled.length}部位に${ed.bulkVal}を入れました。深い部位をタップして直してください`;
}
function applyPlaque(on) {
  const T = ed.exam.teeth;
  const teeth = ALL.filter((t) => !T[t].missing && (ed.plRange === 'all' || String(quad(t)) === ed.plRange));
  const before = teeth.map((t) => [t, { ...T[t].pl }]);
  const carryPl = { ...((ed.exam.carry || {}).pl || {}) };
  for (const t of teeth) for (const f of ed.plFaces) { T[t].pl[f] = on; unCarry(ed.exam, 'pl', t, f); }
  ed.undo = { kind: 'pl', before, pcrNone: plaqueNone(ed.exam), carryPl };
  if (on) ed.exam.pcrNone = false;
  const range = PL_RANGES.find(([v]) => v === ed.plRange)[1];
  const faces = PL_FACES.filter(([v]) => ed.plFaces.has(v)).map(([, l]) => l).join('・');
  ed.flash = `${range}の${faces}を${on ? '付けました' : '外しました'}（${teeth.length}歯）`;
}
function undoBulk(u) {
  const T = ed.exam.teeth;
  if (u.kind === 'ppd') for (const s of u.filled) delete T[s.t].ppd[s.k];
  if (u.kind === 'mob') for (const t of u.filled) T[t].mob = null;
  if (u.kind === 'bopclear') { for (const [t, b] of u.before) T[t].bop = b; ed.flash = '出血の記録を元に戻しました'; return; }
  if (u.kind === 'voice') { undoVoiceOps(u.ops); if (voice.hist[voice.hist.length - 1] === u.ops) voice.hist.pop(); ed.flash = '音声の入力を取り消しました'; return; }
  if (u.kind === 'miss') { T[u.t].missing = false; ed.flash = `${toothName(u.t)}の欠損を取り消しました`; return; }
  if (u.kind === 'unmiss') { markMissing(u.t); ed.flash = `${toothName(u.t)}を欠損に戻しました`; return; }
  if (u.kind === 'pl') {
    for (const [t, pl] of u.before) T[t].pl = pl;
    ed.exam.pcrNone = u.pcrNone;
    if (u.carryPl && ed.exam.carry) ed.exam.carry.pl = u.carryPl;
  }
  ed.flash = '一括入力を取り消しました';
}

function markMissing(t) {
  ed.exam.teeth[t].missing = true;
  for (const key of ['cur', 'mob', 'fur']) {
    const [list, toothOf] = key === 'cur' ? [ed.seq, (s) => s.t] : key === 'mob' ? [MOB_SEQ, (x) => x] : [FURC_SEQ, (s) => s.t];
    if (toothOf(list[ed[key]]) !== t) continue;
    let j = nextOpen(list, ed[key], 1, toothOf);
    if (j === ed[key]) j = nextOpen(list, ed[key], -1, toothOf);
    ed[key] = j;
  }
}

function onPadTap(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const T = ed.exam.teeth;
  const undo = ed.undo;
  ed.undo = null;
  if (b.dataset.act === 'undo' && undo) { undoBulk(undo); return touch(); }
  if (b.dataset.mode) { ed.mode = b.dataset.mode; return refresh(); }
  const num = b.dataset.num !== undefined ? Number(b.dataset.num) : null;
  const act = b.dataset.act;

  if (ed.mode === 'ppd') {
    const c = ed.seq[ed.cur], th = T[c.t];
    if (num !== null) { th.ppd[c.k] = num; unCarry(ed.exam, 'ppd', c.t, c.k); voice.lastSite = c; ed.cur = stepPPD(1); }
    else if (act === 'bop') tapFlag('bop', c.t, c.k, th.bop);
    else if (act === 'pus') tapFlag('pus', c.t, c.k, th.pus);
    else if (act === 'prev') { ed.cur = stepPPD(-1); return refresh(); }
    else if (act === 'next') { ed.cur = stepPPD(1); return refresh(); }
    else if (act === 'bulkdown' || act === 'bulkup') { ed.bulkVal = Math.min(12, Math.max(1, ed.bulkVal + (act === 'bulkup' ? 1 : -1))); return refresh(); }
    else if (act === 'clear') {
      delete th.ppd[c.k]; delete th.bop[c.k]; delete th.pus[c.k];
      for (const ty of ['ppd', 'bop', 'pus']) unCarry(ed.exam, ty, c.t, c.k);
    }
    else if (act === 'missing') { markMissing(c.t); ed.flash = `${toothName(c.t)}を欠損にしました`; ed.undo = { kind: 'miss', t: c.t }; }
    else if (act === 'fill') { fillEmptyPPD(); ed.cur = firstEmpty(ed.seq, (s) => s.t, (s) => T[s.t].ppd[s.k] == null); }
    else return;
    return touch();
  }
  if (ed.mode === 'bop') {
    if (b.dataset.area) {
      voice.ctx = { q: Number(b.dataset.area[0]), side: b.dataset.area[1] };
      voiceMsg(`${ctxLabel(voice.ctx)} に切り替えました`);
      return refresh();
    }
    if (act !== 'bopclear') return;
    const before = ALL.map((t) => [t, { ...T[t].bop }]);
    for (const t of ALL) { T[t].bop = {}; for (const k of SITES) unCarry(ed.exam, 'bop', t, k); }
    ed.undo = { kind: 'bopclear', before };
    ed.flash = '出血の記録をすべて消しました';
    return touch();
  }
  if (ed.mode === 'mob') {
    const t = MOB_SEQ[ed.mob];
    if (num !== null) { T[t].mob = num; unCarry(ed.exam, 'mob', t); ed.mob = stepMob(1); }
    else if (act === 'prev') { ed.mob = stepMob(-1); return refresh(); }
    else if (act === 'next') { ed.mob = stepMob(1); return refresh(); }
    else if (act === 'clear') { T[t].mob = null; unCarry(ed.exam, 'mob', t); }
    else if (act === 'missing') { markMissing(t); ed.flash = `${toothName(t)}を欠損にしました`; ed.undo = { kind: 'miss', t }; }
    else if (act === 'bulkdown' || act === 'bulkup') { ed.mobBulk = Math.min(3, Math.max(0, ed.mobBulk + (act === 'bulkup' ? 1 : -1))); return refresh(); }
    else if (act === 'fill') { fillEmptyMob(); ed.mob = firstEmpty(MOB_SEQ, (x) => x, (x) => T[x].mob == null); }
    else return;
    return touch();
  }
  if (ed.mode === 'fur') {
    const c = FURC_SEQ[ed.fur];
    if (num !== null) { T[c.t].fur[c.f] = num; unCarry(ed.exam, 'fur', c.t, c.f); ed.fur = stepFur(1); }
    else if (act === 'prev') { ed.fur = stepFur(-1); return refresh(); }
    else if (act === 'next') { ed.fur = stepFur(1); return refresh(); }
    else if (act === 'clear') { delete T[c.t].fur[c.f]; unCarry(ed.exam, 'fur', c.t, c.f); }
    else return;
    return touch();
  }
  if (ed.mode === 'pcr') {
    if (b.dataset.range) { ed.plRange = b.dataset.range; return refresh(); }
    if (b.dataset.face) { const f = b.dataset.face; if (ed.plFaces.has(f)) ed.plFaces.delete(f); else ed.plFaces.add(f); return refresh(); }
    if (act === 'plfaces') { ed.plFaces.clear(); return refresh(); }
    if (act === 'plon' || act === 'ploff') applyPlaque(act === 'plon');
    else if (act === 'pcrnone') ed.exam.pcrNone = !plaqueNone(ed.exam);
    else if (act === 'pcrclear') {
      ed.undo = { kind: 'pl', before: ALL.map((t) => [t, { ...T[t].pl }]), pcrNone: plaqueNone(ed.exam), carryPl: { ...((ed.exam.carry || {}).pl || {}) } };
      for (const t of ALL) T[t].pl = {};
      if (ed.exam.carry) ed.exam.carry.pl = {};
      ed.exam.pcrNone = false;
      ed.flash = 'プラークの記録をすべて消しました';
    } else return;
    return touch();
  }
}

function onChartTap(e) {
  const T = ed.exam.teeth;
  ed.undo = null;
  const surf = e.target.closest('[data-surf]');
  if (surf) {
    const t = Number(surf.dataset.t), s = surf.dataset.surf;
    tapFlag('pl', t, s, T[t].pl);
    ed.exam.pcrNone = false;
    ed.mode = 'pcr';
    return touch();
  }
  const cell = e.target.closest('[data-k]');
  if (cell) {
    const t = Number(cell.dataset.t), k = cell.dataset.k;
    if (ed.mode === 'bop') { tapFlag('bop', t, k, T[t].bop); return touch(); }
    voice.lastSite = null; voice.specTooth = null;
    ed.mode = 'ppd';
    const i = ed.seq.findIndex((s) => s.t === t && s.k === k);
    if (i >= 0) ed.cur = i;
    return refresh();
  }
  const fcell = e.target.closest('[data-f]');
  if (fcell) {
    const t = Number(fcell.dataset.t), f = fcell.dataset.f;
    ed.mode = 'fur';
    ed.fur = FURC_SEQ.findIndex((s) => s.t === t && s.f === f);
    return refresh();
  }
  const mob = e.target.closest('[data-mob]');
  if (mob) { ed.mode = 'mob'; ed.mob = MOB_SEQ.indexOf(Number(mob.dataset.mob)); return refresh(); }
  const num = e.target.closest('[data-tooth]');
  if (num) {
    const t = Number(num.dataset.tooth), th = T[t];
    if (th.missing) {
      th.missing = false;
      ed.undo = { kind: 'unmiss', t };
      ed.flash = `${toothName(t)}の欠損を解除しました`;
      return touch();
    }
    if (ed.mode === 'pcr') {
      const all = PL.every((s) => th.pl[s]);
      for (const s of PL) { th.pl[s] = !all; unCarry(ed.exam, 'pl', t, s); }
      ed.exam.pcrNone = false;
      return touch();
    }
    if (ed.mode === 'mob') { ed.mob = MOB_SEQ.indexOf(t); return refresh(); }
    if (ed.mode === 'fur' && isMolar(t)) { ed.fur = FURC_SEQ.findIndex((s) => s.t === t); return refresh(); }
    ed.mode = 'ppd';
    const i = ed.seq.findIndex((s) => s.t === t);
    if (i >= 0) ed.cur = i;
    return refresh();
  }
}

/* ================= 音声入力（ポケット） ================= */
// Safari／Chrome の音声認識を使う。ホーム画面に追加したアプリでは使えない（Safari のタブで開く）
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const voice = { mode: 'ppd', ctx: null, rec: null, on: false, lastSite: null, endedSite: null, hist: [], interim: '', msg: '', prov: null, timer: null, log: [], cue: null };
const VOICE_EARLY_MS = 250; // 話している途中でも、この時間言葉が止まったら仮に入力する
const VOICE_EARLY_BOP_MS = 150; // 出血モードは歯の番号と部位だけなので、もっと早く印を付ける

// ---- 速さの工夫：確定を待たずに仮入力し、確定した文が違えば入れ直す ----
const sameSpeech = (a, b) => { const n = (t) => t.replace(/[\s、。,.!?！？]/g, ''); return n(a) === n(b); };
// 認識結果の束を処理する。途中結果は複数に分かれて届くことがあるので、つなげて1つの文として扱う
// 比べるための正規化：空白・句読点を除き、漢数字を数字にそろえる
const normSpeech = (t) => t.normalize('NFKC').replace(/[\s、。,.!?！？]/g, '').replace(/[〇零一二三四五六七八九]/g, (c) => KD[c]);
// 区切って確定した部分（voice.consumed）を、届いた文の頭から取り除く。iPadは同じ文に言葉を足していくため。
// 頭が一致しない（前の部分を書き換えた）ときは null
function stripConsumed(text) {
  const c = voice.consumed;
  if (!c) return text;
  const n = normSpeech(text);
  if (!n.startsWith(c)) return null;
  let k = 0, i = 0;
  while (i < text.length && k < c.length) { k += normSpeech(text[i]).length; i++; }
  return text.slice(i);
}
function onVoiceResults(items) {
  // フットスイッチで取り消した文・乱れて捨てた文は、聞き取りが止まる（onend）まで何も扱わない
  if (voice.discard) { voice.interim = ''; renderVoice(); return; }
  let interim = '', fin = false;
  for (const it of items) {
    if (it.isFinal) {
      let t = stripConsumed(it.text);
      if (t == null) t = rollbackSession(it.text);
      voice.consumed = ''; voice.session = null; // 確定した文は閉じる。次の文は新しく始まる
      if (t != null && t.trim()) voiceFinal(t);
      fin = true;
    } else interim += it.text;
  }
  if (interim) {
    let t = stripConsumed(interim);
    if (t == null) t = rollbackSession(interim);
    interim = t == null ? '' : t;
  }
  voice.interim = interim;
  if (interim.trim()) { diag().ev++; voiceInterim(interim); }
  // 黙ったら区切る：聞き取った文字が変わらないまま一定時間たったら、その文を確定させる
  if (fin || !sameSpeech(voice.heard || '', interim)) { voice.heard = interim; armSilence(); }
  renderVoice();
}
// 1つの文（発話）のあいだの様子。聞き取りの記録に残し、仮入力が出なかった原因を確かめられるようにする
const diag = () => (voice.diag ||= { ev: 0, chg: 0, prov: 0, nul: 0, why: '' });
function diagText(d, cut) {
  if (!d) return cut ? `区切り：${cut}` : '';
  return `途中の聞き取り${d.ev}回（変化${d.chg}）・仮入力${d.prov}回${d.nul ? `（入れず${d.nul}回：${d.why}）` : ''}・区切り：${cut || 'iPadが確定'}`;
}
const silenceSec = () => (settings.cutSilence == null ? 1 : settings.cutSilence);
function armSilence() {
  clearTimeout(voice.silTimer);
  const sec = silenceSec();
  if (!sec || !voice.on) return;
  voice.silTimer = setTimeout(() => {
    if (voice.on && guiding && !voice.paused) { armSilence(); return; } // 音の案内の最中：終わってから区切る
    if (!voice.on || voice.paused || guiding || !(voice.prov || (voice.interim || '').trim())) return;
    cutRec(`${sec}秒の間`);
  }, sec * 1000);
}
function undoProv() {
  const p = voice.prov;
  voice.prov = null;
  if (!p) return;
  if (p.ops && p.ops.length) {
    undoVoiceOps(p.ops);
    const i = voice.hist.indexOf(p.ops);
    if (i >= 0) voice.hist.splice(i, 1);
  }
  ed.cur = p.cur; voice.lastSite = p.lastSite; voice.endedSite = p.endedSite;
  voice.specTooth = p.specTooth; voice.bopTooth = p.bopTooth; voice.bopLast = p.bopLast;
  if (p.ctx) voice.ctx = { ...p.ctx };
}
function voiceInterim(text) {
  if (voice.discard) return; // フットスイッチで取り消した文の続き
  if (voice.prov && sameSpeech(voice.prov.text, text)) return;
  // 同じ文字の途中結果が続けて届いても、待ち時間をやり直さない（やり直すと、いつまでも仮入力されないことがある）
  if (voice.timer && sameSpeech(voice.pend || '', text)) return;
  diag().chg++;
  voice.pend = text;
  clearTimeout(voice.timer);
  voice.timer = setTimeout(() => {
    voice.timer = null;
    const fresh = !voice.prov;
    undoProv();
    if (fresh) voice.cue = ed.cur; // 話し始め。ここから進んだぶんを合図する
    const before = { cur: ed.cur, lastSite: voice.lastSite, endedSite: voice.endedSite, ctx: voice.ctx ? { ...voice.ctx } : null,
      specTooth: voice.specTooth, bopTooth: voice.bopTooth, bopLast: voice.bopLast }; // 仮入力を戻すときに、言葉の続きの記憶も戻す
    voice.junkCut = false; voice.specCut = false;
    const ops = handleSpeech(text, true);
    if (ops) { voice.prov = { text, ops, ...before, guide: voice.lastGuide }; diag().prov++; } else {
      const d = diag(), tk = tokenizeSpeech(text);
      d.nul++;
      d.why = !tk.length ? '数字や言葉が読めない' : CMD_RE.test(text) ? '今どこ等' : tk.some((t) => ['undo', 'prev', 'next', 'stop'].includes(t.type)) ? '操作の言葉（次・戻る・取り消し等）' : 'その他';
    }
    // 読めない言葉で止まったときも、ここで文を確定させる。続けて言い直すと同じ文の後ろにつながり、何度言っても同じ所で止まるため
    if (voice.mode === 'bop') bopCue(ops); // 出血：歯が入ったらポッ、エリアが変わったらチャイム
    const area = ppdCue() === 'area';
    if (area || voice.junkCut || voice.specCut) cutRec(area ? 'エリアの区切り' : voice.junkCut ? '聞き取れない言葉' : '部位指定');
  }, voice.mode === 'bop' ? VOICE_EARLY_BOP_MS : VOICE_EARLY_MS);
}
function voiceFinal(text) {
  clearTimeout(voice.timer); voice.timer = null;
  if (voice.discard) { voice.discard = false; voice.interim = ''; return; } // フットスイッチで取り消した文
  const startIdx = voice.prov ? voice.prov.cur : ed.cur; // 話し始めたときのカーソル
  if (voice.prov && sameSpeech(voice.prov.text, text) && !CMD_RE.test(text)) { // 仮入力のまま確定
    const g = voice.prov.guide, quiet = /秒の間/.test(voice.cutReason || '');
    voice.prov = null; voice.cue = null; voice.bopPopN = 0; addVoiceLog(text, startIdx); guide(quiet ? quietGuide(g) : g); return;
  }
  if (!voice.prov) voice.cue = ed.cur;
  undoProv(); // 仮入力と違う文で確定したら、仮入力を戻してから入れ直す
  voice.lastOps = handleSpeech(text);
  ppdCue();
  voice.cue = null;
  const quiet = /秒の間/.test(voice.cutReason || '');
  if (voice.mode === 'bop') bopCue(voice.lastOps);
  voice.bopPopN = 0;
  addVoiceLog(text, startIdx);
  guide(quiet ? quietGuide(voice.lastGuide) : voice.lastGuide);
}
// 黙って区切ったときの案内：言葉の案内（「5番」など）は省き、音と警告・区切りの案内だけ残す。毎回の案内で聞き取りが止まらないように
const quietGuide = (items) => (items || []).filter((g) => g.tone === 'buzz' || g.tone === 'chime' || g.tone === 'pop' || /次、|取り消しました/.test(g.text || ''));
const VOICE_LOG_MAX = 200;
function addVoiceLog(text, startIdx) {
  const s = ed.seq[startIdx];
  const info = diagText(voice.diag, voice.cutReason);
  voice.diag = null; voice.cutReason = ''; voice.pend = '';
  voice.log.unshift({ id: uid(), time: new Date().toLocaleString('ja-JP'), start: s ? siteName(s.t, s.k) : '', raw: text, result: voice.lastResult || '', ok: null, correct: '', info });
  voice.log.length = Math.min(voice.log.length, VOICE_LOG_MAX);
  saveVoiceLog();
}
const saveVoiceLog = () => DB.put('settings', { key: 'voicelog', items: voice.log }).catch(() => {});
function showVoiceLog() {
  const okBtns = (l) => `<button class="okb${l.ok === true ? ' on' : ''}" data-ok="${l.id}" data-v="1">○</button><button class="okb ng${l.ok === false ? ' on' : ''}" data-ok="${l.id}" data-v="0">×</button>`;
  const rows = voice.log.map((l) => `<tr><td class="nw">${esc(l.time)}</td><td>${esc(l.start || '')}</td><td>「${esc(l.raw)}」</td><td>${esc(l.result)}${l.info ? `<small class="vinfo">${esc(l.info)}</small>` : ''}</td>
    <td class="nw">${okBtns(l)}</td><td>${l.ok === false ? `<input class="fix" data-fix="${l.id}" value="${esc(l.correct)}" placeholder="例：右上6 頬側 近心 4">` : ''}</td></tr>`).join('');
  openDialog(`<div class="dlg-body"><h2>聞き取りの記録（新しい順）</h2>
    <p class="hint">間違っていた行は「×」を押して、「正しくは」に本当に言った内容を書いてください。「記録を書き出す」で私に送れます。</p>
    <div class="vlog">${rows ? `<table><thead><tr><th>時刻</th><th>開始位置</th><th>聞き取った言葉</th><th>入力した内容</th><th>判定</th><th>正しくは</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">まだ記録がありません</p>'}</div>
    <div class="dlg-actions"><button class="btn" id="vlogTest">読み上げテスト</button><div class="grow"></div><button class="btn" id="vlogClear" ${voice.log.length ? '' : 'disabled'}>記録を消す</button><button class="btn" id="vlogExport">記録を書き出す</button><button class="btn primary" data-close>閉じる</button></div></div>`, true);
  const d = $('#dlg');
  d.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => {
    const l = voice.log.find((x) => x.id === b.dataset.ok);
    const v = b.dataset.v === '1';
    l.ok = l.ok === v ? null : v;
    saveVoiceLog();
    showVoiceLog();
  }));
  d.querySelectorAll('[data-fix]').forEach((inp) => (inp.onchange = () => { voice.log.find((x) => x.id === inp.dataset.fix).correct = inp.value.trim(); saveVoiceLog(); }));
  $('#vlogExport').onclick = () => exportCSV(`voice-log-${stamp()}.csv`, '聞き取りの記録',
    ['時刻', '開始位置', '聞き取った言葉', '入力した内容', '判定', '正しくは', '途中の様子'],
    voice.log.map((l) => [l.time, l.start, l.raw, l.result, l.ok === true ? '○' : l.ok === false ? '×' : '', l.correct, l.info || '']));
  $('#vlogClear').onclick = async () => {
    const ok = await askConfirm(`聞き取りの記録（${voice.log.length}件）をすべて消しますか？\n必要なら、先に「記録を書き出す」で保存してください。`, '消す', true);
    if (ok) { voice.log = []; await saveVoiceLog(); }
    showVoiceLog();
  };
  $('#vlogTest').onclick = () => { closeDialog(); showVoiceTest(); };
}

// mode = 'ppd'（ポケット）／'bop'（出血だけ）。聞き取り中に別のボタンを押すとモードだけ切り替える
function voiceToggle(mode = 'ppd') {
  if (voice.on && voice.mode === mode) { voiceStop(); return; }
  setVoiceMode(mode);
  if (!voice.on) voiceStart();
  else {
    voiceMsg(mode === 'bop' ? '「右上 頬側」「7 遠心 近心」のように話してください' : '「3、3、4プラス」のように話してください');
    if (guideOn('start')) guide([{ tone: 'chime', text: startText() }]);
  }
}
function setVoiceMode(mode) {
  voice.mode = mode;
  voice.ctxCue = null; voice.bopPopN = 0;
  voice.bopTooth = null; voice.bopLast = null;
  undoProv();
  if (mode === 'bop') voice.ctx = { q: 1, side: 'b' }; // 出血モードは、いつも右上 頬側から始める（2026-10-13 龍太郎の指定）
  if (voice.on || mode === 'bop') { ed.mode = mode; refresh(); }
}
function voiceStart() {
  unlockAudio();
  if (!SR) { voiceMsg('この画面では音声認識が使えません。iPadは Safari のタブで、Macは Safari か Chrome で開いてください'); return; }
  const r = new SR();
  r.lang = 'ja-JP';
  r.continuous = true;
  r.interimResults = true;
  r.onresult = (e) => {
    const items = [];
    for (let i = e.resultIndex; i < e.results.length; i++) items.push({ text: e.results[i][0].transcript, isFinal: e.results[i].isFinal });
    onVoiceResults(items);
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      voice.on = false;
      voiceMsg('マイクが使えません。マイクの使用を許可してください（iPadでは https での接続が必要です）');
    } else voiceMsg('音声認識のエラー：' + esc(e.error));
  };
  // 無音が続くと止まることがあるので、聞き取り中は自動で再開する
  r.onend = () => {
    // 確定が届かないまま止まったときは、仮入力（なければ途中まで聞き取った言葉）をそのまま確定する
    if (voice.rec === r && !voice.discard) {
      if (voice.prov) voiceFinal(voice.prov.text);
      else if ((voice.interim || '').trim()) voiceFinal(voice.interim);
    }
    voice.interim = '';
    voice.discard = false;
    voice.consumed = ''; voice.heard = ''; voice.session = null;
    if (voice.paused) { if (voice.pauseDone) voice.pauseDone(); return; }
    if (voice.on && voice.rec === r) setTimeout(() => { if (voice.on && voice.rec === r && !voice.paused) try { r.start(); } catch { /* 再開済み */ } }, 60);
  };
  voice.rec = r;
  voice.on = true;
  voice.lastSite = null;
  voice.endedSite = null;
  voice.specTooth = null; voice.bopTooth = null; voice.bopLast = null; voice.discard = false;
  try { r.start(); } catch (err) { voice.on = false; voiceMsg('音声認識を開始できませんでした：' + esc(err.message)); return; }
  const want = voice.mode === 'bop' ? 'bop' : 'ppd';
  if (ed.mode !== want) { ed.mode = want; refresh(); }
  voiceMsg(voice.mode === 'bop' ? '「右上 頬側」「7 遠心 近心」のように話してください' : '「3、3、4プラス」のように話してください');
  if (guideOn('start')) guide([{ tone: 'chime', text: startText() }]);
}
function voiceStop(silent = false) {
  clearTimeout(voice.timer); clearTimeout(voice.silTimer);
  voice.cutReason = '停止ボタン';
  guideQ.length = 0;
  voice.paused = false; voice.speaking = '';
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch { /* なし */ }
  voice.prov = null;
  voice.on = false;
  const r = voice.rec;
  voice.rec = null;
  voice.interim = '';
  if (r) try { r.stop(); } catch { /* 停止済み */ }
  if (silent) { voice.msg = ''; voice.warn = ''; }
  renderVoice();
  if (view.name === 'editor' && $('#chart') && ed.exam) refresh(); // 出血だけモードの列の印を消す
}
function voiceMsg(m) { voice.msg = m; voice.warn = ''; renderVoice(); }
// 入力しなかった理由（聞き取れない・欠損など）は、帯を黄色にして大きく出す
const WARN_RE = /入力していません|聞き取れません|欠損です|ありません|出血モードです|入力済み|入力できる言葉/;
function setVoiceResult(raw, done, fallback) {
  const warns = done.filter((d) => WARN_RE.test(d));
  const oks = done.filter((d) => !WARN_RE.test(d));
  voice.warn = (warns.length ? warns.join('／') : (done.length ? '' : fallback)).replace(/。入力していません/g, '（未入力）').replace(/（上下か番号が抜けています）/g, '');
  voice.msg = `<b>「${esc(raw.trim())}」</b>${oks.length ? ` → ${esc(oks.slice(-8).join('、'))}` : ''}`;
}
/* ---- 音声の案内（チャイム・警告音と、読み上げ） ---- */
// 案内のあいだは聞き取りを止め（アプリ自身の声を拾わないため）、言い終わったら再開する
const guideOn = (key) => { const g = settings.guide; return g.enabled && !voice.muted && g[key]; };
let audioCtx = null;
// iPadでは、音を出す前に一度ボタン操作の中で準備しておく必要がある
function unlockAudio() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* 音が出せない環境 */ }
  try { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* 読み上げが使えない環境 */ }
}
const TONES = { chime: [[880, 0, 0.13], [1318, 0.14, 0.22]], buzz: [[196, 0, 0.3]], pop: [[1100, 0, 0.06]] };
function playTone(kind) {
  return new Promise((res) => {
    if (!audioCtx) { res(); return; }
    const t0 = audioCtx.currentTime + 0.02;
    let end = 0;
    for (const [f, at, dur] of TONES[kind]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = kind === 'buzz' ? 'square' : 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(kind === 'buzz' ? 0.12 : 0.3, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
      end = Math.max(end, at + dur);
    }
    setTimeout(res, (end + 0.08) * 1000);
  });
}
// 読み上げでは、歯科の言葉をかなで読ませる
const READING = [[/頬側/g, 'きょうそく'], [/口蓋側/g, 'こうがいそく'], [/舌側/g, 'ぜっそく'], [/近心/g, 'きんしん'], [/遠心/g, 'えんしん'], [/中央/g, 'ちゅうおう'],
  [/欠損/g, 'けっそん'], [/排膿/g, 'はいのう'], [/右上/g, 'みぎうえ'], [/左上/g, 'ひだりうえ'], [/右下/g, 'みぎした'], [/左下/g, 'ひだりした']];
const RATE = { normal: 1.0, mid: 1.2, fast: 1.45 };
function jaVoice() {
  const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  return vs.find((v) => v.lang === 'ja-JP' && /Kyoko|O-ren|Otoya|Hattori/.test(v.name)) || vs.find((v) => (v.lang || '').startsWith('ja'));
}
function say(text) {
  return new Promise((res) => {
    if (!text || !window.speechSynthesis) { res(); return; }
    let r = text;
    for (const [re, to] of READING) r = r.replace(re, to);
    const u = new SpeechSynthesisUtterance(r);
    u.lang = 'ja-JP';
    u.rate = RATE[settings.guide.rate] || 1.2;
    const v = jaVoice();
    if (v) u.voice = v;
    let fin = false;
    const done = () => { if (!fin) { fin = true; res(); } };
    u.onend = done; u.onerror = done;
    speechSynthesis.speak(u);
    setTimeout(done, 1500 + r.length * 200); // 読み上げの終わりが届かないときの保険
  });
}
const guideQ = [];
let guiding = false;
function guide(items) {
  const list = (items || []).filter((x) => x && (x.tone || x.text));
  if (!list.length) return;
  guideQ.push(...list);
  if (!guiding) runGuide();
}
async function runGuide() {
  guiding = true;
  // 音（ポッ・チャイム・ブー）だけなら、聞き取りは止めずに鳴らす。言葉を読み上げるときだけ止める
  while (guideQ.length && !guideQ[0].text) { const g = guideQ.shift(); if (g.tone) await playTone(g.tone); }
  if (!guideQ.length) { guiding = false; renderVoice(); return; }
  await pauseRec();
  while (guideQ.length) {
    const g = guideQ.shift();
    if (g.tone) await playTone(g.tone);
    if (g.text) { voice.speaking = g.text; renderVoice(); await say(g.text); }
  }
  voice.speaking = '';
  guiding = false;
  resumeRec();
  renderVoice();
}
function pauseRec() {
  return new Promise((res) => {
    const r = voice.rec;
    if (!r || !voice.on) { res(); return; }
    voice.paused = true;
    clearTimeout(voice.timer);
    let fin = false;
    const done = () => { if (!fin) { fin = true; voice.pauseDone = null; res(); } };
    voice.pauseDone = done;
    try { r.stop(); } catch { done(); }
    setTimeout(done, 1500); // 止まった知らせ（onend）が来ないときの保険。早すぎると、まだ聞いている間に案内を話して自分の声を拾う
    renderVoice();
  });
}
function resumeRec() {
  if (!voice.paused) return;
  voice.paused = false;
  if (voice.on && voice.rec) try { voice.rec.start(); } catch { /* 開始済み。止まっていれば onend で再開する */ }
  renderVoice();
}
// 入力しなかった理由を、短い言葉にする（雑音や会話で何も入らなかったときは鳴らさない）
function failSpeech(w) {
  const num = (x) => x.replace(/(右上|左上|右下|左下)/g, '');
  let m;
  if ((m = w.match(/^(.+?)の部位が聞き取れません/))) return `${num(m[1])}番、部位をもう一度`;
  if ((m = w.match(/聞き取れない言葉がありました。(\S+) (\S+)から/))) return `${num(m[1])}番 ${m[2]}から、もう一度`;
  if ((m = w.match(/^(.+?)は欠損です/))) return `${num(m[1])}番は欠損です`;
  if (/歯の番号が聞き取れません|番の歯はありません/.test(w)) return '番号をもう一度';
  if (/歯の名前が聞き取れません/.test(w)) return '歯の名前をもう一度';
  if (/近心・遠心・中央が聞き取れません/.test(w)) return '部位をもう一度';
  if (/数字が聞き取れません/.test(w)) return '数字をもう一度';
  if (/出血モードです/.test(w)) return '出血モードです';
  if (/入力済み/.test(w)) return '最後まで入力済みです';
  if (/取り消せる入力がありません/.test(w)) return '取り消せる入力がありません';
  return null;
}
const siteSpeech = (s) => `${toothName(s.t)}、${sideName(s.t, s.k[0])}、${POS[s.k[1]]}`;
const startText = () => (voice.mode === 'bop' ? `出血モード、${ctxLabel(voice.ctx)}から` : `ポケット、${siteSpeech(ed.seq[ed.cur])}から`);
const areaName = (s) => `${QNAME[quad(s.t)]}${sideName(s.t, s.k[0])}`;
const flagWord = (o, T) => (o.field === 'pus' ? '排膿' : T[o.t].bop[o.k] ? '出血' : '出血なし');
// 話している最中の合図（ポケット）：仮入力でエリアの区切りを越えたらチャイム、次の歯に移ったら「ポッ」。
// iPadは続けて話した数字を1つの文にまとめ、話し終えるまで確定しないため、言葉ではない音で知らせる（音なら聞き取りを止めずに鳴らせる）
function ppdCue() {
  if (voice.mode === 'bop' || voice.cue == null || !ed.exam) return null;
  const from = voice.cue, to = ed.cur;
  voice.cue = to;
  if (to <= from || voice.jumped) return null; // 歯や部位を指定して動いたときは鳴らさない
  const a = ed.seq[from], b = ed.seq[to];
  if (areaName(a) !== areaName(b)) { if (guideOn('boundary')) playTone('chime'); return 'area'; }
  if (a.t !== b.t && guideOn('tooth')) playTone('pop');
  return null;
}
// エリアの最後まで入ったら、聞き取りを一度止めて確定させる（iPadは止めると、そこまでの言葉を確定して届ける）。
// 1回の発話を短くして、聞き直しによる書き換えや反応の遅れを防ぐ。確定のあとの案内（「次、左上頬側」）が終わると再開する
// 区切る：聞き取りは止めずに、ここまでの言葉を確定し、続きは新しい文として扱う（止めて再開すると0.3〜1秒言葉が抜けるため）
function cutRec(reason = '') {
  if (!voice.rec || !voice.on || voice.paused || voice.discard) return;
  if (reason) voice.cutReason = reason;
  const text = (voice.interim || '').trim() ? voice.interim : voice.prov ? voice.prov.text : '';
  if (!text) return;
  const base = voice.consumed || '';
  // 1つの文の中で最初に区切るとき、その前の状態を覚えておく（iPadが前の部分を書き換えたら、まとめて戻して入れ直すため）
  if (!base) {
    const p = voice.prov, at = p && p.ops ? voice.hist.indexOf(p.ops) : -1; // 仮入力が入る前の状態から
    const src = p || { cur: ed.cur, lastSite: voice.lastSite, endedSite: voice.endedSite, ctx: voice.ctx, specTooth: voice.specTooth, bopTooth: voice.bopTooth, bopLast: voice.bopLast };
    voice.session = { hist0: at >= 0 ? at : voice.hist.length, cur: src.cur, lastSite: src.lastSite, endedSite: src.endedSite, ctx: src.ctx ? { ...src.ctx } : null,
      specTooth: src.specTooth, bopTooth: src.bopTooth, bopLast: src.bopLast };
  }
  voiceFinal(text);
  voice.consumed = base + normSpeech(text);
  voice.interim = '';
  voice.heard = '';
}
// 区切ったあとに、iPadが前の部分を書き換えた（「右上5」→「右上6」など）：この文の中で確定した分をすべて戻し、
// 書き換えたあとの文全体で入れ直す。戻せる記録がなければ、捨てて言い直してもらう
function rollbackSession(full) {
  const S = voice.session;
  clearTimeout(voice.timer); voice.timer = null;
  undoProv();
  if (!S) { mismatchCut(); return null; }
  while (voice.hist.length > S.hist0) undoVoiceOps(voice.hist.pop());
  ed.cur = S.cur; voice.lastSite = S.lastSite; voice.endedSite = S.endedSite;
  if (S.ctx) voice.ctx = { ...S.ctx };
  voice.specTooth = S.specTooth; voice.bopTooth = S.bopTooth; voice.bopLast = S.bopLast;
  voice.consumed = ''; voice.session = null;
  if (voice.log[0]) voice.log[0].info = `${voice.log[0].info || ''}・iPadが書き換えたので入れ直し`;
  touch();
  return full;
}
function mismatchCut() {
  voice.consumed = '';
  clearTimeout(voice.timer); voice.timer = null;
  undoProv();
  voice.discard = true;
  const r = voice.rec;
  if (r) try { r.stop(); } catch { /* 停止済み */ }
  voiceMsg('聞き取りが乱れました。直前の言葉をもう一度言ってください');
  voice.warn = '聞き取りが乱れました。もう一度';
  if (guideOn('fail')) guide([{ tone: 'buzz', text: 'もう一度' }]);
}
const ECHO_MAX = 6; // 復唱するのは、入れた数が多くないときだけ（長い読み上げのあいだは聞き取れないため）
// ポケットの音声入力のあとの案内：警告／小さな音／復唱／今の位置（区切り・歯の番号・欠損歯・完了）
function ppdGuide(cur0, cur1, ops, done, complete0, complete1, moved, jumped) {
  const T = ed.exam.teeth, items = [];
  const fails = [...new Set(done.map(failSpeech).filter(Boolean))];
  const failItem = fails.length && guideOn('fail') ? { tone: 'buzz', text: fails.join('。') } : null;
  const finish = () => { if (failItem) items.push(failItem); return items; }; // 言い直すことは最後に伝える
  if (ops.length && guideOn('okBeep')) items.push({ tone: 'pop' });
  if (ops.length && ops.length <= ECHO_MAX && guideOn('echo')) items.push({ text: ops.map((o) => (o.field === 'ppd' ? String(T[o.t].ppd[o.k]) : flagWord(o, T))).join('、') });
  if (complete1 && !complete0) { if (guideOn('done')) items.push({ tone: 'chime', text: '全部位、入力しました' }); return finish(); }
  if (cur0 === cur1 || done.some((d) => /聞き取れない言葉がありました/.test(d))) return finish(); // 読めない言葉で止まったときは「○番 遠心から、もう一度」だけ
  const a = ed.seq[cur0], b = ed.seq[cur1];
  if (moved) { if (guideOn('tooth')) items.push({ text: `${siteSpeech(b)}へ` }); return finish(); }
  if (jumped) return finish(); // 「右上6 口蓋側 近心 5」のように場所を指定して入れたときは、道案内しない
  // チャイム・「ポッ」は話している最中に ppdCue で鳴らし済み。ここでは今の位置を一言だけ（歯の途中なら部位も）
  const p = ed.seq[cur1 - 1];
  const at = `${b.t % 10}番${p && p.t === b.t && p.k[0] === b.k[0] ? ` ${POS[b.k[1]]}` : ''}`;
  if (areaName(a) !== areaName(b)) {
    const gone = []; // 新しいエリアの先頭で飛ばした欠損歯
    for (let j = cur1 - 1; j > cur0 && T[ed.seq[j].t].missing && areaName(ed.seq[j]) === areaName(b); j--) {
      const t = ed.seq[j].t;
      if (t % 10 !== 8 && !gone.includes(t)) gone.unshift(t);
    }
    const goneText = gone.length && guideOn('missing') ? `${gone.map((t) => `${t % 10}番`).join('・')}は欠損、` : '';
    if (guideOn('boundary')) items.push({ text: `次、${areaName(b)}。${goneText}${at}${goneText ? 'から' : ''}` });
    else if (guideOn('tooth')) items.push({ text: at });
  } else if (a.t !== b.t) {
    const skipped = []; // 今の歯のすぐ手前で飛ばした欠損歯
    for (let j = cur1 - 1; j > cur0 && T[ed.seq[j].t].missing; j--) if (!skipped.includes(ed.seq[j].t)) skipped.unshift(ed.seq[j].t);
    if (skipped.length && guideOn('missing')) items.push({ text: `${skipped.map((t) => t % 10).join('、')}番は欠損、${at}` });
    else if (guideOn('tooth')) items.push({ text: at });
  }
  return finish();
}
// 出血だけの音声入力のあとの案内：警告／エリアの変更／小さな音／復唱
// 出血モードの合図（話している最中も、確定したときも）：新しい歯に付いたらポッ、エリアが変わったらチャイム。音だけなので聞き取りは止めない
function bopCue(ops) {
  if (!voice.ctx) return;
  const key = `${voice.ctx.q}${voice.ctx.side}`;
  if (voice.ctxCue && voice.ctxCue !== key && guideOn('area')) playTone('chime');
  voice.ctxCue = key;
  const n = ops ? new Set(ops.filter((o) => o.field === 'bop' && ed.exam.teeth[o.t].bop[o.k]).map((o) => o.t)).size : 0;
  if (n > (voice.bopPopN || 0) && guideOn('tooth')) playTone('pop');
  voice.bopPopN = Math.max(n, voice.bopPopN || 0);
}
function bopGuide(ctx0, ctx1, ops, done) {
  const T = ed.exam.teeth, items = [];
  const fails = [...new Set(done.map(failSpeech).filter(Boolean))];
  if (ops.length && guideOn('okBeep')) items.push({ tone: 'pop' });
  if (ops.length && guideOn('echo')) {
    const byTooth = [];
    for (const o of ops) {
      let g = byTooth.find((x) => x.t === o.t);
      if (!g) { g = { t: o.t, words: [] }; byTooth.push(g); }
      const w = o.field === 'bop' && T[o.t].bop[o.k] ? POS[o.k[1]] : `${POS[o.k[1]]} ${flagWord(o, T)}`;
      if (!g.words.includes(w)) g.words.push(w);
    }
    items.push({ text: byTooth.map((g) => `${g.t % 10}番 ${g.words.join(' ')}`).join('、') });
  }
  if (fails.length && guideOn('fail')) items.push({ tone: 'buzz', text: fails.join('。') }); // 言い直すことは最後に伝える
  return items;
}

function renderVoice() {
  const b = $('#mic');
  if (b) { const on = voice.on && voice.mode !== 'bop'; b.classList.toggle('rec', on); b.textContent = on ? '● 聞き取り中' : '🎤 ポケット'; }
  const bb = $('#micbop');
  if (bb) { const on = voice.on && voice.mode === 'bop'; bb.classList.toggle('rec', on); bb.textContent = on ? '● 聞き取り中' : '🎤 出血'; }
  const v = $('#voicebar');
  if (!v) return;
  v.hidden = !voice.on && !voice.msg && !voice.warn;
  const ch = $('#chart');
  if (ch) ch.classList.toggle('voiceon', voice.on && voice.mode !== 'bop');
  v.classList.toggle('warn', !!voice.warn);
  // 話してよいか（聞いている／案内中）と、次に入る場所を大きく出す。画面をちらっと見ただけで分かるように
  const waiting = voice.on && (guiding || voice.paused);
  const state = !voice.on ? '' : waiting
    ? `<span class="vstate wait">🔈 ${voice.speaking ? `「${esc(voice.speaking)}」` : '案内中'}<small>待って</small></span>`
    : '<span class="vstate live"><i></i>どうぞ</span>';
  const c = ed.seq && ed.seq[ed.cur];
  const where = voice.on && voice.mode !== 'bop' && c && ed.exam
    ? `<span class="vwhere"><small>次</small>${voice.endedSite ? '全部位 入力済み' : `${toothName(c.t)}<b>${sideName(c.t, c.k[0])} ${POS[c.k[1]]}</b>`}</span>` : '';
  v.innerHTML = `<div class="vrow">${state}${where}${voice.on && voice.mode === 'bop' && voice.ctx ? `<span class="vctx">出血入力中：${ctxLabel(voice.ctx)}</span>` : ''}${voice.warn ? `<span class="vwarn">⚠ ${esc(voice.warn)}</span>` : ''}<span class="vm">${voice.msg}</span>${voice.interim ? `<span class="vi">${esc(voice.interim)}…</span>` : ''}
    <button class="tool undo vlogbtn" id="vhelp">？ 話し方</button><button class="tool undo" id="vmute">${voice.muted ? '🔇 案内オフ' : '🔈 案内'}</button><button class="tool undo" id="vlog">聞き取りの記録</button><button class="tool undo" id="vtest">読み上げテスト</button></div>
`;
  $('#vmute').onclick = () => { voice.muted = !voice.muted; if (voice.muted) { guideQ.length = 0; try { speechSynthesis.cancel(); } catch { /* なし */ } } renderVoice(); };
  $('#vlog').onclick = showVoiceLog;
  $('#vtest').onclick = showVoiceTest;
  $('#vhelp').onclick = showVoiceHelp;
}
// 話し方の早見表（言い方と、音の意味）
function showVoiceHelp() {
  const row = (say, what) => `<tr><td class="say">${say}</td><td>${what}</td></tr>`;
  openDialog(`<div class="dlg-body vhelp"><h2>音声入力の話し方</h2>
    <div class="vhcols"><section><h3>🎤 ポケット</h3><table>
      ${row('「3、3、4」', '今の場所から順に入れて進む')}
      ${row('「4 プラス」', '入れた部位に出血。「排膿」「マイナス」（出血なし）も')}
      ${row('「5番 中央 4」', '<b>言い直し</b>：直前に入れたエリアの5番。入れたあと元の場所に戻る')}
      ${row('「右上6 口蓋側 近心 5」', '<b>場所を指定</b>して1か所入れる（続けて「遠心 4」で同じ歯）')}
      ${row('「右上6」', 'その歯へ移動して、そこから順に入れる')}
      ${row('「取り消し」', '最後に入れた<b>歯1本分</b>を取り消す。その歯から言い直せる')}
      ${row('「戻る」「次」', 'カーソルを1つ戻す・進める')}
    </table></section>
    <section><h3>🎤 出血</h3><table>
      ${row('「右上 頬側」', '入れる列を決める（「口蓋側」だけで反対側へ）')}
      ${row('「7 遠心 近心」', '今の列の7番に出血。続けて「中央」で同じ歯に追加')}
      ${row('「3 全部」', '3部位すべてに出血')}
      ${row('「マイナス」「排膿」', '直前の分を外す・排膿にする')}
    </table>
    <h3>どちらでも</h3><table>
      ${row('「今どこ」', '今の場所を声で答える')}
      ${row('「出血モード」「ポケットモード」', 'モードを切り替える')}
      ${row('「停止」', '聞き取りを止める')}
    </table></section></div>
    <h3>音の意味</h3><div class="vhsounds">
      <span><b>ポッ</b>次の歯に移った（出血：歯が入った）</span>
      <span><b>チャイム</b>エリアの区切り。<u>声の案内が終わってから</u>続きを話す</span>
      <span><b>ブー</b>入らなかった。案内のとおり言い直す</span>
      <span><b class="ok">● どうぞ</b>聞いています</span><span><b class="ng">🔈 待って</b>案内中（話しても入りません）</span></div>
    <p class="sub">続けて話してかまいません。黙ったとき（初期1秒）・エリアの区切り・部位を指定して入れたときに、そこまでを確定します。声の案内（「次、左上頬側」など）が流れている間は「待って」になるので、終わってから話してください。音（ポッ・チャイム）の間は話し続けて大丈夫です。</p>
    <div class="dlg-actions"><div class="grow"></div><button class="btn primary" data-close>閉じる</button></div></div>`, true);
}

// 聞き取った文字を、入力の指示（トークン）に分ける
const KD = { '〇': 0, '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
const SPEECH_FIX = [
  [/みぎうえ|右へ|右え|みぎえ|右手/g, '右上'], [/ひだりうえ|左へ|左え|ひだりえ|左手|ひな上|ひなうえ/g, '左上'], [/依頼し?た/g, '左下'], [/みぎした/g, '右下'], [/ひだりした|ひな下|ひなした/g, '左下'],
  // 部位の言葉の聞き間違い。「聞き取りの記録」で見つかったものを元に、音の組み合わせで読み替える
  [/(右上|左上|右下|左下)?\s*([1-8])?\s*([5五後高口公校甲工交好向広])?\s*倍速/g, (m, q, d, pre) => (q ? `${q}${d || ''} 口蓋側` : `${pre && d ? d : ''} 口蓋側`)],
  [/頰側|ほお側|ほおがわ|頬がわ|きょうそく|右足|[教協共強胸京凶狭恐鏡境競秒驚予][側則速測即息足束底]/g, '頬側'],
  [/こうがい(?:側|そく|がわ)|口蓋がわ|[口公甲高校構郊工交広向好号後][外害蓋府布付凱街](?:側|そく|即|則|速|測|足|束|息)?/g, '口蓋側'],
  [/ぜっそく|ぜつそく|舌がわ|したがわ|[舌絶接][側速息則測足束底触]/g, '舌側'],
  [/きんしん|PC|ピーシー|検診|健診|検心|けんしん|[禁近金謹筋均菌勤][親心震振身新信森慎止進鍼]/g, '近心'], [/[遠延円炎園援演塩]後/g, '遠心 5'], [/えんしん|[遠延円炎園援演塩]\s*[CＣシ](?![a-zA-Z])|[遠延円炎園援演塩返変][心伸信陣進身親新震振鍼]/g, '遠心'], [/真ん中|まんなか|ちゅうおう|[中注宙柱忠][王央応を]|(側)王/g, (m, sd) => (sd ? sd + '中央' : '中央')],
  [/禁\s*(?=遠心)/g, '近心 '], // 「禁遠心」＝近心の聞き落とし＋遠心
  [/ぷらす|\+|クラス|グラス|ブラス/g, 'プラス'], [/ぜんぶ|全部|前部/g, '全部'], [/まいなす/g, 'マイナス'], [/はいのう|排のう/g, '排膿'],
];
// 数字の読み。読みだけでできている部分（ひらがな・カタカナ・同じ音の漢字の並び）に限って数字に直す
const KANA_NUM = [['きゅう', '9'], ['じゅういち', ' 11! '], ['じゅうに', ' 12! '], ['じゅう', ' 10! '], ['いち', '1'], ['よん', '4'], ['さん', '3'], ['ろく', '6'],
  ['なな', '7'], ['しち', '7'], ['な', '7'], ['はち', '8'], ['ぜろ', '0'], ['に', '2'], ['ご', '5'], ['く', '9']];
const HOMOPHONE = { 市: '1', 似: '2', 煮: '2', 酸: '3', 参: '3', 産: '3', 散: '3', 予: '4', 後: '5', 語: '5', 碁: '5', 誤: '5', 録: '6', 蜂: '8', 鉢: '8', 急: '9', 級: '9', 球: '9', 灸: '9' };
const toHira = (t) => t.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
function kanaToDigits(run) {
  let out = '', i = 0;
  const h = toHira(run);
  while (i < h.length) {
    const hit = KANA_NUM.find(([w]) => h.startsWith(w, i));
    if (!hit) return null;
    out += hit[1] + ' ';
    i += hit[0].length;
  }
  return out;
}
function readNumbers(s) {
  s = s.replace(/[\u3041-\u3096\u30a1-\u30fcー]+/g, (run) => kanaToDigits(run.replace(/ー/g, '')) ?? run);
  s = s.replace(/[\u4e00-\u9fff]+/g, (run) => ([...run].every((c) => HOMOPHONE[c]) ? [...run].map((c) => HOMOPHONE[c]).join(' ') : run));
  return s;
}

function tokenizeSpeech(raw) {
  let s = raw.normalize('NFKC');
  for (const [re, to] of SPEECH_FIX) s = s.replace(re, to);
  s = s.replace(/(右上|左上|右下|左下|頬側|口蓋側|舌側|近心|遠心|中央|全部|プラス|マイナス|排膿)/g, ' $1 '); // 言葉の区切りをはっきりさせる
  s = readNumbers(s);
  s = s.replace(/十([一二])?/g, (m, d) => ` ${10 + (d ? KD[d] : 0)}! `); // 「十」「十一」「十二」は2桁の数
  s = s.replace(/[〇零一二三四五六七八九]/g, (c) => KD[c]);
  s = s.replace(/[百千]/g, '');
  s = s.replace(/([1-8])\s*([番晩盤])/g, ' $1$2 '); // 「335番」でも「5番」を前の数字と分ける
  const re = new RegExp([
    '(?<q>右上|左上|右下|左下)\\s*の?\\s*(?<qd>[1-8])', // 歯（右上7など）
    '(?<half>(?:右|左)(?![上下])\\s*[1-8])', // 上下が抜けた歯（右8など）
    '(?<quad>右上|左上|右下|左下)', // 番号のないブロック名（出血だけモードでは列の指定）
    '(?<ban>[1-8])\\s*[番晩盤]', // 「5番」＝今のエリアの5番（出血モードでは歯の番号の数字と同じ）
    '(?<mode>出血モード|ポケットモード)', '(?<where>今どこ|いまどこ|現在地|どこ)',
    '(?<side>頬側|口蓋側|舌側)', '(?<pos>近心|遠心|中央)', '(?<all>全部)',
    '(?<plus>プラス|出血)', '(?<minus>マイナス)', '(?<pus>排膿)', '(?<num>\\d+!?)',
    '(?<undo>取り消し|取消し?|とりけし|取り消す)', '(?<prev>戻る|もどる)', '(?<next>進む|すすむ|次|つぎ|スキップ)', '(?<stop>停止|ストップ|終了)',
  ].join('|'), 'g');
  const QB = { 右上: 1, 左上: 2, 左下: 3, 右下: 4 };
  const toks = [];
  let m, end = 0;
  while ((m = re.exec(s))) {
    const g = m.groups;
    // 数字のあとに読めない言葉（「さささ」など）があれば印を残す。後ろに数字が続くと部位がずれるため、そこで止める
    if (toks.length && toks[toks.length - 1].type === 'num' && /\p{L}/u.test(s.slice(end, m.index))) toks.push({ type: 'junk' });
    end = m.index + m[0].length;
    if (g.q) toks.push({ type: 'tooth', t: QB[g.q] * 10 + Number(g.qd) });
    else if (g.half) toks.push({ type: 'badtooth' });
    else if (g.quad) toks.push({ type: 'quad', q: QB[g.quad] });
    else if (g.ban) toks.push({ type: 'num', vals: [Number(g.ban)], ban: true });
    else if (g.mode) toks.push({ type: 'mode', mode: g.mode.startsWith('出血') ? 'bop' : 'ppd' });
    else if (g.where) toks.push({ type: 'where' });
    else if (g.side) toks.push({ type: 'side', side: g.side === '頬側' ? 'b' : 'l' });
    else if (g.pos) toks.push({ type: 'pos', pos: { 近心: 'm', 遠心: 'd', 中央: 'c' }[g.pos] });
    else if (g.all) toks.push({ type: 'all' });
    else if (g.plus) toks.push({ type: 'flag', field: 'bop', val: true, label: '出血＋' });
    else if (g.minus) toks.push({ type: 'flag', field: 'bop', val: false, label: '出血なし' });
    else if (g.pus) toks.push({ type: 'flag', field: 'pus', val: true, label: '排膿' });
    else if (g.num) {
      const d = g.num;
      const vals = [];
      if (d.endsWith('!')) vals.push(Number(d.slice(0, -1)));
      else for (let i = 0; i < d.length; i++) {
        // 数字が続いたら1桁ずつ別の部位。「10」だけは10mm（0mmはないため）
        if (d[i] === '1' && d[i + 1] === '0') { vals.push(10); i++; } else if (d[i] !== '0') vals.push(Number(d[i]));
      }
      if (vals.length) toks.push({ type: 'num', vals });
    } else if (g.undo) toks.push({ type: 'undo' });
    else if (g.prev) toks.push({ type: 'prev' });
    else if (g.next) toks.push({ type: 'next' });
    else if (g.stop) toks.push({ type: 'stop' });
  }
  return toks;
}

// 数字の読み（さん・よん・に・ご…）に出てくる音だけでできた言葉か
function looksLikeNumbers(raw) {
  const h = toHira(raw.normalize('NFKC')).replace(/[\s、。,.!?！？]/g, '');
  return h.length >= 2 && /^[さんよいにごろくなはちきゅうしぜみーおう]+$/.test(h);
}
const shortSite = (s) => `${toothName(s.t)}${sideName(s.t, s.k[0])[0]}${POS[s.k[1]][0]}`;
// 音声の取り消しは「最後の歯1本分」ずつ。エリアごとに確定するので、1回で1エリア分（21部位）が消えないように
function popVoiceUndo() {
  voice.session = null; // 文の途中で取り消したら、あとでiPadが書き換えても入れ直さない（言い直しを頼む）
  const last = voice.hist.pop();
  if (!last || !last.length) return null;
  const lt = last[last.length - 1].t;
  let i = last.length;
  while (i > 0 && last[i - 1].t === lt) i--;
  const part = last.slice(i), rest = last.slice(0, i);
  if (rest.length) voice.hist.push(rest);
  undoVoiceOps(part);
  return part;
}
function undoVoiceOps(ops) {
  const T = ed.exam.teeth;
  for (const op of [...ops].reverse()) {
    if (op.old === undefined) delete T[op.t][op.field][op.k]; else T[op.t][op.field][op.k] = op.old;
    if (op.oldCarry) ed.exam.carry[op.field][ck(op.t, op.k)] = true;
  }
  const i = ed.seq.findIndex((s) => s.t === ops[0].t && s.k === ops[0].k);
  if (i >= 0) ed.cur = i;
  voice.endedSite = null;
}

// provisional = 確定前の仮入力。取り消し・移動などの指示を含むときは仮入力しない
// dry = 読み上げテスト用の試し実行（画面・保存・取り消し履歴には触らない）
// 出血だけモード：数字は歯の番号。「右上 頬側」で列を決め、「7 遠心 近心」でその列の部位に出血を付ける
const QNAME = { 1: '右上', 2: '左上', 3: '左下', 4: '右下' };
const ctxLabel = (c) => `${QNAME[c.q]} ${c.side === 'b' ? '頬側' : c.q <= 2 ? '口蓋側' : '舌側'}`;
function handleBopSpeech(raw, provisional, dry) {
  const toks = tokenizeSpeech(raw);
  if (provisional && (!toks.length || toks.some((t) => ['undo', 'stop'].includes(t.type)))) return null;
  const T = ed.exam.teeth, ctx = voice.ctx;
  const ctx0 = { ...ctx };
  const ops = [], done = [];
  let teeth = [], posSeen = false, last = [], sawNum = false, sawTooth = false;
  const set = (t, k, field, val) => {
    ops.push({ t, k, field, old: T[t][field][k], oldCarry: isCarried(ed.exam, field, t, k) });
    T[t][field][k] = val;
    unCarry(ed.exam, field, t, k);
  };
  const apply = (poss) => {
    // 文の頭が部位の言葉なら、直前の文で付けた歯の続き（「7 遠心」で確定したあとの「近心」）
    if (!teeth.length && !sawTooth && voice.bopTooth && Math.floor(voice.bopTooth / 10) === ctx.q && !T[voice.bopTooth].missing) teeth = [voice.bopTooth];
    if (!teeth.length) { done.push('歯の番号が聞き取れませんでした。入力していません'); return; }
    voice.bopTooth = teeth[teeth.length - 1];
    const hit = [];
    for (const t of teeth) for (const pos of poss) { set(t, ctx.side + pos, 'bop', true); hit.push({ t, k: ctx.side + pos }); }
    // 同じ歯に続けて付けた部位（「7 遠心 近心」）は、まとめて「直前の分」にする
    last = posSeen && last.length && teeth.length === 1 && last.every((x) => x.t === teeth[0]) ? [...last, ...hit] : hit;
    voice.bopLast = last; // 文を確定したあとの「マイナス」「排膿」にも使う
    posSeen = true;
    done.push(`${teeth.map(toothName).join('・')} ${ctx.side === 'b' ? '頬' : teeth[0] < 30 ? '口蓋' : '舌'}${poss.map((p) => POS[p]).join('・')} 出血`);
  };
  // 前の歯に部位が1つも付かないまま次の歯が来たら、部位の聞き落としとして知らせる
  const dropPending = () => {
    if (teeth.length && !posSeen) done.push(`${teeth.map(toothName).join('・')}の部位が聞き取れませんでした。入力していません`);
    teeth = []; posSeen = false;
  };
  const addTooth = (t) => {
    dropPending();
    sawTooth = true;
    if (T[t].missing) { done.push(`${toothName(t)}は欠損です`); return; }
    teeth = [t];
  };
  let undone = null;
  const undoLast = () => {
    if (ops.length) voice.hist.push(ops.splice(0));
    const part = popVoiceUndo();
    if (!part) { done.push('取り消せる入力がありません'); return; }
    undone = part;
    done.push(`${toothName(part[0].t)}の分を取り消しました`);
  };
  for (const tk of toks) {
    if (tk.type === 'quad') { dropPending(); ctx.q = tk.q; voice.bopTooth = null; done.push(`${ctxLabel(ctx)} へ`); }
    else if (tk.type === 'side') {
      dropPending(); ctx.side = tk.side; voice.bopTooth = null;
      if (done.length && done[done.length - 1].endsWith(' へ')) done.pop();
      done.push(`${ctxLabel(ctx)} へ`);
    } else if (tk.type === 'tooth') { ctx.q = Math.floor(tk.t / 10); addTooth(tk.t); }
    else if (tk.type === 'num') {
      sawNum = true;
      for (const d of tk.vals) {
        if (d < 1 || d > 8) { dropPending(); done.push(`${d}番の歯はありません`); continue; }
        addTooth(ctx.q * 10 + d);
      }
    } else if (tk.type === 'pos') apply([tk.pos]);
    else if (tk.type === 'all') apply(['d', 'c', 'm']);
    else if (tk.type === 'flag' && (last.length || (voice.bopLast && voice.bopLast.length)) && (tk.val === false || tk.field === 'pus')) {
      if (!last.length) last = voice.bopLast;
      // 直前に付けた部位の出血を外す（マイナス）／出血の代わりに排膿にする（排膿）
      for (const { t, k } of last) {
        const i = ops.findIndex((o) => o.t === t && o.k === k && o.field === 'bop');
        if (i >= 0) {
          T[t].bop[k] = ops[i].old; if (!ops[i].old) delete T[t].bop[k];
          if (ops[i].oldCarry && ed.exam.carry) (ed.exam.carry.bop ||= {})[ck(t, k)] = true; // 引き継ぎの印も戻す
          ops.splice(i, 1);
        }
        else if (tk.field === 'pus') set(t, k, 'bop', false); // 前の文で付けた出血を、排膿に置きかえる
        if (tk.field === 'pus') set(t, k, 'pus', true);
        else set(t, k, 'bop', false);
      }
      done.push(tk.field === 'pus' ? '→ 排膿にしました' : '→ 出血を外しました');
    } else if (tk.type === 'badtooth') { teeth = []; posSeen = false; done.push('歯の名前が聞き取れませんでした。入力していません'); }
    else if (tk.type === 'undo') undoLast();
    else if (tk.type === 'stop') { if (!dry) voiceStop(); }
  }
  // 文の最後が歯の番号だけ（「7」で区切られた）なら、警告せずにその歯を覚えて、次の文の「遠心」などに使う
  if (teeth.length === 1 && !posSeen) { voice.bopTooth = teeth[0]; done.push(`${toothName(teeth[0])}：部位をどうぞ`); teeth = []; }
  dropPending();
  // 歯と部位を言い終えたら（最後の言葉が部位・全部・マイナスなど）、またはエリアを変えたら、その場で文を確定させる（ポケットの部位指定と同じ）
  const lt = toks[toks.length - 1];
  // 出血モードは続けて話せるように、歯ごとやエリアでは区切らない（黙ったときだけ区切る）
  if (sawNum && !ops.length && !toks.some((t) => ['pos', 'all', 'quad', 'side', 'undo'].includes(t.type))) {
    done.length = 0;
    done.push('出血モードです。数字は歯の番号として聞いています（ポケットの深さは「🎤 ポケット」）');
  }
  if (dry) return { ops, done };
  voice.lastGuide = bopGuide(ctx0, ctx, ops, done);
  if (undone && guideOn('enabled')) voice.lastGuide.push({ text: `${undone[0].t % 10}番、取り消しました` });
  if (ops.length) { voice.hist.push(ops); ed.undo = { kind: 'voice', ops }; ed.flash = '音声で入力しました'; }
  voice.lastResult = done.length ? done.join('、') : '入力できる言葉がありませんでした';
  setVoiceResult(raw, done, voice.lastResult);
  touch();
  renderVoice();
  return ops;
}

const CMD_RE = /出血モード|ポケットモード|今どこ|いまどこ|現在地|どこ/;
function handleSpeech(raw, provisional = false, dry = false) {
  voice.lastGuide = null;
  voice.jumped = false;
  if (!dry && view.name === 'editor' && ed.exam) {
    // 「出血モード」「ポケットモード」「今どこ？」
    const t0 = tokenizeSpeech(raw);
    const mt = settings.guide.modeVoice && t0.find((t) => t.type === 'mode');
    const wt = settings.guide.where && t0.find((t) => t.type === 'where');
    if (mt || wt) {
      // 同じ文の中で、その前に話した数字なども入れる（iPadは続けて話すと1つの文にまとめるため）
      const cm = raw.match(CMD_RE);
      const before = cm ? raw.slice(0, cm.index) : '', after = cm ? raw.slice(cm.index + cm[0].length) : '';
      const ops = tokenizeSpeech(before).length ? handleSpeech(before, provisional) || [] : [];
      if (provisional) return ops.length ? ops : null;
      const g0 = ops.length ? voice.lastGuide || [] : [], r0 = ops.length ? voice.lastResult : '';
      if (mt && mt.mode !== voice.mode) setVoiceMode(mt.mode);
      const msg = mt ? startText() : voice.mode === 'bop' ? `${ctxLabel(voice.ctx)}です` : `${siteSpeech(ed.seq[ed.cur])}です`;
      voice.lastResult = r0 ? `${r0}、${msg}` : msg;
      voiceMsg(`<b>「${esc(raw.trim())}」</b> → ${esc(voice.lastResult)}`);
      voice.lastGuide = [...g0, ...((mt ? guideOn('start') : guideOn('where')) ? [{ tone: mt ? 'chime' : null, text: msg }] : [])];
      if (mt && tokenizeSpeech(after).length) { // 「出血モード 右上頬側 7 遠心」のように、続けて話した分
        const g1 = voice.lastGuide, r1 = voice.lastResult;
        ops.push(...(handleSpeech(after) || []));
        voice.lastGuide = [...g1, ...(voice.lastGuide || [])];
        voice.lastResult = `${r1}、${voice.lastResult}`;
      }
      return ops;
    }
  }
  if (voice.mode === 'bop' && (dry || (view.name === 'editor' && ed.exam))) return handleBopSpeech(raw, provisional, dry);
  if (!dry && (view.name !== 'editor' || !ed.exam)) return null;
  const toks = tokenizeSpeech(raw);
  if (provisional && (!toks.length || toks.some((t) => ['undo', 'prev', 'next', 'stop'].includes(t.type)))) return null;
  if (!dry && ed.mode !== 'ppd') ed.mode = 'ppd';
  const T = ed.exam.teeth;
  const cur0 = ed.cur, complete0 = dry ? false : ppdComplete();
  const ops = [], done = [];
  let target = null;
  let blocked = false; // 指定した歯が欠損などで見つからないときは、次の歯の指定まで数字を入れない
  const lastNum = toks.map((t) => t.type).lastIndexOf('num');
  const hasTooth = toks.some((t) => t.type === 'tooth' || t.ban);
  const fixes = []; // 1か所の言い直し（案内で確かめられるように読み上げる）
  let undone = null; // 「取り消し」で戻した分
  // 部位を指定して入れた直後は、歯の名前を省いた「遠心 4」「口蓋側 中央 3」も同じ歯に入れる（順に入れ始めたら解除）
  const specTarget = () => (voice.specTooth ? { t: voice.specTooth.t, side: voice.specTooth.side, pos: null, named: true } : null);
  const specDone = (s) => { voice.specTooth = { t: s.t, side: s.k[0] }; };
  const firstSiteWord = toks.findIndex((t) => t.type === 'side' || t.type === 'pos');
  let moved = false;
  const cur = () => ed.seq[ed.cur];
  const setField = (site, field, val) => {
    const th = T[site.t];
    ops.push({ t: site.t, k: site.k, field, old: th[field][site.k], oldCarry: isCarried(ed.exam, field, site.t, site.k) });
    th[field][site.k] = val;
    unCarry(ed.exam, field, site.t, site.k);
  };
  // 「右上6」「右上6 口蓋側 近心」などの指定を、チャートの部位に直す
  const resolve = (tg) => {
    if (T[tg.t].missing) { done.push(`${toothName(tg.t)}は欠損です`); return -1; }
    const side = tg.side || cur().k[0];
    return tg.pos ? ed.seq.findIndex((s) => s.t === tg.t && s.k === side + tg.pos) : ed.seq.findIndex((s) => s.t === tg.t && s.k[0] === side);
  };
  const moveToTarget = () => {
    if (!target) return;
    const i = resolve(target);
    if (i >= 0) { ed.cur = i; voice.endedSite = null; moved = true; } else blocked = true;
    target = null;
  };
  const undoLast = () => {
    if (ops.length) voice.hist.push(ops.splice(0));
    const part = popVoiceUndo();
    if (!part) { done.push('取り消せる入力がありません'); return; }
    undone = part;
    done.push(`${toothName(part[0].t)}の分を取り消しました`);
  };

  for (const tk of toks) {
    if (tk.ban) { // 「5番」：直前に入れたエリア（なければ今のエリア）の5番。エリアの区切りの直後でも、言い終えたエリアの歯を直せる
      moveToTarget(); blocked = false;
      const base = voice.lastSite || cur();
      target = { t: quad(base.t) * 10 + tk.vals[0], side: base.k[0], pos: null, named: true };
      continue;
    }
    if (tk.type === 'tooth') { moveToTarget(); blocked = false; target = { t: tk.t, side: null, pos: null, named: true }; }
    else if (tk.type === 'badtooth' || tk.type === 'quad') { target = null; blocked = true; done.push('歯の名前が聞き取れませんでした（上下か番号が抜けています）。入力していません'); }
    else if (tk.type === 'side') { if (blocked) continue; target ||= specTarget() || { t: cur().t, side: null, pos: null }; target.side = tk.side; target.named = true; }
    else if (tk.type === 'pos') { if (blocked) continue; target ||= specTarget() || { t: cur().t, side: cur().k[0], pos: null }; target.pos = tk.pos; }
    else if (tk.type === 'junk') {
      if (blocked || !toks.slice(toks.indexOf(tk) + 1).some((t) => t.type === 'num')) continue;
      target = null; blocked = true;
      if (provisional) voice.junkCut = true;
      const s = cur();
      done.push(`聞き取れない言葉がありました。${toothName(s.t)} ${POS[s.k[1]]}から入力していません`);
    } else if (tk.type === 'num') {
      if (!hasTooth && firstSiteWord > toks.indexOf(tk)) {
        target = null; blocked = true;
        done.push('歯の名前が聞き取れませんでした。入力していません');
        continue;
      }
      // 「右下4 頬側 8」のように、部位（近心・遠心・中央）が抜けて数字が1つだけのときは、聞き落としの可能性が高いので入れない
      if (target && !target.pos && target.named && tk.vals.length === 1 && toks.indexOf(tk) === lastNum) {
        target = null; blocked = true;
        done.push('近心・遠心・中央が聞き取れませんでした。入力していません');
        continue;
      }
      // 「5番 中央 4」「右上6 口蓋側 近心 5」のように1か所だけ言い直したときは、入れたあとカーソルを元の場所に戻す
      const back = target && target.pos && tk.vals.length === 1 ? { cur: ed.cur, ended: voice.endedSite } : null;
      moveToTarget();
      if (blocked) continue;
      if (back) {
        const s = cur();
        setField(s, 'ppd', tk.vals[0]);
        voice.lastSite = s;
        done.push(`${shortSite(s)} ${tk.vals[0]}`);
        fixes.push(`${toothName(s.t)} ${s.k[0] !== ed.seq[back.cur].k[0] ? `${sideName(s.t, s.k[0])} ` : ''}${POS[s.k[1]]} ${tk.vals[0]}`); // 今と違う側なら側も言う
        ed.cur = back.cur; voice.endedSite = back.ended;
        specDone(s);
        continue;
      }
      voice.specTooth = null; // 順に入れ始めた
      for (const n of tk.vals) {
        if (T[cur().t].missing) { const j = stepPPD(1); if (j === ed.cur) break; ed.cur = j; }
        const s = cur();
        if (voice.endedSite === s) { done.push('最後の部位まで入力済みです'); break; }
        setField(s, 'ppd', n);
        voice.lastSite = s;
        done.push(`${shortSite(s)} ${n}`);
        const j = stepPPD(1);
        if (j === ed.cur) voice.endedSite = s; else ed.cur = j;
      }
    } else if (tk.type === 'flag') {
      let s;
      let spec = false;
      if (target && target.pos) { const i = resolve(target); target = null; if (i < 0) { blocked = true; continue; } s = ed.seq[i]; spec = true; }
      else { moveToTarget(); if (blocked) continue; s = voice.lastSite || cur(); }
      setField(s, tk.field, tk.val);
      voice.lastSite = s;
      done.push(`${shortSite(s)} ${tk.label}`);
      if (spec) { fixes.push(`${toothName(s.t)} ${POS[s.k[1]]} ${tk.field === 'pus' ? '排膿' : tk.val ? '出血' : '出血なし'}`); specDone(s); }
    } else if (tk.type === 'undo') undoLast();
    else if (tk.type === 'prev') { moveToTarget(); ed.cur = stepPPD(-1); voice.endedSite = null; moved = true; }
    else if (tk.type === 'next') { moveToTarget(); ed.cur = stepPPD(1); moved = true; }
    else if (tk.type === 'stop') { if (!dry) voiceStop(); }
  }
  moveToTarget();
  if (moved && !ops.length) done.push(`${siteName(cur().t, cur().k)} へ移動しました`);
  // 「さささん」「いよいよよ」「ミニに」のように、数字の音だけでできているのに読めなかったときは、黙って捨てずに言い直しを頼む（会話などは知らせない）
  if (!toks.length && !provisional && looksLikeNumbers(raw)) done.push('数字が聞き取れませんでした。もう一度言ってください');
  if (dry) return { ops, done };
  // 部位を指定して入れ終えたら（最後の言葉が数字かプラスなど）、その場で文を確定させる。部位を変えるたびに新しい文で聞き直すため
  const lastTok = toks[toks.length - 1];
  voice.jumped = moved || fixes.length > 0;
  if (provisional && fixes.length && lastTok && (lastTok.type === 'num' || lastTok.type === 'flag')) voice.specCut = true;
  // 聞き取れなかった言葉があり、文が言い終わっている（最後が数字やプラス）ときも、その場で区切って言い直しを待つ
  if (provisional && lastTok && (lastTok.type === 'num' || lastTok.type === 'flag') && done.some((d) => failSpeech(d))) voice.junkCut = true;
  voice.lastGuide = ppdGuide(cur0, ed.cur, ops, done, complete0, ppdComplete(), moved && !ops.length, moved);
  if (fixes.length && guideOn('enabled')) voice.lastGuide.unshift({ text: fixes.join('、') });
  if (undone && !ops.length && guideOn('enabled')) { // 取り消したら、どこから言い直すかを伝える
    const c = cur();
    voice.lastGuide = [{ text: `取り消しました。${c.t % 10}番 ${POS[c.k[1]]}から` }];
  }

  if (ops.length) {
    voice.hist.push(ops);
    ed.undo = { kind: 'voice', ops };
    ed.flash = '音声で入力しました';
  }
  const heard = `<b>「${esc(raw.trim())}」</b>`;
  voice.lastResult = done.length ? done.join('、') : '入力できる言葉がありませんでした';
  setVoiceResult(raw, done, voice.lastResult);
  touch();
  renderVoice();
  return ops;
}

// ページめくり用のフットスイッチなど：→・↓・PageDown・スペースで聞き取りの開始／停止、←・↑・PageUpで直前の音声入力を取り消す
document.addEventListener('keydown', (e) => {
  if (!settings.guide.foot || view.name !== 'editor' || !ed.exam) return;
  if (e.target.closest && e.target.closest('input, textarea, select')) return;
  if ($('#dlg').open) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) {
    e.preventDefault();
    voiceToggle(voice.on ? voice.mode : ed.mode === 'bop' ? 'bop' : 'ppd');
  } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
    e.preventDefault();
    if (voice.prov) { // 話している途中（仮入力）の分は、その文ごと取り消し、確定が届いても入れない
      clearTimeout(voice.timer);
      undoProv();
      voice.discard = true;
      voice.consumed = ''; voice.session = null; voice.interim = '';
      if (voice.rec) try { voice.rec.stop(); } catch { /* 停止済み */ } // この文は捨てて、聞き取りをやり直す
      ed.flash = '話している途中の入力を取り消しました';
      touch();
      voiceMsg('話している途中の入力を取り消しました');
      if (guideOn('enabled')) guide([{ text: '取り消しました' }]);
      return;
    }
    const last = popVoiceUndo();
    if (!last) { voiceMsg('取り消せる入力がありません'); if (guideOn('fail')) guide([{ tone: 'buzz', text: '取り消せる入力がありません' }]); return; }
    ed.flash = '音声の入力を取り消しました';
    touch();
    voiceMsg(`${toothName(last[0].t)}の分を取り消しました`);
    const c = ed.seq[ed.cur];
    if (guideOn('enabled')) guide([{ text: voice.mode === 'bop' ? `${last[0].t % 10}番、取り消しました` : `取り消しました。${c.t % 10}番 ${POS[c.k[1]]}から` }]); // 取り消しの知らせは、復唱をオフにしても残す
  }
});

/* ================= 音声入力の読み上げテスト ================= */
// お題（正解）を出して読み上げてもらい、聞き取り結果と○×を記録する。患者の検査には書き込まない
const vt = { on: false, rec: null, item: null, log: [], onlyNG: false, interim: '', last: null, buf: '', timer: null, from: null };
const VT_MAX = 500;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function makeTestItem() {
  const seq = buildSeq(settings.order);
  if (Math.random() < 0.7) {
    const t = pick(ALL);
    const [side, sname] = pick([['b', '頬側'], ['l', sideName(t, 'l')]]);
    const [pos, pname] = pick([['m', '近心'], ['d', '遠心'], ['c', '中央']]);
    const n = 1 + Math.floor(Math.random() * 9);
    const plus = Math.random() < 0.3;
    const startIdx = Math.floor(Math.random() * seq.length); // カーソルが別の場所にあっても正しく入るか
    return { kind: '部位指定', phrase: `${toothName(t)} ${sname} ${pname} ${n}${plus ? ' プラス' : ''}`, startIdx, startLabel: '', expect: [{ t, k: side + pos, n, plus }] };
  }
  const i = Math.floor(Math.random() * (seq.length - 3));
  const nums = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 9));
  const plusAt = Math.random() < 0.3 ? Math.floor(Math.random() * 3) : -1;
  return {
    kind: '連続', phrase: nums.map((n, j) => `${n}${j === plusAt ? ' プラス' : ''}`).join('、'),
    startIdx: i, startLabel: siteName(seq[i].t, seq[i].k),
    expect: nums.map((n, j) => ({ t: seq[i + j].t, k: seq[i + j].k, n, plus: j === plusAt })),
  };
}
// 入力画面と同じ読み取り方で、空の練習チャートに試し入力する
function dryRunSpeech(raw, startIdx) {
  const exam = newExam(null, today(), '', null);
  const save = { exam: ed.exam, seq: ed.seq, cur: ed.cur, lastSite: voice.lastSite, endedSite: voice.endedSite, hist: voice.hist, spec: voice.specTooth, bopT: voice.bopTooth, bopL: voice.bopLast };
  ed.exam = exam; ed.seq = buildSeq(settings.order); ed.cur = startIdx;
  voice.lastSite = null; voice.endedSite = null; voice.hist = []; voice.specTooth = null; voice.bopTooth = null; voice.bopLast = null;
  try { return { ...handleSpeech(raw, false, true), exam }; } finally {
    ed.exam = save.exam; ed.seq = save.seq; ed.cur = save.cur;
    voice.lastSite = save.lastSite; voice.endedSite = save.endedSite; voice.hist = save.hist; voice.specTooth = save.spec; voice.bopTooth = save.bopT; voice.bopLast = save.bopL;
  }
}
function judgeTest(item, r) {
  const T = r.exam.teeth;
  const hit = item.expect.every((e) => T[e.t].ppd[e.k] === e.n && !!T[e.t].bop[e.k] === e.plus);
  const extra = r.ops.some((o) => !item.expect.some((e) => e.t === o.t && e.k === o.k) && (o.field === 'ppd' || T[o.t][o.field][o.k]));
  return hit && !extra;
}

async function showVoiceTest() {
  vt.from = view.name === 'editor' ? { ...view } : null;
  voiceStop(true);
  if (vt.from) await flushSave(); // 入力画面の保存待ちを先に書き込む（戻ったときに古い記録で上書きしないように）
  view = { name: 'voicetest' };
  const saved = await DB.get('settings', 'voicetest');
  vt.log = (saved && saved.items) || [];
  vt.item = makeTestItem();
  vt.last = null;
  app().innerHTML = `
    <header class="bar"><button class="btn ghost" id="vtBack">‹ 戻る</button><h1>音声入力の読み上げテスト</h1><div class="grow"></div>
      <button class="btn" id="vtExport">記録を書き出す</button></header>
    <main class="wrap stack">
      <section class="card vtcard">
        <div class="vtlab">次の言葉を、ひと息で読んでください</div>
        <div class="vtstart" id="vtStart"></div>
        <div class="vtphrase" id="vtPhrase"></div>
        <div class="vtbtns"><button class="btn primary big" id="vtMic"></button><button class="btn big" id="vtSkip">別のお題にする</button></div>
        <div class="vtstatus" id="vtStatus"></div>
        <p class="hint">練習用の空のチャートで試すので、患者の検査には書き込みません。</p>
      </section>
      <section class="card">
        <div class="row-tools"><h2>記録</h2><span id="vtScore" class="vtscore"></span><div class="grow"></div>
          <label class="mini"><input type="checkbox" id="vtNG" ${vt.onlyNG ? 'checked' : ''}> 間違いだけ表示</label>
          <button class="btn" id="vtClear">記録を消す</button></div>
        <div class="vlog" id="vtLog"></div>
      </section>
    </main>`;
  $('#vtBack').onclick = () => { vtStop(); if (vt.from && vt.from.examId) openEditor(vt.from.examId); else showSettings(); };
  $('#vtMic').onclick = () => (vt.on ? vtStop() : vtStart());
  $('#vtSkip').onclick = () => { vt.item = makeTestItem(); vt.buf = ''; vtRender(); };
  $('#vtNG').onchange = (e) => { vt.onlyNG = e.target.checked; vtRender(); };
  $('#vtClear').onclick = async () => {
    if (!(await askConfirm('読み上げテストの記録をすべて消しますか？', '消す', true))) return;
    vt.log = []; vt.last = null; await DB.put('settings', { key: 'voicetest', items: [] }); vtRender();
  };
  $('#vtExport').onclick = () => exportCSV(`voice-test-${stamp()}.csv`, '読み上げテストの記録',
    ['時刻', '判定', '種類', 'お題（正解）', '開始位置', '聞き取った言葉', '入力した内容'],
    vt.log.map((l) => [l.time, l.ok ? '○' : '×', l.kind, l.phrase, l.start, l.heard, l.result]));
  vtRender();
}
function vtStart() {
  if (!SR) { vt.last = { msg: 'この画面では音声認識が使えません。iPadは Safari のタブで開いてください' }; vtRender(); return; }
  const r = new SR();
  r.lang = 'ja-JP'; r.continuous = true; r.interimResults = true;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) vt.buf += res[0].transcript; else interim += res[0].transcript;
    }
    vt.interim = interim;
    // 文が途中で区切られても1つにまとめるため、確定後しばらく続きがなければ判定する
    clearTimeout(vt.timer);
    if (vt.buf.trim() && !interim.trim()) vt.timer = setTimeout(vtJudge, 900);
    vtRender();
  };
  r.onerror = (e) => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    vt.on = false; vt.last = { msg: 'マイクが使えません（' + esc(e.error) + '）。マイクの使用を許可してください' }; vtRender();
  };
  r.onend = () => { if (vt.on && vt.rec === r) setTimeout(() => { if (vt.on && vt.rec === r) try { r.start(); } catch { /* 再開済み */ } }, 250); };
  vt.rec = r; vt.on = true; vt.buf = '';
  try { r.start(); } catch (err) { vt.on = false; vt.last = { msg: '開始できませんでした：' + esc(err.message) }; }
  vtRender();
}
function vtStop() {
  vt.on = false; clearTimeout(vt.timer);
  const r = vt.rec; vt.rec = null; vt.interim = '';
  if (r) try { r.stop(); } catch { /* 停止済み */ }
  if (view.name === 'voicetest') vtRender();
}
function vtJudge() {
  const heard = vt.buf.trim();
  vt.buf = '';
  if (!heard || !vt.item) return;
  const item = vt.item;
  const r = dryRunSpeech(heard, item.startIdx);
  const entry = {
    time: new Date().toLocaleString('ja-JP'), ok: judgeTest(item, r), kind: item.kind, phrase: item.phrase,
    start: item.startLabel, heard, result: r.done.length ? r.done.join('、') : '入力できる言葉がありませんでした',
  };
  vt.log.unshift(entry);
  vt.log.length = Math.min(vt.log.length, VT_MAX);
  DB.put('settings', { key: 'voicetest', items: vt.log }).catch(() => {});
  vt.last = entry;
  vt.item = makeTestItem();
  vtRender();
}
function vtRender() {
  if (view.name !== 'voicetest' || !$('#vtPhrase')) return;
  $('#vtStart').textContent = vt.item.startLabel ? `カーソルが「${vt.item.startLabel}」にある状態で：` : '';
  $('#vtPhrase').textContent = vt.item.phrase;
  const mic = $('#vtMic');
  mic.textContent = vt.on ? '● 聞き取り中（押すと停止）' : '🎤 読み上げを始める';
  mic.classList.toggle('rec', vt.on);
  const L = vt.last;
  $('#vtStatus').innerHTML = (vt.interim || vt.buf ? `<div class="vi">聞き取り中：${esc(vt.buf + vt.interim)}…</div>` : '')
    + (L && L.msg ? `<div class="ng">${L.msg}</div>` : '')
    + (L && L.phrase ? `<div class="${L.ok ? 'ok' : 'ng'}">${L.ok ? '○ 正しく入りました' : '× 違う内容が入りました'}：お題「${esc(L.phrase)}」→ 聞き取り「${esc(L.heard)}」→ ${esc(L.result)}</div>` : '');
  const n = vt.log.length, ok = vt.log.filter((l) => l.ok).length;
  $('#vtScore').textContent = n ? `○ ${ok} / ${n}（${Math.round((ok / n) * 100)}%）` : '';
  const rows = vt.log.filter((l) => !vt.onlyNG || !l.ok).map((l) => `<tr class="${l.ok ? '' : 'ngrow'}"><td class="nw">${l.ok ? '○' : '×'}</td><td>${esc(l.phrase)}</td><td>${esc(l.start)}</td><td>「${esc(l.heard)}」</td><td>${esc(l.result)}</td><td class="nw">${esc(l.time)}</td></tr>`).join('');
  $('#vtLog').innerHTML = rows
    ? `<table><thead><tr><th>判定</th><th>お題（正解）</th><th>開始位置</th><th>聞き取った言葉</th><th>入力した内容</th><th>時刻</th></tr></thead><tbody>${rows}</tbody></table>`
    : '<p class="empty">まだ記録がありません</p>';
}

/* ================= 経過（時系列のグラフ） ================= */
const TRENDS = [
  { key: 'boppct', label: 'BOP（出血）', pct: true, better: 'down', desc: '検査で歯ぐきから出血した部位の割合。少ないほど炎症が落ち着いています。' },
  { key: 'ge4pct', label: 'ポケット4mm以上', pct: true, better: 'down', desc: '歯周ポケットが4mm以上ある部位の割合。' },
  { key: 'pcr', label: 'PCR（プラーク）', pct: true, better: 'down', desc: '歯の表面にプラーク（歯垢）が付いていた割合。少ないほど磨けています。' },
  { key: 'mean', label: '平均ポケット', unit: 'mm', dec: 1, better: 'down', desc: '測ったすべての部位の、ポケットの深さの平均。' },
  { key: 'ge6', label: 'ポケット6mm以上', unit: '部位', better: 'down', desc: '歯周ポケットが6mm以上ある部位の数。' },
  { key: 'present', label: '現在歯数', unit: '本', better: 'up', desc: '残っている歯の数。' },
  { key: 'furT', label: '分岐部病変', unit: '歯', better: 'down', desc: '奥歯の根の分かれ目に病変がある歯の数。' },
];
const fmtTrend = (m, v) => (v == null ? '—' : m.pct ? `${Math.round(v)}%` : m.dec ? `${v.toFixed(m.dec)}${m.unit}` : `${v}${m.unit}`);
const SERIES = '#0d9488';
// 前回からの変化。▼▲は向き、色は良し悪し（改善＝青、悪化＝橙）。文字は本文の色のまま
function trendDelta(m, vals) {
  const pts = vals.filter((p) => p.v != null);
  if (pts.length < 2) return '';
  const a = pts[pts.length - 2].v, b = pts[pts.length - 1].v;
  const d = m.pct ? Math.round(b) - Math.round(a) : m.dec ? Math.round((b - a) * 10) / 10 : b - a;
  if (d === 0) return '<span class="tdelta"><span class="ic same">＝</span>前回と同じ</span>';
  const good = (d < 0) === (m.better === 'down');
  const amt = m.pct ? `${Math.abs(d)}ポイント` : m.dec ? `${Math.abs(d).toFixed(m.dec)}${m.unit}` : `${Math.abs(d)}${m.unit}`;
  return `<span class="tdelta"><span class="ic ${good ? 'good' : 'bad'}">${d < 0 ? '▼' : '▲'}</span>前回より${amt}${d < 0 ? '減' : '増'}（${good ? '改善' : '悪化'}）</span>`;
}
function niceMax(v) { if (v <= 4) return 4; if (v <= 5) return 5; const step = v <= 10 ? 2 : v <= 20 ? 5 : 10; return Math.ceil(v / step) * step; }
function lineChartSVG(m, vals, opt = {}) {
  const W = opt.w || 320, H = opt.h || 140, L = 34, R = 14, T = 12, B = 24;
  const pts = vals.map((p, i) => ({ ...p, i })).filter((p) => p.v != null);
  if (!pts.length) return '<p class="tempty">まだ記録がありません</p>';
  const max = m.pct ? 100 : niceMax(Math.max(...pts.map((p) => p.v)) * 1.1);
  const ticks = m.pct ? [0, 50, 100] : [0, max / 2, max];
  const tms = pts.map((p) => new Date(p.date).getTime());
  const t0 = Math.min(...tms), t1 = Math.max(...tms);
  const x = (tm) => (t1 === t0 ? (L + W - R) / 2 : L + ((tm - t0) / (t1 - t0)) * (W - L - R));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const xy = pts.map((p, j) => [x(tms[j]), y(p.v)]);
  const line = xy.map(([a, b], j) => `${j ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
  const area = xy.length > 1 ? `${line}L${xy[xy.length - 1][0].toFixed(1)},${y(0)}L${xy[0][0].toFixed(1)},${y(0)}Z` : '';
  const tl = (v) => (m.pct ? `${v}%` : Number.isInteger(v) ? v : v.toFixed(1));
  const dlab = (d) => d.slice(2).replace(/-/g, '/'); // 26/03/02
  const last = xy[xy.length - 1];
  const xlabels = pts.length === 1 ? [[last[0], pts[0].date]] : [[xy[0][0], pts[0].date], [last[0], pts[pts.length - 1].date]];
  return `<svg class="tsvg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(m.label)}の推移">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="tgrid"/><text x="${L - 6}" y="${y(v) + 3.5}" class="tax" text-anchor="end">${tl(v)}</text>`).join('')}
    ${xlabels.map(([xx, d], j) => `<text x="${xx}" y="${H - 6}" class="tax" text-anchor="${pts.length === 1 ? 'middle' : j ? 'end' : 'start'}">${dlab(d)}</text>`).join('')}
    ${area ? `<path d="${area}" fill="${SERIES}" fill-opacity="0.1"/>` : ''}
    <path d="${line}" fill="none" stroke="${SERIES}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${xy.map(([a, b]) => `<circle cx="${a}" cy="${b}" r="4" fill="${SERIES}" stroke="#fff" stroke-width="2"/>`).join('')}
    ${opt.noHover ? '' : xy.map(([a, b], j) => `<circle cx="${a}" cy="${b}" r="16" fill="transparent" data-tip="${fmtDate(pts[j].date)}　${esc(m.label)} ${fmtTrend(m, pts[j].v)}"/>`).join('')}
  </svg>`;
}
function trendCardsHTML(liveAsc, opt = {}) {
  const stats = liveAsc.map((e) => ({ date: e.date, s: calcStats(e) }));
  return TRENDS.filter((m) => !opt.keys || opt.keys.includes(m.key)).map((m) => {
    const vals = stats.map(({ date, s }) => ({ date, v: s[m.key] }));
    const latest = [...vals].reverse().find((p) => p.v != null);
    return `<div class="tcard"><div class="ttitle">${esc(m.label)}</div>
      <div class="tval">${latest ? fmtTrend(m, latest.v) : '—'}</div>${trendDelta(m, vals)}
      ${lineChartSVG(m, vals, opt)}</div>`;
  }).join('');
}
// グラフの点に触れると、日付と値を出す
document.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); });
document.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('[data-tip]')) hideTip(); });
document.addEventListener('click', (e) => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); });
function showTip(el) {
  let tip = $('#tip');
  if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; document.body.appendChild(tip); }
  tip.textContent = el.dataset.tip;
  const r = el.getBoundingClientRect();
  tip.style.left = `${Math.min(window.innerWidth - 10, Math.max(10, r.left + r.width / 2))}px`;
  tip.style.top = `${r.top - 8}px`;
  tip.hidden = false;
}
function hideTip() { const tip = $('#tip'); if (tip) tip.hidden = true; }

/* ================= 印刷 ================= */
function printHTML(p, ex) {
  const age = ageAt(p.birth, ex.date);
  return `<div class="pr-head"><div class="pr-title">歯周組織検査（ペリオチャート）</div><div class="pr-clinic">${esc(settings.clinicName)}</div></div>
    <table class="pr-info">
      <tr><th>氏名</th><td>${esc(p.name)} 様</td><th>ふりがな</th><td>${esc(p.kana || '')}</td><th>カルテ番号</th><td>${esc(p.chartNo || '')}</td></tr>
      <tr><th>生年月日</th><td>${p.birth ? `${fmtDate(p.birth)}（${age}歳）` : ''}</td><th>検査日</th><td>${fmtDate(ex.date)}</td><th>検査者</th><td>${esc(ex.examiner || '')}</td></tr>
    </table>
    ${chartHTML(ex, { print: true })}
    <div class="pr-stats">${statsHTML(calcStats(ex))}</div>
    <div class="pr-legend"><span><i class="lg bop"></i>出血（BOP）</span><span><i class="lg pus"></i>排膿</span>
      <span><i class="lg p4"></i>PPD 4〜5mm</span><span><i class="lg p6"></i>PPD 6mm以上</span>
      <span><i class="lg fu"></i>根分岐部病変（Lindhe分類 Ⅰ〜Ⅲ度）</span><span><i class="lg pl"></i>プラーク付着</span>
      <span>動揺度 0〜3</span><span>斜線：欠損歯</span></div>`;
}
function setPage(orientation) {
  let st = $('#pagestyle');
  if (!st) { st = document.createElement('style'); st.id = 'pagestyle'; document.head.appendChild(st); }
  st.textContent = `@media print { @page { size: A4 ${orientation}; margin: ${orientation === 'portrait' ? '10mm 11mm' : '8mm 9mm'}; } }`;
}
async function printExam(p, ex) {
  setPage('landscape');
  document.body.classList.remove('pr-portrait');
  $('#print').innerHTML = printHTML(p, ex);
  setTimeout(() => window.print(), 50);
}
// 患者さん説明用（A4縦）：前回との比較表・推移グラフ・前回との差つきのチャート・コメント欄
function trendSheetHTML(p, liveAsc) {
  const cur = liveAsc[liveAsc.length - 1], prev = liveAsc.length > 1 ? liveAsc[liveAsc.length - 2] : null;
  const sc = calcStats(cur), sp = prev ? calcStats(prev) : null;
  const rows = TRENDS.map((m) => {
    const vals = liveAsc.map((e) => ({ date: e.date, v: calcStats(e)[m.key] }));
    return `<tr><th>${esc(m.label)}</th><td>${sp ? fmtTrend(m, sp[m.key]) : '—'}</td><td class="now">${fmtTrend(m, sc[m.key])}</td><td>${trendDelta(m, vals) || '—'}</td><td class="desc">${esc(m.desc)}</td></tr>`;
  }).join('');
  const dc = diffCounts(cur, prev);
  return `<div class="pr-head"><div class="pr-title">歯周病検査の結果と経過</div><div class="pr-clinic">${esc(settings.clinicName)}</div></div>
    <div class="ts-who"><b>${esc(p.name)}</b> 様　　今回の検査：${fmtDate(cur.date)}${prev ? `　　前回：${fmtDate(prev.date)}` : ''}　　検査の回数：${liveAsc.length}回</div>
    <table class="ts-table"><thead><tr><th>項目</th><th>前回</th><th>今回</th><th>変化</th><th>見かた</th></tr></thead><tbody>${rows}</tbody></table>
    ${liveAsc.length > 1 ? `<div class="ts-charts">${trendCardsHTML(liveAsc, { keys: ['boppct', 'ge4pct', 'pcr', 'mean'], noHover: true, w: 240, h: 120 })}</div>` : ''}
    <div class="ts-sub">今回のチャート${prev ? `（前回より${DIFF_MIN}mm以上変わった部位に印：<i class="dif dn">−</i>浅くなった ${dc.better}部位／<i class="dif up">+</i>深くなった ${dc.worse}部位）` : ''}</div>
    ${chartHTML(cur, { print: true, prev })}
    <div class="ts-comment"><div>担当者より</div></div>`;
}
function printTrend(p, liveAsc) {
  setPage('portrait');
  document.body.classList.add('pr-portrait');
  $('#print').innerHTML = trendSheetHTML(p, liveAsc);
  setTimeout(() => window.print(), 50);
}

/* ================= 設定：音声の案内 ================= */
const GUIDE_ITEMS = [
  ['知らせ', [['fail', '聞き取れなかったとき', '警告音＋「6番、部位をもう一度」'], ['area', 'エリアが変わったとき（出血）', 'チャイム（声なし。聞き取りは止めない）'], ['start', '始めたとき・モードを替えたとき', 'チャイム＋「出血モード、右上頬側から」']]],
  ['ポケットの道案内', [['boundary', '区切り', 'エリアの最後まで入ったらチャイム＋確定し、「次、左上頬側。1番」'], ['tooth', '歯の番号', '話している最中は次の歯に移るたびに「ポッ」、話し終えたら「5番」'], ['missing', '欠損歯を飛ばすとき', '「7番は欠損、6番へ」'], ['done', '全部位の入力完了', 'チャイム＋「全部位、入力しました」']]],
  ['確認', [['echo', '入れた内容の復唱', '「3、3、4」「7番 遠心 近心」（ポケットは数字が6個以下のとき）。そのぶん待ち時間が増えます'], ['okBeep', '正しく入ったときの小さな音', '入るたびに「ポッ」']]],
];
const OP_ITEMS = [['where', '「今どこ？」に答える', '「右上5、頬側、遠心です」'], ['modeVoice', '声でモード切り替え', '「出血モード」「ポケットモード」と言って切り替え'],
  ['foot', 'フットスイッチ（キー操作）', 'Bluetoothのページめくり用スイッチなど。→・スペースで聞き取りの開始／停止、←で直前の音声入力を取り消し']];
function guideSettingsHTML() {
  const g = settings.guide;
  const sw = ([k, l, d], dis) => `<label class="sw${dis ? ' dis' : ''}"><input type="checkbox" data-g="${k}" ${g[k] ? 'checked' : ''} ${dis ? 'disabled' : ''}><span><b>${l}</b><small>${d}</small></span></label>`;
  return `<section class="card"><h2>音声の案内</h2>
      <p class="sub">画面を見なくても入力できるように、声とチャイムで知らせます。音（ポッ・チャイム）の間は聞き取りを止めないので、話し続けて大丈夫です。言葉の案内（「次、左上頬側」など）の間（1〜3秒）だけ聞き取りを止めるので、案内が終わってから話してください。入力画面の「🔈 案内」で、その場だけ止めることもできます。</p>
      ${sw(['enabled', '音声の案内を使う', 'オフにすると、下の案内をすべて止めます'], false)}
      ${GUIDE_ITEMS.map(([h, list]) => `<div class="swgroup"><div class="swh">${h}</div>${list.map((it) => sw(it, !g.enabled)).join('')}</div>`).join('')}
      <div class="swgroup"><div class="swh">声の速さ</div><div class="row-tools">
        ${[['normal', 'ふつう'], ['mid', '少し速い'], ['fast', '速い']].map(([v, l]) => `<label class="mini"><input type="radio" name="grate" value="${v}" ${g.rate === v ? 'checked' : ''}> ${l}</label>`).join('')}
        <button class="btn" id="gtest">試しに聞く</button></div></div>
    </section>
    <section class="card"><h2>声・スイッチでの操作</h2>${OP_ITEMS.map((it) => sw(it, false)).join('')}
      <div class="swgroup"><div class="swh">黙ったら区切る</div>
        <p class="sub">話の途中で、この時間だけ黙ったら、そこまでの言葉を確定します（仮入力が出ないまま、まとめて入るのを防ぐ）。区切ったあとの再開に0.3〜1秒かかるので、短すぎると話し始めの言葉が抜けることがあります。</p>
        <div class="row-tools">${[[0, 'しない'], [0.7, '0.7秒'], [1, '1秒'], [1.5, '1.5秒'], [2, '2秒']].map(([v, l]) => `<label class="mini"><input type="radio" name="csil" value="${v}" ${silenceSec() === v ? 'checked' : ''}> ${l}</label>`).join('')}</div></div></section>`;
}
function bindGuideSettings() {
  document.querySelectorAll('input[name=csil]').forEach((r) => (r.onchange = () => { settings.cutSilence = Number(r.value); saveSettings(); }));
  document.querySelectorAll('[data-g]').forEach((c) => (c.onchange = async () => {
    settings.guide[c.dataset.g] = c.checked;
    await saveSettings();
    if (c.dataset.g === 'enabled') showSettings();
  }));
  document.querySelectorAll('input[name=grate]').forEach((r) => (r.onchange = () => { settings.guide.rate = r.value; saveSettings(); }));
  $('#gtest').onclick = () => { unlockAudio(); guide([{ tone: 'chime', text: '左上、頬側' }, { tone: 'buzz', text: '6番、部位をもう一度' }]); };
}

/* ================= 設定・バックアップ ================= */
async function showSettings() {
  view = { name: 'settings' };
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null;
  app().innerHTML = `
    <header class="bar"><button class="btn ghost" data-go="list">‹ 患者一覧</button><h1>設定・バックアップ</h1><div class="grow"></div></header>
    <main class="wrap stack">
      <section class="card"><h2>医院名（印刷に表示されます）</h2><input id="clinic" class="text" value="${esc(settings.clinicName)}" placeholder="例：〇〇歯科医院" autocomplete="off"></section>
      <section class="card"><h2>ポケット測定の順番</h2>
        ${Object.entries(ORDERS).map(([k, o]) => `<label class="radio"><input type="radio" name="order" value="${k}" ${settings.order === k ? 'checked' : ''}>
          <span><b>${o.label}</b><small>${o.desc}</small></span></label>`).join('')}</section>
      <section class="card"><h2>バックアップ</h2>
        <p>データはこのiPadの中だけに保存されています。故障・紛失に備えて、定期的に書き出して院内PCに保存してください。</p>
        <p class="sub">最終バックアップ：${settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleString('ja-JP') : 'まだありません'}</p>
        <div class="row-tools"><button class="btn primary" data-act="backup">バックアップを書き出す</button>
          <label class="btn">バックアップから読み込む<input type="file" id="imp" class="vh" accept="application/json,.json"></label></div>
        <p class="sub">保存領域の保護：${persisted === null ? '不明' : persisted ? '有効（ブラウザが自動で消さない設定）' : '未設定（ホーム画面に追加して使うと安定します）'}</p></section>
      ${guideSettingsHTML()}
      <section class="card"><h2>音声入力の読み上げテスト</h2><p>お題を読み上げて、正しく聞き取れるかを確かめます。結果は記録され、書き出して送れます。</p><button class="btn" id="vtOpen">読み上げテストを開く</button></section>
      <section class="card"><h2>見本データ</h2><p>動作確認用に、架空の患者「見本 太郎」と3回分の検査を追加します。</p><button class="btn" id="demo">見本データを追加</button></section>
    </main>`;
  $('#clinic').onchange = (e) => { settings.clinicName = e.target.value.trim(); saveSettings(); };
  document.querySelectorAll('input[name=order]').forEach((r) => (r.onchange = () => { settings.order = r.value; saveSettings(); }));
  $('#imp').onchange = (e) => { const f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };
  $('#vtOpen').onclick = showVoiceTest;
  bindGuideSettings();
  $('#demo').onclick = async () => {
    const { patient, exams } = makeDemo();
    await DB.put('patients', patient);
    for (const ex of exams) await DB.put('exams', ex);
    showPatient(patient.id);
  };
}

// iPadは共有シート（AirDropなど）、Macはダウンロードフォルダへ
async function saveFile(file, title) {
  if (navigator.maxTouchPoints > 0 && navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title });
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`; };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
async function exportCSV(name, title, header, rows) {
  const text = '\ufeff' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  try { await saveFile(new File([text], name, { type: 'text/csv' }), title); } catch (err) {
    if (err && err.name === 'AbortError') return;
    await notify('書き出せませんでした：' + err);
  }
}

async function exportBackup() {
  const data = { app: 'perio-chart', version: 1, exportedAt: new Date().toISOString(), patients: await DB.all('patients'), exams: await DB.all('exams'), settings };
  const d = new Date();
  const name = `perio-backup-${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}.json`;
  const file = new File([JSON.stringify(data)], name, { type: 'application/json' });
  try {
    await saveFile(file, 'ペリオチャートのバックアップ');
  } catch (err) {
    if (err && err.name === 'AbortError') return; // 共有シートを閉じた
    await notify('バックアップを書き出せませんでした：' + err);
    return;
  }
  settings.lastBackupAt = Date.now();
  await saveSettings();
  if ($('#imp')) showSettings();
  else if ($('.banner')) $('.banner').remove();
}

async function importBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { await notify('ファイルを読み込めませんでした。'); return; }
  if (!data || data.app !== 'perio-chart') { await notify('このアプリのバックアップファイルではありません。'); return; }
  if (!(await askConfirm(`患者 ${data.patients.length}名・検査 ${data.exams.length}件 を読み込みます。\n今あるデータは消えず、同じ記録は新しいほうが残ります。`, '読み込む'))) return;
  let np = 0, ne = 0;
  for (const [store, rows] of [['patients', data.patients], ['exams', data.exams]]) {
    for (const r of rows) {
      const cur = await DB.get(store, r.id);
      if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) {
        await DB.put(store, r);
        if (store === 'patients') np++; else ne++;
      }
    }
  }
  if (!settings.clinicName && data.settings && data.settings.clinicName) { settings.clinicName = data.settings.clinicName; await saveSettings(); }
  await notify(`読み込みました（患者 ${np}件・検査 ${ne}件を追加・更新）`);
  showSettings();
}

/* ================= 見本データ ================= */
function makeDemo() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const patient = { id: uid(), chartNo: '9999', name: '見本 太郎', kana: 'みほん たろう', birth: '1968-04-12', note: '動作確認用の架空の患者', createdAt: Date.now(), updatedAt: Date.now() };
  const missing = [18, 28, 38, 48, 36];
  const base = {};
  for (const t of ALL) {
    base[t] = {};
    for (const k of SITES) {
      let v = 2 + Math.floor(rnd() * 2);
      if (isMolar(t) && rnd() < 0.5) v += 2 + Math.floor(rnd() * 3);
      if (t % 10 <= 3 && rnd() < 0.15) v += 2;
      base[t][k] = v;
    }
  }
  const furBase = { 16: { b: 2, dp: 1 }, 17: { mp: 1 }, 26: { b: 1 }, 46: { b: 2, l: 1 }, 37: { b: 1 } };
  const dates = ['2026-03-02', '2026-06-15', '2026-09-28'];
  const exams = dates.map((date, i) => {
    const ex = newExam(patient.id, date, '歯科衛生士A', null);
    ex.createdAt = Date.now() + i;
    for (const t of ALL) {
      const th = ex.teeth[t];
      if (missing.includes(t)) { th.missing = true; continue; }
      for (const k of SITES) {
        const b = base[t][k];
        const v = Math.max(1, b - (b >= 4 ? i : 0) - (rnd() < 0.2 ? 1 : 0));
        th.ppd[k] = v;
        if (rnd() < (v >= 4 ? 0.6 : 0.12) * (1 - i * 0.25)) th.bop[k] = true;
        if (v >= 6 && i === 0 && rnd() < 0.3) th.pus[k] = true;
      }
      th.mob = isMolar(t) && base[t].bc >= 5 && i < 2 ? 1 : 0;
      for (const s of PL) if (rnd() < 0.55 - i * 0.15) th.pl[s] = true;
      if (isMolar(t)) for (const f of furcKeys(t)) th.fur[f] = (furBase[t] && furBase[t][f]) || 0;
    }
    ex.updatedAt = Date.now();
    return ex;
  });
  return { patient, exams };
}

/* ================= 紙のチャートから取り込み ================= */
// 当院の紙（精密・再評価検査）：1枚に検査が最大5回分。1歯につき頬側2点・口蓋（舌）側2点のポケットと、動揺度1つ。
// 斜線＝欠損、「C4」＝残根（欠損として取り込む）、［ ］＝ブリッジ（ポンティックは欠損、上の数字は支台歯の動揺度）。赤丸（BOP）は取り込まない。
// 下書きは settings ストアに 'paper:ID' で保存する：
//   { key, id, createdAt, updatedAt, chartNo, photo(Blob), source('ai'|'file'|'manual'), doneAt, patientId,
//     exams: [{ dateText, date, teeth: { [歯]: { st:'ok'|'miss'|'c4', mob, b:[左,中,右], l:[左,中,右] } }, unsure: { '17:b0': true } }] }
// b＝頬側の段、l＝上顎は口蓋の段・下顎は舌側の段。紙の1歯は点線で3マス。ふだんは両端（遠心・近心）に書き、深いときは真ん中（中央）にも書く。
// [左,中,右] は紙の左→右の順（アプリの表示と同じ向き）
const PAPER_ROWS_UP = [['mob', '動揺度'], ['b', '頬側'], ['l', '口蓋']];
const PAPER_ROWS_LO = [['l', '舌側'], ['b', '頬側'], ['mob', '動揺度']];
// 入力の順番（紙を上から読む順）：上顎 動揺度→頬側→口蓋、下顎 舌側→頬側→動揺度
const PAPER_ORDER = [['U', 'mob'], ['U', 'b'], ['U', 'l'], ['L', 'l'], ['L', 'b'], ['L', 'mob']];
const paperBlankTooth = () => ({ st: 'ok', mob: null, b: [null, null, null], l: [null, null, null] });
function paperBlankExam() {
  const teeth = {};
  for (const t of ALL) teeth[t] = paperBlankTooth();
  return { dateText: '', date: '', teeth, unsure: {} };
}
// 和暦「R7.4.9」「R.8.4.24」→ 2025-04-09（令和N年＝2018＋N年）
function reiwaToISO(text) {
  const m = String(text || '').normalize('NFKC').match(/(\d{1,2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  const y = 2018 + Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}
// 読み込んだ形（AI・ファイル）を、下書きの形にそろえる
function paperNormalizeExam(x) {
  const e = paperBlankExam();
  e.dateText = String(x.dateText || x.date_text || '');
  e.date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : reiwaToISO(e.dateText);
  const src = x.teeth || {};
  const list = Array.isArray(src) ? src : Object.entries(src).map(([t, v]) => ({ ...v, tooth: t }));
  const num = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
  for (const v of list) {
    const t = Number(v.tooth);
    if (!e.teeth[t]) continue;
    const st = v.st || ({ present: 'ok', missing: 'miss', c4: 'c4' })[v.status] || 'ok';
    // 2つ＝[左,右]、3つ＝[左,中,右]
    const trio = (a) => (!Array.isArray(a) ? [null, null, null] : a.length >= 3 ? [num(a[0], 15), num(a[1], 15), num(a[2], 15)] : [num(a[0], 15), null, num(a[1], 15)]);
    const rb = v.b || v.buccal, rl = v.l || v.lingual;
    e.teeth[t] = { st: ['ok', 'miss', 'c4'].includes(st) ? st : 'ok', mob: num(v.mob ?? v.mobility, 3), b: trio(rb), l: trio(rl) };
    e.len = e.len || {};
    e.len[t] = { b: Array.isArray(rb) ? rb.length : 2, l: Array.isArray(rl) ? rl.length : 2 };
    for (const u of v.unsure || []) e.unsure[`${t}:${{ buccal_left: 'b0', buccal_center: 'b1', buccal_right: 'b2', lingual_left: 'l0', lingual_center: 'l1', lingual_right: 'l2', mobility: 'mob', status: 'st' }[u] || u}`] = true;
  }
  // ファイルの「歯:b1」は、その歯の値が2つなら右、3つなら真ん中
  for (const u of x.unsure || []) {
    if (typeof u !== 'string') continue;
    const m = u.match(/^(\d+):([bl])([01])$/);
    if (m && m[3] === '1' && (!e.len || !e.len[m[1]] || e.len[m[1]][m[2]] < 3)) e.unsure[`${m[1]}:${m[2]}2`] = true;
    else e.unsure[u] = true;
  }
  delete e.len;
  return e;
}
const paperDrafts = async () => (await DB.all('settings')).filter((r) => String(r.key).startsWith('paper:')).sort((a, b) => b.createdAt - a.createdAt);
const savePaper = (d) => { d.updatedAt = Date.now(); return DB.put('settings', d); };
function newPaperDraft(fields = {}) {
  const id = uid();
  return { key: `paper:${id}`, id, createdAt: Date.now(), updatedAt: Date.now(), chartNo: '', photo: null, source: 'manual', doneAt: null, patientId: null, exams: [paperBlankExam()], ...fields };
}
// 写真は長い辺 2576px までに縮めて保存する（AIで読める最大の大きさ。iPadの写真はそのままだと大きすぎる）
async function shrinkPhoto(file, max = 2576) {
  const bmp = await createImageBitmap(file);
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
}

// ---- 取り込みの一覧 ----
async function showPaperList() {
  view = { name: 'paper' };
  const drafts = await paperDrafts();
  const row = (d) => {
    const n = d.exams.length, uns = d.exams.reduce((s, e) => s + Object.keys(e.unsure || {}).length, 0);
    return `<button class="prow" data-draft="${d.id}">
      ${d.photo ? '<span class="avatar">📷</span>' : '<span class="avatar">📄</span>'}
      <span class="pname">${d.chartNo ? `No.${esc(d.chartNo)}` : 'カルテ番号 未入力'}<small>${n}回分・${{ ai: 'AIで読み取り', file: 'ファイルから', manual: '手で入力' }[d.source] || ''}・${new Date(d.createdAt).toLocaleDateString('ja-JP')}</small></span>
      <span class="pkeys">${d.doneAt ? '<span class="kchip ok">登録済み</span>' : uns ? `<span class="kchip warn">要確認 ${uns}か所</span>` : '<span class="kchip">確認中</span>'}</span>
      <span class="chev">›</span></button>`;
  };
  app().innerHTML = `
    <header class="bar"><button class="btn ghost" data-go="list">‹ 患者一覧</button><h1>紙のチャートから取り込み</h1><div class="grow"></div></header>
    <main class="wrap stack">
      <section class="card">
        <h2>新しく取り込む</h2>
        <p class="sub">紙のチャート1枚（検査5回分まで）を撮影して、紙と同じ並びの表で確かめてから登録します。登録すると、カルテ番号の患者に検査が追加されます（いない患者は「No.番号」の名前で新しく作ります）。</p>
        <div class="row-tools">
          <label class="btn primary big">📷 撮影する・写真を選ぶ<input type="file" id="pphoto" class="vh" accept="image/*" capture="environment"></label>
          <label class="btn">読み取り済みのファイルを読み込む<input type="file" id="pfile" class="vh" accept="application/json,.json,text/plain,.txt"></label>
          <button class="btn" id="ppaste">貼り付けで読み込む</button>
        </div>
        <p class="sub">数字は、写真を見ながら表に入力するか、Claude Code で写真から読み取ったファイルを読み込んでから、写真と見比べて直します。</p>
      </section>
      <section class="card list">${drafts.length ? drafts.map(row).join('') : '<p class="empty">まだ取り込み中のものはありません</p>'}</section>
    </main>`;
  $('#pphoto').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const photo = await shrinkPhoto(f);
    const d = newPaperDraft({ photo });
    await savePaper(d);
    await showPaperDraft(d.id);
  };
  $('#pfile').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) await importPaperFile(f);
  };
  $('main').onclick = (e) => { const b = e.target.closest('[data-draft]'); if (b) showPaperDraft(b.dataset.draft); };
  // ファイルを渡せないとき：読み取った内容（文字）をコピーして、ここに貼り付ける
  $('#ppaste').onclick = () => {
    openDialog(`<div class="dlg-body"><h2>貼り付けで読み込む</h2>
      <p class="sub">読み取った内容（{"kind":"perio-paper" で始まる文字）をコピーして、下の欄に貼り付けてください。</p>
      <textarea id="ptext" class="text" rows="8" placeholder="ここを長押し →「ペースト」" style="font-family:monospace;font-size:13px"></textarea>
      <div class="dlg-actions"><button class="btn" data-close>キャンセル</button><button class="btn primary" id="ptextok">読み込む</button></div></div>`, true);
    $('#ptextok').onclick = async () => {
      const t = $('#ptext').value.trim();
      if (!t) return;
      closeDialog();
      await importPaperFile(new File([t], 'paste.txt', { type: 'text/plain' }));
    };
  };
}
// Claude Code などで読み取ったファイル（1枚分、または sheets に複数枚）を下書きにする
async function importPaperFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { await notify('ファイルを読み込めませんでした。'); return; }
  const sheets = data && data.kind === 'perio-paper' ? (data.sheets || [data]) : null;
  if (!sheets) { await notify('紙のチャートの読み取りファイルではありません。'); return; }
  let first = null;
  for (const s of sheets) {
    const d = newPaperDraft({ chartNo: String(s.chartNo || ''), source: 'file', exams: (s.exams || []).map(paperNormalizeExam) });
    if (!d.exams.length) d.exams = [paperBlankExam()];
    await savePaper(d);
    first ||= d;
  }
  await notify(`${sheets.length}枚分を読み込みました。写真と見比べて確かめてから登録してください。`);
  if (sheets.length === 1) showPaperDraft(first.id); else showPaperList();
}

// ---- 確認・修正の画面 ----
const pd = { draft: null, ei: 0, sel: null, zoom: 1, url: null };
async function showPaperDraft(id) {
  const d = await DB.get('settings', `paper:${id}`);
  if (!d) return showPaperList();
  view = { name: 'paperdraft', id };
  if (pd.url) URL.revokeObjectURL(pd.url);
  Object.assign(pd, { draft: d, ei: 0, sel: null, url: d.photo ? URL.createObjectURL(d.photo) : null });
  app().innerHTML = `
    <header class="bar"><button class="btn ghost" id="pback">‹ 取り込み一覧</button>
      <label class="hfield">カルテ番号 No.<input id="pno" value="${esc(d.chartNo)}" inputmode="numeric" autocomplete="off" placeholder="例：3927"></label>
      <span class="sub" id="pmatch"></span><div class="grow"></div>
      <label class="btn">${d.photo ? '写真を差し替え' : '📷 写真を付ける'}<input type="file" id="pphoto2" class="vh" accept="image/*" capture="environment"></label>
      <button class="btn danger" id="pdel">削除</button>
      <button class="btn primary" id="preg">${d.doneAt ? '登録済み' : '登録する'}</button></header>
    <div class="paperwrap">
      ${pd.url ? `<div class="pphoto" id="pph"><img src="${pd.url}" alt="紙のチャートの写真" id="pimg"></div>
        <div class="pzoom"><button class="tool" data-zoom="-1">－</button><button class="tool" data-zoom="0">全体</button><button class="tool" data-zoom="1">＋</button><span class="sub">写真は指で動かせます。紙と見比べて、黄色の数字（自信がない所）から確かめてください</span></div>` : '<p class="sub pnophoto">写真がありません。「📷 写真を付ける」で付けると、見比べながら確かめられます。</p>'}
      <div class="ptabs" id="ptabs"></div>
      <div id="pgrid"></div>
      <div class="pad ppad" id="ppad"></div>
    </div>`;
  $('#pback').onclick = () => showPaperList();
  $('#pno').oninput = (e) => { d.chartNo = e.target.value.trim(); savePaper(d); paperMatch(); };
  $('#pdel').onclick = async () => {
    if (!(await askConfirm('この取り込みを削除しますか？（登録済みの検査は消えません）', '削除する', true))) return;
    await DB.req(DB.store('settings', 'readwrite').delete(d.key));
    showPaperList();
  };
  $('#preg').onclick = () => paperRegister();
  $('#pphoto2').onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    d.photo = await shrinkPhoto(f);
    await savePaper(d);
    showPaperDraft(d.id);
  };
  document.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => {
    const z = Number(b.dataset.zoom);
    pd.zoom = z === 0 ? 1 : Math.max(1, Math.min(5, pd.zoom + z * 0.75));
    $('#pimg').style.width = `${pd.zoom * 100}%`;
  }));
  paperMatch();
  paperRender();
  if ($('#pimg')) $('#pimg').onload = () => paperFocusPhoto();
}
async function paperMatch() {
  const no = pd.draft.chartNo, el = $('#pmatch');
  if (!el) return;
  if (!no) { el.textContent = ''; return; }
  const p = (await DB.all('patients')).find((x) => (x.chartNo || '').trim() === no);
  el.innerHTML = p ? `→ ${esc(p.name)} 様に追加` : '→ 新しい患者「No.' + esc(no) + '」として登録';
}
// 写真を、今の回（・選んだ歯）のあたりへ動かす。紙の書式の大まかな位置から（1枚に5回分、表は横幅の約2割〜9.6割）
function paperFocusPhoto() {
  const box = $('#pph'), img = $('#pimg');
  if (!box || !img || !img.naturalHeight) return;
  if (pd.zoom < 1.6) { pd.zoom = 1.6; img.style.width = '160%'; }
  const h = img.clientHeight, w = img.clientWidth;
  const top = h * (0.04 + pd.ei * 0.18 + (pd.sel && pd.sel.t > 30 ? 0.085 : 0)) - 6; // 下顎を選んだら、その回の下半分へ
  box.scrollTop = Math.max(0, top);
  if (pd.sel) {
    const row = (pd.sel.t > 30 ? LOWER : UPPER).indexOf(pd.sel.t);
    const x = w * (0.22 + (row + 0.5) * (0.68 / 16));
    box.scrollLeft = Math.max(0, x - box.clientWidth / 2);
  }
}
function paperRender() {
  const d = pd.draft, e = d.exams[pd.ei];
  $('#ptabs').innerHTML = d.exams.map((x, i) => {
    const u = Object.keys(x.unsure || {}).length;
    return `<button class="seg${i === pd.ei ? ' on' : ''}" data-ei="${i}">${i + 1}回目 ${esc(x.dateText || (x.date ? fmtDate(x.date) : '日付なし'))}${u ? ` <i class="ubadge">${u}</i>` : ''}</button>`;
  }).join('') + `<button class="seg add" data-ei="add">＋ 回を追加</button>
    <span class="pdate">検査日 <input type="date" id="pdatein" value="${esc(e.date)}"> <input id="pdtext" value="${esc(e.dateText)}" placeholder="紙の日付（R7.4.9）" autocomplete="off"></span>
    ${d.exams.length > 1 ? '<button class="tool undo" id="pdelex">この回を削除</button>' : ''}`;
  $('#ptabs').querySelector('.seg.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  $('#pgrid').innerHTML = paperGridHTML(e);
  $('#ppad').innerHTML = paperPadHTML();
  $('#ptabs').onclick = (ev) => {
    const b = ev.target.closest('[data-ei]');
    if (!b) return;
    if (b.dataset.ei === 'add') { d.exams.push(paperBlankExam()); pd.ei = d.exams.length - 1; } else pd.ei = Number(b.dataset.ei);
    pd.sel = null; savePaper(d); paperRender(); paperFocusPhoto();
  };
  $('#pdatein').onchange = (ev) => { e.date = ev.target.value; savePaper(d); };
  $('#pdtext').onchange = (ev) => { e.dateText = ev.target.value.trim(); if (!e.date) { e.date = reiwaToISO(e.dateText); $('#pdatein').value = e.date; } savePaper(d); paperRender(); };
  if ($('#pdelex')) $('#pdelex').onclick = async () => {
    if (!(await askConfirm(`${pd.ei + 1}回目を削除しますか？`, '削除する', true))) return;
    d.exams.splice(pd.ei, 1); pd.ei = Math.max(0, pd.ei - 1); pd.sel = null; savePaper(d); paperRender();
  };
  $('#pgrid').onclick = (ev) => {
    const st = ev.target.closest('[data-pst]');
    if (st) { paperCycleStatus(Number(st.dataset.pst)); return; }
    const c = ev.target.closest('[data-pc]');
    if (!c) return;
    const [t, r, i] = c.dataset.pc.split(':');
    pd.sel = { t: Number(t), r, i: Number(i || 0) };
    paperRender(); paperFocusPhoto();
  };
  $('#ppad').onclick = (ev) => { const b = ev.target.closest('[data-pk]'); if (b) paperKey(b.dataset.pk); };
}
const paperCellKey = (t, r, i) => (r === 'mob' ? `${t}:mob` : `${t}:${r}${i}`);
function paperGridHTML(e) {
  const jaw = (teeth, rows, up) => {
    const head = `<tr class="pnum"><th></th>${teeth.map((t) => {
      const s = e.teeth[t].st;
      return `<th colspan="3" class="${s !== 'ok' ? 'gone' : ''}${e.unsure[`${t}:st`] ? ' unsure' : ''}${isMid(t) ? ' mid' : ''}" data-pst="${t}">${t % 10}${s === 'miss' ? '<small>欠損</small>' : s === 'c4' ? '<small>C4</small>' : ''}</th>`;
    }).join('')}</tr>`;
    const body = rows.map(([r, label]) => `<tr class="prow-${r}"><th>${label}</th>${teeth.map((t) => {
      const th = e.teeth[t], gone = th.st !== 'ok';
      const cell = (i) => {
        const k = paperCellKey(t, r, i), v = r === 'mob' ? th.mob : th[r][i];
        const on = pd.sel && pd.sel.t === t && pd.sel.r === r && (r === 'mob' || pd.sel.i === i);
        return `<td ${r === 'mob' ? 'colspan="3" ' : ''}class="pc${i === 1 ? ' ctr' : ''}${on ? ' on' : ''}${e.unsure[k] ? ' unsure' : ''}${gone ? ' gone' : ''}${v >= 4 && r !== 'mob' ? (v >= 6 ? ' p6' : ' p4') : ''}${isMid(t) && (r === 'mob' || i === 0) ? ' mid' : ''}" data-pc="${t}:${r}:${i}">${gone ? '' : v ?? ''}</td>`;
      };
      return r === 'mob' ? cell(0) : cell(0) + cell(1) + cell(2);
    }).join('')}</tr>`).join('');
    const cols = `<colgroup><col class="lab">${teeth.map(() => '<col class="side"><col class="ctr"><col class="side">').join('')}</colgroup>`;
    return `<table class="pgrid ${up ? 'up' : 'lo'}">${cols}${up ? body + head : head + body}</table>`;
  };
  return jaw(UPPER, PAPER_ROWS_UP, true) + jaw(LOWER, PAPER_ROWS_LO, false);
}
function paperPadHTML() {
  const s = pd.sel, e = pd.draft.exams[pd.ei];
  if (!s) return '<p class="sub phint">表の数字を押すと、ここで入力・修正できます。歯の番号を押すと「歯あり → 欠損 → C4」が切り替わります。</p>';
  const th = e.teeth[s.t];
  const where = `${toothName(s.t)} ${s.r === 'mob' ? '動揺度' : `${sideName(s.t, s.r)}の${['左', '真ん中', '右'][s.i]}`}`;
  const nums = s.r === 'mob' ? [0, 1, 2, 3] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return `<div class="pwhere">入力中：<b>${where}</b>${th.st !== 'ok' ? `<span class="sub">（${th.st === 'c4' ? 'C4' : '欠損'}の歯です）</span>` : ''}</div>
    <div class="keys ${s.r === 'mob' ? 'n4' : 'n12'}">${nums.map((n) => `<button class="key${s.r !== 'mob' && n >= 6 ? ' hi6' : s.r !== 'mob' && n >= 4 ? ' hi4' : ''}" data-pk="${n}">${n}</button>`).join('')}</div>
    <div class="row-tools"><button class="tool" data-pk="prev">◀ 戻る</button><button class="tool" data-pk="next">進む ▶</button><button class="tool" data-pk="clear">空欄に</button><button class="tool" data-pk="ok">この値で正しい（黄色を消す）</button></div>`;
}
// 次の入力欄（紙を読む順：同じ段を左→右、段の終わりで次の段へ。欠損の歯は飛ばす）
function paperStep(dir) {
  const e = pd.draft.exams[pd.ei], cells = [];
  for (const [j, r] of PAPER_ORDER) for (const t of j === 'U' ? UPPER : LOWER) {
    if (e.teeth[t].st !== 'ok') continue;
    if (r === 'mob') cells.push({ t, r, i: 0 }); else cells.push({ t, r, i: 0 }, { t, r, i: 2 }); // 真ん中は飛ばす（書いてあるときだけ押して入れる）
  }
  const s = pd.sel;
  if (s.i === 1) { pd.sel = { ...s, i: dir > 0 ? 2 : 0 }; return; } // 真ん中から：その歯の右（次）／左（前）へ
  const at = cells.findIndex((c) => c.t === s.t && c.r === s.r && c.i === s.i);
  const n = cells[at + dir];
  if (n) pd.sel = n;
}
function paperKey(k) {
  const d = pd.draft, e = d.exams[pd.ei], s = pd.sel;
  if (!s) return;
  const th = e.teeth[s.t], key = paperCellKey(s.t, s.r, s.i);
  if (k === 'prev' || k === 'next') paperStep(k === 'next' ? 1 : -1);
  else if (k === 'ok') delete e.unsure[key];
  else if (k === 'clear') { if (s.r === 'mob') th.mob = null; else th[s.r][s.i] = null; delete e.unsure[key]; }
  else {
    const v = Number(k);
    if (th.st !== 'ok') th.st = 'ok';
    if (s.r === 'mob') th.mob = v; else th[s.r][s.i] = v;
    delete e.unsure[key];
    paperStep(1);
  }
  savePaper(d);
  paperRender();
}
function paperCycleStatus(t) {
  const d = pd.draft, e = d.exams[pd.ei], th = e.teeth[t];
  th.st = { ok: 'miss', miss: 'c4', c4: 'ok' }[th.st];
  delete e.unsure[`${t}:st`];
  savePaper(d);
  paperRender();
}

// ---- 登録：下書き → 患者・検査 ----
// 紙の2点（遠心・近心）をアプリの6点に入れる。中央は2点の小さい方（2026-10-13 龍太郎の指定）
function paperToExam(x, patientId) {
  const ex = newExam(patientId, x.date, '', null);
  for (const t of ALL) {
    const p = x.teeth[t], th = ex.teeth[t];
    if (!p || p.st !== 'ok') { th.missing = true; continue; }
    th.mob = p.mob ?? null;
    for (const side of ['b', 'l']) {
      const [a, mid, b] = p[side];
      const [dist, mes] = isPtRight(t) ? [a, b] : [b, a]; // 紙で左側の歯（患者の右）は左が遠心
      if (dist != null) th.ppd[side + 'd'] = dist;
      if (mes != null) th.ppd[side + 'm'] = mes;
      // 中央：真ん中に書いてあればその値。なければ2点の小さい方
      const c = mid != null ? mid : dist != null && mes != null ? Math.min(dist, mes) : dist ?? mes;
      if (c != null) th.ppd[side + 'c'] = c;
    }
  }
  ex.note = `紙のチャートから取り込み（${x.dateText || x.date}）`;
  ex.source = 'paper';
  return ex;
}
const paperHasData = (x) => ALL.some((t) => { const p = x.teeth[t]; return p.st === 'ok' && (p.mob != null || [...p.b, ...p.l].some((v) => v != null)); });
async function paperRegister() {
  const d = pd.draft;
  if (!d.chartNo) { await notify('カルテ番号を入れてください。'); $('#pno').focus(); return; }
  const patients = await DB.all('patients');
  let p = patients.find((x) => (x.chartNo || '').trim() === d.chartNo);
  const existing = p ? (await DB.byPatient(p.id)).filter((e) => !e.deletedAt) : [];
  const plan = d.exams.map((x, i) => {
    const why = !x.date ? '検査日がない' : !paperHasData(x) ? '数字がない' : existing.some((e) => e.date === x.date) ? 'この日の検査がすでにある' : '';
    return { x, i, why };
  });
  const ok = plan.filter((r) => !r.why);
  const uns = ok.reduce((s, r) => s + Object.keys(r.x.unsure || {}).length, 0);
  if (!ok.length) { await notify(`登録できる回がありません。\n${plan.map((r) => `${r.i + 1}回目：${r.why}`).join('\n')}`); return; }
  const msg = `${p ? `${p.name} 様（No.${d.chartNo}）` : `新しい患者「No.${d.chartNo}」`}に、検査を${ok.length}回分登録します。\n`
    + plan.map((r) => `・${r.i + 1}回目 ${r.x.date ? fmtDate(r.x.date) : '日付なし'}${r.why ? `：登録しない（${r.why}）` : ''}`).join('\n')
    + (uns ? `\n\n⚠ 黄色（自信がない所）が${uns}か所残っています。紙と見比べましたか？` : '')
    + '\n\n中央の値は、紙の真ん中に書いてあればその値、なければ2点（遠心・近心）の小さい方を入れます。出血（赤丸）は取り込みません。';
  if (!(await askConfirm(msg, '登録する'))) return;
  if (!p) {
    p = { id: uid(), chartNo: d.chartNo, name: `No.${d.chartNo}`, kana: '', birth: '', note: '紙のチャートから取り込み（氏名は未入力）', createdAt: Date.now(), updatedAt: Date.now() };
    await DB.put('patients', p);
  }
  for (const r of ok) await DB.put('exams', paperToExam(r.x, p.id));
  d.doneAt = Date.now(); d.patientId = p.id;
  await savePaper(d);
  await notify(`登録しました（${ok.length}回分）。${p.name.startsWith('No.') ? '患者画面の「患者情報を編集」で氏名を入れてください。' : ''}`);
  showPatient(p.id);
}

/* ================= 新しいバージョンの確認 ================= */
// プログラムのファイルが書き換わったら、画面上部にお知らせを出す（自動では再読み込みしない）
const UPDATE_FILES = ['index.html', 'app.js', 'app.css'];
const UPDATE_INTERVAL = 20000;
let updateBase = null;
function hashText(t) { let h = 5381; for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0; return h; }
async function filesSignature() {
  const parts = await Promise.all(UPDATE_FILES.map(async (f) => {
    const r = await fetch(f, { cache: 'no-store' });
    if (!r.ok) throw new Error(f);
    return hashText(await r.text());
  }));
  return parts.join('-');
}
async function checkUpdate() {
  try {
    const sig = await filesSignature();
    if (updateBase === null) updateBase = sig;
    else if (sig !== updateBase) showUpdateBanner();
  } catch { /* オフラインなどは無視 */ }
}
function showUpdateBanner() {
  const u = $('#update');
  if (!u.hidden) return;
  u.innerHTML = '<span>新しいバージョンがあります</span><button class="btn primary" id="doUpdate">更新する</button>';
  u.hidden = false;
  $('#doUpdate').onclick = applyUpdate;
}
async function applyUpdate() {
  if (view.name === 'editor') await flushSave();
  try { sessionStorage.setItem('perio-v2-reopen', JSON.stringify({ ...view, mode: ed.mode })); } catch { /* 保存できなくても更新はする */ }
  location.reload();
}
async function reopenView() {
  let v = null;
  try { v = JSON.parse(sessionStorage.getItem('perio-v2-reopen')); sessionStorage.removeItem('perio-v2-reopen'); } catch { v = null; }
  if (v && v.name === 'editor' && (await DB.get('exams', v.examId))) {
    await openEditor(v.examId);
    if (MODES.some(([m]) => m === v.mode)) { ed.mode = v.mode; refresh(); }
  } else if (v && v.name === 'patient') await showPatient(v.pid, v.showDeleted);
  else if (v && v.name === 'settings') await showSettings();
  else if (v && v.name === 'voicetest') await showVoiceTest();
  else if (v && v.name === 'paper') await showPaperList();
  else if (v && v.name === 'paperdraft') await showPaperDraft(v.id);
  else await showList();
}

/* ================= 起動 ================= */
(async function init() {
  if (location.hash === '#print-sample') {
    // 印刷レイアウトの確認用（保存はしない）
    const { patient, exams } = makeDemo();
    settings.clinicName = '（医院名）';
    document.body.classList.add('print-sample');
    if (location.search.includes('trend')) { setPage('portrait'); document.body.classList.add('pr-portrait'); $('#print').innerHTML = trendSheetHTML(patient, exams); }
    else { setPage('landscape'); $('#print').innerHTML = printHTML(patient, exams[0]); }
    return;
  }
  try { await DB.open(); } catch (err) {
    app().innerHTML = `<p class="wrap">データベースを開けませんでした：${esc(err)}</p>`;
    return;
  }
  await loadSettings();
  const vlog = await DB.get('settings', 'voicelog');
  if (vlog && vlog.items) voice.log = vlog.items;
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await reopenView();
  checkUpdate();
  setInterval(checkUpdate, UPDATE_INTERVAL);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
})();
