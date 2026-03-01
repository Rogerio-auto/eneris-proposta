const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Chromium do sistema (Docker) ou Puppeteer bundled (local)
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || null;

// Diretório dos templates
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Args do Chromium
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--font-render-hinting=none',
  '--no-first-run',
  '--no-zygote',
  '--disable-web-security',
  '--allow-file-access-from-files'
];

// Serve os templates HTML estáticos (para visualizar no browser)
app.use('/templates', express.static(TEMPLATES_DIR));

// Rota raiz
app.get('/', (req, res) => {
  res.send(`
    <html>
    <head><title>API Eneris Proposta</title></head>
    <body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 20px;">
      <h1>API Eneris Proposta</h1>
      <p style="color:#666;margin-bottom:12px;">Formato padrão: <b>html</b> (imagem embutida). Use <code>?formato=png</code> para binário direto, <code>?formato=pdf</code> para PDF, <code>?formato=base64</code> para JSON.</p>
      <ul>
        <li><a href="/health">/health</a></li>
        <li><a href="/gerar-proposta/pagina1?nome=Cliente&consumo=1800">/gerar-proposta/pagina1?nome=Cliente&amp;consumo=1800</a> — Mapeamento (HTML)</li>
        <li><a href="/gerar-proposta/pagina2?nome=Cliente&consumo=1800">/gerar-proposta/pagina2?nome=Cliente&amp;consumo=1800</a> — Preços (HTML)</li>
        <li><a href="/gerar-proposta/pagina1?nome=Cliente&consumo=1800&formato=png">/gerar-proposta/pagina1?formato=png</a> — Mapeamento (PNG direto)</li>
        <li><a href="/gerar-proposta?nome=Cliente&consumo=1800">/gerar-proposta?nome=Cliente&amp;consumo=1800</a> — Ambas (JSON base64)</li>
      </ul>
    </body></html>
  `);
});

// Health check
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

// ============================================================
// Renderiza template via setContent (sem HTTP round-trip)
// Lê o HTML do disco e injeta os parâmetros diretamente
// ============================================================
async function renderTemplate(browser, templateFile, params) {
  const filePath = path.join(TEMPLATES_DIR, templateFile);
  let html = fs.readFileSync(filePath, 'utf8');

  // Constrói a query string com os parâmetros
  const searchString = '?' + Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  // Substitui window.location.search por uma string fixa com os parâmetros
  // Isso funciona porque todos os templates usam: new URLSearchParams(window.location.search)
  html = html.replace(
    /new URLSearchParams\(window\.location\.search\)/g,
    `new URLSearchParams('${searchString}')`
  );

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  page.on('console', msg => console.log('[chrome]', msg.text()));
  page.on('pageerror', err => console.error('[chrome-err]', err.message));

  console.log(`[render] ${templateFile} params=${JSON.stringify(params)}`);
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });

  // Aguarda renderização completa (fontes, JS, etc)
  await new Promise(r => setTimeout(r, 3000));

  return page;
}

// Captura screenshot de uma page já renderizada
async function takeScreenshot(page) {
  const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
  console.log(`[screenshot] ${screenshot.length} bytes`);

  // Valida magic bytes PNG
  if (!screenshot || screenshot.length < 1000 ||
      screenshot[0] !== 0x89 || screenshot[1] !== 0x50 ||
      screenshot[2] !== 0x4E || screenshot[3] !== 0x47) {
    throw new Error(`Screenshot corrompido (${screenshot?.length || 0} bytes)`);
  }
  return screenshot;
}

// ============================================================
// GET /gerar-proposta/pagina1 — Mapeamento de Cargas
// GET /gerar-proposta/pagina2 — Proposta Orientativa
//
// ?formato=html  → página HTML com imagem embutida (padrão, funciona em qualquer proxy)
// ?formato=png   → binário PNG direto (Content-Type: image/png)
// ?formato=pdf   → PDF direto
// ?formato=base64 → JSON com base64
// ============================================================
async function gerarScreenshot(req, res, templateFile) {
  const nome = req.query.nome || 'Cliente';
  const consumo = req.query.consumo || '1800';
  const formato = req.query.formato || 'html';

  let browser;
  try {
    browser = await launchBrowser();
    const page = await renderTemplate(browser, templateFile, { nome, consumo });

    if (formato === 'pdf') {
      const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
      await page.close();
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="proposta-${nome}.pdf"`);
      return res.send(pdf);
    }

    const screenshot = await takeScreenshot(page);
    await page.close();
    const b64 = screenshot.toString('base64');

    // formato=base64 → JSON
    if (formato === 'base64') {
      return res.json({
        cliente: nome,
        consumo_kwh: consumo,
        formato: 'png',
        base64: b64,
        filename: `proposta-${nome}.png`
      });
    }

    // formato=png → binário direto
    if (formato === 'png') {
      res.set('Content-Type', 'image/png');
      res.set('Content-Length', screenshot.length);
      res.set('Content-Disposition', `inline; filename="proposta-${nome}.png"`);
      return res.end(screenshot);
    }

    // formato=html (padrão) → página HTML com imagem base64 embutida
    // Isso SEMPRE funciona, independente do proxy
    return res.send(`<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Proposta - ${nome}</title>
<style>
  * { margin: 0; padding: 0; }
  body { background: #1a1a1a; display: flex; justify-content: center; align-items: flex-start; min-height: 100vh; }
  img { max-width: 100%; height: auto; display: block; }
  .actions { position: fixed; top: 10px; right: 10px; z-index: 10; }
  .actions a { background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-family: sans-serif; font-size: 14px; }
  .actions a:hover { background: #45a049; }
</style>
</head><body>
<div class="actions">
  <a href="data:image/png;base64,${b64}" download="proposta-${nome}.png">⬇ Baixar PNG</a>
</div>
<img src="data:image/png;base64,${b64}" alt="Proposta ${nome}" />
</body></html>`);

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

  if (pagina === '1') {
    return res.redirect(`/gerar-proposta/pagina1?nome=${encodeURIComponent(nome)}&consumo=${consumo}&formato=${formato}`);
  }
  if (pagina === '2') {
    return res.redirect(`/gerar-proposta/pagina2?nome=${encodeURIComponent(nome)}&consumo=${consumo}&formato=${formato}`);
  }

  // Ambas as páginas -> JSON com base64
  const templates = [
    { label: 'mapeamento', file: 'eneris-proposta.htm' },
    { label: 'precos', file: 'proposta2.html' }
  ];

  let browser;
  try {
    browser = await launchBrowser();
    const images = [];

    for (const tpl of templates) {
      const page = await renderTemplate(browser, tpl.file, { nome, consumo });
      const screenshot = await takeScreenshot(page);
      await page.close();
      images.push({ label: tpl.label, buffer: screenshot });
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
