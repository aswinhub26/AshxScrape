import puppeteer from 'puppeteer-core';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extPath = path.resolve(__dirname, 'dist');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function test() {
  const userDataDir = path.resolve(__dirname, 'test-profile-log');
  if (fs.existsSync(userDataDir)) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: false,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      '--enable-logging',
      '--v=1',
      `--disable-extensions-except=${extPath}`,
      `--load-extension=${extPath}`,
      `--user-data-dir=${userDataDir}`
    ]
  });

  try {
    const page = (await browser.pages())[0];
    await page.goto('chrome://extensions');
    await new Promise(r => setTimeout(r, 2000));
  } finally {
    await browser.close();
  }

  const logFile = path.resolve(userDataDir, 'chrome_debug.log');
  if (fs.existsSync(logFile)) {
    console.log('Log file found! Lines:');
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.includes('extension') || l.includes('Extension') || l.includes('manifest') || l.includes('error'));
    console.log(lines.slice(0, 50).join('\n'));
  } else {
    console.log('No chrome_debug.log generated.');
  }
}

test();
