import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(92);
// The cat lives in ../assets/cat (shared with the web app). Resolve its `react` import
// from this project so there is exactly one React in the bundle.
Config.overrideWebpackConfig((c) => ({
  ...c,
  resolve: { ...c.resolve, modules: [path.resolve(process.cwd(), "node_modules"), "node_modules"] },
}));
