import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, 'dist');
const chromePath = 'C:\\Users\\aswin\\.gemini\\antigravity\\scratch\\cft\\chrome\\win64-153.0.8010.36\\chrome-win64\\chrome.exe';

async function testWorker() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--load-extension=${extPath}`]
  });

  try {
    const page = (await browser.pages())[0];
    await page.goto('chrome://extensions');
    await new Promise(r => setTimeout(r, 1000));

    // Turn on Dev Mode to see service worker link / errors
    await page.evaluate(() => {
      const devToggle = document.querySelector('extensions-manager')?.shadowRoot
        ?.querySelector('extensions-toolbar')?.shadowRoot
        ?.querySelector('#devMode');
      if (devToggle && !devToggle.checked) devToggle.click();
    });
    await new Promise(r => setTimeout(r, 1000));

    // Screenshot extensions page with DevMode ON
    await page.screenshot({ path: path.resolve(__dirname, 'devmode_inspect.png') });
    console.log('Saved devmode_inspect.png');

    const cardDetails = await page.evaluate(() => {
      const item = document.querySelector('extensions-manager')?.shadowRoot
        ?.querySelector('extensions-item-list')?.shadowRoot
        ?.querySelector('extensions-item');
      if (!item) return 'No item found';
      const shadow = item.shadowRoot;
      return {
        id: item.id,
        name: shadow?.querySelector('#name')?.textContent?.trim(),
        inspectViews: shadow?.querySelector('#inspect-views')?.textContent?.trim(),
        warnings: shadow?.querySelector('#warnings')?.textContent?.trim(),
        errors: shadow?.querySelector('#errors')?.textContent?.trim()
      };
    });
    console.log('Card details:', cardDetails);

  } finally {
    await browser.close();
  }
}

testWorker();
