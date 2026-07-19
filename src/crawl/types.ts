// Crawl-side shared types. No network, no browser — the fast path.
// SPEC §4.1 caps + decision batch #8–#19 govern behaviour.

export type TransportErrorKind =
  | "dns" | "refused" | "timeout" | "tls" | "redirect_loop" | "too_many_redirects" | "other";

export type FetchResult = {
  url: string; // final URL after redirects (== requested when no redirect)
  status: number; // 0 when a transport error occurred
  headers: Record<string, string>; // lowercased keys; Set-Cookie never present
  body: string; // response body as text (NOT auto-decompressed)
  bytes?: Uint8Array; // raw bytes when needed (gzip sniffing, S-08)
  chain: string[]; // requested URLs in redirect order (final excluded)
  error?: { kind: TransportErrorKind; message: string };
};

export type FetchOpts = { timeoutMs?: number; maxHops?: number };

// All network I/O flows through this. Tests inject a fake that replays fixtures.
export interface Transport {
  fetch(url: string, opts?: FetchOpts): Promise<FetchResult>;
}

// Injectable clock — the 25 s budget, 300 ms spacing, and 8 s timeouts are all
// tested against a fake (D-34 is unprovable otherwise).
export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

// The bounder's structured result — decision #8 / inventory §2.
export type BounderResult = {
  canonical_origin: string;
  core_pages: number | "30+";
  blog_posts: number;
  excluded: { archives: number; media: number; soft_404: number; external: number };
  languages: string[];
  bilingual_mirror: boolean;
  needs_browser: boolean;
  needs_browser_reasons: string[];
  review_flags: string[];
  partial: boolean;
};

export const emptyBounder = (origin: string): BounderResult => ({
  canonical_origin: origin,
  core_pages: 0,
  blog_posts: 0,
  excluded: { archives: 0, media: 0, soft_404: 0, external: 0 },
  languages: [],
  bilingual_mirror: false,
  needs_browser: false,
  needs_browser_reasons: [],
  review_flags: [],
  partial: false,
});
