// Scratch debugging: evaluate selectors on a route (read-only, seatbelted).
import { launch, newPage, settle, APP } from "./lib.mjs";
const [route, ...sels] = process.argv.slice(2);
const browser = await launch();
const { page, context } = await newPage(browser, "debug");
await page.goto(`${APP}/${route}`);
await settle(page, 1000);
for (const s of sels) {
  if (s.startsWith("eval:")) console.log(s, "=>", await page.evaluate(s.slice(5)));
  else console.log(s, "=>", await page.locator(s).count(), await page.locator(s).allInnerTexts().catch(() => []));
}
await context.close();
await browser.close();
