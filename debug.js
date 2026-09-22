const https = require('https');

exports.handler = async function(event, context) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const key = process.env.GOOGLE_PLACES_API_KEY;

  // Check 1: Is the key even set?
  if (!key) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        step: 'ENV CHECK', 
        status: 'FAIL', 
        message: 'GOOGLE_PLACES_API_KEY is not set in environment variables' 
      })
    };
  }

  // Check 2: Does the key look right?
  if (!key.startsWith('AIza')) {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({ 
        step: 'KEY FORMAT', 
        status: 'FAIL', 
        message: `Key doesn't start with AIza. Starts with: ${key.substring(0, 6)}`,
        keyLength: key.length
      })
    };
  }

  // Check 3: Test Geocoding API with a known ZIP
  const geoResult = await new Promise((resolve) => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=95117&key=${key}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ error: 'parse error', raw: data.substring(0, 200) }); }
      });
    }).on('error', (e) => resolve({ error: e.message }));
  });

  if (geoResult.status !== 'OK') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        step: 'GEOCODING TEST',
        status: 'FAIL',
        googleStatus: geoResult.status,
        errorMessage: geoResult.error_message || 'No error message',
        keyFirstChars: key.substring(0, 10) + '...',
        keyLength: key.length
      })
    };
  }

  // Check 4: Test Places API
  const lat = geoResult.results[0].geometry.location.lat;
  const lng = geoResult.results[0].geometry.location.lng;

  const placesResult = await new Promise((resolve) => {
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=1000&type=restaurant&key=${key}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve({ error: 'parse error' }); }
      });
    }).on('error', (e) => resolve({ error: e.message }));
  });

  return {
    statusCode: 200,
    headers: corsHeaders,
    body: JSON.stringify({
      step: 'ALL CHECKS',
      geocoding: 'PASS',
      places: placesResult.status === 'OK' ? 'PASS' : 'FAIL',
      placesStatus: placesResult.status,
      placesError: placesResult.error_message || null,
      keyFirstChars: key.substring(0, 10) + '...',
      keyLength: key.length,
      resultsFound: placesResult.results ? placesResult.results.length : 0
    })
  };
};
