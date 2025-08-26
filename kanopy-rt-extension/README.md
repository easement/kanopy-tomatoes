# Kanopy Rotten Tomatoes Scores Chrome Extension

A Chrome extension that automatically displays Rotten Tomatoes scores (Tomatometer and Audience scores) on Kanopy movie pages.

## Features

- 🎬 **Auto-detection**: Automatically detects movie titles and years from Kanopy pages
- 🍅 **Tomatometer**: Shows critics' scores from Rotten Tomatoes
- 🍿 **Audience Score**: Shows audience scores from Rotten Tomatoes
- 🔍 **Smart Search**: Uses year matching to find the correct movie when multiple results exist
- 🎯 **Manual Trigger**: Click the floating button or use the extension popup to refresh scores
- 📱 **Responsive Design**: Beautiful UI that works on all screen sizes

## Installation

### Method 1: Load as Unpacked Extension (Recommended for Development)

1. Download or clone this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the `kanopy-rt-extension` folder
5. The extension should now appear in your extensions list

### Method 2: Install from Chrome Web Store (When Available)

1. Visit the Chrome Web Store (link will be added when published)
2. Click "Add to Chrome"
3. Confirm the installation

## Usage

1. **Automatic**: Navigate to any movie page on Kanopy (e.g., `https://www.kanopy.com/en/dekalblibrary/video/12201140`)
2. The extension will automatically:
   - Extract the movie title and year
   - Search Rotten Tomatoes for the movie
   - Display the scores in a floating overlay
3. **Manual**: Click the "🍅 RT Scores" button in the top-left corner to refresh scores
4. **Popup**: Click the extension icon in your browser toolbar for additional controls

## How It Works

1. **Title Extraction**: The extension scans the Kanopy page for movie titles using multiple selectors
2. **Year Detection**: Looks for release years in the title or page metadata
3. **RT Search**: Searches Rotten Tomatoes using the movie title
4. **Year Matching**: Uses the year to find the correct movie when multiple results exist
5. **Score Extraction**: Parses the Rotten Tomatoes page to extract Tomatometer and Audience scores
6. **Display**: Shows the scores in a beautiful, non-intrusive overlay

## Supported Pages

- Kanopy movie pages: `https://www.kanopy.com/*/video/*`
- Examples:
  - `https://www.kanopy.com/en/dekalblibrary/video/12201140`
  - `https://www.kanopy.com/en/yourlibrary/video/12345678`

## Troubleshooting

### Scores Not Appearing
- Make sure you're on a valid Kanopy movie page
- Check that the movie exists on Rotten Tomatoes
- Try clicking the manual refresh button
- Check the browser console for error messages

### Wrong Movie Found
- The extension uses year matching to find the correct movie
- If the year is incorrect or missing, it may select the wrong movie
- Try refreshing the page and checking the extracted title/year

### Extension Not Working
- Ensure the extension is enabled in `chrome://extensions/`
- Check that you have the necessary permissions
- Try disabling and re-enabling the extension

## Technical Details

- **Manifest Version**: 3
- **Permissions**: `activeTab`, `storage`
- **Host Permissions**: `https://www.rottentomatoes.com/*`, `https://www.kanopy.com/*`
- **Content Script**: Runs on Kanopy video pages
- **Background Script**: Handles Rotten Tomatoes API calls
- **Popup**: Provides user interface and controls

## Development

### File Structure
```
kanopy-rt-extension/
├── manifest.json          # Extension configuration
├── content.js             # Content script (runs on Kanopy pages)
├── background.js          # Background script (handles RT API)
├── popup.html             # Extension popup interface
├── popup.js               # Popup functionality
├── styles.css             # CSS styles for the overlay
├── icon16.png             # Extension icon (16x16)
├── icon48.png             # Extension icon (48x48)
├── icon128.png            # Extension icon (128x128)
└── README.md              # This file
```

### Key Functions

- `extractMovieInfo()`: Extracts title and year from Kanopy page
- `getRottenTomatoesScores()`: Searches and extracts scores from RT
- `findMovieUrl()`: Finds the correct movie URL from search results
- `extractScores()`: Parses scores from RT movie page
- `showScores()`: Displays scores in the overlay

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly on various Kanopy pages
5. Submit a pull request

## License

This project is open source and available under the MIT License.

## Support

If you encounter issues or have suggestions, please:
1. Check the troubleshooting section above
2. Look for existing issues in the repository
3. Create a new issue with detailed information about the problem

## Changelog

### Version 1.0.1
- Fixed DOMParser issues in background script
- Improved movie search and score extraction
- Added manual trigger button
- Enhanced error handling and user feedback
- Added extension popup interface
- Improved UI design and responsiveness
