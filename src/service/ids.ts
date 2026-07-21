// Quote ids — node:crypto, no dependency. qt_ + 12 hex chars (48 bits) is plenty for the
// volume and reads cleanly in logs. A honeypot-dropped request gets one that looks real.
import { randomBytes } from "node:crypto";

export function randomId(): string {
  return "qt_" + randomBytes(6).toString("hex");
}

export function assessmentId(): string {
  return "as_" + randomBytes(6).toString("hex");
}
