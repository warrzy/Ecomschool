import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 800, height: 1131 } });
await p.goto("file:///C:/Users/LENOVO-L490/Desktop/Ecomschool/docs/livrables-commerciaux/html/demarrage-rapide.html");
await p.screenshot({ path: "/tmp/dr-page1.png" });
await p.evaluate(() => window.scrollTo(0, 2200));
await p.screenshot({ path: "/tmp/dr-page3.png" });
await b.close();
