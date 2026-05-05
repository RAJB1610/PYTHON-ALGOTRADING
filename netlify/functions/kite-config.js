// Serves the public Kite API key to the frontend
// The API key is not secret (it appears in OAuth URLs) but keeping it
// server-side avoids Netlify's secrets scanner flagging it in HTML files

exports.handler = async () => ({
  statusCode: 200,
  headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  body: JSON.stringify({ apiKey: process.env.KITE_API_KEY || "" })
});
