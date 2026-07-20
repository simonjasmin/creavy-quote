// Honeypot (#25-A step 3). A hidden field the real /prix UI leaves empty; automated
// submitters fill it. Tripped → SILENT accept-and-drop: return a plausible quote id, write
// no job, run no scan, set an internal flag. The bot sees success; we spend nothing.

export const HONEYPOT_FIELD = "company_website"; // hidden in the real form

export function isHoneypotTripped(body: unknown): boolean {
  const v = (body as Record<string, unknown> | null)?.[HONEYPOT_FIELD];
  return typeof v === "string" && v.trim().length > 0;
}
