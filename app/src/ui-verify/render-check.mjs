// UI verification harness: loads the built app in system Edge (Playwright's
// bundled browsers are not installed) and reports the rendered SVG text + any
// page errors. Usage: node render-check.mjs [url]. Exits non-zero on page error.
import pw from "file:///C:/Users/Eugene/Projects/architecture-agent/Plexus/node_modules/playwright/index.js";
const { chromium } = pw;

const url = process.argv[2] ?? "http://localhost:4319/";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const texts = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#app svg text")).map((t) => t.textContent));
console.log(JSON.stringify({ texts, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
