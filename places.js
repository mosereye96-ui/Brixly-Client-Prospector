const https = require('https');

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
    const { query } = JSON.parse(event.body);

    // Step 1: Find Place ID
    const searchResult = await httpsGet(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&key=${apiKey}`
    );
    const searchData = JSON.parse(searchResult);

    if (!searchData.candidates || searchData.candidates.length === 0) {
      return {
        statusCode: 404,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Business not found on Google' })
      };
    }

    const placeId = searchData.candidates[0].place_id;

    // Step 2: Get Place Details
    const detailResult = await httpsGet(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,rating,user_ratings_total,formatted_address,formatted_phone_number,types&key=${apiKey}`
    );
    const detailData = JSON.parse(detailResult);
    const p = detailData.result;

    const typeMap = {
      restaurant: 'Restaurant', food: 'Restaurant', cafe: 'Cafe',
      hair_care: 'Hair Salon', beauty_salon: 'Hair Salon',
      car_repair: 'Auto Shop', car_dealer: 'Car Dealership',
      dentist: 'Dental Office', gym: 'Gym', spa: 'Spa',
      bar: 'Bar', bakery: 'Bakery', store: 'Retail Store',
      lodging: 'Hotel', school: 'School'
    };

    const rawType = (p.types || []).find(t => typeMap[t]) || p.types?.[0] || 'Local Business';
    const type = typeMap[rawType] || rawType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        place: {
          name: p.name,
          type: type,
          address: p.formatted_address || '',
          phone: p.formatted_phone_number || '',
          rating: p.rating || 0,
          reviewCount: p.user_ratings_total || 0,
          placeId: placeId
        }
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}
