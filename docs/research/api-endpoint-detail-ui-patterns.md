# Per-endpoint "API detail" (schema + latency) — evidence report

Research for a compact Vue 3 / static-SPA / offline "API detail" block in the Tracebook investigation-report plugin.

**Evidence conventions.** `[VERIFIED]` = read directly from a spec, official docs, or repo/npm metadata (URL given). `[INFERENCE]` = my conclusion, not a vendor statement. All dates are from npm registry / GitHub API metadata fetched for this report. License caveats are called out where sources disagree.

**Environment caveat.** `developer.chrome.com` and some `raw.githubusercontent.com` fetches were unreliable in this environment; where a Chromium/Google doc could not be fetched directly, the officially-attributed mirror (Microsoft Edge DevTools docs, which are a CC-BY-4.0 modification of the Chromium docs and link the canonical Chrome URL) or the `cdn.jsdelivr.net` GitHub mirror was used. These are flagged inline.

---

## 1. HAR (HTTP Archive) 1.2 spec

### 1.1 Provenance and status

- HAR 1.2 is a **frozen, community-authored spec** by Jan Odvarko: <http://www.softwareishard.com/blog/har-12-spec/>. `[VERIFIED]`
- There is a **W3C "Historical Draft" (14 Aug 2012)** of the same format at <https://w3c.github.io/web-performance/specs/HAR/Overview.html>. Its status section says verbatim: **"DO NOT USE — This document was never published by the W3C Web Performance Working Group and has been abandoned."** `[VERIFIED]`
- Practical consequence: HAR 1.2 (softwareishard) is the de-facto standard; the W3C copy is a useful normative-style restatement (it uses RFC 2119 MUST/SHOULD and object tables) but is not a living standard. `[INFERENCE]`
- Other normative facts: files **MUST be UTF-8**; a reader MUST ignore a BOM; JSON (RFC 4627); `.zhar` = zipped HAR and `.harp` = JSONP-padded HAR are *recommendations*, not part of the core spec; custom fields **MUST start with `_`**; unknown non-`_` fields from a higher minor version must be ignored. `[VERIFIED]`

### 1.2 Root and container objects (exact JSON names)

| Object | Fields (exact) |
|---|---|
| `log` | `version` (string; if empty, `"1.1"` assumed), `creator` (obj), `browser` (obj, optional), `pages` (array, optional), `entries` (array, required), `comment` (1.2) |
| `creator` / `browser` | `name`, `version`, `comment` (1.2) |
| `page` | `startedDateTime` (ISO-8601), `id`, `title`, `pageTimings` (obj), `comment` |
| `pageTimings` | `onContentLoad`, `onLoad`, `comment` — ms since page load start, `-1` if n/a |
| `entry` | `pageref` (optional), `startedDateTime`, `time`, `request`, `response`, `cache`, `timings`, `serverIPAddress` (1.2, optional), `connection` (1.2, optional), `comment` (1.2) |

`entry.time` = **total elapsed ms**, defined as the sum of all `timings` values that are not `-1`. `[VERIFIED]`

### 1.3 `timings` — the exact per-entry timing model

All values are **milliseconds**. `[VERIFIED]`

| Field | Req? | Meaning |
|---|---|---|
| `blocked` | optional | Time queued waiting for a network connection. `-1` if n/a. |
| `dns` | optional | DNS resolution time. `-1` if n/a. |
| `connect` | optional | Time to create the TCP connection. `-1` if n/a (e.g. reused connection). |
| `send` | **required** | Time to send the HTTP request to the server. |
| `wait` | **required** | Waiting for a response from the server (TTFB-equivalent). |
| `receive` | **required** | Time to read the entire response (or cache). |
| `ssl` | optional (new in 1.2) | SSL/TLS negotiation time. **Included in `connect`** for 1.1 compatibility. `-1` if n/a. |
| `comment` | optional (1.2) | Free text. |

Invariant (spec, verbatim): `entry.time == blocked + dns + connect + send + wait + receive` when no value is `-1`. A tool may omit `blocked`/`dns`/`connect`/`ssl` entirely if it cannot measure them; if it can measure but a phase does not apply it sets `-1`. `send`/`wait`/`receive` must be non-negative. `[VERIFIED]`

> Design note: HAR separates `ssl` from `connect` but says `ssl ⊆ connect`. If you render a waterfall, draw `ssl` as an overlay on `connect`, not as a sibling segment, or the segments will not sum to `time`. `[INFERENCE]`

### 1.4 `request` / `response` schema (exact JSON names)

`request`: `method`, `url` (absolute, no fragment), `httpVersion`, `cookies[]`, `headers[]`, `queryString[]`, `postData` (optional), `headersSize` (bytes up to and including the double CRLF; `-1` n/a), `bodySize` (POST body bytes; `-1` n/a), `comment`. Total request size = `headersSize + bodySize`. `[VERIFIED]`

`response`: `status`, `statusText`, `httpVersion`, `cookies[]`, `headers[]`, `content`, `redirectURL`, `headersSize`, `bodySize` (0 for cache/304; `-1` n/a), `comment`. Total response size = `headersSize + bodySize`. Response `headersSize` counts only headers actually received from the server (browser-added headers appear in `headers[]` but not in the count). `[VERIFIED]`

Sub-objects: `cookies[]` = `name,value,path,domain,expires,httpOnly,secure,comment`; `headers[]` = `name,value,comment`; `queryString[]` = `name,value,comment` (NVP); `postData` = `mimeType,params[],text,comment` (note: `text` and `params` are **mutually exclusive**); `params[]` = `name,value,fileName,contentType,comment`. `[VERIFIED]`

`response.content` = `size` (uncompressed length in bytes), `compression` (bytes saved, optional), `mimeType` (includes charset), `text` (decoded UTF-8 body, or a base64 representation), `encoding` (e.g. `"base64"`, new in 1.2), `comment`. Binary bodies are stored **base64-encoded**, i.e. ~**+33%** size, and `content.size` reflects the uncompressed length, not the encoded length. `[VERIFIED]`

`cache` = `beforeRequest` / `afterRequest`, each `expires,lastAccess,eTag,hitCount,comment`, with `null` semantics spelled out in the spec (`beforeRequest:null, afterRequest:{...}` = not cached before, stored after). `[VERIFIED]`

### 1.5 How big is a HAR file?

There is **no size limit in the spec**; size is driven by how many response bodies the exporter inlines. `[VERIFIED]` Real-world anchors:

- Median web page weight (total transfer of all resources) per HTTP Archive / Web Almanac 2025: **desktop 2,412 KB, mobile 2,164 KB** at the median; desktop home pages **2.9 MB**; 75th percentile desktop **4,570 KB**; 90th percentile desktop **9,179 KB**, and desktop home pages **11,406 KB** at p90. <https://almanac.httparchive.org/en/2025/page-weight> `[VERIFIED]`
- A "save all as HAR **with content**" of a single page load is therefore on the order of the page weight (single-digit MB) plus JSON/base64 overhead — for binary assets the base64 rule adds ~33%. `[INFERENCE from the two VERIFIED facts above]`
- Exporter-level body caps are common, so "how big" depends on the tool: Firefox caps saved response bodies at `devtools.netmonitor.responseBodyLimit`, default **1,048,576 bytes (1 MB)** (<https://bugzilla.mozilla.org/show_bug.cgi?id=1223726>); HTTP Toolkit discards bodies **> 500,000 bytes** ("Body discarded during HAR generation: longer than limit of 500000 bytes", <https://github.com/httptoolkit/httptoolkit/issues/477>, and a companion issue about warning users when data is trimmed, <https://github.com/httptoolkit/httptoolkit/issues/670>); HttpWatch's browser-extension HAR export limits bodies to **50 kB**. `[VERIFIED for the numbers as documented in those sources]`
- Very large captures can exceed what DevTools can export at all: a reported case with **9,262 requests / 8.6 MB transferred / 21.8 MB resources** produced a **0-byte** HAR via both export paths (<https://stackoverflow.com/questions/66373792/exporting-large-har-file-from-chrome-dev-tools>). `[VERIFIED as a user report; not a documented limit]`

> Planning number for an offline plugin: assume **1–10 MB for a typical single-page-load HAR**, and enforce your own per-body and total-size caps (a 500 KB per-body cap matches HTTP Toolkit; 1 MB matches Firefox). If you must ship HARs inside the plugin bundle, use `.zhar` (gzip) — the spec explicitly recommends compressing. `[INFERENCE]`

---

## 2. Mature open-source HAR viewers / renderers for a web UI

### 2.1 Comparison table

| Project | License | Tech | Embeddability | Maintenance (npm release / last repo push) |
|---|---|---|---|---|
| **HAR Viewer** — `janodvarko/harviewer` | **BSD-3-Clause** (`webapp/license.txt`) | Plain JS: RequireJS + jQuery + Domplate + highlight.js | **Full web app**, not a component. Embed via `iframe`/URL params (`?inputUrl=`, JSONP `.harp` with `callback=`). No npm package. | stable **v2.0.17 (21 Mar 2016)**; repo last push **2022-11-25**; 1,076★ |
| **PerfCascade** — `micmro/PerfCascade` | **MIT** | TypeScript, **UMD**, SVG | **Best drop-in.** `fromHar(harDoc[, options])` returns an **SVG element** you append to any DOM node; works with bundlers, AMD, or a global. Framework-agnostic. | npm **3.0.3, 2022-11-13**; repo push **2023-03-03**; 286★; 89 versions |
| **@cloudflare/waterfall** — `cloudflare/telescope` (`packages/waterfall`) | **Apache-2.0** | **Framework-free Web Component** (`<waterfall-chart>`) + standalone CSS | **Excellent for offline/static.** Three modes: (a) CSS-only **pre-rendered HTML** via pure `renderToHTML(har)` (no JS at runtime), (b) progressive enhancement (pre-render + lazy `waterfall.js`), (c) fully dynamic via `.har` property / `src`. Ships a CLI that emits a self-contained HTML report. | npm **0.1.1**; created **2026-06-10**, modified 2026-09-03; only **2 versions** (young) |
| **network-viewer** — `saucelabs/network-viewer` | **ambiguous**: repo `LICENSE` = **Apache-2.0**, published `package.json` says **MIT** | **React** component (peer `react ^16.13.1`) | `<NetworkViewer data={har}/>` React component; also a standalone app. Heavy (React 16 peer, recharts, react-window). | npm **2.4.5, 2025-07-14**; 133★ |
| **chromeHAR** — `ericduran/chromeHAR` | **MIT** | CSS/JS, mimics Chrome Network tab | Standalone viewer app, not a documented component. | 498★; repo last push **2026-03-07** |
| **waterfall-tools** — `pmeenan/waterfall-tools` | **Apache-2.0** | TS, **canvas** renderer, multi-format | Normalizes HAR/Netlog/Chrome Trace/Perfetto/CDP/WebPageTest/qlog/PCAP into "Extended HAR" and renders WebPageTest-style; ships an offline **PWA** viewer. Peer deps on Chrome DevTools frontend + `qvis` → heavier. | npm **0.4.0, 2026-07-06** |
| **harshark** — `MacroPolo/harshark` | MIT | Python (Tk) | Offline **desktop** app — not web-embeddable. | last push 2023-09 |
| **har-analyzer** — `mfoulks3200/har-analyzer` | **GPL-3.0** | VS Code extension | Not a web component; **GPL-3.0 copyleft** — avoid copying into a permissive plugin. | last push 2023-12 |
| **chrome-har** — `sitespeedio/chrome-har` | MIT | Node | **Generator** (CDP → HAR), not a viewer. Useful if you ever capture HARs yourself. | npm 1.3.1, 2026-05 |
| **har-schema** / **@types/har-format** | MIT | JSON Schema / TS types | Validation + typings for the HAR 1.2 model. `@types/har-format` 1.2.16 (2024-09). | har-schema 2.0.0 (2017) |
| **Chrome DevTools Network panel** | **closed source** | — | Not embeddable. Use only as the canonical **UI vocabulary**. | n/a |
| **Fiddler Classic** | closed (commercial) | — | Exports/imports HAR ("Import and Export Formats" doc). | n/a |
| **Charles Proxy** | closed (commercial) | — | Exports HAR (widely documented; not independently fetched here → `[INFERENCE]`). | n/a |
| **Google Admin Toolbox "HAR Analyzer"** | closed | — | Hosted tool only. | n/a |

URLs: <https://github.com/janodvarko/harviewer> · <https://github.com/janodvarko/harviewer/blob/master/webapp/license.txt> · <https://github.com/micmro/PerfCascade> · <https://www.npmjs.com/package/perf-cascade> · <https://github.com/cloudflare/telescope/tree/main/packages/waterfall> · <https://www.npmjs.com/package/@cloudflare/waterfall> · <https://github.com/saucelabs/network-viewer> · <https://www.npmjs.com/package/network-viewer> · <https://github.com/ericduran/chromeHAR> · <https://github.com/pmeenan/waterfall-tools> · <https://www.npmjs.com/package/waterfall-tools> · <https://github.com/MacroPolo/harshark> · <https://github.com/mfoulks3200/har-analyzer> · <https://github.com/sitespeedio/chrome-har> · <https://www.npmjs.com/package/har-schema> · <https://www.npmjs.com/package/@types/har-format> · <https://www.telerik.com/fiddler/fiddler-classic/documentation/knowledge-base/importexportformats>

### 2.2 PerfCascade API surface (the safest drop-in)

`[VERIFIED]` from the repo README:

```js
import { fromHar } from 'perf-cascade'
const svg = fromHar(myHarDoc, { /* options */ })
document.body.appendChild(svg)
```

Documented options include `rowHeight`, `showAlignmentHelpers`, `showMimeTypeIcon`, `showIndicatorIcons`, `leftColumnWidth`, `pageSelector` / `selectedPage`, `legendHolder`, `showUserTiming` / `showUserTimingEndMarker`. `.zhar` support exists via a separate `perf-cascade-file-reader`. Internally it parses HAR into a framework-agnostic `WaterfallDocs` type and renders in `PerfCascade()` — so **you can feed it non-HAR data** by writing another transformer (the README explicitly says so), which is useful if Tracebook stores its own normalized timing records. `[VERIFIED]`

### 2.3 "Network-Analyzer"

No mature, single OSS project by that name exists as a HAR/web viewer. The searches surface unrelated projects (`milosfolic/network-analyzer` Go, `Binco97/Network-analyzer`). Treat "Network-Analyzer" as a generic term; the real candidates are the table above. `[INFERENCE]`

### 2.4 Recommendation for a Vue 3 offline SPA `[INFERENCE]`

1. **PerfCascade (MIT)** as the default runtime waterfall — one function, returns SVG, permissive license, stable API, no framework coupling.
2. **@cloudflare/waterfall (Apache-2.0)** if you want a **build-time, JS-free** rendering path (`renderToHTML` + static CSS) — ideal for a static SPA that must work offline with minimal runtime JS. Caveat: 0.x, young.
3. Copy the **Chrome DevTools timing vocabulary** for labels (below), and use the HAR `timings` field names as the canonical data keys.

---

## 3. OpenTelemetry / Jaeger / Grafana Tempo — span timing presentation

### 3.1 OpenTelemetry HTTP span semantic conventions `[VERIFIED]`

Source: <https://opentelemetry.io/docs/specs/semconv/http/http-spans/> and raw <https://github.com/open-telemetry/semantic-conventions/blob/main/docs/http/http-spans.md>

Server span name: `{http.request.method} {http.route}` (e.g. `GET /webshop/articles/:article_id`). Low-cardinality client/HTTP span name: `{http.request.method}` (e.g. `GET`).

Key span attributes (Stability = Stable unless noted):

| Attribute | Req level | Example |
|---|---|---|
| `http.request.method` | Required | `GET` |
| `http.response.status_code` | Conditional (if received) | `200` |
| `http.route` | Conditional | `/webshop/articles/:article_id` |
| `url.full` (client) / `url.path`+`url.query`+`url.scheme` (server) | Required/Opt-In | `https://example.com:8080/...` |
| `server.address`, `server.port` | Required (client) | `example.com`, `8080` |
| `network.protocol.version` | Recommended | `1.1`, `2`, `3` |
| `network.peer.address` / `network.peer.port` | Opt-In | `192.0.2.5` |
| `user_agent.original` | Recommended (server) | Mozilla/5.0… |
| `error.type` | Conditional (on error) | `500`, `timeout`, `java.net.UnknownHostException` |

Span status rules: 4xx → status left **unset** for `SpanKind.SERVER`; 4xx → **Error** for `SpanKind.CLIENT`; 5xx → **Error**. `[VERIFIED]`

**Implication for a compact block:** an endpoint's *identity* maps cleanly to `(http.request.method, http.route)` — this is the low-cardinality endpoint key that OTel itself standardizes. Use it as the join key between schema and latency. `[INFERENCE]`

The full metric conventions (needed for item 6) are in §6.3.

### 3.2 Jaeger UI `[VERIFIED data model + embed; UI labels from an official-adjacent doc]`

- **Data model** (`packages/jaeger-ui/src/types/trace.tsx`, pinned commit `944bb833`): all timestamps in **microseconds**. `SpanData = { spanID, traceID, processID, operationName, startTime, duration, logs, tags?, references?, warnings?, childSpanIds? }`; `Log = { timestamp, fields: KeyValuePair[] }`; `Process = { serviceName, tags }`; `SpanReference = { refType: 'CHILD_OF'|'FOLLOWS_FROM', spanID, traceID }`; `Trace = { processes, traceID, duration, endTime, spans, startTime, traceName, services: {name, numberOfSpans}[] }`. Waterfall rows need `depth`, `hasChildren`, `relativeStartTime`. There is also a `criticalPathSection = { spanId, section_start, section_end }`. <https://github.com/jaegertracing/jaeger-ui/blob/944bb833fa79db39630525e826dfc272841cf1de/packages/jaeger-ui/src/types/trace.tsx>
- **UI**: search (Service, Operation, Lookback, Tags, Min/Max Duration, Limit) → **Trace Timeline** (visual timeline, duration bars, parent-child relationships, color by service) → **Span Details** (Operation name, Duration, Tags, Logs, Process). `[VERIFIED as a description of the Jaeger UI in an integration doc: https://raw.githubusercontent.com/wso2/docs-api-platform/main/en/docs/api-gateway/1.1.0/observability/tracing/viewing-traces-in-jaeger.md — third-party, but consistent with the official data model]`
- **Embeddable?** Jaeger UI ships an official **"embedded" layout mode** (`?uiEmbed=v0`), with layout knobs `uiTimelineCollapseTitle`, `uiTimelineHideMinimap`, `uiTimelineHideSummary`, `uiSearchHideGraph`. This is an **iframe/URL-level** integration, not a component. <https://www.jaegertracing.io/docs/latest/deployment/frontend-ui/> `[VERIFIED]` There is **no published embeddable React component** (`@jaegertracing/jaeger-ui-components` is not on npm). A historical PR proposed embedded `SearchTraces`/`Tracepage` components (<https://github.com/jaegertracing/jaeger-ui/pull/263>). `[VERIFIED that the npm package does not exist; the PR is the historical attempt]`
- **License/status**: `jaegertracing/jaeger-ui` **Apache-2.0**, 1,527★, last push 2026-09-22 (actively maintained). `[VERIFIED]`

### 3.3 Grafana Tempo / Grafana trace view `[VERIFIED]`

Source: <https://grafana.com/docs/grafana-cloud/visualizations/explore/trace-integration/>

Exact UI region labels in the Grafana trace view:

- **Header**: header title (root span name + trace ID), **Search**, **Metadata**.
- **Minimap**: condensed timeline; drag to zoom; **Reset selection**.
- **Timeline**: each span row = **Expand children**, **Service name**, **Operation name**, **Span duration bar**. The duration bar highlights the trace's **critical path** with a darker segment, computed by the **CRISP (Critical Path for Service Performance)** algorithm; a **Show critical path only** button lives in **Span filters**.
- **Span details**: **span attributes**, **resource attributes**, **events**, **links**. Grafana Learning docs phrase the same idea as: select a span row → its attributes appear below the row; "Span attributes describe that one step… Resource attributes describe where the span came from"; the details panel may show whether the span is on the **critical path**. <https://grafana.com/docs/learning-paths/read-a-trace/span-attributes/>
- **Span filters**: **Service name**, **Span name**, **Duration** (accepted units `ns, us, ms, s, m, h`), **Tags** (tags, process tags, or log fields), **Show matches only**.

**Traces Drilldown** (per-endpoint latency analytics, <https://grafana.com/docs/plugins/grafana-exploretraces-app/latest/ui-reference/>): metric types **Rate**, **Errors**, **Duration**; a **Duration heat map**; **Percentiles: p50, p75, p90, p95, p99 (default p90)**; investigation tabs **Breakdown**, **Service structure**, **Comparison**, **Traces**; **Exceptions** (error message grouping with count, sparkline, service, last-seen); **Attributes sidebar** with **Favorites / All / Resource / Span** scopes and regex search; shareable state via **Copy url**. `[VERIFIED]`

**Licenses / embeddability** `[VERIFIED]`:

- `grafana/grafana` core: **AGPL-3.0** (<https://github.com/grafana/grafana/blob/main/LICENSE>). Panels/dashboards are normally embedded via **iframe/share** (Grafana feature) — but AGPL-3.0 means you should not copy source into a proprietary plugin. `[License VERIFIED; iframe embedding is standard Grafana behavior — INFERENCE on the exact feature doc]`
- `grafana/tempo` backend: **AGPL-3.0** (GitHub API).
- **`@grafana/scenes`** — "Grafana framework for building dynamic dashboards" — **Apache-2.0** (v8.18.2; CHANGELOG: "License: Switch to Apache 2.0 #327"). This is the one Grafana UI-layer library that is permissively licensed and designed for app embedding. `[VERIFIED]`
- `@grafana/faro-web-sdk`: **Apache-2.0** (repo LICENSE + npm 2.12.1, modified 2026-09-22). `[VERIFIED]`
- Third-party: `@kofoworola/trace-viewer` — MIT, React, "normalized trace types, an OpenTelemetry adapter, and React components"; v0.2.1, created 2026-07-14, only 3 versions. `[VERIFIED npm metadata]` Too young to depend on, but shows the component shape. `[INFERENCE]`

**Takeaway:** Jaeger and Grafana both prove the *same two-part pattern*: a **waterfall/timeline of span bars** plus a **detail panel keyed by span attributes** (with resource/process attributes separated out), and both add a **critical-path highlight** and a **minimap**. No mature vendor ships a permissively-licensed embeddable trace component; you re-implement the pattern. `[INFERENCE]`

---

## 4. Postman / Insomnia / Hoppscotch / Bruno — endpoint detail UI

(Detailed sub-research; canonical URLs.)

### 4.1 Postman

- App is **closed-source**. Open components are all **Apache-2.0**: `newman`, `postman-runtime`, `postman-collection`, `postmanlabs/schemas`. `[VERIFIED]`
- Request regions: **Params, Authorization, Headers, Body** (form-data / urlencoded / raw [Text, JavaScript, JSON, HTML, XML] / binary / GraphQL), **Scripts** (Pre-request, Post-response). Response regions: **Body** (JSON/XML/HTML/YAML/JavaScript/Markdown/Raw/Hex/Base64 + Preview + Search + JSONPath/XPath filter + Visualize), **Cookies**, **Headers**, **Test Results** (passed/total, filter Passed/Skipped/Failed). `[VERIFIED — https://learning.postman.com/docs/use/send-requests/response-data/responses/]`
- **Metrics**: **"Response time"** (ms; hover shows a graph of how long each event took) and **"Response size"** (hover shows a **breakdown by body and header sizes**); status-code hover gives a description; network-icon hover shows local/remote IP, HTTP version, certificate verification. `[VERIFIED — same doc]`
- **No embeddable viewer.** "Run in Postman" is a fork/import CTA; published docs are Postman-hosted. Observed responses are saved as **"examples"** attached to a request, separate from the request definition. `[VERIFIED for the CTA/docs; the examples-vs-request separation is INFERENCE flagged by the sub-research]`
- Postman **Insights** does have a per-endpoint **Latency** tab: <https://learning.postman.com/docs/insights/reference/app/latency-tab> `[VERIFIED the page exists; contents not fully read]`

### 4.2 Insomnia (Kong)

- **Apache-2.0**, React + Electron, self-hostable/desktop, Local Vault, Git Sync. `[VERIFIED — https://raw.githubusercontent.com/Kong/insomnia/develop/LICENSE]`
- Request tabs: Params, Body, Auth, Headers, Scripts (Pre-request / After-response), Docs. Response pane + **Timeline** tab. `[VERIFIED]`
- **Correction to a common assumption:** Insomnia's **Timeline is a raw read-only HTTP log**, not a DNS/TCP/TLS phase waterfall. Source `response-timeline-viewer.tsx` renders prefix-tagged lines: `HeaderIn "< "`, `DataIn "| "`, `SslDataIn "<< "`, `HeaderOut "> "`, `DataOut "| "`, `SslDataOut ">> "`, `Text "* "`. A visual timing breakdown is an **open feature request** (Discussion #6452). `[VERIFIED — https://github.com/Kong/insomnia/discussions/6452]`
- No documented Time/Size labels in official docs; no embeddable viewer ("Run in Insomnia" is an import deep link). `[VERIFIED per sub-research]`
- Data model: v5 YAML exports with top-level `type` (`collection.insomnia.rest/5.0`, `spec…`, `mock…`, `environment…`), `schema_version`, `name`, `meta.id`; published JSON Schema `insomnia.schema.5.1.json`; legacy v4 JSON = flat `resources[]` with `_type` including **`response`** — i.e. **requests and observed responses are separate resource types**. `[VERIFIED]`

### 4.3 Hoppscotch

- **MIT**; **Vue 3** (pnpm override pins `vue 3.5.41`); self-host Community Edition via Docker (`hoppscotch/hoppscotch` AIO, or frontend/backend/admin images). Publishes `@hoppscotch/ui` (MIT, Vue 3) — a general UI kit, **not** a response viewer. `[VERIFIED]`
- Request: method+endpoint, Parameters, Headers, Request Body, Authorization Headers, Pre-request scripts, Tests. Response: **Body** (JSON/HTML/XML/Image), **Raw**, **Headers**, **Test Results**, Save as Example, jq filter, Download, Copy, **Generate Data Schema** (TypeScript/C#/Go…). `[VERIFIED — https://docs.hoppscotch.io/documentation/getting-started/rest/response-handling]`
- **Time/size: partial.** Official page text says the response UI covers "HTTP status codes, JSON/HTML/XML response bodies, headers, cookies, and **response time metrics**", but the exact label strings are not enumerated. No documented embeddable viewer; no published request-vs-response-metrics schema. `[VERIFIED that the docs say "response time metrics"; the exact labels are INFERENCE/unverified]`
- **Vue 3 is the closest stack match to Tracebook** among these four, and MIT permits copying patterns/code. `[INFERENCE]`

### 4.4 Bruno

- **MIT**; React 19 + styled-components + Redux Toolkit + Rsbuild + Storybook; Electron shell; local-first (collections are files in your own Git). `[VERIFIED]`
- **Timeline** tab has three categories with exact labels `[VERIFIED — https://docs.usebruno.com/debugging/timeline]`:
  - **Request**: URL, Query Parameters, Request Body, Request Headers, Authentication, Variables.
  - **Response**: Status Code, Response Headers, Response Body, **Response Size**, **Execution Time**.
  - **Network Logs**: Request/Response Flow, **Network Timing** (breakdown of connection, DNS, SSL, transfer times), Protocol Details, Debugging Information.
  - Filters: All / Request / Pre-Request / Post-Response; Clear Timeline.
- Also: response panel with Data Type Selector (Editor + Preview), Save as Example, Download, Copy, Change Layout; Dev Tools (Console / Network / Performance / Terminal). `[VERIFIED]`
- **Closest to an embeddable artifact**: Bruno generates a standalone **HTML docs file** with search, environment switch, code samples (cURL/Python/JS) and an interactive **Try** playground. Not an npm component, but a re-usable generated artifact. `bruno-app` also depends on **`swagger-ui-react`** (Apache-2.0). `[VERIFIED — https://docs.usebruno.com/html-docs/generate, https://docs.usebruno.com/html-docs/playground]`
- Data model: `.bru` markup (`meta`, `get/post/…`, `params:query`, `params:path`, `headers`, `body:json|text|xml|form-urlencoded|multipart-form|graphql`, `script:pre-request`, `script:post-response`, `test`) = **request-only**; OpenCollection YAML = `info / http / runtime / settings / docs` — **no response-metric fields**. Response examples are saved as nested sub-requests. `[VERIFIED]`

### 4.5 Chrome DevTools Network → Timing (the canonical vocabulary)

Canonical: <https://developer.chrome.com/docs/devtools/network/reference/#timing-breakdown-phases-explained> (fetched via the officially-attributed mirror <https://learn.microsoft.com/en-us/microsoft-edge/devtools/network/reference#timing-breakdown-phases-explained>).

Phase labels (verbatim): **Queueing · Stalled · Startup (service worker) · respondWith (service worker) · DNS Lookup · Initial connection** (includes TCP handshakes, retries **and negotiating SSL**) **· Proxy negotiation · Request sent · ServiceWorker Preparation · Request to ServiceWorker · Waiting (TTFB) · Content Download · Receiving Push · Reading Push**. Requests table default columns: **Name, Status, Type, Initiator, Size, Time, Fulfilled by**; the **Waterfall** column is off by default. `[VERIFIED via mirror]`

> Note the mismatch you must handle: DevTools has **no standalone SSL phase** (folded into "Initial connection"), while HAR 1.2 **does** expose `timings.ssl` as a separate (sub-`connect`) value. `[VERIFIED both; the reconciliation is INFERENCE]`

### 4.6 Cross-product conclusion

None of the four ships a documented, embeddable, reusable **endpoint-detail viewer component**. For copying UI patterns/code: **Bruno (MIT, React)** and **Hoppscotch (MIT, Vue 3)** are the permissive sources; Insomnia is Apache-2.0 but must *not* be modelled as a timing waterfall; Postman has the richest documented metrics but a closed UI. `[INFERENCE, supported by the VERIFIED facts above]`

---

## 5. API monitoring / analytics products — latency next to schema

### 5.1 Per-product findings (exact UI labels)

**Treblle** `[VERIFIED]` — <https://docs.treblle.com/explore-treblle/platform/endpoints>
Endpoint list shows **HTTP Method, Last Request, Total Requests, Description, Average Load Time** ("the endpoint's average response time"), **Requests Graph**; sortable by load time. Endpoint actions: INCLUDE IN DOCS / REMOVE FROM DOCS, Mute/Unmute, Edit alias, Delete. API dashboard: **Total Requests, Number of Endpoints**, green/red **heartbeat**, **governance score**. **No percentiles are documented — average only.** Schema lives in a *separate* **API Documentation** tab (method, path, request-body parameters, response schema); an interactive "Try It" is described as future work. Dashboard closed; `treblle` npm SDK is **MIT**.

**Moesif** `[VERIFIED quote]` — <https://www.moesif.com/features/api-analytics>
Feature page advertises "**What's my 90th percentile latency broken down by endpoint?**". Analytics areas: **Live Event Log, Time Series, Segmentation, Geo Heatmaps, Trace Explorer** (<https://www.moesif.com/docs/api-analytics/>); endpoint filtering auto-populates from current data. Has a "spike in latency" alert detector. Does **not** render OpenAPI schema. FAQ (<https://www.moesif.com/docs/faq/>): "Are your SDKs open-source? Yes, our SDKs and API gateway plugins are open-source." Dashboard itself not open; **Embedded Metrics** and **Sharing Workspaces** are the embeddable paths.

**Akamai API Security / API Performance** `[UNVERIFIED]` — public docs are auth-gated (`https://techdocs.akamai.com/api-security/` returns a Control Center auth shell; `https://docs.nonamesecurity.com/` 302s to a login). The closest public docs (App & API Protector, <https://techdocs.akamai.com/application-security/reference/get-discovered-api-endpoints.md>) cover **API discovery/inventory only** ("List discovered API endpoints"), with **no latency metric**. Do not cite Akamai per-endpoint latency labels as fact.

**Datadog APM / API Catalog** `[VERIFIED]` — <https://docs.datadoghq.com/tracing/services/service_page.md> and <https://docs.datadoghq.com/internal_developer_portal/catalog/endpoints/explore_endpoints/>
Service page: **Requests and Errors** (including **% Error Rate**, Errors per Second, Requests per Second by Version), a **Latency** graph ("displays the latency percentiles as a timeseries"), and a Resources list with columns **Requests, Requests per second, Avg/p75/p90/p95/p99/Max Latency, Error Rate**. Catalog Endpoints list metrics: *Last Seen, Requests, Latency, Errors*; "click **P95** to see endpoints with the top 95th percentile for latency"; the endpoint details page shows "metadata, performance metrics, errors, dependencies"; ownership is inherited "from the associated API definition in the Catalog". **Schema is not rendered in APM** — the Catalog links out to the API definition. `DataDog/datadog-agent` is **Apache-2.0**; the web UI is closed.

**Postman Insights / API Catalog** `[VERIFIED]` — <https://learning.postman.com/docs/insights/reference/app/latency-tab/>
"Sort your endpoints by **Total requests** or **p90 Latency**"; "Hover over the data points … to observe latency percentiles"; the **p90 Latency** graph is in milliseconds. Filters: HTTP methods, hosts, path templates, search. Errors tab: "aggregate per-endpoint error data" for 4xx/5xx. API Catalog (<https://learning.postman.com/docs/api-catalog/explore.md>) shows "**Error rate** — Production error rate percentage" and "**p95 latency** — 95th percentile response time". **Schema lives in Spec Hub; metrics dashboards are separate** and closed.

**Swagger UI / SwaggerHub** `[VERIFIED]` — <https://github.com/swagger-api/swagger-ui>
**Apache-2.0**. Renders the OpenAPI document itself: paths, operations, parameters, request bodies, response schemas and examples, plus **Try it out**. It *can* show a single request duration: `src/core/components/live-response.jsx` renders `<h5>Request duration</h5><pre>{duration} ms</pre>` gated by the `displayRequestDuration` config — **one request, in ms, never percentiles**. SwaggerHub Explore/Portal docs show no per-endpoint runtime latency metrics.

**ReadMe** `[VERIFIED]` — <https://docs.readme.com/main/docs/mcp-metrics>
MCP Metrics: cards **MCP Calls**, **Error Rate** (% 4xx/5xx), **Response Time (p95)** (tooltip also shows the median), **Top Clients**; table columns Time, Tool, Status, Method, Path, **Operation ID** (click opens "the matching reference page"), **Response Time** (ms), Query, Results, Spec File, User Agent, API Key. General API metrics (<https://docs.readme.com/main/docs/using-metrics-charts>): "API call volume, endpoint usage, and errors", "Top Endpoints (usage)", "API Errors over time" — no percentile documented outside MCP. This `operationId` → reference-page link is the **closest thing found to schema + latency in one view**. License: `readmeio/api-explorer` repo LICENSE **MIT** (npm `@readme/api-explorer` declares **ISC** — discrepancy); `readmeio/oas` **MIT**.

**Grafana Faro** `[VERIFIED]` — SDK **Apache-2.0** (<https://github.com/grafana/faro-web-sdk>).
Collects Web Vitals via the `web-vitals` package; metric keys `ttfb|cls|fcp|lcp|fid|inp` with attribution fields (TTFB `dns_duration`, `time_to_first_byte`; LCP `element_render_delay`, `resource_load_duration`; INP `presentation_delay`). **No p50/p95/p99 labels** — raw per-event timing. Grafana core UI is **AGPL-3.0**. No API-schema concept.

**Elastic APM** `[VERIFIED]` — <https://www.elastic.co/docs/solutions/observability/apm/transactions-ui>
Charts: **Latency** ("average, 95th, and 99th percentile"), **Throughput** (2xx/3xx/4xx response codes), **Failed transaction rate**, **Time spent by span type**, **Cold start rate**. The **Transactions table** groups by transaction name ("most used and slowest endpoints"), sorted by **Impact**; transaction details show **Latency distribution**, trace samples and **Metadata** (HTTP request/response information, URL). **No OpenAPI schema rendered** — the unit is a transaction group/route. Licenses: **Kibana** = triple **AGPL-3.0-only / SSPL-1 / Elastic License 2.0** (default) with some Apache-2.0; **`elastic/apm-server` defaults to Apache-2.0**.

### 5.2 Comparison

| Product | Schema/params/examples in same view? | Latency percentiles shown? |
|---|---|---|
| Treblle | No — separate API Documentation tab | **No** — "Average Load Time" only |
| Moesif | No — analytics only | Yes — "90th percentile latency broken down by endpoint" |
| Akamai API Security | Not publicly verifiable (docs gated) | Not publicly verifiable |
| Datadog APM / Catalog | No — Catalog links the API definition | Yes — Avg/**p75/p90/p95/p99**/Max Latency; P95 sortable |
| Postman Insights / Catalog | No — Spec Hub / collections | Yes — **p90** (Insights), **p95** (Catalog) + error rate |
| Swagger UI (SwaggerHub) | **Yes — full OpenAPI schema + examples + Try it out** | No — optional single "Request duration" (ms) |
| ReadMe | **Partial** — MCP `operationId` links to the reference page | MCP only — "Response Time (p95)" + median tooltip |
| Grafana Faro | n/a | No — raw per-request / Web-Vitals timings (TTFB/LCP/INP…) |
| Elastic APM | No schema | Yes — avg / **95th / 99th** percentile + failed transaction rate |

### 5.3 Pattern and reusable pieces `[INFERENCE]`

The mature pattern is a **two-surface UX**:

1. An **endpoint list/table** with RED columns (**Requests/throughput, Error rate, latency percentiles**) — Datadog and Postman let you *sort by* p90/p95.
2. A **drill-down endpoint page** with latency distribution/percentile charts plus API metadata, linking out to the schema definition.

Notably, **no product surveyed renders request/response schema and latency percentiles in one component.** ReadMe's MCP `operationId` → reference-page cross-link is the closest; Swagger UI keeps schema and shows only a single request duration. So a compact "schema + latency" block is genuinely uncommon and must be composed, not borrowed. `[INFERENCE]`

Permissively-licensed reusable pieces found: **Swagger UI (Apache-2.0)** — the only fully open schema renderer; **ReadMe `api-explorer` (MIT/ISC) and `oas` (MIT)** — embeddable schema tooling; **Grafana Scenes (Apache-2.0)** — dashboard framework; **Grafana Faro SDK (Apache-2.0)** — telemetry collection. Every per-endpoint analytics **dashboard** is closed source (Datadog, Postman, Treblle, Moesif, ReadMe, Elastic), and Grafana core / Tempo / Kibana are **AGPL-3.0-family**, which is unsuitable for copying into a proprietary plugin.

---

## 6. Data model: attaching observed latency samples to an API endpoint record

### 6.1 OpenAPI `x-` specification extensions

- OpenAPI 3.1 §4.9: extensions are **patterned fields always prefixed by `x-`**; field name MUST begin with `x-` (e.g. `x-internal-id`); **`x-oai-` and `x-oas-` are reserved** for the OpenAPI Initiative; value may be `null`, primitive, array, or object. **Anything with `x-` may be ignored by tooling.** <https://spec.openapis.org/oas/v3.1.0#specification-extensions> `[VERIFIED]`
- There is **no standardized latency/response-time extension.** The request has been open since 2016 and is still unresolved:
  - **Issue #3063 "Describe expected response times for responses"** (closed as duplicate of #695) — <https://github.com/OAI/OpenAPI-Specification/issues/3063>. In the thread, maintainer Darrel Miller explicitly recommends: *"I would start by suggesting some `x-` extensions and let's see whether there is interest… If it becomes popular we can consider incorporating the values into a future spec update."* `[VERIFIED]`
  - Concrete extension names proposed by the community in that thread: **`x-expected-response-time-ms`**, **`x-timeout-ms`**, **`x-timeout`**, **`x-max-response-time`**. Also proposed: `x-cost` / `x-cost-code`. `[VERIFIED as proposals — NOT standards]`
  - Related open requests: **#695** "Ability to define a API-level and method-level timeouts" (<https://github.com/OAI/OpenAPI-Specification/issues/695>) and **#541** (<https://github.com/OAI/OpenAPI-Specification/issues/541>). `[VERIFIED for #695; #541 URL from the thread]`
  - A real vendor precedent: AWS API Gateway uses the vendor extension object **`x-amazon-apigateway-integration`** with a **`timeoutInMillis`** property — <https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-swagger-extensions-integration.html>. `[VERIFIED as cited in the thread; AWS page not independently fetched]`
- Best practice: put a declared/SLO latency as an `x-` extension on the **Operation Object**, and observed samples in a **separate telemetry record** — do not conflate "expected" with "observed". `[INFERENCE]`

### 6.2 AsyncAPI extensions

AsyncAPI explicitly allows **`x-`-prefixed patterned fields in any part of the document**; the docs state any property starting with `x-` is reserved for user definitions and won't conflict with future spec versions, and note that tools may not support extensions. Example given: `x-linkedin: '/company/asyncapi'`. <https://www.asyncapi.com/docs/concepts/asyncapi-document/extending-specification> `[VERIFIED]`

### 6.3 OpenTelemetry HTTP metric names, units and buckets (exact)

Source: <https://opentelemetry.io/docs/specs/semconv/http/http-metrics/> (raw: `docs/http/http-metrics.md`). Semconv version at time of writing: **1.44.0**. `[VERIFIED]`

| Metric | Instrument | Unit (UCUM) | Stability | Notes |
|---|---|---|---|---|
| `http.server.request.duration` | **Histogram** | **`s`** (seconds) | **Stable** | The latency metric you want. ExplicitBucketBoundaries `[0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]` |
| `http.client.request.duration` | Histogram | `s` | Stable | Same buckets |
| `http.server.active_requests` | UpDownCounter | `{request}` | Development | Opt-in |
| `http.server.request.body.size` / `http.server.response.body.size` | Histogram | `By` | Development | Opt-in |
| `http.client.request.body.size` / `http.client.response.body.size` | Histogram | `By` | Development | Opt-in |
| `http.client.open_connections` | — | `{connection}` | Development | Opt-in |
| `http.client.connection.duration` | Histogram | `s` | Development | Buckets `[0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]` |

Key attributes for `http.server.request.duration`: `http.request.method` (Required), `url.scheme` (Required), `http.response.status_code` (Conditional), `error.type` (Conditional), `http.route` (Conditional), `network.protocol.name` / `network.protocol.version`, `server.address` / `server.port` (Opt-In). `http.client.request.duration` additionally has `server.address`/`server.port` Required and `url.template` (Development, Opt-In). `[VERIFIED]`

**Name/unit migration (critical):** `[VERIFIED]` <https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/>

- `http.server.duration` → **`http.server.request.duration`**, unit **`ms` → `s`**, histogram boundaries updated and the zero bucket removed (stable since semconv **v1.23.1**; old form documented at spec v1.20.0).
- `http.client.duration` → **`http.client.request.duration`**, same `ms → s` change.
- If you store latency samples, be explicit about **seconds vs milliseconds**; OTel stable uses **seconds**.

### 6.4 W3C Server-Timing (attaching server-side breakdown to one response)

- W3C **Working Draft, 7 April 2026** (Recommendation track): the **`Server-Timing`** response header communicates one or more metrics for a request-response cycle. Syntax: `metric-name *( OWS ";" OWS param )`; two standardized params: **`dur`** (duration) and **`desc`** (description). JS surface: `PerformanceServerTiming { name, duration, description }`, exposed via `PerformanceResourceTiming.serverTiming`. `duration` is `DOMHighResTimeStamp`, **usually milliseconds** (a recommendation, not enforceable). Example: `Server-Timing: miss, db;dur=53, app;dur=47.2`. **No `startTime` is defined** (clock sync is impossible), so entries cannot be placed on the client timeline — only durations can. <https://www.w3.org/TR/server-timing/> `[VERIFIED]`
- This is the standards-blessed way to attach **named server-side phase durations** to a single observed request, and it is directly analogous to HAR's `timings` phases but server-authored. `[INFERENCE]`

### 6.5 Google SRE golden signals and latency aggregation

<https://sre.google/sre-book/monitoring-distributed-systems/> `[VERIFIED]`

- The **four golden signals**: **Latency**, **Traffic**, **Errors**, **Saturation**.
- Latency guidance: distinguish **successful vs failed** request latency; "it's important to track **error latency**, as opposed to just filtering out errors."
- Tail guidance: prefer **counts bucketed by latency** over means — "collect request counts bucketed by latencies (suitable for rendering a histogram)… how many requests did I serve that took between 0 ms and 10 ms, between 10 ms and 30 ms, between 30 ms and 100 ms, between 100 ms and 300 ms…". It recommends distributing histogram boundaries **approximately exponentially, by factors of roughly 3**, and notes measuring the **99th percentile** over a short window as an early saturation signal.
- This is exactly the model OTel's `ExplicitBucketBoundaries` implements (`≈ ×3` steps from 5 ms to 10 s). `[INFERENCE connecting the two VERIFIED sources]`

### 6.6 Established model to use `[INFERENCE — synthesis of the VERIFIED material above]`

The mature, defensible shape is to keep **schema** and **observations** as separate records joined by a low-cardinality endpoint key:

```
Endpoint (identity)
  method            // http.request.method
  route             // http.route / OpenAPI path template, e.g. /users/{id}
  schemaRef         // OpenAPI Operation Object or components reference (x- extensions allowed)
  declaredLatency?  // x-expected-response-time-ms / x-timeout-ms  (proposal, not standard)

Observation (one request or one aggregate)
  endpointId
  timestamp
  durationMs        // single request: HAR entry.time, or OTel span duration
  phases?           // HAR timings {blocked,dns,connect,ssl,send,wait,receive} OR
                    // Server-Timing entries {name,dur,desc}
  statusCode        // http.response.status_code
  errorType?        // error.type
  requestHeadersSize / requestBodySize / responseHeadersSize / responseBodySize  // HAR
  source            // "har" | "otel-span" | "otel-metric" | "server-timing"

LatencyRollup (per endpointId + window)
  count, errorCount
  p50, p75, p90, p95, p99        // Grafana Traces Drilldown uses exactly this set, default p90
  histogramBuckets               // OTel ExplicitBucketBoundaries in seconds, or SRE ~×3 ms buckets
```

Joining key: `(http.request.method, http.route)` is the only **standardized low-cardinality endpoint identity** across OTel/Jaeger/Grafana; OpenAPI path templates are its schema-side equivalent. `[INFERENCE]`

---

## 7. Implications for the Tracebook "API detail" block `[INFERENCE]`

Clearly inference — these are recommendations, not findings.

1. **Use the HAR `timings` object as the canonical per-request phase model.** It is frozen, widely implemented, and every viewer in §2 speaks it. Store `send`/`wait`/`receive` as required and `blocked`/`dns`/`connect`/`ssl` as optional with `-1` for n/a; render `ssl` as a sub-segment of `connect` so segments sum to `time`.
2. **Two-sided identity for the endpoint record:** `(method, route-template)` (OTel `http.request.method` + `http.route`) as the join key; OpenAPI operation as the schema side.
3. **Schema block:** render params/headers/body schema + example responses (Bruno/ReadMe/Swagger UI pattern). Keep an explicit `source` on every field (`openapi`, `observed-har`, `example`) so the report never presents an example as an observation.
4. **Latency block:** show a compact RED row — `requests, error rate, p50/p95/p99` — plus a **bucket histogram / heat map**, matching Grafana Traces Drilldown's percentile set and OTel's stable histogram buckets. Avoid showing only a mean (Google SRE explicitly warns against it).
5. **Waterfall:** PerfCascade (MIT) is the lowest-risk runtime renderer; `@cloudflare/waterfall`'s `renderToHTML` is attractive for a static, JS-light offline build. Label phases with the DevTools vocabulary users recognize, and keep the HAR keys underneath.
6. **Provenance/extensions:** declare declared/SLO latency as `x-expected-response-time-ms` on the OpenAPI operation (mark it as a **non-standard extension**, citing issue #3063), and keep observed samples in Tracebook's own observation records — do not overload the schema document with telemetry.
7. **Sizes are not optional metadata:** HAR `headersSize`/`bodySize`/`content.size`/`content.compression` give real request/response size; surface them (Postman and Bruno both do). Cap stored bodies (500 KB–1 MB) and consider `.zhar` compression.
8. **Offline/static constraint:** no product surveyed ships a reusable schema+latency viewer component; plan to compose one from an MIT/Apache-2.0 renderer (§2) plus your own Vue tables. Avoid GPL-3.0 (`har-analyzer`) and AGPL-3.0 (Grafana core, Tempo, Kibana) source for a proprietary plugin.

---

### Primary sources (one-line index)

HAR spec <http://www.softwareishard.com/blog/har-12-spec/> · W3C HAR draft <https://w3c.github.io/web-performance/specs/HAR/Overview.html> · Page weight <https://almanac.httparchive.org/en/2025/page-weight> · PerfCascade <https://github.com/micmro/PerfCascade> · @cloudflare/waterfall <https://github.com/cloudflare/telescope/tree/main/packages/waterfall> · network-viewer <https://github.com/saucelabs/network-viewer> · HAR Viewer <https://github.com/janodvarko/harviewer> · OTel HTTP spans <https://opentelemetry.io/docs/specs/semconv/http/http-spans/> · OTel HTTP metrics <https://opentelemetry.io/docs/specs/semconv/http/http-metrics/> · OTel migration <https://opentelemetry.io/docs/specs/semconv/non-normative/http-migration/> · Jaeger UI <https://github.com/jaegertracing/jaeger-ui> · Jaeger embed <https://www.jaegertracing.io/docs/latest/deployment/frontend-ui/> · Grafana trace view <https://grafana.com/docs/grafana-cloud/visualizations/explore/trace-integration/> · Grafana Traces Drilldown <https://grafana.com/docs/plugins/grafana-exploretraces-app/latest/ui-reference/> · OpenAPI extensions <https://spec.openapis.org/oas/v3.1.0#specification-extensions> · OpenAPI response-time issue <https://github.com/OAI/OpenAPI-Specification/issues/3063> · AsyncAPI extensions <https://www.asyncapi.com/docs/concepts/asyncapi-document/extending-specification> · W3C Server-Timing <https://www.w3.org/TR/server-timing/> · Google SRE golden signals <https://sre.google/sre-book/monitoring-distributed-systems/>
