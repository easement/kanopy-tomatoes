// Simple debug script to test extension loading
console.log('Debug script loaded successfully');

// Test basic functionality
function testBasicFunctions() {
    console.log('Testing basic functions...');
    
    // Test if we can access DOM
    if (document && document.body) {
        console.log('✅ DOM access working');
    } else {
        console.log('❌ DOM access failed');
    }
    
    // Test if we can create elements
    try {
        const testDiv = document.createElement('div');
        testDiv.textContent = 'Test element';
        console.log('✅ Element creation working');
    } catch (error) {
        console.log('❌ Element creation failed:', error);
    }
    
    // Test if chrome API is available
    if (typeof chrome !== 'undefined' && chrome.runtime) {
        console.log('✅ Chrome API available');
    } else {
        console.log('❌ Chrome API not available');
    }
}

// Run tests when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', testBasicFunctions);
} else {
    testBasicFunctions();
}
