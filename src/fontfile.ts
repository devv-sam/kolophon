import { brotliDecompressSync, inflateSync } from "node:zlib";

export interface FontAxis {
  tag: string;
  name: string;
  min: number;
  default: number;
  max: number;
}

export interface FontFileInfo {
  /** Family name from the font's own `name` table. */
  family: string;
  /** Empty for a static font. */
  axes: FontAxis[];
}

// WOFF2 spec, table 3: tags a table directory entry can name with a 6-bit index.
const WOFF2_KNOWN_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT " +
  "EBLC gasp hdmx kern LTSH PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH " +
  "CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc bsln cvar fdsc feat fmtx fvar " +
  "gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .split(" ")
  .map((t) => t.replace("_", " "));

type Tables = Map<string, Buffer>;

const tag = (b: Buffer, at: number) => b.toString("latin1", at, at + 4);

function sfntTables(b: Buffer): Tables {
  const tables: Tables = new Map();
  for (let i = 0, n = b.readUInt16BE(4); i < n; i++) {
    const at = 12 + i * 16;
    const offset = b.readUInt32BE(at + 8);
    tables.set(tag(b, at), b.subarray(offset, offset + b.readUInt32BE(at + 12)));
  }
  return tables;
}

function woffTables(b: Buffer): Tables {
  const tables: Tables = new Map();
  for (let i = 0, n = b.readUInt16BE(12); i < n; i++) {
    const at = 44 + i * 20;
    const offset = b.readUInt32BE(at + 4);
    const data = b.subarray(offset, offset + b.readUInt32BE(at + 8));
    tables.set(tag(b, at), data.length < b.readUInt32BE(at + 12) ? inflateSync(data) : data);
  }
  return tables;
}

function woff2Tables(b: Buffer): Tables | null {
  if (tag(b, 4) === "ttcf") return null; // shortcut: font collections are skipped, rare on the web.
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = b[at++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw new Error("bad UIntBase128");
  };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0, n = b.readUInt16BE(12); i < n; i++) {
    const flags = b[at++];
    let t = WOFF2_KNOWN_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 63) {
      t = tag(b, at);
      at += 4;
    }
    const origLength = base128();
    const version = flags >> 6;
    // glyf/loca are transformed at version 0, every other table at any other version.
    const transformed = t === "glyf" || t === "loca" ? version === 0 : version !== 0;
    entries.push({ tag: t, length: transformed ? base128() : origLength });
  }
  const stream = brotliDecompressSync(b.subarray(at, at + b.readUInt32BE(20)));
  const tables: Tables = new Map();
  let offset = 0;
  for (const e of entries) {
    tables.set(e.tag, stream.subarray(offset, offset + e.length));
    offset += e.length;
  }
  return tables;
}

function readNames(name: Buffer | undefined): Map<number, string> {
  const names = new Map<number, string>();
  if (!name) return names;
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  // Lower rank wins: Windows English, any Windows, Unicode, then Mac Roman.
  const rank = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    const platform = name.readUInt16BE(at);
    const r = platform === 3 ? (name.readUInt16BE(at + 4) === 0x409 ? 0 : 1) : platform === 0 ? 2 : platform === 1 ? 3 : 9;
    const id = name.readUInt16BE(at + 6);
    if (r === 9 || r >= (rank.get(id) ?? 9)) continue;
    const raw = name.subarray(strings + name.readUInt16BE(at + 10), strings + name.readUInt16BE(at + 10) + name.readUInt16BE(at + 8));
    names.set(id, platform === 1 ? raw.toString("latin1") : Buffer.from(raw).swap16().toString("utf16le"));
    rank.set(id, r);
  }
  return names;
}

function readAxes(fvar: Buffer | undefined, names: Map<number, string>): FontAxis[] {
  if (!fvar) return [];
  const fixed = (at: number) => Math.round((fvar.readInt32BE(at) / 65536) * 1000) / 1000;
  const first = fvar.readUInt16BE(4);
  const size = fvar.readUInt16BE(10);
  return Array.from({ length: fvar.readUInt16BE(8) }, (_, i) => {
    const at = first + i * size;
    const t = tag(fvar, at);
    return { tag: t, name: names.get(fvar.readUInt16BE(at + 18)) ?? t, min: fixed(at + 4), default: fixed(at + 8), max: fixed(at + 12) };
  });
}

/** Reads the family name and variation axes from a TTF/OTF, WOFF or WOFF2 file; null if it can't. */
export function readFontFile(bytes: Buffer): FontFileInfo | null {
  try {
    const signature = tag(bytes, 0);
    const tables =
      signature === "wOF2" ? woff2Tables(bytes)
      : signature === "wOFF" ? woffTables(bytes)
      : signature === "\0\x01\0\0" || signature === "OTTO" || signature === "true" ? sfntTables(bytes)
      : null;
    if (!tables) return null;
    const names = readNames(tables.get("name"));
    const family = names.get(16) ?? names.get(1);
    return family ? { family, axes: readAxes(tables.get("fvar"), names) } : null;
  } catch {
    return null;
  }
}
