var http = require('http');

var PORT = 8098;

var server = http.createServer(function (req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // All endpoints return the same health response for now
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), url: req.url }));
});

server.listen(PORT, '127.0.0.1', function () {
    // Running
});

server.on('error', function () {
    // Ignore
});
