'use strict';

/**
 * TFlix Service — Backend proxy for cineby.at
 *
 * Runs as a TizenBrew service in a Node.js VM sandbox.
 * Bundled with @vercel/ncc into dist/service.js.
 *
 * IMPORTANT: No async/await, arrow functions, const/let, or template
 * literals — Tizen TVs may run Node.js 4.4.3 which only supports ES5.
 * All async operations use Promise .then() chains.
 *
 * Endpoints:
 *   GET /api/home          — trending, top-rated, genre rows
 *   GET /api/movie/:id     — movie detail (OG tags + embedded data)
 *   GET /api/search?q=     — search cineby.at
 *   GET /proxy/image?url=  — image proxy
 *   GET /proxy/video?url=  — video stream proxy (range requests)
 *   GET /api/health        — health check
 */

var express = require('express');
var fetch = require('node-fetch');
var app = express();
var PORT = 8098;

// ── Constants ────────────────────────────────────────────────────────────────

var CINEBY = 'https://www.cineby.at';
var UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 ' +
         '(KHTML, like Gecko) SamsungBrowser/4.0 Chrome/85.0.4183.303 TV Safari/537.36';

var CACHE_TTL = 5 * 60 * 1000; // 5 minutes
var homeCache = null;
var homeCacheTime = 0;

// TMDB genre ID → name
var GENRES = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
    80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
    14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
    9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
    53: 'Thriller', 10752: 'War', 37: 'Western'
};

// ── CORS ────────────────────────────────────────────────────────────────────

app.use(function (req, res, next) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        res.end();
        return;
    }
    next();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch a URL with TV browser-like headers. Returns a Promise.
 */
function fetchPage(url) {
    return fetch(url, {
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        },
        redirect: 'follow'
    }).then(function (resp) {
        return resp.text();
    });
}

/**
 * Extract __NEXT_DATA__ JSON from a Next.js SSR page.
 */
function extractNextData(html) {
    var match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
    if (!match) return null;
    try {
        return JSON.parse(match[1]);
    } catch (e) {
        return null;
    }
}

/**
 * Normalize movie objects from __NEXT_DATA__.
 */
function normalizeMovie(m) {
    if (!m) return null;
    return {
        id: m.id || '',
        title: m.title || m.name || '',
        slug: m.slug || m.id || '',
        poster: m.poster || m.image || '',
        backdrop: m.backdrop || '',
        rating: m.rating || m.vote_average || 0,
        year: m.release_date ? (m.release_date + '').slice(0, 4) : (m.year || ''),
        genres: (m.genre_ids || m.genres || []).map(function (g) {
            return typeof g === 'number' ? (GENRES[g] || 'Other') : (g.name || g);
        }),
        mediaType: m.mediaType || 'movie',
        overview: m.overview || m.description || ''
    };
}

// ── API: Home ───────────────────────────────────────────────────────────────

app.get('/api/home', function (req, res) {
    var now = Date.now();
    if (homeCache && (now - homeCacheTime) < CACHE_TTL) {
        res.json(homeCache);
        return;
    }

    fetchPage(CINEBY)
        .then(function (html) {
            var data = extractNextData(html);
            if (!data) {
                res.status(502).json({ error: 'Failed to parse cineby.at data' });
                return;
            }

            var pageProps = data.props && data.props.pageProps ? data.props.pageProps : {};
            var movies = (pageProps.initialGenreMovies || []).map(normalizeMovie).filter(Boolean);

            // Deduplicate by ID
            var seen = {};
            var unique = [];
            for (var i = 0; i < movies.length; i++) {
                if (!seen[movies[i].id]) {
                    seen[movies[i].id] = true;
                    unique.push(movies[i]);
                }
            }
            movies = unique;

            // Top rated
            var topRated = movies.slice().sort(function (a, b) { return b.rating - a.rating; }).slice(0, 20);

            // Genre rows (first 15 per genre)
            var genreRows = {};
            for (var j = 0; j < movies.length; j++) {
                var gs = movies[j].genres || [];
                for (var k = 0; k < gs.length; k++) {
                    var gn = gs[k];
                    if (!genreRows[gn]) genreRows[gn] = [];
                    if (genreRows[gn].length < 15) genreRows[gn].push(movies[j]);
                }
            }

            var genreRowsArr = [];
            var keys = Object.keys(genreRows).sort();
            for (var gi = 0; gi < keys.length; gi++) {
                genreRowsArr.push({ name: keys[gi], items: genreRows[keys[gi]] });
            }

            var result = {
                trending: movies.slice(0, 20),
                topRated: topRated,
                genreRows: genreRowsArr,
                total: movies.length
            };

            homeCache = result;
            homeCacheTime = now;
            res.json(result);
        })
        .catch(function (e) {
            res.status(500).json({ error: 'Internal error' });
        });
});

// ── API: Movie Detail ───────────────────────────────────────────────────────

app.get('/api/movie/:id', function (req, res) {
    var id = req.params.id;
    var url = CINEBY + '/movie/' + id;

    fetchPage(url)
        .then(function (html) {
            var movie = { id: id, url: url, title: '', description: '', poster: '', backdrop: '', year: '', rating: 0, genres: [], streamUrl: null, embedUrls: [] };

            // Extract OG meta tags
            var m;
            m = html.match(/<meta property="og:title" content="([^"]+)"/);
            if (m) movie.title = m[1];
            m = html.match(/<meta property="og:description" content="([^"]+)"/);
            if (m) movie.description = m[1];
            m = html.match(/<meta property="og:image" content="([^"]+)"/);
            if (m) movie.poster = m[1];

            // Also try twitter meta tags
            if (!movie.poster) {
                m = html.match(/<meta name="twitter:image" content="([^"]+)"/);
                if (m) movie.poster = m[1];
            }
            if (!movie.title) {
                m = html.match(/<meta name="twitter:title" content="([^"]+)"/);
                if (m) movie.title = m[1];
            }

            // Try __NEXT_DATA__ for any embedded info
            var data = extractNextData(html);
            if (data) {
                var pp = (data.props && data.props.pageProps) || {};
                if (pp.movie) {
                    var nm = normalizeMovie(pp.movie);
                    if (nm) {
                        movie.title = movie.title || nm.title;
                        movie.description = movie.description || nm.overview;
                        movie.poster = movie.poster || nm.poster;
                        movie.backdrop = movie.backdrop || nm.backdrop;
                        movie.rating = movie.rating || nm.rating;
                        movie.year = movie.year || nm.year;
                        movie.genres = movie.genres.length ? movie.genres : nm.genres;
                    }
                }
            }

            // Find iframe embeds (stream sources)
            var iframeRegex = /<iframe[^>]+src="([^"]+)"/gi;
            var iframeMatch;
            while ((iframeMatch = iframeRegex.exec(html)) !== null) {
                movie.embedUrls.push(iframeMatch[1]);
            }

            res.json(movie);
        })
        .catch(function (e) {
            res.status(500).json({ error: 'Internal error' });
        });
});

// ── API: Search ─────────────────────────────────────────────────────────────

app.get('/api/search', function (req, res) {
    var query = (req.query.q || '').trim();
    if (!query) {
        res.json({ query: query, results: [] });
        return;
    }

    var url = CINEBY + '/search?q=' + encodeURIComponent(query);

    fetchPage(url)
        .then(function (html) {
            var data = extractNextData(html);
            if (!data) {
                res.json({ query: query, results: [] });
                return;
            }

            var pp = data.props && data.props.pageProps ? data.props.pageProps : {};
            var raw = pp.searchResults || pp.movies || pp.results || [];
            var results = raw.map(normalizeMovie).filter(Boolean);

            res.json({ query: query, results: results });
        })
        .catch(function (e) {
            res.status(500).json({ error: 'Internal error' });
        });
});

// ── Proxy: Image ────────────────────────────────────────────────────────────

app.get('/proxy/image', function (req, res) {
    var url = req.query.url;
    if (!url) { res.status(400).end(); return; }

    fetch(url, {
        headers: { 'User-Agent': UA, 'Referer': CINEBY }
    })
        .then(function (resp) {
            if (!resp.ok) { res.status(resp.status).end(); return; }

            res.setHeader('Content-Type', resp.headers.get('content-type') || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=86400');
            resp.body.pipe(res);
        })
        .catch(function (e) {
            res.status(500).end();
        });
});

// ── Proxy: Video ────────────────────────────────────────────────────────────

app.get('/proxy/video', function (req, res) {
    var url = req.query.url;
    if (!url) { res.status(400).end(); return; }

    var headers = { 'User-Agent': UA, 'Referer': CINEBY };
    if (req.headers.range) headers['Range'] = req.headers.range;

    fetch(url, { headers: headers })
        .then(function (resp) {
            if (!resp.ok && resp.status !== 206) {
                res.status(resp.status).end();
                return;
            }

            if (resp.status === 206) res.status(206);
            res.setHeader('Content-Type', resp.headers.get('content-type') || 'video/mp4');
            res.setHeader('Accept-Ranges', 'bytes');

            var cr = resp.headers.get('content-range');
            if (cr) res.setHeader('Content-Range', cr);
            var cl = resp.headers.get('content-length');
            if (cl) res.setHeader('Content-Length', cl);

            resp.body.pipe(res);
        })
        .catch(function (e) {
            res.status(500).end();
        });
});

// ── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', function (req, res) {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Start ───────────────────────────────────────────────────────────────────

var server = app.listen(PORT, '127.0.0.1', function () {
    // Service is running
});

server.on('error', function (err) {
    // Port in use or permission denied — the UI will show connection error
});
