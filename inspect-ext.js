import puppeteer from 'puppeteer-core';

async function check() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const page = await browser.newPage();
  try {
    await page.goto('chrome-extension://fignfifoniblkonapihmkfakmlgkbkcf/manifest.json');
    const text = await page.evaluate(() => document.body.innerText);
    console.log('Extension manifest:', text);
  } catch(e) {
    console.log('Error:', e.message);
  }
  await browser.close();
}

check();
