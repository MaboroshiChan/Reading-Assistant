import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";

console.log("[Reading Assistant] Content script loaded.");

function checkForArticle() {
    // Simple heuristic: check if Readability finds a substantial article
    if (document.body) {
        // Clone document to avoid modifying the actual page during check
        const docClone = document.cloneNode(true) as Document;

        // Pre-processing: Inject explicit newlines into the clone.
        // This prevents Readability from concatenating text when it strips tags
        // or flattens the structure of sites like Medium/Substack.
        const blocks = docClone.querySelectorAll("p, div, li, h1, h2, h3, h4, h5, h6, br");
        blocks.forEach((el: Element) => {
            if (el.tagName.toLowerCase() === "br") {
                el.replaceWith(docClone.createTextNode("\n\n"));
            } else if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(el.tagName.toLowerCase())) {
                // For headers, Readability often drops them if they contain complex nested 
                // elements (like anchors, divs, or SVGs) or specific classes. 
                // We create a clean header containing just the text.
                const cleanHeader = docClone.createElement(el.tagName);
                cleanHeader.textContent = el.textContent || "";
                el.replaceWith(cleanHeader);
                // Also ensure it gets the newline treatment so it doesn't merge
                cleanHeader.appendChild(docClone.createTextNode("\n\n"));
            } else {
                // Adding a newline inside the element ensures it is included in .textContent
                el.appendChild(docClone.createTextNode("\n\n"));
            }
        });

        const reader = new Readability(docClone);
        const article = reader.parse();
        console.log("[Reading Assistant] Article parsed");

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
