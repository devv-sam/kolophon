import React, { useEffect, useRef, useState } from "react";

export interface FontData {
  name: string;
  tag: string;
  family: string;
  style: string;
  weight: string;
  size: string;
  lineHeight: string;
  letterSpacing: string;
  colorRgb: string;
  colorHex: string;
}

export type EditFieldKind = "length" | "number" | "color" | "select";

export interface EditField {
  prop: string;
  label: string;
  kind: EditFieldKind;
  value: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
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

export interface SiteInfo {
  host: string;
  favicon: string;
}

interface Props {
  data: FontData | null;
  visible: boolean;
  onClose: () => void;
  editFields?: EditField[];
  x: number;
  y: number;
  anchorBottom?: boolean;
  confirmDiscard?: boolean;
  onStyleChange?: (prop: string, value: string) => void;
  onConfirmDiscard?: () => void;
  onCancelDiscard?: () => void;
}

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

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r),
    gl = srgbToLinear(g),
    bl = srgbToLinear(b);
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl;
  const z = 0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl;
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
    zn = 0.82521;
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  const fx = f(xd / xn),
    fy = f(yd / yn),
    fz = f(zd / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

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

const FONT = '"Inter", system-ui, -apple-system, sans-serif';

export function PopupCard({ data, visible, y, anchorBottom, onClose }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorFormat>("hex");
  const [copiedFamily, setCopiedFamily] = useState(false);
  const [copiedStyles, setCopiedStyles] = useState(false);
  const [animIn, setAnimIn] = useState(false);
  const familyTimer = useRef<number | undefined>(undefined);
  const stylesTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (visible) {
      setAnimIn(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimIn(true));
      });
    } else {
      setAnimIn(false);
    }
  }, [visible, data]);

  if (!visible || !data) return null;

  const colorValues = buildColorFormats(data.colorRgb, data.colorHex);

  function handleCopyFamily(e: React.MouseEvent) {
    e.stopPropagation();
    if (!data) return;
    navigator.clipboard
      .writeText(data.family)
      .then(() => {
        setCopiedFamily(true);
        window.clearTimeout(familyTimer.current);
        familyTimer.current = window.setTimeout(() => setCopiedFamily(false), 1500);
      })
      .catch(() => {});
  }

  function handleCopyStyles(e: React.MouseEvent) {
    e.stopPropagation();
    if (!data) return;
    const lines = [
      `font-family: ${data.family};`,
      `font-weight: ${data.weight};`,
      `font-size: ${data.size};`,
      `line-height: ${data.lineHeight};`,
      data.letterSpacing !== "normal"
        ? `letter-spacing: ${data.letterSpacing};`
        : null,
      `color: ${data.colorHex};`,
    ]
      .filter(Boolean)
      .join("\n");
    navigator.clipboard
      .writeText(lines)
      .then(() => {
        setCopiedStyles(true);
        window.clearTimeout(stylesTimer.current);
        stylesTimer.current = window.setTimeout(() => setCopiedStyles(false), 1500);
      })
      .catch(() => {});
  }

  const cardStyle: React.CSSProperties = {
    ...styles.card,
    ...(anchorBottom ? { bottom: y } : { top: y }),
    opacity: animIn ? 1 : 0,
    transform: animIn
      ? "translateX(-50%) scale(1)"
      : "translateX(-50%) scale(0.92)",
    transition: "opacity 0.2s linear, transform 0.2s linear",
  };

  return (
    <div
      style={cardStyle}
      onClick={(e) => {
        e.stopPropagation();
        setDropdownOpen(false);
      }}
    >
      <div style={styles.header}>
        <div
          data-clickable
          style={styles.headerText}
          onClick={handleCopyFamily}
          title="Copy font family"
        >
          <div style={styles.fontName}>{data.name}</div>
          <div style={styles.fontFamily}>
            {copiedFamily ? (
              <span style={{ color: "#4ade80" }}>Copied to clipboard</span>
            ) : (
              data.family
            )}
          </div>
        </div>
        <button
          type="button"
          style={
            copiedStyles
              ? { ...styles.iconBtn, color: "#4ade80" }
              : styles.iconBtn
          }
          title={copiedStyles ? "Copied!" : "Copy all styles"}
          onClick={handleCopyStyles}
        >
          {copiedStyles ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>

      <div style={styles.specsGrid}>
        <div style={styles.specCol}>
          <div style={styles.specLabel}>Color</div>
          <div
            data-clickable
            style={{
              ...styles.specValue,
              cursor: "pointer",
              position: "relative",
            }}
            onMouseEnter={() => setDropdownOpen(true)}
            onMouseLeave={() => setDropdownOpen(false)}
          >
            <Swatch color={data.colorRgb} />
            <span>{colorValues[colorFormat]}</span>
            <span
              style={{
                marginLeft: 4,
                opacity: 0.4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <ChevronDown />
            </span>
            {dropdownOpen && (
              <div
                style={
                  anchorBottom
                    ? { ...styles.dropdown, top: "auto", bottom: "100%" }
                    : styles.dropdown
                }
                onClick={(e) => e.stopPropagation()}
              >
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
          </div>
        </div>
        <div style={styles.specCol}>
          <div style={styles.specLabel}>Weight</div>
          <div style={styles.specValue}>{data.weight}</div>
        </div>
        <div style={styles.specCol}>
          <div style={styles.specLabel}>Size</div>
          <div style={styles.specValue}>{data.size}</div>
        </div>
        <div style={styles.specCol}>
          <div style={styles.specLabel}>Line height</div>
          <div style={styles.specValue}>{data.lineHeight}</div>
        </div>
      </div>

      <div style={styles.specimen}>
        AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwYyZz 0123456789@?!(&)
      </div>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 12,
        height: 12,
        background: color,
        border: "1px solid rgba(0,0,0,0.12)",
        borderRadius: 2,
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
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const styles = {
  card: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%) scale(1)",
    transformOrigin: "center center",
    width: 380,
    background: "#ffffff",
    borderRadius: 5,
    boxShadow: "0 4px 24px rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.06)",
    padding: "15px",
    pointerEvents: "auto",
    fontFamily: FONT,
    color: "#000",
    zIndex: 2147483647,
  } as React.CSSProperties,

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 7,
  } as React.CSSProperties,

  headerText: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
    cursor: "pointer",
    borderRadius: 4,
  } as React.CSSProperties,

  fontName: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "#000",
    fontFamily: FONT,
  } as React.CSSProperties,

  fontFamily: {
    fontSize: 13,
    color: "rgba(0,0,0,0.45)",
    fontFamily: FONT,
  } as React.CSSProperties,

  iconBtn: {
    background: "none",
    border: "none",
    color: "rgba(0,0,0,0.35)",
    cursor: "pointer",
    padding: 4,
    lineHeight: 0,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  } as React.CSSProperties,

  specsGrid: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr 1fr 1fr",
    marginBottom: 7,
    gap: 10,
  } as React.CSSProperties,

  specCol: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
  } as React.CSSProperties,

  specLabel: {
    fontSize: 12,
    color: "rgba(0,0,0,0.4)",
    fontFamily: FONT,
  } as React.CSSProperties,

  specValue: {
    fontSize: 13,
    color: "#000",
    fontFamily: FONT,
    display: "flex",
    alignItems: "center",
  } as React.CSSProperties,

  dropdown: {
    position: "absolute",
    top: "100%",
    left: 0,
    zIndex: 1,
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.08)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    borderRadius: 6,
    minWidth: 200,
    padding: "4px 0",
  } as React.CSSProperties,

  dropdownOption: (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    color: active ? "#000" : "rgba(0,0,0,0.5)",
    background: active ? "rgba(0,0,0,0.04)" : "transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),

  specimen: {
    fontSize: 14,
    lineHeight: 1.6,
    color: "rgba(0,0,0,0.7)",
    overflowWrap: "break-word" as const,
    fontFamily: FONT,
  } as React.CSSProperties,
};
