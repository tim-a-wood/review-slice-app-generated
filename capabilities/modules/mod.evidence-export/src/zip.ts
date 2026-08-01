import type { EvidenceFile } from "./contracts.ts";

const encoder = new TextEncoder();

export function createStoredZip(files: readonly EvidenceFile[], exportedAt: string): Uint8Array {
  const timestamp = toDosTimestamp(new Date(exportedAt));
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const checksum = crc32(file.content);
    const local = concat([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(timestamp.time), uint16(timestamp.date),
      uint32(checksum), uint32(file.content.length), uint32(file.content.length), uint16(name.length), uint16(0), name, file.content,
    ]);
    localParts.push(local);
    centralParts.push(concat([
      uint32(0x02014b50), uint16(0x0314), uint16(20), uint16(0x0800), uint16(0), uint16(timestamp.time), uint16(timestamp.date),
      uint32(checksum), uint32(file.content.length), uint32(file.content.length), uint16(name.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(offset), name,
    ]));
    offset += local.length;
  }

  const centralDirectory = concat(centralParts);
  const footer = concat([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(files.length), uint16(files.length),
    uint32(centralDirectory.length), uint32(offset), uint16(0),
  ]);
  return concat([...localParts, centralDirectory, footer]);
}

function toDosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  const day = Math.max(1, date.getUTCDate());
  return { time, date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | day };
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function uint16(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff);
}

function uint32(value: number): Uint8Array {
  return Uint8Array.of(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
