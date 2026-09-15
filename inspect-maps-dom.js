import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const chromePath = 'C:\\Users\\aswin\\.gemini\\antigravity\\scratch\\cft\\chrome\\win64-153.0.8010.36\\chrome-win64\\chrome.exe';

async function inspect() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    args: ['--no-first-run', '--no-default-browser-check'],
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = (await browser.pages())[0];
    await page.goto('https://www.google.com/maps/search/dentists+in+Chennai', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    const analysis = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      const allFeeds = Array.from(document.querySelectorAll('[role="feed"]')).map(f => ({
        tag: f.tagName,
        ariaLabel: f.getAttribute('aria-label'),
        childCount: f.children.length,
        scrollHeight: f.scrollHeight,
        clientHeight: f.clientHeight
      }));

      // Look for cards
      const links = Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).slice(0, 5).map(a => {
        const parentCard = a.closest('div[jsaction]') || a.parentElement;
        return {
          href: a.href,
          ariaLabel: a.getAttribute('aria-label'),
          text: a.innerText,
          parentTag: parentCard?.tagName,
          parentClasses: parentCard?.className,
          parentSnippet: parentCard?.innerHTML?.slice(0, 300)
        };
      });

      return {
        hasFeed: !!feed,
        allFeeds,
        linksCount: document.querySelectorAll('a[href*="/maps/place/"]').length,
        sampleLinks: links
      };
    });

    console.log('DOM ANALYSIS:', JSON.stringify(analysis, null, 2));

  } finally {
    await browser.close();
  }
}

inspect();
