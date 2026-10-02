const PHILIPPINE_OFFSET = "+08:00";

/** Convert a datetime-local wall time, explicitly interpreted as Philippine time, to a UTC ISO instant. */
export function philippineDateTimeToUtcIso(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(trimmed)) return null;
  const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
  const date = new Date(`${withSeconds}${PHILIPPINE_OFFSET}`);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

/** Format an ISO instant for a datetime-local control using Philippine Standard Time. */
export function utcIsoToPhilippineDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`;
}
