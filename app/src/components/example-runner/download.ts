/** DOM seam for saving/copying text — isolated so the VM stays logic-only. */
export function downloadText(filename: string, text: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function copyText(text: string): void {
  if (typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(text);
}
