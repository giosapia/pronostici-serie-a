// Scarica le quote da OddsPapi. La chiave arriva dal segreto ODDSPAPI_KEY e non viene mai scritta nei file.
import fs from 'node:fs';

const KEY = process.env.ODDSPAPI_KEY;
const MODE = process.env.MODE || 'discover';
if (!KEY) { console.error('Manca il segreto ODDSPAPI_KEY'); process.exit(1); }
// Esecuzione di metà giornata: parte solo se oggi (ora italiana) c'è almeno una partita nelle quote già salvate.
if (process.env.SOLO_SE_PARTITE === '1') {
  const oggi = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  let giocano = false;
  try { giocano = JSON.parse(fs.readFileSync('data/quote.json', 'utf8')).partite.some(p => new Date(p.inizio).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) === oggi); } catch (e) {}
  if (!giocano) { console.log('Oggi nessuna partita: nessuna richiesta.'); process.exit(0); }
}
const BASE = 'https://api.oddspapi.io/v4';
let richieste = 0;

const dormi = ms => new Promise(r => setTimeout(r, ms));
let ultima = 0;
async function get(path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('apiKey', KEY);
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    // il servizio impone una pausa tra una richiesta e l'altra
    const attesa = Math.max(0, ultima + 7000 - Date.now()); if (attesa) await dormi(attesa);
    richieste++; ultima = Date.now();
    let r, t;
    try { r = await fetch(u, { signal: AbortSignal.timeout(30000) }); t = await r.text(); }
    catch (e) { console.log(`GET ${path} -> errore o tempo scaduto: ${e.name}`); if (tentativo === 3) return { status: 0, body: null }; await dormi(10000); continue; }
    let body; try { body = JSON.parse(t); } catch { body = t.slice(0, 500); }
    console.log(`GET ${path} ${JSON.stringify(params)} -> ${r.status} (tentativo ${tentativo})`, r.status === 429 ? JSON.stringify(body).slice(0, 300) + ' Retry-After=' + r.headers.get('retry-after') : '');
    if (r.status !== 429) return { status: r.status, body };
    await dormi(Math.max(10000, (parseFloat(r.headers.get('retry-after')) || 0) * 1000 + 1000));
  }
  return { status: 429, body: null };
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

if (MODE === 'quote') {
  // SNAI e Sisal, e Goldbet con i suoi marchi, sono "cloni" nel servizio: il servizio può dare le stesse quote.
  const OPERATORI = [['snai.it', 'SNAI'], ['sisal.it', 'Sisal'], ['eurobet.it', 'Eurobet'], ['goldbet.it', 'Goldbet']];
  const TORNEO = 23; // Serie A (Italia)
  const NOMI = ['Inter', 'Napoli', 'Juventus', 'Milan', 'Roma', 'Atalanta', 'Lazio', 'Bologna', 'Fiorentina', 'Como', 'Torino', 'Udinese', 'Genoa', 'Cagliari', 'Parma', 'Lecce', 'Sassuolo', 'Venezia', 'Frosinone', 'Monza'];
  const nome = (a, b) => { const t = `${a || ''} ${b || ''}`.toLowerCase(); return NOMI.find(n => t.includes(n.toLowerCase())) || (b || a); };
  const MERCATI = { '101': ['1', 'X', '2'], '104': ['G', 'N'], '108': ['O15', 'U15'], '1010': ['O25', 'U25'], '1012': ['O35', 'U35'] };
  // ordine degli esiti (id) per ogni mercato: 1X2 -> 101,102,103; G/N -> 104,105; Over/Under -> id del mercato (Over), id+1 (Under)
  const ESITI = { '101': { 101: '1', 102: 'X', 103: '2' }, '104': { 104: 'G', 105: 'N' }, '108': { 108: 'O15', 109: 'U15' }, '1010': { 1010: 'O25', 1011: 'U25' }, '1012': { 1012: 'O35', 1013: 'U35' } };

  const fx = await get('/fixtures', { tournamentId: TORNEO });
  const anag = {};
  for (const f of arr(fx.body)) anag[f.fixtureId] = { casa: nome(f.participant1ShortName, f.participant1Name), trasf: nome(f.participant2ShortName, f.participant2Name), nomeCasa: f.participant1Name, nomeTrasf: f.participant2Name, inizio: f.startTime };
  const partite = {};
  const operatori = [];
  const cloni = { 'snai.it': 'sisal.it', 'sisal.it': null, 'eurobet.it': null, 'goldbet.it': null };
  for (const [slug, etichetta] of OPERATORI) {
    const od = await get('/odds-by-tournaments', { bookmaker: slug, tournamentIds: TORNEO });
    operatori.push({ slug, nome: etichetta, cloneDi: cloni[slug] || null, stato: od.status });
    if (od.status !== 200) continue;
    for (const f of arr(od.body)) {
      const bo = f.bookmakerOdds && f.bookmakerOdds[slug];
      if (!bo || !bo.markets) continue;
      const a = anag[f.fixtureId] || {};
      const p = partite[f.fixtureId] ||= { id: f.fixtureId, casa: a.casa, trasf: a.trasf, inizio: f.startTime, quote: {} };
      const q = p.quote[slug] = {};
      for (const [mid, mapEsiti] of Object.entries(ESITI)) {
        const m = bo.markets[mid]; if (!m) continue;
        for (const [oid, sigla] of Object.entries(mapEsiti)) {
          const o = m.outcomes && m.outcomes[oid]; const pl = o && o.players && o.players['0'];
          if (pl && pl.active !== false && pl.price > 1) q[sigla] = pl.price;
        }
      }
    }
  }
  const out = { aggiornato: new Date().toISOString(), fonte: 'OddsPapi', operatori, partite: Object.values(partite).sort((x, y) => x.inizio.localeCompare(y.inizio)) };
  fs.writeFileSync('data/quote.json', JSON.stringify(out, null, 1));
  // Storico: ultima fotografia delle quote 1X2 di ogni partita (si sovrascrive finché la partita è in programma).
  try {
    const f = 'data/storico-quote.json';
    const st = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
    for (const p of out.partite) {
      const q = {};
      for (const [sl, v] of Object.entries(p.quote || {})) if (v['1'] && v['X'] && v['2']) q[sl] = { '1': v['1'], 'X': v['X'], '2': v['2'] };
      if (Object.keys(q).length) st[p.casa + '_' + p.trasf + '_' + String(p.inizio).slice(0, 10)] = { casa: p.casa, trasf: p.trasf, inizio: p.inizio, agg: out.aggiornato, quote: q };
    }
    fs.writeFileSync(f, JSON.stringify(st, null, 1));
  } catch (e) { console.log('storico non aggiornato:', e.message); }
  console.log('Partite con quote:', out.partite.length);
}
console.log('Richieste usate in questa esecuzione:', richieste);
