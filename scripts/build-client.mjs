/**
 * Build the browser half of the plugin (`./client`).
 *
 * DSH's client module system serves each plugin's client bundle from
 * `exports["./client"]` and expects the lazy-CJS factory wrapper DSH's own
 * packages ship: `window.__ModuleLoader__.load({ id, factory })`, where the
 * factory receives `require` for the frozen platform baseline and returns the
 * module's exports. esbuild produces the CommonJS body; this script adds the
 * wrapper, so the check-out needs no private DSH build tooling.
 */
import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageName = 'dsh-tracebook'
const outfile = `${root}dist/client.js`

// The shell seeds exactly this frozen module table; every one of these resolves
// without a `dsh.client.external` request. Everything else is bundled in.
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const banner = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(packageName)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`

const footer = `\t\treturn module.exports;
\t}
});
`

await build({
  entryPoints: [`${root}src/client/index.tsx`],
  outfile,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  sourcemap: 'external',
  banner: { js: banner },
  footer: { js: footer },
  logLevel: 'warning',
})

// esbuild appends its source-map comment before the footer; move it to the end
// so devtools still find the map.
const bundled = await readFile(outfile, 'utf8')
const sourceMapComment = '//# sourceMappingURL=client.js.map'
await writeFile(outfile, `${bundled.replace(`${sourceMapComment}\n`, '')}${sourceMapComment}\n`)

// A minimal declaration for the package's own `./client` export.
await mkdir(`${root}dist`, { recursive: true })
await writeFile(`${root}dist/client.d.ts`, `import type { Context } from '@deepseek-ai/cordis'
export declare const inject: string[]
export declare function apply(ctx: Context): void
`)

console.log(`built ${packageName} client bundle → dist/client.js`)
