---
description: How to build the Chrome extension
---

To build the Chrome extension, follow these steps:

1. Navigate to the `reading-app` directory.
2. Run the build command:

// turbo
```bash
npm run build
```

The build artifacts will be generated in the `reading-app/dist` directory. These artifacts include:
- `assets/main.js`: Main application logic.
- `assets/content.js`: Extension content script.
- `assets/background.js`: Extension background script.
- `manifest.json`: Extension manifest.
- `index.html`: Entry point.
