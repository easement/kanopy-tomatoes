document.addEventListener('DOMContentLoaded', function() {
    const manualTrigger = document.getElementById('manualTrigger');
    const status = document.getElementById('status');
    
    // Check if we're on a Kanopy page
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        const currentTab = tabs[0];
        const isKanopyPage = currentTab.url && currentTab.url.includes('kanopy.com') && currentTab.url.includes('/video/');
        
        if (isKanopyPage) {
            status.textContent = 'On Kanopy movie page - scores will load automatically';
            manualTrigger.textContent = 'Refresh RT Scores';
        } else {
            status.textContent = 'Navigate to a Kanopy movie page to see scores';
            manualTrigger.textContent = 'Go to Kanopy';
            manualTrigger.onclick = function() {
                chrome.tabs.create({url: 'https://www.kanopy.com'});
            };
        }
    });
    
    // Handle manual trigger
    manualTrigger.addEventListener('click', function() {
        if (manualTrigger.textContent === 'Go to Kanopy') {
            return; // Already handled above
        }
        
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, {action: 'triggerRT'}, function(response) {
                if (chrome.runtime.lastError) {
                    status.textContent = 'Error: ' + chrome.runtime.lastError.message;
                } else {
                    status.textContent = 'Triggered RT score lookup...';
                    setTimeout(() => {
                        status.textContent = 'Scores should appear on the page';
                    }, 2000);
                }
            });
        });
    });
});
