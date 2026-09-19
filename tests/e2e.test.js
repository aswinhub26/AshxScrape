import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateXlsx, generateJson, generateCsv } from '../src/lib/export.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, 'dist');
const chromePath = 'C:\\Users\\aswin\\.gemini\\antigravity\\scratch\\cft\\chrome\\win64-153.0.8010.36\\chrome-win64\\chrome.exe';
const artifactDir = 'C:\\Users\\aswin\\.gemini\\antigravity\\brain\\9d4a857a-b676-4692-b1af-dc9449bfd885';

const SAMPLE_ROWS = [
  { name: 'Dr. Mani Dental', category: 'Dental clinic', rating: 4.9, reviewCount: 120, phone: '+919840002121', website: null, domain: null, address: '1/269B, main road, padur', area: 'Padur', hours: 'Mon-Sat: 9am-7pm', priceLevel: '$$', plusCode: 'JQ8G+VH Chennai', claimed: false },
  { name: 'Apollo Dental', category: 'Dental clinic', rating: 4.8, reviewCount: 340, phone: '+919360901090', website: 'https://apollodental.in', domain: 'apollodental.in', address: '2nd floor, No 1, SS Avenue, OMR', area: 'OMR', hours: 'Mon-Sun: 9am-9pm', priceLevel: '$$', plusCode: 'JQ9H+AA Chennai', claimed: true },
  { name: 'Smile Dental Care', category: 'Dentist', rating: 4.7, reviewCount: 89, phone: '+919500123456', website: 'https://smiledental.com', domain: 'smiledental.com', address: 'No. 5, 2nd Cross Street', area: 'Adyar', hours: 'Mon-Sat: 10am-6pm', priceLevel: '$', plusCode: 'JQCC+55 Chennai', claimed: true }
];

import os from 'os';

async function runFullPhoneExtractionTest() {
  console.log('[Live Test] Testing full automatic phone extraction on "cafes in pondicherry"...');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    pipe: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--load-extension=${extPath}`,
      '--no-first-run',
      '--no-default-browser-check'
    ],
    defaultViewport: { width: 1280, height: 800 }
  });

  try {
    const page = (await browser.pages())[0] || await browser.newPage();
    await page.goto('chrome://extensions');
    await new Promise(r => setTimeout(r, 1500));

    const extId = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      const item = manager?.shadowRoot?.querySelector('extensions-item-list')
        ?.shadowRoot?.querySelector('extensions-item');
      return item?.id;
    });
    console.log(`[Live Test] Extension ID: ${extId}`);

    // Open Google Maps search
    console.log('[Live Test] Opening Google Maps: cafes in Pondicherry...');
    await page.goto('https://www.google.com/maps/search/cafes+in+pondicherry', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 6000));

    // Open Side Panel
    const sidePanelPage = await browser.newPage();
    await sidePanelPage.setViewport({ width: 440, height: 780 });
    await sidePanelPage.goto(`chrome-extension://${extId}/src/sidepanel/index.html`);
    await new Promise(r => setTimeout(r, 2000));

    // Refresh query
    await sidePanelPage.click('#btnRefreshQuery');
    await new Promise(r => setTimeout(r, 1500));

    const detectedQuery = await sidePanelPage.$eval('#detectedQuery', el => el.textContent.trim());
    console.log(`[Live Test] Side Panel detected query: "${detectedQuery}"`);

    // Click Start (harvests and automatically enriches phones)
    console.log('[Live Test] Clicking Start...');
    await sidePanelPage.click('#btnStart');

    // Wait for feed scroll (10s) and detail pass (20s)
    console.log('[Live Test] Waiting 25s for harvest and phone enrichment...');
    await new Promise(r => setTimeout(r, 25000));

    // Stop to inspect
    await sidePanelPage.click('#btnStop');
    await new Promise(r => setTimeout(r, 1500));

    const collectedCount = await sidePanelPage.$eval('#statCollected', el => parseInt(el.textContent, 10) || 0);
    const phoneCount = await sidePanelPage.$eval('#statPhone', el => parseInt(el.textContent, 10) || 0);
    const webCount = await sidePanelPage.$eval('#statWebsite', el => parseInt(el.textContent, 10) || 0);
    const detailedCount = await sidePanelPage.$eval('#statDetailed', el => el.textContent.trim());

    console.log(`\n==========================================`);
    console.log(`[Live Test Result]`);
    console.log(`Places Collected: ${collectedCount}`);
    console.log(`Phones Found:     ${phoneCount}`);
    console.log(`Websites Found:   ${webCount}`);
    console.log(`Detailed/Enriched: ${detailedCount}`);
    console.log(`==========================================\n`);

    const screenshotPath = path.resolve(artifactDir, 'pondy_auto_phone_result.png');
    await sidePanelPage.screenshot({ path: screenshotPath });
    console.log(`[Live Test] Screenshot saved: ${screenshotPath}`);

    if (phoneCount > 0) {
      console.log('>>> SUCCESS: Phone numbers successfully scraped live! <<<');
    } else {
      console.log('Note: Phone count still 0, check detail pass progress');
    }

  } finally {
    await browser.close();
  }
}

runFullPhoneExtractionTest().catch(err => {
  console.error('[Live Test] Error:', err);
  process.exit(1);
});

