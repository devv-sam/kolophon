import { launch, type LaunchedChrome } from "chrome-launcher";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

let chrome: LaunchedChrome | undefined;
let browser: Promise<Browser> | undefined;

// One headless Chrome per server process, started on first use.
function getBrowser(): Promise<Browser> {
  browser ??= (async () => {
    try {
      chrome = await launch({ chromeFlags: ["--headless=new", "--disable-gpu"] });
    } catch (err) {
      browser = undefined;
      throw new Error(
        "kolophon could not find Chrome. Install Google Chrome, or set CHROME_PATH to a Chrome/Chromium binary.",
        { cause: err },
      );
    }
    return puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
  })();
  return browser;
}

/** Opens `url`, waits for network and fonts to settle, runs `fn`, closes the tab. */
export async function withPage<T>(url: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const { protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Only http and https URLs are supported, got ${protocol}`);
  }
  const page = await (await getBrowser()).newPage();
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    return await fn(page);
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  await (await browser?.catch(() => undefined))?.disconnect();
  chrome?.kill();
}
