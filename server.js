const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Chromium do sistema (Docker) ou Puppeteer bundled (local)
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || null;

// Args do Chromium — SEM --single-process (causa crash)
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--font-render-hinting=none',
  '--no-first-run',
  '--no-zygote'
];

// Serve os templates HTML estáticos
app.use('/templates', express.static(path.join(__dirname, 'templates')));

// Rota raiz — instruções
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head><title>API Eneris Proposta</title></head>
    <body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;">
      <h1>API Eneris Proposta</h1>
      <ul>
        <li><a href="/health">/health</a></li>
        <li><a href="/gerar-proposta/pagina1?nome=Cliente&consumo=1800">/gerar-proposta/pagina1?nome=Cliente&consumo=1800</a> — Mapeamento</li>
        <li><a href="/gerar-proposta/pagina2?consumo=1800">/gerar-proposta/pagina2?consumo=1800</a> — Preços</li>
        <li><a href="/gerar-proposta?nome=Cliente&consumo=1800">/gerar-proposta?nome=Cliente&consumo=1800</a> — Ambas (JSON)</li>
      </ul>
    </body></html>
  `);
});

// Health check — testa se Chromium funciona
app.get('/health', async (req, res) => {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      executablePath: CHROMIUM_PATH || undefined,
      args: BROWSER_ARGS
    });
    const version = await browser.version();
    await browser.close();
    res.json({ status: 'ok', chromium: version, timestamp: new Date().toISOString() });
  } catch (err) {
    if (browser) try { await browser.close(); } catch(e) {}
    res.status(500).json({ status: 'error', details: err.message });
  }
});

// Lançar browser
async function launchBrowser() {
  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROMIUM_PATH || undefined,
    args: BROWSER_ARGS,
    protocolTimeout: 120000
  });
  console.log('[browser] PID', browser.process()?.pid);
  return browser;
}

// Capturar screenshot com validação
async function captureScreenshot(browser, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  page.on('console', msg => console.log('[chrome]', msg.text()));
  page.on('pageerror', err => console.error('[chrome-err]', err.message));

  console.log(`[capture] ${url}`);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('body', { timeout: 10000 });
  await new Promise(r => setTimeout(r, 2000));

  const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  console.log(`[capture] ${screenshot.length} bytes`);

  // Valida magic bytes PNG (89 50 4E 47)
  if (!screenshot || screenshot.length < 1000 ||
      screenshot[0] !== 0x89 || screenshot[1] !== 0x50 ||
      screenshot[2] !== 0x4E || screenshot[3] !== 0x47) {
    throw new Error(`Screenshot corrompido (${screenshot?.length || 0} bytes)`);
  }

  await page.close();
  return screenshot;
}

// ============================================================
// GET /gerar-proposta/pagina1 — Mapeamento de Cargas
// GET /gerar-proposta/pagina2 — Proposta Orientativa
// ============================================================
async function gerarScreenshot(req, res, templateFile) {
  const nome = req.query.nome || 'Cliente';
  const consumo = req.query.consumo || '1800';
  const formato = req.query.formato || 'png';
  const url = `http://127.0.0.1:${PORT}/templates/${templateFile}?nome=${encodeURIComponent(nome)}&consumo=${consumo}`;

  let browser;
  try {
    browser = await launchBrowser();

    if (formato === 'pdf') {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 2000));
      const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
      await page.close();
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="proposta-${nome}.pdf"`);
      return res.send(pdf);
    }

    const screenshot = await captureScreenshot(browser, url);
    // inline = mostra direto no navegador (não força download)
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `inline; filename="proposta-${nome}.png"`);
    return res.send(screenshot);

  } catch (err) {
    console.error('[screenshot] ERRO:', err.message, err.stack);
    res.status(500).json({ error: 'Erro ao gerar proposta', details: err.message });
  } finally {
    if (browser) try { await browser.close(); } catch(e) {}
  }
}

app.get('/gerar-proposta/pagina1', (req, res) => gerarScreenshot(req, res, 'eneris-proposta.htm'));
app.get('/gerar-proposta/pagina2', (req, res) => gerarScreenshot(req, res, 'proposta2.html'));

// ============================================================
// GET /gerar-proposta — ambas em JSON base64
// ============================================================
app.get('/gerar-proposta', async (req, res) => {
  const nome = req.query.nome || 'Cliente';
  const consumo = req.query.consumo || '1800';
  const pagina = req.query.pagina || 'ambas';
  const formato = req.query.formato || 'png';
  const baseUrl = `http://127.0.0.1:${PORT}/templates`;

  const urls = [];
  if (pagina === '1' || pagina === 'ambas') {
    urls.push({ label: 'mapeamento', url: `${baseUrl}/eneris-proposta.htm?nome=${encodeURIComponent(nome)}&consumo=${consumo}` });
  }
  if (pagina === '2' || pagina === 'ambas') {
    urls.push({ label: 'precos', url: `${baseUrl}/proposta2.html?consumo=${consumo}` });
  }

  if (urls.length === 1) {
    const p = pagina === '1' ? 'pagina1' : 'pagina2';
    return res.redirect(`/gerar-proposta/${p}?nome=${encodeURIComponent(nome)}&consumo=${consumo}&formato=${formato}`);
  }

  let browser;
  try {
    browser = await launchBrowser();
    const images = [];
    for (const item of urls) {
      const screenshot = await captureScreenshot(browser, item.url);
      images.push({ label: item.label, buffer: screenshot });
    }

    res.json({
      cliente: nome,
      consumo_kwh: consumo,
      propostas: images.map(img => ({
        pagina: img.label,
        formato: 'png',
        base64: img.buffer.toString('base64'),
        filename: `proposta-${nome}-${img.label}.png`
      }))
    });
  } catch (err) {
    console.error('[gerar-proposta] ERRO:', err.message);
    res.status(500).json({ error: 'Erro ao gerar proposta', details: err.message });
  } finally {
    if (browser) try { await browser.close(); } catch(e) {}
  }
});

app.listen(PORT, () => {
  console.log(`🚀 API Eneris rodando em http://0.0.0.0:${PORT}`);
  console.log(`📄 Templates em http://0.0.0.0:${PORT}/templates/`);
  console.log(`🔗 Endpoints:`);
  console.log(`   GET /gerar-proposta?nome=Joao&consumo=1800`);
  console.log(`   GET /gerar-proposta/pagina1?nome=Joao&consumo=1800`);
  console.log(`   GET /gerar-proposta/pagina2?consumo=1800`);
  console.log(`   GET /health`);
});
