#!/usr/bin/env python3
"""
Extract ItemList from Data/objects/crafting/craftingitems.lua into `public/itemlist.json`
(and `public/itemlist.json.gz`), including a packed PNG atlas at `public/icons-atlas.png`
of unique inventory DDS icons (Pillow required; otherwise per-hash PNGs are copied flat into `public/`).

Also extracts block stats from Data/objects/sharedblockinfo.lua into `public/sharedblockinfo.json`
(and `.gz`) — hitPoints, mass, buoyancy, impactDamageMult per block type.

Parses Data/objects/crafting/recipes.lua into recipesByProduct (ingredients to craft an item)
and recipesByIngredient (recipe sets that use an item as an ingredient, one row per set).

All emitted catalog assets live under `public/` so Vite serves them in dev and copies them to `dist/`.

Run from anywhere: python extract_itemlist.py
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

LuaValue = Union[None, bool, int, float, str, Dict[str, Any], List[Any]]


class LuaParseError(ValueError):
    pass


class LuaTableParser:
    """Parse a Lua table literal (subset: strings, numbers, bool, nil, nested tables)."""

    __slots__ = ("s", "i", "n")

    def __init__(self, s: str) -> None:
        self.s = s
        self.i = 0
        self.n = len(s)

    def skip_ws(self) -> None:
        while self.i < self.n and self.s[self.i] in " \t\r\n":
            self.i += 1

    def peek(self) -> str:
        return self.s[self.i] if self.i < self.n else ""

    def expect(self, c: str) -> None:
        self.skip_ws()
        if self.i >= self.n or self.s[self.i] != c:
            raise LuaParseError(f"expected {c!r} at {self.i}, got {self.peek()!r}")
        self.i += 1

    def parse_identifier(self) -> str:
        self.skip_ws()
        if self.i >= self.n or not (self.s[self.i].isalpha() or self.s[self.i] == "_"):
            raise LuaParseError(f"bad identifier start at {self.i}")
        start = self.i
        while self.i < self.n and (self.s[self.i].isalnum() or self.s[self.i] == "_"):
            self.i += 1
        return self.s[start : self.i]

    def parse_string(self) -> str:
        self.skip_ws()
        if self.peek() != '"':
            raise LuaParseError("string must start with \"")
        self.i += 1
        out: List[str] = []
        while self.i < self.n:
            c = self.s[self.i]
            if c == "\\":
                self.i += 1
                if self.i >= self.n:
                    break
                out.append(self.s[self.i])
                self.i += 1
                continue
            if c == '"':
                self.i += 1
                return "".join(out)
            out.append(c)
            self.i += 1
        raise LuaParseError("unterminated string")

    def parse_number(self) -> Union[int, float]:
        self.skip_ws()
        start = self.i
        if self.peek() == "-":
            self.i += 1
        if self.i >= self.n:
            raise LuaParseError("bad number")
        while self.i < self.n and self.s[self.i].isdigit():
            self.i += 1
        if self.peek() == ".":
            self.i += 1
            while self.i < self.n and self.s[self.i].isdigit():
                self.i += 1
        if self.peek() in "eE":
            self.i += 1
            if self.peek() in "+-":
                self.i += 1
            while self.i < self.n and self.s[self.i].isdigit():
                self.i += 1
        raw = self.s[start : self.i]
        if "." in raw or "e" in raw.lower():
            return float(raw)
        return int(raw)

    def parse_keyword_or_number(self) -> LuaValue:
        self.skip_ws()
        if self.peek() == '"':
            return self.parse_string()
        if self.peek() == "{":
            return self.parse_table()
        if self.peek() in "-0123456789":
            return self.parse_number()
        ident = self.parse_identifier()
        if ident == "true":
            return True
        if ident == "false":
            return False
        if ident == "nil":
            return None
        raise LuaParseError(f"unexpected token {ident!r} at {self.i}")

    def parse_table(self) -> Dict[str, Any]:
        self.expect("{")
        self.skip_ws()
        result: Dict[str, Any] = {}
        while True:
            self.skip_ws()
            if self.peek() == "}":
                self.i += 1
                break
            key = self.parse_identifier()
            self.skip_ws()
            self.expect("=")
            self.skip_ws()
            val = self.parse_keyword_or_number()
            result[key] = val
            self.skip_ws()
            if self.peek() == ",":
                self.i += 1
            continue
        return result


def parse_item_line(line: str) -> Dict[str, Any]:
    line = line.strip()
    if not line.endswith(","):
        line = line + ","
    # Outer `{ ... },` — strip trailing comma for parser (parser expects closing `}` only)
    if line.endswith(","):
        line = line[:-1].rstrip()
    p = LuaTableParser(line)
    v = p.parse_keyword_or_number()
    p.skip_ws()
    if p.i != p.n:
        raise LuaParseError(f"trailing junk at {p.i}: {p.s[p.i : p.i + 40]!r}")
    if not isinstance(v, dict):
        raise LuaParseError("item root must be a table")
    return v


LINE_RE = re.compile(r"^\s*\{\s*name\s*=")

# Top-level block type tables in sharedblockinfo.lua: NameType = { ... }
SHARED_BLOCK_START_RE = re.compile(
    r"^(\w+)\s*=\s*(?:\r?\n\s*)?\{", re.MULTILINE
)

BLOCK_STATS_KEYS = ("hitPoints", "mass", "buoyancy", "impactDamageMult")


def find_matching_brace(s: str, open_idx: int) -> int:
    """Index of `}` that closes `{` at open_idx; respects string literals."""
    depth = 0
    i = open_idx
    n = len(s)
    in_string = False
    escape = False
    while i < n:
        c = s[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c == '"':
            in_string = True
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise LuaParseError(f"unclosed '{{' starting at {open_idx}")


def extract_shared_block_info(lua_path: Path) -> Dict[str, Dict[str, Any]]:
    """
    Parse Data/objects/sharedblockinfo.lua into blockType -> { hitPoints, mass, buoyancy, impactDamageMult }.
    """
    text = lua_path.read_text(encoding="utf-8", errors="replace")
    out: Dict[str, Dict[str, Any]] = {}
    for m in SHARED_BLOCK_START_RE.finditer(text):
        name = m.group(1)
        open_brace = m.end() - 1
        if open_brace < 0 or text[open_brace] != "{":
            continue
        try:
            close = find_matching_brace(text, open_brace)
            chunk = text[open_brace : close + 1]
            table = LuaTableParser(chunk).parse_keyword_or_number()
        except Exception as e:
            raise RuntimeError(f"{lua_path}: block {name!r}: {e}") from e
        if not isinstance(table, dict):
            continue
        slim: Dict[str, Any] = {}
        for k in BLOCK_STATS_KEYS:
            if k in table:
                slim[k] = table[k]
        if slim:
            out[name] = slim
    return out


INGREDIENT_PAIR_RE = re.compile(
    r'ingredient\s*=\s*"([^"]+)"\s*,\s*quantity\s*=\s*(\d+)'
)
NORMAL_PRODUCT_RE = re.compile(r'normalProduct\s*=\s*"([^"]+)"')
QUALITY_PRODUCT_RE = re.compile(r'qualityProduct\s*=\s*"([^"]+)"')
MASTER_CRAFT_PRODUCT_RE = re.compile(r'masterCraftProduct\s*=\s*"([^"]+)"')
CRAFT_QUANTITY_RE = re.compile(r'craftQuantity\s*=\s*(\d+)')
BASE_NAME_RE = re.compile(r'baseName\s*=\s*"([^"]+)"')
DISPLAY_NAME_RE = re.compile(r'displayName\s*=\s*"([^"]+)"')
ICON_TEXTURE_RE = re.compile(r'iconTextureName\s*=\s*"([^"]+)"')


def extract_recipes(lua_path: Path) -> Tuple[Dict[str, List[Dict[str, Any]]], Dict[str, List[Dict[str, Any]]]]:
    """
    Parse recipes.lua: each line with Ingredients + normalProduct becomes one recipe entry.

    Rows also set qualityProduct and masterCraftProduct (often identical to normal for mats;
    weapons use e.g. Revolver / QualityRevolver / MasterCraftRevolver). The same recipe is
    registered under every distinct output internal name so the catalog can show craft info
    for all tiers.

    Also builds recipesByIngredient: one row per recipe set (baseName) per ingredient, with
    display name and icon texture — duplicate ingredient rows (e.g. seven propeller variants)
    are collapsed.
    """
    text = lua_path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    current_base: str | None = None
    current_display: str | None = None
    current_icon: str | None = None
    by_product: Dict[str, List[Dict[str, Any]]] = {}
    by_ingredient: Dict[str, Dict[str, Dict[str, Any]]] = {}

    for line in lines:
        bm = BASE_NAME_RE.search(line)
        if bm:
            current_base = bm.group(1)
        dm = DISPLAY_NAME_RE.search(line)
        if dm:
            current_display = dm.group(1)
        im = ICON_TEXTURE_RE.search(line)
        if im:
            current_icon = im.group(1)
        if "Ingredients" not in line or "normalProduct" not in line:
            continue
        ingredients_raw = [
            {"ingredient": m.group(1), "quantity": int(m.group(2))}
            for m in INGREDIENT_PAIR_RE.finditer(line)
        ]
        nmm = NORMAL_PRODUCT_RE.search(line)
        if not nmm or not ingredients_raw:
            continue
        normal = nmm.group(1)
        qm = QUALITY_PRODUCT_RE.search(line)
        mcm = MASTER_CRAFT_PRODUCT_RE.search(line)
        quality = qm.group(1) if qm else normal
        master = mcm.group(1) if mcm else normal
        output_names = {normal, quality, master}
        cqm = CRAFT_QUANTITY_RE.search(line)
        craft_q = int(cqm.group(1)) if cqm else 1
        entry = {
            "recipeSetBaseName": current_base,
            "recipeSetDisplayName": current_display,
            "craftQuantity": craft_q,
            "ingredients": ingredients_raw,
        }
        for product in output_names:
            by_product.setdefault(product, []).append(entry)

        bb = current_base or ""
        if bb:
            for ing in ingredients_raw:
                inn = ing["ingredient"]
                by_ingredient.setdefault(inn, {})
                if bb in by_ingredient[inn]:
                    continue
                by_ingredient[inn][bb] = {
                    "recipeSetBaseName": current_base,
                    "recipeSetDisplayName": current_display,
                    "recipeSetIconTexture": current_icon,
                    # First recipe row in file order for this set: use its normal output for catalog tinting.
                    "representativeProduct": normal,
                }

    by_ingredient_out: Dict[str, List[Dict[str, Any]]] = {}
    for ing, bases in by_ingredient.items():
        rows = sorted(
            bases.values(),
            key=lambda e: (
                str(e.get("recipeSetDisplayName") or ""),
                str(e.get("recipeSetBaseName") or ""),
            ),
        )
        by_ingredient_out[ing] = rows

    return by_product, by_ingredient_out


def enrich_recipes_display_names(
    by_product: Dict[str, List[Dict[str, Any]]],
    items: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """Add displayName per ingredient using craftingitems ItemList."""
    name_to_display: Dict[str, str] = {}
    for it in items:
        n = it.get("name")
        if not isinstance(n, str) or not n:
            continue
        inv = it.get("inventorySetupInfo")
        if isinstance(inv, dict):
            dn = inv.get("itemDisplayName")
            if isinstance(dn, str) and dn.strip():
                name_to_display[n] = dn.strip()
                continue
        name_to_display[n] = n

    out: Dict[str, List[Dict[str, Any]]] = {}
    for prod, recipes in by_product.items():
        new_recipes: List[Dict[str, Any]] = []
        for r in recipes:
            new_ing: List[Dict[str, Any]] = []
            for ing in r["ingredients"]:
                inn = ing["ingredient"]
                new_ing.append(
                    {
                        "name": inn,
                        "quantity": ing["quantity"],
                        "displayName": name_to_display.get(inn, inn),
                    }
                )
            new_recipes.append(
                {
                    "recipeSetBaseName": r.get("recipeSetBaseName"),
                    "recipeSetDisplayName": r.get("recipeSetDisplayName"),
                    "craftQuantity": r["craftQuantity"],
                    "ingredients": new_ing,
                }
            )
        out[prod] = new_recipes
    return out


def extract_items(lua_path: Path) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    with lua_path.open("r", encoding="utf-8", errors="replace") as f:
        for lineno, line in enumerate(f, 1):
            if not LINE_RE.match(line):
                continue
            try:
                items.append(parse_item_line(line))
            except Exception as e:
                raise RuntimeError(f"{lua_path}:{lineno}: {e}") from e
    return items


def strip_placeable_max_load(items: List[Dict[str, Any]]) -> None:
    """Omit `maxLoad` from exported `placeableSetupInfo` (not shown in the item catalog)."""
    for it in items:
        p = it.get("placeableSetupInfo")
        if isinstance(p, dict):
            p.pop("maxLoad", None)


def normalize_icon_path(lua_path: str) -> str:
    """Turn ../Data/... into Data/... relative to game root."""
    p = lua_path.replace("\\", "/").strip()
    while p.startswith("../"):
        p = p[3:]
    return p.lstrip("/")


def try_dds_to_png(dds: Path, png: Path) -> bool:
    """Convert DDS to PNG using the first method that works."""
    png.parent.mkdir(parents=True, exist_ok=True)
    try:
        import imageio.v3 as iio  # type: ignore

        arr = iio.imread(dds)
        # DDS icon rows are bottom-up in this asset set.
        arr = arr[::-1, ...]
        iio.imwrite(png, arr)
        return png.is_file()
    except Exception:
        pass
    try:
        from PIL import Image  # type: ignore

        im = Image.open(dds)
        im = im.transpose(Image.FLIP_TOP_BOTTOM)
        im.save(png)
        return png.is_file()
    except Exception:
        pass
    for exe in ("magick", "convert"):
        try:
            subprocess.run(
                [exe, str(dds), "-flip", str(png)],
                check=True,
                capture_output=True,
                timeout=60,
            )
            if png.is_file():
                return True
        except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
            continue
    return False


def build_icon_map(
    items: List[Dict[str, Any]],
    game_root: Path,
    icons_out: Path,
    export_png: bool,
    extra_normalized_paths: Optional[List[str]] = None,
) -> Dict[str, str]:
    """
    Map normalized icon path -> URL path for the viewer (relative to `public/`).
    If export_png, creates PNG files under icons_out and maps to basename only (e.g. deadbeef.png);
    else maps to ../../Data/...
    extra_normalized_paths: e.g. recipe set icons from recipes.lua not used by any item icon.
    """
    unique: Dict[str, None] = {}
    for it in items:
        inv = it.get("inventorySetupInfo")
        if not isinstance(inv, dict):
            continue
        p = inv.get("inventoryIconFile")
        if isinstance(p, str) and p.strip():
            unique[normalize_icon_path(p)] = None
    if extra_normalized_paths:
        for ep in extra_normalized_paths:
            if isinstance(ep, str) and ep.strip():
                unique[ep] = None

    icon_map: Dict[str, str] = {}
    for norm in unique:
        if export_png:
            dds = game_root / norm.replace("/", "\\") if sys.platform == "win32" else game_root / norm
            if not dds.is_file():
                continue
            h = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]
            png_name = f"{h}.png"
            png_path = icons_out / png_name
            if not png_path.is_file():
                try_dds_to_png(dds, png_path)
            if png_path.is_file():
                icon_map[norm] = png_name
        else:
            # Relative URL when HTTP server root = game_root: /Data/...
            icon_map[norm] = f"../../{norm}"

    return icon_map


def pack_icon_atlas(
    public_dir: Path,
    staging_dir: Path,
    icon_map: Dict[str, str],
    atlas_filename: str = "icons-atlas.png",
    max_width: int = 4096,
) -> Optional[Tuple[Dict[str, str], Dict[str, Any]]]:
    """
    Pack staging_dir/*.png into public_dir/icons-atlas.png; delete staging PNGs on success.
    staging_dir: temp folder with per-hash PNGs from build_icon_map.
    Returns (new_icon_map with values 'atlas:<norm>', iconAtlas payload) or None if packing fails.
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    entries: List[Tuple[str, Path, int, int]] = []
    for norm, rel in icon_map.items():
        if not isinstance(rel, str) or rel.startswith("atlas:"):
            continue
        if "/" in rel:
            continue
        p = staging_dir / rel
        if not p.is_file():
            continue
        try:
            with Image.open(p) as im0:
                w, h = im0.size
        except Exception:
            continue
        entries.append((norm, p, w, h))

    if not entries:
        return None

    # Shelf packing (tallest in row first within each shelf).
    entries.sort(key=lambda t: -t[3])
    placements: Dict[str, Tuple[int, int, int, int]] = {}
    x = 0
    y = 0
    row_h = 0
    max_x = 0
    for norm, _path, w, h in entries:
        if x + w > max_width:
            x = 0
            y += row_h
            row_h = 0
        placements[norm] = (x, y, w, h)
        max_x = max(max_x, x + w)
        row_h = max(row_h, h)
        x += w
    atlas_w = max_x
    atlas_h = y + row_h

    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
    sprites: Dict[str, Dict[str, int]] = {}
    for norm, path, w, h in entries:
        px, py, pw, ph = placements[norm]
        assert (pw, ph) == (w, h)
        im = Image.open(path).convert("RGBA")
        atlas.paste(im, (px, py))
        im.close()
        sprites[norm] = {"x": px, "y": py, "w": pw, "h": ph}

    public_dir.mkdir(parents=True, exist_ok=True)
    atlas_path = public_dir / atlas_filename
    atlas.save(atlas_path, optimize=True)

    for _norm, path, _w, _h in entries:
        try:
            path.unlink()
        except OSError:
            pass

    new_icon_map: Dict[str, str] = {}
    for norm, rel in icon_map.items():
        if norm in sprites:
            new_icon_map[norm] = f"atlas:{norm}"
        else:
            new_icon_map[norm] = rel

    payload: Dict[str, Any] = {
        "image": atlas_filename,
        "sprites": sprites,
    }
    return new_icon_map, payload


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    public_dir = script_dir / "public"
    game_root = script_dir.parent.parent
    crafting = game_root / "Data" / "objects" / "crafting" / "craftingitems.lua"
    recipes_lua = game_root / "Data" / "objects" / "crafting" / "recipes.lua"
    shared_blocks = game_root / "Data" / "objects" / "sharedblockinfo.lua"
    out_path = public_dir / "itemlist.json"
    blocks_out_path = public_dir / "sharedblockinfo.json"

    if not crafting.is_file():
        print(f"error: crafting file not found: {crafting}", file=sys.stderr)
        return 1

    print(f"Reading {crafting} ...")
    items = extract_items(crafting)
    strip_placeable_max_load(items)
    print(f"Parsed {len(items)} items.")

    block_types: Dict[str, Dict[str, Any]] = {}
    if shared_blocks.is_file():
        print(f"Reading {shared_blocks} ...")
        block_types = extract_shared_block_info(shared_blocks)
        print(f"Parsed {len(block_types)} block types (stat subset).")
    else:
        print(f"warning: shared block info not found: {shared_blocks}", file=sys.stderr)

    recipes_by_product: Dict[str, List[Dict[str, Any]]] = {}
    recipes_by_ingredient: Dict[str, List[Dict[str, Any]]] = {}
    recipe_source_rel: str | None = None
    recipe_icon_paths: List[str] = []
    if recipes_lua.is_file():
        print(f"Reading {recipes_lua} ...")
        raw_recipes, recipes_by_ingredient = extract_recipes(recipes_lua)
        recipes_by_product = enrich_recipes_display_names(raw_recipes, items)
        total_entries = sum(len(v) for v in recipes_by_product.values())
        for lst in recipes_by_ingredient.values():
            for e in lst:
                t = e.get("recipeSetIconTexture")
                if isinstance(t, str) and t.strip():
                    recipe_icon_paths.append(normalize_icon_path(t))
        recipe_icon_paths = sorted(set(recipe_icon_paths))
        print(
            f"Parsed {len(recipes_by_product)} product keys, {total_entries} recipe list entries "
            f"(each recipes.lua row may attach to normal, quality, and mastercraft outputs); "
            f"{len(recipes_by_ingredient)} ingredient keys for \"used in\" tooltips."
        )
        try:
            recipe_source_rel = str(recipes_lua.relative_to(game_root))
        except ValueError:
            recipe_source_rel = str(recipes_lua)
    else:
        print(f"warning: recipes file not found: {recipes_lua}", file=sys.stderr)

    print("Building PNG icon cache ...")
    icon_atlas_payload: Optional[Dict[str, Any]] = None
    icon_map: Dict[str, str] = {}
    with tempfile.TemporaryDirectory(prefix="itemlist-icon-staging-") as staging_s:
        staging = Path(staging_s)
        icon_map = build_icon_map(
            items,
            game_root,
            staging,
            export_png=True,
            extra_normalized_paths=recipe_icon_paths,
        )
        print(f"Resolved {len(icon_map)} icons to PNG.")

        packed = pack_icon_atlas(public_dir, staging, icon_map)
        if packed:
            icon_map, icon_atlas_payload = packed
            print(
                f"Packed {len(icon_atlas_payload['sprites'])} sprites into public/{icon_atlas_payload['image']} "
                "(staging PNGs removed)."
            )
        else:
            public_dir.mkdir(parents=True, exist_ok=True)
            for f in staging.glob("*.png"):
                shutil.copy2(f, public_dir / f.name)
            print(
                "Atlas pack skipped (Pillow missing or no icons); copied per-hash PNGs into public/."
            )

    try:
        source_rel = str(crafting.relative_to(game_root))
    except ValueError:
        source_rel = str(crafting)

    payload: Dict[str, Any] = {
        "source": source_rel,
        "recipeSource": recipe_source_rel,
        "gameRootHint": str(game_root),
        "itemCount": len(items),
        "iconMap": icon_map,
        "ItemList": items,
        "recipesByProduct": recipes_by_product,
        "recipesByIngredient": recipes_by_ingredient,
    }
    if icon_atlas_payload is not None:
        payload["iconAtlas"] = icon_atlas_payload

    out_path.parent.mkdir(parents=True, exist_ok=True)
    # Minify to reduce size; optionally also emit a gzipped variant for faster transfer.
    out_json_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    out_path.write_text(out_json_text, encoding="utf-8")

    # Write `itemlist.json.gz` alongside `itemlist.json` so the browser can load fewer bytes.
    try:
        import gzip

        gz_path = out_path.with_name(out_path.name + ".gz")
        gz_path.write_bytes(gzip.compress(out_json_text.encode("utf-8"), compresslevel=9))
        print(f"Wrote {out_path} and {gz_path} (gzip).")
    except Exception:
        print(f"Wrote {out_path}")

    try:
        blocks_source_rel = (
            str(shared_blocks.relative_to(game_root)) if shared_blocks.is_file() else None
        )
    except ValueError:
        blocks_source_rel = str(shared_blocks)
    blocks_payload = {
        "source": blocks_source_rel,
        "gameRootHint": str(game_root),
        "blockTypeCount": len(block_types),
        "blockTypes": block_types,
    }
    blocks_json_text = json.dumps(
        blocks_payload, ensure_ascii=False, separators=(",", ":")
    )
    blocks_out_path.write_text(blocks_json_text, encoding="utf-8")
    try:
        import gzip

        gz_blocks_path = blocks_out_path.with_name(blocks_out_path.name + ".gz")
        gz_blocks_path.write_bytes(
            gzip.compress(blocks_json_text.encode("utf-8"), compresslevel=9)
        )
        print(f"Wrote {blocks_out_path} and {gz_blocks_path} (gzip).")
    except Exception:
        print(f"Wrote {blocks_out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
