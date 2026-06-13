import React, { useEffect, useRef, useState } from "react";

export interface FontData {
  name: string;
  family: string;
  style: string;
  weight: string;
  size: string;
  lineHeight: string;
  letterSpacing: string;
  colorRgb: string;
  colorHex: string;
}

interface Props {
  data: FontData | null;
  x: number;
  y: number;
  visible: boolean;
  onClose: () => void;
  // Live-apply a CSS property to the inspected element (edit view).
  onStyleChange?: (prop: string, value: string) => void;
}

export type ColorFormat =
  | "hex"
  | "rgb"
  | "hsl"
  | "hwb"
  | "lch"
  | "oklch"
  | "lab"
  | "oklab";

// ─── Color math ─────────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToHsl(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  const r = parseInt(m[0]) / 255,
    g = parseInt(m[1]) / 255,
    b = parseInt(m[2]) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

function rgbToHwb(rgb: string): string {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return rgb;
  const r = parseInt(m[0]) / 255,
    g = parseInt(m[1]) / 255,
    b = parseInt(m[2]) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0;
  if (max !== min) {
    const d = max - min;
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h = Math.round(h * 60);
  }
  return `hwb(${h} ${Math.round(min * 100)}% ${Math.round((1 - max) * 100)}%)`;
}

// sRGB -> CIE Lab (D50). Path: sRGB -> linear -> XYZ(D65) -> XYZ(D50) -> Lab.
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r),
    gl = srgbToLinear(g),
    bl = srgbToLinear(b);

  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;

  // Bradford chromatic adaptation D65 -> D50
  const xd =
    1.0479298208405488 * x + 0.022946793341019088 * y - 0.05019222954313557 * z;
  const yd =
    0.029627815688159344 * x + 0.990434484573249 * y - 0.01707382502938514 * z;
  const zd =
    -0.009243058152591783 * x +
    0.015055144896577895 * y +
    0.7518742899580008 * z;

  const xn = 0.96422,
    yn = 1.0,
    zn = 0.82521; // D50 reference white
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  const fx = f(xd / xn),
    fy = f(yd / yn),
    fz = f(zd / zn);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

// sRGB -> OKLab (Björn Ottosson). Path: sRGB -> linear -> LMS -> OKLab.
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r),
    gl = srgbToLinear(g),
    bl = srgbToLinear(b);

  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;

  const lp = Math.cbrt(l),
    mp = Math.cbrt(m),
    sp = Math.cbrt(s);

  return [
    0.2104542553 * lp + 0.793617785 * mp - 0.0040720468 * sp,
    1.9779984951 * lp - 2.428592205 * mp + 0.4505937099 * sp,
    0.0259040371 * lp + 0.7827717662 * mp - 0.808675766 * sp,
  ];
}

// Rectangular -> polar (Lab/OKLab -> LCh/OKLCh)
function toLch(L: number, a: number, b: number): [number, number, number] {
  const C = Math.sqrt(a * a + b * b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, C, h];
}

export function buildColorFormats(
  rgb: string,
  hex: string,
): Record<ColorFormat, string> {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) {
    return {
      hex,
      rgb,
      hsl: rgb,
      hwb: rgb,
      lch: rgb,
      oklch: rgb,
      lab: rgb,
      oklab: rgb,
    };
  }
  const r = parseInt(m[0]),
    g = parseInt(m[1]),
    b = parseInt(m[2]);

  const [labL, labA, labB] = rgbToLab(r, g, b);
  const [, lchC, lchH] = toLch(labL, labA, labB);
  const [okL, okA, okB] = rgbToOklab(r, g, b);
  const [, okC, okH] = toLch(okL, okA, okB);

  const n2 = (v: number) => (Math.round(v * 100) / 100).toString();
  const n4 = (v: number) => (Math.round(v * 10000) / 10000).toString();

  return {
    hex,
    rgb,
    hsl: rgbToHsl(rgb),
    hwb: rgbToHwb(rgb),
    lab: `lab(${n2(labL)} ${n2(labA)} ${n2(labB)})`,
    lch: `lch(${n2(labL)} ${n2(lchC)} ${n2(lchH)})`,
    oklab: `oklab(${n2(okL * 100)}% ${n4(okA)} ${n4(okB)})`,
    oklch: `oklch(${n4(okL)} ${n4(okC)} ${n2(okH)})`,
  };
}

// ─── Site info ──────────────────────────────────────────────────────────────
// Shown in the side panel header in place of extension branding. Gathered
// here (in the content script) so we don't need the broad "tabs" permission.

export interface SiteInfo {
  host: string;
  favicon: string;
}

function readSiteInfo(): SiteInfo {
  // href resolves relative paths against the page; sizes/shortcut variants
  // all match rel~="icon"
  const iconLink = document.querySelector<HTMLLinkElement>(
    'link[rel~="icon" i]',
  );
  return {
    host: location.hostname.replace(/^www\./, ""),
    favicon: iconLink?.href || `${location.origin}/favicon.ico`,
  };
}

// Order shown in dropdown
export const FORMAT_ORDER: ColorFormat[] = [
  "hex",
  "rgb",
  "hsl",
  "hwb",
  "lch",
  "oklch",
  "lab",
  "oklab",
];

// ─── Edit view ──────────────────────────────────────────────────────────────
// Live CSS controls that reuse the popup card as a second "page". Values seed
// from the inspected element's computed styles and write back on every change.

type View = "specs" | "edit";

interface EditState {
  fontSize: number;
  lineHeight: number;
  letterSpacing: number;
  fontWeight: number;
  color: string;
}

// Pull the leading number out of a computed value ("16px", "1.5"), falling
// back when the value is non-numeric ("normal").
function numOr(value: string, fallback: number): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function seedEdit(data: FontData): EditState {
  const size = numOr(data.size, 16);
  return {
    fontSize: size,
    // line-height computes to px; express as a ratio of size for a sane slider
    lineHeight: Math.round((numOr(data.lineHeight, size * 1.4) / size) * 100) / 100,
    letterSpacing: numOr(data.letterSpacing, 0),
    fontWeight: numOr(data.weight, 400),
    color: /^#[0-9a-f]{6}$/i.test(data.colorHex) ? data.colorHex : "#ffffff",
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PopupCard({ data, x, y, visible, onClose, onStyleChange }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorFormat>("hex");
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>("specs");
  const [edit, setEdit] = useState<EditState | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // New element clicked → reset to the spec page and reseed the edit controls.
  useEffect(() => {
    setView("specs");
    setEdit(data ? seedEdit(data) : null);
  }, [data]);

  if (!visible || !data) return null;

  const clampedX = Math.min(x, window.innerWidth - 300);
  const clampedY = Math.min(y, window.innerHeight - 280);

  const colorValues = buildColorFormats(data.colorRgb, data.colorHex);

  function patchEdit(patch: Partial<EditState>) {
    setEdit((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    if (!data) return;
    navigator.clipboard
      .writeText(data.family)
      .then(() => {
        setCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div
      style={styles.card(clampedX, clampedY)}
      onClick={(e) => {
        e.stopPropagation();
        setDropdownOpen(false);
      }}
    >
      {view === "edit" ? (
        <div style={styles.header}>
          <div style={styles.nameGroup}>
            <button
              style={styles.iconBtn}
              title="Back"
              onClick={(e) => {
                e.stopPropagation();
                setView("specs");
              }}
            >
              <ArrowLeft />
            </button>
            <span style={styles.editTitle}>Edit styles</span>
          </div>
          <div style={styles.headerActions}>
            <button style={styles.iconBtn} onClick={onClose} title="Close">
              <X />
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.header}>
          <div style={styles.nameGroup}>
            <span
              style={{
                ...styles.fontName,
                fontFamily: `'${data.name}', sans-serif`,
              }}
            >
              {data.name}
            </span>
            <button
              type="button"
              style={
                copied
                  ? { ...styles.iconBtn, color: "#4ade80" }
                  : styles.iconBtn
              }
              title={copied ? "Copied!" : "Copy family"}
              onClick={handleCopy}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
          </div>
          <div style={styles.headerActions}>
            <button
              style={styles.iconBtn}
              title="Edit styles"
              onClick={(e) => {
                e.stopPropagation();
                setView("edit");
              }}
            >
              <Palette />
            </button>
            <button
              style={styles.iconBtn}
              title="Expand"
              onClick={(e) => {
                e.stopPropagation();
                browser.runtime
                  .sendMessage({
                    type: "kolophon:open-sidepanel",
                    site: readSiteInfo(),
                    font: data,
                  })
                  .catch(() => {});
              }}
            >
              <ExternalLink />
            </button>
            <button style={styles.iconBtn} onClick={onClose} title="Close">
              <X />
            </button>
          </div>
        </div>
      )}

      {view === "edit" && edit ? (
        <EditPanel
          edit={edit}
          onChange={(patch, css) => {
            patchEdit(patch);
            for (const [prop, value] of Object.entries(css)) {
              onStyleChange?.(prop, value);
            }
          }}
        />
      ) : (
        <>
      <div style={styles.specs}>
        <SpecRow label="Size" value={data.size} />

        <div style={styles.specRow}>
          <span style={styles.specLabel}>Color:</span>
          <span
            data-clickable
            style={{
              ...styles.specValue,
              cursor: "pointer",
              userSelect: "none",
              position: "relative",
            }}
            onMouseEnter={() => setDropdownOpen(true)}
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <Swatch color={data.colorRgb} />
            {colorValues[colorFormat]}
            <span
              style={{
                marginLeft: 5,
                opacity: 0.45,
                display: "flex",
                alignItems: "center",
              }}
            >
              <ChevronDown />
            </span>

            {dropdownOpen && (
              <div style={styles.dropdown} onClick={(e) => e.stopPropagation()}>
                {FORMAT_ORDER.map((fmt) => (
                  <div
                    key={fmt}
                    data-clickable
                    style={styles.dropdownOption(fmt === colorFormat)}
                    onClick={(e) => {
                      e.stopPropagation();
                      setColorFormat(fmt);
                      setDropdownOpen(false);
                    }}
                  >
                    {colorValues[fmt]}
                  </div>
                ))}
              </div>
            )}
          </span>
        </div>

        <SpecRow label="Line Height" value={data.lineHeight} />
      </div>

      <div
        style={{ ...styles.specimen, fontFamily: `'${data.name}', sans-serif` }}
      >
        AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwYyZz 0123456789@?!(&)
      </div>
        </>
      )}
    </div>
  );
}

// ─── Edit panel ─────────────────────────────────────────────────────────────

function EditPanel({
  edit,
  onChange,
}: {
  edit: EditState;
  onChange: (patch: Partial<EditState>, css: Record<string, string>) => void;
}) {
  return (
    <div style={styles.editBody}>
      <SliderRow
        label="Size"
        value={edit.fontSize}
        min={6}
        max={120}
        step={1}
        display={`${edit.fontSize}px`}
        onChange={(v) =>
          onChange({ fontSize: v }, { "font-size": `${v}px` })
        }
      />
      <SliderRow
        label="Line height"
        value={edit.lineHeight}
        min={0.8}
        max={3}
        step={0.05}
        display={edit.lineHeight.toFixed(2)}
        onChange={(v) =>
          onChange({ lineHeight: v }, { "line-height": String(v) })
        }
      />
      <SliderRow
        label="Letter spacing"
        value={edit.letterSpacing}
        min={-5}
        max={20}
        step={0.1}
        display={`${edit.letterSpacing}px`}
        onChange={(v) =>
          onChange(
            { letterSpacing: v },
            { "letter-spacing": `${v}px` },
          )
        }
      />
      <SliderRow
        label="Weight"
        value={edit.fontWeight}
        min={100}
        max={900}
        step={100}
        display={String(edit.fontWeight)}
        onChange={(v) =>
          onChange({ fontWeight: v }, { "font-weight": String(v) })
        }
      />

      <div style={styles.editRow}>
        <span style={styles.editLabel}>Color</span>
        <label style={styles.colorControl} data-clickable>
          <span style={{ ...styles.colorSwatch, background: edit.color }} />
          <span style={styles.colorValue}>{edit.color}</span>
          <input
            type="color"
            value={edit.color}
            style={styles.colorInput}
            data-clickable
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              onChange({ color: e.target.value }, { color: e.target.value })
            }
          />
        </label>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <div style={styles.editRow}>
      <div style={styles.editRowHead}>
        <span style={styles.editLabel}>{label}</span>
        <span style={styles.editValue}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-clickable
        style={styles.slider}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={styles.specRow}>
      <span style={styles.specLabel}>{label}:</span>
      <span style={styles.specValue}>{value}</span>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        background: color,
        border: "1px solid rgba(255,255,255,0.2)",
        marginRight: 6,
        flexShrink: 0,
      }}
    />
  );
}

function ChevronDown() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 11 11"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 4H10V10H4V4Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path
        d="M1 7V1H7"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ExternalLink() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function X() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function Palette() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z" />
    </svg>
  );
}

function ArrowLeft() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

const styles = {
  card: (x: number, y: number): React.CSSProperties => ({
    position: "fixed",
    top: y,
    left: x,
    width: 280,
    background: "rgba(20, 20, 22, 0.55)",
    backdropFilter: "blur(16px) saturate(1.4)",
    WebkitBackdropFilter: "blur(16px) saturate(1.4)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
    padding: "14px 16px",
    pointerEvents: "auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
    zIndex: 2147483647,
    borderRadius: 0,
    overflow: "visible",
  }),

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  } as React.CSSProperties,

  nameGroup: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } as React.CSSProperties,

  fontName: {
    fontSize: 17,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "#fff",
  } as React.CSSProperties,

  headerActions: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexShrink: 0,
  } as React.CSSProperties,

  iconBtn: {
    background: "none",
    border: "none",
    color: "rgba(255,255,255,0.45)",
    cursor: "pointer",
    padding: 0,
    lineHeight: 0,
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  specs: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottom: "1px solid rgba(255,255,255,0.07)",
  } as React.CSSProperties,

  specRow: {
    display: "flex",
    gap: 8,
    fontSize: 13,
    lineHeight: "1.9",
    alignItems: "center",
  } as React.CSSProperties,

  specLabel: {
    color: "rgba(255,255,255,0.4)",
    flexShrink: 0,
  } as React.CSSProperties,

  specValue: {
    color: "#fff",
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  dropdown: {
    position: "absolute",
    // Flush with the trigger — any gap would fire mouseleave mid-travel
    // and close the hover dropdown before the pointer reaches it.
    top: "100%",
    left: 0, // align with the value span's left edge (its containing block)
    zIndex: 1,
    background: "rgba(28, 28, 30, 0.97)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    minWidth: 200,
    padding: "4px 0",
    borderRadius: 0,
  } as React.CSSProperties,

  dropdownOption: (active: boolean): React.CSSProperties => ({
    padding: "5px 14px",
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    color: active ? "#fff" : "rgba(255,255,255,0.55)",
    background: active ? "rgba(255,255,255,0.08)" : "transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),

  specimen: {
    fontSize: 13,
    lineHeight: 1.65,
    color: "rgba(255,255,255,0.8)",
    overflowWrap: "break-word",
    margin: 0,
  } as React.CSSProperties,

  editTitle: {
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: "-0.01em",
    color: "#fff",
  } as React.CSSProperties,

  editBody: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } as React.CSSProperties,

  editRow: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
  } as React.CSSProperties,

  editRowHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  } as React.CSSProperties,

  editLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
  } as React.CSSProperties,

  editValue: {
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    color: "#fff",
  } as React.CSSProperties,

  slider: {
    width: "100%",
    height: 3,
    appearance: "none",
    WebkitAppearance: "none",
    background: "rgba(255,255,255,0.15)",
    outline: "none",
    accentColor: "#2252FE",
    margin: 0,
  } as React.CSSProperties,

  colorControl: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 8px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.10)",
    cursor: "pointer",
  } as React.CSSProperties,

  colorSwatch: {
    width: 16,
    height: 16,
    border: "1px solid rgba(255,255,255,0.2)",
    flexShrink: 0,
  } as React.CSSProperties,

  colorValue: {
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    color: "#fff",
  } as React.CSSProperties,

  colorInput: {
    position: "absolute",
    inset: 0,
    opacity: 0,
    width: "100%",
    height: "100%",
    border: "none",
    padding: 0,
    cursor: "pointer",
  } as React.CSSProperties,
};
