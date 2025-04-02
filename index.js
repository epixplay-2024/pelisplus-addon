const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const manifest = {
  id: "org.pelisplus.addon",
  version: "1.0.0",
  name: "PelisPlusHD",
  description: "Addon de prueba",
  resources: ["stream"],
  types: ["movie"],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

builder.defineStreamHandler(({ id }) => {
  return Promise.resolve({
    streams: [
      {
        title: "Ejemplo Stream",
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
      }
    ]
  });
});

const PORT = process.env.PORT || 7000;
const HOST = "0.0.0.0";

require("http").createServer(serveHTTP(builder.getInterface())).listen(PORT, HOST, () => {
  console.log(`✅ Addon corriendo en: http://${HOST}:${PORT}/manifest.json`);
});
