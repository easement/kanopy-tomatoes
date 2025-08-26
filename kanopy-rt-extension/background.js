// Background script to handle RT API calls
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getScores') {
        getRottenTomatoesScores(request.title, request.year)
            .then(scores => {
                sendResponse({ success: true, scores });
            })
            .catch(error => {
                console.error('Background script error:', error);
                sendResponse({ success: false, error: error.message });
            });
        return true; // Will respond asynchronously
    }
});

async function getRottenTomatoesScores(title, year) {
    try {
        // Try different search variations
        const searchTerms = [
            title,
            `${title} ${year}`,
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
            
            movieUrl = findMovieUrl(searchHtml, title, year);
            
            if (movieUrl) {
                console.log('Found movie URL with search term:', searchTerm);
                break;
            }
        }
        
        if (!movieUrl) {
            // Try direct URL construction for common movies
            const normalizedTitle = title.toLowerCase()
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, '_');
            
            const directUrl = `/m/${normalizedTitle}`;
            console.log('Trying direct URL:', directUrl);
            
            // Test if the direct URL works
            try {
                const testResponse = await fetch(`https://www.rottentomatoes.com${directUrl}`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (testResponse.ok) {
                    console.log('Direct URL works:', directUrl);
                    movieUrl = directUrl;
                }
            } catch (e) {
                console.log('Direct URL failed:', e.message);
            }
        }
        
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
        return extractScores(movieHtml);
        
    } catch (error) {
        console.error('RT API Error:', error);
        throw error;
    }
}

function findMovieUrl(html, title, year) {
    console.log('Finding movie URL for:', title, year);
    
    // Use regex to find movie URLs since DOMParser isn't available in service workers
    // Try multiple patterns for different RT URL formats
    const movieUrlPatterns = [
        /href="(\/m\/[^"]+)"/g,
        /href="(\/movie\/[^"]+)"/g,
        /href="([^"]*\/m\/[^"]+)"/g
    ];
    
    let allMatches = [];
    for (const pattern of movieUrlPatterns) {
        const matches = [...html.matchAll(pattern)];
        allMatches = allMatches.concat(matches);
    }
    
    console.log('Found', allMatches.length, 'movie URLs');
    
    let bestMatch = null;
    let exactMatch = null;
    
    // Get context around each match to find year information
    for (const match of allMatches) {
        const url = match[1];
        const matchIndex = match.index;
        
        console.log('Checking URL:', url);
        
        // Get surrounding text to look for year and title
        const start = Math.max(0, matchIndex - 300);
        const end = Math.min(html.length, matchIndex + 300);
        const context = html.substring(start, end);
        
        // Look for year in context
        const yearMatch = context.match(/\b(\d{4})\b/);
        const titleWords = title.toLowerCase().split(/\s+/);
        
        console.log('Context preview:', context.substring(0, 200));
        console.log('Year match:', yearMatch);
        console.log('Title words:', titleWords);
        
        // Check if title words appear in context (more flexible matching)
        const titleMatch = titleWords.filter(word => word.length > 2).length > 0 && 
            titleWords.filter(word => word.length > 2).some(word => 
                context.toLowerCase().includes(word)
            );
        
        console.log('Title match:', titleMatch);
        
        // Exact year match gets priority
        if (year && yearMatch && yearMatch[1] === year && titleMatch) {
            console.log('Found exact match with year:', url);
            exactMatch = url;
            break;
        }
        
        // Partial title match as fallback
        if (!bestMatch && titleMatch) {
            console.log('Found partial match:', url);
            bestMatch = url;
        }
    }
    
    console.log('Final result - exact match:', exactMatch, 'best match:', bestMatch);
    return exactMatch || bestMatch;
}

function extractScores(html) {
    let tomatoScore = null;
    let popcornScore = null;
    
    // Try multiple patterns to extract scores
    const patterns = [
        // Pattern 1: Look for score-board elements
        {
            tomato: /score-board-deprecated[^>]*>.*?tomatometer[^>]*>.*?counter[^>]*>.*?(\d+)%/s,
            popcorn: /score-board-deprecated[^>]*>.*?audience[^>]*>.*?counter[^>]*>.*?(\d+)%/s
        },
        // Pattern 2: Look for data-testid attributes
        {
            tomato: /data-testid="tomatometer-score"[^>]*>.*?(\d+)%/,
            popcorn: /data-testid="popcornmeter-score"[^>]*>.*?(\d+)%/
        },
        // Pattern 3: Look for class-based selectors
        {
            tomato: /class="[^"]*tomatometer[^"]*"[^>]*>.*?(\d+)%/,
            popcorn: /class="[^"]*audience[^"]*"[^>]*>.*?(\d+)%/
        },
        // Pattern 4: Look for JSON data in script tags
        {
            tomato: /"tomatometer":\s*(\d+)/,
            popcorn: /"audience":\s*(\d+)/
        },
        // Pattern 5: Look for critic and audience scores
        {
            tomato: /"critic":\s*(\d+)/,
            popcorn: /"audience":\s*(\d+)/
        }
    ];
    
    for (const pattern of patterns) {
        if (!tomatoScore) {
            const tomatoMatch = html.match(pattern.tomato);
            if (tomatoMatch) {
                tomatoScore = tomatoMatch[1] + '%';
            }
        }
        
        if (!popcornScore) {
            const popcornMatch = html.match(pattern.popcorn);
            if (popcornMatch) {
                popcornScore = popcornMatch[1] + '%';
            }
        }
        
        // If we found both scores, break
        if (tomatoScore && popcornScore) {
            break;
        }
    }
    
    // Additional fallback: look for any percentage patterns near "tomatometer" or "audience"
    if (!tomatoScore) {
        const tomatoSection = html.match(/tomatometer[^}]*?(\d+)%/i);
        if (tomatoSection) {
            tomatoScore = tomatoSection[1] + '%';
        }
    }
    
    if (!popcornScore) {
        const audienceSection = html.match(/audience[^}]*?(\d+)%/i);
        if (audienceSection) {
            popcornScore = audienceSection[1] + '%';
        }
    }
    
    return {
        critics: tomatoScore,
        audience: popcornScore
    };
}

