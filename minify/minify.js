import path from "path";
import { fileURLToPath } from "url";
import minify from "@node-minify/core";
import terser from "@node-minify/terser";
import cleanCSS from "@node-minify/clean-css";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, "../");

async function doMinify() {
    try {
        await minify({
            compressor: terser,
            input: path.join(rootPath, "data/src/*.js"),
            output: path.join(rootPath, "data/emulator.min.js"),
        });
    } catch (err) {
        console.error(err);
    }
    console.log("Minified JS");

    try {
        await minify({
            compressor: cleanCSS,
            input: path.join(rootPath, "data/emulator.css"),
            output: path.join(rootPath, "data/emulator.min.css"),
        });
    } catch (err) {
        console.error(err);
    }
    console.log("Minified CSS");
}

console.log("Minifying");
(async () => {
    await doMinify();
    console.log("Minifying Done!");
})();
