import { createHash } from "node:crypto"

const textEncoder = new TextEncoder()

export function sha256(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? textEncoder.encode(value) : value
  return createHash("sha256").update(bytes).digest("hex")
}

export function stableIdentifier(prefix: string, value: string): string {
  return `${prefix}_${sha256(value).slice(0, 20)}`
}

export function hashOrderedFiles(files: readonly { relativePath: string; bytes: Uint8Array }[]): string {
  const hash = createHash("sha256")
  for (const file of [...files].sort((left, right) => comparePath(left.relativePath, right.relativePath))) {
    const pathBytes = textEncoder.encode(normalizePath(file.relativePath))
    const length = Buffer.allocUnsafe(8)
    length.writeBigUInt64LE(BigInt(file.bytes.byteLength))
    hash.update(pathBytes)
    hash.update(Uint8Array.of(0))
    hash.update(length)
    hash.update(file.bytes)
  }
  return hash.digest("hex")
}

export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "")
}

export function comparePath(left: string, right: string): number {
  const normalizedLeft = normalizePath(left)
  const normalizedRight = normalizePath(right)
  const folded = normalizedLeft.localeCompare(normalizedRight, "en-US", { sensitivity: "base", numeric: true })
  return folded || normalizedLeft.localeCompare(normalizedRight, "en-US", { numeric: true })
}
