const express = require("express");
const cors = require("cors");
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const cheerio = require("cheerio");
const playwright = require("playwright");

// ── Manifest Configuration ──
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

// ── Memory Cache Configuration ──
const catalogCache = new Map();
const CACHE_TTL = 1000 * 60 * 5; // 5 minutes

const isFresh = (entry) => entry && (Date.now() - entry.timestamp < CACHE_TTL);

// ── Define Catalog Handler ──
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

// ── Define Meta Handler ──
builder.defineMetaHandler(async ({ id }) => {
  if (id.startsWith("tt")) return { meta: {} };
  console.log("🧠 Meta solicitada para:", id);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`https://pelisplushd.bz/pelicula/${id}`, { timeout: 60000 });
    await page.waitForSelector(".text-large", { timeout: 10000 });
    const meta = await page.evaluate(() => {
      const title = document.querySelector("h1")?.innerText?.trim();
      const description = document.querySelector(".text-large")?.innerText?.trim();
      const poster = document.querySelector("img")?.getAttribute("src") || "";
      return {
        id: window.location.pathname.split("/pelicula/")[1],
        name: title,
        type: "movie",
        poster,
        background: poster,
        description
      };
    });
    return { meta };
  } catch (err) {
    console.error("❌ Error en meta:", err.message);
    return { meta: {} };
  } finally {
    await browser.close();
  }
});

// ── Define Stream Handler ──
builder.defineStreamHandler(async ({ id }) => {
  console.log("🎬 Stream solicitado para:", id);
  try {
    const url = `https://pelisplushd.bz/pelicula/${id}`;
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const iframe = $("iframe").first().attr("src");
    if (!iframe) throw new Error("No se encontró iframe");
    return {
      streams: [{
        title: "PelisPlusHD",
        url: iframe
      }]
    };
  } catch (err) {
    console.error("❌ Error en stream:", err.message);
    return { streams: [] };
  }
});

// ── Configuración del servidor con Express ──
const express = require("express");
const cors = require("cors");
const app = express();

// Habilitar CORS para todas las peticiones
app.use(cors());

// Aquí usaremos serveHTTP para todas las peticiones relacionadas con Stremio
app.use(serveHTTP(builder.getInterface(), { cors: true }));

// Rutas adicionales: manifest y health
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});
app.get("/health", (req, res) => {
  res.json({ status: "online", version: manifest.version });
});

// Inicia el servidor
const PORT = process.env.PORT; // Render o host asignan el puerto mediante process.env.PORT
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log(`✅ Addon corriendo en: http://${HOST}:${PORT}/manifest.json`);
});
