console.log('Kanopy RT extension loaded');

function normalizeTitleForMatch(rawTitle) {
    if (!rawTitle) return '';
    return rawTitle
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/&/g, ' and ')
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9\s:.-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanupTitle(rawTitle) {
    if (!rawTitle) return '';
    return rawTitle
        .replace(/^\s*[-–—]\s*/, '')
        .replace(/\s*[-–—]\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractYearFromText(text) {
    if (!text) return null;
    const match = String(text).match(/\b(19|20)\d{2}\b/);
    if (!match) return null;
    const yearNum = Number(match[0]);
    const currentYear = new Date().getFullYear() + 1;
    if (yearNum < 1870 || yearNum > currentYear) return null;
    return String(yearNum);
}

function parseJsonLdMovieInfo() {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const script of scripts) {
        const raw = script.textContent;
        if (!raw || !raw.trim()) continue;
        try {
            const parsed = JSON.parse(raw);
            const nodes = Array.isArray(parsed) ? parsed : [parsed];
            for (const node of nodes) {
                const candidate = extractFromJsonLdNode(node);
                if (candidate && candidate.title) return candidate;
            }
        } catch {
            // ignore invalid JSON-LD blocks
        }
    }
    return null;
}

function extractFromJsonLdNode(node) {
    if (!node || typeof node !== 'object') return null;

    // Handle @graph containers
    if (Array.isArray(node['@graph'])) {
        for (const child of node['@graph']) {
            const candidate = extractFromJsonLdNode(child);
            if (candidate && candidate.title) return candidate;
        }
    }

    const typeRaw = node['@type'];
    const type = Array.isArray(typeRaw) ? typeRaw.join(' ') : String(typeRaw || '');
    const looksLikeMovie = /movie|film|video/i.test(type);

    const name = typeof node.name === 'string' ? node.name : null;
    const headline = typeof node.headline === 'string' ? node.headline : null;
    const title = cleanupTitle(name || headline || '');
    const datePublished = node.datePublished || node.releaseDate || node.dateCreated;
    const year = extractYearFromText(datePublished);

    if (looksLikeMovie && title) return { title, year };
    if (title && year) return { title, year };
    return null;
}

function getMetaContent(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const value = el.getAttribute('content');
    return value && value.trim() ? value.trim() : null;
}

function extractMovieInfo() {
    const jsonLd = parseJsonLdMovieInfo();
    if (jsonLd && jsonLd.title) {
        const title = cleanupTitle(jsonLd.title);
        return { title, year: jsonLd.year || null, titleElement: null };
    }

    const ogTitle = getMetaContent('meta[property="og:title"]') || getMetaContent('meta[name="twitter:title"]');
    if (ogTitle) {
        const cleaned = cleanupTitle(ogTitle);
        const yearFromOg = extractYearFromText(ogTitle);
        const title = cleanupTitle(cleaned.replace(/\s*\(?\b(19|20)\d{2}\b\)?\s*/g, ' ').trim());
        return { title, year: yearFromOg || null, titleElement: null };
    }

    const titleSelectors = [
        '.product-title',
        'h3.product-title', 
        'h1', 
        '.title', 
        '[data-testid="video-title"]',
        '.video-title',
        '.movie-title',
        'h1[class*="title"]',
        '.hero-title',
        '.content-title'
    ];
    
    let titleElement = null;
    
    for (const selector of titleSelectors) {
        titleElement = document.querySelector(selector);
        if (titleElement && titleElement.textContent.trim()) break;
    }
    
    if (!titleElement) {
        // Try to find any heading that might contain the title
        const headings = document.querySelectorAll('h1, h2, h3');
        for (const heading of headings) {
            const text = heading.textContent.trim();
            if (text && text.length > 3 && text.length < 100) {
                titleElement = heading;
                break;
            }
        }
    }
    
    if (!titleElement) return null;
    
    let title = titleElement.textContent.trim();
    let year = null;
    
    // Extract year from title
    const yearMatch = title.match(/\((\d{4})\)|\b(\d{4})\b/);
    if (yearMatch) {
        year = yearMatch[1] || yearMatch[2];
        title = title.replace(/\s*\(?\d{4}\)?\s*/, '').trim();
    }
    
        // If no year in title, look for it elsewhere
        if (!year) {
            const metaSelectors = [
                '.product-year',
                '.release-year', 
                '.year',
                '.product-meta',
                '[class*="year"]',
                '[class*="date"]',
                '.release-date',
                '.movie-year',
                '.product-release-year'  // Added specific Kanopy selector
            ];
        
        for (const selector of metaSelectors) {
            const element = document.querySelector(selector);
            if (element) {
                const yearText = element.textContent;
                const yearMatch = yearText.match(/\b(\d{4})\b/);
                if (yearMatch) {
                    year = yearMatch[1];
                    break;
                }
            }
        }
        
        // Intentionally avoid scanning the entire page for years:
        // it commonly picks up irrelevant years (copyright, awards, etc.)
    }
    
    // Clean up title
    title = cleanupTitle(title);
    
    return { title, year, titleElement };
}

function generateRTUrl(title, year) {
    // Generate Rotten Tomatoes search URL
    return `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`;
}

function generateLetterboxdUrl(title, year) {
    // Use search rather than guessing a slug (slugs are not reliably derivable from titles)
    const query = year ? `${title} ${year}` : title;
    return `https://letterboxd.com/search/${encodeURIComponent(normalizeTitleForMatch(query))}/`;
}

function showScores(scores, movieInfo) {
    const existing = document.getElementById('rt-scores-embedded');
    if (existing) existing.remove();
    
    const rtScores = scores.rt;
    const letterboxdScores = scores.letterboxd;
    
    // Generate URLs for linking
    const rtUrl = generateRTUrl(movieInfo.title, movieInfo.year);
    const letterboxdUrl = generateLetterboxdUrl(movieInfo.title, movieInfo.year);
    
    let scoresHtml = '';
    
    // Add RT scores if available
    if (rtScores) {
        scoresHtml += `
            <div class="rt-score-section">
                <div class="rt-score-header">
                    <span class="rt-icon">🍅</span>
                    <a href="${rtUrl}" target="_blank" class="rt-label-link">
                        <span class="rt-label">Rotten Tomatoes</span>
                    </a>
                </div>
                <div class="rt-score-content">
                    <div class="rt-score-item">
                        <span class="rt-score-label">Tomatometer</span>
                        <span class="rt-score-value critics">${rtScores.critics || 'N/A'}</span>
                    </div>
                    <div class="rt-score-item">
                        <span class="rt-score-label">Audience</span>
                        <span class="rt-score-value audience">${rtScores.audience || 'N/A'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    // Add Letterboxd scores if available
    if (letterboxdScores) {
        scoresHtml += `
            <div class="rt-score-section">
                <div class="rt-score-header">
                    <span class="rt-icon">📽️</span>
                    <a href="${letterboxdUrl}" target="_blank" class="rt-label-link">
                        <span class="rt-label">Letterboxd</span>
                    </a>
                </div>
                <div class="rt-score-content">
                    <div class="rt-score-item">
                        <span class="rt-score-label">Rating</span>
                        <span class="rt-score-value letterboxd">${letterboxdScores.rating ? letterboxdScores.rating.toFixed(1) : 'N/A'}</span>
                    </div>
                    <div class="rt-score-item empty">
                        <span class="rt-score-label">&nbsp;</span>
                        <span class="rt-score-value">&nbsp;</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    // If no scores available, show error message
    if (!rtScores && !letterboxdScores) {
        scoresHtml = `
            <div class="rt-score-section">
                <div class="rt-score-header">
                    <span class="rt-icon">⚠️</span>
                    <span class="rt-label">No Scores Available</span>
                </div>
                <div class="rt-score-content">
                    <div class="rt-error-message">Could not find scores on Rotten Tomatoes or Letterboxd</div>
                </div>
            </div>
        `;
    }
    
    const div = document.createElement('div');
    div.id = 'rt-scores-embedded';
    div.className = 'rt-scores-container';
    div.innerHTML = scoresHtml;
    
    // Insert after the title element
    if (movieInfo.titleElement && movieInfo.titleElement.parentNode) {
        movieInfo.titleElement.parentNode.insertBefore(div, movieInfo.titleElement.nextSibling);
    } else {
        // Fallback: insert at the top of the page
        document.body.insertBefore(div, document.body.firstChild);
    }
}

function showLoading(movieInfo) {
    const existing = document.getElementById('rt-scores-embedded');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'rt-scores-embedded';
    div.className = 'rt-scores-container loading';
    div.innerHTML = `
        <div class="rt-score-section">
            <div class="rt-score-header">
                <span class="rt-icon">🍅</span>
                <span class="rt-label">Loading Movie Scores...</span>
            </div>
            <div class="rt-score-content">
                <div class="rt-loading-spinner"></div>
            </div>
        </div>
    `;
    
    // Insert after the title element
    if (movieInfo.titleElement && movieInfo.titleElement.parentNode) {
        movieInfo.titleElement.parentNode.insertBefore(div, movieInfo.titleElement.nextSibling);
    } else {
        // Fallback: insert at the top of the page
        document.body.insertBefore(div, document.body.firstChild);
    }
}

function showError(message, movieInfo) {
    const existing = document.getElementById('rt-scores-embedded');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'rt-scores-embedded';
    div.className = 'rt-scores-container error';
    div.innerHTML = `
        <div class="rt-score-section">
            <div class="rt-score-header">
                <span class="rt-icon">⚠️</span>
                <span class="rt-label">Scores Unavailable</span>
            </div>
            <div class="rt-score-content">
                <div class="rt-error-message">${message}</div>
            </div>
        </div>
    `;
    
    // Insert after the title element
    if (movieInfo && movieInfo.titleElement && movieInfo.titleElement.parentNode) {
        movieInfo.titleElement.parentNode.insertBefore(div, movieInfo.titleElement.nextSibling);
    } else {
        // Fallback: insert at the top of the page
        document.body.insertBefore(div, document.body.firstChild);
    }
}

async function getScores(title, year) {
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'getScores',
            title: title,
            year: year
        });
        
        if (response && response.success) {
            return response.scores;
        } else {
            throw new Error(response ? response.error : 'No response from background script');
        }
    } catch (error) {
        console.error('Error getting scores:', error);
        throw error;
    }
}

async function getRTScores(title, year) {
    const response = await chrome.runtime.sendMessage({
        action: 'getRTScores',
        title,
        year
    })

    if (response && response.success) return response.scores
    throw new Error(response ? response.error : 'No response from background script')
}

async function getLetterboxdScores(title, year) {
    const response = await chrome.runtime.sendMessage({
        action: 'getLetterboxdScores',
        title,
        year
    })

    if (response && response.success) return response.scores
    throw new Error(response ? response.error : 'No response from background script')
}

function renderScoresShell(movieInfo) {
    const existing = document.getElementById('rt-scores-embedded')
    if (existing) existing.remove()

    const div = document.createElement('div')
    div.id = 'rt-scores-embedded'
    div.className = 'rt-scores-container loading'
    div.innerHTML = `
        <div class="rt-score-section" data-section="rt">
            <div class="rt-score-header">
                <span class="rt-icon">🍅</span>
                <span class="rt-label">Rotten Tomatoes</span>
            </div>
            <div class="rt-score-content">
                <div class="rt-loading-spinner"></div>
            </div>
        </div>
        <div class="rt-score-section" data-section="letterboxd">
            <div class="rt-score-header">
                <span class="rt-icon">📽️</span>
                <span class="rt-label">Letterboxd</span>
            </div>
            <div class="rt-score-content">
                <div class="rt-loading-spinner"></div>
            </div>
        </div>
    `

    if (movieInfo && movieInfo.titleElement && movieInfo.titleElement.parentNode) {
        movieInfo.titleElement.parentNode.insertBefore(div, movieInfo.titleElement.nextSibling)
        return
    }

    document.body.insertBefore(div, document.body.firstChild)
}

function updateRTSection(movieInfo, rtScores) {
    const container = document.getElementById('rt-scores-embedded')
    if (!container) return

    const section = container.querySelector('[data-section="rt"]')
    if (!section) return

    const rtUrl = generateRTUrl(movieInfo.title, movieInfo.year)
    const critics = rtScores?.critics || 'N/A'
    const audience = rtScores?.audience || 'N/A'

    section.innerHTML = `
        <div class="rt-score-header">
            <span class="rt-icon">🍅</span>
            <a href="${rtUrl}" target="_blank" class="rt-label-link">
                <span class="rt-label">Rotten Tomatoes</span>
            </a>
        </div>
        <div class="rt-score-content">
            <div class="rt-score-item">
                <span class="rt-score-label">Tomatometer</span>
                <span class="rt-score-value critics">${critics}</span>
            </div>
            <div class="rt-score-item">
                <span class="rt-score-label">Audience</span>
                <span class="rt-score-value audience">${audience}</span>
            </div>
        </div>
    `
}

function updateRTSectionError(message) {
    const container = document.getElementById('rt-scores-embedded')
    if (!container) return
    const section = container.querySelector('[data-section="rt"]')
    if (!section) return

    section.innerHTML = `
        <div class="rt-score-header">
            <span class="rt-icon">🍅</span>
            <span class="rt-label">Rotten Tomatoes</span>
        </div>
        <div class="rt-score-content">
            <div class="rt-error-message">${message}</div>
        </div>
    `
}

function updateLetterboxdSection(movieInfo, letterboxdScores) {
    const container = document.getElementById('rt-scores-embedded')
    if (!container) return

    const section = container.querySelector('[data-section="letterboxd"]')
    if (!section) return

    const letterboxdUrl = generateLetterboxdUrl(movieInfo.title, movieInfo.year)
    const rating = letterboxdScores?.rating ? Number(letterboxdScores.rating).toFixed(1) : 'N/A'

    section.innerHTML = `
        <div class="rt-score-header">
            <span class="rt-icon">📽️</span>
            <a href="${letterboxdUrl}" target="_blank" class="rt-label-link">
                <span class="rt-label">Letterboxd</span>
            </a>
        </div>
        <div class="rt-score-content">
            <div class="rt-score-item">
                <span class="rt-score-label">Rating</span>
                <span class="rt-score-value letterboxd">${rating}</span>
            </div>
            <div class="rt-score-item empty">
                <span class="rt-score-label">&nbsp;</span>
                <span class="rt-score-value">&nbsp;</span>
            </div>
        </div>
    `
}

function updateLetterboxdSectionError(message) {
    const container = document.getElementById('rt-scores-embedded')
    if (!container) return
    const section = container.querySelector('[data-section="letterboxd"]')
    if (!section) return

    section.innerHTML = `
        <div class="rt-score-header">
            <span class="rt-icon">📽️</span>
            <span class="rt-label">Letterboxd</span>
        </div>
        <div class="rt-score-content">
            <div class="rt-error-message">${message}</div>
        </div>
    `
}

async function run() {
    let movieInfo = null;
    try {
        console.log('Extension running...');
        
        movieInfo = extractMovieInfo();
        console.log('Movie info:', movieInfo);
        
        if (!movieInfo || !movieInfo.title) {
            const urlKey = location.href;
            const current = runAttemptStateByUrl.get(urlKey) || { attempts: 0 };
            const nextAttempts = current.attempts + 1;
            runAttemptStateByUrl.set(urlKey, { attempts: nextAttempts });

            if (nextAttempts < MAX_RUN_ATTEMPTS_PER_URL) {
                const delayMs = Math.min(250 * Math.pow(2, nextAttempts - 1), 4000);
                console.log(`Title not found yet, retrying (${nextAttempts}/${MAX_RUN_ATTEMPTS_PER_URL}) in ${delayMs}ms`);
                scheduleRun(delayMs);
                return;
            }

            showError('Could not find movie title on this page. Please make sure you are on a movie page.', movieInfo);
            return;
        }

        runAttemptStateByUrl.delete(location.href);

        renderScoresShell(movieInfo)

        // Fetch independently so we can render whichever returns first
        getRTScores(movieInfo.title, movieInfo.year)
            .then((rt) => updateRTSection(movieInfo, rt))
            .catch((e) => updateRTSectionError(e?.message || 'RT unavailable'))

        getLetterboxdScores(movieInfo.title, movieInfo.year)
            .then((lb) => updateLetterboxdSection(movieInfo, lb))
            .catch((e) => updateLetterboxdSectionError(e?.message || 'Letterboxd unavailable'))
        
    } catch (error) {
        console.error('Extension error:', error);
        showError(error?.message || 'Unknown error', movieInfo);
    }
}

const scheduleRun = (() => {
    let timeoutId = null;
    return (delayMs) => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            timeoutId = null;
            run();
        }, delayMs);
    };
})();

const runAttemptStateByUrl = new Map();
const MAX_RUN_ATTEMPTS_PER_URL = 6;

// Initialize quickly when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scheduleRun(250));
} else {
    scheduleRun(250);
}

// Listen for URL changes (for SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        scheduleRun(500);
    }
}).observe(document, { subtree: true, childList: true });

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'triggerRT') {
        run();
        sendResponse({success: true});
    }
});