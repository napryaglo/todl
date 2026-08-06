/**
 * The PackageStore family — the persistence seam for a CompiledPackage (the
 * "several stores" family applied to publishing). `BlobPackageStore` writes the
 * file layout Plexus publishes today; `GraphPackageStore` loads the compiled
 * graph into a GraphStore (the Cypher/Dgraph sibling). TODL owns no I/O: the
 * blob sink and the graph store are injected by the consumer.
 */

import { graphFromJSON } from "../emit/json.js";
import type { GraphStore } from "../model/graph-store.js";
import type { CompiledPackage } from "./publish.js";

/** Where and how a compiled package is persisted. */
export interface PackageStore {
  persist(pkg: CompiledPackage): Promise<void>;
}

/** The blob seam a file/object backend implements (a consumer adapts its own
 *  storage to it). Publish emits only text; `writeBytes` is optional. */
export interface PackageSink {
  writeText(path: string, content: string): Promise<void>;
  writeBytes?(path: string, bytes: Uint8Array): Promise<void>;
}

const defaultLayout = (id: string, version: string): string => `${id}/${version}`;

/** Persist a package as blobs: `<base>/model.json` + `<base>/src/<uri>`. */
export class BlobPackageStore implements PackageStore {
  private readonly layout: (id: string, version: string) => string;
  constructor(
    private readonly sink: PackageSink,
    opts?: { layout?: (id: string, version: string) => string },
  ) {
    this.layout = opts?.layout ?? defaultLayout;
  }

  async persist(pkg: CompiledPackage): Promise<void> {
    const base = this.layout(pkg.id, pkg.version);
    await this.sink.writeText(`${base}/model.json`, JSON.stringify(pkg.document, null, 2));
    for (const s of pkg.sources) await this.sink.writeText(`${base}/src/${s.uri}`, s.text);
  }
}

/** Persist a package's compiled graph into a GraphStore — the Cypher/Dgraph
 *  sibling of BlobPackageStore. Sources are not written: the graph IS the store. */
export class GraphPackageStore implements PackageStore {
  constructor(private readonly store: GraphStore) {}

  async persist(pkg: CompiledPackage): Promise<void> {
    const graph = graphFromJSON(pkg.document);
    for (const node of graph.allNodes()) {
      this.store.addNode(node.id, node.tier, node.typeOf);
      for (const [k, v] of node.attrs) this.store.setAttr(node.id, k, v);
      for (const e of graph.outEdges(node.id)) this.store.addEdge(e);
    }
    this.store.commit();
  }
}
