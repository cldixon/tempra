import { defineWranglerConfig } from "wrangler/experimental-config";

export default defineWranglerConfig({
  types: {
    generate: false,
  },
  // The Worker's static assets (TEMPRA-174), written by the app's build (app/build.ts). Through
  // node_modules, so the path holds wherever this file is copied with node_modules beside it (the
  // gate's throwaway project under .gate/).
  assetsDirectory: "node_modules/@tempra/app/dist/public",
});
