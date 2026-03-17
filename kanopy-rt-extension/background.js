// Background script to handle RT and Letterboxd API calls
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getScores') {
        getMovieScores(request.title, request.year)
            .then(scores => {
                sendResponse({ success: true, scores });
            })
            .catch(error => {
                console.error('Background script error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Will respond asynchronously
    }

    if (request.action === 'getRTScores') {
        getRottenTomatoesScores(request.title, request.year)
            .then((scores) => sendResponse({ success: true, scores }))
            .catch((error) => {
                console.error('Background script RT error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }

    if (request.action === 'getLetterboxdScores') {
        getLetterboxdScores(request.title, request.year)
            .then((scores) => sendResponse({ success: true, scores }))
            .catch((error) => {
                console.error('Background script Letterboxd error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true;
    }
});

const scoreCache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function normalizeTitleForMatch(rawTitle) {
    if (!rawTitle) return '';
    return String(rawTitle)
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function tokenizeTitle(normalizedTitle) {
    if (!normalizedTitle) return [];
    const drop = new Set(['the', 'a', 'an', 'and', 'of', 'to', 'in', 'on', 'for', 'with']);
    return normalizedTitle
        .split(' ')
        .map(t => t.trim())
        .filter(Boolean)
        .filter(t => t.length > 1)
        .filter(t => !drop.has(t));
}

function jaccardSimilarity(aTokens, bTokens) {
    const a = new Set(aTokens);
    const b = new Set(bTokens);
    if (a.size === 0 || b.size === 0) return 0;
    let intersection = 0;
    for (const t of a) if (b.has(t)) intersection += 1;
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

function parseYearFromText(text) {
    if (!text) return null;
    const match = String(text).match(/\b(19|20)\d{2}\b/);
    if (!match) return null;
    const yearNum = Number(match[0]);
    const currentYear = new Date().getFullYear() + 1;
    if (yearNum < 1870 || yearNum > currentYear) return null;
    return String(yearNum);
}

function computeCandidateScore({ targetTitle, targetYear, candidateTitle, candidateYear }) {
    const targetNorm = normalizeTitleForMatch(targetTitle);
    const candNorm = normalizeTitleForMatch(candidateTitle);

    const targetTokens = tokenizeTitle(targetNorm);
    const candTokens = tokenizeTitle(candNorm);

    const tokenSim = jaccardSimilarity(targetTokens, candTokens);
    const exactNorm = targetNorm && candNorm && targetNorm === candNorm;

    let yearScore = 0;
    if (targetYear && candidateYear) {
        const diff = Math.abs(Number(targetYear) - Number(candidateYear));
        if (diff === 0) yearScore = 1;
        else if (diff === 1) yearScore = 0.6; // festival vs wide release drift
        else if (diff === 2) yearScore = 0.2;
        else yearScore = -0.5;
    } else if (!targetYear) {
        yearScore = 0.2; // don’t penalize missing year input
    }

    // Weighted score: title match dominates, year helps disambiguate
    const titleScore = (exactNorm ? 1 : tokenSim);
    return (titleScore * 10) + (yearScore * 3);
}

function pickBestCandidate(candidates, targetTitle, targetYear) {
    let best = null;
    let bestScore = -Infinity;
    for (const candidate of candidates) {
        const score = computeCandidateScore({
            targetTitle,
            targetYear,
            candidateTitle: candidate.title,
            candidateYear: candidate.year
        });
        if (score > bestScore) {
            bestScore = score;
            best = { ...candidate, score };
        }
    }
    return best;
}

async function getMovieScores(title, year) {
    try {
        console.log('Getting movie scores for:', title, year);

        const cacheKey = `${normalizeTitleForMatch(title)}|${year || ''}`;
        const cached = scoreCache.get(cacheKey);
        if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
            console.log('Returning cached scores for:', cacheKey);
            return cached.scores;
        }
        
        // Get both RT and Letterboxd scores in parallel
        const [rtScores, letterboxdScores] = await Promise.allSettled([
            getRottenTomatoesScores(title, year),
            getLetterboxdScores(title, year)
        ]);

        console.log('RT scores result:', rtScores);
        console.log('Letterboxd scores result:', letterboxdScores);

        const scores = {
            rt: rtScores.status === 'fulfilled' ? rtScores.value : null,
            letterboxd: letterboxdScores.status === 'fulfilled' ? letterboxdScores.value : null
        };

        console.log('Combined scores:', scores);

        scoreCache.set(cacheKey, { ts: Date.now(), scores });
        return scores;

    } catch (error) {
        console.error('Error getting movie scores:', error);
        throw error;
    }
}

async function getLetterboxdScores(title, year) {
    try {
        console.log('getLetterboxdScores called with title:', title, 'year:', year);

        const fetchTextWithTimeout = async (url, timeoutMs) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetch(url, {
                    signal: controller.signal,
                    credentials: 'omit',
                    redirect: 'follow',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                return await response.text();
            } catch (e) {
                if (e && (e.name === 'AbortError' || String(e).toLowerCase().includes('aborted'))) {
                    throw new Error(`timeout after ${timeoutMs}ms`);
                }
                throw e;
            } finally {
                clearTimeout(timeoutId);
            }
        };

        const fetchLetterboxdHtml = async (pathOrUrl) => {
            const absoluteUrl = pathOrUrl.startsWith('http')
                ? pathOrUrl
                : `https://letterboxd.com${pathOrUrl}`;

            // Prefer proxy fetch (avoids CORS). Do NOT fallback to direct fetch:
            // browser extensions will be blocked by Letterboxd CORS in practice.
            const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(absoluteUrl)}`;

            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const attempts = [
                { timeoutMs: 12000, label: 'allorigins-12s' },
                { timeoutMs: 20000, label: 'allorigins-20s' },
                { timeoutMs: 30000, label: 'allorigins-30s' }
            ];

            let lastError = null;
            for (let round = 1; round <= 3; round++) {
                for (const attempt of attempts) {
                    try {
                        const html = await fetchTextWithTimeout(allOriginsUrl, attempt.timeoutMs);
                        if (html && html.length > 1000) return html;
                        lastError = new Error('empty response');
                    } catch (e) {
                        lastError = e;
                        console.log(`Proxy Letterboxd fetch failed (${attempt.label}, round ${round}/3):`, e.message);
                        // If AllOrigins is returning a gateway/timeout, give it a short breather and retry.
                        if (String(e?.message || '').includes('HTTP 522') || String(e?.message || '').includes('HTTP 5')) {
                            await sleep(400 * round);
                        }
                    }
                }
            }

            throw lastError || new Error('Proxy Letterboxd fetch failed');
        };

        const isCloudflareBlockPage = (html) => {
            if (!html) return false;
            const lower = String(html).toLowerCase();
            return lower.includes('just a moment') && lower.includes('cf-chl');
        };

        const isLikelyLetterboxdFilmPage = (html) => {
            if (!html) return false;
            const lower = String(html).toLowerCase();
            return (
                lower.includes('property="og:type" content="video.movie"') ||
                lower.includes('"@type":"movie"') ||
                lower.includes('"@type": "movie"') ||
                lower.includes('data-track-action="film"') ||
                lower.includes('"/film/')
            );
        };

        const slugifyLetterboxdTitle = (rawTitle) => {
            if (!rawTitle) return '';

            // Kanopy/metadata sometimes includes year or suffixes; remove common noise before slugging
            const withoutYear = String(rawTitle)
                .replace(/\s*\(\s*(19|20)\d{2}\s*\)\s*$/g, '')
                .replace(/\s+\b(19|20)\d{2}\b\s*$/g, '')
                .replace(/\s*[-–—]\s*kanopy\s*$/i, '')
                .replace(/\s*\|\s*kanopy\s*$/i, '')
                .trim();

            // Slugs usually omit subtitles, but keep the main title portion
            const mainTitle = withoutYear.split(':')[0].trim();

            const normalized = normalizeTitleForMatch(mainTitle)
                .replace(/\s+/g, ' ')
                .trim();

            // Letterboxd slugs are usually close to this; we still verify by fetching.
            return normalized
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, '-')
                .replace(/-+/g, '-')
                .replace(/^-|-$/g, '');
        };

        // Prefer a direct film page fetch (more likely to work than search if search is blocked)
        const directSlug = slugifyLetterboxdTitle(title);
        const directPath = directSlug ? `/film/${directSlug}/` : null;

        if (directPath) {
            console.log('Trying direct Letterboxd film URL:', directPath);

            try {
                const directHtml = await fetchLetterboxdHtml(directPath);
                if (!isCloudflareBlockPage(directHtml) && directHtml.length > 5000) {
                    console.log('Direct Letterboxd film page worked:', directPath);
                    return extractLetterboxdScores(directHtml);
                }

                console.log('Direct Letterboxd film page looked blocked/invalid, trying slug variants');
            } catch (e) {
                console.log('Direct Letterboxd film page error:', e.message);
            }
        }

        const buildSlugVariants = (rawTitle) => {
            if (!rawTitle) return [];

            const withoutYear = String(rawTitle)
                .replace(/\s*\(\s*(19|20)\d{2}\s*\)\s*$/g, '')
                .replace(/\s+\b(19|20)\d{2}\b\s*$/g, '')
                .trim();

            const mainTitle = withoutYear.split(':')[0].trim();
            const fullTitle = withoutYear.trim();

            const baseVariants = [
                slugifyLetterboxdTitle(mainTitle),
                slugifyLetterboxdTitle(fullTitle),
                // Sometimes Kanopy includes alternate title in parentheses, keep a version without parens content
                slugifyLetterboxdTitle(withoutYear.replace(/\s*\([^)]*\)\s*/g, ' ').trim())
            ].filter(Boolean);

            const variants = [...baseVariants];

            // Some Letterboxd slugs include the year suffix (e.g. rabbit-trap-2025).
            const inferredYear = (year && /^\d{4}$/.test(String(year)) ? String(year) : null) ||
                parseYearFromText(rawTitle) ||
                parseYearFromText(withoutYear);

            if (inferredYear) {
                for (const base of baseVariants) {
                    variants.push(`${base}-${inferredYear}`);
                }
            }

            return Array.from(new Set(variants.filter(Boolean)));
        };

        const slugVariants = buildSlugVariants(title);
        for (const slug of slugVariants) {
            const path = `/film/${slug}/`;
            console.log('Trying Letterboxd slug variant:', path);
            try {
                const html = await fetchLetterboxdHtml(path);
                if (isCloudflareBlockPage(html) || html.length < 5000) continue;
                if (!isLikelyLetterboxdFilmPage(html)) {
                    console.log('Slug variant did not return a film page, continuing:', path);
                    continue;
                }

                const parsed = extractLetterboxdScores(html);
                if (parsed && parsed.rating != null) return parsed;

                console.log('Film page found but rating missing, continuing:', path);
                continue;
            } catch (e) {
                console.log('Letterboxd slug variant failed:', path, e.message);
            }
        }

        return null;
        
    } catch (error) {
        console.error('Letterboxd API Error:', error);
        throw error;
    }
}

function extractLetterboxdCandidates(html) {
    const candidates = [];

    const safeSubstring = (start, end) => html.substring(Math.max(0, start), Math.min(html.length, end));

    // Primary: hrefs to film pages (with or without trailing slash, relative or absolute)
    const hrefPatterns = [
        /href="(\/film\/[^"?#]+\/?)"/gi,
        /href="(https?:\/\/letterboxd\.com\/film\/[^"?#]+\/?)"/gi,
        /href="(https?:\/\/www\.letterboxd\.com\/film\/[^"?#]+\/?)"/gi
    ];

    let matches = [];
    for (const p of hrefPatterns) matches = matches.concat([...html.matchAll(p)]);

    for (const match of matches) {
        const rawUrl = match[1];
        const url = rawUrl.startsWith('http')
            ? rawUrl.replace(/^https?:\/\/(?:www\.)?letterboxd\.com/i, '')
            : rawUrl;

        const matchIndex = match.index || 0;
        const context = safeSubstring(matchIndex - 800, matchIndex + 800);

        const year = parseYearFromText(context);

        // Try multiple title signals near the match
        const titleMatch =
            context.match(/data-film-name="([^"]{1,140})"/i) ||
            context.match(/alt="([^"]{1,140})"/i) ||
            context.match(/title="([^"]{1,140})"/i) ||
            context.match(/class="[^"]*(?:film-title|title|headline)[^"]*"[^>]*>\s*([^<]{1,140})\s*</i);

        const title = titleMatch ? titleMatch[1].trim() : null;
        candidates.push({ url: url.endsWith('/') ? url : `${url}/`, title: title || url, year });
    }

    // Fallback: if markup changes and hrefs disappear, extract film slugs anywhere
    if (candidates.length === 0) {
        const slugMatches = [...html.matchAll(/\/film\/([a-z0-9][a-z0-9-]*)\/?/gi)];
        for (const match of slugMatches) {
            const slug = match[1];
            const matchIndex = match.index || 0;
            const context = safeSubstring(matchIndex - 800, matchIndex + 800);
            const year = parseYearFromText(context);

            const titleMatch =
                context.match(/data-film-name="([^"]{1,140})"/i) ||
                context.match(/alt="([^"]{1,140})"/i) ||
                context.match(/title="([^"]{1,140})"/i);

            const title = titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' ');
            candidates.push({ url: `/film/${slug}/`, title, year });
        }
    }

    // de-dupe by url
    const seen = new Set();
    return candidates.filter((c) => {
        if (!c.url) return false;
        if (seen.has(c.url)) return false;
        seen.add(c.url);
        return true;
    });
}

function extractLetterboxdScores(html) {
    const isValidLetterboxdRating = (value) => {
        const num = Number(value);
        return Number.isFinite(num) && num >= 0.5 && num <= 5.0;
    };

    // Fast path: JSON-LD (Letterboxd reliably includes aggregateRating.ratingValue)
    const jsonLdBlocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)]
        .map((m) => m[1])
        .filter(Boolean);

    for (const rawBlock of jsonLdBlocks) {
        const cleaned = rawBlock
            .replace(/\/\*\s*<!\[CDATA\[\s*\*\//g, '')
            .replace(/\/\*\s*\]\]>\s*\*\//g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .trim();

        if (!cleaned) continue;

        // Try strict JSON parse first
        try {
            const parsed = JSON.parse(cleaned);
            const ratingValue = parsed?.aggregateRating?.ratingValue;
            if (isValidLetterboxdRating(ratingValue)) {
                return { rating: Number(ratingValue) };
            }
        } catch {
            // Fall through to regex extraction below
        }

        // Regex fallback: pull ratingValue without requiring valid JSON
        const ratingMatch =
            cleaned.match(/"aggregateRating"\s*:\s*\{[\s\S]*?"ratingValue"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i) ||
            cleaned.match(/"ratingValue"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);

        if (ratingMatch && isValidLetterboxdRating(ratingMatch[1])) {
            return { rating: Number(ratingMatch[1]) };
        }
    }

    // Last-resort fallback: look for a nearby aggregateRating snippet in page HTML
    const inlineMatch =
        html.match(/"aggregateRating"\s*:\s*\{[\s\S]*?"ratingValue"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i) ||
        html.match(/"ratingValue"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);

    if (inlineMatch && isValidLetterboxdRating(inlineMatch[1])) {
        return { rating: Number(inlineMatch[1]) };
    }

    return { rating: null };
}

async function getRottenTomatoesScores(title, year) {
    try {
        // Search Rotten Tomatoes, then pick the best candidate using title similarity + soft year
        const searchTerms = [
            title,  // Search without year first
            title.replace(/\s+/g, ' ').trim()
        ];
        
        let movieUrl = null;
        let searchHtml = '';
        
        for (const searchTerm of searchTerms) {
            const searchUrl = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(searchTerm)}`;
            console.log('Trying search:', searchUrl);
            console.log('Searching for:', searchTerm, 'year:', year);
            
            const searchResponse = await fetch(searchUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                }
            });
            
            if (!searchResponse.ok) {
                console.log(`Search failed for "${searchTerm}": ${searchResponse.status}`);
                continue;
            }
            
            searchHtml = await searchResponse.text();
            console.log('Search HTML length:', searchHtml.length);
            
            movieUrl = findBestRtMovieUrl(searchHtml, title, year || null);
            
            if (movieUrl) {
                console.log('Found movie URL with search term:', searchTerm);
                break;
            }
        }
        
        // Avoid direct URL guessing here; RT slugs are not reliably derivable from titles.
        
        if (!movieUrl) {
            console.log('No movie URL found after trying all search terms. Search HTML preview:', searchHtml.substring(0, 1000));
            throw new Error('Movie not found on Rotten Tomatoes');
        }
        
        console.log('Found movie URL:', movieUrl);
        
        // Get movie page
        const fullUrl = movieUrl.startsWith('http') ? movieUrl : `https://www.rottentomatoes.com${movieUrl}`;
        const movieResponse = await fetch(fullUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        if (!movieResponse.ok) {
            throw new Error(`Movie page failed: ${movieResponse.status}`);
        }
        
        const movieHtml = await movieResponse.text();
        console.log('RT page HTML length:', movieHtml.length);
        console.log('RT HTML preview (first 2000 chars):', movieHtml.substring(0, 2000));
        
        // Debug: Look for score-related content
        const scoreMatches = movieHtml.match(/(\d+)%[^<]*(?:tomatometer|popcornmeter|audience|critic)/gi);
        console.log('Score matches found:', scoreMatches);
        
        // Debug: Look for specific RT score patterns
        const tomatoMatches = movieHtml.match(/(\d+)%[^<]*tomatometer/gi);
        console.log('Tomatometer matches found:', tomatoMatches);
        
        const popcornMatches = movieHtml.match(/(\d+)%[^<]*popcornmeter/gi);
        console.log('Popcornmeter matches found:', popcornMatches);
        
        // Debug: Look for the specific text "94%" and "77%" 
        const ninetyFourMatch = movieHtml.includes('94%');
        const seventySevenMatch = movieHtml.includes('77%');
        console.log('HTML contains 94%:', ninetyFourMatch);
        console.log('HTML contains 77%:', seventySevenMatch);
        
        return extractScores(movieHtml);
        
    } catch (error) {
        console.error('RT API Error:', error);
        throw error;
    }
}

function extractRtCandidates(html) {
    const candidates = [];

    // Prefer the modern RT search results component:
    // <search-page-media-row release-year="2024"> ... <a data-qa="info-name">The Life of Chuck</a>
    const rowPattern = /<search-page-media-row\b[\s\S]*?<\/search-page-media-row>/gi;
    const rows = [...html.matchAll(rowPattern)].map(m => m[0]);

    for (const rowHtml of rows) {
        const hrefMatch = rowHtml.match(/href="(https?:\/\/www\.rottentomatoes\.com\/(?:m|movie)\/[^"?#]+)"/i);
        const titleMatch = rowHtml.match(/data-qa="info-name"[^>]*>\s*([^<]{1,180})\s*</i);
        const yearMatch = rowHtml.match(/\brelease-year="(\d{4})"/i);

        if (!hrefMatch) continue;
        const url = hrefMatch[1];
        const title = titleMatch ? titleMatch[1].trim() : url;
        const year = yearMatch ? yearMatch[1] : null;

        candidates.push({ url, title, year });
    }

    // Fallback for older markup: grab RT links (including absolute URLs) with nearby context.
    if (candidates.length === 0) {
        const patterns = [
            /href="(https?:\/\/www\.rottentomatoes\.com\/m\/[^"?#]+)"/g,
            /href="(https?:\/\/www\.rottentomatoes\.com\/movie\/[^"?#]+)"/g,
            /href="(\/m\/[^"?#]+)"/g,
            /href="(\/movie\/[^"?#]+)"/g
        ];

        let matches = [];
        for (const pattern of patterns) matches = matches.concat([...html.matchAll(pattern)]);

        for (const match of matches) {
            const url = match[1];
            const matchIndex = match.index || 0;
            const start = Math.max(0, matchIndex - 900);
            const end = Math.min(html.length, matchIndex + 900);
            const context = html.substring(start, end);

            const year =
                (context.match(/\brelease-year="(\d{4})"/i) || [])[1] ||
                (context.match(/data-qa="info-year"[^>]*>\((\d{4})\)</) || [])[1] ||
                (context.match(/\((\d{4})\)/) || [])[1] ||
                parseYearFromText(context);

            const titleMatch =
                context.match(/data-qa="info-name"[^>]*>\s*([^<]{1,180})\s*</i) ||
                context.match(/data-qa="search-result-title"[^>]*>\s*([^<]{1,180})\s*</i);

            const title = titleMatch ? titleMatch[1].trim() : url;
            candidates.push({ url, title, year: year || null });
        }
    }

    const seen = new Set();
    return candidates.filter((c) => {
        const key = c.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function findBestRtMovieUrl(html, title, year) {
    console.log('Finding best RT movie URL for:', title, year);
    const candidates = extractRtCandidates(html);
    const best = pickBestCandidate(candidates, title, year);
    if (!best || !best.url) return null;

    // Guardrail: don’t return low-confidence matches
    // Typical good matches are ~10-13; random matches are much lower.
    if (typeof best.score === 'number' && best.score < 6) {
        console.log('RT best candidate below threshold:', best);
        return null;
    }

    console.log('Picked RT candidate:', best);
    return best.url;
}

function extractScores(html) {
    let tomatoScore = null;
    let popcornScore = null;
    
    console.log('Extracting RT scores from HTML...');

    // Prefer parsing the embedded scorecard JSON if present (most reliable),
    // and prefer VERIFIED audience score over ALL audience score.
    try {
        const scorecardJsonMatch = html.match(/<script[^>]*id="media-scorecard-json"[^>]*>\s*({[\s\S]*?})\s*<\/script>/i);
        if (scorecardJsonMatch && scorecardJsonMatch[1]) {
            const scorecard = JSON.parse(scorecardJsonMatch[1]);

            const criticsPercent =
                scorecard?.criticsScore?.scorePercent ||
                scorecard?.criticsAll?.scorePercent ||
                (scorecard?.criticsScore?.score ? `${scorecard.criticsScore.score}%` : null) ||
                (scorecard?.criticsAll?.score ? `${scorecard.criticsAll.score}%` : null);

            const audiencePercent =
                scorecard?.audienceVerified?.scorePercent ||
                scorecard?.audienceScore?.scorePercent ||
                scorecard?.audienceAll?.scorePercent ||
                (scorecard?.audienceVerified?.score ? `${scorecard.audienceVerified.score}%` : null) ||
                (scorecard?.audienceScore?.score ? `${scorecard.audienceScore.score}%` : null) ||
                (scorecard?.audienceAll?.score ? `${scorecard.audienceAll.score}%` : null);

            if (criticsPercent && /^\d{1,3}%$/.test(criticsPercent)) tomatoScore = criticsPercent;
            if (audiencePercent && /^\d{1,3}%$/.test(audiencePercent)) popcornScore = audiencePercent;

            if (tomatoScore || popcornScore) {
                console.log('Extracted scores from media-scorecard JSON:', { tomatoScore, popcornScore });
                return { critics: tomatoScore, audience: popcornScore };
            }
        }
    } catch (e) {
        console.log('Scorecard JSON parse failed, falling back to regex:', e.message);
    }
    
    // Debug: Look for all percentage values in the HTML
    const allPercentages = html.match(/(\d+)%/g);
    console.log('All percentages found:', allPercentages ? allPercentages.slice(0, 10) : 'None');
    
    // Look for the specific score display pattern from the RT page
    // Based on the C'mon C'mon page: "94% Tomatometer" and "77% Popcornmeter"
    const tomatoPatterns = [
        // Look for "X% Tomatometer" pattern (most specific) - but ensure it's not popcornmeter
        /(\d+)%\s*Tomatometer(?!\s*.*Popcornmeter)/i,
        // Look for Tomatometer followed by percentage
        /Tomatometer[^<]*?(\d+)%/i,
        // Look for data-testid specifically for tomatometer
        /data-testid="tomatometer[^"]*"[^>]*>.*?(\d+)%/i,
        // Look for class specifically for tomatometer
        /class="[^"]*tomatometer[^"]*"[^>]*>.*?(\d+)%/i,
        // JSON patterns for critics
        /"tomatometer":\s*(\d+)/,
        /"critics?":\s*(\d+)/
    ];
    
    const popcornPatterns = [
        // Look for "X% Popcornmeter" pattern (most specific)
        /(\d+)%\s*Popcornmeter/i,
        // Look for Popcornmeter followed by percentage
        /Popcornmeter[^<]*?(\d+)%/i,
        // Look for data-testid specifically for popcornmeter
        /data-testid="popcornmeter[^"]*"[^>]*>.*?(\d+)%/i,
        // Look for class specifically for popcornmeter
        /class="[^"]*popcornmeter[^"]*"[^>]*>.*?(\d+)%/i,
        // Look for audience class
        /class="[^"]*audience[^"]*"[^>]*>.*?(\d+)%/i,
        // JSON patterns for audience (avoid grabbing unrelated scores like "audienceAll": 83 when verified exists)
        /"audienceVerified"[\s\S]*?"scorePercent"\s*:\s*"(\d{1,3})%"/i,
        /"audienceVerified"[\s\S]*?"score"\s*:\s*"(\d{1,3})"/i,
        /"audienceScore"[\s\S]*?"scorePercent"\s*:\s*"(\d{1,3})%"/i,
        /"audienceScore"[\s\S]*?"score"\s*:\s*"(\d{1,3})"/i,
        /"audienceAll"[\s\S]*?"scorePercent"\s*:\s*"(\d{1,3})%"/i,
        /"audienceAll"[\s\S]*?"score"\s*:\s*"(\d{1,3})"/i
    ];
    
    // Helper function to validate scores
    function isValidScore(score) {
        const num = parseInt(score);
        // Reject obviously wrong scores (too low or too high)
        return num >= 5 && num <= 100;
    }
    
    // Extract Tomatometer score
    for (let i = 0; i < tomatoPatterns.length; i++) {
        const pattern = tomatoPatterns[i];
        const match = html.match(pattern);
        if (match && isValidScore(match[1])) {
            tomatoScore = match[1] + '%';
            console.log(`Found Tomatometer score: ${tomatoScore} using pattern ${i + 1}:`, pattern.toString());
            
            // Show context around the match
            const matchIndex = html.indexOf(match[0]);
            const context = html.substring(Math.max(0, matchIndex - 100), matchIndex + 100);
            console.log('Tomatometer context:', context);
            break;
        } else if (match) {
            console.log(`Rejected Tomatometer score: ${match[1]}% (invalid range) using pattern ${i + 1}`);
        }
    }
    
    // Extract Popcornmeter score
    for (let i = 0; i < popcornPatterns.length; i++) {
        const pattern = popcornPatterns[i];
        const match = html.match(pattern);
        if (match && isValidScore(match[1])) {
            popcornScore = match[1] + '%';
            console.log(`Found Popcornmeter score: ${popcornScore} using pattern ${i + 1}:`, pattern.toString());
            
            // Show context around the match
            const matchIndex = html.indexOf(match[0]);
            const context = html.substring(Math.max(0, matchIndex - 100), matchIndex + 100);
            console.log('Popcornmeter context:', context);
            break;
        } else if (match) {
            console.log(`Rejected Popcornmeter score: ${match[1]}% (invalid range) using pattern ${i + 1}`);
        }
    }
    
    console.log('Final RT scores - Tomatometer:', tomatoScore, 'Popcornmeter:', popcornScore);
    
    return {
        critics: tomatoScore,
        audience: popcornScore
    };
}

