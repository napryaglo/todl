import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import type { TextDocuments } from "vscode-languageserver";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Analysis } from "@pragmatic-lab/todl/language-service";
import type { TodlDocument, SourceFile } from "@pragmatic-lab/todl";

export interface Project {
  rootUri: string;
  bases: TodlDocument[];
  analysis: Analysis | null;
  dirty: boolean;
}

// Holds every open project and assigns documents to them by longest-prefix match
// on the project root URI, so one server partitions cleanly.
export class ProjectRegistry {
  private readonly projects = new Map<string, Project>();

  register(rootUri: string): Project {
    let p = this.projects.get(rootUri);
    if (p === undefined) {
      p = { rootUri, bases: [], analysis: null, dirty: true };
      this.projects.set(rootUri, p);
    }
    return p;
  }

  setBases(rootUri: string, bases: TodlDocument[]): void {
    const p = this.register(rootUri);
    p.bases = bases;
    p.dirty = true;
  }

  projectFor(uri: string): Project | null {
    let best: Project | null = null;
    for (const p of this.projects.values()) {
      if (uri.startsWith(p.rootUri) && (best === null || p.rootUri.length > best.rootUri.length)) best = p;
    }
    return best;
  }

  markDirty(rootUri: string): void {
    const p = this.projects.get(rootUri);
    if (p !== undefined) p.dirty = true;
  }

  dirtyProjects(): Project[] { return [...this.projects.values()].filter((p) => p.dirty); }
  all(): Project[] { return [...this.projects.values()]; }
  remove(rootUri: string): void { this.projects.delete(rootUri); }
}

export interface SourceProvider {
  // The project roots known at startup (FS: workspace folder URIs; pushed: []).
  initialRoots(folders: string[]): string[];
  // The SourceFile set to analyze for a project.
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[];
}

// Pushed mode: sources are the live text of open documents under the project root.
export class PushedSourceProvider implements SourceProvider {
  initialRoots(): string[] { return []; }
  sourcesFor(project: Project, docs: TextDocuments<TextDocument>): SourceFile[] {
    return docs.all()
      .filter((d) => d.uri.startsWith(project.rootUri))
      .map((d) => ({ uri: d.uri, text: d.getText() }));
  }
}

// FS mode: scan the root folder for *.todl on disk, overlaying any open buffer.
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
