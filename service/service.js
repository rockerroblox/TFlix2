'use strict';

/**
 * TFlix Service — Backend proxy for cineby.at
 *
 * Runs as a TizenBrew service in a Node.js VM sandbox.
 * Built with Rollup + Babel into dist/service.js.
 *
 * IMPORTANT: Uses only built-in Node.js modules (http, https, url, etc.).
 * No node-fetch — TizenBrew's VM sandbox excludes `global`,
 * and node-fetch uses `global.Promise` at module init, causing
 * ReferenceError before Express can start.
 *
 * Endpoints:
 *   GET /api/home          — trending, top-rated, genre rows
 *   GET /api/movie/:id     — movie detail (OG tags + embedded data)
 *   GET /api/search?q=     — search cineby.at
 *   GET /proxy/image?url=  — image proxy
 *   GET /proxy/video?url=  — video stream proxy (range requests)
 *   GET /api/health        — health check
 */

// ── Imports ──────────────────────────────────────────────────────────────────

import express from 'express';
import https from 'https';
import http from 'http';
import url from 'url';

const app = express();
const PORT = 8098;

// ── Constants ────────────────────────────────────────────────────────────────

const CINEBY = 'https://www.cineby.at';
const UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) SamsungBrowser/4.0 Chrome/85.0.4183.303 TV Safari/537.36';

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let homeCache = null;
let homeCacheTime = 0;

// TMDB genre ID → name
const GENRES = {
    28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
    80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
    14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
    9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi', 10770: 'TV Movie',
    53: 'Thriller', 10752: 'War', 37: 'Western'
};

// ── HTTP Fetch (built-in http/https — no node-fetch, no global.Promise issue) ─

const REDIRECT_CODES = [301, 302, 303, 307, 308];

function httpFetch(fetchUrl, opts = {}) {
    return new Promise((resolve, reject) => {
        const parsed = url.parse(fetchUrl);
        const mod = parsed.protocol === 'https:' ? https : http;
        const reqOpts = {
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: parsed.path,
            method: 'GET',
            headers: opts.headers || {},
            rejectUnauthorized: false
        };

        const req = mod.request(reqOpts, (res) => {
            // Follow redirects
            const isRedirect = REDIRECT_CODES.indexOf(res.statusCode) >= 0;
            if (opts.redirect === 'follow' && isRedirect && res.headers.location) {
                res.resume(); // Drain the body so the socket is freed
                resolve(httpFetch(res.headers.location, opts));
                return;
            }

            const status = res.statusCode;

            const response = {
                status,
                ok: status >= 200 && status < 300,
                headers: {
                    get(name) {
                        const lower = name.toLowerCase();
                        const keys = Object.keys(res.headers);
                        for (let i = 0; i < keys.length; i++) {
                            if (keys[i].toLowerCase() === lower) {
                                return res.headers[keys[i]];
                            }
                        }
                        return null;
                    }
                },
                // Raw stream — for image/video proxy piping
                body: res,
                // Lazily-read body text — only consumed if .text() is called
                _bodyText: null,
                text() {
                    if (this._bodyText !== null) {
                        return Promise.resolve(this._bodyText);
                    }
                    return new Promise((resolveText, rejectText) => {
                        const chunks = [];
                        res.on('data', (chunk) => chunks.push(chunk));
                        res.on('end', () => {
                            this._bodyText = Buffer.concat(chunks).toString('utf8');
                            resolveText(this._bodyText);
                        });
                        res.on('error', rejectText);
                    });
                }
            };
            resolve(response);
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.abort();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

// ── CORS ────────────────────────────────────────────────────────────────────

app.use((req, res, next) => {
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
 * Fetch a URL with TV browser-like headers. Returns a Promise<string>.
 */
function fetchPage(fetchUrl) {
    return httpFetch(fetchUrl, {
        headers: {
            'User-Agent': UA,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5'
        },
        redirect: 'follow'
    }).then(resp => resp.text());
}

/**
 * Extract __NEXT_DATA__ JSON from a Next.js SSR page.
 */
function extractNextData(html) {
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
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
        year: m.release_date
            ? String(m.release_date).slice(0, 4)
            : (m.year || ''),
        genres: (m.genre_ids || m.genres || []).map(g =>
            typeof g === 'number' ? (GENRES[g] || 'Other') : (g.name || g)
        ),
        mediaType: m.mediaType || 'movie',
        overview: m.overview || m.description || ''
    };
}

// ── API: Home ───────────────────────────────────────────────────────────────

app.get('/api/home', (req, res) => {
    const now = Date.now();
    if (homeCache && (now - homeCacheTime) < CACHE_TTL) {
        res.json(homeCache);
        return;
    }

    fetchPage(CINEBY)
        .then(html => {
            const data = extractNextData(html);
            if (!data) {
                res.status(502).json({ error: 'Failed to parse cineby.at data' });
                return;
            }

            const pageProps = (data.props && data.props.pageProps) || {};
            let movies = (pageProps.initialGenreMovies || [])
                .map(normalizeMovie)
                .filter(Boolean);

            // Deduplicate by ID
            const seen = {};
            const unique = [];
            for (let i = 0; i < movies.length; i++) {
                if (!seen[movies[i].id]) {
                    seen[movies[i].id] = true;
                    unique.push(movies[i]);
                }
            }
            movies = unique;

            // Top rated
            const topRated = movies.slice().sort(
                (a, b) => b.rating - a.rating
            ).slice(0, 20);

            // Genre rows (first 15 per genre)
            const genreRows = {};
            for (let j = 0; j < movies.length; j++) {
                const gs = movies[j].genres || [];
                for (let k = 0; k < gs.length; k++) {
                    const gn = gs[k];
                    if (!genreRows[gn]) genreRows[gn] = [];
                    if (genreRows[gn].length < 15) {
                        genreRows[gn].push(movies[j]);
                    }
                }
            }

            const genreRowsArr = [];
            const keys = Object.keys(genreRows).sort();
            for (let gi = 0; gi < keys.length; gi++) {
                genreRowsArr.push({
                    name: keys[gi],
                    items: genreRows[keys[gi]]
                });
            }

            const result = {
                trending: movies.slice(0, 20),
                topRated,
                genreRows: genreRowsArr,
                total: movies.length
            };

            homeCache = result;
            homeCacheTime = now;
            res.json(result);
        })
        .catch(e => {
            res.status(500).json({ error: 'Internal error' });
        });
});

// ── API: Movie Detail ───────────────────────────────────────────────────────

app.get('/api/movie/:id', (req, res) => {
    const id = req.params.id;
    const fetchUrl = CINEBY + '/movie/' + id;

    fetchPage(fetchUrl)
        .then(html => {
            const movie = {
                id, url: fetchUrl,
                title: '', description: '', poster: '', backdrop: '',
                year: '', rating: 0, genres: [],
                streamUrl: null, embedUrls: []
            };

            // Extract OG meta tags
            let m;
            m = html.match(/<meta property="og:title" content="([^"]+)"/);
            if (m) movie.title = m[1];
            m = html.match(/<meta property="og:description" content="([^"]+)"/);
            if (m) movie.description = m[1];
            m = html.match(/<meta property="og:image" content="([^"]+)"/);
            if (m) movie.poster = m[1];

            // Twitter fallbacks
            if (!movie.poster) {
                m = html.match(/<meta name="twitter:image" content="([^"]+)"/);
                if (m) movie.poster = m[1];
            }
            if (!movie.title) {
                m = html.match(/<meta name="twitter:title" content="([^"]+)"/);
                if (m) movie.title = m[1];
            }

            // Try __NEXT_DATA__ for embedded info
            const data = extractNextData(html);
            if (data) {
                const pp = (data.props && data.props.pageProps) || {};
                if (pp.movie) {
                    const nm = normalizeMovie(pp.movie);
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
            const iframeRegex = /<iframe[^>]+src="([^"]+)"/gi;
            let iframeMatch;
            while ((iframeMatch = iframeRegex.exec(html)) !== null) {
                movie.embedUrls.push(iframeMatch[1]);
            }

            res.json(movie);
        })
        .catch(e => {
            res.status(500).json({ error: 'Internal error' });
        });
});

// ── API: Search ─────────────────────────────────────────────────────────────

app.get('/api/search', (req, res) => {
    const query = (req.query.q || '').trim();
    if (!query) {
        res.json({ query, results: [] });
        return;
    }

    const fetchUrl = CINEBY + '/search?q=' + encodeURIComponent(query);

    fetchPage(fetchUrl)
        .then(html => {
            const data = extractNextData(html);
            if (!data) {
                res.json({ query, results: [] });
                return;
            }

            const pp = (data.props && data.props.pageProps) || {};
            const raw = pp.searchResults || pp.movies || pp.results || [];
            const results = raw.map(normalizeMovie).filter(Boolean);

            res.json({ query, results });
        })
        .catch(e => {
            res.status(500).json({ error: 'Internal error' });
        });
});

// ── Proxy: Image ────────────────────────────────────────────────────────────

app.get('/proxy/image', (req, res) => {
    const proxyUrl = req.query.url;
    if (!proxyUrl) {
        res.status(400).end();
        return;
    }

    httpFetch(proxyUrl, {
        headers: { 'User-Agent': UA, 'Referer': CINEBY },
        redirect: 'follow'
    })
        .then(resp => {
            if (!resp.ok) {
                res.status(resp.status).end();
                return;
            }

            res.setHeader(
                'Content-Type',
                resp.headers.get('content-type') || 'image/jpeg'
            );
            res.setHeader('Cache-Control', 'public, max-age=86400');
            resp.body.pipe(res);
        })
        .catch(e => {
            res.status(500).end();
        });
});

// ── Proxy: Video ────────────────────────────────────────────────────────────

app.get('/proxy/video', (req, res) => {
    const proxyUrl = req.query.url;
    if (!proxyUrl) {
        res.status(400).end();
        return;
    }

    const headers = { 'User-Agent': UA, 'Referer': CINEBY };
    if (req.headers.range) {
        headers['Range'] = req.headers.range;
    }

    httpFetch(proxyUrl, { headers, redirect: 'follow' })
        .then(resp => {
            if (!resp.ok && resp.status !== 206) {
                res.status(resp.status).end();
                return;
            }

            if (resp.status === 206) res.status(206);
            res.setHeader(
                'Content-Type',
                resp.headers.get('content-type') || 'video/mp4'
            );
            res.setHeader('Accept-Ranges', 'bytes');

            const cr = resp.headers.get('content-range');
            if (cr) res.setHeader('Content-Range', cr);
            const cl = resp.headers.get('content-length');
            if (cl) res.setHeader('Content-Length', cl);

            resp.body.pipe(res);
        })
        .catch(e => {
            res.status(500).end();
        });
});

// ── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});

// ── Start ───────────────────────────────────────────────────────────────────

const server = app.listen(PORT, '127.0.0.1', () => {
    console.log('[TFlix] Service started on http://127.0.0.1:' + PORT);
});

server.on('error', (err) => {
    console.error('[TFlix] Failed to start:', err.message || err);
});
