import "dotenv/config";
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.D2_BASE ?? "http://localhost:3100";
const OUT = "scripts/d2/shots";

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const viewports = [
    { name: "320", width: 320, height: 720 },
    { name: "390", width: 390, height: 844 },
    { name: "768", width: 768, height: 1024 },
    { name: "1440", width: 1440, height: 900 },
  ];

  for (const v of viewports) {
    const ctx = await browser.newContext({ viewport: v });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    // Scroll progressif pour déclencher les Reveal avant la capture pleine page.
    await page.evaluate(async () => {
      const h = document.body.scrollHeight;
      for (let y = 0; y < h; y += 500) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/home-${v.name}.png`, fullPage: true });
    // Débordement horizontal ?
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    console.log(`${v.name}px — overflow-x: ${overflow}px`);
    await ctx.close();
  }

  // reduced-motion : tout doit être visible immédiatement
  const rmCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await rmCtx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  const hidden = await page.evaluate(() => {
    const els = document.querySelectorAll(".reveal, .hero-in");
    let count = 0;
    els.forEach((el) => {
      if (getComputedStyle(el).opacity !== "1") count++;
    });
    return count;
  });
  console.log(`reduced-motion : ${hidden} élément(s) masqué(s)`);
  await rmCtx.close();
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
