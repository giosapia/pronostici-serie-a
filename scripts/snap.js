// Uso: node scripts/snap.js   (dalla radice del repository)
// Stampa per ogni partita del calendario la previsione del modello puro e i 4 punteggi più probabili.
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const data = JSON.parse(fs.readFileSync('data/dati.json', 'utf8'));
const i = html.indexOf('let MU'), j = html.indexOf('const $ = id', i);
const src = html.slice(i, j).replace(/if \(typeof module[\s\S]*$/, '');
const { TEAMS, setLeague, fit, predict } = new Function(src + '; return { TEAMS, setLeague, fit, predict };')();
const ix = n => TEAMS.findIndex(t => t.n === n);
const played = data.risultati.map(r => ({ g: r[0], h: ix(r[1]), gh: r[2], ga: r[3], a: ix(r[4]) }));
setLeague(played);
const f = fit(TEAMS.map(t => Math.log(t.a)), TEAMS.map(t => Math.log(t.d)), played, 0.25);
const out = {};
for (const c of data.calendario) {
  const h = ix(c[1]), a = ix(c[2]);
  const { mk } = predict(f.att, f.def, h, a), t = mk.top[0], r = (x, d) => +x.toFixed(d);
  out[c[0] + '_' + c[1] + '_' + c[2]] = { g: c[0], h: c[1], a: c[2], when: c[3],
    mod: { p1: r(mk.p1, 4), pX: r(mk.pX, 4), p2: r(mk.p2, 4), lh: r(mk.lh, 3), la: r(mk.la, 3), o25: r(mk.over[2.5], 4), gg: r(mk.btts, 4), tx: t.x, ty: t.y, tp: r(t.p, 4) },
    top: mk.top.slice(0, 4).map(s => `${s.x}-${s.y} ${(s.p * 100).toFixed(1)}%`) };
}
console.log(JSON.stringify(out, null, 1));
