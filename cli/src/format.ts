// Minimal ANSI helpers + a stage header. No dependency — keeps the CLI lean.
const on = process.stdout.isTTY === true;
export const dim = (s: string) => (on ? `\x1b[2m${s}\x1b[0m` : s);
export const red = (s: string) => (on ? `\x1b[31m${s}\x1b[0m` : s);
export const green = (s: string) => (on ? `\x1b[32m${s}\x1b[0m` : s);
export const bold = (s: string) => (on ? `\x1b[1m${s}\x1b[0m` : s);
export const header = (title: string) => `\n${bold(`── ${title} ` + "─".repeat(Math.max(0, 40 - title.length)))}`;
