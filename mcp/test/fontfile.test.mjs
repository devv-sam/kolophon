import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { readFontFile } from "../dist/fontfile.js";

const fixture = (name) => readFileSync(new URL(`./fixtures/fonts/${name}`, import.meta.url));

test("reads a variable WOFF2", () => {
  assert.deepEqual(readFontFile(fixture("InterVariable.woff2")), {
    family: "Inter Variable",
    axes: [
      { tag: "opsz", name: "Optical size", min: 14, default: 14, max: 32 },
      { tag: "wght", name: "Weight", min: 100, default: 400, max: 900 },
    ],
  });
});

test("reads a static WOFF2", () => {
  assert.deepEqual(readFontFile(fixture("Ronzino-Regular.woff2")), { family: "Ronzino", axes: [] });
});

test("returns null for anything else", () => {
  assert.equal(readFontFile(Buffer.from("not a font at all")), null);
  assert.equal(readFontFile(Buffer.alloc(0)), null);
  assert.equal(readFontFile(fixture("InterVariable.woff2").subarray(0, 100)), null);
});

// A minimal font with just `name` (family "Test Flex", axis name "Grade") and `fvar`
// (one GRAD axis, -200..0..150), so the raw sfnt and WOFF1 paths are covered too.
function syntheticTables() {
  const utf16 = (s) => Buffer.from(s, "utf16le").swap16();
  const family = utf16("Test Flex");
  const axisName = utf16("Grade");
  const name = Buffer.alloc(6 + 2 * 12);
  name.writeUInt16BE(2, 2);
  name.writeUInt16BE(name.length, 4);
  [[1, family, 0], [256, axisName, family.length]].forEach(([id, str, offset], i) => {
    const at = 6 + i * 12;
    name.writeUInt16BE(3, at);
    name.writeUInt16BE(1, at + 2);
    name.writeUInt16BE(0x409, at + 4);
    name.writeUInt16BE(id, at + 6);
    name.writeUInt16BE(str.length, at + 8);
    name.writeUInt16BE(offset, at + 10);
  });
  const fvar = Buffer.alloc(16 + 20);
  fvar.writeUInt16BE(1, 0);
  fvar.writeUInt16BE(16, 4);
  fvar.writeUInt16BE(1, 8);
  fvar.writeUInt16BE(20, 10);
  fvar.write("GRAD", 16, "latin1");
  [-200, 0, 150].forEach((v, i) => fvar.writeInt32BE(v * 65536, 20 + i * 4));
  fvar.writeUInt16BE(256, 34);
  return [["fvar", fvar], ["name", Buffer.concat([name, family, axisName])]];
}

const expected = { family: "Test Flex", axes: [{ tag: "GRAD", name: "Grade", min: -200, default: 0, max: 150 }] };

test("reads a raw TTF", () => {
  const tables = syntheticTables();
  const dir = Buffer.alloc(12 + tables.length * 16);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(tables.length, 4);
  let offset = dir.length;
  tables.forEach(([tag, data], i) => {
    dir.write(tag, 12 + i * 16, "latin1");
    dir.writeUInt32BE(offset, 12 + i * 16 + 8);
    dir.writeUInt32BE(data.length, 12 + i * 16 + 12);
    offset += data.length;
  });
  assert.deepEqual(readFontFile(Buffer.concat([dir, ...tables.map(([, d]) => d)])), expected);
});

test("reads a WOFF with compressed tables", () => {
  // Per the WOFF spec, a table is stored raw when deflate doesn't make it smaller.
  const tables = syntheticTables().map(([tag, data]) => {
    const packed = deflateSync(data);
    return [tag, data, packed.length < data.length ? packed : data];
  });
  assert.ok(tables.some(([, data, packed]) => packed !== data), "at least one table must be compressed");
  const dir = Buffer.alloc(44 + tables.length * 20);
  dir.write("wOFF", 0, "latin1");
  dir.writeUInt16BE(tables.length, 12);
  let offset = dir.length;
  tables.forEach(([tag, data, packed], i) => {
    const at = 44 + i * 20;
    dir.write(tag, at, "latin1");
    dir.writeUInt32BE(offset, at + 4);
    dir.writeUInt32BE(packed.length, at + 8);
    dir.writeUInt32BE(data.length, at + 12);
    offset += packed.length;
  });
  assert.deepEqual(readFontFile(Buffer.concat([dir, ...tables.map(([, , p]) => p)])), expected);
});
