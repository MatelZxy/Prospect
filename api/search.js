export const config = { maxDuration: 60 }; // Vercel: permite até 60s por busca

const UA = { 'User-Agent': 'Prospect/1.0 (OpenStreetMap data search)' };
const SOCIAL = /(instagram|facebook|fb\.com|wa\.me|whatsapp|linktr\.ee|tiktok|youtube|twitter|x\.com|google\.|goo\.gl|ifood)/i;
const CATS = {
  restaurantes: { o: ['["amenity"~"^(restaurant|fast_food|cafe|bar)$"]'] },
  roupas: { o: ['["shop"~"^(clothes|shoes|boutique|fashion)$"]'] },
  mercados: { o: ['["shop"~"^(supermarket|convenience|greengrocer|butcher)$"]'] },
  beleza: { o: ['["shop"~"^(hairdresser|beauty|barber)$"]'] },
  oficinas: { o: ['["shop"~"^(car_repair|tyres|motorcycle_repair)$"]'] },
  clinicas: { o: ['["amenity"~"^(clinic|doctors|dentist)$"]'] },
  academias: { o: ['["leisure"="fitness_centre"]'] },
  padarias: { o: ['["shop"~"^(bakery|pastry|confectionery)$"]'] },
  hoteis: { o: ['["tourism"~"^(hotel|guest_house|motel|hostel)$"]'] },
  servicos: { o: ['["office"]', '["craft"]'] },
  outros: { o: ['["shop"]'] },
};
const tfetch = (u, o = {}, ms = 20000) => fetch(u, { ...o, signal: AbortSignal.timeout(ms) });
const cache = new Map();
const url = (v, base) => !v ? '' : /^https?:/i.test(v) ? v : base + v.replace(/^@/, '');
function classify(website, hasContact, verifiable) {
  if (website && !SOCIAL.test(website)) return 'COM_SITE';
  if (!verifiable && !hasContact && !website) return 'NAO_VERIFICADO';
  return 'SEM_SITE';
}
async function geocode(city, uf) {
  const q = new URLSearchParams({ q: city + ', ' + uf + ', Brasil', format: 'json', limit: '10', countrycodes: 'br', addressdetails: '1' });
  const r = await tfetch('https://nominatim.openstreetmap.org/search?' + q, { headers: UA }, 8000);
  if (!r.ok) throw new Error('GEO');
  const hits = await r.json();
  const hit = hits.find(x => x.osm_type === 'relation' && ['city', 'town', 'village', 'municipality'].includes(x.type)) || hits.find(x => x.osm_type === 'relation' || x.osm_type === 'way');
  if (!hit) throw new Error('NOCITY');
  const [south, north, west, east] = hit.boundingbox.map(Number);
  return { bbox: [west, south, east, north], center: [+hit.lon, +hit.lat] };
}
const TERMS = { restaurantes:'restaurant', roupas:'clothing', mercados:'supermarket', beleza:'hairdresser', oficinas:'car repair', clinicas:'clinic', academias:'gym', padarias:'bakery', hoteis:'hotel', servicos:'office', outros:'shop' };
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function viaPhoton(city, uf, cat, area) {
  const params = new URLSearchParams({ q: TERMS[cat], bbox: area.bbox.join(','), limit: '100' });
  for (const f of CATS[cat].o) {
    const key = f.match(/\["([^"]+)"/)?.[1];
    const values = f.match(/\^\(([^)]+)\)/)?.[1]?.split('|') || [f.match(/="([^"]+)"/)?.[1] || ''];
    for (const value of values) params.append('osm_tag', value ? key + ':' + value : key);
  }
  const r = await tfetch('https://photon.komoot.io/api/?' + params, { headers: UA }, 15000);
  if (!r.ok) throw new Error(r.status === 429 ? 'LIMIT' : 'PHOTON');
  const j = await r.json(), target = norm(city);
  return j.features.filter(f => norm(f.properties.city) === target).map(f => {
    const p = f.properties, [lon, lat] = f.geometry.coordinates, site = p.website || p.extra?.website || '', phone = p.phone || p.extra?.phone || '';
    const address = [[p.street, p.housenumber].filter(Boolean).join(', '), p.district || p.locality, p.city].filter(Boolean).join(' - ');
    return { id: 'osm' + p.osm_type + p.osm_id, name: p.name, category: cat, address, phone, whatsapp: false, instagram: '', facebook: '', website: site, rating: null, reviews: null, lat, lon, status: classify(site, phone, false), source: 'OpenStreetMap (Photon)' };
  });
}
const MSG = { TIMEOUT: [504, 'A busca gratuita demorou demais para responder. Tente de novo em instantes.'], NOCITY: [404, 'Cidade não encontrada. Confira o nome e o estado.'], LIMIT: [429, 'Limite gratuito atingido. Aguarde um minuto e tente de novo.'], GEO: [502, 'Falha ao localizar a cidade (Nominatim).'], PHOTON: [502, 'Falha ao consultar a busca gratuita do OpenStreetMap (Photon).'] };
export default async function handler(req, res) {
  const { city = '', uf = '', cat = 'outros' } = req.query;
  if (!city.trim() || !/^[A-Za-z]{2}$/.test(uf) || !CATS[cat]) return res.status(400).json({ error: 'Informe cidade, UF e categoria válidas.' });
  const ck = (city + '|' + uf + '|' + cat).toLowerCase(), hit = cache.get(ck);
  if (hit && Date.now() - hit.t < 36e5) return res.json(hit.v);
  try {
    const area = await geocode(city.trim(), uf.toUpperCase());
    const list = await viaPhoton(city.trim(), uf.toUpperCase(), cat, area);
    const v = { source: 'OpenStreetMap (Photon)', results: list };
    cache.set(ck, { t: Date.now(), v }); res.json(v);
  } catch (e) { const [s, m] = MSG[e.message] || [500, 'Erro inesperado.']; res.status(s).json({ error: m }); }
}
