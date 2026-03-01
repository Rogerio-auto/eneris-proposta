const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Chromium do sistema (Docker) ou Puppeteer bundled (local)
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || null;

// Serve os templates HTML estáticos
app.use('/templates', express.static(path.join(__dirname, 'templates')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// GET /gerar-proposta
// Query params:
//   nome    – nome do cliente (default: "Cliente")
//   consumo – consumo mensal em kWh (default: 1800)
//   pagina  – qual proposta gerar: "1" (mapeamento), "2" (preços) ou "ambas" (default: "ambas")
//   formato – "png" ou "pdf" (default: "png")
// ============================================================
app.get('/gerar-proposta', async (req, res) => {
  const nome = req.query.nome || 'Cliente';
  const consumo = req.query.consumo || '1800';
  const pagina = req.query.pagina || 'ambas';
  const formato = req.query.formato || 'png';

  // Monta as URLs dos templates locais
  const baseUrl = `http://localhost:${PORT}/templates`;
  const urls = [];

  if (pagina === '1' || pagina === 'ambas') {
    urls.push({
      label: 'mapeamento',
      url: `${baseUrl}/eneris-proposta.htm?nome=${encodeURIComponent(nome)}&consumo=${consumo}`
    });
  }
  if (pagina === '2' || pagina === 'ambas') {
    urls.push({
      label: 'precos',
      url: `${baseUrl}/proposta2.html?consumo=${consumo}`
    });
  }

  let browser;
  try {
    console.log(`[gerar-proposta] nome=${nome} consumo=${consumo} pagina=${pagina} formato=${formato}`);
    browser = await puppeteer.launch({
      headless: true,
      executablePath: CHROMIUM_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--font-render-hinting=none',
        '--single-process'
      ]
    });
    console.log('[gerar-proposta] Browser iniciado');

    // Se só uma página, retorna direto
    if (urls.length === 1) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(urls[0].url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 1000)); // aguarda renderização

      if (formato === 'pdf') {
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        res.set('Content-Type', 'application/pdf');
        res.set('Content-Disposition', `attachment; filename="proposta-${nome}.pdf"`);
        return res.send(pdf);
      }

      const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
      res.set('Content-Type', 'image/png');
      res.set('Content-Disposition', `attachment; filename="proposta-${nome}.png"`);
      return res.send(screenshot);
    }

    // Se ambas as páginas, retorna ZIP com as duas imagens
    // ou retorna a primeira página + segunda em sequência numa única imagem
    const images = [];
    for (const item of urls) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(item.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await page.waitForSelector('body', { timeout: 10000 });
      await new Promise(r => setTimeout(r, 1000));

      if (formato === 'pdf') {
        const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
        images.push({ label: item.label, buffer: pdf });
      } else {
        const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
        images.push({ label: item.label, buffer: screenshot });
      }
      await page.close();
    }

    // Retorna como JSON com base64 para facilitar integração
    const result = images.map(img => ({
      pagina: img.label,
      formato: formato,
      base64: img.buffer.toString('base64'),
      filename: `proposta-${nome}-${img.label}.${formato}`
    }));

    res.json({
      cliente: nome,
      consumo_kwh: consumo,
      propostas: result
    });

  } catch (err) {
    console.error('Erro ao gerar proposta:', err);
    res.status(500).json({ error: 'Erro ao gerar proposta', details: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// ============================================================
// GET /gerar-proposta/pagina1 — screenshot direto da página 1
// GET /gerar-proposta/pagina2 — screenshot direto da página 2
// ============================================================
async function gerarScreenshot(req, res, templateFile) {
  const nome = req.query.nome || 'Cliente';
  const consumo = req.query.consumo || '1800';
  const formato = req.query.formato || 'png';

  const url = `http://localhost:${PORT}/templates/${templateFile}?nome=${encodeURIComponent(nome)}&consumo=${consumo}`;
  console.log(`[screenshot] ${templateFile} nome=${nome} consumo=${consumo} url=${url}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: CHROMIUM_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--font-render-hinting=none',
        '--single-process'
      ]
    });
    console.log('[screenshot] Browser iniciado');

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('body', { timeout: 10000 });
    await new Promise(r => setTimeout(r, 1000)); // aguarda renderização completa

    if (formato === 'pdf') {
      const pdf = await page.pdf({ format: 'A4', landscape: true, printBackground: true });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="proposta-${nome}.pdf"`);
      return res.send(pdf);
    }

    const screenshot = await page.screenshot({ fullPage: true, type: 'png' });
    console.log(`[screenshot] Gerado com sucesso: ${screenshot.length} bytes`);

    if (!screenshot || screenshot.length < 1000) {
      throw new Error(`Screenshot inválido (${screenshot ? screenshot.length : 0} bytes)`);
    }

    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="proposta-${nome}.png"`);
    return res.send(screenshot);

  } catch (err) {
    console.error('[screenshot] ERRO:', err.message);
    console.error(err.stack);
    res.status(500).json({ error: 'Erro ao gerar proposta', details: err.message });
  } finally {
    if (browser) {
      try { await browser.close(); } catch(e) { /* ignore */ }
    }
  }
}

app.get('/gerar-proposta/pagina1', (req, res) => gerarScreenshot(req, res, 'eneris-proposta.htm'));
app.get('/gerar-proposta/pagina2', (req, res) => gerarScreenshot(req, res, 'proposta2.html'));

app.listen(PORT, () => {
  console.log(`🚀 API Eneris rodando em http://0.0.0.0:${PORT}`);
  console.log(`📄 Templates em http://0.0.0.0:${PORT}/templates/`);
  console.log(`🔗 Endpoints:`);
  console.log(`   GET /gerar-proposta?nome=Joao&consumo=1800`);
  console.log(`   GET /gerar-proposta/pagina1?nome=Joao&consumo=1800`);
  console.log(`   GET /gerar-proposta/pagina2?consumo=1800`);
  console.log(`   GET /health`);
});
