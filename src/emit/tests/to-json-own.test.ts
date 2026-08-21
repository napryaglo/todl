import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { check, checkAgainst } from '../../api.js';
import { Severity } from '../../diagnostics/diagnostic.js';
import type { SourceFile } from '../../diagnostics/span.js';
import { toJSON, toJSONOwn } from '../json.js';

// A base meta-model (concepts + a base taxonomy the library references).
const META: SourceFile = {
  uri: 'meta.todl',
  text: `namespace ea {
    concept Location   { label : string; }
    concept Technology { label : string; }
  }`,
};

// A library-shaped source: a taxonomy over the base concepts. Its terms are
// Instance-tier classes whose typeOf points at a base concept id.
const LIB: SourceFile = {
  uri: 'lib.todl',
  text: `namespace lib {
    import ea;
    taxonomy Microsoft : represents Location, Technology {
      Location azure { label = "Azure"; }
      Technology azureOpenai { label = "Azure OpenAI"; }
    }
  }`,
};

describe('toJSONOwn', () => {
  test('emits only own nodes + their out-edges, dropping base + prelude nodes', () => {
    // The base doc from check() already carries the prelude nodes too.
    const base = toJSON(check([META]).model);
    const { model, diagnostics } = checkAgainst([base], [LIB]);
    assert.equal(diagnostics.filter((d) => d.severity === Severity.Error).length, 0, 'no errors');

    // Own = every node the compile added beyond the seeded base (prelude + bases).
    const baseIds = new Set(base.nodes.map((n) => n.id));
    const ownIds = new Set(model.allNodes().map((n) => n.id).filter((id) => !baseIds.has(id)));
    const own = toJSONOwn(model, ownIds);
    const ids = new Set(own.nodes.map((n) => n.id));

    // Own taxonomy + its class terms are present.
    assert.ok(ids.has('Microsoft.azure'), 'own class term present');
    // Base concepts and prelude are excluded.
    assert.ok(!ids.has('Location'), 'base concept excluded');
    assert.ok(!ids.has('Technology'), 'base concept excluded');
    assert.ok(!ids.has('element'), 'prelude node excluded');
    // Every emitted edge originates from an own node.
    for (const e of own.edges) assert.ok(ownIds.has(e.from), `edge from own node: ${e.from}`);
    // The typeOf reference to the base concept id is preserved (dangling).
    assert.equal(own.nodes.find((n) => n.id === 'Microsoft.azure')?.typeOf, 'Location');
  });
});
