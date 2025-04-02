const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const manifest = {
  id: "org.addon.test",
  version: "1.0.0",
  name: "Addon Test",
  description: "Addon de prueba para EvenNode",
  resources: ["catalog"],
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: "test-catalog",
      name: "Test Catalog"
    }
  ]
};

const builder = new addonBuilder(manifest);
const PORT = process.env.PORT || 3000;
const HOST = "0.0.0.0";

require("http")
  .createServer(serveHTTP(builder.getInterface()))
  .listen(PORT, HOST, () => {
    console.log(`✅ Addon corriendo en: http://${HOST}:${PORT}/manifest.json`);
  });
