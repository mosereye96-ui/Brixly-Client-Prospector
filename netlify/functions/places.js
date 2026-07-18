const https = require('https');

// Maps our internal category keys to Google Places "type" + optional keyword refinement.
// Some categories (barbershop, cleaning, retail) don't have an exact Google type,
// so we lean on `keyword` to narrow things down instead.
const CATEGORY_MAP = {
  restaurant:  { type: 'restaurant', keyword: '' },
  salon:       { type: 'hair_care',  keyword: 'hair salon' },
  barbershop:  { type: 'hair_care',  keyword: 'barbershop' },
  auto:        { type: 'car_repair', keyword: 'auto detailing' },
  spa:         { type: 'spa',        keyword: '' },
  dental:      { type: 'dentist',    keyword: '' },
  gym:         { type: 'gym',        keyword: '' },
  cleaning:    { type: '',           keyword: 'cleaning service' },
  cafe:        { type: 'cafe',       keyword: '' },
  retail:      { type: 'store',      keyword: 'retail store' }
};

const TYPE_LABELS = {
  restaurant: 'Restaurant', food: 'Restaurant', cafe: 'Cafe',
  hair_care: 'Hair Salon', beauty_salon: 'Hair Salon',
  car_repair: 'Auto Shop', car_dealer: 'Car Dealership',
  dentist: 'Dental Office', gym: 'Gym', spa: 'Spa',
  bar: 'Bar', bakery: 'Bakery', store: 'Retail Store',
  lodging: 'Hotel', school: 'School', supermarket: 'Grocery Store'
};

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Google API key not configured' }) };
  }

  try {
    const body = JSON.parse(event.body);

    if (body.mode === 'nearby') {
      return await handleNearbySearch(body, apiKey);
    }

    // ---- Legacy text search (used by the single-business lookup/autocomplete) ----
    const { query } = body;
    const searchResult = await httpsGet(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
    );
    const searchData = JSON.parse(searchResult);

    if (!searchData.results || searchData.results.length === 0) {
      return jsonResponse({ results: [] });
    }

    const results = searchData.results.slice(0, 5).map(p => mapPlace(p));

    return jsonResponse({ results });

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

async function handleNearbySearch(body, apiKey) {
  const { zip, radiusMiles, categories } = body;
  if (!zip || !categories || categories.length === 0) {
    return jsonResponse({ error: 'zip and categories are required' }, 400);
  }

  // Step 1: geocode the ZIP into lat/lng
  const geoRaw = await httpsGet(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(zip)}&key=${apiKey}`
  );
  const geoData = JSON.parse(geoRaw);
  if (!geoData.results || geoData.results.length === 0) {
    return jsonResponse({ error: 'Could not locate that ZIP code', results: [] });
  }
  const { lat, lng } = geoData.results[0].geometry.location;
  const radiusMeters = Math.round((parseFloat(radiusMiles) || 2) * 1609.34);

  // Step 2: one Nearby Search per selected category, merged + deduped by place_id
  const seen = new Map();

  for (const cat of categories) {
    const mapping = CATEGORY_MAP[cat];
    if (!mapping) continue;

    let url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&key=${apiKey}`;
    if (mapping.type) url += `&type=${mapping.type}`;
    if (mapping.keyword) url += `&keyword=${encodeURIComponent(mapping.keyword)}`;

    try {
      const raw = await httpsGet(url);
      const data = JSON.parse(raw);
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.error(`Nearby search failed for ${cat}:`, data.status, data.error_message);
        continue;
      }
      (data.results || []).forEach(p => {
        if (!seen.has(p.place_id)) {
          const mapped = mapPlace(p);
          mapped.category = cat;
          seen.set(p.place_id, mapped);
        }
      });
    } catch (e) {
      console.error(`Nearby search error for ${cat}:`, e.message);
    }
  }

  return jsonResponse({ results: Array.from(seen.values()), center: { lat, lng } });
}

function mapPlace(p) {
  const rawType = (p.types || []).find(t => TYPE_LABELS[t]) || (p.types && p.types[0]) || 'local_business';
  const type = TYPE_LABELS[rawType] || rawType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  return {
    name: p.name,
    type: type,
    address: p.formatted_address || p.vicinity || '',
    phone: '',
    rating: p.rating || 0,
    reviewCount: p.user_ratings_total || 0,
    placeId: p.place_id,
    lat: p.geometry && p.geometry.location ? p.geometry.location.lat : null,
    lng: p.geometry && p.geometry.location ? p.geometry.location.lng : null
  };
}

function jsonResponse(obj, statusCode) {
  return {
    statusCode: statusCode || 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(obj)
  };
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
