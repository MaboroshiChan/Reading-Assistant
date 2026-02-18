import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";

console.log("[Reading Assistant] Content script loaded.");

function checkForArticle() {
    // Simple heuristic: check if Readability finds a substantial article
    if (document.body) {
        // Clone document to avoid modifying the actual page during check
        const docClone = document.cloneNode(true) as Document;
        // TODO: Add more heuristics to detect articles. Include <div> and <p> tags.
        const reader = new Readability(docClone);
        const article = reader.parse();

        if (article && article.content && (article.length || 0) > 500) { // Threshold for "article"
            console.log("[Reading Assistant] Article detected:", article.title);
            injectAnalyzeButton(article);
        }
    }
}

function injectAnalyzeButton(articleData: any) {
    // Check if already injected
    if (document.getElementById("reading-assistant-btn")) return;

    const btn = document.createElement("button");
    btn.id = "reading-assistant-btn";
    btn.innerText = "✨ Analyze";
    Object.assign(btn.style, {
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: "999999",
        padding: "12px 24px",
        backgroundColor: "#2563EB",
        color: "white",
        border: "none",
        borderRadius: "50px",
        boxShadow: "0 4px 12px rgba(37, 99, 235, 0.3)",
        cursor: "pointer",
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: "16px",
        fontWeight: "600",
        transition: "transform 0.2s, box-shadow 0.2s"
    });

    btn.onmouseenter = () => {
        btn.style.transform = "scale(1.05)";
        btn.style.boxShadow = "0 6px 16px rgba(37, 99, 235, 0.4)";
    };
    btn.onmouseleave = () => {
        btn.style.transform = "scale(1)";
        btn.style.boxShadow = "0 4px 12px rgba(37, 99, 235, 0.3)";
    };

    btn.onclick = async () => {
        btn.innerText = "Processing...";
        btn.style.cursor = "wait";

        try {
            // Sanitize content before storing
            const cleanContent = DOMPurify.sanitize(articleData.content);

            const dataToStore = {
                title: articleData.title,
                byline: articleData.byline,
                content: cleanContent,
                textContent: articleData.textContent,
                url: window.location.href,
                timestamp: Date.now()
            };

            if (!chrome.storage) {
                alert("Reading Assistant extension was updated. Please refresh this page to use the Analyze feature.");
                btn.innerText = "Refresh Page";
                return;
            }

            await chrome.storage.local.set({ "latestArticle": dataToStore });

            // Notify background script to open the reader
            chrome.runtime.sendMessage({ action: "OPEN_READER" });

            btn.innerText = "Done!";
            setTimeout(() => btn.remove(), 2000);
        } catch (e) {
            console.error("Error storing article:", e);
            btn.innerText = "Error";
        }
    };

    document.body.appendChild(btn);
}

// Run check when page loads
if (document.readyState === "complete") {
    checkForArticle();
} else {
    window.addEventListener("load", checkForArticle);
}
