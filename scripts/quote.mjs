// Scarica le quote da OddsPapi. La chiave arriva dal segreto ODDSPAPI_KEY e non viene mai scritta nei file.
import fs from 'node:fs';

const KEY = process.env.ODDSPAPI_KEY;
const MODE = process.env.MODE || 'discover';
if (!KEY) { console.error('Manca il segreto ODDSPAPI_KEY'); process.exit(1); }
const BASE = 'https://api.oddspapi.io/v4';
let richieste = 0;

async function get(path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', KEY);
  richieste++;
  const r = await fetch(u);
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = t.slice(0, 500); }
  console.log(`GET ${path} ${JSON.stringify(params)} -> ${r.status}`);
  return { status: r.status, body };
}
const save = (name, obj) => { fs.mkdirSync('data/discovery', { recursive: true }); fs.writeFileSync(`data/discovery/${name}.json`, JSON.stringify(obj, null, 1)); };
const arr = b => Array.isArray(b) ? b : (b && typeof b === 'object' ? Object.values(b).find(Array.isArray) || [] : []);

if (MODE === 'discover') {
  const out = { richiesteUsate: 0 };
  const tr = await get('/tournaments', { sportId: 10 });
  const serieA = arr(tr.body).filter(t => /serie a/i.test(t.tournamentName || '') );
  save('tornei', { status: tr.status, serieA, totale: arr(tr.body).length });
  const bm = await get('/bookmakers');
  const re = /snai|sisal|eurobet|goldbet|lottomatica|bwin|betflag|planetwin|better/i;
  const bmItems = arr(bm.body);
  save('bookmaker', { status: bm.status, totale: bmItems.length, italiani: bmItems.filter(b => re.test(JSON.stringify(b))), esempio: bmItems.slice(0, 2) });
  const mk = await get('/markets', { sportId: 10 });
  const mkItems = arr(mk.body);
  save('mercati', { status: mk.status, totale: mkItems.length, rilevanti: mkItems.filter(m => /1x2|full.?time|match.?winner|moneyline|over|under|both teams|btts|goal/i.test(JSON.stringify(m))).slice(0, 80), esempio: mkItems.slice(0, 3) });
  const sa = serieA.find(t => /italy|italia/i.test(t.categorySlug || t.categoryName || '')) || serieA[0];
  if (sa) {
    const fx = await get('/fixtures', { tournamentId: sa.tournamentId });
    save('partite', { status: fx.status, torneo: sa, totale: arr(fx.body).length, esempio: arr(fx.body).slice(0, 3) });
    const slug = bmItems.filter(b => /snai/i.test(JSON.stringify(b))).map(b => b.slug || b.bookmakerSlug || b.bookmaker || b.name)[0];
    if (slug) {
      const od = await get('/odds-by-tournaments', { bookmaker: slug, tournamentIds: sa.tournamentId });
      save('quote-esempio', { status: od.status, bookmaker: slug, totale: arr(od.body).length, esempio: arr(od.body).slice(0, 2) });
    } else console.log('Slug SNAI non trovato');
  } else console.log('Serie A non trovata tra i tornei');
  out.richiesteUsate = richieste;
  save('riepilogo', out);
}
console.log('Richieste usate in questa esecuzione:', richieste);
