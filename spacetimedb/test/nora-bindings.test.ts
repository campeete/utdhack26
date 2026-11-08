// Nora's worker uses hand-written client bindings (server/nora/bindings.ts) because
// `spacetime generate` needs the CLI. Rows are decoded by position, so a column added,
// removed or reordered in the module without updating the bindings would corrupt
// every row Nora reads. These tests fail first instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mod from '../src/index';
import { NORA_REDUCERS, NORA_VIEWS } from '../../server/nora/bindings';
import { DEMO_REDUCERS, DEMO_VIEWS } from '../../server/demo/bindings';

const snake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));

// The module table each view returns rows of.
const VIEW_TABLE: Record<keyof typeof NORA_VIEWS, string> = {
  incident_logins: 'login_event',
  incident_accounts: 'northstar_account',
  incident_findings: 'finding',
  low_severity_rules: 'low_severity_rule',
  nora_memory_feed: 'nora_memory',
  nora_reassessment_queue: 'reassessment_request',
  incident_suggestions: 'suggestion',
  incident_evidence: 'evidence',
  incident_sources: 'source',
  incident_decisions: 'decision',
  incident_team_updates: 'team_update',
};

describe("Nora's client bindings match the module", () => {
  const tables = (mod.default as any).schemaType.tables;

  for (const [viewName, row] of Object.entries(NORA_VIEWS)) {
    it(`${viewName} rows`, () => {
      expect((mod as any)[viewName], `module exports view ${viewName}`).toBeDefined();
      const moduleCols = tables[VIEW_TABLE[viewName as keyof typeof NORA_VIEWS]].rowType.elements
        .map((e: any) => [e.name, json(e.algebraicType)]);
      const clientCols = (row as any).algebraicType.value.elements
        .map((e: any) => [snake(e.name), json(e.algebraicType)]);
      expect(clientCols).toEqual(moduleCols);
    });
  }

  // Reducer argument lists are read from the module source, since the schema object
  // does not expose them.
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const structFields = (name: string): [string, string][] => {
    const m = new RegExp(`const ${name} = t\\.object\\('${name}', \\{\\n([\\s\\S]*?)\\n\\}\\);`).exec(source);
    if (!m) throw new Error(`struct ${name} not found in module source`);
    return m[1].split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => { const i = l.indexOf(':'); return [l.slice(0, i).trim(), typeOf(l.slice(i + 1))] as [string, string]; });
  };
  const typeOf = (text: string): string => {
    const m = text.trim().replace(/,$/, '');
    const wrap = /^t\.(option|array)\((.*)\)$/.exec(m);
    if (wrap) return `${wrap[1]}<${typeOf(wrap[2])}>`;
    const base = /^t\.(\w+)\(\)$/.exec(m);
    if (base) return base[1];
    if (/^[A-Z]\w*$/.test(m)) return `struct{${structFields(m).map(([k, v]) => `${k}:${v}`).join(',')}}`;
    throw new Error(`unrecognised type in module source: ${m}`);
  };
  const clientType = (a: any): string => {
    const tag = a.tag;
    if (tag === 'Sum') return `option<${clientType(a.value.variants.find((v: any) => v.name === 'some').algebraicType)}>`;
    if (tag === 'Array') return `array<${clientType(a.value)}>`;
    if (tag === 'Product') {
      const els = a.value.elements;
      if (els.length === 1 && els[0].name === '__identity__') return 'identity';
      if (els.length === 1 && els[0].name === '__timestamp_micros_since_unix_epoch__') return 'timestamp';
      return `struct{${els.map((e: any) => `${snake(e.name)}:${clientType(e.algebraicType)}`).join(',')}}`;
    }
    return ({ U64: 'u64', U32: 'u32', String: 'string', Bool: 'bool' } as Record<string, string>)[tag] ?? tag;
  };

  for (const [name, args] of Object.entries({ ...NORA_REDUCERS, ...DEMO_REDUCERS })) {
    it(`${name} arguments`, () => {
      // One-line form `{ a: t.x(), b: t.y() },` first, then the multi-line form.
      const block = new RegExp(`export const ${name} = spacetimedb\\.reducer\\(\\n  \\{ ([^\\n]*?) \\},\\n`).exec(source)
        ?? new RegExp(`export const ${name} = spacetimedb\\.reducer\\(\\n  \\{\\n([\\s\\S]*?)\\n  \\},\\n  \\(ctx`).exec(source);
      expect(block, `reducer ${name} found in module source`).not.toBeNull();
      const moduleArgs = block![1].split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean)
        .map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), typeOf(s.slice(i + 1))]; });
      const clientArgs = Object.entries(args).map(([k, b]) => [snake(k), clientType((b as any).algebraicType)]);
      expect(clientArgs).toEqual(moduleArgs);
    });
  }

  for (const [viewName, [tableName, row]] of Object.entries(DEMO_VIEWS)) {
    it(`${viewName} rows (demo setup)`, () => {
      expect((mod as any)[viewName], `module exports view ${viewName}`).toBeDefined();
      const moduleCols = tables[tableName].rowType.elements.map((e: any) => [e.name, json(e.algebraicType)]);
      const clientCols = (row as any).algebraicType.value.elements.map((e: any) => [snake(e.name), json(e.algebraicType)]);
      expect(clientCols).toEqual(moduleCols);
    });
  }
});
