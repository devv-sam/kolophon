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

// A single editable CSS property, derived from the inspected element. Only
// properties actually set on the element are emitted (see buildEditFields),
// so the edit view is contextual to what's really on the page.
export type EditFieldKind = "length" | "number" | "color" | "select";

export interface EditField {
  prop: string; // css property name, e.g. "font-size"
  label: string; // human label, e.g. "Size"
  kind: EditFieldKind;
  value: string; // current value: number string, hex, or option
  unit?: string; // for "length", e.g. "px"
  min?: number;
  max?: number;
  step?: number;
  options?: string[]; // for "select"
}

interface Props {
  data: FontData | null;
  editFields?: EditField[];
  x: number;
  y: number;
  visible: boolean;
  // True while the Esc-to-quit discard prompt is showing.
  confirmDiscard?: boolean;
  onClose: () => void;
  // Live-apply a CSS property to the inspected element (edit view).
  onStyleChange?: (prop: string, value: string) => void;
  onConfirmDiscard?: () => void;
  onCancelDiscard?: () => void;
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
// Live CSS controls that reuse the popup card as a second "page". The field
// list is contextual (built from the element); values write back on change.

type View = "specs" | "edit";

// Serialize a field's raw value to a css value (lengths get their unit).
function cssValueOf(field: EditField, raw: string): string {
  return field.kind === "length" ? `${raw}${field.unit ?? "px"}` : raw;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PopupCard({
  data,
  editFields = [],
  x,
  y,
  visible,
  confirmDiscard = false,
  onClose,
  onStyleChange,
  onConfirmDiscard,
  onCancelDiscard,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorFormat>("hex");
  const [copied, setCopied] = useState(false);
  const [styleCopied, setStyleCopied] = useState(false);
  const [view, setView] = useState<View>("specs");
  // Live values keyed by css property, seeded from the contextual field list.
  const [values, setValues] = useState<Record<string, string>>({});
  // Drag offset from the spawn position; null until the user moves the card.
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ mx: number; my: number; ox: number; oy: number } | null>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  // New element clicked → reset to the spec page, reseed controls, drop drag.
  useEffect(() => {
    setView("specs");
    setValues(Object.fromEntries(editFields.map((f) => [f.prop, f.value])));
    setDrag(null);
    // editFields is rebuilt per click alongside data; data is the stable trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // While dragging, follow the pointer on window-level listeners so the card
  // keeps moving even if the cursor outruns it.
  useEffect(() => {
    if (!dragging) return;
    // Flag the document so the grabbing cursor wins over the crosshair override.
    document.documentElement.setAttribute("data-kolophon-dragging", "");
    function onMove(e: MouseEvent) {
      const o = dragOrigin.current;
      if (!o) return;
      setDrag({ x: o.ox + (e.clientX - o.mx), y: o.oy + (e.clientY - o.my) });
    }
    function onUp() {
      setDragging(false);
      dragOrigin.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      document.documentElement.removeAttribute("data-kolophon-dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  if (!visible || !data) return null;

  const clampedX = Math.min(x, window.innerWidth - 300);
  const clampedY = Math.min(y, window.innerHeight - 280);
  const posX = drag ? drag.x : clampedX;
  const posY = drag ? drag.y : clampedY;

  // Start a drag from the grip/header, ignoring presses on header buttons.
  function onDragMouseDown(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    dragOrigin.current = { mx: e.clientX, my: e.clientY, ox: posX, oy: posY };
    setDragging(true);
  }

  const colorValues = buildColorFormats(data.colorRgb, data.colorHex);

  // Update local display value and live-apply the css to the element.
  function applyField(field: EditField, raw: string) {
    setValues((prev) => ({ ...prev, [field.prop]: raw }));
    onStyleChange?.(field.prop, cssValueOf(field, raw));
  }

  // Copy the manipulated declarations. Prefers what actually changed; if
  // nothing was touched yet, falls back to the element's current values.
  function copyStyles(e: React.MouseEvent) {
    e.stopPropagation();
    const changed = editFields.filter(
      (f) => (values[f.prop] ?? f.value) !== f.value,
    );
    const list = changed.length ? changed : editFields;
    const css = list
      .map((f) => `${f.prop}: ${cssValueOf(f, values[f.prop] ?? f.value)};`)
      .join("\n");
    navigator.clipboard
      .writeText(css)
      .then(() => {
        setStyleCopied(true);
        window.clearTimeout(copiedTimer.current);
        copiedTimer.current = window.setTimeout(() => setStyleCopied(false), 1500);
      })
      .catch(() => {});
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
      style={styles.card(posX, posY)}
      onClick={(e) => {
        e.stopPropagation();
        setDropdownOpen(false);
      }}
    >
      <div style={styles.dragHandle} data-drag onMouseDown={onDragMouseDown}>
        <GripDots />
      </div>

      {confirmDiscard ? (
        <div style={styles.confirmBar}>
          <span style={styles.confirmText}>Discard edits?</span>
          <div style={styles.confirmBtns}>
            <button
              style={styles.confirmNo}
              data-clickable
              onClick={(e) => {
                e.stopPropagation();
                onCancelDiscard?.();
              }}
            >
              No
            </button>
            <button
              style={styles.confirmYes}
              data-clickable
              onClick={(e) => {
                e.stopPropagation();
                onConfirmDiscard?.();
              }}
            >
              Yes
            </button>
          </div>
        </div>
      ) : view === "edit" ? (
        <div style={styles.header} data-drag onMouseDown={onDragMouseDown}>
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
            <span style={styles.editTitle}>{data.tag}</span>
          </div>
          <div style={styles.headerActions}>
            <button
              type="button"
              style={
                styleCopied
                  ? { ...styles.iconBtn, color: "#4ade80" }
                  : styles.iconBtn
              }
              title={styleCopied ? "Copied!" : "Copy style"}
              onClick={copyStyles}
            >
              {styleCopied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button style={styles.iconBtn} onClick={onClose} title="Close">
              <X />
            </button>
          </div>
        </div>
      ) : (
        <div style={styles.header} data-drag onMouseDown={onDragMouseDown}>
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

      {view === "edit" ? (
        <EditPanel
          fields={editFields}
          values={values}
          onChange={applyField}
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
// Renders the contextual field list. Scrolls within a fixed height so a heavily
// styled element doesn't blow out the card.

function EditPanel({
  fields,
  values,
  onChange,
}: {
  fields: EditField[];
  values: Record<string, string>;
  onChange: (field: EditField, raw: string) => void;
}) {
  if (fields.length === 0) {
    return <div style={styles.editEmpty}>No editable properties.</div>;
  }
  return (
    <div style={styles.editBody}>
      {fields.map((f) => {
        const value = values[f.prop] ?? f.value;
        if (f.kind === "color") {
          return <ColorRow key={f.prop} field={f} value={value} onChange={onChange} />;
        }
        if (f.kind === "select") {
          return <SelectRow key={f.prop} field={f} value={value} onChange={onChange} />;
        }
        return <NumberRow key={f.prop} field={f} value={value} onChange={onChange} />;
      })}
    </div>
  );
}

// Slider plus a manual numeric input that stay in sync.
function NumberRow({
  field,
  value,
  onChange,
}: {
  field: EditField;
  value: string;
  onChange: (field: EditField, raw: string) => void;
}) {
  return (
    <div style={styles.editRow}>
      <div style={styles.editRowHead}>
        <span style={styles.editLabel}>{field.label}</span>
        <span style={styles.numberEntry}>
          <input
            type="number"
            value={value}
            min={field.min}
            max={field.max}
            step={field.step}
            data-clickable
            style={styles.numberInput}
            onClick={(e) => e.stopPropagation()}
            // Blur on wheel so scrolling over the field never nudges the value.
            onWheel={(e) => (e.target as HTMLInputElement).blur()}
            onChange={(e) => onChange(field, e.target.value)}
          />
          {field.unit && <span style={styles.unit}>{field.unit}</span>}
        </span>
      </div>
      <input
        type="range"
        min={field.min}
        max={field.max}
        step={field.step}
        value={value}
        data-clickable
        style={styles.slider}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(field, e.target.value)}
      />
    </div>
  );
}

function SelectRow({
  field,
  value,
  onChange,
}: {
  field: EditField;
  value: string;
  onChange: (field: EditField, raw: string) => void;
}) {
  const options = field.options ?? [];
  // Keep the current computed value selectable even if it's outside our list.
  const all = options.includes(value) ? options : [value, ...options];
  return (
    <div style={styles.editRowInline}>
      <span style={styles.editLabel}>{field.label}</span>
      <select
        value={value}
        data-clickable
        style={styles.select}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onChange(field, e.target.value)}
      >
        {all.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function ColorRow({
  field,
  value,
  onChange,
}: {
  field: EditField;
  value: string;
  onChange: (field: EditField, raw: string) => void;
}) {
  return (
    <div style={styles.editRowInline}>
      <span style={styles.editLabel}>{field.label}</span>
      <label style={styles.colorControl} data-clickable>
        <span style={{ ...styles.colorSwatch, background: value }} />
        <span style={styles.colorValue}>{value}</span>
        <input
          type="color"
          value={value}
          style={styles.colorInput}
          data-clickable
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onChange(field, e.target.value)}
        />
      </label>
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

function GripDots() {
  return (
    <svg
      width="20"
      height="9"
      viewBox="0 0 20 9"
      fill="currentColor"
      aria-hidden="true"
      style={{ pointerEvents: "none" }}
    >
      <circle cx="3" cy="2.5" r="1.3" />
      <circle cx="10" cy="2.5" r="1.3" />
      <circle cx="17" cy="2.5" r="1.3" />
      <circle cx="3" cy="6.5" r="1.3" />
      <circle cx="10" cy="6.5" r="1.3" />
      <circle cx="17" cy="6.5" r="1.3" />
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
    padding: "6px 16px 14px",
    pointerEvents: "auto",
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: "#fff",
    zIndex: 2147483647,
    borderRadius: 0,
    overflow: "visible",
  }),

  dragHandle: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: 14,
    marginBottom: 4,
    color: "rgba(255,255,255,0.28)",
  } as React.CSSProperties,

  confirmBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
    gap: 8,
  } as React.CSSProperties,

  confirmText: {
    fontSize: 14,
    fontWeight: 600,
    color: "#fff",
  } as React.CSSProperties,

  confirmBtns: {
    display: "flex",
    gap: 6,
    flexShrink: 0,
  } as React.CSSProperties,

  confirmNo: {
    background: "rgba(255,255,255,0.08)",
    border: "1px solid rgba(255,255,255,0.12)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: "4px 12px",
    cursor: "pointer",
  } as React.CSSProperties,

  confirmYes: {
    background: "rgba(248, 81, 73, 0.18)",
    border: "1px solid rgba(248, 81, 73, 0.45)",
    color: "#ff6b63",
    fontSize: 12,
    fontWeight: 600,
    fontFamily: "system-ui, -apple-system, sans-serif",
    padding: "4px 12px",
    cursor: "pointer",
  } as React.CSSProperties,

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
    // Cap height so a heavily-styled element scrolls instead of growing the
    // card past the viewport. Negative margin + padding keeps the scrollbar
    // off the content while preserving the card's edge padding.
    maxHeight: "min(48vh, 360px)",
    overflowY: "auto",
    margin: "0 -4px",
    padding: "1px 4px",
  } as React.CSSProperties,

  editEmpty: {
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
    padding: "4px 0",
  } as React.CSSProperties,

  editRow: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
  } as React.CSSProperties,

  editRowInline: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  } as React.CSSProperties,

  editRowHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  } as React.CSSProperties,

  editLabel: {
    fontSize: 12,
    color: "rgba(255,255,255,0.4)",
  } as React.CSSProperties,

  numberEntry: {
    display: "flex",
    alignItems: "baseline",
    gap: 3,
  } as React.CSSProperties,

  numberInput: {
    // Reads as plain text; the injected stylesheet strips spinners and adds a
    // borderless focus fill so clicking in never shifts the layout.
    width: 52,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "#fff",
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    textAlign: "right",
    padding: "2px 4px",
    borderRadius: 3,
  } as React.CSSProperties,

  unit: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
  } as React.CSSProperties,

  select: {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.10)",
    color: "#fff",
    fontSize: 12,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    padding: "3px 6px",
    cursor: "pointer",
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
