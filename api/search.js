export const config = { maxDuration: 60 }; // Vercel: permite até 60s por busca


const KEY = process.env.GOOGLE_PLACES_KEY || '';
const UA = { 'User-Agent': 'prospect-app/1.0 (uso local)' };
const SOCIAL = /(instagram|facebook|fb\.com|wa\.me|whatsapp|linktr\.ee|tiktok|youtube|twitter|x\.com|google\.|goo\.gl|ifood)/i;

// categoria -> filtros OSM + texto para o Google
const CATS = {
  restaurantes: { g: 'restaurantes e lanchonetes', o: ['["amenity"~"^(restaurant|fast_food|cafe|bar)$"]'] },
  roupas:       { g: 'lojas de roupas e calçados', o: ['["shop"~"^(clothes|shoes|boutique|fashion)$"]'] },
  mercados:     { g: 'mercados e supermercados',   o: ['["shop"~"^(supermarket|convenience|greengrocer|butcher)$"]'] },
  beleza:       { g: 'barbearias e salões de beleza', o: ['["shop"~"^(hairdresser|beauty|barber)$"]'] },
  oficinas:     { g: 'oficinas mecânicas',         o: ['["shop"~"^(car_repair|tyres|motorcycle_repair)$"]'] },
  clinicas:     { g: 'clínicas e consultórios',    o: ['["amenity"~"^(clinic|doctors|dentist)$"]'] },
  academias:    { g: 'academias',                  o: ['["leisure"="fitness_centre"]'] },
  padarias:     { g: 'padarias e confeitarias',    o: ['["shop"~"^(bakery|pastry|confectionery)$"]'] },
  hoteis:       { g: 'hotéis e pousadas',          o: ['["tourism"~"^(hotel|guest_house|motel|hostel)$"]'] },
  servicos:     { g: 'prestadores de serviços',    o: ['["office"]', '["craft"]'] },
  outros:       { g: 'comércio',                   o: ['["shop"]'] },
};

const tfetch = (u, o = {}, ms = 20000) => fetch(u, { ...o, signal: AbortSignal.timeout(ms) });
const cache = new Map(); // cache de 1h: repetir a busca fica instantâneo
const url = (v, base) => !v ? '' : /^https?:/i.test(v) ? v : base + v.replace(/^@/, '');
function classify(website, hasContact, verifiable) {
  if (website && !SOCIAL.test(website)) return 'COM_SITE';
  if (!verifiable && !hasContact && !website) return 'NAO_VERIFICADO'; // dado pobre: não dá para afirmar
  return 'SEM_SITE';
}

async function geocode(city, uf) {
  const q = new URLSearchParams({ q: `${city}, ${uf}, Brasil`, format: 'json', limit: '5', countrycodes: 'br' });
  const r = await tfetch('https://nominatim.openstreetmap.org/search?' + q, { headers: UA }, 8000);
  if (!r.ok) throw new Error('GEO');
  const hit = (await r.json()).find(x => x.osm_type === 'relation');
  if (!hit) throw new Error('NOCITY');
  return 3600000000 + Number(hit.osm_id); // id da área no Overpass
}

async function viaOverpass(city, uf, cat) {
  const area = await geocode(city, uf);
  const body = CATS[cat].o.map(f => `nwr${f}["name"](area.a);`).join('');
  const ql = `[out:json][timeout:25];area(${area})->.a;(${body});out center tags 400;`;
  let last = 'TIMEOUT'; const deadline = Date.now() + 50000; // orçamento total da busca
  for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
    const left = deadline - Date.now(); if (left < 8000) break;
    try {
      const r = await tfetch(ep, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(ql) }, Math.min(28000, left));
      if (r.status === 429 || r.status === 504) { last = 'LIMIT'; continue; }
      if (!r.ok) { last = 'OVERPASS'; continue; }
      return (await r.json()).elements.map(e => {
        const t = e.tags, lat = e.lat ?? e.center?.lat, lon = e.lon ?? e.center?.lon;
        const site = t.website || t['contact:website'] || t.url || '';
        const phone = t.phone || t['contact:phone'] || t['contact:whatsapp'] || '';
        const ig = url(t['contact:instagram'] || t.instagram, 'https://instagram.com/');
        const fb = url(t['contact:facebook'] || t.facebook, 'https://facebook.com/');
        const addr = [[t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', '), t['addr:suburb'], t['addr:city']].filter(Boolean).join(' - ');
        return { id: `osm${e.type[0]}${e.id}`, name: t.name, category: cat, address: addr, phone, whatsapp: !!t['contact:whatsapp'],
          instagram: ig, facebook: fb, website: SOCIAL.test(site) ? '' : site, rating: null, reviews: null, lat, lon,
          status: classify(site, phone || ig || fb, false), source: 'OpenStreetMap' };
      });
    } catch (e) { last = e.name === 'TimeoutError' ? 'TIMEOUT' : 'OVERPASS'; }
  }
  throw new Error(last);
}

async function viaGoogle(city, uf, cat) {
  const out = []; let pageToken;
  for (let i = 0; i < 3; i++) {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.location,nextPageToken' },
      body: JSON.stringify({ textQuery: `${CATS[cat].g} em ${city}, ${uf}, Brasil`, languageCode: 'pt-BR', pageSize: 20, ...(pageToken && { pageToken }) }) });
    if (!r.ok) throw new Error(r.status === 429 ? 'LIMIT' : 'GOOGLE');
    const j = await r.json();
    for (const p of j.places || []) out.push({ id: 'g' + p.id, name: p.displayName?.text, category: cat, address: p.formattedAddress || '',
      phone: p.nationalPhoneNumber || '', whatsapp: false, instagram: '', facebook: '',
      website: p.websiteUri && !SOCIAL.test(p.websiteUri) ? p.websiteUri : '', rating: p.rating ?? null, reviews: p.userRatingCount ?? null,
      lat: p.location?.latitude, lon: p.location?.longitude, status: classify(p.websiteUri, true, true), source: 'Google Places' });
    if (!(pageToken = j.nextPageToken)) break;
  }
  return out;
}

const MSG = { TIMEOUT: [504, 'O OpenStreetMap demorou demais para responder. Tente de novo em instantes ou use uma categoria mais específica.'], NOCITY: [404, 'Cidade não encontrada. Confira o nome e o estado.'], LIMIT: [429, 'Limite de requisições da fonte atingido. Aguarde um minuto e tente de novo.'],
  GEO: [502, 'Falha ao localizar a cidade (Nominatim).'], OVERPASS: [502, 'Falha ao consultar o OpenStreetMap.'], GOOGLE: [502, 'Falha na Google Places API. Verifique a chave e a cota.'] };

export default async function handler(req, res) {
  const { city = '', uf = '', cat = 'outros' } = req.query;
  if (!city.trim() || !/^[A-Za-z]{2}$/.test(uf) || !CATS[cat]) return res.status(400).json({ error: 'Informe cidade, UF e categoria válidas.' });
  const ck = `${city}|${uf}|${cat}`.toLowerCase(), hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 36e5) return res.json(hit.v);
  try {
    const list = KEY ? await viaGoogle(city.trim(), uf.toUpperCase(), cat) : await viaOverpass(city.trim(), uf.toUpperCase(), cat);
    const v = { source: KEY ? 'Google Places' : 'OpenStreetMap', results: list };
    cache.set(ck, { t: Date.now(), v }); res.json(v);
  } catch (e) { const [s, m] = MSG[e.message] || [500, 'Erro inesperado.']; res.status(s).json({ error: m }); }
}
