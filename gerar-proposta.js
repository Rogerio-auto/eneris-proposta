const puppeteer = require('puppeteer');

(async () => {
  const nome = process.argv[2] || 'Cliente';
  const consumo = process.argv[3] || 1800;
  const url = `https://edrafox.com/eneris/eneris-proposta.htm?nome=${encodeURIComponent(nome)}&consumo=${consumo}`;
  const file = `/tmp/proposta-${nome}.png`;

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 120000 });

  await page.screenshot({ path: file, fullPage: true });
  await browser.close();

  console.log(file);
})();
