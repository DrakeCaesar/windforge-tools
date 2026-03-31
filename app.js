/**
 * Windforge item catalog — loads itemlist.json produced by extract_itemlist.py
 */

(function () {
  "use strict";

  /** Throw asynchronously (so promise/image callbacks still crash loudly). */
  function fatal(err) {
    setTimeout(function () {
      throw err instanceof Error ? err : new Error(String(err));
    }, 0);
  }

  /** @type {{ ItemList: object[], iconMap: Record<string,string>, iconAtlas?: { image: string, sprites: Record<string, { x: number, y: number, w: number, h: number }> }, itemCount?: number, source?: string, recipesByProduct?: Record<string, object[]>, recipesByIngredient?: Record<string, object[]>, recipeSource?: string }} */
  let data = { ItemList: [], iconMap: {}, recipesByProduct: {}, recipesByIngredient: {} };

  /** Internal item name → item row (for ingredient icons). */
  const itemByName = new Map();

  /** From sharedblockinfo.json: blockType string -> { hitPoints, mass, buoyancy, impactDamageMult }. */
  let blockTypes = {};

  /** @type {string} */
  let sortColumn = "display";
  /** @type {'asc'|'desc'} */
  let sortDir = "asc";

  /** Tie-break when primary sort column compares equal: full internal name vs suffix-grouped (reversed words). */
  const SECONDARY_SORT_INTERNAL_NAME = "name";
  const SECONDARY_SORT_NAME_SUFFIX_WORDS = "nameSuffixWords";

  /** @type {typeof SECONDARY_SORT_INTERNAL_NAME | typeof SECONDARY_SORT_NAME_SUFFIX_WORDS} */
  let secondarySortMode = SECONDARY_SORT_INTERNAL_NAME;
  let wisdomStat = 0;

  function normalizeSecondarySortMode(v) {
    if (v === SECONDARY_SORT_NAME_SUFFIX_WORDS) return SECONDARY_SORT_NAME_SUFFIX_WORDS;
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
   * Store price adjustment:
   * V(s)=ceil(V0*(1±0.0025*s))
   * + for selling, - for buying.
   */
  function applyWisdomPriceModifier(base, isSelling) {
    if (base == null || typeof base !== "number" || Number.isNaN(base)) return null;
    const k = 0.0025;
    const mult = 1 + (isSelling ? 1 : -1) * k * wisdomStat;
    return Math.ceil(base * mult);
  }

  const COLUMNS = [
    { id: "icon", label: "Icon", sortable: false },
    { id: "display", label: "Display name", sortable: true, type: "string" },
    { id: "name", label: "Internal name", sortable: true, type: "string" },
    { id: "objectType", label: "Object type", sortable: true, type: "string" },
    { id: "buy", label: "Buy", sortable: true, type: "number" },
    { id: "sell", label: "Sell", sortable: true, type: "number" },
    {
      id: "componentSell",
      label: "Comp sell",
      sortable: true,
      type: "number",
    },
    {
      id: "profit",
      label: "Profit",
      sortable: true,
      type: "number",
    },
    { id: "description", label: "Description", sortable: true, type: "string" },
    { id: "dmgPhysical", label: "Dmg", sortable: true, type: "number" },
    { id: "meleeTimeBetweenAttacks", label: "Atk interval", sortable: true, type: "number" },
    { id: "meleeAttackRange", label: "Range", sortable: true, type: "number" },
    { id: "dmgKnockback", label: "Knockback", sortable: true, type: "number" },
    {
      id: "rtPhysicalDamage",
      label: "Physical dmg",
      sortable: true,
      type: "number",
      rtDamageKey: "physicalDamage",
    },
    {
      id: "rtElementalDamage",
      label: "Elemental dmg",
      sortable: true,
      type: "number",
      rtDamageKey: "elementalDamage",
    },
    {
      id: "rtChemicalDamage",
      label: "Chemical dmg",
      sortable: true,
      type: "number",
      rtDamageKey: "chemicalDamage",
    },
    {
      id: "rtKnockbackMagnitude",
      label: "Knockback",
      sortable: true,
      type: "number",
      rtDamageKey: "knockbackMagnitude",
    },
    {
      id: "clothAirDrain",
      label: "Air Drain",
      sortable: true,
      type: "number",
      clothingEquipField: "airSupplyDecreaseRate",
    },
    {
      id: "clothTraitWeight",
      label: "Weight",
      sortable: true,
      type: "number",
      clothingTraitKey: "weight",
    },
    {
      id: "clothTraitHealth",
      label: "Health",
      sortable: true,
      type: "number",
      clothingTraitKey: "health",
    },
    {
      id: "clothTraitStrength",
      label: "Strength",
      sortable: true,
      type: "number",
      clothingTraitKey: "strength",
    },
    {
      id: "clothTraitAgility",
      label: "Agility",
      sortable: true,
      type: "number",
      clothingTraitKey: "agility",
    },
    {
      id: "clothTraitIntelligence",
      label: "Intelligence",
      sortable: true,
      type: "number",
      clothingTraitKey: "intelligence",
    },
    {
      id: "clothTraitArmour",
      label: "Armour",
      sortable: true,
      type: "number",
      clothingTraitKey: "armour",
    },
    {
      id: "clothTraitElemRes",
      label: "Elem res",
      sortable: true,
      type: "number",
      clothingTraitKey: "elementalResistance",
    },
    {
      id: "clothTraitChemRes",
      label: "Chem res",
      sortable: true,
      type: "number",
      clothingTraitKey: "chemicalResistance",
    },
    {
      id: "clothTraitFallRes",
      label: "Fall res",
      sortable: true,
      type: "number",
      clothingTraitKey: "fallingResistance",
    },
    {
      id: "clothTraitBuoyancy",
      label: "Buoyancy",
      sortable: true,
      type: "number",
      clothingTraitKey: "buoyancyPercent",
    },
    {
      id: "clothTraitRegen",
      label: "Regen",
      sortable: true,
      type: "number",
      clothingTraitKey: "regeneration",
    },
    {
      id: "plMass",
      label: "Mass",
      sortable: true,
      type: "number",
      placeableSetupStatKey: "mass",
    },
    {
      id: "plBuoyancy",
      label: "Buoyancy",
      sortable: true,
      type: "number",
      placeableSetupStatKey: "buoyancy",
    },
    {
      id: "plHitPoints",
      label: "Hit points",
      sortable: true,
      type: "number",
      placeableSetupStatKey: "hitPoints",
    },
    {
      id: "pbImpactDmgMult",
      label: "Impact dmg ×",
      sortable: true,
      type: "number",
      placeBlockStatKey: "impactDamageMult",
    },
    {
      id: "ghLatchRange",
      label: "Latch range",
      sortable: true,
      type: "number",
      grapplingHookStatKey: "latchRange",
    },
    {
      id: "ghThrowRange",
      label: "Throw range",
      sortable: true,
      type: "number",
      grapplingHookStatKey: "throwRange",
    },
    {
      id: "ppoMaxForce",
      label: "Max force",
      sortable: true,
      type: "number",
      propulsionSetupKey: "maxForce",
    },
    {
      id: "ppoResponsiveness",
      label: "Responsiveness",
      sortable: true,
      type: "number",
      propulsionSetupKey: "responsiveness",
    },
    {
      id: "peAvailableEnergy",
      label: "Available energy",
      sortable: true,
      type: "number",
      engineSetupKey: "availableEnergy",
    },
    {
      id: "pgDamagePerChop",
      label: "Damage / chop",
      sortable: true,
      type: "number",
      grinderSetupKey: "damagePerChop",
    },
    {
      id: "pgMinChopDelay",
      label: "Chop min (s)",
      sortable: true,
      type: "number",
      grinderSetupKey: "minChopDelay",
    },
    {
      id: "pgMaxChopDelay",
      label: "Chop max (s)",
      sortable: true,
      type: "number",
      grinderSetupKey: "maxChopDelay",
    },
    {
      id: "paMinShot",
      label: "Shot min (s)",
      sortable: true,
      type: "number",
      artilleryWeaponKey: "minTimeBetweenShots",
    },
    {
      id: "paMaxShot",
      label: "Shot max (s)",
      sortable: true,
      type: "number",
      artilleryWeaponKey: "maxTimeBetweenShots",
    },
    {
      id: "paMaxProjSpeed",
      label: "Proj. speed max",
      sortable: true,
      type: "number",
      artilleryWeaponKey: "maxProjectileSpeed",
    },
    {
      id: "paPhysDmg",
      label: "Physical damage",
      sortable: true,
      type: "number",
      artilleryDamageKey: "physicalDamage",
    },
    {
      id: "paKnockback",
      label: "Knockback",
      sortable: true,
      type: "number",
      artilleryDamageKey: "knockbackMagnitude",
    },
    { id: "json", label: "JSON", sortable: false },
  ];

  const COLUMN_BY_ID = {};
  for (let i = 0; i < COLUMNS.length; i++) {
    COLUMN_BY_ID[COLUMNS[i].id] = COLUMNS[i];
  }

  /** Shown when Object type filter is MeleeWeapon or JackHammer (both use `meleeWeaponSetupInfo`). */
  const MELEE_WEAPON_OBJECT_TYPE = "MeleeWeapon";
  const JACKHAMMER_OBJECT_TYPE = "JackHammer";
  const RANGED_WEAPON_OBJECT_TYPE = "RangedWeapon";
  const THROWABLE_WEAPON_OBJECT_TYPE = "ThrowableWeapon";
  const CLOTHING_ITEM_OBJECT_TYPE = "ClothingItem";
  const PLACE_BLOCK_ITEM_OBJECT_TYPE = "PlaceBlockItem";
  const GRAPPLING_HOOK_OBJECT_TYPE = "GrapplingHook";
  const PLACE_PROPULSION_OBJECT_ITEM_TYPE = "PlacePropulsionObjectItem";
  const PLACE_ENGINE_OBJECT_ITEM_TYPE = "PlaceEngineObjectItem";
  const PLACE_GRINDER_OBJECT_ITEM_TYPE = "PlaceGrinderObjectItem";
  const PLACE_OBJECT_ITEM_TYPE = "PlaceObjectItem";
  const PLACE_SHIP_SCAFFOLDING_ITEM_TYPE = "PlaceShipScaffoldingItem";
  const PLACE_ARTILLERY_SHIP_ITEM_TYPE = "PlaceArtilleryShipItem";

  /**
   * objectTypes that show shared mass / buoyancy / hit points columns (`pl*`).
   * Most read `placeableSetupInfo`; PlaceBlockItem reads `sharedblockinfo.json` via `blockType`.
   */
  const PLACEABLE_SETUP_STAT_OBJECT_TYPES = [
    PLACE_BLOCK_ITEM_OBJECT_TYPE,
    PLACE_PROPULSION_OBJECT_ITEM_TYPE,
    PLACE_ENGINE_OBJECT_ITEM_TYPE,
    PLACE_GRINDER_OBJECT_ITEM_TYPE,
    PLACE_OBJECT_ITEM_TYPE,
    PLACE_SHIP_SCAFFOLDING_ITEM_TYPE,
    PLACE_ARTILLERY_SHIP_ITEM_TYPE,
  ];
  const PLACEABLE_SETUP_STAT_TYPE_SET = new Set(PLACEABLE_SETUP_STAT_OBJECT_TYPES);

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
    const v = row[key];
    return v;
  }

  function placeBlockStatCell(item, key) {
    const row = getPlaceBlockStatsRow(item);
    const v = row[key];
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
    const v = g[key];
    return v;
  }

  function grapplingHookStatCell(item, key) {
    const g = getGrapplingHookSetup(item);
    const v = g[key];
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function showPlaceableSetupStatColumns() {
    return PLACEABLE_SETUP_STAT_TYPE_SET.has(objectTypeFilterValue());
  }

  function isPlaceableSetupStatColumnDef(def) {
    return !!(def && def.placeableSetupStatKey);
  }

  function getPlaceableSetupStatSortValue(item, key) {
    if (item.objectType === PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return getPlaceBlockStatSortValue(item, key);
    }
    const p = item.placeableSetupInfo;
    const v = p[key];
    return v;
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
    const v = p[def.propulsionSetupKey];
    return v;
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
    const v = e[def.engineSetupKey];
    return v;
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
    const v = g[def.grinderSetupKey];
    return v;
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
    const g = w.grenadeSetupInfo;
    return g.damageDesc;
  }

  function getArtilleryShipItemStatSortValue(item, def) {
    if (def.artilleryWeaponKey) {
      const w = getArtilleryPlaceableWeapon(item);
      const v = w[def.artilleryWeaponKey];
      return v;
    }
    if (def.artilleryDamageKey) {
      const d = getArtilleryDamageDesc(item);
      const v = d[def.artilleryDamageKey];
      return v;
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
    const t = equip.characterTraits;
    const v = t[key];
    return typeof v === "string" ? v : String(v);
  }

  function clothingTraitNumberForSort(equip, key) {
    const s = clothingTraitRawString(equip, key);
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  function getClothingStatSortValue(item, colDef) {
    const e = getClothingEquipSetup(item);
    if (colDef.clothingEquipField) {
      const v = e[colDef.clothingEquipField];
      return v;
    }
    if (colDef.clothingTraitKey) {
      return clothingTraitNumberForSort(e, colDef.clothingTraitKey);
    }
    return null;
  }

  /** Non-clothing rows get ""; 0-like trait values render empty (like weapon stat cells). */
  function clothingStatCell(item, colDef) {
    const e = getClothingEquipSetup(item);
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

  function getRangedOrThrowableDamageDesc(item) {
    if (item.objectType === RANGED_WEAPON_OBJECT_TYPE) {
      const r = item.rangedWeaponSetupInfo;
      return r.damageDesc;
    }
    if (item.objectType === THROWABLE_WEAPON_OBJECT_TYPE) {
      const t = item.throwableItemSetupInfo;
      const g = t && t.grenadeSetupInfo;
      return g.damageDesc;
    }
    return null;
  }

  /** RangedWeapon / ThrowableWeapon damage field: 0 renders empty (like melee). */
  function rtDamageNumberCell(item, key) {
    const d = getRangedOrThrowableDamageDesc(item);
    const v = d[key];
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
  let ROW_HEIGHT = 60;
  const VIRTUAL_OVERSCAN = 12;
  let rowHeightSynced = false;

  // Variable-height virtual scrolling:
  // - We render only a window of rows.
  // - Spacer heights are computed from measured row heights + an estimate for unknown rows.
  let rowHeights = null; // Array<number> (length = virtualList.length)
  let prefixHeights = null; // Array<number> (length = virtualList.length + 1)
  let virtualHeightsDirty = true;
  let heightAutoRerenders = 0;

  /** Filtered + sorted list for the current table; virtual scroll reads from this. */
  let virtualList = [];
  let virtualScrollRaf = null;
  let virtualScrollAttached = false;
  let virtualResizeAttached = false;
  let virtualResizeTimer = null;

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
    if (isClothingStatColumnDef(def) && filter !== CLOTHING_ITEM_OBJECT_TYPE) {
      return "display";
    }
    if (isPlaceBlockStatColumnDef(def) && filter !== PLACE_BLOCK_ITEM_OBJECT_TYPE) {
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
    const o = JSON.parse(raw);
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

  const SEARCH_DEBOUNCE_MS = 200;
  let searchDebounceTimer = null;

  function scheduleRenderFromSearch() {
    if (searchDebounceTimer != null) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function () {
      searchDebounceTimer = null;
      render();
    }, SEARCH_DEBOUNCE_MS);
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

  /** PNG path (`icons/…`) or packed atlas sprite ref (`atlas:Data/…`). */
  function isRasterIconRef(url) {
    return Boolean(url && (/\.png$/i.test(url) || url.indexOf("atlas:") === 0));
  }

  function appendRecipeSetIconFallback(iconWrap, row) {
    const url = recipeSetIconUrl(row);
    if (isRasterIconRef(url)) {
      const cached = rawIconDataUrlCache.get(url);
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
    const inv = item.inventorySetupInfo;
    const s = inv.itemDisplayName;
    return s && s.trim() ? s.trim() : item.name;
  }

  /** @type {HTMLElement | null} */
  let recipeTooltipEl = null;

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

  function positionRecipeTooltip(clientX, clientY) {
    const pad = 14;
    const margin = 8;
    recipeTooltipEl.style.position = "fixed";
    recipeTooltipEl.style.left = clientX + pad + "px";
    recipeTooltipEl.style.top = clientY + pad + "px";
    recipeTooltipEl.style.zIndex = "10000";
    requestAnimationFrame(function () {
      if (recipeTooltipEl.hidden) return;
      const r = recipeTooltipEl.getBoundingClientRect();
      let x = clientX + pad;
      let y = clientY + pad;
      if (x + r.width > window.innerWidth - margin) {
        x = Math.max(margin, window.innerWidth - r.width - margin);
      }
      if (y + r.height > window.innerHeight - margin) {
        y = Math.max(margin, window.innerHeight - r.height - margin);
      }
      if (x < margin) x = margin;
      if (y < margin) y = margin;
      recipeTooltipEl.style.left = x + "px";
      recipeTooltipEl.style.top = y + "px";
    });
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

  async function fillRecipeTooltip(item) {
    const recipes = data.recipesByProduct[item.name];
    const usedIn = data.recipesByIngredient[item.name];
    const hasCraft = recipes && recipes.length > 0;
    const hasUsed = usedIn && usedIn.length > 0;
    if (!hasCraft && !hasUsed) return;

    recipeTooltipEl.innerHTML = "";

    if (hasCraft) {
      const head = document.createElement("div");
      head.className = "recipe-tooltip__head";
      head.textContent = "Craft: " + (displayName(item) || item.name || "");
      recipeTooltipEl.appendChild(head);

      for (let i = 0; i < recipes.length; i++) {
        const rec = recipes[i];
        if (i > 0) {
          const hr = document.createElement("hr");
          hr.className = "recipe-tooltip__hr";
          recipeTooltipEl.appendChild(hr);
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
        recipeTooltipEl.appendChild(title);

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
        recipeTooltipEl.appendChild(ul);
      }
    }

    if (hasUsed) {
      if (hasCraft) {
        const hr = document.createElement("hr");
        hr.className = "recipe-tooltip__hr";
        recipeTooltipEl.appendChild(hr);
      }
      const subHead = document.createElement("div");
      subHead.className = "recipe-tooltip__head";
      subHead.textContent = "Used in:";
      recipeTooltipEl.appendChild(subHead);

      const ulUsed = document.createElement("ul");
      ulUsed.className = "recipe-tooltip__list recipe-tooltip__list--used-in";

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
            appendRecipeSetIconFallback(iconWrap, row);
          }
        } else {
          appendRecipeSetIconFallback(iconWrap, row);
        }
        li.appendChild(iconWrap);

        const nameSpan = document.createElement("span");
        nameSpan.className = "recipe-tooltip__ing-name";
        nameSpan.textContent = row.recipeSetDisplayName || row.recipeSetBaseName || "";
        li.appendChild(nameSpan);

        ulUsed.appendChild(li);
      }
      recipeTooltipEl.appendChild(ulUsed);
    }

    recipeTooltipEl.hidden = false;
  }

  function bindRecipeHover(targetEl, item) {
    const recipes = data.recipesByProduct[item.name];
    const usedIn = data.recipesByIngredient[item.name];
    const hasCraft = recipes && recipes.length > 0;
    const hasUsed = usedIn && usedIn.length > 0;
    if (!hasCraft && !hasUsed) return;

    targetEl.classList.add("item-icon--recipe");
    targetEl.setAttribute(
      "aria-label",
      "Craft / usage — hover to show recipe ingredients and where this item is used"
    );

    targetEl.addEventListener(
      "mouseenter",
      function (e) {
        void (async function () {
          await fillRecipeTooltip(item);
          positionRecipeTooltip(e.clientX, e.clientY);
        })();
      },
      { passive: true }
    );
    targetEl.addEventListener(
      "mousemove",
      function (e) {
        if (!recipeTooltipEl.hidden) {
          positionRecipeTooltip(e.clientX, e.clientY);
        }
      },
      { passive: true }
    );
    targetEl.addEventListener(
      "mouseleave",
      function () {
        recipeTooltipEl.hidden = true;
        recipeTooltipEl.innerHTML = "";
      },
      { passive: true }
    );
  }

  function description(item) {
    const inv = item.inventorySetupInfo;
    return inv.itemDescription;
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
    const m = item.meleeWeaponSetupInfo;
    return m;
  }

  function getMeleeDamageDesc(item) {
    const m = getMeleeWeaponSetup(item);
    const d = m.damageDesc;
    return d;
  }

  /** MeleeWeapon / JackHammer numeric damage fields: 0 renders as empty; others empty cell. */
  function meleeDamageNumberCell(item, key) {
    const d = getMeleeDamageDesc(item);
    const v = d[key];
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  /** Top-level `meleeWeaponSetupInfo` numeric fields (e.g. timeBetweenAttacks, attackRange). */
  function meleeSetupNumberCell(item, key) {
    const m = getMeleeWeaponSetup(item);
    const v = m[key];
    return formatCatalogStatNumber(v, {});
  }

  function prices(item) {
    const inv = item.inventorySetupInfo;
    const buy = inv.buyPrice;
    const sell = inv.sellPrice;
    return {
      buy: applyWisdomPriceModifier(buy, false),
      sell: applyWisdomPriceModifier(sell, true),
    };
  }

  /**
   * Sum of component sell prices used to craft `item`, normalized per 1 output item.
   *
   * For items with multiple recipe variants, we take the minimum cost variant.
   * Returns `null` when no complete recipe can be costed.
   */
  function componentSellPrice(item) {
    const recipes = data.recipesByProduct && data.recipesByProduct[item.name];
    if (!recipes) return null;
    
    let best = null;
    for (let i = 0; i < recipes.length; i++) {
      const rec = recipes[i];
      const ings = rec.ingredients || [];
      const outQty =
        rec.craftQuantity != null && typeof rec.craftQuantity === "number" ? rec.craftQuantity : 1;
      const outDiv = outQty > 0 ? outQty : 1;

      let sum = 0;
      let valid = true;
      for (let j = 0; j < ings.length; j++) {
        const ing = ings[j];
        const sub = itemByName.get(ing.name);
        if (!sub) {
          valid = false;
          break;
        }
        const inv = sub.inventorySetupInfo;
        const sp = inv ? applyWisdomPriceModifier(inv.sellPrice, true) : null;
        if (sp == null) {
          valid = false;
          break;
        }
        const qty = ing.quantity != null && typeof ing.quantity === "number" ? ing.quantity : 1;
        sum += sp * qty;
      }

      if (!valid) continue;
      const perOutput = Math.ceil(sum / outDiv);
      if (best == null || perOutput < best) best = perOutput;
    }
    return best;
  }

  /**
   * Profit = sell price - (ingredient sell cost) for 1 output item.
   * Returns `null` when sell price or component cost can't be computed.
   */
  function profitValue(item) {
    const pr = prices(item);
    const sell = pr && typeof pr.sell === "number" ? pr.sell : null;
    if (sell == null) return null;
    const comp = componentSellPrice(item);
    if (comp == null) return null;
    return sell - comp;
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
   * Non-price numeric cells: two decimal places. Buy/sell use {@link formatPriceWithSpaces} (integer).
   * @param {{ hideZero?: boolean }} [opts] — if true, exact 0 renders as empty (existing catalog convention).
   */
  function formatCatalogStatNumber(v, opts) {
    const hideZero = opts && opts.hideZero;
    if (v == null || typeof v !== "number" || Number.isNaN(v)) return "—";
    if (hideZero && v === 0) return "";
    return v.toFixed(2);
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
    const WC = globalThis.WindforgeColors;
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

  /** Decode every catalog + recipe-tooltip PNG once at startup; the table and tooltips use only memory caches. */
  const ICON_PRELOAD_CONCURRENCY = 12;

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

  async function preloadRawRecipeIconUrl(url) {
    if (rawIconDataUrlCache.has(url)) return;
    const loaded = await loadImageForUrl(url);
    const raw = canvasToDataUrlFromImage(loaded);
    rawIconDataUrlCache.set(url, raw);
  }

  async function preloadAllIcons() {
    const items = data.ItemList;
    for (let i = 0; i < items.length; i += ICON_PRELOAD_CONCURRENCY) {
      const chunk = items.slice(i, i + ICON_PRELOAD_CONCURRENCY);
      await Promise.all(
        chunk.map(function (it) {
          if (!it) return Promise.resolve();
          return ensureIconDataUrlForItem(it);
        })
      );
    }
    const recipeUrls = collectRecipeSetPngUrls();
    await Promise.all(recipeUrls.map(preloadRawRecipeIconUrl));
  }

  function matchesQuery(item, q) {
    if (!q) return true;
    const s = q.toLowerCase();
    const iconColors = getIconColorNames(item);
    const hay = [
      item.name,
      item.objectType,
      displayName(item),
      description(item),
      iconColors ? iconColors.primary + " " + iconColors.secondary : "",
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
      if (isClothingStatColumnDef(c) && !showClothingStatColumns()) continue;
      if (isPlaceBlockStatColumnDef(c) && !showPlaceBlockStatColumns()) continue;
      if (isGrapplingHookStatColumnDef(c) && !showGrapplingHookStatColumns()) continue;
      if (isPlaceableSetupStatColumnDef(c) && !showPlaceableSetupStatColumns()) {
        continue;
      }
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
      const px = Math.max(16, COLUMN_WIDTH_PX[id] ?? COL_PX_STAT);
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

    function closePanel() {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
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
      sel.value = value;
      cfg.syncPanel();
      const shouldClose = !(opts && opts.keepOpen);
      if (shouldClose) closePanel();
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
        closePanel();
        btn.focus();
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
    if (def.rtDamageKey) return getRangedOrThrowableDamageDesc(item)[def.rtDamageKey];
    if (isClothingStatColumnDef(def)) return getClothingStatSortValue(item, def);
    if (def.placeBlockStatKey) return getPlaceBlockStatSortValue(item, def.placeBlockStatKey);
    if (def.grapplingHookStatKey) return getGrapplingHookStatSortValue(item, def.grapplingHookStatKey);
    if (def.placeableSetupStatKey) return getPlaceableSetupStatSortValue(item, def.placeableSetupStatKey);
    if (isPropulsionPlaceItemStatColumnDef(def)) return getPropulsionPlaceItemStatSortValue(item, def);
    if (isEnginePlaceItemStatColumnDef(def)) return getEnginePlaceItemStatSortValue(item, def);
    if (isGrinderPlaceItemStatColumnDef(def)) return getGrinderPlaceItemStatSortValue(item, def);
    if (isArtilleryShipItemStatColumnDef(def)) return getArtilleryShipItemStatSortValue(item, def);
    return "";
  }

  function renderStatCellFromColumnDef(td, item, def) {
    td.className = "num col-melee-dmg";
    if (def.rtDamageKey) {
      td.textContent = rtDamageNumberCell(item, def.rtDamageKey);
      return;
    }
    if (isClothingStatColumnDef(def)) {
      td.textContent = clothingStatCell(item, def);
      return;
    }
    if (def.placeBlockStatKey) {
      td.textContent = placeBlockStatCell(item, def.placeBlockStatKey);
      return;
    }
    if (def.grapplingHookStatKey) {
      td.textContent = grapplingHookStatCell(item, def.grapplingHookStatKey);
      return;
    }
    if (def.placeableSetupStatKey) {
      td.textContent = placeableSetupStatCell(item, def.placeableSetupStatKey);
      return;
    }
    if (isPropulsionPlaceItemStatColumnDef(def)) {
      td.textContent = propulsionPlaceItemStatCell(item, def);
      return;
    }
    if (isEnginePlaceItemStatColumnDef(def)) {
      td.textContent = enginePlaceItemStatCell(item, def);
      return;
    }
    if (isGrinderPlaceItemStatColumnDef(def)) {
      td.textContent = grinderPlaceItemStatCell(item, def);
      return;
    }
    if (isArtilleryShipItemStatColumnDef(def)) {
      td.textContent = artilleryShipItemStatCell(item, def);
      return;
    }
    td.className = "";
    td.textContent = "—";
  }

  function getSortValue(item, colId) {
    if (colId === "display") return displayName(item).toLowerCase();
    if (colId === "name") return (item.name || "").toLowerCase();
    if (colId === "objectType") return (item.objectType || "").toLowerCase();
    if (colId === "buy") return prices(item).buy;
    if (colId === "sell") return prices(item).sell;
    if (colId === "componentSell") return componentSellPrice(item);
    if (colId === "profit") return profitValue(item);
    if (colId === "description") return description(item).toLowerCase();
    if (colId === "dmgPhysical") return getMeleeDamageDesc(item).physicalDamage;
    if (colId === "meleeTimeBetweenAttacks") return getMeleeWeaponSetup(item).timeBetweenAttacks;
    if (colId === "meleeAttackRange") return getMeleeWeaponSetup(item).attackRange;
    if (colId === "dmgKnockback") return getMeleeDamageDesc(item).knockbackMagnitude;
    const def = COLUMN_BY_ID[colId];
    return def ? getStatValueFromColumnDef(item, def) : "";
  }

  function compareItems(a, b) {
    const col = sortColumn;
    const def = COLUMN_BY_ID[col];
    const dir = sortDir === "asc" ? 1 : -1;
    const va = getSortValue(a, col);
    const vb = getSortValue(b, col);

    if (def && def.type === "number") {
      const na = va == null ? Infinity : va;
      const nb = vb == null ? Infinity : vb;
      if (na !== nb) return (na - nb) * dir;
    } else {
      let c;
      if (secondarySortMode === SECONDARY_SORT_NAME_SUFFIX_WORDS) {
        if (col === "name") {
          c = compareInternalNameSuffixWords(a.name || "", b.name || "");
        } else if (col === "display") {
          c = compareDisplayNameSuffixOrder(a, b);
        } else {
          const sa = String(va ?? "");
          const sb = String(vb ?? "");
          c = sa.localeCompare(sb, undefined, { sensitivity: "base", numeric: true });
        }
      } else {
        const sa = String(va ?? "");
        const sb = String(vb ?? "");
        c = sa.localeCompare(sb, undefined, { sensitivity: "base", numeric: true });
      }
      if (c !== 0) return c * dir;
    }

    if (
      secondarySortMode === SECONDARY_SORT_NAME_SUFFIX_WORDS &&
      col !== "name" &&
      col !== "display"
    ) {
      return compareInternalNameSuffixWords(a.name || "", b.name || "");
    }
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true });
  }

  function buildThead() {
    const thead = document.getElementById("thead");
    thead.innerHTML = "";
    const tr = document.createElement("tr");

    const cols = visibleColumns();
    for (let c = 0; c < cols.length; c++) {
      const col = cols[c];
      const th = document.createElement("th");
      th.setAttribute("scope", "col");

      if (col.id === "icon") {
        th.className = "col-icon";
        th.textContent = col.label;
      } else if (!col.sortable) {
        th.textContent = col.label;
        if (col.id === "json") th.className = "col-json";
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
        const isDiagonalNum = isNum && col.id !== "buy" && col.id !== "sell";
        if (isNum) cls += " num";
        if (isDiagonalNum) cls += " num-diagonal";
        th.className = cls;
        th.dataset.sort = col.id;
        const active = col.id === sortColumn;
        th.setAttribute(
          "aria-sort",
          active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
        );
        if (isDiagonalNum) {
          const wrap = document.createElement("span");
          wrap.className = "num-label-wrap";
          const label = document.createElement("span");
          label.className = "num-label";
          label.textContent = col.label;
          wrap.appendChild(label);
          th.appendChild(wrap);
        } else {
          th.appendChild(document.createTextNode(col.label));
        }
        const hint = document.createElement("span");
        hint.className = "sort-hint";
        hint.setAttribute("aria-hidden", "true");
        th.appendChild(hint);
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
          td.textContent = meleeDamageNumberCell(item, "physicalDamage");
          break;
        }
        case "meleeTimeBetweenAttacks": {
          td.className = "num col-melee-dmg";
          td.textContent = meleeSetupNumberCell(item, "timeBetweenAttacks");
          break;
        }
        case "meleeAttackRange": {
          td.className = "num col-melee-dmg";
          td.textContent = meleeSetupNumberCell(item, "attackRange");
          break;
        }
        case "dmgKnockback": {
          td.className = "num col-melee-dmg";
          td.textContent = meleeDamageNumberCell(item, "knockbackMagnitude");
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
    const pxTop = Math.max(0, st);
    const pxBottom = Math.max(pxTop, st + viewportH - 1);

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
      frag.appendChild(spacerRow(prefixHeights[startIdx]));
    }
    for (let i = startIdx; i <= endIdx; i++) {
      frag.appendChild(renderRow(list[i], i));
    }
    if (endIdx < total - 1) {
      frag.appendChild(
        spacerRow(prefixHeights[total] - prefixHeights[endIdx + 1])
      );
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
      wrap.addEventListener("scroll", scheduleVirtualRefresh, { passive: true });
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
  }

  /**
   * @param {{ profile?: boolean }} [opts]
   */
  function render(opts) {
    const profile = opts && opts.profile;
    const t0 = profile ? performance.now() : 0;

    const q = (document.getElementById("q").value || "").trim();
    let list = data.ItemList.filter(function (it) {
      return (
        matchesQuery(it, q) &&
          matchesObjectTypeFilter(it) &&
          passesSpecialFilters(it) &&
          passesTierVariantFilters(it)
      );
    });
    const t1 = profile ? performance.now() : 0;

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
    const sortDefCloth = COLUMN_BY_ID[sortColumn];
    if (sortDefCloth && isClothingStatColumnDef(sortDefCloth) && !showClothingStatColumns()) {
      sortColumn = "display";
    }
    const sortDefPb = COLUMN_BY_ID[sortColumn];
    if (sortDefPb && isPlaceBlockStatColumnDef(sortDefPb) && !showPlaceBlockStatColumns()) {
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

    list.sort(compareItems);
    const t2 = profile ? performance.now() : 0;

    buildColgroup();
    buildThead();
    const t3 = profile ? performance.now() : 0;

    virtualList = list;
    rowHeights = null;
    prefixHeights = null;
    virtualHeightsDirty = true;
    heightAutoRerenders = 0;
    document.getElementById("count").textContent =
      list.length + " / " + data.ItemList.length + " items";

    const wrap = getBodyScrollPort();
    if (wrap) {
      wrap.scrollTop = 0;
    }
    renderVirtualBody();
    ensureVirtualScrollListeners();
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
    const id = th.dataset.sort;

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
  const wisdomEl = document.getElementById("wisdom-stat");
  if (wisdomEl) {
    wisdomEl.addEventListener("input", function () {
      syncWisdomFromInput();
      render();
    });
    wisdomEl.addEventListener("change", function () {
      syncWisdomFromInput();
      render();
    });
  }

  function initWisdomSpinButtons() {
    const input = document.getElementById("wisdom-stat");
    const wrap = input && input.closest(".number-input-spin");
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
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (up) up.addEventListener("click", function () { bump(1); });
    if (down) down.addEventListener("click", function () { bump(-1); });
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
    });
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

    const [itemsPayload, blocksPayload] = await Promise.all([
      fetchJsonGz("itemlist.json.gz"),
      fetchJsonGz("sharedblockinfo.json.gz"),
    ]);

    data = itemsPayload;
    // Strict: required keys must exist in the payload.

    itemByName.clear();
    for (let i = 0; i < data.ItemList.length; i++) {
      const it = data.ItemList[i];
      if (it && typeof it.name === "string" && it.name) {
        itemByName.set(it.name, it);
      }
    }

    recipeTooltipEl = document.getElementById("recipe-tooltip");

    blockTypes = {};
    if (
      blocksPayload &&
      blocksPayload.blockTypes &&
      typeof blocksPayload.blockTypes === "object"
    ) {
      blockTypes = blocksPayload.blockTypes;
    }
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

    await preloadAllIcons();

    render();
  }

  load();
})();
