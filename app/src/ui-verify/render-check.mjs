// UI verification harness: loads the built app in system Edge (Playwright's
// bundled browsers are not installed) and reports the rendered SVG text + any
// page errors. Usage: node render-check.mjs [url] [--click "<label>"]. The
// optional --click clicks the first SVG <text> matching the label (force, since
// SVG text fails Playwright actionability) before capturing. Exits non-zero on
// page error.
import pw from "file:///C:/Users/Eugene/Projects/architecture-agent/Plexus/node_modules/playwright/index.js";
const { chromium } = pw;

const argv = process.argv.slice(2);
const clickIdx = argv.indexOf("--click");
const clickLabel = clickIdx >= 0 ? argv[clickIdx + 1] : undefined;
const url = argv.find((a, i) => !a.startsWith("--") && i !== clickIdx + 1) ?? "http://localhost:4319/";

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
if (clickLabel) {
  // Exact match (anchored) so a label like "Model" doesn't also hit editor text
  // such as "model AppModel". SVG text fails actionability, hence force.
  const rx = new RegExp("^" + clickLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  await page.locator("#app svg text", { hasText: rx }).first().click({ force: true });
  await page.waitForTimeout(800);
}
const texts = await page.evaluate(() =>
  Array.from(document.querySelectorAll("#app svg text")).map((t) => t.textContent));
console.log(JSON.stringify({ texts, errors }, null, 2));
await browser.close();
if (errors.length) process.exit(1);
