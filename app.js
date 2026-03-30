/**
 * Windforge item catalog — loads itemlist.json produced by extract_itemlist.py
 */

(function () {
  "use strict";

  /** @type {{ ItemList: object[], iconMap: Record<string,string>, itemCount?: number, source?: string, recipesByProduct?: Record<string, object[]>, recipeSource?: string }} */
  let data = { ItemList: [], iconMap: {}, recipesByProduct: {} };

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
    if (!item) return false;
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
    if (!item || item.objectType !== PLACE_BLOCK_ITEM_OBJECT_TYPE) return null;
    const bt = item.blockType;
    if (bt == null || typeof bt !== "string" || !bt.trim()) return null;
    const row = blockTypes[bt];
    return row && typeof row === "object" ? row : null;
  }

  function getPlaceBlockStatSortValue(item, key) {
    const row = getPlaceBlockStatsRow(item);
    if (!row) return null;
    const v = row[key];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  function placeBlockStatCell(item, key) {
    if (!item || item.objectType !== PLACE_BLOCK_ITEM_OBJECT_TYPE) return "";
    const row = getPlaceBlockStatsRow(item);
    if (!row) return "—";
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
    if (!item || item.objectType !== GRAPPLING_HOOK_OBJECT_TYPE) return null;
    const g = item.grapplingHookSetupInfo;
    return g && typeof g === "object" ? g : null;
  }

  function getGrapplingHookStatSortValue(item, key) {
    const g = getGrapplingHookSetup(item);
    if (!g) return null;
    const v = g[key];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  function grapplingHookStatCell(item, key) {
    if (!item || item.objectType !== GRAPPLING_HOOK_OBJECT_TYPE) return "";
    const g = getGrapplingHookSetup(item);
    if (!g) return "—";
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
    if (!item || !PLACEABLE_SETUP_STAT_TYPE_SET.has(item.objectType)) return null;
    if (item.objectType === PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return getPlaceBlockStatSortValue(item, key);
    }
    const p = item.placeableSetupInfo;
    if (!p || typeof p !== "object") return null;
    const v = p[key];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  function placeableSetupStatCell(item, key) {
    if (!item || !PLACEABLE_SETUP_STAT_TYPE_SET.has(item.objectType)) return "";
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
    if (!item || item.objectType !== PLACE_PROPULSION_OBJECT_ITEM_TYPE) return null;
    const p = item.propulsionSetupInfo;
    if (!p || typeof p !== "object") return null;
    const v = p[def.propulsionSetupKey];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  function propulsionPlaceItemStatCell(item, def) {
    if (!item || item.objectType !== PLACE_PROPULSION_OBJECT_ITEM_TYPE) return "";
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
    if (!item || item.objectType !== PLACE_ENGINE_OBJECT_ITEM_TYPE) return null;
    const e = item.engineSetupInfo;
    if (!e || typeof e !== "object") return null;
    const v = e[def.engineSetupKey];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  function enginePlaceItemStatCell(item, def) {
    if (!item || item.objectType !== PLACE_ENGINE_OBJECT_ITEM_TYPE) return "";
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
    if (!item || item.objectType !== PLACE_GRINDER_OBJECT_ITEM_TYPE) return null;
    const g = item.grinderSetupInfo;
    if (!g || typeof g !== "object") return null;
    const v = g[def.grinderSetupKey];
    return typeof v === "number" && !Number.isNaN(v) ? v : null;
  }

  function grinderPlaceItemStatCell(item, def) {
    if (!item || item.objectType !== PLACE_GRINDER_OBJECT_ITEM_TYPE) return "";
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
    if (!item || item.objectType !== PLACE_ARTILLERY_SHIP_ITEM_TYPE) return null;
    const w = item.placeableWeaponSetupInfo;
    return w && typeof w === "object" ? w : null;
  }

  function getArtilleryDamageDesc(item) {
    const w = getArtilleryPlaceableWeapon(item);
    if (!w) return null;
    const g = w.grenadeSetupInfo;
    const d = g && g.damageDesc;
    return d && typeof d === "object" ? d : null;
  }

  function getArtilleryShipItemStatSortValue(item, def) {
    if (!item || item.objectType !== PLACE_ARTILLERY_SHIP_ITEM_TYPE) return null;
    if (def.artilleryWeaponKey) {
      const w = getArtilleryPlaceableWeapon(item);
      if (!w) return null;
      const v = w[def.artilleryWeaponKey];
      return typeof v === "number" && !Number.isNaN(v) ? v : null;
    }
    if (def.artilleryDamageKey) {
      const d = getArtilleryDamageDesc(item);
      if (!d) return null;
      const v = d[def.artilleryDamageKey];
      return typeof v === "number" && !Number.isNaN(v) ? v : null;
    }
    return null;
  }

  function artilleryShipItemStatCell(item, def) {
    if (!item || item.objectType !== PLACE_ARTILLERY_SHIP_ITEM_TYPE) return "";
    const v = getArtilleryShipItemStatSortValue(item, def);
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  function getClothingEquipSetup(item) {
    if (!item || item.objectType !== CLOTHING_ITEM_OBJECT_TYPE) return null;
    const e = item.equipSetupInfo;
    return e && typeof e === "object" ? e : null;
  }

  function clothingTraitRawString(equip, key) {
    const t = equip && equip.characterTraits;
    if (!t || typeof t !== "object") return null;
    const v = t[key];
    if (v == null) return null;
    return typeof v === "string" ? v : String(v);
  }

  function clothingTraitNumberForSort(equip, key) {
    const s = clothingTraitRawString(equip, key);
    if (s == null) return null;
    const n = parseFloat(s);
    return Number.isNaN(n) ? null : n;
  }

  function getClothingStatSortValue(item, colDef) {
    if (!item || item.objectType !== CLOTHING_ITEM_OBJECT_TYPE) return null;
    const e = getClothingEquipSetup(item);
    if (!e) return null;
    if (colDef.clothingEquipField) {
      const v = e[colDef.clothingEquipField];
      return typeof v === "number" && !Number.isNaN(v) ? v : null;
    }
    if (colDef.clothingTraitKey) {
      return clothingTraitNumberForSort(e, colDef.clothingTraitKey);
    }
    return null;
  }

  /** Non-clothing rows get ""; 0-like trait values render empty (like weapon stat cells). */
  function clothingStatCell(item, colDef) {
    if (!item || item.objectType !== CLOTHING_ITEM_OBJECT_TYPE) return "";
    const e = getClothingEquipSetup(item);
    if (!e) return "—";
    if (colDef.clothingEquipField) {
      const v = e[colDef.clothingEquipField];
      return formatCatalogStatNumber(v, { hideZero: true });
    }
    if (colDef.clothingTraitKey) {
      const s = clothingTraitRawString(e, colDef.clothingTraitKey);
      if (s == null || s === "") return "—";
      const n = parseFloat(s);
      if (!Number.isNaN(n)) {
        return formatCatalogStatNumber(n, { hideZero: true });
      }
      return s;
    }
    return "—";
  }

  function getRangedOrThrowableDamageDesc(item) {
    if (!item) return null;
    if (item.objectType === RANGED_WEAPON_OBJECT_TYPE) {
      const r = item.rangedWeaponSetupInfo;
      const d = r && r.damageDesc;
      return d && typeof d === "object" ? d : null;
    }
    if (item.objectType === THROWABLE_WEAPON_OBJECT_TYPE) {
      const t = item.throwableItemSetupInfo;
      const g = t && t.grenadeSetupInfo;
      const d = g && g.damageDesc;
      return d && typeof d === "object" ? d : null;
    }
    return null;
  }

  /** RangedWeapon / ThrowableWeapon damage field: 0 renders empty (like melee). */
  function rtDamageNumberCell(item, key) {
    if (
      !item ||
      (item.objectType !== RANGED_WEAPON_OBJECT_TYPE &&
        item.objectType !== THROWABLE_WEAPON_OBJECT_TYPE)
    ) {
      return "";
    }
    const d = getRangedOrThrowableDamageDesc(item);
    if (!d) return "—";
    const v = d[key];
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  /**
   * Relative widths for <colgroup> with `table-layout: fixed`.
   * Renormalized over visible columns so virtual scroll doesn’t reflow columns per row batch.
   */
  const STAT_COLUMN_WEIGHT = 6
  
  const COLUMN_LAYOUT_WEIGHT = {
    display: 24,
    name: 24,
    objectType: 16,
    buy: 5.5,
    sell: 5.5,
    componentSell: 5.5,
    profit: 5.5,
    description: 32,
    dmgPhysical: STAT_COLUMN_WEIGHT,
    meleeTimeBetweenAttacks: STAT_COLUMN_WEIGHT,
    meleeAttackRange: STAT_COLUMN_WEIGHT,
    dmgKnockback: STAT_COLUMN_WEIGHT,
    rtPhysicalDamage: STAT_COLUMN_WEIGHT,
    rtElementalDamage: STAT_COLUMN_WEIGHT,
    rtChemicalDamage: STAT_COLUMN_WEIGHT,
    rtKnockbackMagnitude: STAT_COLUMN_WEIGHT,
    clothAirDrain: STAT_COLUMN_WEIGHT,
    clothTraitWeight: STAT_COLUMN_WEIGHT,
    clothTraitHealth: STAT_COLUMN_WEIGHT,
    clothTraitStrength: STAT_COLUMN_WEIGHT,
    clothTraitAgility: STAT_COLUMN_WEIGHT,
    clothTraitIntelligence: STAT_COLUMN_WEIGHT,
    clothTraitArmour: STAT_COLUMN_WEIGHT,
    clothTraitElemRes: STAT_COLUMN_WEIGHT,
    clothTraitChemRes: STAT_COLUMN_WEIGHT,
    clothTraitFallRes: STAT_COLUMN_WEIGHT,
    clothTraitBuoyancy: STAT_COLUMN_WEIGHT,
    clothTraitRegen: STAT_COLUMN_WEIGHT,
    pbImpactDmgMult: STAT_COLUMN_WEIGHT,
    ghLatchRange: STAT_COLUMN_WEIGHT,
    ghThrowRange: STAT_COLUMN_WEIGHT,
    plMass: STAT_COLUMN_WEIGHT,
    plBuoyancy: STAT_COLUMN_WEIGHT,
    plHitPoints: STAT_COLUMN_WEIGHT,
    ppoMaxForce: STAT_COLUMN_WEIGHT,
    ppoResponsiveness: STAT_COLUMN_WEIGHT,
    peAvailableEnergy: STAT_COLUMN_WEIGHT,
    pgDamagePerChop: STAT_COLUMN_WEIGHT,
    pgMinChopDelay: STAT_COLUMN_WEIGHT,
    pgMaxChopDelay: STAT_COLUMN_WEIGHT,
    paMinShot: STAT_COLUMN_WEIGHT,
    paMaxShot: STAT_COLUMN_WEIGHT,
    paMaxProjSpeed: STAT_COLUMN_WEIGHT,
    paPhysDmg: STAT_COLUMN_WEIGHT,
    paKnockback: STAT_COLUMN_WEIGHT,
    json: 4,
  };

  const STORAGE_KEY = "windforge-item-catalog-ui-v1";

  /**
   * Tinted icon bitmaps as data URLs, keyed by source PNG + colour names.
   * Unbounded (no eviction): every distinct mask+tint combo stays for the session.
   */
  const tintedIconDataUrlCache = new Map();

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
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
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
    } catch (e) {
      return null;
    }
  }

  function persistUI() {
    try {
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
          hideMastercraftTier: !!(
            hideMastercraftTierEl && hideMastercraftTierEl.checked
          ),
        })
      );
    } catch (e) {
      /* quota / private mode */
    }
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
    if (!luaPath || typeof luaPath !== "string") return "";
    let p = luaPath.replace(/\\/g, "/").trim();
    while (p.startsWith("../")) p = p.slice(3);
    return p.replace(/^\//, "");
  }

  /** True when `inventoryIconFile` resolves to UnknownIcon.dds (not player-obtainable). */
  function itemUsesUnknownIcon(item) {
    const inv = item.inventorySetupInfo;
    if (!inv || typeof inv !== "object") return false;
    const raw = inv.inventoryIconFile;
    if (!raw || typeof raw !== "string") return false;
    const base = normalizeIconPath(raw).split("/").pop();
    return base.toLowerCase() === "unknownicon.dds";
  }

  function itemNameContainsDebug(item) {
    const n = item && item.name != null ? String(item.name).toLowerCase() : "";
    const d = (displayName(item) || "").toLowerCase();
    const needles = ["debug", "test"];
    return needles.some(function (needle) {
      return n.includes(needle) || d.includes(needle);
    });
  }

  /** Paratrooper red torso clothing: icon Torso_Paratrooper.dds + (IconRed1/IconRed2). */
  function itemIsParatrooperRedClothing(item) {
    const inv = item && item.inventorySetupInfo;
    if (!inv || typeof inv !== "object") return false;
    const raw = inv.inventoryIconFile;
    if (!raw || typeof raw !== "string") return false;
    const base = normalizeIconPath(raw).split("/").pop();
    if (base.toLowerCase() !== "torso_paratrooper.dds") return false;
    const a = inv.iconPrimaryColor;
    const b = inv.iconSecondaryColor;
    if (typeof a !== "string" || typeof b !== "string") return false;
    return a.trim() === "IconRed1" && b.trim() === "IconRed2";
  }

  /** Exclude PunchGrey (White/GrayCloth) from special-items filtering. */
  function itemIsExcludedPunchGreyCombo(item) {
    const inv = item && item.inventorySetupInfo;
    if (!inv || typeof inv !== "object") return false;
    const raw = inv.inventoryIconFile;
    if (!raw || typeof raw !== "string") return false;
    const base = normalizeIconPath(raw).split("/").pop();
    if (base.toLowerCase() !== "punchgrey.dds") return false;
    const a = typeof inv.iconPrimaryColor === "string" ? inv.iconPrimaryColor.trim().toLowerCase() : "";
    const b = typeof inv.iconSecondaryColor === "string" ? inv.iconSecondaryColor.trim().toLowerCase() : "";
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
    if (!item || typeof item.name !== "string") return false;
    const rs = data.recipesByProduct && data.recipesByProduct[item.name];
    return Array.isArray(rs) && rs.length > 0;
  }

  function itemHasDistinctThreeTierFamily(item) {
    if (!item || typeof item.name !== "string") return false;
    const ti = getCraftTierInfo(item.name);
    const base = ti.base;
    if (!base) return false;
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
    if (!inv || typeof inv !== "object") return null;
    const raw = inv.inventoryIconFile;
    if (!raw) return null;
    const norm = normalizeIconPath(raw);
    const mapped = data.iconMap && data.iconMap[norm];
    if (mapped) return mapped;
    return "../../" + norm;
  }

  function displayName(item) {
    const inv = item.inventorySetupInfo;
    if (inv && typeof inv.itemDisplayName === "string" && inv.itemDisplayName.trim()) {
      return inv.itemDisplayName.trim();
    }
    return item.name || "";
  }

  /** @type {HTMLElement | null} */
  let recipeTooltipEl = null;

  function positionRecipeTooltip(clientX, clientY) {
    if (!recipeTooltipEl) return;
    const pad = 14;
    const margin = 8;
    recipeTooltipEl.style.position = "fixed";
    recipeTooltipEl.style.left = clientX + pad + "px";
    recipeTooltipEl.style.top = clientY + pad + "px";
    recipeTooltipEl.style.zIndex = "10000";
    requestAnimationFrame(function () {
      if (!recipeTooltipEl || recipeTooltipEl.hidden) return;
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

  function fillRecipeTooltip(item, recipes) {
    if (!recipeTooltipEl) return;
    recipeTooltipEl.innerHTML = "";
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
      for (let j = 0; j < ings.length; j++) {
        const ing = ings[j];
        const li = document.createElement("li");
        li.className = "recipe-tooltip__row";

        const iconWrap = document.createElement("div");
        iconWrap.className = "recipe-tooltip__ing-icon";
        const sub = itemByName.get(ing.name);
        if (sub) {
          const url = iconUrlFor(sub);
          if (url && /\.png$/i.test(url)) {
            const im = document.createElement("img");
            im.loading = "eager";
            wireCatalogItemIcon(im, sub, url, {
              onLoadError() {
                im.remove();
                iconWrap.textContent = "—";
              },
            });
            iconWrap.appendChild(im);
          } else {
            iconWrap.textContent = "—";
          }
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
    recipeTooltipEl.hidden = false;
  }

  function bindRecipeHover(targetEl, item) {
    if (!item || !item.name) return;
    const recipes = data.recipesByProduct && data.recipesByProduct[item.name];
    if (!recipes || recipes.length === 0) return;
    if (!recipeTooltipEl) return;

    targetEl.classList.add("item-icon--recipe");
    targetEl.setAttribute("aria-label", "Craft recipe — hover to show ingredients");

    targetEl.addEventListener(
      "mouseenter",
      function (e) {
        fillRecipeTooltip(item, recipes);
        positionRecipeTooltip(e.clientX, e.clientY);
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
    if (inv && typeof inv.itemDescription === "string") return inv.itemDescription;
    return "";
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
    if (!item || !itemUsesMeleeWeaponSetupStats(item)) return null;
    const m = item.meleeWeaponSetupInfo;
    return m && typeof m === "object" ? m : null;
  }

  function getMeleeDamageDesc(item) {
    const m = getMeleeWeaponSetup(item);
    if (!m) return null;
    const d = m.damageDesc;
    return d && typeof d === "object" ? d : null;
  }

  /** MeleeWeapon / JackHammer numeric damage fields: 0 renders as empty; others empty cell. */
  function meleeDamageNumberCell(item, key) {
    if (!itemUsesMeleeWeaponSetupStats(item)) return "";
    const d = getMeleeDamageDesc(item);
    if (!d) return "—";
    const v = d[key];
    return formatCatalogStatNumber(v, { hideZero: true });
  }

  /** Top-level `meleeWeaponSetupInfo` numeric fields (e.g. timeBetweenAttacks, attackRange). */
  function meleeSetupNumberCell(item, key) {
    if (!itemUsesMeleeWeaponSetupStats(item)) return "";
    const m = getMeleeWeaponSetup(item);
    if (!m) return "—";
    const v = m[key];
    return formatCatalogStatNumber(v, {});
  }

  function prices(item) {
    const inv = item.inventorySetupInfo;
    if (!inv || typeof inv !== "object") return { buy: null, sell: null };
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
    if (!item || typeof item.name !== "string" || !item.name) return null;
    const recipes = data.recipesByProduct && data.recipesByProduct[item.name];
    if (!recipes || recipes.length === 0) return null;

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
    if (!inv || typeof inv !== "object") return null;
    const ip = inv.iconPrimaryColor;
    const is = inv.iconSecondaryColor;
    if (typeof ip !== "string" || typeof is !== "string") return null;
    const a = ip.trim();
    const b = is.trim();
    if (!a || !b) return null;
    return { primary: a, secondary: b };
  }

  /**
   * Items whose inventory icon is already full-color art — skip mask tint (primary/secondary).
   * Most are identified by `pickupType`; a few use e.g. `BoxPickupType` but still ship finished DDS.
   */
  const FULL_COLOR_ITEM_NAMES = new Set(["AetherkinAmmo"]);

  function isFullColorPickup(item) {
    if (item && typeof item.name === "string" && FULL_COLOR_ITEM_NAMES.has(item.name)) {
      return true;
    }
    const inv = item.inventorySetupInfo;
    const t = inv && inv.pickupType;
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
    if (!WC || typeof WC.lookupColorName !== "function") return null;
    const names = getIconColorNames(item);
    if (!names) return null;
    const p = WC.lookupColorName(names.primary);
    const s = WC.lookupColorName(names.secondary);
    if (!p || !s) return null;
    return { primary: p, secondary: s };
  }

  /** @returns {string|null} cache key if this item uses mask tinting; otherwise null */
  function tintCacheKey(iconUrl, item) {
    if (!getTintColorsForItem(item)) return null;
    const names = getIconColorNames(item);
    if (!names) return null;
    return iconUrl + "\0" + names.primary + "\0" + names.secondary;
  }

  function applyEquipmentMaskTint(img, primaryRgb, secondaryRgb) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    try {
      ctx.drawImage(img, 0, 0);
    } catch (e) {
      return null;
    }
    let imageData;
    try {
      imageData = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      return null;
    }
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
    try {
      return canvas.toDataURL("image/png");
    } catch (e) {
      return null;
    }
  }

  /**
   * Same pipeline as table icons: optional mask tint, shared data-URL cache.
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
    }
    img.onerror = function () {
      if (opts && typeof opts.onLoadError === "function") {
        opts.onLoadError();
      }
    };
    img.addEventListener(
      "load",
      function onIconDecoded() {
        if (tint) {
          const dataUrl = applyEquipmentMaskTint(img, tint.primary, tint.secondary);
          if (dataUrl) {
            if (tk) tintedIconDataUrlCache.set(tk, dataUrl);
            img.classList.add("item-icon--tinted");
            img.src = dataUrl;
            return;
          }
        }
      },
      { once: true }
    );
    img.src = url;
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
    const cg = document.getElementById("colgroup");
    if (!cg) return;
    const cols = visibleColumns();
    cg.innerHTML = "";

    // Deterministic pixel widths:
    // - same `weight` always maps to the same pixel width
    // - doesn't depend on which other columns are visible
    // - doesn't depend on container width
    const PX_PER_WEIGHT = 12;

    let totalPx = 0;
    for (let j = 0; j < cols.length; j++) {
      const id = cols[j].id;
      const w = COLUMN_LAYOUT_WEIGHT[id];
      const px = Math.max(16, Math.round(w * PX_PER_WEIGHT));
      totalPx += px;
      const col = document.createElement("col");
      col.style.width = px + "px";
      cg.appendChild(col);
    }

    // Force deterministic table sizing (prevents content-driven min-width expansion).
    const table = cg.closest("table");
    if (table) {
      table.style.width = totalPx + "px";
    }
  }

  /**
   * @param {{ objectType?: string } | null} [restored] — from localStorage; preferred value for &lt;select&gt; after rebuild
   */
  function populateObjectTypeFilter(restored) {
    const sel = document.getElementById("filter-object-type");
    if (!sel) return;
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
  }

  function getSortValue(item, colId) {
    switch (colId) {
      case "display":
        return displayName(item).toLowerCase();
      case "name":
        return (item.name || "").toLowerCase();
      case "objectType":
        return (item.objectType || "").toLowerCase();
      case "buy":
        return prices(item).buy;
      case "sell":
        return prices(item).sell;
      case "componentSell": {
        const v = componentSellPrice(item);
        return typeof v === "number" ? v : null;
      }
      case "profit": {
        const sell = prices(item).sell;
        const comp = componentSellPrice(item);
        const v = sell != null && comp != null ? sell - comp : null;
        return typeof v === "number" ? v : null;
      }
      case "description":
        return description(item).toLowerCase();
      case "dmgPhysical": {
        const d = getMeleeDamageDesc(item);
        return d && typeof d.physicalDamage === "number" ? d.physicalDamage : null;
      }
      case "meleeTimeBetweenAttacks": {
        const m = getMeleeWeaponSetup(item);
        return m && typeof m.timeBetweenAttacks === "number" ? m.timeBetweenAttacks : null;
      }
      case "meleeAttackRange": {
        const m = getMeleeWeaponSetup(item);
        return m && typeof m.attackRange === "number" ? m.attackRange : null;
      }
      case "dmgKnockback": {
        const d = getMeleeDamageDesc(item);
        return d && typeof d.knockbackMagnitude === "number" ? d.knockbackMagnitude : null;
      }
      default: {
        const def = COLUMN_BY_ID[colId];
        if (def && def.rtDamageKey) {
          const d = getRangedOrThrowableDamageDesc(item);
          const k = def.rtDamageKey;
          return d && typeof d[k] === "number" ? d[k] : null;
        }
        if (def && isClothingStatColumnDef(def)) {
          return getClothingStatSortValue(item, def);
        }
        if (def && def.placeBlockStatKey) {
          return getPlaceBlockStatSortValue(item, def.placeBlockStatKey);
        }
        if (def && def.grapplingHookStatKey) {
          return getGrapplingHookStatSortValue(item, def.grapplingHookStatKey);
        }
        if (def && def.placeableSetupStatKey) {
          return getPlaceableSetupStatSortValue(item, def.placeableSetupStatKey);
        }
        if (def && isPropulsionPlaceItemStatColumnDef(def)) {
          return getPropulsionPlaceItemStatSortValue(item, def);
        }
        if (def && isEnginePlaceItemStatColumnDef(def)) {
          return getEnginePlaceItemStatSortValue(item, def);
        }
        if (def && isGrinderPlaceItemStatColumnDef(def)) {
          return getGrinderPlaceItemStatSortValue(item, def);
        }
        if (def && isArtilleryShipItemStatColumnDef(def)) {
          return getArtilleryShipItemStatSortValue(item, def);
        }
        return "";
      }
    }
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
    const url = iconUrlFor(item);
    if (url && /\.png$/i.test(url)) {
      const img = document.createElement("img");
      img.loading = "lazy";
      const tk = tintCacheKey(url, item);
      const hadTintCache = Boolean(tk && tintedIconDataUrlCache.get(tk));
      wireCatalogItemIcon(img, item, url, {
        onLoadError() {
          const bad = missingIcon("Bad image");
          img.replaceWith(bad);
          bindRecipeHover(bad, item);
        },
      });
      td.appendChild(img);
      if (hadTintCache) {
        bindRecipeHover(img, item);
        return;
      }
    } else if (url && /\.dds$/i.test(url)) {
      td.appendChild(missingIcon("DDS"));
    } else {
      td.appendChild(missingIcon("—"));
    }
    const iconNode = td.querySelector(".item-icon");
    if (iconNode) {
      bindRecipeHover(iconNode, item);
    }
  }

  function missingIcon(text) {
    const d = document.createElement("div");
    d.className = "item-icon missing";
    d.textContent = text;
    return d;
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
          td.textContent = displayName(item) || "—";
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
          td.textContent = item.objectType || "—";
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
          if (colDef && colDef.rtDamageKey) {
            td.className = "num col-melee-dmg";
            td.textContent = rtDamageNumberCell(item, colDef.rtDamageKey);
          } else if (colDef && isClothingStatColumnDef(colDef)) {
            td.className = "num col-melee-dmg";
            td.textContent = clothingStatCell(item, colDef);
          } else if (colDef && colDef.placeBlockStatKey) {
            td.className = "num col-melee-dmg";
            td.textContent = placeBlockStatCell(item, colDef.placeBlockStatKey);
          } else if (colDef && colDef.grapplingHookStatKey) {
            td.className = "num col-melee-dmg";
            td.textContent = grapplingHookStatCell(item, colDef.grapplingHookStatKey);
          } else if (colDef && colDef.placeableSetupStatKey) {
            td.className = "num col-melee-dmg";
            td.textContent = placeableSetupStatCell(item, colDef.placeableSetupStatKey);
          } else if (colDef && isPropulsionPlaceItemStatColumnDef(colDef)) {
            td.className = "num col-melee-dmg";
            td.textContent = propulsionPlaceItemStatCell(item, colDef);
          } else if (colDef && isEnginePlaceItemStatColumnDef(colDef)) {
            td.className = "num col-melee-dmg";
            td.textContent = enginePlaceItemStatCell(item, colDef);
          } else if (colDef && isGrinderPlaceItemStatColumnDef(colDef)) {
            td.className = "num col-melee-dmg";
            td.textContent = grinderPlaceItemStatCell(item, colDef);
          } else if (colDef && isArtilleryShipItemStatColumnDef(colDef)) {
            td.className = "num col-melee-dmg";
            td.textContent = artilleryShipItemStatCell(item, colDef);
          } else {
            td.textContent = "—";
          }
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
    const wrap = document.getElementById("table-root");
    if (!tbody || !wrap) return;

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

      if (!rowHeights || rowHeights.length !== total) return;

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
    const wrap = document.getElementById("table-root");
    if (!wrap) return;
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

    const wrap = document.getElementById("table-root");
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
    if (!dlg || !pre) return;
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
    if (!id || !COLUMN_BY_ID[id] || !COLUMN_BY_ID[id].sortable) return;

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
    const [itemsRes, blocksRes] = await Promise.all([
      fetch("itemlist.json", { cache: "no-store" }),
      fetch("sharedblockinfo.json", { cache: "no-store" }),
    ]);
    if (!itemsRes.ok) throw new Error("itemlist.json: " + itemsRes.status);
    data = await itemsRes.json();
    if (!data.ItemList) data.ItemList = [];
    if (!data.iconMap) data.iconMap = {};
    if (!data.recipesByProduct) data.recipesByProduct = {};

    itemByName.clear();
    for (let i = 0; i < data.ItemList.length; i++) {
      const it = data.ItemList[i];
      if (it && typeof it.name === "string" && it.name) {
        itemByName.set(it.name, it);
      }
    }

    recipeTooltipEl = document.getElementById("recipe-tooltip");

    blockTypes = {};
    if (blocksRes.ok) {
      try {
        const bd = await blocksRes.json();
        if (bd && bd.blockTypes && typeof bd.blockTypes === "object") {
          blockTypes = bd.blockTypes;
        }
      } catch (e) {
        blockTypes = {};
      }
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
  }

  load().catch(function (e) {
    document.getElementById("table-root").innerHTML =
      '<div class="load-error"><p>Could not load <code>itemlist.json</code>. Run <code>python extract_itemlist.py</code> in this folder (writes <code>sharedblockinfo.json</code> and embeds <code>recipes.lua</code> craft data as <code>recipesByProduct</code>), then open via a local HTTP server from the game root.</p><pre>' +
      escapeHtml(String(e)) +
      "</pre></div>";
  });
})();
