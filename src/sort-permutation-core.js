var WISDOM_LEVEL_COUNT = 101;
  var PRICE_SORT_COLUMN_IDS = new Set(["buy", "sell", "componentSell", "profit"]);
  var PRECOMPUTED_WISDOM_SLICE_SET = new Set();
  for (var _wi = 0; _wi < WISDOM_LEVEL_COUNT; _wi++) PRECOMPUTED_WISDOM_SLICE_SET.add(_wi);
  var SECONDARY_SORT_INTERNAL_NAME = "name";
  var SECONDARY_SORT_RECIPE_BASE = "recipeBase";

  const COLUMNS = [
    { id: "icon", label: "Icon", sortable: false },
    { id: "display", label: "Display name", sortable: true, type: "string" },
    { id: "name", label: "Internal name", sortable: true, type: "string" },
    { id: "objectType", label: "Object type", sortable: true, type: "string" },
    { id: "buy", label: "Buy", sortable: true, type: "number" },
    { id: "sell", label: "Sell", sortable: true, type: "number" },
    {
      id: "componentSell",
      label: "Component sell",
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


  function createSortPermutationBindings(deps) {
    let priceMatrixBuy = null;
    let priceMatrixSell = null;
    let priceMatrixComp = null;
    let priceMatrixProfit = null;
    let sortCachePriceMatricesN = -1;

    function catalog() {
      return deps.getData();
    }
    function ibn() {
      return deps.getItemByName();
    }
    function blocks() {
      return deps.getBlockTypes();
    }
    function rse() {
      return deps.getRecipeSortEngine();
    }
    function wisdomLive() {
      return deps.getWisdomStat();
    }


  function applyWisdomPriceModifier(base, isSelling, wisdomOverride) {
    if (base == null || typeof base !== "number" || Number.isNaN(base)) return null;
    const s =
      wisdomOverride !== undefined && wisdomOverride !== null
        ? wisdomOverride
        : wisdomLive();
    const k = 0.0025;
    const mult = 1 + (isSelling ? 1 : -1) * k * s;
    return Math.ceil(base * mult);
  }
  function isClothingStatColumnDef(def) {
    return !!(def && (def.clothingTraitKey || def.clothingEquipField));
  }

  function getPlaceBlockStatsRow(item) {
    const bt = item.blockType;
    const row = blocks()[bt];
    return row;
  }

  function getPlaceBlockStatSortValue(item, key) {
    const row = getPlaceBlockStatsRow(item);
    if (!row) return null;
    return row[key];
  }

  function getGrapplingHookSetup(item) {
    return item.grapplingHookSetupInfo;
  }

  function getGrapplingHookStatSortValue(item, key) {
    const g = getGrapplingHookSetup(item);
    if (!g) return null;
    return g[key];
  }

  function getPlaceableSetupStatSortValue(item, key) {
    if (item.objectType === PLACE_BLOCK_ITEM_OBJECT_TYPE) {
      return getPlaceBlockStatSortValue(item, key);
    }
    const p = item.placeableSetupInfo;
    if (!p) return null;
    return p[key];
  }

  function isPropulsionPlaceItemStatColumnDef(def) {
    return !!(def && def.propulsionSetupKey);
  }

  function getPropulsionPlaceItemStatSortValue(item, def) {
    const p = item.propulsionSetupInfo;
    if (!p) return null;
    return p[def.propulsionSetupKey];
  }

  function isEnginePlaceItemStatColumnDef(def) {
    return !!(def && def.engineSetupKey);
  }

  function getEnginePlaceItemStatSortValue(item, def) {
    const e = item.engineSetupInfo;
    if (!e) return null;
    return e[def.engineSetupKey];
  }

  function isGrinderPlaceItemStatColumnDef(def) {
    return !!(def && def.grinderSetupKey);
  }

  function getGrinderPlaceItemStatSortValue(item, def) {
    const g = item.grinderSetupInfo;
    if (!g) return null;
    return g[def.grinderSetupKey];
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
  function displayName(item) {
    const inv = item.inventorySetupInfo;
    if (!inv) return item.name || "";
    const s = inv.itemDisplayName;
    return s && s.trim() ? s.trim() : item.name;
  }
  function description(item) {
    const inv = item.inventorySetupInfo;
    if (!inv) return "";
    return inv.itemDescription || "";
  }
  function getMeleeWeaponSetup(item) {
    const m = item.meleeWeaponSetupInfo;
    return m;
  }

  /** @returns {object|null} `damageDesc` or null when item has no melee damage block. */
  function getMeleeDamageDesc(item) {
    const m = getMeleeWeaponSetup(item);
    if (!m || m.damageDesc == null) return null;
    return m.damageDesc;
  }

  /** @param {number} [wisdomOverride] — omit for live {@link wisdomStat}. */
  function prices(item, wisdomOverride) {
    const inv = item.inventorySetupInfo;
    if (!inv) return { buy: null, sell: null };
    const buy = inv.buyPrice;
    const sell = inv.sellPrice;
    return {
      buy: applyWisdomPriceModifier(buy, false, wisdomOverride),
      sell: applyWisdomPriceModifier(sell, true, wisdomOverride),
    };
  }

  /**
   * Sum of component sell prices used to craft `item`, normalized per 1 output item.
   *
   * For items with multiple recipe variants, we take the minimum cost variant.
   * Returns `null` when no complete recipe can be costed.
   */
  /** @param {number} [wisdomOverride] — omit for live {@link wisdomStat}. */
  function componentSellPrice(item, wisdomOverride) {
    const recipes = catalog().recipesByProduct && catalog().recipesByProduct[item.name];
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
        const sub = ibn().get(ing.name);
        if (!sub) {
          valid = false;
          break;
        }
        const inv = sub.inventorySetupInfo;
        const sp = inv
          ? applyWisdomPriceModifier(inv.sellPrice, true, wisdomOverride)
          : null;
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
  /** @param {number} [wisdomOverride] — omit for live {@link wisdomStat}. */
  function profitValue(item, wisdomOverride) {
    const pr = prices(item, wisdomOverride);
    const sell = pr && typeof pr.sell === "number" ? pr.sell : null;
    if (sell == null) return null;
    const comp = componentSellPrice(item, wisdomOverride);
    if (comp == null) return null;
    return sell - comp;
  }
  function getStatValueFromColumnDef(item, def) {
    if (def.rtDamageKey) {
      const rd = getRangedOrThrowableDamageDesc(item);
      return rd == null ? null : rd[def.rtDamageKey];
    }
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

  function sortNumberMissing(v) {
    return v == null || (typeof v === "number" && Number.isNaN(v));
  }

  function getSortValue(item, colId, wisdomForPrices) {
    if (colId === "display") return displayName(item).toLowerCase();
    if (colId === "name") return (item.name || "").toLowerCase();
    if (colId === "objectType") return (item.objectType || "").toLowerCase();
    if (colId === "buy") return prices(item, wisdomForPrices).buy;
    if (colId === "sell") return prices(item, wisdomForPrices).sell;
    if (colId === "componentSell") return componentSellPrice(item, wisdomForPrices);
    if (colId === "profit") return profitValue(item, wisdomForPrices);
    if (colId === "description") return description(item).toLowerCase();
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
    return def ? getStatValueFromColumnDef(item, def) : "";
  }

  function compareItemIndices(ia, ib, state) {
    const col = state.col;
    const def = COLUMN_BY_ID[col];
    const dir = state.dir;
    const secondary = state.secondary;
    const wisdom = state.wisdom;
    const items = catalog().ItemList;
    const a = items[ia];
    const b = items[ib];
    let va;
    let vb;
    if (
      PRICE_SORT_COLUMN_IDS.has(col) &&
      priceMatrixBuy &&
      priceMatrixBuy.length > 0 &&
      PRECOMPUTED_WISDOM_SLICE_SET.has(wisdom)
    ) {
      const n = items.length;
      const o = wisdom * n;
      let mat;
      if (col === "buy") mat = priceMatrixBuy;
      else if (col === "sell") mat = priceMatrixSell;
      else if (col === "componentSell") mat = priceMatrixComp;
      else mat = priceMatrixProfit;
      va = mat[o + ia];
      vb = mat[o + ib];
    } else {
      const wArg = PRICE_SORT_COLUMN_IDS.has(col) ? wisdom : undefined;
      va = getSortValue(a, col, wArg);
      vb = getSortValue(b, col, wArg);
    }

    if (def && def.type === "number") {
      const aMiss = sortNumberMissing(va);
      const bMiss = sortNumberMissing(vb);
      if (aMiss || bMiss) {
        if (aMiss && bMiss) return 0;
        if (aMiss) return 1;
        return -1;
      }
      const na = Number(va);
      const nb = Number(vb);
      if (na !== nb) return (na - nb) * dir;
    } else {
      let c;
      if (secondary === SECONDARY_SORT_RECIPE_BASE) {
        if (col === "name") {
          c = rse().compareByRecipeBaseThenName(a.name || "", b.name || "");
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

    if (secondary === SECONDARY_SORT_RECIPE_BASE && col !== "name") {
      return rse().compareByRecipeBaseThenName(a.name || "", b.name || "");
    }
    return (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base", numeric: true });
  }

  function rebuildItemByName() {
    ibn().clear();
    var items = catalog().ItemList;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && typeof it.name === "string" && it.name) ibn().set(it.name, it);
    }
  }

  function sortCacheKey(col, dirStr, secondary, wisdomSlice) {
    return col + "\0" + dirStr + "\0" + secondary + "\0" + String(wisdomSlice);
  }

  function wisdomSlicesOrderedForJobs(currentWisdom) {
    var W = WISDOM_LEVEL_COUNT;
    var cur = Math.max(0, Math.min(W - 1, Number(currentWisdom) || 0));
    var out = [cur];
    for (var w = 0; w < W; w++) {
      if (w !== cur) out.push(w);
    }
    return out;
  }

  function collectSortCacheJobSpecs(currentWisdom) {
    var jobs = [];
    var n = catalog().ItemList.length;
    if (n === 0) return jobs;
    var wListPrice = wisdomSlicesOrderedForJobs(currentWisdom);
    for (var ci = 0; ci < COLUMNS.length; ci++) {
      var colDef = COLUMNS[ci];
      if (!colDef.sortable) continue;
      var col = colDef.id;
      for (var d = 0; d < 2; d++) {
        var dirStr = d === 0 ? "asc" : "desc";
        var dir = d === 0 ? 1 : -1;
        for (var s = 0; s < 2; s++) {
          var secondary = s === 0 ? SECONDARY_SORT_INTERNAL_NAME : SECONDARY_SORT_RECIPE_BASE;
          var wList = PRICE_SORT_COLUMN_IDS.has(col) ? wListPrice : [0];
          for (var wi = 0; wi < wList.length; wi++) {
            var w = wList[wi];
            jobs.push({
              col: col,
              dirStr: dirStr,
              dir: dir,
              secondary: secondary,
              wisdomSlice: PRICE_SORT_COLUMN_IDS.has(col) ? w : 0,
            });
          }
        }
      }
    }
    return jobs;
  }

  function precomputePriceMatrices() {
    var items = catalog().ItemList;
    var n = items.length;
    var W = WISDOM_LEVEL_COUNT;
    if (n === 0) {
      priceMatrixBuy = new Float64Array(0);
      priceMatrixSell = new Float64Array(0);
      priceMatrixComp = new Float64Array(0);
      priceMatrixProfit = new Float64Array(0);
      sortCachePriceMatricesN = 0;
      return;
    }
    priceMatrixBuy = new Float64Array(W * n);
    priceMatrixSell = new Float64Array(W * n);
    priceMatrixComp = new Float64Array(W * n);
    priceMatrixProfit = new Float64Array(W * n);
    for (var z = 0; z < priceMatrixBuy.length; z++) {
      priceMatrixBuy[z] = NaN;
      priceMatrixSell[z] = NaN;
      priceMatrixComp[z] = NaN;
      priceMatrixProfit[z] = NaN;
    }
    for (var w = 0; w < W; w++) {
      var base = w * n;
      for (var i = 0; i < n; i++) {
        var item = items[i];
        var pr = prices(item, w);
        priceMatrixBuy[base + i] = pr.buy == null ? NaN : pr.buy;
        priceMatrixSell[base + i] = pr.sell == null ? NaN : pr.sell;
        var c = componentSellPrice(item, w);
        priceMatrixComp[base + i] = c == null ? NaN : c;
        var sell = pr.sell;
        var p = NaN;
        if (sell != null && c != null && typeof sell === "number" && typeof c === "number") p = sell - c;
        priceMatrixProfit[base + i] = p;
      }
    }
    sortCachePriceMatricesN = n;
  }

  function ensurePriceMatricesForPrecomputedSlices() {
    const n = catalog().ItemList.length;
    const W = WISDOM_LEVEL_COUNT;
    if (
      sortCachePriceMatricesN === n &&
      priceMatrixBuy &&
      priceMatrixBuy.length === W * n
    ) {
      return;
    }
    precomputePriceMatrices();
    sortCachePriceMatricesN = n;
  }

  function applyMatricesFromWorkerBuffers(n, buyBuf, sellBuf, compBuf, profitBuf) {
    if (n === 0) {
      priceMatrixBuy = new Float64Array(0);
      priceMatrixSell = new Float64Array(0);
      priceMatrixComp = new Float64Array(0);
      priceMatrixProfit = new Float64Array(0);
      sortCachePriceMatricesN = 0;
      return;
    }
    priceMatrixBuy = new Float64Array(buyBuf);
    priceMatrixSell = new Float64Array(sellBuf);
    priceMatrixComp = new Float64Array(compBuf);
    priceMatrixProfit = new Float64Array(profitBuf);
    sortCachePriceMatricesN = n;
  }

  function cloneMatrixBuffersForTransfer() {
    return {
      buy: priceMatrixBuy.buffer.slice(0),
      sell: priceMatrixSell.buffer.slice(0),
      comp: priceMatrixComp.buffer.slice(0),
      profit: priceMatrixProfit.buffer.slice(0),
    };
  }

  function buildSortPermutation(state) {
    var items = catalog().ItemList;
    var n = items.length;
    if (n === 0) return new Int32Array(0);
    var idx = new Array(n);
    for (var i = 0; i < n; i++) idx[i] = i;
    idx.sort(function (ia, ib) {
      return compareItemIndices(ia, ib, state);
    });
    var out = new Int32Array(n);
    for (var j = 0; j < n; j++) out[j] = idx[j];
    return out;
  }

  function invalidatePriceMatricesCache() {
    priceMatrixBuy = null;
    priceMatrixSell = null;
    priceMatrixComp = null;
    priceMatrixProfit = null;
    sortCachePriceMatricesN = -1;
  }

    return {
      rebuildItemByName: rebuildItemByName,
      sortCacheKey: sortCacheKey,
      wisdomSlicesOrderedForJobs: wisdomSlicesOrderedForJobs,
      collectSortCacheJobSpecs: collectSortCacheJobSpecs,
      precomputePriceMatrices: precomputePriceMatrices,
      cloneMatrixBuffersForTransfer: cloneMatrixBuffersForTransfer,
      buildSortPermutation: buildSortPermutation,
      compareItemIndices: compareItemIndices,
      applyWisdomPriceModifier: applyWisdomPriceModifier,
      prices: prices,
      componentSellPrice: componentSellPrice,
      profitValue: profitValue,
      displayName: displayName,
      description: description,
      getMeleeWeaponSetup: getMeleeWeaponSetup,
      getMeleeDamageDesc: getMeleeDamageDesc,
      getStatValueFromColumnDef: getStatValueFromColumnDef,
      getSortValue: getSortValue,
      sortNumberMissing: sortNumberMissing,
      ensurePriceMatricesForPrecomputedSlices: ensurePriceMatricesForPrecomputedSlices,
      applyMatricesFromWorkerBuffers: applyMatricesFromWorkerBuffers,
      getPriceMatricesItemCount: function () {
        return sortCachePriceMatricesN;
      },
      invalidatePriceMatricesCache: invalidatePriceMatricesCache,
    };
  }

export const itemCatalogSortPermutation = {
    createBindings: createSortPermutationBindings,
    COLUMNS: COLUMNS,
    COLUMN_BY_ID: COLUMN_BY_ID,
    SECONDARY_SORT_INTERNAL_NAME: SECONDARY_SORT_INTERNAL_NAME,
    SECONDARY_SORT_RECIPE_BASE: SECONDARY_SORT_RECIPE_BASE,
    WISDOM_LEVEL_COUNT: WISDOM_LEVEL_COUNT,
    PRICE_SORT_COLUMN_IDS: PRICE_SORT_COLUMN_IDS,
    PRECOMPUTED_WISDOM_SLICE_SET: PRECOMPUTED_WISDOM_SLICE_SET,
    MELEE_WEAPON_OBJECT_TYPE: MELEE_WEAPON_OBJECT_TYPE,
    JACKHAMMER_OBJECT_TYPE: JACKHAMMER_OBJECT_TYPE,
    RANGED_WEAPON_OBJECT_TYPE: RANGED_WEAPON_OBJECT_TYPE,
    THROWABLE_WEAPON_OBJECT_TYPE: THROWABLE_WEAPON_OBJECT_TYPE,
    CLOTHING_ITEM_OBJECT_TYPE: CLOTHING_ITEM_OBJECT_TYPE,
    PLACE_BLOCK_ITEM_OBJECT_TYPE: PLACE_BLOCK_ITEM_OBJECT_TYPE,
    GRAPPLING_HOOK_OBJECT_TYPE: GRAPPLING_HOOK_OBJECT_TYPE,
    PLACE_PROPULSION_OBJECT_ITEM_TYPE: PLACE_PROPULSION_OBJECT_ITEM_TYPE,
    PLACE_ENGINE_OBJECT_ITEM_TYPE: PLACE_ENGINE_OBJECT_ITEM_TYPE,
    PLACE_GRINDER_OBJECT_ITEM_TYPE: PLACE_GRINDER_OBJECT_ITEM_TYPE,
    PLACE_OBJECT_ITEM_TYPE: PLACE_OBJECT_ITEM_TYPE,
    PLACE_SHIP_SCAFFOLDING_ITEM_TYPE: PLACE_SHIP_SCAFFOLDING_ITEM_TYPE,
    PLACE_ARTILLERY_SHIP_ITEM_TYPE: PLACE_ARTILLERY_SHIP_ITEM_TYPE,
    PLACEABLE_SETUP_STAT_TYPE_SET: PLACEABLE_SETUP_STAT_TYPE_SET,
  };
