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

// 📦 Catálogo con paginación y caché
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "movie" || id !== "pelisplus-es") return { metas: [] };

  const skip = parseInt(extra?.skip || 0);
  const limit = parseInt(extra?.limit || 24);
  const pageNum = Math.floor(skip / limit) + 1;

  const cacheKey = `page-${pageNum}`;
  console.log(`📄 Solicitando página ${pageNum} (offset ${skip})`);

  if (isFresh(catalogCache.get(cacheKey))) {
    console.log(`📦 Usando caché para página ${pageNum}`);
    return { metas: catalogCache.get(cacheKey).data };
  }

  console.log(`🧪 Scraping página ${pageNum}...`);
  const metas = [];
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const url = `https://pelisplushd.bz/peliculas?page=${pageNum}`;
    await page.goto(url, { timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForSelector("a.Posters-link", { timeout: 15000 });

    const movies = await page.$$eval("a.Posters-link", (cards) => {
      return cards.map((card) => {
        const img = card.querySelector("img");
        const title = card.querySelector("p")?.innerText?.trim();
        const link = card.getAttribute("href");
        const slug = link?.split("/pelicula/")[1];

        let poster = img?.getAttribute("src") || img?.getAttribute("data-src") || "";
        if (!poster.startsWith("http")) {
          const srcset = img?.getAttribute("srcset");
          poster = srcset?.split(",")[0]?.split(" ")[0] || "";
        }

        if (slug && title && poster.includes("tmdb")) {
          return {
            id: slug,
            name: title,
            type: "movie",
            poster,
            background: poster
          };
        }
        return null;
      }).filter(Boolean);
    });

    metas.push(...movies);
    console.log(`✅ Página ${pageNum} cargada con ${metas.length} películas`);
    catalogCache.set(cacheKey, { data: metas, timestamp: Date.now() });

  } catch (err) {
    console.error(`❌ Error en la página ${pageNum}:`, err.message);
  } finally {
    await browser.close();
  }

  return { metas };
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


// 🚀 Configuración del servidor CORREGIDA
const app = express();
const PORT = process.env.PORT || 10000;

// 1. Crea la interfaz del addon
const addonInterface = builder.getInterface();

// 2. Configura el handler de Stremio (FORMA CORRECTA)
const stremioHandler = serveHTTP(addonInterface);

// 3. Middleware para todas las rutas
app.use((req, res) => {
    // Verifica si es una ruta de Stremio
    if (req.url.startsWith('/:')) {
        return stremioHandler(req, res);
    }
    // Rutas normales
    switch(req.url) {
        case '/manifest.json':
            res.setHeader('Content-Type', 'application/json');
            return res.json(manifest);
        case '/health':
            return res.json({ status: 'online', version: manifest.version });
        default:
            return res.status(404).send('Not Found');
    }
});

// 4. Inicia el servidor con manejo de errores
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
    🎬 Addon funcionando en puerto ${PORT}
    ► URL: http://0.0.0.0:${PORT}/manifest.json
    `);
});

server.on('error', (err) => {
    console.error('🚨 Error en el servidor:', err);
});