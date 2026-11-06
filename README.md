# Wealthfolio Addons

Official and community addons for Wealthfolio.

This repo is the source of truth for addon source, community submissions, and
release artifacts. The Wealthfolio app repo keeps the addon runtime, SDK,
developer tools, and host APIs. The public catalog, database, ratings, and
download metrics live outside this repo.

Addon developer documentation: [wealthfolio.app/docs/addons](https://wealthfolio.app/docs/addons/)

Repo split and migration notes:
[docs/repository-migration.md](docs/repository-migration.md)

## Structure

```text
official/                    Wealthfolio-owned addon source
local/                       Fork-maintained addons, built separately without store listings
community/directory/         Community discovery entries
templates/                   Submission templates
schemas/                     JSON schemas for addon metadata
scripts/                     Validation, schema tests, release, README helpers
docs/                        Repository migration and maintainer notes
```

## 本地插件测试与发布

`local/` 插件通过 GitHub Release ZIP 手动安装，`official/` 由上游打包。本仓库 CI 仍检查 official 的类型和测试，但不构建其 ZIP。

修改 local 插件时，在同一个 PR 中同步升级 `manifest.json`、`package.json` 的 `major.minor.patch` 版本，并在该插件 `CHANGELOG.md` 顶部添加 `## [版本] - YYYY-MM-DD` 和中文更新说明。修改共享 `packages/import-wizard-ui/`、根依赖锁文件或公共 TypeScript 配置时，全部 local 插件都要升版。仅修改工作流、仓库说明或 official 不触发 local 发布。

CI 在同级检出 `FJiayang/wealthfolio` 的 `main`，按两仓库锁文件安装依赖，先构建宿主 SDK 和 UI。宿主主干变化可能影响同一个 PR 的重跑结果，每次运行及 Release 都记录实际宿主提交。本地验证需准备相同的同级宿主结构与依赖：

```sh
pnpm test:release
pnpm validate:local-release origin/main dist/local-release-plan.json
pnpm check
pnpm bundle:local
pnpm test:package:local
```

PR 的 `Addon checks` 覆盖元数据、official 检查、共享 UI 和 local 插件的类型与单元测试、版本说明和 ZIP 内容验证。构建产物位于该运行的 `local-addon-packages` artifact。

合并 `main` 后重新检查，仅为新版本创建 `<插件ID>/v<版本>` Release。附件 `<插件ID>-<版本>.zip` 直接来自该次验证产物；从 Releases 下载后在 Wealthfolio 插件设置中选择“从文件安装”。CI 不自动升版、不发布商店，也不修改宿主数据。

发布先创建 draft、上传 ZIP，再公开。失败时修复原因后重跑失败 job；同一提交的 draft 可以恢复，已公开版本不会覆盖。主干须开启 PR 合并和 `Addon checks` 必需检查，不能跳过失败检查合并。

## Trust Model

There are two channels, and no tier in between.

| Channel   | Publisher, support, updates | Package hosted by | How users install                       |
| --------- | --------------------------- | ----------------- | --------------------------------------- |
| Official  | Wealthfolio (Teymz Inc.)    | Wealthfolio       | One click, from inside the app          |
| Community | The independent developer   | The developer     | Download from the publisher → Install from File |

A community listing is a link. Wealthfolio does not build, host, audit,
endorse, or support community addons; it validates the submitted listing
metadata and may carry out risk-based internal moderation, neither of which
produces a badge. The rules are in [POLICIES.md](POLICIES.md).

- `trust`: `official` or `community` — which channel the addon belongs to.
- `status`: lifecycle state — `active`, `pending`, `coming-soon`, `deprecated`,
  or `inactive`. Only `active` community entries are published on the website;
  `pending` means the publisher has not confirmed the listing yet.

## Metadata Files

Each addon has two separate contracts:

- `manifest.json`: runtime contract consumed by Wealthfolio when installing and
  loading the addon.
- `addon.store.json`: catalog, release, publisher-disclosure, and distribution
  metadata, validated against [`schemas/addon-store.schema.json`](schemas/addon-store.schema.json).

Official addons keep full source in this repo and carry a `distribution` block.
Community entries are a single `addon.store.json` with a public repository link
and the publisher's disclosures; they may not declare a `distribution` block,
because Wealthfolio hosts no community artifacts.

## Reporting

Vulnerabilities, malicious addons, privacy problems, and IP complaints go
privately to hello@wealthfolio.app — see [SECURITY.md](SECURITY.md). Public
issues are for ordinary directory corrections only.

## Wealthfolio 3.7 Development

Existing addon bundles built for Wealthfolio 3.6 remain supported by the 3.7
runtime. Only raise `minWealthfolioVersion` to `3.7.0` when an addon uses a 3.7
API, such as `ctx.assets`.

Live development against Wealthfolio 3.7 requires
`@wealthfolio/addon-dev-tools` 3.7 or later. The host now loads the complete
runtime package from `/runtime-package`, including the manifest, JavaScript,
CSS, and packaged assets. The older `/addon.js`-only development protocol is
not compatible with a 3.7 host.

For a new 3.7 addon, align the Wealthfolio packages and manifest versions:

```json
{
  "devDependencies": {
    "@wealthfolio/addon-dev-tools": "^3.7.0",
    "@wealthfolio/addon-sdk": "^3.7.0",
    "@wealthfolio/ui": "^3.7.0"
  }
}
```

Pin addon builds to the same browser floor as Wealthfolio 3.7 instead of
inheriting Vite's changing default:

```ts
build: {
  target: ["chrome107", "edge107", "firefox104", "safari16"],
}
```

This corresponds to Chrome/Edge/WebView2 and Android WebView 107+, Firefox
104+, Safari/WKWebView 16+, macOS 12+, and iOS/iPadOS 16+. Keep Linux WebKitGTK
and Android System WebView updated.

```json
{
  "minWealthfolioVersion": "3.7.0",
  "sdkVersion": "3.7.0"
}
```

### Packaged Assets

There is no asset permission or manifest asset list. Non-JavaScript/CSS files
under `assets/**` and `dist/assets/**` are indexed into a private, per-addon
registry. JavaScript and CSS in those roots remain runtime modules and styles.
Read packaged assets through `ctx.assets`:

```ts
const iconUrl = await ctx.assets.getUrl("assets/icon.png");
const template = await ctx.assets.getBlob("assets/report-template.csv");
const paths = ctx.assets.list().map((asset) => asset.path);
```

Use the returned URL for images, fonts, media, and other supported browser
consumers. The runtime caches and revokes these blob URLs with the addon
lifecycle. Local CSS `url(...)` references are rewritten automatically;
JavaScript and JSX strings are not, so resolve those explicitly with
`ctx.assets.getUrl()`.

Packaged assets are intended for private static addon resources, not arbitrary
network access. Remote CSS `url(...)` values and `@import` rules are rejected.
Each asset is limited to 5 MiB, each addon to 25 MiB and 256 files, and symlinks
are not accepted.

Worker and service-worker entry points, popups/new windows, and direct browser
network requests are intentionally blocked. Outbound HTTPS goes through
`ctx.api.network.request()`, which is not a baseline capability. Declare both
the `network` permission and the hosts the addon may reach, or the call throws
`AddonPermissionDenied`:

```json
{
  "permissions": [
    {
      "category": "network",
      "functions": ["request"],
      "purpose": "Fetch daily quotes from the market data provider"
    }
  ],
  "network": {
    "allowedHosts": ["api.example.com"]
  }
}
```

`network.allowedHosts` is required whenever an addon declares network access.
The user approves hosts at install time, and only that approved subset is
reachable through the broker.

The QueryClient from `ctx.api.query.getClient()` is scoped to one addon
sandbox. Addon invalidation and refetch operations with serializable
string-based keys are mirrored to the host, but host-originated changes do not
automatically invalidate an addon's cache; subscribe to the relevant host
events when fresh data matters.

The official addons currently published as 3.6.2 remain runtime-compatible
with Wealthfolio 3.7. Their legacy `ui` permission entries are retained in
those release manifests. New 3.7 manifests should not declare baseline
capabilities such as UI, packaged assets, query, storage, toast, or logging.

## Common Commands

```bash
pnpm install
pnpm test:schema
pnpm validate:addons
pnpm generate
pnpm type-check:official
pnpm bundle:official
```

Fork-maintained statement and fund import: see [local/unified-statement-import-addon](local/unified-statement-import-addon/README.md). The former standalone Ant Fund addon has been merged into this addon.
The Validate workflow tests and bundles it separately and uploads an installable ZIP.

| Script                     | Description                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `pnpm build:official`      | Builds every addon under `official/*` and writes each addon's `dist/addon.js`.                                  |
| `pnpm bundle:official`     | Cleans, builds, and zips every official addon for release handoff.                                              |
| `pnpm type-check:official` | Runs TypeScript checks for every official addon without emitting files.                                         |
| `pnpm test:schema`         | Runs the store-schema regression fixtures and validates the submission templates.                              |
| `pnpm test:derive`         | Runs the derivation regression tests against untrusted-manifest and version-parsing cases.                     |
| `pnpm derive:community`    | Re-reads publisher repositories and refreshes `community/derived.json`. The only step that uses the network.   |
| `pnpm validate:addons`     | Validates addon metadata against the schema, plus ids, layout, distribution keys, notices, and media.          |
| `pnpm release:official`    | Builds, hashes the built artifacts, and emits the catalog SQL for those exact bytes.                            |
| `pnpm generate:readme`     | Regenerates the official and community addon tables from `addon.store.json` files.                              |
| `pnpm generate`            | Alias for `pnpm generate:readme`.                                                                               |
| `pnpm check`               | Runs the schema tests, addon metadata validation, and official addon type checks.                              |

Generated files:

- `community/README.md`: community addon table generated from metadata.
- `official/README.md`: official addon table generated from metadata.

## Official Addons

| Addon                   | Path                                     |
| ----------------------- | ---------------------------------------- |
| Goal Progress Tracker   | `official/goal-progress-tracker-addon`   |
| Investment Fees Tracker | `official/investment-fees-tracker-addon` |
| Swingfolio              | `official/swingfolio-addon`              |

## Release Flow

Official addons only. A release is one transaction: the digest must describe the
exact bytes that get uploaded, so never rebuild between hashing and uploading.

1. Update the addon source, `manifest.json`, `CHANGELOG.md`, and
   `addon.store.json` (bump `release.version`; `distribution.r2Path` is derived
   as `{id}/{id}-{version}.zip` and is validated).
2. Run `pnpm check` (schema tests, metadata validation, type checks).
3. Run the addon's own tests if it has any.
4. Run `pnpm release:official --only <addon-id>`. It builds, prints the artifact
   path, size, and SHA-256, and emits the catalog SQL carrying that digest.
5. Upload **that same zip** to `r2://{id}/{id}-{version}.zip`.
6. Run the emitted SQL against the catalog database, then verify the published
   URL hashes to the digest that was printed.

Never use `release:official` to produce a digest for an already-published
release — a rebuild is different bytes. Hash the object already in R2 instead.
