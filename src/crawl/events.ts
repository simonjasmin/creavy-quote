// SPEC amendment #24 — scan event spine. One append-only, seq-ordered log; three
// readers (prospect / founder / telemetry). Injectable like transport + clock;
// default is no-op. Fire-and-forget: emit never throws, never blocks, never
// computes anything new — it is a window on work already done.

import type { Clock } from "./types.ts";

export type ScanEvent = { seq: number; ts: number; type: string; data?: Record<string, unknown> };

export interface ScanEventEmitter {
  emit(type: string, data?: Record<string, unknown>): void;
}

// Default: swallow everything (no-op).
export const NOOP_EMITTER: ScanEventEmitter = { emit() {} };

// Isolation boundary for external consumers: even a throwing/slow consumer can
// never affect the scan (fire-and-forget guarantee). Production wraps SSE/DB
// sinks with this.
export function safeEmitter(inner: ScanEventEmitter): ScanEventEmitter {
  return { emit(type, data) { try { inner.emit(type, data); } catch { /* isolated */ } } };
}

// Records events in order for the founder review panel + rider-(b) telemetry;
// the public projection (eventProjection.ts) filters this same log.
export class RecordingEmitter implements ScanEventEmitter {
  readonly events: ScanEvent[] = [];
  private seq = 0;
  private clock: Clock | null;
  constructor(clock?: Clock) { this.clock = clock ?? null; }
  emit(type: string, data?: Record<string, unknown>): void {
    try { this.events.push({ seq: this.seq++, ts: this.clock ? this.clock.now() : 0, type, data }); } catch { /* fire-and-forget: a slow/broken consumer never affects the scan */ }
  }
}
