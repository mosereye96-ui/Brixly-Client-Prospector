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

    // Search for multiple candidates
    const searchResult = await httpsGet(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
    );
    const searchData = JSON.parse(searchResult);

    if (!searchData.results || searchData.results.length === 0) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ results: [] })
      };
    }

    const typeMap = {
      restaurant: 'Restaurant', food: 'Restaurant', cafe: 'Cafe',
      hair_care: 'Hair Salon', beauty_salon: 'Hair Salon',
      car_repair: 'Auto Shop', car_dealer: 'Car Dealership',
      dentist: 'Dental Office', gym: 'Gym', spa: 'Spa',
      bar: 'Bar', bakery: 'Bakery', store: 'Retail Store',
      lodging: 'Hotel', school: 'School', supermarket: 'Grocery Store'
    };

    // Return top 5 results
    const results = searchData.results.slice(0, 5).map(p => {
      const rawType = (p.types || []).find(t => typeMap[t]) || p.types?.[0] || 'local_business';
      const type = typeMap[rawType] || rawType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
      return {
        name: p.name,
        type: type,
        address: p.formatted_address || '',
        phone: '',
        rating: p.rating || 0,
        reviewCount: p.user_ratings_total || 0,
        placeId: p.place_id
      };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ results })
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
