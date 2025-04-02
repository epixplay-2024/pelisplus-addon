const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const playwright = require("playwright");
const express = require("express");

// 🧠 Manifest Configuration
const manifest = {
  id: "org.pelisplus.completeaddon",
  version: "1.0.0",
  name: "PelisPlusHD Completo",
  description: "Addon que muestra películas en español desde PelisPlusHD",
  logo: "https://images.sftcdn.net/images/t_app-icon-m/p/67cbd601-cb92-40eb-8aea-ac758afec92c/1635940076/pelisplus-ver-peliculas-series-tjf-logo",
  catalogs: [
    {
      type: "movie",
      id: "pelisplus-es",
      name: "Películas en Español",
      extra: [{ name: "skip", isRequired: false }]
    }
  ],
  resources: ["catalog", "meta", "stream"],
  types: ["movie"],
  idPrefixes: [""]
};

const builder = new addonBuilder(manifest);

// 🧠 Memory Cache Configuration
const catalogCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes cache

const isFresh = (entry) => entry && (Date.now() - entry.timestamp < CACHE_TTL);

// 📦 Catalog Handler with Improved Error Handling
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "movie" || id !== "pelisplus-es") return { metas: [] };

  try {
    const skip = parseInt(extra?.skip || 0);
    const limit = parseInt(extra?.limit || 24);
    const pageNum = Math.floor(skip / limit) + 1;
    const cacheKey = `page-${pageNum}`;

    if (isFresh(catalogCache.get(cacheKey))) {
      return { metas: catalogCache.get(cacheKey).data };
    }

    console.log(`🧪 Scraping page ${pageNum}...`);
    const browser = await playwright.chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for Render
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36'
    });

    const page = await context.newPage();
    await page.goto(`https://pelisplushd.bz/peliculas?page=${pageNum}`, { 
      timeout: 60000,
      waitUntil: "networkidle2"
    });

    const movies = await page.$$eval("a.Posters-link", (cards) => {
      return cards.map((card) => {
        try {
          const img = card.querySelector("img");
          const title = card.querySelector("p")?.innerText?.trim();
          const link = card.getAttribute("href");
          const slug = link?.split("/pelicula/")[1];

          let poster = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
          if (!poster.startsWith("http")) {
            const srcset = img?.getAttribute("srcset");
            poster = srcset?.split(",")[0]?.split(" ")[0] || "";
          }

          return (slug && title && poster.includes("tmdb")) ? {
            id: slug,
            name: title,
            type: "movie",
            poster,
            background: poster
          } : null;
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
    });

    catalogCache.set(cacheKey, { data: movies, timestamp: Date.now() });
    return { metas: movies };

  } catch (err) {
    console.error(`❌ Catalog error: ${err.message}`);
    return { metas: [] };
  }
});

// 🎭 Meta Handler with Enhanced Selectors
builder.defineMetaHandler(async ({ id }) => {
  if (id.startsWith("tt")) return { meta: {} };

  try {
    const browser = await playwright.chromium.launch({ 
      headless: true,
      args: ['--no-sandbox'] 
    });
    const page = await browser.newPage();
    
    await page.goto(`https://pelisplushd.bz/pelicula/${id}`, {
      timeout: 60000,
      waitUntil: "domcontentloaded"
    });

    const meta = await page.evaluate(() => {
      const getText = (selector) => 
        document.querySelector(selector)?.innerText?.trim() || "";
      
      const getAttr = (selector, attr) =>
        document.querySelector(selector)?.getAttribute(attr) || "";

      return {
        id: window.location.pathname.split("/pelicula/")[1],
        name: getText("h1"),
        type: "movie",
        poster: getAttr(".poster img", "src"),
        background: getAttr(".backdrop", "style")?.match(/url\(['"]?(.*?)['"]?\)/i)?.[1] || "",
        description: getText(".description"),
        cast: Array.from(document.querySelectorAll(".cast-list li")).map(el => el.innerText.trim()),
        director: getText(".director"),
        runtime: getText(".duration")
      };
    });

    return { meta };

  } catch (err) {
    console.error(`❌ Meta error for ${id}: ${err.message}`);
    return { meta: {} };
  }
});

// 🎬 Stream Handler with Fallback Options
builder.defineStreamHandler(async ({ id }) => {
  try {
    // Primary method: Playwright for dynamic content
    const browser = await playwright.chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`https://pelisplushd.bz/pelicula/${id}`, {
      waitUntil: "networkidle"
    });

    const iframeSrc = await page.$eval("iframe", el => el.src);
    await browser.close();

    if (iframeSrc) {
      return {
        streams: [{
          title: "PelisPlusHD",
          url: iframeSrc,
          behaviorHints: {
            notWebReady: true,
            proxyHeaders: {
              "Referer": "https://pelisplushd.bz/"
            }
          }
        }]
      };
    }

    // Fallback method: Axios + Cheerio
    const { data } = await axios.get(`https://pelisplushd.bz/pelicula/${id}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
      }
    });
    const $ = cheerio.load(data);
    const fallbackIframe = $("iframe").first().attr("src");

    if (fallbackIframe) {
      return {
        streams: [{
          title: "PelisPlusHD (Fallback)",
          url: fallbackIframe
        }]
      };
    }

    throw new Error("No stream sources found");

  } catch (err) {
    console.error(`❌ Stream error for ${id}: ${err.message}`);
    return { streams: [] };
  }
});

// 🚀 Configuración del servidor para Render
const app = express();
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';

// 1. Crea la interfaz del addon
const addonInterface = builder.getInterface();

// 2. Configura rutas específicas
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.get('/keepalive', (req, res) => {
  res.send('OK');
});

// 3. Maneja las rutas de Stremio directamente
app.all('/*', (req, res) => {
  serveHTTP(addonInterface)(req, res); // ✅ Forma correcta de integrar
});

// 4. Inicia el servidor
app.listen(PORT, HOST, () => {
  console.log(`
  🚀 Addon desplegado correctamente!
  ► URL: http://${HOST}:${PORT}/manifest.json
  ► Health: http://${HOST}:${PORT}/health
  `);
});