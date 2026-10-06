// Generates social preview images and the apple touch icon. Run: node tools/make-images.cjs
// Requires playwright (npx playwright) and the built ./public folder for fonts.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const font = (f) => "data:font/woff2;base64," + fs.readFileSync(path.join(__dirname, "../site/static/assets/fonts", f)).toString("base64");
const css = `
@font-face{font-family:P;src:url(${font("ibm-plex-sans-latin-600-normal.woff2")});font-weight:600}
@font-face{font-family:P;src:url(${font("ibm-plex-sans-latin-400-normal.woff2")});font-weight:400}
@font-face{font-family:P;src:url(${font("ibm-plex-sans-hebrew-hebrew-600-normal.woff2")});font-weight:600;unicode-range:U+0590-05FF}
@font-face{font-family:P;src:url(${font("ibm-plex-sans-hebrew-hebrew-400-normal.woff2")});font-weight:400;unicode-range:U+0590-05FF}
@font-face{font-family:M;src:url(${font("ibm-plex-mono-latin-500-normal.woff2")})}
*{margin:0;box-sizing:border-box}html{overflow:hidden;width:1200px;height:630px}body{width:1200px;height:630px;background:#0E1726;color:#F5F2EB;font-family:P;padding:72px 80px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden}
.mark{align-self:flex-start;display:flex;align-items:center;gap:4px;font-weight:600;font-size:48px;letter-spacing:-1.5px;direction:ltr}
.mark svg{width:40px;height:40px}.mark path{fill:none;stroke:#F08A4B;stroke-width:3.6;stroke-linecap:square}
h1{font-size:62px;line-height:1.12;font-weight:600;letter-spacing:-1.5px;max-width:860px}
p{font-size:24px;color:#AEB8C8;font-family:M;letter-spacing:3px;text-transform:uppercase}
[dir=rtl] h1{letter-spacing:0;line-height:1.25}[dir=rtl] p{font-family:P;letter-spacing:0;text-transform:none;font-size:28px}
.ring{position:absolute;inset-inline-end:-120px;top:120px;width:520px;height:520px;border:1.5px dashed #2A3A55;border-radius:50%}
.bar{position:absolute;inset-inline-start:0;bottom:0;height:10px;width:100%;background:#B9471A}`;
const mark = `<div class="mark"><svg viewBox="0 0 24 24"><path d="M4 4 L20 20"/><path d="M20 4 L14.2 9.8 M9.8 14.2 L4 20"/></svg><span>Sim</span></div>`;
const pages = {
  en: `<html lang="en"><style>${css}</style><body><div class="ring"></div>${mark}<h1>See how your leadership team really operates. Then make it better.</h1><p>Simulation-based executive development</p><div class="bar"></div></body></html>`,
  he: `<html lang="he" dir="rtl"><style>${css}</style><body><div class="ring"></div>${mark}<h1>ראו איך צוות ההנהלה שלכם באמת עובד. ואז שפרו את זה.</h1><p>פיתוח הנהלות באמצעות סימולציות עסקיות</p><div class="bar"></div></body></html>`,
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
  const out = path.join(__dirname, "../site/static/assets/img");
  fs.mkdirSync(out, { recursive: true });
  for (const [k, html] of Object.entries(pages)) {
    await p.setContent(html); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(out, `og-${k}.png`) });
  }
  await p.setViewportSize({ width: 180, height: 180 });
  await p.setContent(`<html><body style="margin:0;width:180px;height:180px;background:#0E1726;display:grid;place-items:center"><svg viewBox="0 0 24 24" width="104" height="104"><g fill="none" stroke="#F08A4B" stroke-width="3.2" stroke-linecap="square"><path d="M4 4 L20 20"/><path d="M20 4 L14.2 9.8 M9.8 14.2 L4 20"/></g></svg></body></html>`);
  await p.screenshot({ path: path.join(out, "apple-touch-icon.png") });
  await b.close();
  console.log("images written to", out);
})();
