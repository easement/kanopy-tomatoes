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
    
    return { title, year };
}

function showScores(scores, movieInfo) {
    const existing = document.getElementById('rt-scores');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'rt-scores';
    div.className = 'rt-display';
    div.innerHTML = `
        <div class="rt-header">
            🍅 Rotten Tomatoes
            <span class="rt-close" onclick="this.closest('#rt-scores').remove()">×</span>
        </div>
        <div class="rt-content">
            <div class="rt-score">
                <span class="rt-icon">🍅</span>
                <span class="rt-label">Critics:</span>
                <span class="rt-value">${scores.critics || 'N/A'}</span>
            </div>
            <div class="rt-score">
                <span class="rt-icon">🍿</span>
                <span class="rt-label">Audience:</span>
                <span class="rt-value">${scores.audience || 'N/A'}</span>
            </div>
            <div class="rt-title">
                ${movieInfo.title}${movieInfo.year ? ` (${movieInfo.year})` : ''}
            </div>
        </div>
    `;
    document.body.appendChild(div);
}

function showLoading() {
    const existing = document.getElementById('rt-scores');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'rt-scores';
    div.className = 'rt-display';
    div.innerHTML = `
        <div class="rt-header">
            🍅 Loading RT Scores...
            <span class="rt-close" onclick="this.closest('#rt-scores').remove()">×</span>
        </div>
        <div class="rt-content">
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 24px; margin-bottom: 10px;">🍅</div>
                <div>Searching for scores...</div>
            </div>
        </div>
    `;
    document.body.appendChild(div);
}

function showError(message) {
    const existing = document.getElementById('rt-scores');
    if (existing) existing.remove();
    
    const div = document.createElement('div');
    div.id = 'rt-scores';
    div.className = 'rt-display rt-error';
    div.innerHTML = `
        <div class="rt-header">
            ⚠️ RT Error
            <span class="rt-close" onclick="this.closest('#rt-scores').remove()">×</span>
        </div>
        <div class="rt-content">
            <div style="margin-bottom: 10px;">${message}</div>
            <div style="font-size: 12px; opacity: 0.8;">
                Try refreshing the page or check if the movie exists on Rotten Tomatoes.
            </div>
        </div>
    `;
    document.body.appendChild(div);
    
    setTimeout(() => {
        const errorDiv = document.getElementById('rt-scores');
        if (errorDiv) errorDiv.remove();
    }, 8000);
}

function addRTButton() {
    // Remove existing button if any
    const existingButton = document.getElementById('rt-button');
    if (existingButton) existingButton.remove();
    
    const button = document.createElement('button');
    button.id = 'rt-button';
    button.innerHTML = '🍅 RT Scores';
    button.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        background: linear-gradient(135deg, #ff6b6b, #ee5a24);
        color: white;
        border: none;
        border-radius: 25px;
        padding: 10px 20px;
        font-size: 14px;
        font-weight: bold;
        cursor: pointer;
        z-index: 999998;
        box-shadow: 0 4px 15px rgba(0,0,0,0.3);
        transition: all 0.3s ease;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;
    
    button.addEventListener('mouseenter', () => {
        button.style.transform = 'scale(1.05)';
        button.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
    });
    
    button.addEventListener('mouseleave', () => {
        button.style.transform = 'scale(1)';
        button.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
    });
    
    button.addEventListener('click', run);
    
    document.body.appendChild(button);
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
            showError('Could not find movie title on this page. Please make sure you are on a movie page.');
            return;
        }
        
        showLoading();
        
        const scores = await getScores(movieInfo.title, movieInfo.year);
        console.log('Scores received:', scores);
        
        showScores(scores, movieInfo);
        
    } catch (error) {
        console.error('Extension error:', error);
        showError(error.message);
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            addRTButton();
            // Auto-run after a short delay
            setTimeout(run, 2000);
        }, 1000);
    });
} else {
    setTimeout(() => {
        addRTButton();
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
            addRTButton();
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