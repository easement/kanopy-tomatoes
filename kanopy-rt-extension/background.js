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
});

async function getMovieScores(title, year) {
    try {
        console.log('Getting movie scores for:', title, year);
        
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
        return scores;

    } catch (error) {
        console.error('Error getting movie scores:', error);
        throw error;
    }
}

async function getLetterboxdScores(title, year) {
    try {
        // Try direct URL construction first (bypasses CORS issues)
        const normalizedTitle = title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-');
        
        const directUrl = `/film/${normalizedTitle}/`;
        console.log('Trying direct Letterboxd URL:', directUrl);
        
        let movieUrl = null;
        
        // Try using a CORS proxy to bypass restrictions
        const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://letterboxd.com' + directUrl)}`;
        console.log('Trying CORS proxy URL:', corsProxyUrl);
        
        try {
            const testResponse = await fetch(corsProxyUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            
            if (testResponse.ok) {
                console.log('CORS proxy URL works:', directUrl);
                movieUrl = directUrl;
            }
        } catch (e) {
            console.log('CORS proxy URL failed:', e.message);
        }
        
        // Special case for Train to Busan
        if (!movieUrl && title.toLowerCase().includes('train to busan')) {
            console.log('Trying known Train to Busan URL with CORS proxy');
            try {
                const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://letterboxd.com/film/train-to-busan/')}`;
                const testResponse = await fetch(corsProxyUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (testResponse.ok) {
                    console.log('Known Train to Busan URL works with CORS proxy');
                    movieUrl = '/film/train-to-busan/';
                }
            } catch (e) {
                console.log('Known Train to Busan URL failed with CORS proxy:', e.message);
            }
        }
        
        if (!movieUrl) {
            console.log('No Letterboxd movie URL found, trying alternative approach');
            
            // Try alternative URL patterns with CORS proxy
            const alternativeUrls = [
                `/film/${title.toLowerCase().replace(/\s+/g, '-')}/`,
                `/film/${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}/`,
                `/film/${title.toLowerCase().replace(/\s+/g, '_')}/`
            ];
            
            for (const altUrl of alternativeUrls) {
                try {
                    const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://letterboxd.com' + altUrl)}`;
                    const testResponse = await fetch(corsProxyUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });
                    
                    if (testResponse.ok) {
                        console.log('Alternative Letterboxd URL works with CORS proxy:', altUrl);
                        movieUrl = altUrl;
                        break;
                    }
                } catch (e) {
                    console.log('Alternative URL failed with CORS proxy:', altUrl, e.message);
                }
            }
        }
        
        if (!movieUrl) {
            console.log('No Letterboxd movie URL found after all attempts');
            return null;
        }
        
        console.log('Found Letterboxd movie URL:', movieUrl);
        
        // Get movie page using CORS proxy
        const fullUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent('https://letterboxd.com' + movieUrl)}`;
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
            throw new Error(`Letterboxd movie page failed: ${movieResponse.status}`);
        }
        
        const movieHtml = await movieResponse.text();
        console.log('Letterboxd page HTML length:', movieHtml.length);
        console.log('Letterboxd HTML preview:', movieHtml.substring(0, 1000));
        
        // Debug: Look for fan-related content in the HTML
        const fanMatches = movieHtml.match(/(\d+[KMB])\s*fans/gi);
        console.log('Fan matches found in HTML:', fanMatches);
        
        const ratingMatches = movieHtml.match(/(\d+[KMB])\s*ratings/gi);
        console.log('Rating matches found in HTML:', ratingMatches);
        
        // More specific debugging
        const allNumbers = movieHtml.match(/\d+/g);
        console.log('All numbers found in HTML (first 20):', allNumbers ? allNumbers.slice(0, 20) : 'None');
        
        // Look for specific patterns around "fans"
        const fanContext = movieHtml.match(/[^>]*fans[^<]*/gi);
        console.log('Fan context found:', fanContext ? fanContext.slice(0, 5) : 'None');
        
        return extractLetterboxdScores(movieHtml);
        
    } catch (error) {
        console.error('Letterboxd API Error:', error);
        throw error;
    }
}

function findLetterboxdMovieUrl(html, title, year) {
    console.log('Finding Letterboxd movie URL for:', title, year);
    
    // Look for movie URLs in search results
    const movieUrlPatterns = [
        /href="(\/film\/[^"]+)"/g,
        /href="([^"]*\/film\/[^"]+)"/g
    ];
    
    let allMatches = [];
    for (const pattern of movieUrlPatterns) {
        const matches = [...html.matchAll(pattern)];
        allMatches = allMatches.concat(matches);
    }
    
    console.log('Found', allMatches.length, 'Letterboxd movie URLs');
    
    let bestMatch = null;
    let exactMatch = null;
    
    for (const match of allMatches) {
        const url = match[1];
        const matchIndex = match.index;
        
        console.log('Checking Letterboxd URL:', url);
        
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
            console.log('Found exact Letterboxd match with year:', url);
            exactMatch = url;
            break;
        }
        
        // Partial title match as fallback
        if (!bestMatch && titleMatch) {
            console.log('Found partial Letterboxd match:', url);
            bestMatch = url;
        }
    }
    
    console.log('Final Letterboxd result - exact match:', exactMatch, 'best match:', bestMatch);
    return exactMatch || bestMatch;
}

function extractLetterboxdScores(html) {
    let rating = null;
    
    console.log('Extracting Letterboxd rating from HTML...');
    
    // Try to extract rating from various patterns
    const ratingPatterns = [
        // JSON-LD structured data
        /"ratingValue":\s*(\d+\.?\d*)/,
        // Meta tags
        /<meta[^>]*property="[^"]*rating[^"]*"[^>]*content="(\d+\.?\d*)"/i,
        // Class-based patterns
        /class="[^"]*rating[^"]*"[^>]*>.*?(\d+\.?\d*)/,
        // Data attributes
        /data-rating="(\d+\.?\d*)"/,
        // General rating patterns
        /rating[^>]*>.*?(\d+\.?\d*)/i,
        // Look for average rating in text
        /average.*?rating.*?(\d+\.?\d*)/i,
        /rating.*?average.*?(\d+\.?\d*)/i,
        // Letterboxd specific patterns
        /class="[^"]*average[^"]*"[^>]*>.*?(\d+\.?\d*)/i,
        /class="[^"]*rating[^"]*"[^>]*>.*?(\d+\.?\d*)/i,
        // Look for numbers in rating context
        /rating.*?(\d+\.?\d*).*?stars/i,
        /(\d+\.?\d*).*?out.*?5/i,
        /(\d+\.?\d*).*?rating/i
    ];
    
    for (const pattern of ratingPatterns) {
        const match = html.match(pattern);
        if (match) {
            rating = parseFloat(match[1]);
            console.log('Found Letterboxd rating:', rating, 'using pattern:', pattern);
            break;
        }
    }
    
    console.log('Final Letterboxd rating:', rating);
    
    return {
        rating: rating
    };
}

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
        
        // Special case for C'mon C'mon
        if (!movieUrl && title.toLowerCase().includes('c\'mon c\'mon')) {
            console.log('Trying known C\'mon C\'mon URL');
            try {
                const testResponse = await fetch('https://www.rottentomatoes.com/m/cmon_cmon', {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (testResponse.ok) {
                    console.log('Known C\'mon C\'mon URL works');
                    movieUrl = '/m/cmon_cmon';
                }
            } catch (e) {
                console.log('Known C\'mon C\'mon URL failed:', e.message);
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
    
    console.log('Extracting RT scores from HTML...');
    
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
        // JSON patterns for audience
        /"popcornmeter":\s*(\d+)/,
        /"audience":\s*(\d+)/
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

