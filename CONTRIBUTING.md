# Contributing to AshxScrape

Thank you for your interest in contributing to **AshxScrape**! We welcome bug fixes, performance improvements, documentation updates, and feature enhancements.

---

## Code of Conduct

Please be respectful, constructive, and collaborative in all discussions, issues, and pull requests.

---

## Development Workflow

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- **Google Chrome** (or Chromium / Chrome for Testing)

### 2. Setup
```bash
# Fork & clone the repository
git clone https://github.com/YOUR_USERNAME/AshxScrape.git
cd AshxScrape

# Install dependencies
npm install

# Build the extension
npm run build
```

### 3. Loading in Chrome for Testing
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** (top-left button).
4. Select the `dist/` directory in your local clone.
5. Open [Google Maps](https://maps.google.com), perform a search, and launch the side panel.

---

## Project Structure Overview

- `src/content/`: Content scripts injected into Google Maps pages (DOM scroller, card parser, detail scraper, fallback selectors).
- `src/sidepanel/`: Side panel user interface, virtual table component, and filter bar.
- `src/lib/`: Core utilities (IndexedDB storage, CSV/XLSX/JSON exporters, deduplication, delay throttle).
- `src/shared/`: Strongly typed messaging constants and job state enums.
- `build.js`: Vite multi-target compiler generating ESM bundles for the side panel & worker, and IIFE bundle for the content script.

---

## Pull Request Guidelines

1. **Create a branch**: Use descriptive branch names (e.g. `feature/export-webhook`, `fix/phone-regex`).
2. **Compile clean**: Ensure `npm run build` executes without errors or warnings.
3. **Verify in browser**: Test your changes on live Google Maps search results.
4. **Submit PR**: Open a pull request against the `main` branch with a clear summary of your changes.

---

## License

By contributing to AshxScrape, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).
