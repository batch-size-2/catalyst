// Read-only probe: dump the visible text, ARIA landmarks and requests of a few routes.
import { launch, newPage, settle, APP, blocked } from "./lib.mjs";

const routes = process.argv.slice(2);
const browser = await launch();
for (const route of routes) {
  const { page, requests, context } = await newPage(browser, route);
  await page.goto(route.startsWith("http") ? route : `${APP}/${route}`);
  await settle(page, 1500);
  const info = await page.evaluate(() => {
    const labels = [...document.querySelectorAll("[aria-label],[role]")].map(
      (e) => `${e.tagName.toLowerCase()} role=${e.getAttribute("role") ?? ""} aria=${e.getAttribute("aria-label") ?? ""}`,
    );
    return { h: document.documentElement.scrollHeight, labels: [...new Set(labels)].slice(0, 80), text: document.body.innerText.slice(0, 5000) };
  });
  console.log(`\n===== ${route} (h=${info.h})`);
  console.log(info.labels.join("\n"));
  console.log("--- text\n" + info.text);
  console.log("--- requests\n" + requests.map((r) => `${r.method} ${r.url.replace(APP, "")}`).filter((s) => s.includes("/api/")).join("\n"));
  await context.close();
}
await browser.close();
console.log("BLOCKED:", blocked);
