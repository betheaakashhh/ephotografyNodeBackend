import http from 'http';

console.log('Testing connection to Python service...');

const req = http.request({
  hostname: '127.0.0.1',
  port: 7000,
  path: '/health',
  method: 'GET',
  timeout: 3000
}, (res) => {
  console.log(`✅ Connected! Status Code: ${res.statusCode}`);
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Response:', data));
});

req.on('error', (e) => {
  console.error(`❌ Connection Failed: ${e.code || e.message}`);
  console.log('This confirms the Node.js process cannot reach the service.');
});

req.end();