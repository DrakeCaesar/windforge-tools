/**
 * Windforge item catalog — loads `public/itemlist.json(.gz)` from extract_itemlist.py
 */

import { createRecipeSortEngine } from "./recipe-sort.js";
import { itemCatalogSortPermutation as SP } from "./sort-permutation-core.js";
import { WindforgeColors } from "./colors.js";

function createSortCacheWorker() {
  return new Worker(new URL("./sort-cache-worker.js", import.meta.url), { type: "module" });
}

/** Throw asynchronously (so promise/image callbacks still crash loudly). */
  function fatal(err) {
    setTimeout(function () {
      throw err instanceof Error ? err : new Error(String(err));
    }, 0);
  }

  /** @type {{ ItemList: object[], iconMap: Record<string,string>, iconAtlas?: { image: string, sprites: Record<string, { x: number, y: number, w: number, h: number }> }, itemCount?: number, source?: string, recipesByProduct?: Record<string, object[]>, recipesByIngredient?: Record<string, object[]>, recipeSource?: string }} */
  let data = { ItemList: [], iconMap: {}, recipesByProduct: {}, recipesByIngredient: {} };
  let recipeSortEngine = createRecipeSortEngine();

  /** Internal item name → item row (for ingredient icons). */
  const itemByName = new Map();

  /** Stable index in `data.ItemList` by internal name (precomputed sort permutations). */
  const itemIndexByName = new Map();

  /** Full-list permutation per (column, asc|desc, secondary mode, wisdom slice). */
  const sortPermCache = new Map();

  /** Bumped on each data load so idle sort-cache work from a previous catalog is ignored. */
  let sortCacheBuildEpoch = 0;

  /**
   * When this matches {@link computeStatsLayoutCacheKey}, column decimals/widths and colgroup
   * are unchanged (order-independent of the filtered list); skip O(cols * n) measureText work.
   */
  let lastStatsLayoutCacheKey = "";

  /** Reused by {@link computeStatColumnWidthsForList} to avoid allocating a canvas every render. */
  let statsMeasureCanvas = null;
  /** @type {CanvasRenderingContext2D|null} */
  let statsMeasureCtx = null;

  /** @type {number|ReturnType<typeof setTimeout>|null} */
  let sortPermCacheIdleId = null;

  /** Parallel workers computing sort permutations (after matrices exist). */
  /** Upper bound on parallel sort-cache workers (hardwareConcurrency is used below). */
  const SORT_CACHE_PERM_WORKER_MAX = 32;
  /** Target permutation jobs per worker (fewer workers ⇒ less payload clone / startup overhead). */
  const SORT_CACHE_JOBS_PER_PERM_WORKER = 10;

  /** @type {Worker[]} */
  let sortCacheWorkers = [];

  /** One-shot worker that only builds price matrices when using multiple perm workers. */
  let sortCacheMatrixWorker = null;

  /** Total permutation keys for the loaded catalog (for debug progress). */
  let sortCacheJobTotalCount = 0;

  /**
   * Bump when sort-column definitions or persist format change so disk cache is ignored.
   */
  const SORT_PERM_PERSIST_SCHEMA = 1;
  const SORT_PERM_IDB_NAME = "windforge-item-catalog";
  const SORT_PERM_IDB_VER = 1;
  const SORT_PERM_STORE = "sortPermCache";

  /** Fingerprint for the current itemlist + recipes + blocks; used as IndexedDB key. */
  let sortPermCacheCatalogId = "";

  /** @type {Promise<IDBDatabase|null>|null} */
  let sortPermDbPromise = null;

  /** @type {ReturnType<typeof setTimeout>|null} */
  let sortPermPersistTimer = null;

  /** From sharedblockinfo.json: blockType string -> { hitPoints, mass, buoyancy, impactDamageMult }. */
  let blockTypes = {};

  /** @type {string} */
  let sortColumn = "display";
  /** @type {'asc'|'desc'} */
  let sortDir = "asc";

  const COLUMNS = SP.COLUMNS;
  const COLUMN_BY_ID = SP.COLUMN_BY_ID;
  const WISDOM_LEVEL_COUNT = SP.WISDOM_LEVEL_COUNT;
  const PRECOMPUTED_WISDOM_SLICE_SET = SP.PRECOMPUTED_WISDOM_SLICE_SET;
  const PRICE_SORT_COLUMN_IDS = SP.PRICE_SORT_COLUMN_IDS;
  const SECONDARY_SORT_INTERNAL_NAME = SP.SECONDARY_SORT_INTERNAL_NAME;
  const SECONDARY_SORT_RECIPE_BASE = SP.SECONDARY_SORT_RECIPE_BASE;

  const MELEE_WEAPON_OBJECT_TYPE = SP.MELEE_WEAPON_OBJECT_TYPE;
  const JACKHAMMER_OBJECT_TYPE = SP.JACKHAMMER_OBJECT_TYPE;
  const RANGED_WEAPON_OBJECT_TYPE = SP.RANGED_WEAPON_OBJECT_TYPE;
  const THROWABLE_WEAPON_OBJECT_TYPE = SP.THROWABLE_WEAPON_OBJECT_TYPE;
  const CLOTHING_ITEM_OBJECT_TYPE = SP.CLOTHING_ITEM_OBJECT_TYPE;
  const PLACE_BLOCK_ITEM_OBJECT_TYPE = SP.PLACE_BLOCK_ITEM_OBJECT_TYPE;
  const GRAPPLING_HOOK_OBJECT_TYPE = SP.GRAPPLING_HOOK_OBJECT_TYPE;
  const PLACE_PROPULSION_OBJECT_ITEM_TYPE = SP.PLACE_PROPULSION_OBJECT_ITEM_TYPE;
  const PLACE_ENGINE_OBJECT_ITEM_TYPE = SP.PLACE_ENGINE_OBJECT_ITEM_TYPE;
  const PLACE_GRINDER_OBJECT_ITEM_TYPE = SP.PLACE_GRINDER_OBJECT_ITEM_TYPE;
  const PLACE_OBJECT_ITEM_TYPE = SP.PLACE_OBJECT_ITEM_TYPE;
  const PLACE_SHIP_SCAFFOLDING_ITEM_TYPE = SP.PLACE_SHIP_SCAFFOLDING_ITEM_TYPE;
  const PLACE_ARTILLERY_SHIP_ITEM_TYPE = SP.PLACE_ARTILLERY_SHIP_ITEM_TYPE;
  const PLACEABLE_SETUP_STAT_TYPE_SET = SP.PLACEABLE_SETUP_STAT_TYPE_SET;

  /** @type {typeof SECONDARY_SORT_INTERNAL_NAME | typeof SECONDARY_SORT_RECIPE_BASE} */
  let secondarySortMode = SECONDARY_SORT_INTERNAL_NAME;
  let wisdomStat = 0;

  const sortBind = SP.createBindings({
    getData: function () {
      return data;
    },
    getBlockTypes: function () {
      return blockTypes;
    },
    getItemByName: function () {
      return itemByName;
    },
    getRecipeSortEngine: function () {
      return recipeSortEngine;
    },
    getWisdomStat: function () {
      return wisdomStat;
    },
  });

  function wisdomSlicesOrderedForJobs(currentWisdom) {
    return sortBind.wisdomSlicesOrderedForJobs(currentWisdom);
  }

  function normalizeSecondarySortMode(v) {
    // Migration: old "nameSuffixWords" mode now maps to recipe-base mode.
    if (v === "nameSuffixWords" || v === SECONDARY_SORT_RECIPE_BASE) {
      return SECONDARY_SORT_RECIPE_BASE;
    }
    return SECONDARY_SORT_INTERNAL_NAME;
  }

  function normalizeWisdomStat(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    const i = Math.floor(n);
    if (i < 0) return 0;
    if (i > 100) return 100;
    return i;
  }

  function syncWisdomFromInput() {
    const el = document.getElementById("wisdom-stat");
    const v = normalizeWisdomStat(el && el.value);
    wisdomStat = v;
    if (el && String(v) !== String(el.value)) {
      el.value = String(v);
    }
    return v;
  }

  /**
   * Store price adjustment (implementation in {@link sort-permutation-core.js}).
   * @param {number} [wisdomOverride] — when omitted, uses {@link wisdomStat}.
   */
  function applyWisdomPriceModifier(base, isSelling, wisdomOverride) {
    return sortBind.applyWisdomPriceModifier(base, isSelling, wisdomOverride);
  }

  const MELEE_STATS_COLUMN_IDS = {
    dmgPhysical: true,
    meleeTimeBetweenAttacks: true,
    meleeAttackRange: true,
    dmgKnockback: true,
  };

  function isMeleeStatsColumnId(id) {
    return !!MELEE_STATS_COLUMN_IDS[id];
  }

  function objectTypeFilterValue() {
    const sel = document.getElementById("filter-object-type");
    return sel ? sel.value : "";
  }

  function showMeleeWeaponStatColumns() {
    const v = objectTypeFilterValue();
    return v === MELEE_WEAPON_OBJECT_TYPE || v === JACKHAMMER_OBJECT_TYPE;
  }

  function itemUsesMeleeWeaponSetupStats(item) {
    return (
      item.objectType === MELEE_WEAPON_OBJECT_TYPE ||
      item.objectType === JACKHAMMER_OBJECT_TYPE
    );
  }

  function showRangedThrowableStatColumns() {
    const v = objectTypeFilterValue();
    return v === RANGED_WEAPON_OBJECT_TYPE || v === THROWABLE_WEAPON_OBJECT_TYPE;
  }

  function showRtChemicalDamageColumn() {
    const v = objectTypeFilterValue();
    return v !== RANGED_WEAPON_OBJECT_TYPE;
  }

  function showClothingStatColumns() {
    return objectTypeFilterValue() === CLOTHING_ITEM_OBJECT_TYPE;
  }

  function isClothingStatColumnDef(def) {
    return !!(def && (def.clothingTraitKey || def.clothingEquipField));
  }

  function isClothingStatColumnId(id) {
    return isClothingStatColumnDef(COLUMN_BY_ID[id]);
  }

  function showPlaceBlockStatColumns() {
    return objectTypeFilterValue() === PLACE_BLOCK_ITEM_OBJECT_TYPE;
  }

  function showPlaceBlockImpactColumn() {
    return false;
  }

  function isPlaceBlockStatColumnDef(def) {
    return !!(def && def.placeBlockStatKey);
  }

  function getPlaceBlockStatsRow(item) {
    const bt = item.blockType;
    const row = blockTypes[bt];
    return row;
  }

  function getPlaceBlockStatSortValue(item, key) {
    const row = getPlaceBlockStatsRow(item);
    if (!row) return null;
    return row[key];
  }

  function placeBlockStatCell(item, key) {
    const row = getPlaceBlockStatsRow(item);
    const v = row ? row[key] : null;
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showGrapplingHookStatColumns() {
    return objectTypeFilterValue() === GRAPPLING_HOOK_OBJECT_TYPE;
  }

  function isGrapplingHookStatColumnDef(def) {
    return !!(def && def.grapplingHookStatKey);
  }

  function getGrapplingHookSetup(item) {
    return item.grapplingHookSetupInfo;
  }

  function getGrapplingHookStatSortValue(item, key) {
    const g = getGrapplingHookSetup(item);
    if (!g) return null;
    return g[key];
  }

  function grapplingHookStatCell(item, key) {
    const g = getGrapplingHookSetup(item);
    const v = g ? g[key] : null;
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showPlaceableSetupStatColumns() {
    return PLACEABLE_SETUP_STAT_TYPE_SET.has(objectTypeFilterValue());
  }

  function showPlaceableBuoyancyColumn() {
    const v = objectTypeFilterValue();
    return (
      v !== PLACE_ENGINE_OBJECT_ITEM_TYPE &&
      v !== PLACE_GRINDER_OBJECT_ITEM_TYPE &&
      v !== PLACE_OBJECT_ITEM_TYPE &&
      v !== PLACE_SHIP_SCAFFOLDING_ITEM_TYPE
    );
  }

  function isPlaceableSetupStatColumnDef(def) {
    return !!(def && def.placeableSetupStatKey);
  }

  function getPlaceableSetupStatSortValue(item, key) {
    if (item.objectType === PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return getPlaceBlockStatSortValue(item, key);
    }
    const p = item.placeableSetupInfo;
    if (!p) return null;
    return p[key];
  }

  function placeableSetupStatCell(item, key) {
    if (item.objectType === PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return placeBlockStatCell(item, key);
    }
    const v = getPlaceableSetupStatSortValue(item, key);
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showPropulsionPlaceItemStatColumns() {
    return objectTypeFilterValue() === PLACE_PROPULSION_OBJECT_ITEM_TYPE;
  }

  function isPropulsionPlaceItemStatColumnDef(def) {
    return !!(def && def.propulsionSetupKey);
  }

  function getPropulsionPlaceItemStatSortValue(item, def) {
    const p = item.propulsionSetupInfo;
    if (!p) return null;
    return p[def.propulsionSetupKey];
  }

  function propulsionPlaceItemStatCell(item, def) {
    const v = getPropulsionPlaceItemStatSortValue(item, def);
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showEnginePlaceItemStatColumns() {
    return objectTypeFilterValue() === PLACE_ENGINE_OBJECT_ITEM_TYPE;
  }

  function isEnginePlaceItemStatColumnDef(def) {
    return !!(def && def.engineSetupKey);
  }

  function getEnginePlaceItemStatSortValue(item, def) {
    const e = item.engineSetupInfo;
    if (!e) return null;
    return e[def.engineSetupKey];
  }

  function enginePlaceItemStatCell(item, def) {
    const v = getEnginePlaceItemStatSortValue(item, def);
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showGrinderPlaceItemStatColumns() {
    return objectTypeFilterValue() === PLACE_GRINDER_OBJECT_ITEM_TYPE;
  }

  function isGrinderPlaceItemStatColumnDef(def) {
    return !!(def && def.grinderSetupKey);
  }

  function getGrinderPlaceItemStatSortValue(item, def) {
    const g = item.grinderSetupInfo;
    if (!g) return null;
    return g[def.grinderSetupKey];
  }

  function grinderPlaceItemStatCell(item, def) {
    const v = getGrinderPlaceItemStatSortValue(item, def);
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showArtilleryShipItemStatColumns() {
    return objectTypeFilterValue() === PLACE_ARTILLERY_SHIP_ITEM_TYPE;
  }

  function isArtilleryShipItemStatColumnDef(def) {
    return !!(def && (def.artilleryWeaponKey || def.artilleryDamageKey));
  }

  function getArtilleryPlaceableWeapon(item) {
    return item.placeableWeaponSetupInfo;
  }

  function getArtilleryDamageDesc(item) {
    const w = getArtilleryPlaceableWeapon(item);
    if (!w) return null;
    const g = w.grenadeSetupInfo;
    if (!g || g.damageDesc == null) return null;
    return g.damageDesc;
  }

  function getArtilleryShipItemStatSortValue(item, def) {
    if (def.artilleryWeaponKey) {
      const w = getArtilleryPlaceableWeapon(item);
      if (!w) return null;
      return w[def.artilleryWeaponKey];
    }
    if (def.artilleryDamageKey) {
      const d = getArtilleryDamageDesc(item);
      if (!d) return null;
      return d[def.artilleryDamageKey];
    }
    return null;
  }

  function artilleryShipItemStatCell(item, def) {
    const v = getArtilleryShipItemStatSortValue(item, def);
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function getClothingEquipSetup(item) {
    return item.equipSetupInfo;
  }

  function clothingTraitRawString(equip, key) {
    if (!equip || !equip.characterTraits) return "";
    const t = equip.characterTraits;
    const v = t[key];
    if (v == null) return "";
    return typeof v === "string" ? v : String(v);
  }

  function clothingTraitNumberForSort(equip, key) {
    const s = clothingTraitRawString(equip, key);
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  function getClothingStatSortValue(item, colDef) {
    const e = getClothingEquipSetup(item);
    if (!e) return null;
    if (colDef.clothingEquipField) {
      return e[colDef.clothingEquipField];
    }
    if (colDef.clothingTraitKey) {
      return clothingTraitNumberForSort(e, colDef.clothingTraitKey);
    }
    return null;
  }

  /** Non-clothing rows get ""; 0-like trait values render empty (like weapon stat cells). */
  function clothingStatCell(item, colDef) {
    const e = getClothingEquipSetup(item);
    if (!e) {
      return formatCatalogStatNumber(null, { hideZero: true });
    }
    if (colDef.clothingEquipField) {
      const v = e[colDef.clothingEquipField];
      return formatCatalogStatNumber(v, { hideZero: true });
    }
    if (colDef.clothingTraitKey) {
      const s = clothingTraitRawString(e, colDef.clothingTraitKey);
      const n = parseFloat(s);
      if (!Number.isNaN(n)) {
        return formatCatalogStatNumber(n, { hideZero: true });
      }
      return s;
    }
    throw new Error("Bad clothing column def");
  }

  /** @returns {object|null} */
  function getRangedOrThrowableDamageDesc(item) {
    if (item.objectType === RANGED_WEAPON_OBJECT_TYPE) {
      const r = item.rangedWeaponSetupInfo;
      if (!r || r.damageDesc == null) return null;
      return r.damageDesc;
    }
    if (item.objectType === THROWABLE_WEAPON_OBJECT_TYPE) {
      const t = item.throwableItemSetupInfo;
      const g = t && t.grenadeSetupInfo;
      if (!g || g.damageDesc == null) return null;
      return g.damageDesc;
    }
    return null;
  }

  /** RangedWeapon / ThrowableWeapon damage field: 0 renders empty (like melee). */
  function rtDamageNumberCell(item, key) {
    const d = getRangedOrThrowableDamageDesc(item);
    const v = d ? d[key] : null;
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  /**
   * Integer pixel widths for paired <colgroup> (header + body) with `table-layout: fixed`.
   * No fractional scaling — values are whole px so layout stays pixel-aligned.
   */
  const COL_PX_PRICE = 66;
  const COL_PX_STAT = 72;

  const COLUMN_WIDTH_PX = {
    icon: 72,
    display: 288,
    name: 288,
    objectType: 192,
    buy: COL_PX_PRICE,
    sell: COL_PX_PRICE,
    componentSell: COL_PX_PRICE,
    profit: COL_PX_PRICE,
    description: 384,
    dmgPhysical: COL_PX_STAT,
    meleeTimeBetweenAttacks: COL_PX_STAT,
    meleeAttackRange: COL_PX_STAT,
    dmgKnockback: COL_PX_STAT,
    rtPhysicalDamage: COL_PX_STAT,
    rtElementalDamage: COL_PX_STAT,
    rtChemicalDamage: COL_PX_STAT,
    rtKnockbackMagnitude: COL_PX_STAT,
    clothAirDrain: COL_PX_STAT,
    clothTraitWeight: COL_PX_STAT,
    clothTraitHealth: COL_PX_STAT,
    clothTraitStrength: COL_PX_STAT,
    clothTraitAgility: COL_PX_STAT,
    clothTraitIntelligence: COL_PX_STAT,
    clothTraitArmour: COL_PX_STAT,
    clothTraitElemRes: COL_PX_STAT,
    clothTraitChemRes: COL_PX_STAT,
    clothTraitFallRes: COL_PX_STAT,
    clothTraitBuoyancy: COL_PX_STAT,
    clothTraitRegen: COL_PX_STAT,
    pbImpactDmgMult: COL_PX_STAT,
    ghLatchRange: COL_PX_STAT,
    ghThrowRange: COL_PX_STAT,
    plMass: COL_PX_STAT,
    plBuoyancy: COL_PX_STAT,
    plHitPoints: COL_PX_STAT,
    ppoMaxForce: COL_PX_STAT,
    ppoResponsiveness: COL_PX_STAT,
    peAvailableEnergy: COL_PX_STAT,
    pgDamagePerChop: COL_PX_STAT,
    pgMinChopDelay: COL_PX_STAT,
    pgMaxChopDelay: COL_PX_STAT,
    paMinShot: COL_PX_STAT,
    paMaxShot: COL_PX_STAT,
    paMaxProjSpeed: COL_PX_STAT,
    paPhysDmg: COL_PX_STAT,
    paKnockback: COL_PX_STAT,
    json: 48,
  };

  const STORAGE_KEY = "windforge-item-catalog-ui-v1";

  /**
   * Tinted icon bitmaps as data URLs, keyed by source PNG + colour names.
   * Infinite in-memory cache only: no cap, no eviction, no disk/sessionStorage — cleared on page unload.
   */
  const tintedIconDataUrlCache = new Map();

  /**
   * Non-tinted sprites as data URLs (same key as {@link iconUrlFor} / atlas refs).
   * Infinite in-memory cache only; UI never assigns file URLs to {@code <img>} once this is warm.
   */
  const rawIconDataUrlCache = new Map();

  /**
   * In-flight dedupe for the one-time network decode per URL (then pixels live in the Maps above).
   */
  const imageLoadPromises = new Map();

  /** Keep one live <img> per item so virtualized row remounts don't recreate image resources. */
  const liveIconNodeByItemName = new Map();

  /** Estimated row height used before we measure individual rows. */
  let ROW_HEIGHT = 59;
  const VIRTUAL_OVERSCAN = 12;
  let rowHeightSynced = false;

  // Variable-height virtual scrolling:
  // - We render only a window of rows.
  // - Spacer heights are computed from measured row heights + an estimate for unknown rows.
  let rowHeights = null; // Array<number> (length = virtualList.length)
  let prefixHeights = null; // Array<number> (length = virtualList.length + 1)
  let virtualHeightsDirty = true;
  let heightAutoRerenders = 0;
  let virtualPadTop = 0;
  let virtualPadBottom = 0;

  /** Filtered + sorted list for the current table; virtual scroll reads from this. */
  let virtualList = [];
  let statColumnDecimalsById = Object.create(null);
  let statColumnWidthPxById = Object.create(null);
  let virtualScrollRaf = null;
  let virtualScrollAttached = false;
  let virtualResizeAttached = false;
  let virtualResizeTimer = null;
  let virtualDocumentWheelAttached = false;

  /** Pre-unification column ids → shared `plMass` / `plBuoyancy` / `plHitPoints` (localStorage migration). */
  const LEGACY_PLACEABLE_SETUP_SORT_COLUMN = {
    pbHitPoints: "plHitPoints",
    pbMass: "plMass",
    pbBuoyancy: "plBuoyancy",
    ppoMass: "plMass",
    ppoBuoyancy: "plBuoyancy",
    ppoHitPoints: "plHitPoints",
    peMass: "plMass",
    peBuoyancy: "plBuoyancy",
    peHitPoints: "plHitPoints",
    pgMass: "plMass",
    pgBuoyancy: "plBuoyancy",
    pgHitPoints: "plHitPoints",
    poMass: "plMass",
    poBuoyancy: "plBuoyancy",
    poHitPoints: "plHitPoints",
    psMass: "plMass",
    psBuoyancy: "plBuoyancy",
    psHitPoints: "plHitPoints",
    paMass: "plMass",
    paBuoyancy: "plBuoyancy",
    paHitPoints: "plHitPoints",
  };

  /**
   * @param {string} id
   * @param {string} [objectTypeFilter] — persisted filter; melee stat sorts only valid for MeleeWeapon
   */
  function normalizeSortColumn(id, objectTypeFilter) {
    const filter = objectTypeFilter != null ? String(objectTypeFilter) : "";
    const mapped = LEGACY_PLACEABLE_SETUP_SORT_COLUMN[id];
    if (mapped) id = mapped;
    if (!id || !COLUMN_BY_ID[id] || !COLUMN_BY_ID[id].sortable) return "display";
    if (
      isMeleeStatsColumnId(id) &&
      filter !== MELEE_WEAPON_OBJECT_TYPE &&
      filter !== JACKHAMMER_OBJECT_TYPE
    ) {
      return "display";
    }
    const def = COLUMN_BY_ID[id];
    if (
      def.rtDamageKey &&
      filter !== RANGED_WEAPON_OBJECT_TYPE &&
      filter !== THROWABLE_WEAPON_OBJECT_TYPE
    ) {
      return "display";
    }
    if (id === "rtChemicalDamage" && filter === RANGED_WEAPON_OBJECT_TYPE) {
      return "display";
    }
    if (isClothingStatColumnDef(def) && filter !== CLOTHING_ITEM_OBJECT_TYPE) {
      return "display";
    }
    if (isPlaceBlockStatColumnDef(def) && filter !== PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return "display";
    }
    if (id === "pbImpactDmgMult" && filter === PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return "display";
    }
    if (isGrapplingHookStatColumnDef(def) && filter !== GRAPPLING_HOOK_OBJECT_TYPE) {
      return "display";
    }
    if (
      isPlaceableSetupStatColumnDef(def) &&
      !PLACEABLE_SETUP_STAT_TYPE_SET.has(filter)
    ) {
      return "display";
    }
    if (
      id === "plBuoyancy" &&
      (filter === PLACE_ENGINE_OBJECT_ITEM_TYPE ||
        filter === PLACE_GRINDER_OBJECT_ITEM_TYPE ||
        filter === PLACE_OBJECT_ITEM_TYPE ||
        filter === PLACE_SHIP_SCAFFOLDING_ITEM_TYPE)
    ) {
      return "display";
    }
    if (
      isPropulsionPlaceItemStatColumnDef(def) &&
      filter !== PLACE_PROPULSION_OBJECT_ITEM_TYPE
    ) {
      return "display";
    }
    if (isEnginePlaceItemStatColumnDef(def) && filter !== PLACE_ENGINE_OBJECT_ITEM_TYPE) {
      return "display";
    }
    if (
      isGrinderPlaceItemStatColumnDef(def) &&
      filter !== PLACE_GRINDER_OBJECT_ITEM_TYPE
    ) {
      return "display";
    }
    if (
      isArtilleryShipItemStatColumnDef(def) &&
      filter !== PLACE_ARTILLERY_SHIP_ITEM_TYPE
    ) {
      return "display";
    }
    return id;
  }

  function readPersistedUI() {
      const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const o = parsed && typeof parsed === "object" ? parsed : {};
      return {
        q: typeof o.q === "string" ? o.q : "",
        objectType: typeof o.objectType === "string" ? o.objectType : "",
        sortColumn: normalizeSortColumn(
          o.sortColumn,
          typeof o.objectType === "string" ? o.objectType : ""
        ),
        sortDir: o.sortDir === "desc" ? "desc" : "asc",
        secondarySortMode: normalizeSecondarySortMode(o.secondarySortMode),
      wisdomStat: normalizeWisdomStat(o.wisdomStat),
      hideSpecialItems: o.hideSpecialItems === true,
      showSpecialOnly: o.showSpecialOnly === true,
      hideNormalTier: o.hideNormalTier === true,
      hideQualityTier: o.hideQualityTier === true,
      hideMastercraftTier: o.hideMastercraftTier === true,
    };
  }

  function persistUI() {
      const qEl = document.getElementById("q");
      const sel = document.getElementById("filter-object-type");
    const hideSpecialEl = document.getElementById("hide-special-items");
    const specialOnlyEl = document.getElementById("show-special-only");
    const wisdomEl = document.getElementById("wisdom-stat");
    const hideNormalTierEl = document.getElementById("hide-normal-tier");
    const hideQualityTierEl = document.getElementById("hide-quality-tier");
    const hideMastercraftTierEl = document.getElementById("hide-mastercraft-tier");
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          q: qEl ? qEl.value : "",
          objectType: sel ? sel.value : "",
          sortColumn: sortColumn,
          sortDir: sortDir,
          secondarySortMode: secondarySortMode,
        wisdomStat: normalizeWisdomStat(wisdomEl && wisdomEl.value),
        hideSpecialItems: !!(hideSpecialEl && hideSpecialEl.checked),
        showSpecialOnly: !!(specialOnlyEl && specialOnlyEl.checked),
        hideNormalTier: !!(hideNormalTierEl && hideNormalTierEl.checked),
        hideQualityTier: !!(hideQualityTierEl && hideQualityTierEl.checked),
        hideMastercraftTier: !!(hideMastercraftTierEl && hideMastercraftTierEl.checked),
      })
    );
  }

  /** Batched localStorage writes — render() can run often while typing. */
  let persistTimer = null;
  function schedulePersistUI() {
    if (persistTimer != null) clearTimeout(persistTimer);
    persistTimer = setTimeout(function () {
      persistTimer = null;
      persistUI();
    }, 150);
  }

  const SEARCH_DEBOUNCE_MS = 10;
  let searchDebounceTimer = null;
  let wisdomRenderRaf = null;

  function scheduleRenderFromSearch() {
    if (searchDebounceTimer != null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function () {
      searchDebounceTimer = null;
      render();
    }, SEARCH_DEBOUNCE_MS);
  }

  function scheduleRenderFromWisdom() {
    if (wisdomRenderRaf != null) cancelAnimationFrame(wisdomRenderRaf);
    wisdomRenderRaf = requestAnimationFrame(function () {
      wisdomRenderRaf = null;
      const needsResort =
        sortColumn === "buy" ||
        sortColumn === "sell" ||
        sortColumn === "componentSell" ||
        sortColumn === "profit";
      if (needsResort) {
        render();
      } else {
        // Wisdom only changes price-derived cells; keep current order and just repaint visible rows.
        renderVirtualBody();
        schedulePersistUI();
      }
    });
  }

  function normalizeIconPath(luaPath) {
    let p = luaPath.replace(/\\/g, "/").trim();
    while (p.startsWith("../")) p = p.slice(3);
    return p.replace(/^\//, "");
  }

  /** True when `inventoryIconFile` resolves to UnknownIcon.dds (not player-obtainable). */
  function itemUsesUnknownIcon(item) {
    const inv = item.inventorySetupInfo;
    const raw = inv.inventoryIconFile;
    const base = normalizeIconPath(raw).split("/").pop();
    return base.toLowerCase() === "unknownicon.dds";
  }

  function itemNameContainsDebug(item) {
    const n = String(item.name).toLowerCase();
    const d = displayName(item).toLowerCase();
    const needles = ["debug", "test"];
    return needles.some(function (needle) {
      return n.includes(needle) || d.includes(needle);
    });
  }

  /** Paratrooper red torso clothing: icon Torso_Paratrooper.dds + (IconRed1/IconRed2). */
  function itemIsParatrooperRedClothing(item) {
    const inv = item.inventorySetupInfo;
    const name = String((item && item.name) || "").toUpperCase();
    if (name.includes("SOC")) return false;
    const raw = inv.inventoryIconFile;
    const base = normalizeIconPath(raw).split("/").pop();
    if (base.toLowerCase() !== "torso_paratrooper.dds") return false;
    const a = inv.iconPrimaryColor;
    const b = inv.iconSecondaryColor;
    return a.trim() === "IconRed1" && b.trim() === "IconRed2";
  }

  /** Exclude PunchGrey (White/GrayCloth) from special-items filtering. */
  function itemIsExcludedPunchGreyCombo(item) {
    const inv = item.inventorySetupInfo;
    const raw = inv.inventoryIconFile;
    const base = normalizeIconPath(raw).split("/").pop();
    if (base.toLowerCase() !== "punchgrey.dds") return false;
    const a = inv.iconPrimaryColor.trim().toLowerCase();
    const b = inv.iconSecondaryColor.trim().toLowerCase();
    return a === "white" && b === "graycloth";
  }

  function itemIsSpecialOnly(item) {
    return (
      itemIsExcludedPunchGreyCombo(item) ||
      itemUsesUnknownIcon(item) ||
      itemNameContainsDebug(item) ||
      itemIsParatrooperRedClothing(item)
    );
  }

  /**
   * Special-items filter:
   * - If "show only" is checked, show only special items.
   * - Else if "hide" is checked, hide special items.
   * - Else show all items.
   */
  function passesSpecialFilters(item) {
    const hideCb = document.getElementById("hide-special-items");
    const showCb = document.getElementById("show-special-only");
    const hideSpecial = !!(hideCb && hideCb.checked);
    const showOnlySpecial = !!(showCb && showCb.checked);

    // Precedence: "show only" wins.
    if (showOnlySpecial) return itemIsSpecialOnly(item);
    if (hideSpecial) return !itemIsSpecialOnly(item);
    return true;
  }

  function getCraftTierInfo(itemName) {
    const n = String(itemName || "");
    if (n.startsWith("MasterCraft") && n.length > "MasterCraft".length) {
      return { tier: "mastercraft", base: n.slice("MasterCraft".length) };
    }
    if (n.startsWith("Quality") && n.length > "Quality".length) {
      return { tier: "quality", base: n.slice("Quality".length) };
    }
    return { tier: "normal", base: n };
  }

  function itemHasAnyRecipe(item) {
    const rs = data.recipesByProduct[item.name];
    return Array.isArray(rs) && rs.length > 0;
  }

  function itemHasDistinctThreeTierFamily(item) {
    const ti = getCraftTierInfo(item.name);
    const base = ti.base;
    const names = [base, "Quality" + base, "MasterCraft" + base];
    if (new Set(names).size !== 3) return false;
    return itemByName.has(names[0]) && itemByName.has(names[1]) && itemByName.has(names[2]);
  }

  function passesTierVariantFilters(item) {
    if (!itemHasAnyRecipe(item)) return true;
    if (!itemHasDistinctThreeTierFamily(item)) return true;

    const hideNormalEl = document.getElementById("hide-normal-tier");
    const hideQualityEl = document.getElementById("hide-quality-tier");
    const hideMasterEl = document.getElementById("hide-mastercraft-tier");
    const hideNormal = !!(hideNormalEl && hideNormalEl.checked);
    const hideQuality = !!(hideQualityEl && hideQualityEl.checked);
    const hideMaster = !!(hideMasterEl && hideMasterEl.checked);

    const tier = getCraftTierInfo(item.name).tier;
    if (tier === "normal") return !hideNormal;
    if (tier === "quality") return !hideQuality;
    return !hideMaster;
  }

  function iconUrlFor(item) {
    const inv = item.inventorySetupInfo;
    const raw = inv.inventoryIconFile;
    const norm = normalizeIconPath(raw);
    const mapped = data.iconMap[norm];
    if (mapped) return mapped;
    return "../../" + norm;
  }

  /** Resolved PNG URL for a recipes.lua `iconTextureName` (recipe set icon). */
  function recipeSetIconUrl(entry) {
    const raw = entry && entry.recipeSetIconTexture;
    if (!raw || typeof raw !== "string") return null;
    const norm = normalizeIconPath(raw);
    const mapped = data.iconMap[norm];
    if (mapped) return mapped;
    return "../../" + norm;
  }

  /** PNG path (basename under `public/`) or packed atlas sprite ref (`atlas:Data/…`). */
  function isRasterIconRef(url) {
    return Boolean(url && (/\.png$/i.test(url) || url.indexOf("atlas:") === 0));
  }

  /** Loads recipe-set PNG into {@link rawIconDataUrlCache} on demand if not already decoded. */
  async function appendRecipeSetIconFallback(iconWrap, row) {
    const url = recipeSetIconUrl(row);
    if (isRasterIconRef(url)) {
      let cached = rawIconDataUrlCache.get(url);
      if (!cached) {
        try {
          await preloadRawRecipeIconUrl(url);
          cached = rawIconDataUrlCache.get(url);
        } catch (e) {
          cached = null;
        }
      }
      if (!cached) {
        iconWrap.textContent = "—";
        return;
      }
      const im = document.createElement("img");
      im.className = "recipe-tooltip__icon-img";
      im.alt = "";
      im.loading = "eager";
      im.src = cached;
      iconWrap.appendChild(im);
    } else {
      iconWrap.textContent = "—";
    }
  }

  function displayName(item) {
    return sortBind.displayName(item);
  }

  /** @type {HTMLElement | null} */
  let recipeTooltipEl = null;
  /** @type {HTMLElement | null} */
  let recipeTooltipSubEl = null;
  /** @type {HTMLElement | null} */
  let recipeTooltipDeepEl = null;

  /** Async fill invalidation per flyout layer (0 = main, 1 = sub, 2 = deep). */
  const recipeTooltipLayerShowToken = [0, 0, 0];

  /** @type {HTMLElement | null} */
  let recipeTooltipNestedAnchor1 = null;
  /** @type {HTMLElement | null} */
  let recipeTooltipNestedAnchor2 = null;

  /** @type {ReturnType<typeof setTimeout> | null} */
  let recipeNestedFlyoutHideTimer = null;

  function recipeTooltipFlyoutRoots() {
    return [recipeTooltipEl, recipeTooltipSubEl, recipeTooltipDeepEl].filter(Boolean);
  }

  function closestRecipeTooltipFlyout(el) {
    return el && typeof el.closest === "function" ? el.closest(".recipe-tooltip") : null;
  }

  function itemHasRecipeFlyoutData(item) {
    if (!item || !item.name) return false;
    const recipes = data.recipesByProduct[item.name];
    const usedIn = data.recipesByIngredient[item.name];
    return (
      (recipes && recipes.length > 0) || (usedIn && usedIn.length > 0)
    );
  }

  function canvasToDataUrlFromImage(img) {
    // Accept HTMLImageElement, HTMLCanvasElement, and other drawImage-compatible sources.
    const w = img && (img.naturalWidth || img.width);
    const h = img && (img.naturalHeight || img.height);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  }

  /**
   * One-time decode from network (or atlas file) into an {@link HTMLImageElement} for processing.
   * Callers copy pixels into {@link rawIconDataUrlCache} / {@link tintedIconDataUrlCache}; displayed
   * {@code <img>} uses only those data URLs, not this URL string.
   * @param {string} url same string as {@link iconUrlFor} returns, or `atlas:<norm>` for packed sprites
   * @returns {Promise<HTMLImageElement>}
   */
  function loadImageForUrl(url) {
    if (imageLoadPromises.has(url)) {
      return imageLoadPromises.get(url);
    }
    if (url.indexOf("atlas:") === 0) {
      const norm = url.slice(6);
      const p = new Promise(function (resolve, reject) {
        const atlas = data.iconAtlas;
        const rect = atlas.sprites[norm];
        loadImageForUrl(atlas.image).then(
          function (atlasImg) {
            const c = document.createElement("canvas");
            c.width = rect.w;
            c.height = rect.h;
            const ctx = c.getContext("2d");
            ctx.drawImage(
              atlasImg,
              rect.x,
              rect.y,
              rect.w,
              rect.h,
              0,
              0,
              rect.w,
              rect.h
            );
            // Return the sliced canvas directly.
            // This avoids creating/decoding a data: URL per sprite (which causes the gaps you’re seeing).
            resolve(c);
          },
          reject
        );
      });
      p.catch(function () {
        imageLoadPromises.delete(url);
      });
      imageLoadPromises.set(url, p);
      return p;
    }
    const p = new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () {
        resolve(img);
      };
      img.onerror = function () {
        imageLoadPromises.delete(url);
        reject(new Error("icon load: " + url));
      };
      img.src = url;
    });
    imageLoadPromises.set(url, p);
    return p;
  }

  /** Parent flyout used to place nested tooltips to the right (or left) of the whole panel. */
  function parentRecipeFlyoutForNestedLayer(layerEl) {
    if (layerEl === recipeTooltipSubEl) return recipeTooltipEl;
    if (layerEl === recipeTooltipDeepEl) return recipeTooltipSubEl;
    return null;
  }

  function positionRecipeTooltipLayer(
    layerEl,
    clientX,
    clientY,
    anchorEl,
    zIndexCss
  ) {
    if (!layerEl) return;
    const margin = 8;
    const iconGap = -1;
    const nestedPanelGap = 6;
    const minH = 160;
    let anchor =
      anchorEl != null
        ? anchorEl
        : layerEl === recipeTooltipEl
          ? recipeTooltipAnchorTarget
          : null;
    if (
      (!anchor || !anchor.isConnected || typeof anchor.getBoundingClientRect !== "function") &&
      Number.isFinite(clientX) &&
      Number.isFinite(clientY) &&
      layerEl === recipeTooltipEl
    ) {
      const resolved = getRecipeHoverTargetAtPoint(clientX, clientY);
      if (resolved) {
        anchor = resolved;
        recipeTooltipAnchorTarget = resolved;
      }
    }
    const anchorRect =
      anchor &&
      anchor.isConnected &&
      typeof anchor.getBoundingClientRect === "function"
        ? anchor.getBoundingClientRect()
        : null;
    const parentPanel = parentRecipeFlyoutForNestedLayer(layerEl);
    const parentRect0 =
      parentPanel &&
      !parentPanel.hidden &&
      parentPanel.isConnected &&
      typeof parentPanel.getBoundingClientRect === "function"
        ? parentPanel.getBoundingClientRect()
        : null;
    /** Main flyout follows the pointer; nested flyouts align to the hovered ingredient icon. */
    const refY =
      layerEl !== recipeTooltipEl && anchorRect
        ? anchorRect.top + anchorRect.height / 2
        : clientY;
    const below = window.innerHeight - margin - refY;
    const above = refY - margin;
    const placeBelow = below >= minH || below >= above;
    const maxH = Math.max(minH, placeBelow ? below : above);
    layerEl.style.maxHeight = Math.floor(maxH) + "px";
    layerEl.style.position = "fixed";
    let initialX;
    if (layerEl !== recipeTooltipEl && parentRect0) {
      initialX = parentRect0.right + nestedPanelGap;
    } else {
      initialX = anchorRect ? anchorRect.right + iconGap : clientX;
    }
    layerEl.style.left = initialX + "px";
    layerEl.style.top = (placeBelow ? refY : refY - maxH) + "px";
    layerEl.style.zIndex = zIndexCss;
    requestAnimationFrame(function () {
      if (layerEl.hidden) return;
      const r = layerEl.getBoundingClientRect();
      if (
        (!anchor || !anchor.isConnected || typeof anchor.getBoundingClientRect !== "function") &&
        Number.isFinite(clientX) &&
        Number.isFinite(clientY) &&
        layerEl === recipeTooltipEl
      ) {
        const resolved = getRecipeHoverTargetAtPoint(clientX, clientY);
        if (resolved) {
          anchor = resolved;
          recipeTooltipAnchorTarget = resolved;
        }
      }
      const ar2 =
        anchor &&
        anchor.isConnected &&
        typeof anchor.getBoundingClientRect === "function"
          ? anchor.getBoundingClientRect()
          : null;
      const parentPanelRaf = parentRecipeFlyoutForNestedLayer(layerEl);
      const pr2 =
        parentPanelRaf &&
        !parentPanelRaf.hidden &&
        parentPanelRaf.isConnected &&
        typeof parentPanelRaf.getBoundingClientRect === "function"
          ? parentPanelRaf.getBoundingClientRect()
          : null;
      let x;
      if (layerEl !== recipeTooltipEl && pr2) {
        x = pr2.right + nestedPanelGap;
        if (x + r.width > window.innerWidth - margin) {
          const left = pr2.left - nestedPanelGap - r.width;
          if (left >= margin) {
            x = left;
          } else {
            x = Math.max(margin, window.innerWidth - r.width - margin);
          }
        }
      } else if (ar2) {
        x = ar2.right + iconGap;
        if (x + r.width > window.innerWidth - margin) {
          const left = ar2.left - iconGap - r.width;
          if (left >= margin) {
            x = left;
          } else {
            x = Math.max(margin, window.innerWidth - r.width - margin);
          }
        }
      } else {
        x = clientX;
        if (x + r.width > window.innerWidth - margin) {
          x = Math.max(margin, window.innerWidth - r.width - margin);
        }
      }
      let refY2 = clientY;
      if (layerEl !== recipeTooltipEl && ar2) {
        refY2 = ar2.top + ar2.height / 2;
      }
      let y = placeBelow ? refY2 : refY2 - r.height;
      const firstIconEl = layerEl.querySelector(".recipe-tooltip__ing-icon");
      if (firstIconEl && typeof firstIconEl.getBoundingClientRect === "function") {
        const firstIconRect = firstIconEl.getBoundingClientRect();
        const firstIconCenterOffset = firstIconRect.top - r.top + firstIconRect.height / 2;
        y = refY2 - firstIconCenterOffset;
      }
      if (y + r.height > window.innerHeight - margin) {
        y = Math.max(margin, window.innerHeight - r.height - margin);
      }
      if (x < margin) x = margin;
      if (y < margin) y = margin;
      layerEl.style.left = x + "px";
      layerEl.style.top = y + "px";
    });
  }

  function positionRecipeTooltip(clientX, clientY, anchorEl) {
    positionRecipeTooltipLayer(
      recipeTooltipEl,
      clientX,
      clientY,
      anchorEl,
      "10000"
    );
  }

  function cancelNestedFlyoutHideDeferred() {
    if (recipeNestedFlyoutHideTimer != null) {
      clearTimeout(recipeNestedFlyoutHideTimer);
      recipeNestedFlyoutHideTimer = null;
    }
  }

  /**
   * @param {1|2} firstLayerToHide — 1 = sub + deep; 2 = deep only
   */
  function hideNestedFlyoutsFrom(firstLayerToHide) {
    if (firstLayerToHide <= 1) {
      recipeTooltipLayerShowToken[1]++;
      recipeTooltipLayerShowToken[2]++;
      if (recipeTooltipDeepEl) {
        recipeTooltipDeepEl.hidden = true;
        recipeTooltipDeepEl.innerHTML = "";
        recipeTooltipDeepEl.scrollTop = 0;
      }
      if (recipeTooltipSubEl) {
        recipeTooltipSubEl.hidden = true;
        recipeTooltipSubEl.innerHTML = "";
        recipeTooltipSubEl.scrollTop = 0;
      }
      recipeTooltipNestedAnchor1 = null;
      recipeTooltipNestedAnchor2 = null;
      return;
    }
    if (firstLayerToHide <= 2) {
      recipeTooltipLayerShowToken[2]++;
      if (recipeTooltipDeepEl) {
        recipeTooltipDeepEl.hidden = true;
        recipeTooltipDeepEl.innerHTML = "";
        recipeTooltipDeepEl.scrollTop = 0;
      }
      recipeTooltipNestedAnchor2 = null;
    }
  }

  function hideNestedRecipeFlyouts() {
    hideNestedFlyoutsFrom(1);
  }

  function hideRecipeTooltip() {
    cancelRecipeTooltipHideDeferred();
    cancelNestedFlyoutHideDeferred();
    recipeTooltipShowToken++;
    recipeTooltipEl.hidden = true;
    recipeTooltipEl.classList.remove("recipe-tooltip--pinned");
    recipeTooltipEl.innerHTML = "";
    recipeTooltipEl.scrollTop = 0;
    hideNestedRecipeFlyouts();
    recipeTooltipScrollArmed = false;
    recipeTooltipPinned = false;
    recipeTooltipPinnedTarget = null;
    recipeTooltipAnchorTarget = null;
  }

  let recipeTooltipScrollArmed = false;
  let recipeTooltipPinned = false;
  let recipeTooltipPinnedTarget = null;
  let recipeTooltipAnchorTarget = null;
  let recipeTooltipShowToken = 0;
  let lastPointerClientX = null;
  let lastPointerClientY = null;
  let recipeTooltipHideTimer = null;
  const recipeHoverItemByTarget = new WeakMap();

  const RECIPE_TOOLTIP_HIDE_DELAY_MS = 50;

  function pointInExpandedRect(rect, px, py, inflate) {
    const m = inflate || 0;
    return (
      px >= rect.left - m &&
      px <= rect.right + m &&
      py >= rect.top - m &&
      py <= rect.bottom + m
    );
  }

  function pointerInBridgeBetweenRects(ar, tr, clientX, clientY, inflate) {
    if (!ar || !tr) return false;
    if (ar.right < tr.left) {
      if (clientX >= ar.right - inflate && clientX <= tr.left + inflate) {
        const yTop = Math.min(ar.top, tr.top) - inflate;
        const yBot = Math.max(ar.bottom, tr.bottom) + inflate;
        if (clientY >= yTop && clientY <= yBot) return true;
      }
    } else if (tr.right < ar.left) {
      if (clientX >= tr.right - inflate && clientX <= ar.left + inflate) {
        const yTop = Math.min(ar.top, tr.top) - inflate;
        const yBot = Math.max(ar.bottom, tr.bottom) + inflate;
        if (clientY >= yTop && clientY <= yBot) return true;
      }
    }
    return false;
  }

  function isPointerOverRecipeTooltipZone(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const inflate = 8;
    const roots = recipeTooltipFlyoutRoots();
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      if (!el || el.hidden) continue;
      const tr = el.getBoundingClientRect();
      if (pointInExpandedRect(tr, clientX, clientY, inflate)) return true;
    }

    if (recipeTooltipEl && !recipeTooltipEl.hidden) {
      const anchor = recipeTooltipAnchorTarget;
      if (anchor && anchor.isConnected) {
        const ar = anchor.getBoundingClientRect();
        const tr = recipeTooltipEl.getBoundingClientRect();
        if (pointInExpandedRect(ar, clientX, clientY, inflate)) return true;
        if (pointerInBridgeBetweenRects(ar, tr, clientX, clientY, inflate)) return true;
      }
    }

    if (
      recipeTooltipEl &&
      !recipeTooltipEl.hidden &&
      recipeTooltipSubEl &&
      !recipeTooltipSubEl.hidden
    ) {
      const pr = recipeTooltipEl.getBoundingClientRect();
      const sr = recipeTooltipSubEl.getBoundingClientRect();
      if (pointerInBridgeBetweenRects(pr, sr, clientX, clientY, inflate)) return true;
    }

    if (
      recipeTooltipSubEl &&
      !recipeTooltipSubEl.hidden &&
      recipeTooltipDeepEl &&
      !recipeTooltipDeepEl.hidden
    ) {
      const pr = recipeTooltipSubEl.getBoundingClientRect();
      const dr = recipeTooltipDeepEl.getBoundingClientRect();
      if (pointerInBridgeBetweenRects(pr, dr, clientX, clientY, inflate)) return true;
    }

    return false;
  }

  function shouldKeepRecipeTooltipOpen() {
    const x = lastPointerClientX;
    const y = lastPointerClientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (isPointerOverRecipeTooltipZone(x, y)) return true;
    const el = document.elementFromPoint(x, y);
    if (el && typeof el.closest === "function" && el.closest(".recipe-tooltip")) {
      return true;
    }
    if (el && typeof el.closest === "function" && el.closest("[data-recipe-hover-bound='1']")) {
      return true;
    }
    return false;
  }

  function cancelRecipeTooltipHideDeferred() {
    if (recipeTooltipHideTimer != null) {
      clearTimeout(recipeTooltipHideTimer);
      recipeTooltipHideTimer = null;
    }
  }

  function scheduleRecipeTooltipHideDeferred() {
    if (recipeTooltipPinned) return;
    cancelRecipeTooltipHideDeferred();
    recipeTooltipHideTimer = setTimeout(function () {
      recipeTooltipHideTimer = null;
      if (recipeTooltipPinned) return;
      if (recipeTooltipEl.hidden) return;
      if (shouldKeepRecipeTooltipOpen()) return;
      hideRecipeTooltip();
    }, RECIPE_TOOLTIP_HIDE_DELAY_MS);
  }

  function getRecipeHoverTargetAtPoint(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (typeof document.elementsFromPoint === "function") {
      const stack = document.elementsFromPoint(x, y);
      for (let i = 0; i < stack.length; i++) {
        const el = stack[i];
        if (!el || typeof el.closest !== "function") continue;
        const hit = el.closest("[data-recipe-hover-bound='1']");
        if (hit) return hit;
      }
      return null;
    }
    const el = document.elementFromPoint(x, y);
    if (!el || typeof el.closest !== "function") return null;
    return el.closest("[data-recipe-hover-bound='1']");
  }

  function showRecipeTooltipAtPointer(targetEl, clientX, clientY) {
    const item = recipeHoverItemByTarget.get(targetEl);
    if (!item) return;
    cancelRecipeTooltipHideDeferred();
    cancelNestedFlyoutHideDeferred();
    hideNestedRecipeFlyouts();
    recipeTooltipAnchorTarget = targetEl || null;
    const token = ++recipeTooltipShowToken;
    void (async function () {
      await fillRecipeTooltip(item);
      if (token !== recipeTooltipShowToken) return;
      positionRecipeTooltip(clientX, clientY, targetEl);
      resetRecipeFlyoutScrollAfterContentChange(recipeTooltipEl);
    })();
  }

  function pinRecipeTooltip(targetEl) {
    if (recipeTooltipEl.hidden) return;
    recipeTooltipPinned = true;
    recipeTooltipScrollArmed = true;
    recipeTooltipPinnedTarget = targetEl || null;
    recipeTooltipEl.classList.add("recipe-tooltip--pinned");
  }

  function unpinRecipeTooltip() {
    recipeTooltipPinned = false;
    recipeTooltipScrollArmed = false;
    recipeTooltipPinnedTarget = null;
    recipeTooltipEl.classList.remove("recipe-tooltip--pinned");
  }

  function scrollToItemInCurrentView(itemName) {
    if (!virtualList || virtualList.length === 0) return false;
    let idx = -1;
    for (let i = 0; i < virtualList.length; i++) {
      const it = virtualList[i];
      if (it && it.name === itemName) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return false;
    const wrap = getBodyScrollPort();
    if (!wrap) return false;
    if (!prefixHeights || virtualHeightsDirty || !rowHeights || rowHeights.length !== virtualList.length) {
      renderVirtualBody();
    }
    const rowTop = prefixHeights ? prefixHeights[idx] : idx * ROW_HEIGHT;
    const rowH =
      rowHeights && Number.isFinite(rowHeights[idx]) && rowHeights[idx] > 0
        ? rowHeights[idx]
        : ROW_HEIGHT;
    const wrapRect = wrap.getBoundingClientRect();
    const anchorY =
      Number.isFinite(lastPointerClientY) && lastPointerClientY != null
        ? Math.max(0, Math.min(wrap.clientHeight - 1, lastPointerClientY - wrapRect.top))
        : Math.max(0, Math.floor(wrap.clientHeight * 0.5));

    // Add temporary virtual overscroll so edge rows can still align to the anchor Y.
    const desiredNoPad = rowTop + rowH * 0.5 - anchorY;
    const contentTotal = prefixHeights ? prefixHeights[virtualList.length] : 0;
    const maxNoPad = Math.max(0, contentTotal - wrap.clientHeight);
    virtualPadTop = Math.max(0, -desiredNoPad);
    virtualPadBottom = Math.max(0, desiredNoPad - maxNoPad);
    // Short-list correction: ensure desired anchored scroll is reachable.
    const desiredWithPadPre = virtualPadTop + rowTop + rowH * 0.5 - anchorY;
    const maxWithPadPre = Math.max(
      0,
      virtualPadTop + virtualPadBottom + contentTotal - wrap.clientHeight
    );
    if (desiredWithPadPre > maxWithPadPre) {
      virtualPadBottom += desiredWithPadPre - maxWithPadPre;
    }
    renderVirtualBody();

    const desiredWithPad = virtualPadTop + rowTop + rowH * 0.5 - anchorY;
    wrap.scrollTop = Math.max(0, desiredWithPad);
    renderVirtualBody();
    requestAnimationFrame(function () {
      const wrapNow = getBodyScrollPort();
      if (!wrapNow) return;
      function alignRowCenter(attempt) {
        const rowEl = document.querySelector("tr.v-row[data-v-index='" + String(idx) + "']");
        if (!rowEl) return;
        const wRect = wrapNow.getBoundingClientRect();
        const rRect = rowEl.getBoundingClientRect();
        const rowCenterY = rRect.top - wRect.top + rRect.height * 0.5;
        const err = anchorY - rowCenterY;
        if (Math.abs(err) < 1) return;

        const maxNow = Math.max(0, wrapNow.scrollHeight - wrapNow.clientHeight);
        const targetNow = Math.max(0, Math.min(maxNow, wrapNow.scrollTop - err));
        const clamped = Math.abs(targetNow - (wrapNow.scrollTop - err)) > 0.5;

        if (clamped && attempt < 2) {
          if (err < 0) {
            virtualPadBottom += -err;
          } else {
            virtualPadTop += err;
          }
          renderVirtualBody();
          requestAnimationFrame(function () {
            alignRowCenter(attempt + 1);
          });
          return;
        }

        if (Math.abs(wrapNow.scrollTop - targetNow) >= 1) {
          wrapNow.scrollTop = targetNow;
          renderVirtualBody();
        }
      }
      alignRowCenter(0);
    });
    return true;
  }

  function navigateToTooltipItem(itemName) {
    const target = itemByName.get(itemName);
    if (!target) return;
    const sel = document.getElementById("filter-object-type");
    const qEl = document.getElementById("q");
    const currentType = sel ? sel.value : "";
    const targetType = target.objectType || "";
    const allTypes = !currentType;
    let needsRender = false;

    if (sel && !allTypes && currentType !== targetType) {
      sel.value = targetType;
      syncObjectTypeDropdownPanel();
      needsRender = true;
    }
    if (qEl) {
      const q = (qEl.value || "").trim();
      if (q && !matchesQuery(target, q)) {
        qEl.value = "";
        needsRender = true;
      }
    }

    if (needsRender) render();
    if (!scrollToItemInCurrentView(itemName)) {
      if (qEl && (qEl.value || "").trim() !== "") {
        qEl.value = "";
        render();
        scrollToItemInCurrentView(itemName);
      }
    }
    hideRecipeTooltip();
  }

  function attachRecipeTooltipIcon(iconWrap, item, dataUrl) {
    if (!dataUrl) {
      iconWrap.textContent = "—";
      return;
    }
    const im = document.createElement("img");
    im.className = "item-icon";
    if (item && getTintColorsForItem(item)) {
      im.classList.add("item-icon--tinted");
    }
    im.alt = "";
    im.loading = "eager";
    im.src = dataUrl;
    iconWrap.appendChild(im);
  }

  function scheduleNestedFlyoutHideDeferred() {
    cancelNestedFlyoutHideDeferred();
    recipeNestedFlyoutHideTimer = setTimeout(function () {
      recipeNestedFlyoutHideTimer = null;
      if (recipeTooltipPinned) return;
      if (shouldKeepNestedFlyoutsOpen()) return;
      hideNestedRecipeFlyouts();
    }, RECIPE_TOOLTIP_HIDE_DELAY_MS);
  }

  function shouldKeepNestedFlyoutsOpen() {
    const x = lastPointerClientX;
    const y = lastPointerClientY;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    const roots = recipeTooltipFlyoutRoots();
    for (let i = 0; i < roots.length; i++) {
      const el = roots[i];
      if (!el || el.hidden) continue;
      const tr = el.getBoundingClientRect();
      if (pointInExpandedRect(tr, x, y, 8)) return true;
    }
    const a1 = recipeTooltipNestedAnchor1;
    if (
      a1 &&
      a1.isConnected &&
      typeof a1.getBoundingClientRect === "function" &&
      pointInExpandedRect(a1.getBoundingClientRect(), x, y, 8)
    ) {
      return true;
    }
    const a2 = recipeTooltipNestedAnchor2;
    if (
      a2 &&
      a2.isConnected &&
      typeof a2.getBoundingClientRect === "function" &&
      pointInExpandedRect(a2.getBoundingClientRect(), x, y, 8)
    ) {
      return true;
    }
    const elPt = document.elementFromPoint(x, y);
    if (elPt) {
      for (let j = 0; j < roots.length; j++) {
        const r = roots[j];
        if (r && !r.hidden && r.contains(elPt)) return true;
      }
    }
    if (
      recipeTooltipEl &&
      !recipeTooltipEl.hidden &&
      recipeTooltipSubEl &&
      !recipeTooltipSubEl.hidden
    ) {
      const pr = recipeTooltipEl.getBoundingClientRect();
      const sr = recipeTooltipSubEl.getBoundingClientRect();
      if (pointerInBridgeBetweenRects(pr, sr, x, y, 8)) return true;
    }
    if (
      recipeTooltipSubEl &&
      !recipeTooltipSubEl.hidden &&
      recipeTooltipDeepEl &&
      !recipeTooltipDeepEl.hidden
    ) {
      const pr = recipeTooltipSubEl.getBoundingClientRect();
      const dr = recipeTooltipDeepEl.getBoundingClientRect();
      if (pointerInBridgeBetweenRects(pr, dr, x, y, 8)) return true;
    }
    return false;
  }

  async function showNestedRecipeFlyoutForIcon(
    parentLayerIndex,
    item,
    anchorEl,
    clientX,
    clientY
  ) {
    if (parentLayerIndex < 0 || parentLayerIndex >= 2) return;
    if (!item || !itemHasRecipeFlyoutData(item)) return;
    const targetLayerIndex = parentLayerIndex + 1;
    const layerEl =
      targetLayerIndex === 1 ? recipeTooltipSubEl : recipeTooltipDeepEl;
    if (!layerEl) return;

    cancelNestedFlyoutHideDeferred();
    if (targetLayerIndex === 1) {
      hideNestedFlyoutsFrom(1);
      recipeTooltipNestedAnchor1 = anchorEl;
    } else {
      hideNestedFlyoutsFrom(2);
      recipeTooltipNestedAnchor2 = anchorEl;
    }

    const token = ++recipeTooltipLayerShowToken[targetLayerIndex];
    layerEl.hidden = true;

    const ok = await fillRecipeTooltipInto(layerEl, item, targetLayerIndex);
    if (token !== recipeTooltipLayerShowToken[targetLayerIndex]) return;
    if (!ok) {
      layerEl.hidden = true;
      return;
    }

    layerEl.hidden = false;
    const z = targetLayerIndex === 1 ? "10001" : "10002";
    positionRecipeTooltipLayer(layerEl, clientX, clientY, anchorEl, z);
    resetRecipeFlyoutScrollAfterContentChange(layerEl);
  }

  function maybeWireNestedRecipeIcon(iconWrap, subItem, parentLayerIndex) {
    if (!subItem || parentLayerIndex >= 2) return;
    if (!itemHasRecipeFlyoutData(subItem)) return;
    if (iconWrap.dataset.nestedFlyoutWired === "1") return;
    iconWrap.dataset.nestedFlyoutWired = "1";
    iconWrap.setAttribute("data-nested-recipe", "1");

    iconWrap.addEventListener(
      "mouseenter",
      function (e) {
        lastPointerClientX = e.clientX;
        lastPointerClientY = e.clientY;
        cancelNestedFlyoutHideDeferred();
        void showNestedRecipeFlyoutForIcon(
          parentLayerIndex,
          subItem,
          iconWrap,
          e.clientX,
          e.clientY
        );
      },
      { passive: true }
    );
    iconWrap.addEventListener(
      "mousemove",
      function (e) {
        lastPointerClientX = e.clientX;
        lastPointerClientY = e.clientY;
        const tip =
          parentLayerIndex === 0 ? recipeTooltipSubEl : recipeTooltipDeepEl;
        if (tip && !tip.hidden) {
          cancelNestedFlyoutHideDeferred();
          positionRecipeTooltipLayer(
            tip,
            e.clientX,
            e.clientY,
            iconWrap,
            parentLayerIndex === 0 ? "10001" : "10002"
          );
        }
      },
      { passive: true }
    );
    iconWrap.addEventListener(
      "mouseleave",
      function (e) {
        if (recipeTooltipPinned) return;
        const rt = e.relatedTarget;
        const nextLayer =
          parentLayerIndex === 0 ? recipeTooltipSubEl : recipeTooltipDeepEl;
        if (rt && nextLayer && nextLayer.contains(rt)) return;
        scheduleNestedFlyoutHideDeferred();
      },
      { passive: true }
    );
  }

  /**
   * Scroll position is reset synchronously when replacing tooltip HTML, but browsers may
   * re-apply an old offset after layout / images (scroll anchoring). Force top after paint.
   */
  function resetRecipeFlyoutScrollAfterContentChange(el) {
    if (!el) return;
    function zero() {
      el.scrollTop = 0;
    }
    zero();
    requestAnimationFrame(function () {
      zero();
      requestAnimationFrame(function () {
        zero();
        requestAnimationFrame(zero);
      });
    });
  }

  /**
   * @param {HTMLElement} containerEl
   * @param {number} layerIndex 0 = main flyout; 1–2 = nested (deeper icons are not wired)
   * @returns {Promise<boolean>} whether any craft/used-in content was rendered
   */
  async function fillRecipeTooltipInto(containerEl, item, layerIndex) {
    const recipes = data.recipesByProduct[item.name];
    const usedIn = data.recipesByIngredient[item.name];
    const hasCraft = recipes && recipes.length > 0;
    const hasUsed = usedIn && usedIn.length > 0;
    if (!hasCraft && !hasUsed) return false;

    containerEl.innerHTML = "";
    containerEl.scrollTop = 0;

    if (hasCraft) {
      const head = document.createElement("div");
      head.className = "recipe-tooltip__head";
      head.textContent = "Craft: " + (displayName(item) || item.name || "");
      containerEl.appendChild(head);

      for (let i = 0; i < recipes.length; i++) {
        const rec = recipes[i];
        if (i > 0) {
          const hr = document.createElement("hr");
          hr.className = "recipe-tooltip__hr";
          containerEl.appendChild(hr);
        }
        const title = document.createElement("div");
        title.className = "recipe-tooltip__title";
        title.appendChild(
          document.createTextNode(
            rec.recipeSetDisplayName || rec.recipeSetBaseName || "Recipe"
          )
        );
        if (rec.craftQuantity != null && rec.craftQuantity !== 1) {
          const out = document.createElement("span");
          out.className = "recipe-tooltip__out";
          out.textContent = " (outputs ×" + rec.craftQuantity + ")";
          title.appendChild(out);
        }
        containerEl.appendChild(title);

        const ul = document.createElement("ul");
        ul.className = "recipe-tooltip__list";
        const ings = rec.ingredients || [];
        const craftIconUrls = await Promise.all(
          ings.map(function (ing) {
            const sub = itemByName.get(ing.name);
            return sub ? ensureIconDataUrlForItem(sub) : Promise.resolve(null);
          })
        );

        for (let j = 0; j < ings.length; j++) {
          const ing = ings[j];
          const li = document.createElement("li");
          li.className = "recipe-tooltip__row";

          const iconWrap = document.createElement("div");
          iconWrap.className = "recipe-tooltip__ing-icon";
          const sub = itemByName.get(ing.name);
          if (sub) {
            const dataUrl = craftIconUrls[j];
            attachRecipeTooltipIcon(iconWrap, sub, dataUrl);
            iconWrap.dataset.itemName = sub.name;
            maybeWireNestedRecipeIcon(iconWrap, sub, layerIndex);
          } else {
            iconWrap.textContent = "?";
          }
          li.appendChild(iconWrap);

          const nameSpan = document.createElement("span");
          nameSpan.className = "recipe-tooltip__ing-name";
          nameSpan.textContent = ing.displayName || ing.name || "";
          li.appendChild(nameSpan);

          const qtySpan = document.createElement("span");
          qtySpan.className = "recipe-tooltip__ing-qty";
          qtySpan.textContent = "×" + (ing.quantity != null ? ing.quantity : "?");
          li.appendChild(qtySpan);

          ul.appendChild(li);
        }
        containerEl.appendChild(ul);
      }
    }

    if (hasUsed) {
      if (hasCraft) {
        const hr = document.createElement("hr");
        hr.className = "recipe-tooltip__hr";
        containerEl.appendChild(hr);
      }
      const subHead = document.createElement("div");
      subHead.className = "recipe-tooltip__head";
      subHead.textContent = "Used in:";
      containerEl.appendChild(subHead);

      const ulUsed = document.createElement("ul");
      ulUsed.className = "recipe-tooltip__list recipe-tooltip__list--used-in";
      const usedInProductsBySetCache = new Map();

      function productsInSetUsingIngredient(baseName, ingredientName) {
        const key = String(baseName || "") + "::" + String(ingredientName || "");
        if (usedInProductsBySetCache.has(key)) {
          return usedInProductsBySetCache.get(key);
        }
        const out = [];
        const byProduct = data.recipesByProduct || {};
        const productNames = Object.keys(byProduct);
        for (let p = 0; p < productNames.length; p++) {
          const prodName = productNames[p];
          const recs = byProduct[prodName];
          if (!Array.isArray(recs)) continue;
          for (let r = 0; r < recs.length; r++) {
            const rec = recs[r];
            if (!rec || rec.recipeSetBaseName !== baseName) continue;
            const ings = rec.ingredients || [];
            for (let i = 0; i < ings.length; i++) {
              const ingName = ings[i] && (ings[i].name || ings[i].ingredient);
              if (ingName === ingredientName) {
                if (!out.includes(prodName)) out.push(prodName);
                break;
              }
            }
          }
        }
        usedInProductsBySetCache.set(key, out);
        return out;
      }

      const usedIconUrls = await Promise.all(
        usedIn.map(function (row) {
          const repItem =
            row.representativeProduct && itemByName.get(row.representativeProduct);
          return repItem ? ensureIconDataUrlForItem(repItem) : Promise.resolve(null);
        })
      );

      for (let u = 0; u < usedIn.length; u++) {
        const row = usedIn[u];
        const li = document.createElement("li");
        li.className = "recipe-tooltip__row recipe-tooltip__row--used-in";

        const iconWrap = document.createElement("div");
        iconWrap.className = "recipe-tooltip__ing-icon";
        const repItem =
          row.representativeProduct && itemByName.get(row.representativeProduct);
        if (repItem) {
          const dataUrl = usedIconUrls[u];
          if (dataUrl) {
            attachRecipeTooltipIcon(iconWrap, repItem, dataUrl);
          } else {
            await appendRecipeSetIconFallback(iconWrap, row);
          }
          iconWrap.dataset.itemName = repItem.name;
          maybeWireNestedRecipeIcon(iconWrap, repItem, layerIndex);
        } else {
          await appendRecipeSetIconFallback(iconWrap, row);
        }
        li.appendChild(iconWrap);

        const nameSpan = document.createElement("span");
        nameSpan.className = "recipe-tooltip__ing-name";
        const matchingProducts = productsInSetUsingIngredient(
          row.recipeSetBaseName,
          item.name
        );
        if (matchingProducts.length === 1) {
          const onlyProd = itemByName.get(matchingProducts[0]);
          nameSpan.textContent = onlyProd
            ? displayName(onlyProd) || onlyProd.name || matchingProducts[0]
            : matchingProducts[0];
        } else {
          nameSpan.textContent = row.recipeSetDisplayName || row.recipeSetBaseName || "";
        }
        li.appendChild(nameSpan);

        ulUsed.appendChild(li);
      }
      containerEl.appendChild(ulUsed);
    }

    resetRecipeFlyoutScrollAfterContentChange(containerEl);
    return true;
  }

  async function fillRecipeTooltip(item) {
    const ok = await fillRecipeTooltipInto(recipeTooltipEl, item, 0);
    if (ok) recipeTooltipEl.hidden = false;
  }

  function bindRecipeHover(targetEl, item) {
    const recipes = data.recipesByProduct[item.name];
    const usedIn = data.recipesByIngredient[item.name];
    const hasCraft = recipes && recipes.length > 0;
    const hasUsed = usedIn && usedIn.length > 0;
    if (!hasCraft && !hasUsed) return;

    if (targetEl && targetEl.dataset && targetEl.dataset.recipeHoverBound === "1") return;
    if (targetEl && targetEl.dataset) targetEl.dataset.recipeHoverBound = "1";
    recipeHoverItemByTarget.set(targetEl, item);

    targetEl.classList.add("item-icon--recipe");
    targetEl.setAttribute(
      "aria-label",
      "Craft / usage — hover to show recipe ingredients and where this item is used"
    );

    targetEl.addEventListener(
      "mouseenter",
      function (e) {
        lastPointerClientX = e.clientX;
        lastPointerClientY = e.clientY;
        showRecipeTooltipAtPointer(targetEl, e.clientX, e.clientY);
      },
      { passive: true }
    );
    targetEl.addEventListener(
      "mousemove",
      function (e) {
        lastPointerClientX = e.clientX;
        lastPointerClientY = e.clientY;
        if (!recipeTooltipEl.hidden && !recipeTooltipPinned) {
          cancelRecipeTooltipHideDeferred();
          positionRecipeTooltip(e.clientX, e.clientY, targetEl);
        }
      },
      { passive: true }
    );
    targetEl.addEventListener(
      "mouseleave",
      function (e) {
        if (recipeTooltipPinned) return;
        const rt = e.relatedTarget;
        if (
          rt &&
          typeof rt.closest === "function" &&
          rt.closest(".recipe-tooltip")
        ) {
          return;
        }
        scheduleRecipeTooltipHideDeferred();
      },
      { passive: true }
    );

    targetEl.addEventListener(
      "mousedown",
      function (e) {
        if (e.button !== 0) return;
        if (recipeTooltipEl.hidden) return;
        if (recipeTooltipPinned) {
          unpinRecipeTooltip();
          return;
        }
        pinRecipeTooltip(targetEl);
      },
      { passive: true }
    );
  }

  let recipeTooltipGlobalWatchersAttached = false;

  function ensureRecipeTooltipGlobalWatchers() {
    if (recipeTooltipGlobalWatchersAttached) return;
    recipeTooltipGlobalWatchersAttached = true;

    document.addEventListener(
      "mousemove",
      function (e) {
        lastPointerClientX = e.clientX;
        lastPointerClientY = e.clientY;
        if (recipeTooltipPinned) {
          const t = e.target;
          const hovered =
            t && typeof t.closest === "function" ? t.closest("[data-recipe-hover-bound='1']") : null;
          if (hovered && hovered !== recipeTooltipPinnedTarget) {
            unpinRecipeTooltip();
            showRecipeTooltipAtPointer(hovered, e.clientX, e.clientY);
          }
          return;
        }
        if (recipeTooltipEl.hidden) return;
        const t = e.target;
        if (
          t &&
          typeof t.closest === "function" &&
          (t.closest("[data-recipe-hover-bound='1']") || t.closest(".recipe-tooltip"))
        ) {
          cancelRecipeTooltipHideDeferred();
          cancelNestedFlyoutHideDeferred();
          return;
        }
        if (isPointerOverRecipeTooltipZone(e.clientX, e.clientY)) {
          cancelRecipeTooltipHideDeferred();
          return;
        }
        scheduleRecipeTooltipHideDeferred();
      },
      { passive: true }
    );

    document.addEventListener(
      "mousedown",
      function (e) {
        if (!recipeTooltipPinned) return;
        const t = e.target;
        if (!t || typeof t.closest !== "function") {
          hideRecipeTooltip();
          return;
        }
        if (t.closest(".recipe-tooltip")) return;
        if (t.closest("[data-recipe-hover-bound='1']")) return;
        hideRecipeTooltip();
      },
      { passive: true }
    );

    document.addEventListener(
      "wheel",
      function (e) {
        // Preserve browser/page zoom gestures (Ctrl/Cmd + wheel).
        if (e.ctrlKey || e.metaKey) return;
        const t = e.target;
        if (!t || typeof t.closest !== "function") return;
        const scrollHost = closestRecipeTooltipFlyout(t);
        const onIcon = t.closest("[data-recipe-hover-bound='1']");
        if (recipeTooltipScrollArmed) {
          if (!scrollHost && !onIcon) return;
        } else if (!scrollHost) {
          return;
        }
        const el = scrollHost && !scrollHost.hidden ? scrollHost : recipeTooltipEl;
        if (!el || el.hidden) return;
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;
        else if (e.deltaMode === 2) dy *= el.clientHeight;
        if (!dy) return;
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll <= 0) {
          if (scrollHost) e.preventDefault();
          return;
        }
        const cur = el.scrollTop;
        const next = Math.max(0, Math.min(maxScroll, cur + dy));
        if (next === cur) {
          if (scrollHost) e.preventDefault();
          return;
        }
        e.preventDefault();
        el.scrollTop = next;
      },
      { passive: false }
    );

    function onRecipeFlyoutMouseEnter() {
      cancelRecipeTooltipHideDeferred();
      cancelNestedFlyoutHideDeferred();
    }

    function onRecipeFlyoutClick(e) {
      pinRecipeTooltip(recipeTooltipPinnedTarget || recipeTooltipAnchorTarget);
      const icon = e.target.closest(".recipe-tooltip__ing-icon[data-item-name]");
      if (!icon) return;
      const itemName = icon.getAttribute("data-item-name");
      if (!itemName) return;
      e.preventDefault();
      e.stopPropagation();
      navigateToTooltipItem(itemName);
    }

    const flyoutsForEvents = recipeTooltipFlyoutRoots();
    for (let fi = 0; fi < flyoutsForEvents.length; fi++) {
      const tip = flyoutsForEvents[fi];
      if (!tip) continue;
      tip.addEventListener("mouseenter", onRecipeFlyoutMouseEnter, { passive: true });
      tip.addEventListener("click", onRecipeFlyoutClick, { passive: false });
    }
  }

  function description(item) {
    return sortBind.description(item);
  }

  /**
   * Insert zero-width spaces before capitals so wrapped lines prefer boundaries
   * (camelCase / PascalCase). Display only — sort/search still use raw `name`.
   */
  function injectCamelCaseBreaks(s) {
    if (!s || typeof s !== "string") return s;
    let t = s.replace(/([a-z0-9])([A-Z])/g, "$1\u200B$2");
    t = t.replace(/([A-Z])([A-Z][a-z])/g, "$1\u200B$2");
    return t;
  }

  /**
   * Split internal `name` on camelCase / PascalCase boundaries (same rules as line breaks in the table).
   * @returns {string[]}
   */
  function splitInternalNameWords(name) {
    if (!name || typeof name !== "string") return [];
    const spaced = name
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
    if (!spaced) return [];
    return spaced.split(/\s+/).filter(Boolean);
  }

  /**
   * Compare by reversed word lists; tie-break with full-string localeCompare on fallbacks.
   * @param {string[]} wordsA
   * @param {string[]} wordsB
   */
  function compareWordsSuffixOrder(wordsA, wordsB, fallbackA, fallbackB) {
    const ra = wordsA.slice().reverse();
    const rb = wordsB.slice().reverse();
    const n = Math.max(ra.length, rb.length);
    for (let i = 0; i < n; i++) {
      const ca = i < ra.length ? ra[i] : "";
      const cb = i < rb.length ? rb[i] : "";
      const cmp = ca.localeCompare(cb, undefined, { sensitivity: "base", numeric: true });
      if (cmp !== 0) return cmp;
    }
    return (fallbackA || "").localeCompare(fallbackB || "", undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }

  /**
   * Compare internal names by reversed word order so items sharing a final segment (e.g. …Knife, …Grenade) cluster.
   */
  function compareInternalNameSuffixWords(nameA, nameB) {
    return compareWordsSuffixOrder(
      splitInternalNameWords(nameA),
      splitInternalNameWords(nameB),
      nameA,
      nameB
    );
  }

  /** Display names are usually space-separated; single-token strings use camelCase split (e.g. fallback to internal name). */
  function wordsForDisplaySuffixSort(item) {
    const s = displayName(item);
    if (!s || typeof s !== "string") return [];
    const trimmed = s.trim();
    let w = trimmed.split(/\s+/).filter(Boolean);
    if (w.length === 1 && !/\s/.test(s)) {
      w = splitInternalNameWords(trimmed);
    }
    return w;
  }

  function compareDisplayNameSuffixOrder(itemA, itemB) {
    const fa = displayName(itemA);
    const fb = displayName(itemB);
    return compareWordsSuffixOrder(
      wordsForDisplaySuffixSort(itemA),
      wordsForDisplaySuffixSort(itemB),
      fa,
      fb
    );
  }

  function getMeleeWeaponSetup(item) {
    return sortBind.getMeleeWeaponSetup(item);
  }

  /** @returns {object|null} `damageDesc` or null when item has no melee damage block. */
  function getMeleeDamageDesc(item) {
    return sortBind.getMeleeDamageDesc(item);
  }

  /** MeleeWeapon / JackHammer numeric damage fields: 0 renders as empty; others empty cell. */
  function meleeDamageNumberCell(item, key) {
    const d = getMeleeDamageDesc(item);
    const v = d ? d[key] : null;
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  /** Top-level `meleeWeaponSetupInfo` numeric fields (e.g. timeBetweenAttacks, attackRange). */
  function meleeSetupNumberCell(item, key) {
    const m = getMeleeWeaponSetup(item);
    const v = m ? m[key] : null;
    return formatCatalogStatNumber(v, {});
  }

  /** @param {number} [wisdomOverride] — omit for live {@link wisdomStat}. */
  function prices(item, wisdomOverride) {
    return sortBind.prices(item, wisdomOverride);
  }

  /**
   * Sum of component sell prices used to craft `item`, normalized per 1 output item.
   *
   * For items with multiple recipe variants, we take the minimum cost variant.
   * Returns `null` when no complete recipe can be costed.
   */
  /** @param {number} [wisdomOverride] — omit for live {@link wisdomStat}. */
  function componentSellPrice(item, wisdomOverride) {
    return sortBind.componentSellPrice(item, wisdomOverride);
  }

  /**
   * Profit = sell price - (ingredient sell cost) for 1 output item.
   * Returns `null` when sell price or component cost can't be computed.
   */
  /** @param {number} [wisdomOverride] — omit for live {@link wisdomStat}. */
  function profitValue(item, wisdomOverride) {
    return sortBind.profitValue(item, wisdomOverride);
  }

  /** e.g. 1000000 → "1 000 000" (rounded to integer; spaces between thousands). */
  function formatPriceWithSpaces(n) {
    if (n == null || typeof n !== "number" || Number.isNaN(n)) return "—";
    n = Math.round(n);
    const neg = n < 0;
    const x = neg ? -n : n;
    const s = String(x);
    const dot = s.indexOf(".");
    let intStr;
    let frac = "";
    if (dot === -1) {
      intStr = s;
    } else {
      intStr = s.slice(0, dot);
      frac = s.slice(dot);
    }
    const grouped = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return (neg ? "-" : "") + grouped + frac;
  }

  /**
   * Non-price numeric cells: round to 3 decimal places; optional fixed decimals can be provided per column.
   * Buy/sell use {@link formatPriceWithSpaces} (integer).
   * @param {{ hideZero?: boolean, decimals?: number }} [opts]
   *   - hideZero: if true, exact 0 renders as empty (existing catalog convention).
   *   - decimals: fixed display precision [0..3]; when omitted, trailing zeros are trimmed.
   */
  function formatCatalogStatNumber(v, opts) {
    const hideZero = opts && opts.hideZero;
    if (v == null || typeof v !== "number" || Number.isNaN(v)) return "—";
    if (hideZero && v === 0) return "";
    const rounded = Math.round(v * 1000) / 1000;
    const fixedDecimals = opts && Number.isFinite(opts.decimals) ? opts.decimals : null;
    if (fixedDecimals != null) {
      const d = Math.max(0, Math.min(3, Math.trunc(fixedDecimals)));
      return rounded.toFixed(d);
    }
    let s = rounded.toFixed(3);
    s = s.replace(/(\.\d*?)0+$/, "$1");
    if (s.endsWith(".")) s = s.slice(0, -1);
    return s;
  }

  function getColumnStatDecimals(colId) {
    if (Object.prototype.hasOwnProperty.call(statColumnDecimalsById, colId)) {
      return statColumnDecimalsById[colId];
    }
    return 3;
  }

  function getColumnStatWidthPx(colId) {
    if (Object.prototype.hasOwnProperty.call(statColumnWidthPxById, colId)) {
      return statColumnWidthPxById[colId];
    }
    return null;
  }

  /** `inventorySetupInfo.iconPrimaryColor` / `iconSecondaryColor` only (Icon* names in colours). */
  function getIconColorNames(item) {
    const inv = item.inventorySetupInfo;
    const ip = inv.iconPrimaryColor;
    const is = inv.iconSecondaryColor;
    const a = ip.trim();
    const b = is.trim();
    return { primary: a, secondary: b };
  }

  /**
   * Items whose inventory icon is already full-color art — skip mask tint (primary/secondary).
   * Most are identified by `pickupType`; a few use e.g. `BoxPickupType` but still ship finished DDS.
   */
  const FULL_COLOR_ITEM_NAMES = new Set(["AetherkinAmmo"]);

  /** Full-colour icons: avg hue of primary+secondary, half saturation (see {@link applyHuePaletteRemap}). */
  const HUE_PALETTE_REMAP = new Set(["AirBulb"]);

  function isFullColorPickup(item) {
    if (FULL_COLOR_ITEM_NAMES.has(item.name)) {
      return true;
    }
    const inv = item.inventorySetupInfo;
    const t = inv.pickupType;
    return (
      t === "FullColorPickupType" ||
      t === "GibPickupType" ||
      t === "LifestoneFragmentPickupType" ||
      t === "LifestoneGemPickupType"
    );
  }

  function getTintColorsForItem(item) {
    if (isFullColorPickup(item)) return null;
    const WC = WindforgeColors;
    const names = getIconColorNames(item);
    const p = WC.lookupColorName(names.primary);
    const s = WC.lookupColorName(names.secondary);
    return { primary: p, secondary: s };
  }

  /** @returns {string|null} cache key if this item uses mask tinting; otherwise null */
  function tintCacheKey(iconUrl, item) {
    const names = getIconColorNames(item);
    const mode = HUE_PALETTE_REMAP.has(item && item.name) ? "hueAvgHalfSat" : "mask";
    return iconUrl + "\0" + names.primary + "\0" + names.secondary + "\0" + mode;
  }

  /**
   * Resolve catalog icon to a data URL using {@link tintedIconDataUrlCache}, {@link rawIconDataUrlCache},
   * and shared {@link loadImageForUrl} (same decode as table rows).
   * @returns {Promise<string|null>}
   */
  async function ensureIconDataUrlForItem(item) {
    const url = iconUrlFor(item);
    const tint = getTintColorsForItem(item);
    const tk = tintCacheKey(url, item);
    if (tk && tintedIconDataUrlCache.has(tk)) {
      return tintedIconDataUrlCache.get(tk);
    }
    if (!tint && rawIconDataUrlCache.has(url)) {
      return rawIconDataUrlCache.get(url);
    }
    const loaded = await loadImageForUrl(url);
    if (tint) {
      const dataUrl = HUE_PALETTE_REMAP.has(item && item.name)
        ? applyHuePaletteRemap(loaded, tint.primary, tint.secondary)
        : applyEquipmentMaskTint(loaded, tint.primary, tint.secondary);
      if (tk) tintedIconDataUrlCache.set(tk, dataUrl);
      return dataUrl;
    }
    const raw = canvasToDataUrlFromImage(loaded);
    rawIconDataUrlCache.set(url, raw);
    return raw;
  }

  /** Full-colour pickup: circular mean hue of palette colours, pixel saturation halved. */
  function applyHuePaletteRemap(img, primaryRgb, secondaryRgb) {
    const w = img && (img.naturalWidth || img.width);
    const h = img && (img.naturalHeight || img.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    let imageData;
      ctx.drawImage(img, 0, 0);
    imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    function toHsl(r, g, b) {
      r /= 255;
      g /= 255;
      b /= 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let ho = 0;
      let s = 0;
      if (max !== min) {
        const diff = max - min;
        s = l > 0.5 ? diff / (2 - max - min) : diff / (max + min);
        switch (max) {
          case r:
            ho = (g - b) / diff + (g < b ? 6 : 0);
            break;
          case g:
            ho = (b - r) / diff + 2;
            break;
          default:
            ho = (r - g) / diff + 4;
        }
        ho /= 6;
      }
      return { h: ho * 360, s, l };
    }

    function toRgb(hDeg, s, l) {
      let hh = (((hDeg % 360) + 360) % 360) / 360;
      let r;
      let g;
      let b;
      if (s === 0) {
        r = g = b = l;
      } else {
        const hue2rgb = function (p, q, tt) {
          if (tt < 0) tt += 1;
          if (tt > 1) tt -= 1;
          if (tt < 1 / 6) return p + (q - p) * 6 * tt;
          if (tt < 1 / 2) return q;
          if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, hh + 1 / 3);
        g = hue2rgb(p, q, hh);
        b = hue2rgb(p, q, hh - 1 / 3);
      }
      return {
        r: Math.min(255, Math.max(0, Math.round(r * 255))),
        g: Math.min(255, Math.max(0, Math.round(g * 255))),
        b: Math.min(255, Math.max(0, Math.round(b * 255))),
      };
    }

    const hp = toHsl(primaryRgb.r, primaryRgb.g, primaryRgb.b).h;
    const hs = toHsl(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b).h;
    const a1 = (hp * Math.PI) / 180;
    const a2 = (hs * Math.PI) / 180;
    const cx = Math.cos(a1) + Math.cos(a2);
    const sy = Math.sin(a1) + Math.sin(a2);
    const mag = Math.hypot(cx, sy);
    let targetHue =
      mag < 1e-10 ? ((hp + hs) * 0.5 + 360) % 360 : (Math.atan2(sy, cx) * 180) / Math.PI;
    if (targetHue < 0) targetHue += 360;

    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 4) continue;
      const hsl = toHsl(d[i], d[i + 1], d[i + 2]);
      const out = toRgb(targetHue, hsl.s * 0.5, hsl.l);
      d[i] = out.r;
      d[i + 1] = out.g;
      d[i + 2] = out.b;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  function applyEquipmentMaskTint(img, primaryRgb, secondaryRgb) {
    const w = img && (img.naturalWidth || img.width);
    const h = img && (img.naturalHeight || img.height);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    let imageData;
    ctx.drawImage(img, 0, 0);
      imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;
    const pr = primaryRgb;
    const sr = secondaryRgb;
    const EPS = 1e-4;
    /** Red channel in mask → primary colour; green channel → secondary (game convention). */
    function mixByte(pc, sc, wPrimary, wSecondary) {
      const v = pc * wPrimary + sc * wSecondary;
      return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
    }
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i];
      const g = d[i + 1];
      const a = d[i + 3];
      if (a < 4) continue;
      const rgSum = r + g;
      const wRed = r / (rgSum + EPS);
      const wGreen = g / (rgSum + EPS);
      d[i] = mixByte(pr.r, sr.r, wRed, wGreen);
      d[i + 1] = mixByte(pr.g, sr.g, wRed, wGreen);
      d[i + 2] = mixByte(pr.b, sr.b, wRed, wGreen);
    }
    ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL("image/png");
  }

  /**
   * Same pipeline as table icons: {@code .item-icon} CSS vertical flip, optional mask tint, shared data-URL cache.
   * @param {HTMLImageElement} img
   * @param {*} item
   * @param {string} url resolved PNG URL from {@link iconUrlFor}
   * @param {{ onLoadError?: () => void }} [opts]
   */
  function wireCatalogItemIcon(img, item, url, opts) {
    img.alt = "";
    img.classList.add("item-icon");
    const tint = getTintColorsForItem(item);
    const tk = tintCacheKey(url, item);
    if (tk) {
      const cached = tintedIconDataUrlCache.get(tk);
      if (cached) {
        img.classList.add("item-icon--tinted");
        img.src = cached;
        return;
      }
    } else if (rawIconDataUrlCache.has(url)) {
      img.src = rawIconDataUrlCache.get(url);
      return;
    }
    loadImageForUrl(url)
      .then(function (loaded) {
        if (tint) {
          const dataUrl = HUE_PALETTE_REMAP.has(item && item.name)
            ? applyHuePaletteRemap(loaded, tint.primary, tint.secondary)
            : applyEquipmentMaskTint(loaded, tint.primary, tint.secondary);
          if (dataUrl) {
            if (tk) {
              tintedIconDataUrlCache.set(tk, dataUrl);
            }
            img.classList.add("item-icon--tinted");
            img.src = dataUrl;
            return;
          }
        }
        const raw = canvasToDataUrlFromImage(loaded);
        rawIconDataUrlCache.set(url, raw);
        img.src = raw;
      })
      .catch(function () {
        fatal(new Error("Icon decode failed for " + String(item && item.name) + ": " + String(url)));
      });
  }

  /** Decode a recipe-set PNG once; cached for tooltips and any later use. */
  async function preloadRawRecipeIconUrl(url) {
    if (rawIconDataUrlCache.has(url)) return;
    const loaded = await loadImageForUrl(url);
    const raw = canvasToDataUrlFromImage(loaded);
    rawIconDataUrlCache.set(url, raw);
  }

  /** Background: same work as old startup preload — fills {@link rawIconDataUrlCache} / {@link tintedIconDataUrlCache}. */
  function collectRecipeSetPngUrls() {
    const set = new Set();
    function scan(container) {
      const keys = Object.keys(container);
      for (let k = 0; k < keys.length; k++) {
        const arr = container[keys[k]];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
          const u = recipeSetIconUrl(arr[i]);
          if (isRasterIconRef(u)) set.add(u);
        }
      }
    }
    scan(data.recipesByProduct);
    scan(data.recipesByIngredient);
    return Array.from(set);
  }

  async function preloadAllIcons() {
    const items = data.ItemList;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it) continue;
      await ensureIconDataUrlForItem(it);
    }
    const recipeUrls = collectRecipeSetPngUrls();
    for (let r = 0; r < recipeUrls.length; r++) {
      await preloadRawRecipeIconUrl(recipeUrls[r]);
    }
  }

  /**
   * After caches are warm, add one {@code <img>} per item for virtual row reuse.
   * Does not clear {@link liveIconNodeByItemName} — keeps icons already bound to visible rows.
   */
  const LIVE_POOL_YIELD_EVERY = 64;

  async function buildLiveIconPoolMissing() {
    const items = data.ItemList;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || !item.name) continue;
      if (liveIconNodeByItemName.has(item.name)) continue;
      const img = document.createElement("img");
      img.alt = "";
      img.loading = "eager";
      img.classList.add("item-icon");
      const dataUrl = await ensureIconDataUrlForItem(item);
      const tint = getTintColorsForItem(item);
      if (tint) img.classList.add("item-icon--tinted");
      img.src = dataUrl;
      if (typeof img.decode === "function") {
        img.decode().catch(function () {});
      }
      liveIconNodeByItemName.set(item.name, img);
      if (i % LIVE_POOL_YIELD_EVERY === LIVE_POOL_YIELD_EVERY - 1) {
        await new Promise(function (r) {
          requestAnimationFrame(r);
        });
      }
    }
  }

  function scheduleBackgroundIconWarmup() {
    const run = function () {
      void preloadAllIcons()
        .then(function () {
          return buildLiveIconPoolMissing();
        })
        .catch(function (e) {
          console.warn("[Windforge item catalog] background icon warmup failed", e);
        });
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 8000 });
    } else {
      setTimeout(run, 0);
    }
  }

  function matchesQuery(item, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    const hay = [
      item.name,
      item.objectType,
      displayName(item),
      description(item),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(s);
  }

  const NO_OBJECT_TYPE = "__no_object_type__";

  /**
   * Object type &lt;select&gt;: grouped with &lt;optgroup&gt; (small categories together).
   * Radio sits with other tools. Unknown types go under "Other".
   */
  const OBJECT_TYPE_FILTER_GROUPS = [
    { label: "Clothing", ids: ["ClothingItem"] },
    { label: "Weapons", ids: ["MeleeWeapon", "RangedWeapon", "ThrowableWeapon"] },
    { label: "Consumables", ids: ["ConsumableItem"] },
    { label: "Crafting", ids: ["CraftItem", "RecipeItem"] },
    {
      label: "Tools",
      ids: ["BuildingTool", "DismantleItem", "GrapplingHook", "JackHammer", "Radio"],
    },
    {
      label: "Placement",
      ids: [
        "PlaceArtilleryShipItem",
        "PlaceBlockItem",
        "PlaceEngineObjectItem",
        "PlaceGrinderObjectItem",
        "PlaceObjectItem",
        "PlacePropulsionObjectItem",
        "PlaceShipScaffoldingItem",
      ],
    },
  ];

  function matchesObjectTypeFilter(item) {
    const sel = document.getElementById("filter-object-type");
    const v = sel ? sel.value : "";
    if (!v) return true;
    if (v === NO_OBJECT_TYPE) {
      return item.objectType == null || String(item.objectType).trim() === "";
    }
    return item.objectType === v;
  }

  /** Object type filter is not "All object types" — hide redundant Object type column. */
  function isObjectTypeFiltered() {
    const sel = document.getElementById("filter-object-type");
    return !!(sel && sel.value !== "");
  }

  function visibleColumns() {
    const showMeleeCols = showMeleeWeaponStatColumns();
    const hideObjectTypeCol = isObjectTypeFiltered();
    const out = [];
    for (let i = 0; i < COLUMNS.length; i++) {
      const c = COLUMNS[i];
      if (!showMeleeCols && isMeleeStatsColumnId(c.id)) continue;
      if (c.rtDamageKey && !showRangedThrowableStatColumns()) continue;
      if (c.id === "rtChemicalDamage" && !showRtChemicalDamageColumn()) continue;
      if (isClothingStatColumnDef(c) && !showClothingStatColumns()) continue;
      if (isPlaceBlockStatColumnDef(c) && !showPlaceBlockStatColumns()) continue;
      if (c.id === "pbImpactDmgMult" && !showPlaceBlockImpactColumn()) continue;
      if (isGrapplingHookStatColumnDef(c) && !showGrapplingHookStatColumns()) continue;
      if (isPlaceableSetupStatColumnDef(c) && !showPlaceableSetupStatColumns()) {
        continue;
      }
      if (c.id === "plBuoyancy" && !showPlaceableBuoyancyColumn()) continue;
      if (isPropulsionPlaceItemStatColumnDef(c) && !showPropulsionPlaceItemStatColumns()) {
        continue;
      }
      if (isEnginePlaceItemStatColumnDef(c) && !showEnginePlaceItemStatColumns()) {
        continue;
      }
      if (isGrinderPlaceItemStatColumnDef(c) && !showGrinderPlaceItemStatColumns()) {
        continue;
      }
      if (isArtilleryShipItemStatColumnDef(c) && !showArtilleryShipItemStatColumns()) {
        continue;
      }
      if (hideObjectTypeCol && c.id === "objectType") continue;
      out.push(c);
    }
    return out;
  }

  function buildColgroup() {
    const cgHead = document.getElementById("colgroup-head");
    const cgBody = document.getElementById("colgroup-body");
    const cols = visibleColumns();
    cgHead.innerHTML = "";
    cgBody.innerHTML = "";

    let totalPx = 0;
    for (let j = 0; j < cols.length; j++) {
      const id = cols[j].id;
      const dynamicPx = getColumnStatWidthPx(id);
      const px = Math.max(16, dynamicPx ?? COLUMN_WIDTH_PX[id] ?? COL_PX_STAT);
      totalPx += px;
      const col = document.createElement("col");
      col.style.width = px + "px";
      cgHead.appendChild(col);
      cgBody.appendChild(col.cloneNode(true));
    }

    // Force deterministic table sizing (prevents content-driven min-width expansion).
    const tableHead = cgHead.closest("table");
    const tableBody = cgBody.closest("table");
    if (tableHead) {
      tableHead.style.width = totalPx + "px";
    }
    if (tableBody) {
      tableBody.style.width = totalPx + "px";
    }
  }

  function getBodyScrollPort() {
    return document.getElementById("table-body-scroll");
  }

  /**
   * @param {{ objectType?: string } | null} [restored] — from localStorage; preferred value for &lt;select&gt; after rebuild
   */
  function populateObjectTypeFilter(restored) {
    const sel = document.getElementById("filter-object-type");
    const previous =
      restored && typeof restored.objectType === "string"
        ? restored.objectType
        : sel.value;
    sel.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "All object types";
    sel.appendChild(optAll);

    const items = data.ItemList;
    const seen = new Set();
    let hasUntyped = false;
    for (let i = 0; i < items.length; i++) {
      const t = items[i].objectType;
      if (t == null || String(t).trim() === "") {
        hasUntyped = true;
      } else {
        seen.add(t);
      }
    }

    if (hasUntyped) {
      const o = document.createElement("option");
      o.value = NO_OBJECT_TYPE;
      o.textContent = "(no object type)";
      sel.appendChild(o);
    }

    const grouped = new Set();
    for (let g = 0; g < OBJECT_TYPE_FILTER_GROUPS.length; g++) {
      const grp = OBJECT_TYPE_FILTER_GROUPS[g];
      const present = [];
      for (let k = 0; k < grp.ids.length; k++) {
        const id = grp.ids[k];
        if (seen.has(id)) {
          present.push(id);
          grouped.add(id);
        }
      }
      if (present.length === 0) continue;
      const og = document.createElement("optgroup");
      og.label = grp.label;
      for (let p = 0; p < present.length; p++) {
        const o = document.createElement("option");
        o.value = present[p];
        o.textContent = present[p];
        og.appendChild(o);
      }
      sel.appendChild(og);
    }

    const orphans = [];
    seen.forEach(function (id) {
      if (!grouped.has(id)) orphans.push(id);
    });
    orphans.sort(function (a, b) {
      return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
    });
    if (orphans.length > 0) {
      const og = document.createElement("optgroup");
      og.label = "Other";
      for (let j = 0; j < orphans.length; j++) {
        const o = document.createElement("option");
        o.value = orphans[j];
        o.textContent = orphans[j];
        og.appendChild(o);
      }
      sel.appendChild(og);
    }

    const canRestore = Array.prototype.some.call(sel.options, function (opt) {
      return opt.value === previous;
    });
    sel.value = canRestore ? previous : "";

    syncObjectTypeDropdownPanel();
  }

  function updateObjectTypeDropdownLabel() {
    const sel = document.getElementById("filter-object-type");
    const labelEl = document.getElementById("filter-object-type-label");
    const opt = sel.options[sel.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : "All object types";
  }

  function sizeDropdownToLongestOption(selectId, rootId, btnId) {
    const sel = document.getElementById(selectId);
    const root = document.getElementById(rootId);
    const btn = document.getElementById(btnId);
    if (!sel || !root || !btn) return;
    const cs = getComputedStyle(btn);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.font = cs.font;
    let maxText = 0;
    for (let i = 0; i < sel.options.length; i++) {
      const t = sel.options[i].textContent || sel.options[i].value || "";
      const w = ctx.measureText(t).width;
      if (w > maxText) maxText = w;
    }
    // text + btn horizontal paddings + chevron room
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;
    const borderL = parseFloat(cs.borderLeftWidth) || 0;
    const borderR = parseFloat(cs.borderRightWidth) || 0;
    const chevron = 20;
    const width = Math.ceil(maxText + padLeft + padRight + borderL + borderR + chevron);
    root.style.width = width + "px";
    root.style.minWidth = width + "px";
    root.style.maxWidth = width + "px";
  }

  function syncObjectTypeDropdownPanel() {
    const sel = document.getElementById("filter-object-type");
    const panel = document.getElementById("filter-object-type-panel");

    panel.innerHTML = "";
    const current = sel.value;

    function addOptionButton(value, text, opts) {
      const indented = opts && opts.indented;
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.className = "object-type-dropdown__option";
      if (indented) b.classList.add("object-type-dropdown__option--indented");
      b.setAttribute("data-value", value);
      b.textContent = text;
      const selected = value === current;
      b.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) b.classList.add("object-type-dropdown__option--selected");
      panel.appendChild(b);
    }

    function addGroupLabel(text) {
      const d = document.createElement("div");
      d.className = "object-type-dropdown__group-label";
      d.setAttribute("role", "presentation");
      d.textContent = text;
      panel.appendChild(d);
    }

    for (let i = 0; i < sel.children.length; i++) {
      const node = sel.children[i];
      if (node.nodeName === "OPTION") {
        addOptionButton(node.value, node.textContent || node.value, { indented: false });
      } else if (node.nodeName === "OPTGROUP") {
        addGroupLabel(node.label || "");
        for (let j = 0; j < node.children.length; j++) {
          const o = node.children[j];
          if (o.nodeName === "OPTION") {
            addOptionButton(o.value, o.textContent || o.value, { indented: true });
          }
        }
      }
    }

    updateObjectTypeDropdownLabel();
    sizeDropdownToLongestOption(
      "filter-object-type",
      "object-type-dropdown-root",
      "filter-object-type-btn"
    );
  }

  function closeObjectTypePanel() {
    const panel = document.getElementById("filter-object-type-panel");
    const btn = document.getElementById("filter-object-type-btn");
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function setObjectTypeFilterFromDropdown(value, opts) {
    const sel = document.getElementById("filter-object-type");
    sel.value = value;
    syncObjectTypeDropdownPanel();
    const shouldClose = !(opts && opts.keepOpen);
    if (shouldClose) closeObjectTypePanel();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Wire a custom dropdown UI to a hidden <select>.
   * ArrowUp/ArrowDown directly changes selection (native-select-like).
   */
  function initSelectDropdown(cfg) {
    const btn = document.getElementById(cfg.btnId);
    const panel = document.getElementById(cfg.panelId);
    const root = document.getElementById(cfg.rootId);
    const sel = document.getElementById(cfg.selectId);

    cfg.syncPanel();

    function closePanel(opts) {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      if (opts && opts.focusButton) btn.focus();
    }

    function openPanel() {
      cfg.closeOthers();
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      const selected = panel.querySelector(".object-type-dropdown__option--selected");
      const target = selected || panel.querySelector(".object-type-dropdown__option");
      target.scrollIntoView({ block: "nearest" });
      target.focus();
    }

    function setFromDropdown(value, opts) {
      if (sel.value === value) {
        if (!(opts && opts.keepOpen)) closePanel({ focusButton: true });
        return;
      }
      sel.value = value;
      cfg.syncPanel();
      const shouldClose = !(opts && opts.keepOpen);
      if (shouldClose) closePanel({ focusButton: true });
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function stepSelect(delta, keepOpen) {
      const opts = Array.from(sel.options || []);
      let idx = sel.selectedIndex;
      const next = Math.max(0, Math.min(opts.length - 1, idx + delta));
      const v = opts[next] ? opts[next].value : "";
      setFromDropdown(v, keepOpen ? { keepOpen: true } : undefined);
    }

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panel.hidden) openPanel();
      else closePanel();
    });

    btn.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        stepSelect(delta, false);
      }
    });

    panel.addEventListener("click", function (e) {
      const opt = e.target.closest(".object-type-dropdown__option");
      e.stopPropagation();
      const value = opt.getAttribute("data-value");
      setFromDropdown(value != null ? value : "");
    });

    panel.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        stepSelect(delta, true);
        const selected = panel.querySelector(".object-type-dropdown__option--selected");
        selected.focus();
        selected.scrollIntoView({ block: "nearest" });
      } else if (e.key === "Home") {
        e.preventDefault();
        const v = sel.options && sel.options[0] ? sel.options[0].value : "";
        setFromDropdown(v, { keepOpen: true });
        const selected = panel.querySelector(".object-type-dropdown__option--selected");
        selected.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        const lastIdx = sel.options ? sel.options.length - 1 : -1;
        const v = lastIdx >= 0 ? sel.options[lastIdx].value : "";
        setFromDropdown(v, { keepOpen: true });
        const selected = panel.querySelector(".object-type-dropdown__option--selected");
        selected.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const active = document.activeElement;
        const opt =
          active && active.classList && active.classList.contains("object-type-dropdown__option")
            ? active
            : null;
        const value = opt.getAttribute("data-value");
        setFromDropdown(value != null ? value : "");
      } else if (e.key === "Escape") {
        e.preventDefault();
        closePanel({ focusButton: true });
      }
    });

    document.addEventListener("click", function (e) {
      if (root.contains(e.target)) return;
      closePanel();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closePanel();
      }
    });
  }

  function initObjectTypeDropdown() {
    initSelectDropdown({
      btnId: "filter-object-type-btn",
      panelId: "filter-object-type-panel",
      rootId: "object-type-dropdown-root",
      selectId: "filter-object-type",
      closeOthers: closeSecondarySortPanel,
      syncPanel: syncObjectTypeDropdownPanel,
    });
  }

  function updateSecondarySortDropdownLabel() {
    const sel = document.getElementById("secondary-sort");
    const labelEl = document.getElementById("secondary-sort-label");
    const opt = sel.options[sel.selectedIndex];
    labelEl.textContent = opt ? opt.textContent : "";
  }

  function syncSecondarySortDropdownPanel() {
    const sel = document.getElementById("secondary-sort");
    const panel = document.getElementById("secondary-sort-panel");

    panel.innerHTML = "";
    const current = sel.value;

    for (let i = 0; i < sel.options.length; i++) {
      const o = sel.options[i];
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "option");
      b.className = "object-type-dropdown__option";
      b.setAttribute("data-value", o.value);
      b.textContent = o.textContent || o.value;
      const selected = o.value === current;
      b.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) b.classList.add("object-type-dropdown__option--selected");
      panel.appendChild(b);
    }

    updateSecondarySortDropdownLabel();
    sizeDropdownToLongestOption(
      "secondary-sort",
      "secondary-sort-dropdown-root",
      "secondary-sort-btn"
    );
  }

  function closeSecondarySortPanel() {
    const panel = document.getElementById("secondary-sort-panel");
    const btn = document.getElementById("secondary-sort-btn");
    panel.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  }

  function setSecondarySortFromDropdown(value, opts) {
    const sel = document.getElementById("secondary-sort");
    sel.value = value;
    syncSecondarySortDropdownPanel();
    const shouldClose = !(opts && opts.keepOpen);
    if (shouldClose) closeSecondarySortPanel();
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function initSecondarySortDropdown() {
    initSelectDropdown({
      btnId: "secondary-sort-btn",
      panelId: "secondary-sort-panel",
      rootId: "secondary-sort-dropdown-root",
      selectId: "secondary-sort",
      closeOthers: closeObjectTypePanel,
      syncPanel: syncSecondarySortDropdownPanel,
    });
  }

  function getStatValueFromColumnDef(item, def) {
    return sortBind.getStatValueFromColumnDef(item, def);
  }

  function getCatalogStatDisplayNumber(item, colId) {
    if (colId === "dmgPhysical") {
      const d = getMeleeDamageDesc(item);
      return d && typeof d.physicalDamage === "number" ? d.physicalDamage : null;
    }
    if (colId === "meleeTimeBetweenAttacks") {
      const m = getMeleeWeaponSetup(item);
      return m && typeof m.timeBetweenAttacks === "number" ? m.timeBetweenAttacks : null;
    }
    if (colId === "meleeAttackRange") {
      const m = getMeleeWeaponSetup(item);
      return m && typeof m.attackRange === "number" ? m.attackRange : null;
    }
    if (colId === "dmgKnockback") {
      const d = getMeleeDamageDesc(item);
      return d && typeof d.knockbackMagnitude === "number" ? d.knockbackMagnitude : null;
    }
    const def = COLUMN_BY_ID[colId];
    if (!def) return null;
    const v = getStatValueFromColumnDef(item, def);
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  /**
   * Order-independent fingerprint: same filtered multiset + wisdom + visible columns => same layout stats.
   * Includes {@link sortCacheBuildEpoch} so a new catalog cannot collide with the previous load.
   */
  function computeStatsLayoutCacheKey(list, wisdom, colIds) {
    let h = list.length >>> 0;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const n = it && typeof it.name === "string" ? it.name : "";
      let nh = 0;
      for (let j = 0; j < n.length; j++) nh = (nh * 31 + n.charCodeAt(j)) | 0;
      h = (h ^ nh) >>> 0;
    }
    return (
      sortCacheBuildEpoch + "\x1f" + wisdom + "\x1f" + colIds + "\x1f" + h
    );
  }

  function computeStatColumnDecimalsForList(list) {
    const out = Object.create(null);
    const cols = visibleColumns();
    for (let c = 0; c < cols.length; c++) {
      const colId = cols[c].id;
      let hasStatValue = false;
      let keepTenths = false;
      let keepHundredths = false;
      let keepThousandths = false;
      for (let i = 0; i < list.length; i++) {
        const v = getCatalogStatDisplayNumber(list[i], colId);
        if (v == null || typeof v !== "number" || Number.isNaN(v)) continue;
        hasStatValue = true;
        const scaled = Math.round(Math.abs(v) * 1000);
        if ((scaled % 10) !== 0) keepThousandths = true;
        if ((Math.floor(scaled / 10) % 10) !== 0) keepHundredths = true;
        if ((Math.floor(scaled / 100) % 10) !== 0) keepTenths = true;
        if (keepThousandths) break;
      }
      if (!hasStatValue) continue;
      out[colId] = keepThousandths ? 3 : keepHundredths ? 2 : keepTenths ? 1 : 0;
    }
    return out;
  }

  function columnUsesHideZero(colId) {
    return colId !== "meleeTimeBetweenAttacks" && colId !== "meleeAttackRange";
  }

  function isLengthBasedStatColumn(colId) {
    if (
      colId === "buy" ||
      colId === "sell" ||
      colId === "componentSell" ||
      colId === "profit" ||
      colId === "icon" ||
      colId === "display" ||
      colId === "name" ||
      colId === "objectType" ||
      colId === "description" ||
      colId === "json"
    ) {
      return false;
    }
    if (
      colId === "dmgPhysical" ||
      colId === "meleeTimeBetweenAttacks" ||
      colId === "meleeAttackRange" ||
      colId === "dmgKnockback"
    ) {
      return true;
    }
    const def = COLUMN_BY_ID[colId];
    return !!(
      def &&
      (def.rtDamageKey ||
        isClothingStatColumnDef(def) ||
        def.placeBlockStatKey ||
        def.grapplingHookStatKey ||
        def.placeableSetupStatKey ||
        isPropulsionPlaceItemStatColumnDef(def) ||
        isEnginePlaceItemStatColumnDef(def) ||
        isGrinderPlaceItemStatColumnDef(def) ||
        isArtilleryShipItemStatColumnDef(def))
    );
  }

  function isLengthBasedNumericColumn(colId) {
    return (
      colId === "buy" ||
      colId === "sell" ||
      colId === "componentSell" ||
      colId === "profit" ||
      isLengthBasedStatColumn(colId)
    );
  }

  function computeStatColumnWidthsForList(list, decimalsById) {
    if (!statsMeasureCanvas) {
      statsMeasureCanvas = document.createElement("canvas");
      statsMeasureCtx = statsMeasureCanvas.getContext("2d");
    }
    const ctx = statsMeasureCtx;
    if (!ctx) return Object.create(null);
    const tableBodyEl = document.getElementById("table-body");
    const bodyStyles = getComputedStyle(tableBodyEl || document.body);
    const font = bodyStyles.font || "14px system-ui";
    ctx.font = font;

    const out = Object.create(null);
    const cols = visibleColumns();
    for (let c = 0; c < cols.length; c++) {
      const colId = cols[c].id;
      if (!isLengthBasedNumericColumn(colId)) continue;
      const decimals = Object.prototype.hasOwnProperty.call(decimalsById, colId)
        ? decimalsById[colId]
        : 3;
      const hideZero = columnUsesHideZero(colId);
      let maxTextPx = 0;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        let txt = "";
        if (colId === "buy" || colId === "sell") {
          const p = prices(item);
          const n = colId === "buy" ? p.buy : p.sell;
          txt = n != null ? formatPriceWithSpaces(n) : "—";
        } else if (colId === "componentSell") {
          const n = componentSellPrice(item);
          txt = n != null ? formatPriceWithSpaces(n) : "";
        } else if (colId === "profit") {
          const n = profitValue(item);
          txt = n != null ? formatPriceWithSpaces(n) : "";
        } else {
          const v = getCatalogStatDisplayNumber(item, colId);
          if (v == null || typeof v !== "number" || Number.isNaN(v)) continue;
          txt = formatCatalogStatNumber(v, { hideZero: hideZero, decimals: decimals });
        }
        if (!txt) continue;
        const textPx = ctx.measureText(txt).width;
        if (textPx > maxTextPx) maxTextPx = textPx;
      }
      // Add horizontal cell padding + border allowance, then clamp for stability.
      out[colId] = Math.max(40, Math.min(96, Math.ceil(maxTextPx)));
    }
    return out;
  }

  function renderStatCellFromColumnDef(td, item, def) {
    td.className = "num col-melee-dmg";
    const v = getStatValueFromColumnDef(item, def);
    if (v == null) {
      td.textContent = "—";
      return;
    }
    if (typeof v === "number" && !Number.isNaN(v)) {
      td.textContent = formatCatalogStatNumber(v, {
        hideZero: true,
        decimals: getColumnStatDecimals(def.id),
      });
      return;
    }
    td.textContent = v === "" ? "" : String(v);
  }

  /**
   * @param {number} [wisdomForPrices] — for buy/sell/component/profit only; omit for live {@link wisdomStat}.
   */
  function getSortValue(item, colId, wisdomForPrices) {
    return sortBind.getSortValue(item, colId, wisdomForPrices);
  }

  /**
   * @param {number} ia
   * @param {number} ib
   * @param {{ col: string, dir: 1|-1, secondary: string, wisdom: number }} state
   */
  function compareItemIndices(ia, ib, state) {
    return sortBind.compareItemIndices(ia, ib, state);
  }

  function compareItems(a, b) {
    const ia = itemIndexByName.get(a.name);
    const ib = itemIndexByName.get(b.name);
    if (ia === undefined || ib === undefined) {
      return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true });
    }
    return compareItemIndices(ia, ib, {
      col: sortColumn,
      dir: sortDir === "asc" ? 1 : -1,
      secondary: secondarySortMode,
      wisdom: wisdomStat,
    });
  }

  function sortCacheKey(col, dirStr, secondary, wisdomSlice) {
    return sortBind.sortCacheKey(col, dirStr, secondary, wisdomSlice);
  }

  function ensurePriceMatricesForPrecomputedSlices() {
    sortBind.ensurePriceMatricesForPrecomputedSlices();
  }

  function buildSortPermutation(state) {
    return sortBind.buildSortPermutation(state);
  }

  /**
   * @returns {{ col: string, dirStr: string, dir: 1|-1, secondary: string, wisdomSlice: number }[]}
   */
  function collectSortCacheJobSpecs(currentWisdom) {
    return sortBind.collectSortCacheJobSpecs(currentWisdom);
  }

  /**
   * How many permutation workers to run after price matrices are built (one matrix pass, then this many).
   * Targets ~SORT_CACHE_JOBS_PER_PERM_WORKER jobs per worker to limit clone/startup overhead,
   * capped by logical cores and SORT_CACHE_PERM_WORKER_MAX.
   * @param {number} jobCount
   */
  function getSortCachePermWorkerCount(jobCount) {
    if (jobCount <= 0) return 0;
    let hc = 4;
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      hc = navigator.hardwareConcurrency;
    }
    const maxK = Math.min(SORT_CACHE_PERM_WORKER_MAX, hc);
    const kFromBatch = Math.ceil(jobCount / SORT_CACHE_JOBS_PER_PERM_WORKER);
    return Math.max(1, Math.min(maxK, kFromBatch));
  }

  /**
   * @template T
   * @param {T[]} jobs
   * @param {number} k
   * @returns {T[][]}
   */
  function splitJobsIntoChunks(jobs, k) {
    /** @type {T[][]} */
    const chunks = new Array(k);
    const n = jobs.length;
    if (k <= 0) return chunks;
    if (n === 0) {
      for (let i = 0; i < k; i++) {
        chunks[i] = [];
      }
      return chunks;
    }
    const base = Math.floor(n / k);
    const rem = n % k;
    let off = 0;
    for (let i = 0; i < k; i++) {
      const sz = i < rem ? base + 1 : base;
      chunks[i] = jobs.slice(off, off + sz);
      off += sz;
    }
    return chunks;
  }

  function terminateSortCacheWorkers() {
    for (let i = 0; i < sortCacheWorkers.length; i++) {
      const w = sortCacheWorkers[i];
      if (w) {
        w.onmessage = null;
        w.onerror = null;
        w.terminate();
      }
    }
    sortCacheWorkers = [];
  }

  function terminateSortCacheMatrixWorker() {
    if (!sortCacheMatrixWorker) return;
    sortCacheMatrixWorker.onmessage = null;
    sortCacheMatrixWorker.onerror = null;
    sortCacheMatrixWorker.terminate();
    sortCacheMatrixWorker = null;
  }

  function cancelBackgroundSortPermCacheBuild() {
    cancelSortPermPersistTimer();
    terminateSortCacheMatrixWorker();
    terminateSortCacheWorkers();
    if (sortPermCacheIdleId == null) return;
    if (typeof cancelIdleCallback === "function") {
      cancelIdleCallback(sortPermCacheIdleId);
    } else {
      clearTimeout(sortPermCacheIdleId);
    }
    sortPermCacheIdleId = null;
  }

  function applySortMatricesFromWorker(n, buyBuf, sellBuf, compBuf, profitBuf) {
    sortBind.applyMatricesFromWorkerBuffers(n, buyBuf, sellBuf, compBuf, profitBuf);
  }

  function updateSortPrecalcDebugPanel() {
    const root = document.getElementById("sort-precalc-debug");
    const countEl = document.getElementById("sort-precalc-count");
    const totalEl = document.getElementById("sort-precalc-total");
    const fillEl = document.getElementById("sort-precalc-bar-fill");
    const barEl = document.getElementById("sort-precalc-bar");
    if (!root || !countEl || !totalEl || !fillEl || !barEl) return;
    const total = sortCacheJobTotalCount;
    const done = sortPermCache.size;
    countEl.textContent = String(done);
    totalEl.textContent = String(total);
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 1000) / 10) : 100;
    fillEl.style.width = pct + "%";
    barEl.setAttribute("aria-valuenow", String(Math.round(pct)));
    barEl.setAttribute("aria-valuemin", "0");
    barEl.setAttribute("aria-valuemax", "100");
  }

  function fnv1a32Update(h, str) {
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  /**
   * Identifies the catalog for sort-cache persistence (item order, recipes, block stats).
   */
  function computeCatalogSortPermFingerprint(itemsPayload, blockTypesPayload) {
    let h = 2166136261 >>> 0;
    h = fnv1a32Update(h, "sortperm:" + SORT_PERM_PERSIST_SCHEMA + "\0");
    const list = itemsPayload.ItemList;
    h = fnv1a32Update(h, String(list.length));
    for (let i = 0; i < list.length; i++) {
      const name = list[i] && list[i].name;
      h = fnv1a32Update(h, typeof name === "string" ? name : "");
      h = fnv1a32Update(h, "\0");
    }
    h = fnv1a32Update(h, "src:");
    h = fnv1a32Update(h, String(itemsPayload.source || ""));
    h = fnv1a32Update(h, "recsrc:");
    h = fnv1a32Update(h, String(itemsPayload.recipeSource || ""));
    h = fnv1a32Update(h, "rp:");
    h = fnv1a32Update(h, JSON.stringify(itemsPayload.recipesByProduct));
    h = fnv1a32Update(h, "ri:");
    h = fnv1a32Update(h, JSON.stringify(itemsPayload.recipesByIngredient));
    h = fnv1a32Update(h, "bt:");
    h = fnv1a32Update(h, JSON.stringify(blockTypesPayload));
    return "sp" + SORT_PERM_PERSIST_SCHEMA + "-" + h.toString(16);
  }

  function getSortPermDb() {
    if (typeof indexedDB === "undefined") return Promise.resolve(null);
    if (sortPermDbPromise) return sortPermDbPromise;
    sortPermDbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(SORT_PERM_IDB_NAME, SORT_PERM_IDB_VER);
      req.onerror = function () {
        sortPermDbPromise = null;
        reject(req.error);
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(SORT_PERM_STORE)) {
          db.createObjectStore(SORT_PERM_STORE);
        }
      };
    });
    return sortPermDbPromise;
  }

  async function restoreSortPermCacheFromDisk(catalogId) {
    if (!catalogId || typeof indexedDB === "undefined") return;
    try {
      const db = await getSortPermDb();
      if (!db) return;
      const record = await new Promise(function (resolve, reject) {
        const tx = db.transaction(SORT_PERM_STORE, "readonly");
        const store = tx.objectStore(SORT_PERM_STORE);
        const req = store.get(catalogId);
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
      if (
        !record ||
        typeof record !== "object" ||
        !record.entries ||
        typeof record.entries !== "object"
      ) {
        return;
      }
      if (record.v !== SORT_PERM_PERSIST_SCHEMA) return;
      const n = data.ItemList.length;
      const keys = Object.keys(record.entries);
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const buf = record.entries[key];
        if (!(buf instanceof ArrayBuffer)) continue;
        const perm = new Int32Array(buf);
        if (perm.length !== n) continue;
        sortPermCache.set(key, perm);
      }
    } catch (e) {
      console.warn("[Windforge item catalog] sort perm cache restore failed", e);
    }
  }

  async function persistSortPermCacheToDiskNow(epochForGen, catalogIdForWrite) {
    if (epochForGen !== sortCacheBuildEpoch) return;
    const catalogId = catalogIdForWrite || sortPermCacheCatalogId;
    if (!catalogId || sortPermCache.size === 0 || typeof indexedDB === "undefined") return;
    try {
      const db = await getSortPermDb();
      if (!db) return;
      const entries = {};
      sortPermCache.forEach(function (perm, key) {
        if (!(perm instanceof Int32Array)) return;
        entries[key] = perm.buffer.slice(
          perm.byteOffset,
          perm.byteOffset + perm.byteLength
        );
      });
      await new Promise(function (resolve, reject) {
        const tx = db.transaction(SORT_PERM_STORE, "readwrite");
        const store = tx.objectStore(SORT_PERM_STORE);
        const req = store.put(
          { v: SORT_PERM_PERSIST_SCHEMA, entries: entries },
          catalogId
        );
        req.onsuccess = function () {
          resolve(undefined);
        };
        req.onerror = function () {
          reject(req.error);
        };
      });
    } catch (e) {
      console.warn("[Windforge item catalog] sort perm cache persist failed", e);
    }
  }

  function cancelSortPermPersistTimer() {
    if (sortPermPersistTimer != null) {
      clearTimeout(sortPermPersistTimer);
      sortPermPersistTimer = null;
    }
  }

  function scheduleSortPermCachePersist() {
    if (typeof indexedDB === "undefined") return;
    const capturedEpoch = sortCacheBuildEpoch;
    const capturedCatalogId = sortPermCacheCatalogId;
    cancelSortPermPersistTimer();
    sortPermPersistTimer = setTimeout(function () {
      sortPermPersistTimer = null;
      void persistSortPermCacheToDiskNow(capturedEpoch, capturedCatalogId);
    }, 1500);
  }

  function flushSortPermCachePersist() {
    cancelSortPermPersistTimer();
    const epoch = sortCacheBuildEpoch;
    const catalogId = sortPermCacheCatalogId;
    void persistSortPermCacheToDiskNow(epoch, catalogId);
  }

  /**
   * Console: `await __windforgeNukeSortPermCache()` — clears in-memory sort permutations,
   * deletes IndexedDB (`windforge-item-catalog`), invalidates price matrices, and rebuilds cache.
   */
  async function nukeSortPermCacheFromConsole() {
    cancelBackgroundSortPermCacheBuild();
    sortCacheBuildEpoch++;
    sortPermCache.clear();
    sortBind.invalidatePriceMatricesCache();
    if (typeof indexedDB !== "undefined") {
      const p = sortPermDbPromise;
      sortPermDbPromise = null;
      if (p) {
        try {
          const db = await p;
          if (db) db.close();
        } catch (e) {
          /* ignore */
        }
      }
      await new Promise(function (resolve) {
        const req = indexedDB.deleteDatabase(SORT_PERM_IDB_NAME);
        req.onsuccess = function () {
          resolve(undefined);
        };
        req.onerror = function () {
          resolve(undefined);
        };
        req.onblocked = function () {
          resolve(undefined);
        };
      });
    }
    updateSortPrecalcDebugPanel();
    const debugRoot = document.getElementById("sort-precalc-debug");
    if (debugRoot) debugRoot.hidden = true;
    render();
    scheduleBackgroundSortPermCacheBuild();
    console.log(
      "[Windforge item catalog] Sort permutation cache cleared (memory + IndexedDB). Rebuilding…"
    );
  }

  function scheduleIdleSortCacheBuild(epoch, jobs) {
    let ji = 0;

    function scheduleNext() {
      if (typeof requestIdleCallback === "function") {
        sortPermCacheIdleId = requestIdleCallback(runIdle, { timeout: 8000 });
      } else {
        sortPermCacheIdleId = setTimeout(runTimeout, 0);
      }
    }

    function runIdle(deadline) {
      sortPermCacheIdleId = null;
      if (epoch !== sortCacheBuildEpoch) return;
      ensurePriceMatricesForPrecomputedSlices();
      while (ji < jobs.length) {
        if (
          deadline &&
          typeof deadline.timeRemaining === "function" &&
          deadline.timeRemaining() < 2
        ) {
          scheduleNext();
          return;
        }
        const job = jobs[ji++];
        const key = sortCacheKey(
          job.col,
          job.dirStr,
          job.secondary,
          job.wisdomSlice
        );
        if (sortPermCache.has(key)) continue;
        const perm = buildSortPermutation({
          col: job.col,
          dir: job.dir,
          secondary: job.secondary,
          wisdom: job.wisdomSlice,
        });
        sortPermCache.set(key, perm);
        updateSortPrecalcDebugPanel();
        scheduleSortPermCachePersist();
      }
      updateSortPrecalcDebugPanel();
      if (ji >= jobs.length) {
        flushSortPermCachePersist();
      }
    }

    function runTimeout() {
      sortPermCacheIdleId = null;
      if (epoch !== sortCacheBuildEpoch) return;
      ensurePriceMatricesForPrecomputedSlices();
      while (ji < jobs.length) {
        const job = jobs[ji++];
        const key = sortCacheKey(
          job.col,
          job.dirStr,
          job.secondary,
          job.wisdomSlice
        );
        if (sortPermCache.has(key)) continue;
        const perm = buildSortPermutation({
          col: job.col,
          dir: job.dir,
          secondary: job.secondary,
          wisdom: job.wisdomSlice,
        });
        sortPermCache.set(key, perm);
        updateSortPrecalcDebugPanel();
        scheduleSortPermCachePersist();
        break;
      }
      if (ji < jobs.length) {
        scheduleNext();
      } else {
        updateSortPrecalcDebugPanel();
        flushSortPermCachePersist();
      }
    }

    if (jobs.length === 0) {
      updateSortPrecalcDebugPanel();
      return;
    }
    scheduleNext();
  }

  /**
   * Fills {@link sortPermCache} after load: prefers a Web Worker; falls back to idle callbacks.
   * Price-column jobs use {@link wisdomSlicesOrderedForJobs} so the current wisdom slice is built first.
   */
  function scheduleBackgroundSortPermCacheBuild() {
    cancelBackgroundSortPermCacheBuild();
    const epoch = sortCacheBuildEpoch;
    const cw = wisdomStat;
    sortCacheJobTotalCount =
      data.ItemList.length === 0 ? 0 : collectSortCacheJobSpecs(cw).length;
    const allJobs = collectSortCacheJobSpecs(cw);
    const pendingJobs = [];
    for (let i = 0; i < allJobs.length; i++) {
      const job = allJobs[i];
      const key = sortCacheKey(job.col, job.dirStr, job.secondary, job.wisdomSlice);
      if (!sortPermCache.has(key)) pendingJobs.push(job);
    }

    const debugRoot = document.getElementById("sort-precalc-debug");
    updateSortPrecalcDebugPanel();

    if (pendingJobs.length === 0) {
      if (debugRoot) debugRoot.hidden = true;
      return;
    }

    if (debugRoot) debugRoot.hidden = false;

    if (typeof Worker !== "undefined") {
      try {
        const sortWorkerPayload = {
          ItemList: data.ItemList,
          recipesByProduct: data.recipesByProduct,
          recipesByIngredient: data.recipesByIngredient,
          blockTypes: blockTypes,
        };

        function hideSortPrecalcWhenComplete() {
          setTimeout(function () {
            const r = document.getElementById("sort-precalc-debug");
            if (
              r &&
              sortCacheJobTotalCount > 0 &&
              sortPermCache.size >= sortCacheJobTotalCount
            ) {
              r.hidden = true;
            }
          }, 2500);
        }

        function failSortCacheWorkerBuild(ev, fallbackMsg) {
          const msg =
            ev && typeof ev === "object" && "message" in ev && ev.message
              ? ev.message
              : fallbackMsg || "[Windforge item catalog] sort-cache worker error";
          console.warn(msg, ev);
          terminateSortCacheMatrixWorker();
          terminateSortCacheWorkers();
          scheduleIdleSortCacheBuild(epoch, pendingJobs);
        }

        let permWorkersRemaining = 0;

        function attachPermWorkerHandlers(w) {
          w.onmessage = function (ev) {
            const m = ev.data;
            if (!m || m.epoch !== epoch || m.epoch !== sortCacheBuildEpoch) return;
            if (m.type === "job") {
              sortPermCache.set(m.key, new Int32Array(m.perm));
              updateSortPrecalcDebugPanel();
              scheduleSortPermCachePersist();
              return;
            }
            if (m.type === "done") {
              permWorkersRemaining--;
              if (permWorkersRemaining <= 0) {
                terminateSortCacheWorkers();
                updateSortPrecalcDebugPanel();
                hideSortPrecalcWhenComplete();
                flushSortPermCachePersist();
              }
              return;
            }
            if (m.type === "error") {
              console.warn("[Windforge item catalog] sort-cache worker:", m.message);
              failSortCacheWorkerBuild(null, m.message);
            }
          };
          w.onerror = function (ev) {
            failSortCacheWorkerBuild(
              ev,
              "[Windforge item catalog] sort-cache worker load error"
            );
          };
        }

        /**
         * One pipeline for all cases: (1) matrix worker builds price matrices once and posts buffers;
         * (2) N permutation workers each get the same catalog payload (structured clone per worker —
         * workers cannot share JS graphs) plus matrix buffer copies and a job chunk.
         */
        const permCount = getSortCachePermWorkerCount(pendingJobs.length);
        const chunks = splitJobsIntoChunks(pendingJobs, permCount);

        sortCacheMatrixWorker = createSortCacheWorker();
        sortCacheMatrixWorker.onmessage = function (ev) {
          const m = ev.data;
          if (!m || m.epoch !== epoch || m.epoch !== sortCacheBuildEpoch) return;
          if (m.type === "matrices") {
            applySortMatricesFromWorker(m.n, m.buy, m.sell, m.comp, m.profit);
            terminateSortCacheMatrixWorker();
            if (epoch !== sortCacheBuildEpoch) return;
            /**
             * Spawning all permutation workers in one synchronous block blocks the main thread:
             * each postMessage structurally clones the full catalog, and each worker needs four
             * matrix buffer slices. Spread work across frames so the UI can paint.
             */
            const k = permCount;
            permWorkersRemaining = k;
            sortCacheWorkers = [];
            let permSpawnIndex = 0;
            function spawnNextPermutationWorker() {
              if (epoch !== sortCacheBuildEpoch) return;
              if (permSpawnIndex >= k) return;
              const pw = createSortCacheWorker();
              sortCacheWorkers.push(pw);
              attachPermWorkerHandlers(pw);
              const buyBuf = m.buy.slice(0);
              const sellBuf = m.sell.slice(0);
              const compBuf = m.comp.slice(0);
              const profitBuf = m.profit.slice(0);
              pw.postMessage(
                {
                  type: "runPermutations",
                  epoch: epoch,
                  payload: sortWorkerPayload,
                  jobs: chunks[permSpawnIndex],
                  n: m.n,
                  buy: buyBuf,
                  sell: sellBuf,
                  comp: compBuf,
                  profit: profitBuf,
                },
                [buyBuf, sellBuf, compBuf, profitBuf]
              );
              permSpawnIndex++;
              if (permSpawnIndex < k) {
                requestAnimationFrame(spawnNextPermutationWorker);
              }
            }
            requestAnimationFrame(spawnNextPermutationWorker);
            return;
          }
          if (m.type === "error") {
            console.warn("[Windforge item catalog] sort-cache matrix worker:", m.message);
            failSortCacheWorkerBuild(null, m.message);
          }
        };
        sortCacheMatrixWorker.onerror = function (ev) {
          failSortCacheWorkerBuild(
            ev,
            "[Windforge item catalog] sort-cache matrix worker load error"
          );
        };
        requestAnimationFrame(function scheduleMatrixWorkerStart() {
          if (epoch !== sortCacheBuildEpoch) return;
          if (!sortCacheMatrixWorker) return;
          sortCacheMatrixWorker.postMessage({
            type: "buildMatrices",
            epoch: epoch,
            payload: sortWorkerPayload,
          });
        });
        return;
      } catch (e) {
        console.warn("[Windforge item catalog] Worker unavailable, using idle sort build", e);
        terminateSortCacheMatrixWorker();
        terminateSortCacheWorkers();
      }
    }

    scheduleIdleSortCacheBuild(epoch, pendingJobs);
  }

  /**
   * After a synchronous filter+sort, record the full-list permutation for this key on idle so the
   * background builder skips it and later renders can use the fast path.
   */
  function scheduleSortPermCacheFill(col, dirStr, secondary, wisdomSlice) {
    const permKey = sortCacheKey(col, dirStr, secondary, wisdomSlice);
    if (sortPermCache.has(permKey)) return;
    const epoch = sortCacheBuildEpoch;
    function run() {
      if (epoch !== sortCacheBuildEpoch) return;
      if (sortPermCache.has(permKey)) return;
      if (
        PRICE_SORT_COLUMN_IDS.has(col) &&
        PRECOMPUTED_WISDOM_SLICE_SET.has(wisdomSlice)
      ) {
        ensurePriceMatricesForPrecomputedSlices();
      }
      const dir = dirStr === "asc" ? 1 : -1;
      const perm = buildSortPermutation({
        col: col,
        dir: dir,
        secondary: secondary,
        wisdom: wisdomSlice,
      });
      if (epoch !== sortCacheBuildEpoch) return;
      if (sortPermCache.has(permKey)) return;
      sortPermCache.set(permKey, perm);
      scheduleSortPermCachePersist();
    }
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 4000 });
    } else {
      setTimeout(run, 0);
    }
  }

  function rebuildItemIndexByName() {
    itemIndexByName.clear();
    const items = data.ItemList;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it && typeof it.name === "string" && it.name) {
        itemIndexByName.set(it.name, i);
      }
    }
  }

  function buildThead() {
    const thead = document.getElementById("thead");
    thead.innerHTML = "";
    const tr = document.createElement("tr");
    function appendDiagonalHeaderLabel(th, text) {
      const wrap = document.createElement("span");
      wrap.className = "num-diagonal-wrap";
      const label = document.createElement("span");
      label.className = "num-diagonal-label";
      const labelText = document.createElement("span");
      labelText.className = "num-diagonal-label-text";
      labelText.textContent = text;
      label.appendChild(labelText);
      wrap.appendChild(label);
      th.appendChild(wrap);
    }

    const cols = visibleColumns();
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const th = document.createElement("th");
      th.setAttribute("scope", "col");

      if (col.id === "icon") {
        th.className = "col-icon";
        th.textContent = col.label;
      } else if (!col.sortable) {
        if (col.id === "json") {
          th.className = "col-json num-diagonal hdr-diagonal-json";
          appendDiagonalHeaderLabel(th, col.label);
        } else {
        th.textContent = col.label;
        }
      } else {
        let cls =
          col.rtDamageKey ||
          isClothingStatColumnDef(col) ||
          isPlaceBlockStatColumnDef(col) ||
          isGrapplingHookStatColumnDef(col) ||
          isPlaceableSetupStatColumnDef(col) ||
          isPropulsionPlaceItemStatColumnDef(col) ||
          isEnginePlaceItemStatColumnDef(col) ||
          isGrinderPlaceItemStatColumnDef(col) ||
          isArtilleryShipItemStatColumnDef(col) ||
          (col.id &&
            (col.id.indexOf("dmg") === 0 || col.id.indexOf("melee") === 0))
            ? "sortable col-melee-dmg"
            : "sortable";
        const isNum = col.type === "number";
        const isDiagonalNum = isNum;
        if (isNum) cls += " num";
        if (isDiagonalNum) cls += " num-diagonal hdr-diagonal-stat";
        th.className = cls;
        th.dataset.sort = col.id;
        const active = col.id === sortColumn;
        th.setAttribute(
          "aria-sort",
          active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        );
        const hint = document.createElement("span");
        hint.className = "sort-hint";
        hint.setAttribute("aria-hidden", "true");
        if (isDiagonalNum) {
          appendDiagonalHeaderLabel(th, col.label);
          th.appendChild(hint);
        } else {
          const inner = document.createElement("span");
          inner.className = "col-header-inner";
          const row = document.createElement("span");
          row.className = "col-header-label-row";
          const labelSpan = document.createElement("span");
          labelSpan.className = "col-header-label";
          labelSpan.textContent = col.label;
          row.appendChild(hint);
          row.appendChild(labelSpan);
          inner.appendChild(row);
          th.appendChild(inner);
        }
      }
      tr.appendChild(th);
    }
    thead.appendChild(tr);
  }

  function appendIconToCell(td, item) {
    const reused = liveIconNodeByItemName.get(item.name);
    if (reused) {
      td.appendChild(reused);
      return;
    }

    const url = iconUrlFor(item);
      const img = document.createElement("img");
      img.loading = "lazy";
      const tk = tintCacheKey(url, item);
    const hadTintCache = Boolean(tk && tintedIconDataUrlCache.get(tk));
    wireCatalogItemIcon(img, item, url, {
      onLoadError() {
        throw new Error("Icon decode failed for " + String(item && item.name) + ": " + String(url));
      },
    });
    liveIconNodeByItemName.set(item.name, img);
          td.appendChild(img);
    if (hadTintCache) {
      bindRecipeHover(img, item);
          return;
        }
    const iconNode = td.querySelector(".item-icon");
    if (iconNode) {
      bindRecipeHover(iconNode, item);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderRow(item, rowIndex) {
    const tr = document.createElement("tr");
    tr.className = "v-row";
    tr.dataset.vIndex = String(rowIndex);
    if (rowIndex % 2 === 1) {
      tr.classList.add("is-stripe");
    }

    const cols = visibleColumns();
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const td = document.createElement("td");

      switch (col.id) {
        case "icon":
          td.className = "col-icon";
          appendIconToCell(td, item);
          bindRecipeHover(td, item);
          break;
        case "display":
          td.textContent = displayName(item);
          break;
        case "name": {
          const code = document.createElement("code");
          const raw = item.name;
          code.textContent = raw ? injectCamelCaseBreaks(raw) : "—";
          td.className = "col-name";
          td.appendChild(code);
          break;
        }
        case "objectType":
          td.textContent = item.objectType;
          break;
        case "buy": {
          const pr = prices(item);
          td.className = "num";
          td.textContent = pr.buy != null ? formatPriceWithSpaces(pr.buy) : "—";
          break;
        }
        case "sell": {
          const pr = prices(item);
          td.className = "num";
          td.textContent = pr.sell != null ? formatPriceWithSpaces(pr.sell) : "—";
          break;
        }
        case "componentSell": {
          const v = componentSellPrice(item);
          td.className = "num";
          td.textContent = v != null ? formatPriceWithSpaces(v) : "";
          break;
        }
        case "profit": {
          const v = profitValue(item);
          td.className = "num";
          td.textContent = v != null ? formatPriceWithSpaces(v) : "";
          break;
        }
        case "description": {
          td.className = "col-desc";
          const full = description(item);
          const inner = document.createElement("div");
          inner.className = "col-desc-text";
          inner.textContent = full || "—";
          td.appendChild(inner);
          if (full) td.title = full;
          break;
        }
        case "dmgPhysical": {
          td.className = "num col-melee-dmg";
          const dPhys = getMeleeDamageDesc(item);
          td.textContent = formatCatalogStatNumber(
            dPhys && typeof dPhys.physicalDamage === "number" ? dPhys.physicalDamage : null,
            {
              hideZero: true,
              decimals: getColumnStatDecimals("dmgPhysical"),
            }
          );
          break;
        }
        case "meleeTimeBetweenAttacks": {
          td.className = "num col-melee-dmg";
          const mAtk = getMeleeWeaponSetup(item);
          td.textContent = formatCatalogStatNumber(
            mAtk && typeof mAtk.timeBetweenAttacks === "number" ? mAtk.timeBetweenAttacks : null,
            {
              hideZero: false,
              decimals: getColumnStatDecimals("meleeTimeBetweenAttacks"),
            }
          );
          break;
        }
        case "meleeAttackRange": {
          td.className = "num col-melee-dmg";
          const mRng = getMeleeWeaponSetup(item);
          td.textContent = formatCatalogStatNumber(
            mRng && typeof mRng.attackRange === "number" ? mRng.attackRange : null,
            {
              hideZero: false,
              decimals: getColumnStatDecimals("meleeAttackRange"),
            }
          );
          break;
        }
        case "dmgKnockback": {
          td.className = "num col-melee-dmg";
          const dKb = getMeleeDamageDesc(item);
          td.textContent = formatCatalogStatNumber(
            dKb && typeof dKb.knockbackMagnitude === "number" ? dKb.knockbackMagnitude : null,
            {
              hideZero: true,
              decimals: getColumnStatDecimals("dmgKnockback"),
            }
          );
          break;
        }
        case "json": {
          td.className = "col-json";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "json-open-btn";
          btn.textContent = "JSON";
          btn.addEventListener("click", function (e) {
            e.stopPropagation();
            openJsonDialog(item);
          });
          td.appendChild(btn);
          break;
        }
        default: {
          const colDef = COLUMN_BY_ID[col.id];
          if (colDef) renderStatCellFromColumnDef(td, item, colDef);
          else td.textContent = "—";
        }
      }
      tr.appendChild(td);
    }
    tr._item = item;
    return tr;
  }

  function spacerRow(pixelHeight) {
    const tr = document.createElement("tr");
    tr.className = "v-spacer";
    const td = document.createElement("td");
    td.colSpan = visibleColumns().length;
    td.style.height = pixelHeight + "px";
    td.setAttribute("aria-hidden", "true");
    tr.appendChild(td);
    return tr;
  }

  function renderVirtualBody() {
    const tbody = document.getElementById("tbody");
    const wrap = getBodyScrollPort();

    if (!rowHeightSynced) {
      const cssV = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue("--v-row-height")
      );
      if (Number.isFinite(cssV) && cssV > 0) ROW_HEIGHT = Math.round(cssV);
      rowHeightSynced = true;
    }

    const list = virtualList;
    const total = list.length;

    if (total === 0) {
      tbody.innerHTML = "";
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = visibleColumns().length;
      td.textContent = "No matching items.";
      td.style.textAlign = "center";
      td.style.padding = "1.25rem";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }

    if (!rowHeights || rowHeights.length !== total) {
      rowHeights = new Array(total);
      for (let i = 0; i < total; i++) rowHeights[i] = ROW_HEIGHT;
      prefixHeights = null;
      virtualHeightsDirty = true;
    }

    if (!prefixHeights || virtualHeightsDirty) {
      prefixHeights = new Array(total + 1);
      let acc = 0;
      prefixHeights[0] = 0;
      for (let i = 0; i < total; i++) {
        const h = rowHeights[i];
        acc += Number.isFinite(h) && h > 0 ? h : ROW_HEIGHT;
        prefixHeights[i + 1] = acc;
      }
      virtualHeightsDirty = false;
    }

    const viewportH = Math.max(1, wrap.clientHeight);
    const st = wrap.scrollTop;
    const pxTop = Math.max(0, st - virtualPadTop);
    const pxBottom = Math.max(pxTop, st + viewportH - 1 - virtualPadTop);

    function upperBound(arr, x) {
      // first index where arr[i] > x
      let lo = 0;
      let hi = arr.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (arr[mid] <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    }

    const firstVisible = Math.min(total - 1, Math.max(0, upperBound(prefixHeights, pxTop) - 1));
    const lastVisible = Math.min(
      total - 1,
      Math.max(0, upperBound(prefixHeights, pxBottom) - 1)
    );

    const startIdx = Math.max(0, firstVisible - VIRTUAL_OVERSCAN);
    const endIdx = Math.min(total - 1, lastVisible + VIRTUAL_OVERSCAN);

    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();

    if (startIdx > 0) {
      frag.appendChild(spacerRow(virtualPadTop + prefixHeights[startIdx]));
    } else if (virtualPadTop > 0) {
      frag.appendChild(spacerRow(virtualPadTop));
    }
    for (let i = startIdx; i <= endIdx; i++) {
      frag.appendChild(renderRow(list[i], i));
    }
    if (endIdx < total - 1) {
      frag.appendChild(
        spacerRow(prefixHeights[total] - prefixHeights[endIdx + 1] + virtualPadBottom)
      );
    } else if (virtualPadBottom > 0) {
      frag.appendChild(spacerRow(virtualPadBottom));
    }
    tbody.appendChild(frag);

    const scrollTopForRender = st;
    requestAnimationFrame(function () {
      // If the user kept scrolling, avoid an extra layout pass that could fight the scroll.
      const stNow = wrap.scrollTop;
      const stillClose = Math.abs(stNow - scrollTopForRender) <= 1.5;

      const rendered = tbody.querySelectorAll('tr.v-row[data-v-index]');
      let changed = false;
      for (let i = 0; i < rendered.length; i++) {
        const el = rendered[i];
        const idx = Number(el.dataset.vIndex);
        if (!Number.isFinite(idx) || idx < 0 || idx >= total) continue;
        const h = Math.round(el.getBoundingClientRect().height);
        const prev = rowHeights[idx];
        if (!Number.isFinite(prev) || Math.abs(prev - h) >= 1) {
          rowHeights[idx] = h;
          changed = true;
        }
      }

      if (changed) {
        virtualHeightsDirty = true;
        if (stillClose && heightAutoRerenders < 2) {
          heightAutoRerenders++;
          renderVirtualBody();
        }
      }
    });
  }

  function scheduleVirtualRefresh() {
    if (virtualScrollRaf != null) return;
    heightAutoRerenders = 0;
    virtualScrollRaf = requestAnimationFrame(function () {
      virtualScrollRaf = null;
      renderVirtualBody();
    });
  }

  function ensureVirtualScrollListeners() {
    const wrap = getBodyScrollPort();
    if (!virtualScrollAttached) {
      virtualScrollAttached = true;
      wrap.addEventListener(
        "wheel",
        function (e) {
          // Preserve browser/page zoom gestures (Ctrl/Cmd + wheel).
          if (e.ctrlKey || e.metaKey) return;
          let dy = e.deltaY;
          if (e.deltaMode === 1) dy *= 16;
          else if (e.deltaMode === 2) dy *= wrap.clientHeight;
          if (!dy) return;

          // Mouse wheel notch mode: one item per notch. Keep trackpad/native smooth scrolling.
          const looksLikeWheelNotch = e.deltaMode === 1 || Math.abs(e.deltaY) >= 40;
          if (!looksLikeWheelNotch && virtualPadTop <= 0 && virtualPadBottom <= 0) return;

          // With variable-height rows, align wheel notches to measured row boundaries.
          if (
            looksLikeWheelNotch &&
            virtualPadTop <= 0 &&
            virtualPadBottom <= 0 &&
            prefixHeights &&
            rowHeights &&
            rowHeights.length === virtualList.length &&
            prefixHeights.length === virtualList.length + 1 &&
            virtualList.length > 0
          ) {
            const dir = Math.sign(dy);
            if (!dir) return;

            const contentTotal = prefixHeights[virtualList.length];
            const contentY = Math.max(0, Math.min(Math.max(0, contentTotal - 1), wrap.scrollTop));

            // first index where prefixHeights[i] > contentY
            let lo = 0;
            let hi = prefixHeights.length;
            while (lo < hi) {
              const mid = (lo + hi) >> 1;
              if (prefixHeights[mid] <= contentY) lo = mid + 1;
              else hi = mid;
            }
            const currentIdx = Math.max(0, Math.min(virtualList.length - 1, lo - 1));
            const targetIdx = Math.max(0, Math.min(virtualList.length - 1, currentIdx + dir));
            const maxScroll = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
            const targetScrollTop = Math.max(0, Math.min(maxScroll, prefixHeights[targetIdx]));
            if (Math.abs(targetScrollTop - wrap.scrollTop) < 0.5) return;
            e.preventDefault();
            wrap.scrollTop = targetScrollTop;
            scheduleVirtualRefresh();
            return;
          }

          let remain = dy;
          if (looksLikeWheelNotch) {
            // Deterministic notch behavior: each wheel event moves exactly one row.
            const dir = Math.sign(dy);
            if (!dir) return;
            remain = dir * ROW_HEIGHT;
          }

          const before = remain;
          if (remain > 0 && virtualPadTop > 0) {
            const used = Math.min(virtualPadTop, remain);
            virtualPadTop -= used;
            remain -= used;
          } else if (remain < 0 && virtualPadBottom > 0) {
            const used = Math.min(virtualPadBottom, -remain);
            virtualPadBottom -= used;
            remain += used;
          }
          if (virtualPadTop < 1) virtualPadTop = 0;
          if (virtualPadBottom < 1) virtualPadBottom = 0;
          if (remain !== before || looksLikeWheelNotch) {
            e.preventDefault();
            if (remain !== 0) {
              const maxScroll = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
              wrap.scrollTop = Math.max(0, Math.min(maxScroll, wrap.scrollTop + remain));
            }
            scheduleVirtualRefresh();
          }
        },
        { passive: false }
      );
      wrap.addEventListener("scroll", scheduleVirtualRefresh, { passive: true });
      wrap.addEventListener(
        "scroll",
        function () {
          const target = getRecipeHoverTargetAtPoint(lastPointerClientX, lastPointerClientY);
          if (!target) {
            if (!recipeTooltipEl.hidden) hideRecipeTooltip();
            return;
          }
          showRecipeTooltipAtPointer(target, lastPointerClientX, lastPointerClientY);
        },
        { passive: true }
      );
    }
    if (!virtualResizeAttached) {
      virtualResizeAttached = true;
      window.addEventListener(
        "resize",
        function () {
          if (virtualResizeTimer != null) clearTimeout(virtualResizeTimer);
          virtualResizeTimer = setTimeout(function () {
            virtualResizeTimer = null;
            renderVirtualBody();
          }, 100);
        },
        { passive: true }
      );
    }
    if (!virtualDocumentWheelAttached) {
      virtualDocumentWheelAttached = true;
      document.addEventListener(
        "wheel",
        function (e) {
          // Preserve browser/page zoom gestures (Ctrl/Cmd + wheel).
          if (e.ctrlKey || e.metaKey) return;
          if (e.defaultPrevented) return;
          const target = e.target;
          if (!target || typeof target.closest !== "function") return;
          // Tooltip custom wheel mode has priority.
          if (
            !recipeTooltipEl.hidden &&
            recipeTooltipScrollArmed &&
            (target.closest("[data-recipe-hover-bound='1']") || target.closest(".recipe-tooltip"))
          ) {
            return;
          }
          if (target.closest("#table-body-scroll")) return;
          // Let overlay/panel/input-specific scroll behavior win.
          if (target.closest(".object-type-dropdown__panel")) return;
          if (target.closest("#json-dialog")) return;
          if (target.closest("input, textarea, select, [contenteditable='true']")) return;

          let dy = e.deltaY;
          if (e.deltaMode === 1) dy *= 16;
          else if (e.deltaMode === 2) dy *= wrap.clientHeight;
          if (!dy) return;

          const maxScroll = Math.max(0, wrap.scrollHeight - wrap.clientHeight);
          const next = Math.max(0, Math.min(maxScroll, wrap.scrollTop + dy));
          if (next === wrap.scrollTop) return;
          e.preventDefault();
          wrap.scrollTop = next;
          scheduleVirtualRefresh();
        },
        { passive: false }
      );
    }
  }

  /**
   * @param {{ profile?: boolean }} [opts]
   */
  function render(opts) {
    const profile = opts && opts.profile;
    const t0 = profile ? performance.now() : 0;

    const q = (document.getElementById("q").value || "").trim();

    if (isObjectTypeFiltered() && sortColumn === "objectType") {
      sortColumn = "display";
    }
    if (!showMeleeWeaponStatColumns() && isMeleeStatsColumnId(sortColumn)) {
      sortColumn = "display";
    }

    const sortDefRt = COLUMN_BY_ID[sortColumn];
    if (sortDefRt && sortDefRt.rtDamageKey && !showRangedThrowableStatColumns()) {
      sortColumn = "display";
    }
    if (sortColumn === "rtChemicalDamage" && !showRtChemicalDamageColumn()) {
      sortColumn = "display";
    }
    const sortDefCloth = COLUMN_BY_ID[sortColumn];
    if (sortDefCloth && isClothingStatColumnDef(sortDefCloth) && !showClothingStatColumns()) {
      sortColumn = "display";
    }
    const sortDefPb = COLUMN_BY_ID[sortColumn];
    if (sortDefPb && isPlaceBlockStatColumnDef(sortDefPb) && !showPlaceBlockStatColumns()) {
      sortColumn = "display";
    }
    if (sortColumn === "pbImpactDmgMult" && !showPlaceBlockImpactColumn()) {
      sortColumn = "display";
    }
    const sortDefGh = COLUMN_BY_ID[sortColumn];
    if (sortDefGh && isGrapplingHookStatColumnDef(sortDefGh) && !showGrapplingHookStatColumns()) {
      sortColumn = "display";
    }
    const sortDefPl = COLUMN_BY_ID[sortColumn];
    if (
      sortDefPl &&
      isPlaceableSetupStatColumnDef(sortDefPl) &&
      !showPlaceableSetupStatColumns()
    ) {
      sortColumn = "display";
    }
    if (sortColumn === "plBuoyancy" && !showPlaceableBuoyancyColumn()) {
      sortColumn = "display";
    }
    const sortDefPpo = COLUMN_BY_ID[sortColumn];
    if (
      sortDefPpo &&
      isPropulsionPlaceItemStatColumnDef(sortDefPpo) &&
      !showPropulsionPlaceItemStatColumns()
    ) {
      sortColumn = "display";
    }
    const sortDefPe = COLUMN_BY_ID[sortColumn];
    if (
      sortDefPe &&
      isEnginePlaceItemStatColumnDef(sortDefPe) &&
      !showEnginePlaceItemStatColumns()
    ) {
      sortColumn = "display";
    }
    const sortDefPg = COLUMN_BY_ID[sortColumn];
    if (
      sortDefPg &&
      isGrinderPlaceItemStatColumnDef(sortDefPg) &&
      !showGrinderPlaceItemStatColumns()
    ) {
      sortColumn = "display";
    }
    const sortDefPa = COLUMN_BY_ID[sortColumn];
    if (
      sortDefPa &&
      isArtilleryShipItemStatColumnDef(sortDefPa) &&
      !showArtilleryShipItemStatColumns()
    ) {
      sortColumn = "display";
    }

    const t1 = profile ? performance.now() : 0;

    const dirStr = sortDir === "asc" ? "asc" : "desc";
    const wisdomSlice = PRICE_SORT_COLUMN_IDS.has(sortColumn) ? wisdomStat : 0;
    const permKey = sortCacheKey(sortColumn, dirStr, secondarySortMode, wisdomSlice);
    const perm = sortPermCache.get(permKey);
    const nItems = data.ItemList.length;

    let list;
    if (perm && perm.length === nItems) {
      list = [];
      for (let pi = 0; pi < perm.length; pi++) {
        const item = data.ItemList[perm[pi]];
        if (
          matchesQuery(item, q) &&
          matchesObjectTypeFilter(item) &&
          passesSpecialFilters(item) &&
          passesTierVariantFilters(item)
        ) {
          list.push(item);
        }
      }
    } else {
      list = data.ItemList.filter(function (it) {
        return (
          matchesQuery(it, q) &&
          matchesObjectTypeFilter(it) &&
          passesSpecialFilters(it) &&
          passesTierVariantFilters(it)
        );
      });
      list.sort(compareItems);
      scheduleSortPermCacheFill(
        sortColumn,
        dirStr,
        secondarySortMode,
        wisdomSlice
      );
    }

    const t2 = profile ? performance.now() : 0;

    const visibleColIds = visibleColumns()
      .map(function (c) {
        return c.id;
      })
      .join(",");
    const statsLayoutKey = computeStatsLayoutCacheKey(
      list,
      wisdomStat,
      visibleColIds
    );
    let t2d;
    let t2w;
    if (statsLayoutKey !== lastStatsLayoutCacheKey) {
      statColumnDecimalsById = computeStatColumnDecimalsForList(list);
      t2d = profile ? performance.now() : 0;
      statColumnWidthPxById = computeStatColumnWidthsForList(
        list,
        statColumnDecimalsById
      );
      t2w = profile ? performance.now() : 0;
      buildColgroup();
      lastStatsLayoutCacheKey = statsLayoutKey;
    } else {
      t2d = profile ? performance.now() : 0;
      t2w = t2d;
    }
    buildThead();
    const t3 = profile ? performance.now() : 0;

    virtualList = list;
    rowHeights = null;
    prefixHeights = null;
    virtualHeightsDirty = true;
    heightAutoRerenders = 0;
    virtualPadTop = 0;
    virtualPadBottom = 0;
    document.getElementById("count").textContent =
      list.length + " / " + data.ItemList.length + " items";

    const wrap = getBodyScrollPort();
    if (wrap) {
      wrap.scrollTop = 0;
    }
    renderVirtualBody();
    ensureVirtualScrollListeners();
    /** Full-catalog token checks are dev diagnostics; defer so sync render profile reflects table work only. */
    (function scheduleRecipeTokenCoverageValidate() {
      var refList = list;
      function run() {
        recipeSortEngine.validateRecipeSortTokenCoverage(
          new Set(refList.map(function (it) { return String(it && it.name || ""); }))
        );
      }
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 4000 });
      } else {
        setTimeout(run, 0);
      }
    })();
    const t4 = profile ? performance.now() : 0;

    schedulePersistUI();
    const t5 = profile ? performance.now() : 0;

    if (profile) {
      const filterMs = t1 - t0;
      const sortMs = t2 - t1;
      const theadMs = t3 - t2;
      const tbodyDomMs = t4 - t3;
      const persistMs = t5 - t4;
      const totalMs = t5 - t0;
      const sumMs = filterMs + sortMs + theadMs + tbodyDomMs + persistMs;
      console.log(
        "[Windforge item catalog] sort / render — sync JS only (ends before layout, paint, images)",
        {
          sortColumn: sortColumn,
          sortDir: sortDir,
          row_count: list.length,
          filter_ms: Number(filterMs.toFixed(3)),
          sort_ms: Number(sortMs.toFixed(3)),
          thead_ms: Number(theadMs.toFixed(3)),
          stat_decimals_ms: Number((t2d - t2).toFixed(3)),
          col_width_ms: Number((t2w - t2d).toFixed(3)),
          colgroup_thead_ms: Number((t3 - t2w).toFixed(3)),
          tbody_dom_ms: Number(tbodyDomMs.toFixed(3)),
          persist_ms: Number(persistMs.toFixed(3)),
          sum_ms: Number(sumMs.toFixed(3)),
          total_ms: Number(totalMs.toFixed(3)),
          check_ms: Number((totalMs - sumMs).toFixed(6)),
        }
      );
      /** Double rAF ≈ after style/layout/paint for the new DOM (still before most img decode/tint). */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          const afterFramesMs = performance.now() - t0;
          console.log(
            "[Windforge item catalog] sort / render — after next animation frames (layout/paint)",
            {
              since_sort_click_ms: Number(afterFramesMs.toFixed(3)),
              beyond_sync_script_ms: Number((afterFramesMs - totalMs).toFixed(3)),
            }
          );
        });
      });
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(
          function () {
            const idleMs = performance.now() - t0;
            console.log(
              "[Windforge item catalog] sort / render — first idle callback (main thread quiet; may still decode images after)",
              {
                since_sort_click_ms: Number(idleMs.toFixed(3)),
                beyond_sync_script_ms: Number((idleMs - totalMs).toFixed(3)),
              }
            );
          },
          { timeout: 3000 }
        );
      }
    }
  }

  function openJsonDialog(item) {
    const dlg = document.getElementById("json-dialog");
    const pre = document.getElementById("json-dialog-pre");
    const titleEl = document.getElementById("json-dialog-title");
    if (titleEl) {
      const n = item && item.name ? String(item.name) : "";
      titleEl.textContent = n ? "Raw data — " + n : "Raw item data";
    }
    pre.textContent = JSON.stringify(item, null, 2);
    if (typeof dlg.showModal === "function") {
      dlg.showModal();
    }
  }

  function initJsonDialog() {
    const dlg = document.getElementById("json-dialog");
    const closeBtn = document.getElementById("json-dialog-close");
    if (closeBtn && dlg) {
      closeBtn.addEventListener("click", function () {
        dlg.close();
      });
    }
    if (dlg) {
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) {
          dlg.close();
        }
      });
    }
  }
  initJsonDialog();

  document.getElementById("thead").addEventListener("click", function (e) {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const id = th.dataset.sort;
    if (!id) return;

    if (id === sortColumn) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortColumn = id;
      sortDir = "asc";
    }
    render({ profile: true });
  });

  document.getElementById("q").addEventListener("input", scheduleRenderFromSearch);
  document.getElementById("filter-object-type").addEventListener("change", render);
  initObjectTypeDropdown();
  initSecondarySortDropdown();
  let sortPrecalcWisdomRestartTimer = null;

  function scheduleSortCacheBuildAfterWisdomChange() {
    if (sortPrecalcWisdomRestartTimer != null) {
      clearTimeout(sortPrecalcWisdomRestartTimer);
    }
    sortPrecalcWisdomRestartTimer = setTimeout(function () {
      sortPrecalcWisdomRestartTimer = null;
      if (!data.ItemList.length) return;
      scheduleBackgroundSortPermCacheBuild();
    }, 400);
  }

  const wisdomEl = document.getElementById("wisdom-stat");
  if (wisdomEl) {
    wisdomEl.addEventListener("input", function () {
      syncWisdomFromInput();
      scheduleRenderFromWisdom();
      scheduleSortCacheBuildAfterWisdomChange();
    });
    wisdomEl.addEventListener("change", function () {
      syncWisdomFromInput();
      scheduleRenderFromWisdom();
      scheduleSortCacheBuildAfterWisdomChange();
    });
  }

  function initWisdomSpinButtons() {
    const input = document.getElementById("wisdom-stat");
    if (!input) return;
    const wrap = input && input.closest(".number-input-spin");
    if (!wrap) return;
    const up = wrap.querySelector(".number-input-spin__btn--up");
    const down = wrap.querySelector(".number-input-spin__btn--down");
    function stepVal() {
      const s = input.step ? parseFloat(input.step) : 1;
      return Number.isFinite(s) && s > 0 ? s : 1;
    }
    function minVal() {
      return input.min !== "" ? parseFloat(input.min) : -Infinity;
    }
    function maxVal() {
      return input.max !== "" ? parseFloat(input.max) : Infinity;
    }
    function bump(delta) {
      let v = parseFloat(input.value);
      if (!Number.isFinite(v)) v = 0;
      const st = stepVal();
      const raw = v + delta * st;
      const snapped = Math.round(raw / st) * st;
      const clamped = Math.min(maxVal(), Math.max(minVal(), snapped));
      input.value = String(clamped);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    function wireSpinHold(btn, delta) {
      let holdStartTimer = null;
      let holdRepeatTimer = null;

      function stopHold() {
        if (holdStartTimer != null) {
          clearTimeout(holdStartTimer);
          holdStartTimer = null;
        }
        if (holdRepeatTimer != null) {
          clearInterval(holdRepeatTimer);
          holdRepeatTimer = null;
        }
      }

      function startHold() {
        bump(delta);
        holdStartTimer = setTimeout(function () {
          holdStartTimer = null;
          holdRepeatTimer = setInterval(function () {
            bump(delta);
          }, 60);
        }, 300);
      }

      btn.addEventListener("mousedown", function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        stopHold();
        startHold();
      });

      window.addEventListener("mouseup", stopHold);
      btn.addEventListener("mouseleave", stopHold);
      btn.addEventListener("blur", stopHold);
      btn.addEventListener("dragstart", function (e) {
        e.preventDefault();
      });

      // Keep keyboard/assistive activation working (detail===0), while mouse path uses mousedown hold.
      btn.addEventListener("click", function (e) {
        if (e.detail !== 0) {
          e.preventDefault();
          return;
        }
        bump(delta);
      });
    }

    if (up) wireSpinHold(up, 1);
    if (down) wireSpinHold(down, -1);

    let keyHoldStartTimer = null;
    let keyHoldRepeatTimer = null;
    let keyHoldDelta = 0;

    function stopKeyHold() {
      keyHoldDelta = 0;
      if (keyHoldStartTimer != null) {
        clearTimeout(keyHoldStartTimer);
        keyHoldStartTimer = null;
      }
      if (keyHoldRepeatTimer != null) {
        clearInterval(keyHoldRepeatTimer);
        keyHoldRepeatTimer = null;
      }
    }

    function startKeyHold(delta) {
      keyHoldDelta = delta;
      bump(delta);
      keyHoldStartTimer = setTimeout(function () {
        keyHoldStartTimer = null;
        keyHoldRepeatTimer = setInterval(function () {
          bump(delta);
        }, 60);
      }, 300);
    }

    input.addEventListener("keydown", function (e) {
      let delta = 0;
      if (e.key === "ArrowUp") delta = 1;
      if (e.key === "ArrowDown") delta = -1;
      if (!delta) return;
      e.preventDefault();
      if (
        keyHoldDelta === delta &&
        (keyHoldStartTimer != null || keyHoldRepeatTimer != null)
      ) {
        return;
      }
      stopKeyHold();
      startKeyHold(delta);
    });

    input.addEventListener("keyup", function (e) {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      stopKeyHold();
    });
    input.addEventListener("blur", stopKeyHold);
  }
  initWisdomSpinButtons();

  const hideSpecialEl = document.getElementById("hide-special-items");
  if (hideSpecialEl) {
    hideSpecialEl.addEventListener("change", render);
  }

  const specialOnlyEl = document.getElementById("show-special-only");
  if (specialOnlyEl) {
    specialOnlyEl.addEventListener("change", render);
  }

  const hideNormalTierEl = document.getElementById("hide-normal-tier");
  if (hideNormalTierEl) {
    hideNormalTierEl.addEventListener("change", render);
  }

  const hideQualityTierEl = document.getElementById("hide-quality-tier");
  if (hideQualityTierEl) {
    hideQualityTierEl.addEventListener("change", render);
  }

  const hideMastercraftTierEl = document.getElementById("hide-mastercraft-tier");
  if (hideMastercraftTierEl) {
    hideMastercraftTierEl.addEventListener("change", render);
  }

  const secondarySortEl = document.getElementById("secondary-sort");
  if (secondarySortEl) {
    secondarySortEl.addEventListener("change", function () {
      secondarySortMode = normalizeSecondarySortMode(secondarySortEl.value);
      render();
      scheduleBackgroundSortPermCacheBuild();
    });
  }

  function publicAssetUrl(file) {
    const base = import.meta.env.BASE_URL;
    return (base.endsWith("/") ? base : base + "/") + file;
  }

  async function load() {
    async function fetchJsonGz(url) {
      if (typeof DecompressionStream !== "function") {
        throw new Error("DecompressionStream unsupported (need itemlist.json.gz).");
      }
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(url + ": " + res.status);
      if (!res.body) throw new Error(url + ": missing response body");
      const ds = new DecompressionStream("gzip");
      const stream = res.body.pipeThrough(ds);
      const text = await new Response(stream).text();
      return JSON.parse(text);
    }

    async function fetchJsonPlain(url) {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(url + ": " + res.status);
      return JSON.parse(await res.text());
    }

    async function fetchCatalogFile(baseName) {
      const gzUrl = publicAssetUrl(baseName + ".json.gz");
      try {
        return await fetchJsonGz(gzUrl);
      } catch (e) {
        if (import.meta.env.DEV) {
          return await fetchJsonPlain(publicAssetUrl(baseName + ".json"));
        }
        throw e;
      }
    }

    const [itemsPayload, blocksPayload] = await Promise.all([
      fetchCatalogFile("itemlist"),
      fetchCatalogFile("sharedblockinfo"),
    ]);

    data = itemsPayload;
    // Strict: required keys must exist in the payload.

    itemByName.clear();
    liveIconNodeByItemName.clear();
    recipeSortEngine.setData(itemsPayload);
    recipeSortEngine.clearCache();
    for (let i = 0; i < data.ItemList.length; i++) {
      const it = data.ItemList[i];
      if (it && typeof it.name === "string" && it.name) {
        itemByName.set(it.name, it);
      }
    }
    sortCacheBuildEpoch++;
    cancelBackgroundSortPermCacheBuild();
    sortPermCache.clear();
    sortBind.invalidatePriceMatricesCache();
    rebuildItemIndexByName();
    recipeTooltipEl = document.getElementById("recipe-tooltip");
    recipeTooltipSubEl = document.getElementById("recipe-tooltip-sub");
    recipeTooltipDeepEl = document.getElementById("recipe-tooltip-deep");
    ensureRecipeTooltipGlobalWatchers();

        blockTypes = {};
    if (
      blocksPayload &&
      blocksPayload.blockTypes &&
      typeof blocksPayload.blockTypes === "object"
    ) {
      blockTypes = blocksPayload.blockTypes;
    }
    sortPermCacheCatalogId = computeCatalogSortPermFingerprint(data, blockTypes);
    await restoreSortPermCacheFromDisk(sortPermCacheCatalogId);
    const persisted = readPersistedUI();
    if (persisted) {
      sortColumn = persisted.sortColumn;
      sortDir = persisted.sortDir;
      secondarySortMode = persisted.secondarySortMode;
    }
    populateObjectTypeFilter(persisted);
    if (secondarySortEl) {
      secondarySortEl.value = secondarySortMode;
      syncSecondarySortDropdownPanel();
    }
    const qEl = document.getElementById("q");
    if (qEl && persisted) {
      qEl.value = persisted.q;
    }
    if (wisdomEl && persisted) {
      wisdomEl.value = String(normalizeWisdomStat(persisted.wisdomStat));
    }
    syncWisdomFromInput();
    const hideSpecialEl = document.getElementById("hide-special-items");
    const specialOnlyEl = document.getElementById("show-special-only");
    const hideNormalTierEl = document.getElementById("hide-normal-tier");
    const hideQualityTierEl = document.getElementById("hide-quality-tier");
    const hideMastercraftTierEl = document.getElementById("hide-mastercraft-tier");
    if (hideSpecialEl && persisted && persisted.hideSpecialItems) {
      hideSpecialEl.checked = true;
    }
    if (specialOnlyEl && persisted && persisted.showSpecialOnly) {
      specialOnlyEl.checked = true;
    }
    if (hideNormalTierEl && persisted && persisted.hideNormalTier) {
      hideNormalTierEl.checked = true;
    }
    if (hideQualityTierEl && persisted && persisted.hideQualityTier) {
      hideQualityTierEl.checked = true;
    }
    if (hideMastercraftTierEl && persisted && persisted.hideMastercraftTier) {
      hideMastercraftTierEl.checked = true;
    }

    render();
    scheduleBackgroundSortPermCacheBuild();
    scheduleBackgroundIconWarmup();
  }

  globalThis.__windforgeNukeSortPermCache = nukeSortPermCacheFromConsole;

load();
