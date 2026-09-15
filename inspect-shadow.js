import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, 'dist');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function test() {
  const userDataDir = path.resolve(__dirname, 'test-profile-ext');
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      `--user-data-dir=${userDataDir}`
    ]
  });

  try {
    const page = (await browser.pages())[0];
    await page.goto('chrome://extensions');
    await new Promise(r => setTimeout(r, 2000));

    const html = await page.evaluate(() => {
      const manager = document.querySelector('extensions-manager');
      return manager ? manager.shadowRoot.innerHTML : 'no manager';
    });
    console.log('Manager shadowRoot snippet:', html.substring(0, 500));
  } catch (err) {
    console.error(err);
  } finally {
    await browser.close();
  }
}

test();
