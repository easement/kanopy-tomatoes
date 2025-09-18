console.log('Kanopy RT extension loaded');

function extractMovieInfo() {
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
            '.movie-year'
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
        
        // Also check for year in any text content
        if (!year) {
            const bodyText = document.body.textContent;
            const yearMatches = bodyText.match(/\b(19|20)\d{2}\b/g);
            if (yearMatches && yearMatches.length > 0) {
                // Take the first reasonable year (not current year)
                const currentYear = new Date().getFullYear();
                for (const yearMatch of yearMatches) {
                    const yearNum = parseInt(yearMatch);
                    if (yearNum >= 1900 && yearNum <= currentYear) {
                        year = yearMatch;
                        break;
                    }
                }
            }
        }
    }
    
    // Clean up title
    title = title.replace(/^\s*[-–—]\s*/, '').replace(/\s*[-–—]\s*$/, '');
    
    return { title, year, titleElement };
}

function generateRTUrl(title, year) {
    // Generate Rotten Tomatoes search URL
    return `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`;
}

function generateLetterboxdUrl(title, year) {
    // Try to generate direct Letterboxd URL
    const normalizedTitle = title.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-');
    
    return `https://letterboxd.com/film/${normalizedTitle}/`;
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
                        <span class="rt-score-value critics">${rtScores.audience || 'N/A'}</span>
                    </div>
                    <div class="rt-score-item">
                        <span class="rt-score-label">Audience</span>
                        <span class="rt-score-value audience">${rtScores.critics || 'N/A'}</span>
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
    if (movieInfo.titleElement && movieInfo.titleElement.parentNode) {
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

async function run() {
    try {
        console.log('Extension running...');
        
        const movieInfo = extractMovieInfo();
        console.log('Movie info:', movieInfo);
        
        if (!movieInfo || !movieInfo.title) {
            showError('Could not find movie title on this page. Please make sure you are on a movie page.', movieInfo);
            return;
        }
        
        showLoading(movieInfo);
        
        const scores = await getScores(movieInfo.title, movieInfo.year);
        console.log('Scores received:', scores);
        console.log('RT scores:', scores.rt);
        console.log('Letterboxd scores:', scores.letterboxd);
        
        showScores(scores, movieInfo);
        
    } catch (error) {
        console.error('Extension error:', error);
        showError(error.message, movieInfo);
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            // Auto-run after a short delay
            setTimeout(run, 2000);
        }, 1000);
    });
} else {
    setTimeout(() => {
        // Auto-run after a short delay
        setTimeout(run, 2000);
    }, 1000);
}

// Listen for URL changes (for SPA navigation)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        setTimeout(() => {
            setTimeout(run, 2000);
        }, 1000);
    }
}).observe(document, { subtree: true, childList: true });

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'triggerRT') {
        run();
        sendResponse({success: true});
    }
});