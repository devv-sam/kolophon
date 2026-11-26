import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { Launcher, launch, type LaunchedChrome } from "chrome-launcher";
import puppeteer, { type Browser, type CDPSession, type Page, type Viewport } from "puppeteer-core";

let chrome: LaunchedChrome | undefined;
let browser: Promise<Browser> | undefined;

/** Fixed, so responsive values are comparable between runs. */
export const VIEWPORTS = {
  desktop: { width: 1280, height: 800, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
} satisfies Record<string, Viewport>;

// A machine with no mouse, such as a CI runner, otherwise reports `hover: none` on desktop.
// Touch emulation still overrides this on mobile.
const MOUSE = "--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4";

// chrome-launcher finds only Chrome, and Chromium only on Linux. Arc is left out: it never opens a debugging port when headless.
const BROWSERS = [
  { name: "Chrome", mac: "Google Chrome", linux: ["google-chrome", "google-chrome-stable"], win: "Google\\Chrome\\Application\\chrome.exe" },
  { name: "Chromium", mac: "Chromium", linux: ["chromium", "chromium-browser"], win: "Chromium\\Application\\chrome.exe" },
  { name: "Edge", mac: "Microsoft Edge", linux: ["microsoft-edge", "microsoft-edge-stable"], win: "Microsoft\\Edge\\Application\\msedge.exe" },
  { name: "Brave", mac: "Brave Browser", linux: ["brave-browser"], win: "BraveSoftware\\Brave-Browser\\Application\\brave.exe" },
  { name: "Vivaldi", mac: "Vivaldi", linux: ["vivaldi", "vivaldi-stable"], win: "Vivaldi\\Application\\vivaldi.exe" },
];
const NAMES = BROWSERS.map((b) => b.name).join(", ");

/** The first Chromium-based browser installed, in the order of `BROWSERS`. `exists` is injected so tests need no browser. */
export async function findBrowser(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string, exists: (path: string) => Promise<boolean>): Promise<string | undefined> {
  const paths =
    platform === "darwin"
      ? BROWSERS.flatMap(({ mac }) => ["/Applications", `${home}/Applications`].map((dir) => `${dir}/${mac}.app/Contents/MacOS/${mac}`))
      : platform === "win32"
        ? BROWSERS.flatMap(({ win }) => [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter(Boolean).map((root) => `${root}\\${win}`))
        : BROWSERS.flatMap(({ linux }) => linux.flatMap((bin) => (env.PATH ?? "").split(":").filter(Boolean).map((dir) => `${dir}/${bin}`)));
  for (const path of paths) if (await exists(path)) return path;
  return undefined;
}

const executable = (path: string) => access(path, constants.X_OK).then(() => true, () => false);

async function browserPath(): Promise<string> {
  // chrome-launcher ignores a missing CHROME_PATH when searching, and crashes the
  // process with an unhandled spawn error when given one, so check it here.
  const set = process.env.CHROME_PATH;
  if (set) {
    if (await executable(set)) return set;
    throw new Error(`CHROME_PATH is ${set}, which isn't an executable file. Point it at a Chromium-based browser (${NAMES}), or unset it so kolophon searches.`);
  }
  const found = Launcher.getFirstInstallation() ?? (await findBrowser(process.platform, process.env, homedir(), executable));
  if (found) return found;
  throw new Error(`Couldn't find a Chromium-based browser. kolophon looked for ${NAMES} where they usually install. Install one, or set CHROME_PATH to its binary.`);
}

// One headless browser per process, started on first use.
function getBrowser(): Promise<Browser> {
  browser ??= (async () => {
    try {
      const chromePath = await browserPath();
      try {
        chrome = await launch({ chromePath, chromeFlags: ["--headless=new", "--disable-gpu", MOUSE] });
      } catch (err) {
        throw new Error(`Found ${chromePath} but couldn't start it: ${err instanceof Error ? err.message : String(err)}. Set CHROME_PATH to another Chromium-based browser if this one won't run headless.`, { cause: err });
      }
    } catch (err) {
      browser = undefined;
      throw err;
    }
    return puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
  })();
  return browser;
}

// Ignores the query, hash and a trailing slash, which apps rewrite without changing page.
const pageKey = (url: string) => {
  const { origin, pathname } = new URL(url);
  return origin + pathname.replace(/\/$/, "");
};

function assertSamePage(page: Page, url: string): void {
  if (pageKey(page.url()) !== pageKey(url)) {
    throw new Error(`${url} redirected to ${page.url()}. Pass the URL of the page to measure; pages behind a login aren't supported.`);
  }
}

/**
 * Opens `url` at a fixed viewport, waits for network and fonts to settle, runs `fn`, closes the tab.
 * Throws on an error status or a redirect to another page, so neither is measured as the app.
 */
export async function withPage<T>(url: string, fn: (page: Page) => Promise<T>, viewport: Viewport = VIEWPORTS.desktop): Promise<T> {
  const { protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Only http and https URLs are supported, got ${protocol}`);
  }
  const page = await (await getBrowser()).newPage();
  try {
    await page.setViewport(viewport);
    // Otherwise taken from the machine's own settings.
    await page.emulateMediaFeatures([
      { name: "prefers-color-scheme", value: "light" },
      { name: "prefers-reduced-motion", value: "no-preference" },
    ]);
    const response = await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
    // 304 is a cached copy of the page, not an error.
    if (response && !response.ok() && response.status() !== 304) throw new Error(`${url} answered ${response.status()}`);
    assertSamePage(page, url);
    await page.evaluate(() => document.fonts.ready);
    const result = await fn(page);
    assertSamePage(page, url); // It may have navigated while being measured.
    return result;
  } finally {
    await page.close();
  }
}

// Sync on purpose, so it can run from an exit handler.
export function closeBrowser(): void {
  chrome?.kill();
  chrome = browser = undefined;
}

/**
 * Enables the CSS domain and returns every stylesheet's text with its URL. Reading over CDP
 * works for cross-origin sheets (CDNs, Google Fonts) that the page itself isn't allowed to read.
 */
export async function readStyleSheets(cdp: CDPSession, page: Page): Promise<{ url: string; text: string }[]> {
  await cdp.send("DOM.enable"); // CSS.enable requires it.
  // CSS.enable announces every existing stylesheet before it resolves.
  const sheets: { id: string; url: string }[] = [];
  cdp.on("CSS.styleSheetAdded", ({ header }) => sheets.push({ id: header.styleSheetId, url: header.sourceURL || page.url() }));
  await cdp.send("CSS.enable");
  const texts = [];
  for (const sheet of sheets) {
    try {
      const { text } = await cdp.send("CSS.getStyleSheetText", { styleSheetId: sheet.id });
      texts.push({ url: sheet.url, text });
    } catch {
      // A sheet removed since it was announced has no text; skip it.
    }
  }
  return texts;
}
