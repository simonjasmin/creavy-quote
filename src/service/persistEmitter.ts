// #24 persisting emitter. Appends each scan event to the store, in order, with seq — but
// FIRE-AND-FORGET: the append is never awaited on the scan's hot path and a failed write is
// logged, never thrown. A slow/broken DB can never stall or fail a scan.
import type { ScanEventEmitter } from "../crawl/events.ts";
import type { Store } from "./store/types.ts";
import type { Clock } from "../crawl/types.ts";

export class PersistEmitter implements ScanEventEmitter {
  private seq = 0;
  private store: Store;
  private id: string;
  private clock: Clock;
  constructor(store: Store, id: string, clock: Clock) { this.store = store; this.id = id; this.clock = clock; }

  emit(type: string, data?: Record<string, unknown>): void {
    const ev = { seq: this.seq++, ts: this.clock.now(), type, data };
    void this.store.appendEvent(this.id, ev).catch((e) => console.error(`event persist failed (${this.id})`, (e as Error)?.message));
  }
}
