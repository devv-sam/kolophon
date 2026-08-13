import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  additionalProps?: EditField[];
  savedExtraProps?: string[];
  mode?: "inspect" | "edit" | "collection";
  x: number;
  y: number;
  anchorBottom?: boolean;
  confirmDiscard?: boolean;
  onStyleChange?: (prop: string, value: string) => void;
  onAddExtraProp?: (prop: string) => void;
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

export function PopupCard({ data, visible, y, anchorBottom, onClose, mode, editFields, additionalProps, savedExtraProps, onStyleChange, onAddExtraProp }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [colorFormat, setColorFormat] = useState<ColorFormat>("hex");
  const [copiedFamily, setCopiedFamily] = useState(false);
  const [copiedStyles, setCopiedStyles] = useState(false);
  const [animIn, setAnimIn] = useState(false);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [extraFields, setExtraFields] = useState<EditField[]>([]);
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const [propPickerOpen, setPropPickerOpen] = useState(false);
  const [propSearch, setPropSearch] = useState("");
  const familyTimer = useRef<number | undefined>(undefined);
  const stylesTimer = useRef<number | undefined>(undefined);
  const propSearchRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);

  useEffect(() => {
    if (visible) {
      setAnimIn(false);
      setPropPickerOpen(false);
      setPropSearch("");
      const restored = (additionalProps ?? []).filter((f) =>
        (savedExtraProps ?? []).includes(f.prop),
      );
      setExtraFields(restored);
      const initial: Record<string, string> = {};
      for (const f of [...(editFields ?? []), ...restored]) initial[f.prop] = f.value;
      setLocalValues(initial);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimIn(true));
      });
    } else {
      setAnimIn(false);
    }
  }, [visible, data]);

  useEffect(() => {
    if (propPickerOpen) {
      requestAnimationFrame(() => propSearchRef.current?.focus());
    }
  }, [propPickerOpen]);

  // Height FLIP animation — runs after every render that changes field count or active element
  useLayoutEffect(() => {
    if (!visible || mode !== "edit") {
      prevHeightRef.current = 0;
      return;
    }
    const el = cardRef.current;
    if (!el) return;

    // Temporarily release any explicit height so we can measure the natural height
    el.style.height = "";
    el.style.overflow = "";
    const next = el.offsetHeight;
    const prev = prevHeightRef.current;
    prevHeightRef.current = next;

    if (!prev || Math.abs(next - prev) < 2) return;

    // Set back to previous height (synchronously, before paint)
    el.style.overflow = "hidden";
    el.style.height = `${prev}px`;
    el.style.transition = "none";

    // Animate to new height in the next frame
    requestAnimationFrame(() => {
      el.style.transition = "height 0.28s cubic-bezier(0.4, 0, 0.2, 1)";
      el.style.height = `${next}px`;

      const cleanup = (e?: TransitionEvent) => {
        if (e && e.propertyName !== "height") return;
        el.style.height = "";
        el.style.overflow = "";
        el.style.transition = "";
      };
      el.addEventListener("transitionend", cleanup as EventListener, { once: true });
      setTimeout(() => cleanup(), 400);
    });
  }, [visible, mode, data, extraFields.length, editFields?.length]);

  if (!visible || !data) return null;

  const colorValues = buildColorFormats(data.colorRgb, data.colorHex);

  function handleFieldChange(field: EditField, raw: string) {
    setLocalValues((prev) => ({ ...prev, [field.prop]: raw }));
    const val = field.unit ? raw + field.unit : raw;
    onStyleChange?.(field.prop, val);
  }

  function addExtraProp(field: EditField) {
    setExtraFields((prev) => [...prev, field]);
    setLocalValues((prev) => ({ ...prev, [field.prop]: field.value }));
    setJustAdded(field.prop);
    setPropPickerOpen(false);
    setPropSearch("");
    onAddExtraProp?.(field.prop);
    setTimeout(() => setJustAdded(null), 350);
  }

  const alreadyAdded = new Set([...(editFields ?? []).map((f) => f.prop), ...extraFields.map((f) => f.prop)]);
  const filteredAdditional = (additionalProps ?? [])
    .filter((f) => !alreadyAdded.has(f.prop))
    .filter((f) =>
      !propSearch ||
      f.label.toLowerCase().includes(propSearch.toLowerCase()) ||
      f.prop.toLowerCase().includes(propSearch.toLowerCase()),
    );

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

  if (mode === "edit") {
    return (
      <div
        ref={cardRef}
        style={{ ...cardStyle, boxSizing: "border-box" }}
        onClick={(e) => { e.stopPropagation(); if (propPickerOpen) { setPropPickerOpen(false); } }}
      >
        <div style={{ ...styles.header, marginBottom: 12, alignItems: "flex-start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ ...styles.fontName, fontSize: 15, color: "#D13E19" }}>
              {data.tag}
            </div>
            <div style={{ ...styles.fontFamily, fontSize: 12 }}>
              {data.name} · {data.size} · {data.weight}
            </div>
          </div>
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              type="button"
              data-clickable
              style={styles.addPropBtn}
              onClick={(e) => { e.stopPropagation(); setPropPickerOpen((o) => !o); setPropSearch(""); }}
            >
              + Property
            </button>
            {propPickerOpen && (
              <div style={styles.propDropdown} onClick={(e) => e.stopPropagation()}>
                <input
                  ref={propSearchRef}
                  type="text"
                  placeholder="Filter properties…"
                  value={propSearch}
                  style={styles.propSearchInput}
                  onChange={(e) => setPropSearch(e.target.value)}
                />
                <div style={styles.propList}>
                  {filteredAdditional.length === 0 ? (
                    <div style={styles.propEmpty}>No more properties</div>
                  ) : (
                    filteredAdditional.map((f) => (
                      <PropOption key={f.prop} field={f} onAdd={addExtraProp} />
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div style={styles.editList}>
          {[...(editFields ?? []), ...extraFields].map((field) => (
            <AnimatedRow key={field.prop} isNew={field.prop === justAdded}>
              <EditRow
                field={field}
                value={localValues[field.prop] ?? field.value}
                onChange={handleFieldChange}
              />
            </AnimatedRow>
          ))}
        </div>
      </div>
    );
  }

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

function AnimatedRow({ isNew, children }: { isNew: boolean; children: React.ReactNode }) {
  const [show, setShow] = useState(!isNew);
  useEffect(() => {
    if (!isNew) return;
    const raf = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? "translateY(0)" : "translateY(-3px)",
        transition: show ? "opacity 0.2s ease, transform 0.2s ease" : "none",
      }}
    >
      {children}
    </div>
  );
}

function PropOption({ field, onAdd }: { field: EditField; onAdd: (f: EditField) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      data-clickable
      style={{ ...styles.propOption, background: hovered ? "rgba(0,0,0,0.04)" : "transparent" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onAdd(field)}
    >
      <span style={styles.propOptionLabel}>{field.label}</span>
      <span style={styles.propOptionValue}>{field.value}</span>
    </div>
  );
}

function EditRow({
  field,
  value,
  onChange,
}: {
  field: EditField;
  value: string;
  onChange: (field: EditField, raw: string) => void;
}) {
  const boxStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    background: "rgba(0,0,0,0.04)",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 4,
    overflow: "hidden",
  };
  const numInputStyle: React.CSSProperties = {
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    fontSize: 12,
    color: "#000",
    background: "transparent",
    border: "none",
    padding: "3px 6px",
    width: 56,
    textAlign: "right",
    outline: "none",
  };
  const unitStyle: React.CSSProperties = {
    fontSize: 11,
    color: "rgba(0,0,0,0.35)",
    fontFamily: "ui-monospace, monospace",
    paddingRight: 7,
    paddingLeft: 1,
    userSelect: "none",
  };

  let control: React.ReactNode;

  if (field.kind === "color") {
    control = (
      <label style={{ display: "inline-flex", alignItems: "center", gap: 7, cursor: "pointer", position: "relative" }}>
        <span
          style={{
            display: "inline-block",
            width: 14,
            height: 14,
            background: value,
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 2,
            flexShrink: 0,
          }}
        />
        <span style={{ fontFamily: "ui-monospace, 'Cascadia Code', monospace", fontSize: 12, color: "#000" }}>
          {value}
        </span>
        <input
          type="color"
          value={value}
          style={{ position: "absolute", opacity: 0, inset: 0, width: "100%", height: "100%", cursor: "pointer", border: "none", padding: 0 }}
          onChange={(e) => onChange(field, e.target.value)}
        />
      </label>
    );
  } else if (field.kind === "select") {
    control = (
      <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <select
          value={value}
          style={{
            fontFamily: "ui-monospace, 'Cascadia Code', monospace",
            fontSize: 12,
            color: "#000",
            background: "rgba(0,0,0,0.04)",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 4,
            padding: "3px 26px 3px 8px",
            outline: "none",
            appearance: "none" as const,
            cursor: "pointer",
            minWidth: 90,
          }}
          onChange={(e) => onChange(field, e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
        <span style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "rgba(0,0,0,0.4)", display: "flex", lineHeight: 0 }}>
          <ChevronDown />
        </span>
      </div>
    );
  } else {
    control = (
      <div style={boxStyle}>
        <input
          type="number"
          value={value}
          min={field.min}
          max={field.max}
          step={field.step}
          style={numInputStyle}
          onChange={(e) => onChange(field, e.target.value)}
        />
        {field.unit && <span style={unitStyle}>{field.unit}</span>}
      </div>
    );
  }

  return (
    <div style={styles.editRow}>
      <span style={styles.editLabel}>{field.label}</span>
      <div style={{ flexShrink: 0 }}>{control}</div>
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

  editList: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } as React.CSSProperties,

  editRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 28,
  } as React.CSSProperties,

  editLabel: {
    fontSize: 12,
    color: "rgba(0,0,0,0.45)",
    fontFamily: FONT,
    flexShrink: 0,
    minWidth: 90,
  } as React.CSSProperties,

  addPropBtn: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "5px 10px",
    border: "1px solid rgba(209,62,25,0.3)",
    borderRadius: 5,
    background: "rgba(209,62,25,0.05)",
    color: "#D13E19",
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
    lineHeight: 1,
    whiteSpace: "nowrap",
  } as React.CSSProperties,

  propDropdown: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 0,
    zIndex: 10,
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.08)",
    borderRadius: 7,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    width: 220,
    overflow: "hidden",
  } as React.CSSProperties,

  propSearchInput: {
    display: "block",
    width: "100%",
    boxSizing: "border-box" as const,
    padding: "8px 12px",
    border: "none",
    borderBottom: "1px solid rgba(0,0,0,0.07)",
    fontFamily: FONT,
    fontSize: 12,
    color: "#000",
    outline: "none",
    background: "transparent",
  } as React.CSSProperties,

  propList: {
    maxHeight: 200,
    overflowY: "auto" as const,
    padding: "4px 0",
  } as React.CSSProperties,

  propOption: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 12px",
    cursor: "pointer",
    gap: 8,
  } as React.CSSProperties,

  propOptionLabel: {
    fontSize: 12,
    fontFamily: FONT,
    color: "#000",
    flexShrink: 0,
  } as React.CSSProperties,

  propOptionValue: {
    fontSize: 11,
    fontFamily: "ui-monospace, 'Cascadia Code', monospace",
    color: "rgba(0,0,0,0.35)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
    maxWidth: 80,
  } as React.CSSProperties,

  propEmpty: {
    padding: "10px 12px",
    fontSize: 12,
    color: "rgba(0,0,0,0.35)",
    fontFamily: FONT,
    textAlign: "center" as const,
  } as React.CSSProperties,
};
