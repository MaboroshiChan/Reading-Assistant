chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.action === "OPEN_READER") {
        chrome.tabs.create({ url: "index.html" });
    }
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));
