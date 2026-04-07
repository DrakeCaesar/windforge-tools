#!/usr/bin/env python3
"""
Extract ItemList from Data/objects/crafting/craftingitems.lua into `public/catalog.json`
(and `public/catalog.json.gz`), including a packed PNG atlas at `public/icons-atlas.png`
of unique inventory DDS icons.

The JSON payload has two top-level keys: `itemlist` (items, recipes, icon map, atlas) and
`sharedblockinfo` (block stats from sharedblockinfo.lua — hitPoints, mass, buoyancy,
impactDamageMult per block type).

Requires Python 3.10+, Pillow, and imageio (`pip install -r requirements.txt`). The script exits
immediately with an error if anything is missing.

Parses Data/objects/crafting/recipes.lua into recipesByProduct (ingredients to craft an item)
and recipesByIngredient (recipe sets that use an item as an ingredient, one row per set).

All emitted catalog assets live under `public/` so Vite serves them in dev and copies them to `dist/`.

Run from anywhere: python extract_itemlist.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

LuaValue = Union[None, bool, int, float, str, Dict[str, Any], List[Any]]

_REQ_FAIL = """\
======================================================================
extract_itemlist.py — requirement not satisfied
======================================================================
{detail}
----------------------------------------------------------------------
Install dependencies from the same directory as this script:

  pip install -r requirements.txt

(Use the same Python you use to run this script, e.g. py -3.12 -m pip …)
======================================================================
"""


def _die_requirements(detail: str) -> None:
    print(_REQ_FAIL.format(detail=detail), file=sys.stderr)
    raise SystemExit(1)


def check_runtime_requirements() -> None:
    """Fail fast with a clear message if the environment cannot run the full pipeline."""
    if sys.version_info < (3, 10):
        _die_requirements(
            f"This script requires Python 3.10 or newer (you have {sys.version.split()[0]})."
        )
    try:
        import imageio.v3 as _imageio_v3  # noqa: F401
    except ImportError as e:
        _die_requirements(f'Missing package "imageio" ({e}).')
    try:
        import PIL.Image  # noqa: F401
    except ImportError as e:
        _die_requirements(f'Missing package "Pillow" ({e}).')


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


def parse_recipe_sets(recipes_lua: Path) -> List[Dict[str, Any]]:
    """recipes.lua: baseName, startLocked, craftTools."""
    sets: List[Dict[str, Any]] = []
    current: Optional[Dict[str, Any]] = None
    for raw in recipes_lua.read_text(encoding="utf-8", errors="replace").splitlines():
        bm = re.match(r'^\s*baseName = "([^"]+)"', raw)
        if bm:
            if current and current.get("baseName"):
                sets.append(current)
            current = {"baseName": bm.group(1), "startLocked": None, "craftTools": []}
            continue
        if current is None:
            continue
        sl = re.match(r"^\s*startLocked = (true|false)", raw)
        if sl:
            current["startLocked"] = sl.group(1) == "true"
            continue
        ct = re.match(r"^\s*craftTools = \{(.*)\}", raw)
        if ct:
            current["craftTools"] = re.findall(r'"([^"]+)"', ct.group(1))
    if current and current.get("baseName"):
        sets.append(current)
    return sets


def parse_recipe_books(crafting_items_lua: Path) -> List[Dict[str, Any]]:
    """craftingitems.lua: one-line RecipeItem rows."""
    books: List[Dict[str, Any]] = []
    for raw in crafting_items_lua.read_text(encoding="utf-8", errors="replace").splitlines():
        if 'objectType = "RecipeItem"' not in raw:
            continue
        name_m = re.search(r'\{\s*name = "([^"]+)"', raw)
        rn_m = re.search(r'recipeItemSetupInfo = \{\s*recipeName = "([^"]+)"', raw)
        st_m = re.search(r'storeItemType = "([^"]+)"', raw)
        if not name_m or not rn_m:
            continue
        books.append(
            {
                "itemName": name_m.group(1),
                "recipeName": rn_m.group(1),
                "storeItemType": st_m.group(1) if st_m else None,
            }
        )
    return books


def parse_merchants(data_dir: Path, data_root: Path) -> Dict[str, List[str]]:
    """NPC merchants: storeItemType -> town names."""
    npc_root = data_dir / "objects" / "characters" / "npc"
    if not npc_root.is_dir():
        return {}
    out: Dict[str, set[str]] = {}
    for p in npc_root.rglob("*.lua"):
        if "merchant" not in p.name.lower():
            continue
        parts = p.parts
        town = "unknown"
        try:
            idx = parts.index("npc")
            if idx + 1 < len(parts):
                town = parts[idx + 1]
        except ValueError:
            pass
        body = p.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r'storeItemType\s*=\s*"([^"]+)"', body):
            t = m.group(1)
            out.setdefault(t, set()).add(town)
    return {k: sorted(v) for k, v in out.items()}


def parse_unlock_recipes(data_dir: Path, data_root: Path) -> Dict[str, List[Dict[str, str]]]:
    """UnlockRecipe(\"X\") references across all lua files under Data."""
    by_recipe: Dict[str, List[Dict[str, str]]] = {}
    for p in data_dir.rglob("*.lua"):
        rel = str(p.relative_to(data_root)).replace("\\", "/")
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
            for m in re.finditer(r'UnlockRecipe\s*\(\s*"([^"]+)"', line):
                by_recipe.setdefault(m.group(1), []).append(
                    {"file": rel, "line": line.strip()[:200]}
                )
    return by_recipe


def parse_chapter3_quests_robust(chapter3_lua: Path) -> List[Dict[str, str]]:
    out: List[Dict[str, str]] = []
    text = chapter3_lua.read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"\n(?=[A-Za-z_][A-Za-z0-9_]*\s*=\s*\{)", text)
    for block in blocks:
        name_m = re.match(r"^([A-Za-z0-9_]+)\s*=", block)
        if not name_m:
            continue
        quest_key = name_m.group(1)
        if not quest_key.startswith("Chapter3"):
            continue
        if "itemsToFetch" not in block:
            continue
        tab = re.search(r'itemName = "([^"]+)"', block)
        lm = re.search(r'inProgressMapLandmark = "([^"]+)"', block)
        if tab and lm:
            out.append(
                {
                    "questKey": quest_key,
                    "tabletItem": tab.group(1),
                    "landmark": lm.group(1),
                }
            )
    return out


def parse_tablet_payment_unlocks(data_dir: Path, data_root: Path) -> List[Dict[str, Any]]:
    events = data_dir / "eventscripts"
    if not events.is_dir():
        return []
    result: List[Dict[str, Any]] = []
    for p in events.rglob("*.lua"):
        low = p.name.lower()
        if "paymentfor" not in low:
            continue
        body = p.read_text(encoding="utf-8", errors="replace")
        unlocks = [m.group(1) for m in re.finditer(r'UnlockRecipe\s*\(\s*"([^"]+)"', body)]
        remove_m = re.search(r'RemoveItem\s*\(\s*"([^"]+)"', body)
        if unlocks or remove_m:
            result.append(
                {
                    "script": str(p.relative_to(data_root)).replace("\\", "/"),
                    "removeItem": remove_m.group(1) if remove_m else None,
                    "unlockRecipes": unlocks,
                }
            )
    return result


def parse_worldmap_temples(worldmap_lua: Path) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    lines = worldmap_lua.read_text(encoding="utf-8", errors="replace").splitlines()
    for i, line in enumerate(lines):
        am = re.search(r'areaName = "([^"]+)"', line)
        if not am or "Temple" not in am.group(1):
            continue
        display_name: Optional[str] = None
        area_file: Optional[str] = None
        for j in range(i + 1, min(i + 25, len(lines))):
            dm = re.search(r'displayName = "([^"]+)"', lines[j])
            fm = re.search(r'areaFile = "([^"]+)"', lines[j])
            if dm:
                display_name = dm.group(1)
            if fm:
                area_file = fm.group(1).replace("../", "").replace("\\", "/")
        rows.append(
            {
                "areaName": am.group(1),
                "displayName": display_name or "(no displayName in data)",
                "areaFile": area_file or "",
            }
        )
    return rows


def parse_loot_recipe_book_hints(loot_lua: Path) -> List[Dict[str, Any]]:
    hints: List[Dict[str, Any]] = []
    criteria: Optional[str] = None
    for line in loot_lua.read_text(encoding="utf-8", errors="replace").splitlines():
        c = re.search(r"criteria = \{([^}]*)\}", line)
        if c:
            criteria = c.group(1).strip()
            continue
        if "TypeBasedSelectSpawner" in line and "storeItemType" in line:
            st = re.search(r'storeItemType = "([^"]+)"', line)
            w = re.search(r"weight = ([0-9.]+)", line)
            if st:
                hints.append(
                    {
                        "storeItemType": st.group(1),
                        "weight": float(w.group(1)) if w else None,
                        "criteria": criteria or "(see previous criteria in file)",
                    }
                )
    return hints


def build_recipe_sources_payload(
    data_root: Path,
    data_dir: Path,
    recipes_lua: Path,
    crafting_items_lua: Path,
) -> Dict[str, Any]:
    """Build payload equivalent to extract-recipe-sources.mjs."""
    recipe_sets = parse_recipe_sets(recipes_lua)
    recipe_books = parse_recipe_books(crafting_items_lua)
    merchants_by_store_type = parse_merchants(data_dir, data_root)
    unlock_by_recipe = parse_unlock_recipes(data_dir, data_root)

    chapter3_path = data_dir / "quests" / "Chapter3Quests.lua"
    worldmap_path = data_dir / "areas" / "worldmap.lua"
    loot_path = data_dir / "quests" / "lootspawnconfig.lua"

    chapter3_tablets = (
        parse_chapter3_quests_robust(chapter3_path) if chapter3_path.is_file() else []
    )
    tablet_payments = parse_tablet_payment_unlocks(data_dir, data_root)
    worldmap_temples = parse_worldmap_temples(worldmap_path) if worldmap_path.is_file() else []
    loot_hints = parse_loot_recipe_book_hints(loot_path) if loot_path.is_file() else []

    by_recipe: Dict[str, Dict[str, Any]] = {}
    for rs in recipe_sets:
        by_recipe[rs["baseName"]] = {
            "baseName": rs["baseName"],
            "startLocked": rs.get("startLocked"),
            "craftTools": rs.get("craftTools", []),
            "sources": [],
        }

    def add_source(recipe: str, kind: str, detail: Dict[str, Any]) -> None:
        if recipe not in by_recipe:
            by_recipe[recipe] = {
                "baseName": recipe,
                "startLocked": None,
                "craftTools": [],
                "sources": [],
            }
        by_recipe[recipe]["sources"].append({"kind": kind, **detail})

    for rs in recipe_sets:
        if rs.get("startLocked") is False:
            add_source(
                rs["baseName"],
                "default_unlock",
                {"note": "startLocked=false in recipes.lua (available once you have craft tools)"},
            )

    for b in recipe_books:
        towns = merchants_by_store_type.get(str(b.get("storeItemType")), [])
        add_source(
            b["recipeName"],
            "recipe_book_item",
            {
                "bookItem": b["itemName"],
                "storeItemType": b.get("storeItemType"),
                "shopPoolHint": (
                    f'Merchants with storeItemType "{b.get("storeItemType")}" in towns: {", ".join(towns)}'
                    if towns
                    else f'No merchant lua matched storeItemType "{b.get("storeItemType")}" (may still appear via loot or engine).'
                ),
            },
        )

    for recipe, refs in unlock_by_recipe.items():
        for r in refs:
            add_source(recipe, "unlock_recipe_script", {"file": r["file"], "snippet": r["line"]})

    for t in chapter3_tablets:
        pay = next((p for p in tablet_payments if p.get("removeItem") == t["tabletItem"]), None)
        for r in (pay.get("unlockRecipes", []) if pay else []):
            add_source(
                r,
                "chapter3_tablet",
                {
                    "tabletItem": t["tabletItem"],
                    "landmark": t["landmark"],
                    "questKey": t["questKey"],
                    "paymentScript": pay.get("script") if pay else None,
                },
            )

    for pay in tablet_payments:
        rm = str(pay.get("removeItem") or "")
        if "Tablet" not in rm:
            continue
        for r in pay.get("unlockRecipes", []):
            exists = any(
                s.get("kind") in ("chapter3_tablet", "secret_tablet")
                for s in by_recipe.get(r, {}).get("sources", [])
            )
            if not exists:
                add_source(
                    r,
                    "tablet_payment_script",
                    {"removeItem": pay.get("removeItem"), "script": pay.get("script")},
                )

    return {
        "summary": {
            "recipeSetCount": len(recipe_sets),
            "recipeBookCount": len(recipe_books),
            "unlockRecipeCallCount": sum(len(v) for v in unlock_by_recipe.values()),
        },
        "worldmapTemples": worldmap_temples,
        "chapter3TabletQuests": chapter3_tablets,
        "tabletPaymentScripts": tablet_payments,
        "merchantsByStoreItemType": merchants_by_store_type,
        "lootTypeBasedSpawners": loot_hints,
        "recipes": by_recipe,
    }


def write_recipe_sources_markdown(payload: Dict[str, Any], out_md: Path) -> None:
    md = "# Recipe source hints (generated)\n\n"
    md += f"Generated: {payload.get('generated')}\n\n"
    md += "## Limits\n\n"
    md += "- **Shops** are inferred from merchant `storeItemType` pools (random book within type), not guaranteed item→vendor.\n"
    md += "- **Loot** lists `TypeBasedSelectSpawner` rows from `lootspawnconfig.lua` (random book in category + criteria).\n"
    md += "- **UnlockRecipe** entries point to scripts; read files for quest context.\n\n"

    md += "## Chapter 3 tablet quests (landmarks)\n\n"
    md += "| Quest | Tablet | Landmark |\n| --- | --- | --- |\n"
    for t in payload.get("chapter3TabletQuests", []):
        md += f"| {t.get('questKey','')} | {t.get('tabletItem','')} | {t.get('landmark','')} |\n"
    md += "\n"

    md += "## Recipe books by recipe (from craftingitems RecipeItem)\n\n"
    by_rn: Dict[str, List[Dict[str, Any]]] = {}
    for recipe_name, row in payload.get("recipes", {}).items():
        for s in row.get("sources", []):
            if s.get("kind") != "recipe_book_item":
                continue
            by_rn.setdefault(recipe_name, []).append(s)
    for name in sorted(by_rn):
        md += f"### {name}\n"
        for b in by_rn[name]:
            md += f"- **{b.get('bookItem')}** — storeItemType `{b.get('storeItemType')}`\n"
        md += "\n"
    out_md.write_text(md, encoding="utf-8")


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


def try_dds_to_png(dds: Path, png: Path) -> None:
    """Convert DDS to PNG using imageio, then Pillow. Raises RuntimeError if conversion fails."""
    import imageio.v3 as iio
    from PIL import Image

    png.parent.mkdir(parents=True, exist_ok=True)
    err_io: Optional[BaseException] = None
    try:
        arr = iio.imread(dds)
        # DDS icon rows are bottom-up in this asset set.
        arr = arr[::-1, ...]
        iio.imwrite(png, arr)
        if png.is_file():
            return
    except BaseException as e:
        err_io = e
    try:
        im = Image.open(dds)
        im = im.transpose(Image.FLIP_TOP_BOTTOM)
        im.save(png)
        if png.is_file():
            return
    except Exception as e:
        if err_io is not None:
            raise RuntimeError(
                f"DDS→PNG failed for {dds}\n  imageio: {err_io}\n  Pillow: {e}"
            ) from e
        raise RuntimeError(f"DDS→PNG failed for {dds} (Pillow): {e}") from e
    raise RuntimeError(
        f"DDS→PNG produced no PNG for {dds} (imageio had: {err_io!r}; Pillow wrote nothing)"
    )


def build_icon_map(
    items: List[Dict[str, Any]],
    data_root: Path,
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
            dds = data_root / norm.replace("/", "\\") if sys.platform == "win32" else data_root / norm
            if not dds.is_file():
                continue
            h = hashlib.sha256(norm.encode("utf-8")).hexdigest()[:16]
            png_name = f"{h}.png"
            png_path = icons_out / png_name
            if not png_path.is_file():
                try_dds_to_png(dds, png_path)
            if not png_path.is_file():
                raise RuntimeError(f"Missing PNG after DDS conversion: {png_path} (from {dds})")
            icon_map[norm] = png_name
        else:
            # Relative URL when HTTP server root = data_root: /Data/... (or /Data1/...)
            icon_map[norm] = f"../../{norm}"

    return icon_map


def _shelf_alcove_pack(
    packed_entries: List[Tuple[str, Path, int, int]], max_width: int
) -> Tuple[Dict[str, Tuple[int, int, int, int]], int, int]:
    """
    Shelf rows in global order (tallest first, same as plain shelf), first sprite of each
    row flush left. Icons to the right use extra vertical space under the row height:
    sub-rows wrap at max_width so mid/short icons stack beside a tall leader instead of
    leaving a dead band.

    Returns (placements norm -> (x, y, w, h), atlas_width, atlas_height).
    """
    ordered = sorted(packed_entries, key=lambda t: -t[3])
    placements: Dict[str, Tuple[int, int, int, int]] = {}
    max_x_used = 0
    i = 0
    n = len(ordered)
    y_base = 0

    while i < n:
        norm, _path, w, h = ordered[i]
        px, py = 0, y_base
        placements[norm] = (px, py, w, h)
        max_x_used = max(max_x_used, px + w)
        row_h = h
        first_w = w
        i += 1

        sub_x = first_w
        sub_y = y_base
        sub_line_h = 0

        while i < n:
            norm, _path, w, h = ordered[i]
            if sub_y + h > y_base + row_h:
                break
            if sub_x + w > max_width:
                if sub_line_h == 0:
                    break
                sub_x = first_w
                sub_y += sub_line_h
                sub_line_h = 0
                continue
            placements[norm] = (sub_x, sub_y, w, h)
            max_x_used = max(max_x_used, sub_x + w)
            sub_x += w
            sub_line_h = max(sub_line_h, h)
            i += 1

        y_base += row_h

    return placements, max_x_used, y_base


def _shelf_alcove_atlas_size(
    packed_entries: List[Tuple[str, Path, int, int]], max_width: int
) -> Tuple[int, int]:
    """Simulate shelf+alcove packing; return (atlas_width, atlas_height)."""
    _pl, aw, ah = _shelf_alcove_pack(packed_entries, max_width)
    return aw, ah


def _best_max_width_for_squareish(
    packed_entries: List[Tuple[str, Path, int, int]],
    w_min: int = 256,
    w_max: int = 4096,
    step: int = 32,
) -> int:
    """
    Pick a max atlas width so the packed bbox is close to square.
    """
    if not packed_entries:
        return w_max
    max_sprite_w = max(w for _n, _p, w, _h in packed_entries)
    lo = max(w_min, min(max_sprite_w, w_max))
    best_mw = w_max
    best_ratio = float("inf")
    mw = lo
    while mw <= w_max:
        aw, ah = _shelf_alcove_atlas_size(packed_entries, mw)
        if ah <= 0:
            mw += step
            continue
        ratio = max(aw / ah, ah / aw)
        if ratio < best_ratio:
            best_ratio = ratio
            best_mw = mw
        mw += step
    return best_mw


def pack_icon_atlas(
    public_dir: Path,
    staging_dir: Path,
    icon_map: Dict[str, str],
    atlas_filename: str = "icons-atlas.png",
    max_width: Optional[int] = None,
) -> Optional[Tuple[Dict[str, str], Dict[str, Any]]]:
    """
    Pack staging_dir/*.png into public_dir/icons-atlas.png; delete staging PNGs on success.
    staging_dir: temp folder with per-hash PNGs from build_icon_map.
    If max_width is None, a width in [256, 4096] is chosen to keep the atlas bbox close to square.
    Packing is shelf-style (tallest-first row order) with sub-rows in the band to the right of
    each row's first icon so mixed heights do not leave a blank strip beside a tall sprite.
    Returns (new_icon_map, iconAtlas payload) or None if there are no icon PNGs to pack.
    """
    from PIL import Image

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
        except Exception as e:
            raise RuntimeError(f"Cannot read icon PNG for atlas: {p}") from e
        entries.append((norm, p, w, h))

    if not entries:
        return None

    if max_width is None:
        max_width = _best_max_width_for_squareish(entries)
        aw, ah = _shelf_alcove_atlas_size(entries, max_width)
        print(
            f"Icon atlas: shelf max width {max_width}px -> {aw}x{ah} (~square layout)."
        )

    placements, atlas_w, atlas_h = _shelf_alcove_pack(entries, max_width)

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
    check_runtime_requirements()

    script_dir = Path(__file__).resolve().parent
    public_dir = script_dir / "public"
    data_root = script_dir.parent.parent / "Data1"
    crafting = data_root / "objects" / "crafting" / "craftingitems.lua"
    recipes_lua = data_root / "objects" / "crafting" / "recipes.lua"
    shared_blocks = data_root / "objects" / "sharedblockinfo.lua"
    catalog_path = public_dir / "catalog.json"
    catalog_pretty_path = public_dir / "catalog.json"

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
            recipe_source_rel = str(recipes_lua.relative_to(data_root.parent))
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
            data_root,
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
        elif icon_map:
            print(
                "ERROR: Icon atlas packing failed but icons were exported; "
                "check PNG files in the staging step.",
                file=sys.stderr,
            )
            return 1
        else:
            print("No icons resolved (no DDS files matched); skipping atlas.")

    try:
        source_rel = str(crafting.relative_to(data_root.parent))
    except ValueError:
        source_rel = str(crafting)

    payload: Dict[str, Any] = {
        "source": source_rel,
        "recipeSource": recipe_source_rel,
        "gameRootHint": str(data_root),
        "itemCount": len(items),
        "iconMap": icon_map,
        "ItemList": items,
        "recipesByProduct": recipes_by_product,
        "recipesByIngredient": recipes_by_ingredient,
    }
    if icon_atlas_payload is not None:
        payload["iconAtlas"] = icon_atlas_payload

    try:
        blocks_source_rel = (
            str(shared_blocks.relative_to(data_root.parent)) if shared_blocks.is_file() else None
        )
    except ValueError:
        blocks_source_rel = str(shared_blocks)
    blocks_payload = {
        "source": blocks_source_rel,
        "gameRootHint": str(data_root),
        "blockTypeCount": len(block_types),
        "blockTypes": block_types,
    }

    recipe_sources_payload: Optional[Dict[str, Any]] = None
    if recipes_lua.is_file() and crafting.is_file():
        recipe_sources_payload = build_recipe_sources_payload(
            data_root=data_root,
            data_dir=data_root,
            recipes_lua=recipes_lua,
            crafting_items_lua=crafting,
        )

    catalog_bundle = {
        "itemlist": payload,
        "sharedblockinfo": blocks_payload,
    }
    if recipe_sources_payload is not None:
        catalog_bundle["recipeSources"] = recipe_sources_payload
    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    # Emit both readable and compact catalogs; catalog.json is the readable 2-space variant.
    catalog_pretty_text = json.dumps(catalog_bundle, ensure_ascii=False, indent=2)
    catalog_min_text = json.dumps(catalog_bundle, ensure_ascii=False, separators=(",", ":"))
    catalog_pretty_path.write_text(catalog_pretty_text, encoding="utf-8")
    catalog_path.write_text(catalog_pretty_text, encoding="utf-8")
    gz_path = catalog_path.with_name(catalog_path.name + ".gz")
    gz_path.write_bytes(
        gzip.compress(catalog_min_text.encode("utf-8"), compresslevel=9)
    )
    print(
        f"Wrote {catalog_pretty_path}, {catalog_path}, and {gz_path} (gzip)."
    )

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as e:
        print(f"\nERROR: {e}\n", file=sys.stderr)
        raise SystemExit(1) from e
