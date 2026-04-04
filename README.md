https://drakecaesar.github.io/windforge-tools/

## Item catalog (Vite)

**Git repository root** is this **`item-catalog`** project (not the Windforge / Steam tree). It may live under `…/WindforgeBaseline/tools/item-catalog` on disk only so `extract_itemlist.py` can read the game’s `Data/...` Lua via the path layout it expects (`game root` = parent of `tools/`).

The UI is built with [Vite](https://vitejs.dev/). Use **pnpm** (via [fnm](https://github.com/Schniz/fnm) + `corepack enable`, or `npx pnpm`).

```bash
pnpm install
pnpm dev
```

Production build output goes to `dist/`:

```bash
pnpm build
pnpm preview
```

### GitHub Actions

Workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs **`pnpm install`** and **`pnpm build`** on pushes and PRs to `main` / `master`.

**GitHub Pages:** In the repo go to **Settings → Pages → Build and deployment → Source: GitHub Actions**. After the first successful push to `main` (or `master`), the site is published from the `dist/` artifact.

### Catalog data (`public/`)

All shipped catalog assets live under **`public/`**: **`catalog.json`** (+ **`catalog.json.gz`**) bundling item list + recipes + block stats, and a single **`icons-atlas.png`** (or flat per-hash PNGs if atlas packing is skipped). Vite copies this tree to `dist/` unchanged.

Regenerate everything with:

```bash
pip install -r requirements.txt
python extract_itemlist.py
```

The script **exits immediately** if Python is older than 3.10 or if **Pillow** / **imageio** are missing, with install instructions. It reads `Data/...` Lua from the **game install** (see path note at the top) and writes into `public/`.

Fetches use `import.meta.env.BASE_URL` so paths work from any deploy root. In **dev**, if `.json.gz` is missing or fails to load, the app falls back to plain `.json` in `public/`.

### Layout

| Path | Role |
|------|------|
| `public/` | Catalog data from `extract_itemlist.py` (JSON, gzip, `icons-atlas.png`) — copied to `dist/` as-is |
| `src/main.js` | Entry: CSS + app bootstrap |
| `src/app.js` | Main UI |
| `src/sort-permutation-core.js` | Sort rules (shared with worker) |
| `src/sort-cache-worker.js` | Web Worker (ES module) |
| `src/recipe-sort.js`, `src/colors.js` | Shared helpers |
| `extract_itemlist.py` | Build step: game Lua → `public/` |
