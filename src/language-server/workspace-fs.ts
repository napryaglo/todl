import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { SourceFile } from "@pragmatic-tech-ai/todl";
import type { Project, SourceProvider } from "./workspace.js";

// FS mode: scan the root folder for *.todl on disk, overlaying any open buffer.
// Node-only (fs/url/path) — kept out of workspace.ts so the server core stays
// browser-safe.
export class FsSourceProvider implements SourceProvider {
  initialRoots(folders: string[]): string[] { return folders; }
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[] {
    const dir = fileURLToPath(project.rootUri);
    const open = new Map(docs.all().map((d) => [d.uri, d.getText()] as const));
    const files: SourceFile[] = [];
    for (const path of walkTodl(dir)) {
      const uri = pathToFileURL(path).href;
      files.push({ uri, text: open.get(uri) ?? readFileSync(path, "utf8") });
    }
    return files;
  }
}

function walkTodl(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTodl(path));
    else if (entry.name.endsWith(".todl")) out.push(path);
  }
  return out;
}
