/** German relative times for the board UI ("gerade eben", "vor 5 Min."). */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "gerade eben";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "gestern" : `vor ${days} Tagen`;
  return new Date(timestamp).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}
