export const config = { maxDuration: 60 }; // Vercel: permite até 60s por busca

const UA = { 'User-Agent': 'Prospect/1.0 (OpenStreetMap data search)' };
const SOCIAL = /(instagram|facebook|fb\.com|wa\.me|whatsapp|linktr\.ee|tiktok|youtube|twitter|x\.com|google\.|goo\.gl|ifood)/i;
const CATS = {
  restaurantes: { o: ['["amenity"~"^(restaurant|fast_food|cafe|bar)$"]'], cnae: ['5611201','5611202','5611203','5611204','5612100'] },
  roupas: { o: ['["shop"~"^(clothes|shoes|boutique|fashion)$"]'], cnae: ['4781400','4782201','4782202'] },
  mercados: { o: ['["shop"~"^(supermarket|convenience|greengrocer|butcher)$"]'], cnae: ['4711301','4711302','4712100'] },
  beleza: { o: ['["shop"~"^(hairdresser|beauty|barber)$"]'], cnae: ['9602501','9602502'] },
  oficinas: { o: ['["shop"~"^(car_repair|tyres|motorcycle_repair)$"]'], cnae: ['4520001','4520002','4520003','4520004','4543900'] },
  clinicas: { o: ['["amenity"~"^(clinic|doctors|dentist)$"]'], cnae: ['8630501','8630502','8630503','8630504','8630505','8630506','8630507','8630508','8630509'] },
  academias: { o: ['["leisure"="fitness_centre"]'], cnae: ['9313100'] },
  padarias: { o: ['["shop"~"^(bakery|pastry|confectionery)$"]'], cnae: ['4721102','1091101','1091102'] },
  hoteis: { o: ['["tourism"~"^(hotel|guest_house|motel|hostel)$"]'], cnae: ['5510801','5510802','5590601'] },
  servicos: { o: ['["office"]', '["craft"]'], cnae: [] },
  outros: { o: ['["shop"]'], cnae: [] },
};
const tfetch = (u, o = {}, ms = 20000) => fetch(u, { ...o, signal: AbortSignal.timeout(ms) });
const cache = new Map();
const geoCache = new Map();
let geoQueue = Promise.resolve(), lastGeoAt = 0;
const websiteUrl = value => {
  const text = String(value || '').trim();
  return !text || SOCIAL.test(text) ? '' : /^https?:\/\//i.test(text) ? text : `https://${text}`;
};
function classify(website, hasContact, verifiable) {
  if (website && !SOCIAL.test(website)) return 'COM_SITE';
  if (!verifiable && !hasContact && !website) return 'NAO_VERIFICADO';
  return 'SEM_SITE';
}
async function geocode(city, uf) {
  const key = `${String(city).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()}|${uf.toUpperCase()}`;
  const cached = geoCache.get(key);
  if (cached && Date.now() - cached.at < 30 * 864e5) return cached.area;
  const request = geoQueue.then(async () => {
    const recent = geoCache.get(key);
    if (recent && Date.now() - recent.at < 30 * 864e5) return recent.area;
    const wait = 1100 - (Date.now() - lastGeoAt);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    lastGeoAt = Date.now();
    const q = new URLSearchParams({ q: city + ', ' + uf + ', Brasil', format: 'json', limit: '10', countrycodes: 'br', addressdetails: '1' });
    const r = await tfetch('https://nominatim.openstreetmap.org/search?' + q, { headers: UA }, 8000);
    if (!r.ok) throw new Error('GEO');
    const hits = await r.json();
    const hit = hits.find(x => x.osm_type === 'relation' && ['city', 'town', 'village', 'municipality'].includes(x.type)) || hits.find(x => x.osm_type === 'relation' || x.osm_type === 'way');
    if (!hit) throw new Error('NOCITY');
    const [south, north, west, east] = hit.boundingbox.map(Number);
    const area = { bbox: [west, south, east, north], center: [+hit.lon, +hit.lat] };
    geoCache.set(key, { at: Date.now(), area });
    return area;
  });
  geoQueue = request.catch(() => {});
  return request;
}
const TERMS = { restaurantes:'restaurant', roupas:'clothing', mercados:'supermarket', beleza:'hairdresser', oficinas:'car repair', clinicas:'clinic', academias:'gym', padarias:'bakery', hoteis:'hotel', servicos:'office', outros:'shop' };
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cleanName = s => norm(s).replace(/\b(ltda|me|epp|eireli|sa|s a|sociedade|empresario|individual)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function socialUrl(value, base) {
  if (!value) return '';
  const text = String(value).trim();
  if (/^https?:\/\//i.test(text)) return text;
  if (/^(www\.)?(instagram|facebook)\.com\//i.test(text)) return 'https://' + text.replace(/^www\./i, '');
  return base + text.replace(/^@/, '');
}
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
    const p = f.properties, [lon, lat] = f.geometry.coordinates, site = websiteUrl(p.website || p.extra?.website || ''), phone = p.phone || p.extra?.phone || '';
    const address = [[p.street, p.housenumber].filter(Boolean).join(', '), p.district || p.locality, p.city].filter(Boolean).join(' - ');
    return { id: 'osm' + p.osm_type + p.osm_id, name: p.name, category: cat, address, phone, whatsapp: false, instagram: '', facebook: '', website: site, rating: null, reviews: null, lat, lon, status: classify(site, phone, false), source: 'OpenStreetMap (Photon)' };
  });
}

// Minha Receita é uma API aberta e gratuita baseada nos dados públicos do CNPJ.
// Ela traz telefone cadastral, permitindo cruzar uma fonte independente do OSM.
async function cnpjContacts(city, uf, cat) {
  const codes = CATS[cat].cnae;
  if (!codes.length) return [];
  const lookup = await tfetch('https://servicodados.ibge.gov.br/api/v1/localidades/municipios?nome=' + encodeURIComponent(city), { headers: UA }, 8000);
  if (!lookup.ok) return [];
  const cities = await lookup.json();
  const municipality = cities.find(item => norm(item.nome) === norm(city) &&
    (item['regiao-imediata']?.['regiao-intermediaria']?.UF?.sigla || item.microrregiao?.mesorregiao?.UF?.sigla) === uf);
  if (!municipality) return [];
  const params = new URLSearchParams({ municipio: String(municipality.id), uf, cnae: codes.join(','), limit: '100' });
  const leads = [], seen = new Set();
  let cursor = '';
  // Uma página pequena evita sobrecarregar a API pública e mantém a busca rápida.
  for (let page = 0; page < 1; page++) {
    if (cursor) params.set('cursor', cursor);
    const response = await tfetch('https://minhareceita.org/?' + params, { headers: { ...UA, Accept: 'application/json' } }, 12000);
    if (!response.ok) break;
    const result = await response.json();
    for (const company of result.data || []) {
      const phoneDigits = value => String(value || '').replace(/\D/g, '');
      const phoneNumber = [company.ddd_telefone_1, company.ddd_telefone_2].map(phoneDigits)
        .find(number => number.length >= 10 && !/^([0-9])\1+$/.test(number)) || '';
      const phone = phoneNumber.length === 10 ? `(${phoneNumber.slice(0,2)}) ${phoneNumber.slice(2,6)}-${phoneNumber.slice(6)}` :
        phoneNumber.length === 11 ? `(${phoneNumber.slice(0,2)}) ${phoneNumber.slice(2,7)}-${phoneNumber.slice(7)}` : phoneNumber;
      if (company.descricao_situacao_cadastral !== 'ATIVA' || !phone) continue;
      const id = String(company.cnpj || '').replace(/\D/g, '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const street = [company.descricao_tipo_de_logradouro, company.logradouro].filter(Boolean).join(' ');
      const address = [[street, company.numero].filter(Boolean).join(', '), company.complemento, company.bairro, company.municipio].filter(Boolean).join(' - ');
      leads.push({ id: 'cnpj' + id, cnpj: id, name: company.nome_fantasia || company.razao_social,
        category: cat, address, phone, email: company.email || '', whatsapp: false, instagram: '', facebook: '', website: '',
        rating: null, reviews: null, lat: null, lon: null, status: 'SEM_SITE', source: 'Receita Federal (Minha Receita)' });
    }
    cursor = result.cursor || '';
    if (!cursor) break;
  }
  return leads;
}

function mergeSources(osmPlaces, cnpjPlaces) {
  const merged = [...osmPlaces];
  for (const company of cnpjPlaces) {
    const name = cleanName(company.name);
    const match = name && merged.find(place => {
      const other = cleanName(place.name);
      return other === name || (Math.min(other.length, name.length) > 8 && (other.includes(name) || name.includes(other)));
    });
    if (match) {
      match.phone ||= company.phone;
      match.email ||= company.email;
      match.cnpj = company.cnpj;
      match.contactSource = ['OpenStreetMap', 'Receita Federal'];
      match.status = classify(match.website, Boolean(match.phone || match.email || match.instagram || match.facebook), true);
    } else merged.push(company);
  }
  return merged;
}

async function enrichContacts(places) {
  if (!places.length) return { places, enriched: false };
  const groups = { N: [], W: [], R: [] };
  for (const place of places) {
    const match = place.id.match(/^osm([NWR])(\d+)$/);
    if (match) groups[match[1]].push(match[2]);
  }
  const selectors = Object.entries(groups).filter(([, ids]) => ids.length)
    .map(([type, ids]) => `${({ N: 'node', W: 'way', R: 'relation' })[type]}(id:${ids.join(',')});`);
  if (!selectors.length) return { places, enriched: false };
  const query = `[out:json][timeout:10];(${selectors.join('')});out center tags;`;
  let elements;
  for (const endpoint of ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter']) {
    try {
      const response = await tfetch(endpoint, {
        method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      }, 9000);
      if (response.status === 429) break; // respeita o intervalo solicitado pela instância
      if (!response.ok) continue;
      elements = (await response.json()).elements || [];
      break;
    } catch { /* tenta outra instância pública quando houver timeout/erro de rede */ }
  }
  if (!elements) return { places, enriched: false };
  const tagsById = new Map(elements.map(item => [`osm${item.type[0].toUpperCase()}${item.id}`, item.tags || {}]));
  return { enriched: true, places: places.map(place => {
    const tags = tagsById.get(place.id);
    if (!tags) return place;
    const website = websiteUrl(tags.website) || websiteUrl(tags['contact:website']) || websiteUrl(tags.url) || place.website || '';
    const phone = tags.phone || tags['contact:phone'] || tags['contact:whatsapp'] || place.phone || '';
    const instagram = socialUrl(tags['contact:instagram'] || tags.instagram, 'https://instagram.com/') || place.instagram;
    const facebook = socialUrl(tags['contact:facebook'] || tags.facebook, 'https://facebook.com/') || place.facebook;
    return { ...place, website, phone, instagram, facebook,
      status: classify(website, Boolean(phone || instagram || facebook), false),
      contactSource: [website || phone || instagram || facebook ? 'OpenStreetMap' : 'Photon'] };
  }) };
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
    const companies = await cnpjContacts(city.trim(), uf.toUpperCase(), cat).catch(() => []);
    const places = mergeSources(list, companies);
    const v = { source: companies.length ? 'OpenStreetMap + CNPJ público (Minha Receita)' : 'OpenStreetMap (Photon)', results: places };
    cache.set(ck, { t: Date.now(), v }); res.json(v);
  } catch (e) { const [s, m] = MSG[e.message] || [500, 'Erro inesperado.']; res.status(s).json({ error: m }); }
}
