// The contract file is the SINGLE SOURCE of the API version — read its header at boot, no
// literal in code. /health reports it so a consumer (creavy-site) can detect version skew
// the moment its synced copy drifts from what staging actually serves (the E2 incident:
// site copy was v0.1 against staging v0.5, and nothing surfaced it).

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const CONTRACT_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "quote-api-contract.md");

export function readContractVersion(path: string = CONTRACT_PATH): string {
  const text = readFileSync(path, "utf8");
  // "- **Version:** 0.5 (2026-07-20)."  (fallback: the "# … contract v0.5" title)
  const m = text.match(/\*\*Version:\*\*\s*([0-9]+\.[0-9]+)/) || text.match(/contract\s+v([0-9]+\.[0-9]+)/i);
  if (!m) throw new Error(`could not parse contract version from ${path}`);
  return m[1];
}
