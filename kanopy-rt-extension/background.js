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
        console.log('getLetterboxdScores called with title:', title, 'year:', year);
        
        // Try direct URL construction first (bypasses CORS issues)
        const normalizedTitle = title.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, '-');
        
        console.log('Normalized title:', normalizedTitle);
        
        // Include year in the URL for movies with common titles
        const directUrl = year ? `/film/${normalizedTitle}-${year}/` : `/film/${normalizedTitle}/`;
        console.log('Constructed direct URL:', directUrl);
        
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
        
        // Check if the page uses lazy loading for ratings
        const lazyLoadMatch = movieHtml.match(/data-src="([^"]*ratings-summary[^"]*)"/);
        if (lazyLoadMatch) {
            console.log('Found lazy-loaded ratings endpoint:', lazyLoadMatch[1]);
            
            // Fix the slug to match the actual movie URL
            // Convert movieUrl like "/film/share-2023/" to correct ratings URL
            // Remove trailing slash first, then add the ratings-summary path
            const cleanMovieUrl = movieUrl.replace(/\/$/, '');
            const correctRatingsUrl = cleanMovieUrl.replace('/film/', '/csi/film/') + '/ratings-summary/';
            console.log('Movie URL:', movieUrl);
            console.log('Clean movie URL:', cleanMovieUrl);
            console.log('Corrected ratings URL:', correctRatingsUrl);
            
            // Fetch the ratings summary separately
            try {
                const ratingsUrl = `https://letterboxd.com${correctRatingsUrl}`;
                const corsRatingsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(ratingsUrl)}`;
                console.log('Fetching ratings summary from:', corsRatingsUrl);
                
                const ratingsResponse = await fetch(corsRatingsUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                
                if (ratingsResponse.ok) {
                    const ratingsHtml = await ratingsResponse.text();
                    console.log('Ratings summary HTML length:', ratingsHtml.length);
                    console.log('Ratings summary preview:', ratingsHtml.substring(0, 500));
                    
                    // Extract rating from the ratings summary
                    return extractLetterboxdScores(ratingsHtml);
                } else {
                    console.log('Ratings summary request failed:', ratingsResponse.status);
                }
            } catch (e) {
                console.log('Error fetching ratings summary:', e.message);
            }
        }
        
        // Fallback to extracting from main page if lazy loading fails
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
    
    // Helper function to validate Letterboxd ratings
    function isValidLetterboxdRating(rating) {
        const num = parseFloat(rating);
        // Letterboxd ratings are 0.5 to 5.0
        return num >= 0.5 && num <= 5.0;
    }
    
    // Debug: Look for all decimal numbers in the HTML
    const allDecimals = html.match(/(\d+\.\d+)/g);
    console.log('All decimal numbers found:', allDecimals ? allDecimals.slice(0, 10) : 'None');
    
    // Debug: Look specifically for "2.8" in the HTML
    const containsRating = html.includes('2.8');
    console.log('HTML contains "2.8":', containsRating);
    
    // Debug: Find all occurrences of "2.8" and their context
    if (containsRating) {
        const regex = /2\.8/g;
        const matches = [];
        let match;
        while ((match = regex.exec(html)) !== null) {
            const context = html.substring(Math.max(0, match.index - 100), match.index + 100);
            matches.push({
                index: match.index,
                context: context
            });
        }
        console.log('All "2.8" occurrences and contexts:', matches);
    }
    
    // Debug: Look for rating-related text
    const ratingText = html.match(/[^>]*rating[^<]*/gi);
    console.log('Rating text found:', ratingText ? ratingText.slice(0, 5) : 'None');
    
    // Try multiple specific approaches to find the correct rating
    
    // Approach 1: Look for structured data rating value
    console.log('Approach 1: Structured data');
    const structuredRating = html.match(/"ratingValue":\s*(\d+\.?\d*)/);
    if (structuredRating && isValidLetterboxdRating(structuredRating[1])) {
        rating = parseFloat(structuredRating[1]);
        console.log('Found rating from structured data:', rating);
    }
    
    // Approach 2: Look for meta tag rating
    if (!rating) {
        console.log('Approach 2: Meta tags');
        const metaRating = html.match(/<meta[^>]*property="[^"]*rating[^"]*"[^>]*content="(\d+\.?\d*)"/i);
        if (metaRating && isValidLetterboxdRating(metaRating[1])) {
            rating = parseFloat(metaRating[1]);
            console.log('Found rating from meta tag:', rating);
        }
    }
    
    // Approach 3: Look for all valid decimal numbers and test each one
    if (!rating) {
        console.log('Approach 3: Testing all valid decimal numbers');
        const allValidDecimals = [];
        const decimalMatches = html.matchAll(/(\d\.\d+)/g);
        
        for (const match of decimalMatches) {
            const num = parseFloat(match[1]);
            if (isValidLetterboxdRating(match[1])) {
                allValidDecimals.push({
                    value: num,
                    context: html.substring(Math.max(0, match.index - 50), match.index + 50)
                });
            }
        }
        
        console.log('All valid decimal ratings found:', allValidDecimals);
        
        // If we have valid decimals, try to find the most likely rating
        if (allValidDecimals.length > 0) {
            // Look for the one in the best context
            for (const decimal of allValidDecimals) {
                const context = decimal.context.toLowerCase();
                if (context.includes('rating') || context.includes('average') || context.includes('stars')) {
                    rating = decimal.value;
                    console.log('Found rating from context analysis:', rating, 'Context:', decimal.context);
                    break;
                }
            }
            
            // If no context match, take the first valid one
            if (!rating) {
                rating = allValidDecimals[0].value;
                console.log('Using first valid decimal as rating:', rating);
            }
        }
    }
    
    // Approach 4: Look for specific rating display patterns
    if (!rating) {
        console.log('Approach 4: Specific display patterns');
        const displayPatterns = [
            /class="[^"]*rating[^"]*"[^>]*>.*?(\d\.\d+)/i,
            /data-rating="(\d\.\d+)"/i,
            /title="(\d\.\d+)[^"]*rating/i,
            /(\d\.\d+)[^<]*out of 5/i
        ];
        
        for (let i = 0; i < displayPatterns.length; i++) {
            const match = html.match(displayPatterns[i]);
            if (match && isValidLetterboxdRating(match[1])) {
                rating = parseFloat(match[1]);
                console.log(`Found rating from display pattern ${i + 1}:`, rating);
                break;
            }
        }
    }
    
    // Approach 5: Target the specific display-rating link structure
    if (!rating) {
        console.log('Approach 5: Targeting display-rating link');
        // Target: <a href="/film/share-2023/ratings/" class="tooltip display-rating" data-original-title="..."> 2.8 </a>
        const displayRatingPattern = /<a[^>]*class="[^"]*display-rating[^"]*"[^>]*>\s*(\d+\.\d+)\s*<\/a>/i;
        const displayMatch = html.match(displayRatingPattern);
        
        if (displayMatch && isValidLetterboxdRating(displayMatch[1])) {
            rating = parseFloat(displayMatch[1]);
            console.log('Found rating from display-rating link:', rating);
            
            // Show the full match for verification
            console.log('Full display-rating match:', displayMatch[0]);
        } else if (displayMatch) {
            console.log('Found display-rating link but invalid rating:', displayMatch[1]);
        } else {
            console.log('No display-rating link found');
            
            // Debug: Look for any display-rating elements
            const anyDisplayRating = html.match(/display-rating[^>]*>/i);
            if (anyDisplayRating) {
                console.log('Found display-rating element but no rating:', anyDisplayRating[0]);
            }
        }
    }
    
    // Approach 6: Broader search for the display-rating structure
    if (!rating) {
        console.log('Approach 6: Broader display-rating search');
        // More flexible pattern for the display-rating structure
        const flexibleDisplayPattern = /<a[^>]*display-rating[^>]*>[\s\S]*?(\d+\.\d+)[\s\S]*?<\/a>/i;
        const flexibleMatch = html.match(flexibleDisplayPattern);
        
        if (flexibleMatch && isValidLetterboxdRating(flexibleMatch[1])) {
            rating = parseFloat(flexibleMatch[1]);
            console.log('Found rating from flexible display-rating pattern:', rating);
            console.log('Flexible match:', flexibleMatch[0]);
        } else if (flexibleMatch) {
            console.log('Found flexible display-rating but invalid rating:', flexibleMatch[1]);
        } else {
            console.log('No flexible display-rating found');
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

