// Nora's worker, the demo setup and the dashboard use hand-written client bindings
// (shared/module-rows.ts plus a small file per client) because `spacetime generate`
// needs the CLI. Rows are decoded by position, so a column added, removed or
// reordered in the module without updating the bindings would corrupt every row a
// client reads. These tests fail first instead.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as mod from '../src/index';
import { MODULE_ROWS } from '../../shared/module-rows';
import { NORA_REDUCERS, NORA_VIEWS } from '../../server/nora/bindings';
import { DEMO_REDUCERS, DEMO_VIEWS } from '../../server/demo/bindings';
import { DASHBOARD_REDUCERS, DASHBOARD_VIEWS } from '../../src/live/bindings';

const snake = (s: string) => s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
const json = (x: unknown) => JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
const tables = (mod.default as any).schemaType.tables;
const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

describe('client rows match the module tables', () => {
  for (const [tableName, row] of Object.entries(MODULE_ROWS)) {
    it(tableName, () => {
      expect(tables[tableName], `module has table ${tableName}`).toBeDefined();
      const moduleCols = tables[tableName].rowType.elements.map((e: any) => [e.name, json(e.algebraicType)]);
      const clientCols = (row as any).algebraicType.value.elements.map((e: any) => [snake(e.name), json(e.algebraicType)]);
      expect(clientCols).toEqual(moduleCols);
    });
  }
});

describe('client views exist and return the rows the client expects', () => {
  const clients = { nora: NORA_VIEWS, demo: DEMO_VIEWS, dashboard: DASHBOARD_VIEWS } as Record<string, Record<string, string>>;
  const tableVar: Record<string, string> = { auditEvent: 'audit_event', auditHead: 'audit_head' };
  for (const [client, views] of Object.entries(clients)) {
    for (const [viewName, tableName] of Object.entries(views)) {
      it(`${client}: ${viewName}`, () => {
        expect((mod as any)[viewName], `module exports view ${viewName}`).toBeDefined();
        expect(MODULE_ROWS[tableName as keyof typeof MODULE_ROWS], `row for ${tableName}`).toBeDefined();
        // The view's declared row type in the module source must be that table's rowType.
        const decl = new RegExp(`export const ${viewName} = spacetimedb\\.view\\(\\s*\\{ name: '${viewName}', public: true \\},\\s*t\\.array\\((\\w+)\\.rowType\\)`).exec(source);
        expect(decl, `view ${viewName} declaration found`).not.toBeNull();
        expect(tableVar[decl![1]] ?? decl![1]).toBe(tableName);
      });
    }
  }
});

describe('client reducer arguments match the module', () => {
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

  for (const [name, args] of Object.entries({ ...NORA_REDUCERS, ...DEMO_REDUCERS, ...DASHBOARD_REDUCERS })) {
    it(name, () => {
      // One-line form `{ a: t.x(), b: t.y() },` first, then the multi-line form.
      const block = new RegExp(`export const ${name} = spacetimedb\\.reducer\\(\\n  \\{ ([^\\n]*?) \\},\\n`).exec(source)
        ?? new RegExp(`export const ${name} = spacetimedb\\.reducer\\(\\n  \\{\\n([\\s\\S]*?)\\n  \\},\\n  \\(ctx`).exec(source);
      expect(block, `reducer ${name} found in module source`).not.toBeNull();
      const moduleArgs = block![1].split(/,(?![^(]*\))/).map(s => s.trim()).filter(s => s && !s.startsWith('//'))
        .map(s => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), typeOf(s.slice(i + 1))]; });
      const clientArgs = Object.entries(args).map(([k, b]) => [snake(k), clientType((b as any).algebraicType)]);
      expect(clientArgs).toEqual(moduleArgs);
    });
  }
});
