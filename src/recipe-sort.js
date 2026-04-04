function splitInternalNameWords(name) {
  if (!name || typeof name !== "string") return [];
  const spaced = name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  if (!spaced) return [];
  return spaced.split(/\s+/).filter(Boolean);
}

export function createRecipeSortEngine() {
  let data = { ItemList: [], recipesByProduct: {} };

  const RECIPE_PRIMARY_MATERIAL_ORDER = [
    "BronzeIngot",
    "IronIngot",
    "SteelIngot",
    "TitaniumIngot",
    "AdamantiumIngot",
    "JadeSteelIngot",
    "VulcanSteelIngot",
    "CloudstoneIngot",
  ];
  const RECIPE_SECONDARY_MATERIAL_ORDER = [
    "Cloth",
    "Insulation",
    "Leather",
    "Rubber",
    "AcidBasiliskScales",
    "FireBasiliskScales",
    "PoisonBasiliskScales",
  ];
  const RECIPE_NAME_TOKEN_ALIASES_BY_MATERIAL = {
    AdamantiumOre: ["Purple"],
    IronOre: ["Blue"],
    TitaniumOre: ["Cyan"],
    CopperOre: ["Green"],
    Heartstone: ["Red"],
    Sulphur: ["Yellow"],
  };
  const RECIPE_BASE_NAME_ALIASES = {
    Revolver: ["Magnum"],
    AutomaticPistol: ["Pistol"],
    ChimneyRoof: ["RoofChimney"],
    Battery: ["ChemicalBattery"],
  };
  const RECIPE_NAMING_CLASSES = {
    background: [
      "Bronze",
      "Iron",
      "Steel",
      "Titanium",
      "Adamantium",
      "Jade",
      "Vulcan",
      "Cloudstone",
      "Wood",
      "Glass",
      "Stone",
      "Brick",
      "Meat",
      "Blubber",
      "Shell",
      "Purple",
      "Blue",
      "Cyan",
      "Green",
      "Red",
      "Yellow",
    ],
    weapon: [
      "Bronze",
      "Iron",
      "Steel",
      "Titanium",
      "Adamantium",
      "Jade",
      "Vulcan",
      "Cloudstone",
      "Impact",
      "Machine",
      "Semi",
      "Auto",
      "Double",
      "Barrel",
      "Sniper",
      "Scoped",
      "Reflective",
    ],
    throwable: [
      "Bronze",
      "Iron",
      "Steel",
      "Titanium",
      "Adamantium",
      "Jade",
      "Vulcan",
      "Cloudstone",
      "Triple",
      "Poison",
      "Deadly",
      "Sticky",
      "Contact",
      "Throwing",
    ],
    structural: [
      "Wood",
      "Helium",
      "Hydrogen",
      "Bronze",
      "Iron",
      "Steel",
      "Titanium",
      "Adamantium",
      "Jade",
      "Vulcan",
      "Cloudstone",
      "Copper",
      "Stone",
      "Brick",
    ],
    default: [],
  };
  const RECIPE_NAMING_CLASS_BY_BASE = {
    BackgroundBlock: "background",
    BackgroundWindowBlock: "background",
    BackgroundStainGlassWindow: "background",
    BackgroundMeatBlock: "background",
    Revolver: "weapon",
    AutomaticPistol: "weapon",
    HuntingGun: "weapon",
    Rifle: "weapon",
    AutomaticRifle: "weapon",
    PumpActionShotgun: "weapon",
    RiotGun: "weapon",
    FlakGun: "weapon",
    RecoilGun: "weapon",
    ScopedRifle: "weapon",
    ScopedAetherkinRifle: "weapon",
    GatlingGun: "weapon",
    RotaryCannon: "weapon",
    AetherkinSniperRifle: "weapon",
    AetherkinReflectiveRifle: "weapon",
    ThrowingKnife: "throwable",
    PoisonThrowingKnife: "throwable",
    DeadlyPoisonThrowingKnife: "throwable",
    TripleThrowingKnife: "throwable",
    TriplePoisonThrowingKnife: "throwable",
    TripleDeadlyPoisonThrowingKnife: "throwable",
    Rock: "throwable",
    Grenade360: "throwable",
    PlateBlock: "structural",
    Platform: "structural",
    Supports: "structural",
    Door: "structural",
    Hatch: "structural",
    SideWindow: "structural",
    Roof: "structural",
    ChimneyRoof: "structural",
    SmallGasBalloon: "structural",
    ZeppelinGasBalloon: "structural",
    MediumCrudePropeller: "structural",
    MediumPropeller: "structural",
  };
  const RECIPE_TIER_ORDER = { normal: 0, quality: 1, mastercraft: 2 };
  const RECIPE_FAMILY_RULES_BY_BASE = {
    AutomaticRifle: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    Rifle: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    PumpActionShotgun: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    RiotGun: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    FlakGun: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    RecoilGun: { requireBaseSuffix: false, requireMaterialPrefixTokens: false },
    ScopedRifle: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    ScopedAetherkinRifle: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    GatlingGun: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    RotaryCannon: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    BackgroundBlock: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    Revolver: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    AutomaticPistol: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    HuntingGun: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    BackgroundWindowBlock: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    Grenade360: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    TripleGrenade: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    Rock: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    ThrowingKnife: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    PoisonThrowingKnife: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    PoisonedHuntingKnife: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    PoisonedCombatKnife: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    DeadlyPoisonThrowingKnife: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    TripleThrowingKnife: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    TriplePoisonThrowingKnife: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    TripleDeadlyPoisonThrowingKnife: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    SawedOffShotgun: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    ParatrooperJacket: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    ParatrooperPants: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    PowerAmour: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    CleatedArmourBoots: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    RunningShoes: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    SmallGasBalloon: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
      namingPatterns: ["first_last_replace"],
    },
    ZeppelinGasBalloon: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
      namingPatterns: ["first_last_replace"],
    },
    MediumCrudePropeller: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
      namingPatterns: ["first_insert_tail"],
    },
    MediumPropeller: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
      namingPatterns: ["first_insert_tail"],
    },
    JunglePlant: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    AetherkinAutoTurret: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    MachineGunTurret: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    ArtilleryTurret: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    ImpactMachineGunTurret: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    ClusterBombTurret: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
    CookedMeat: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    AetherkinElixir: {
      requireBaseSuffix: false,
      requireMaterialPrefixTokens: false,
    },
    Battery: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    Door: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    Hatch: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    SideWindow: { requireBaseSuffix: true, requireMaterialPrefixTokens: false },
    Roof: { requireBaseSuffix: false, requireMaterialPrefixTokens: false },
    ChimneyRoof: {
      requireBaseSuffix: true,
      requireMaterialPrefixTokens: false,
    },
  };
  const RECIPE_REQUIRE_EXPLICIT_FAMILY_RULES = false;
  const RECIPE_REQUIRE_EXPLICIT_BASE_GROUPS = true;
  const RECIPE_BASE_GROUP_RULES = [
    { path: "craft.structural.background", test: /^Background/i },
    { path: "craft.structural.platform", test: /Platform/i },
    { path: "craft.structural.supports", test: /Supports/i },
    { path: "craft.structural.plate", test: /Plate/i },
    { path: "craft.materials.ore", test: /Ore$/i },
    { path: "craft.materials.ingot", test: /Ingot$/i },
    { path: "craft.combat.ammo", test: /Ammo$/i },
    {
      path: "craft.generic",
      test: /^(Water|Helium|Hydrogen|Cloth|Insulation|Glass|Paper|Rubber|Lifestone|ConcentratedPoison|RefinedHeartstone|Filter|GasTank|Bottle|Lens|CopperWire|Solenoid|Spring|Capacitor|Battery|SmallMotor|LargeMotor|SparkPlug|Speaker|Microphone|GunPowder|WhaleOil|Charcoal|SulphuricAcid|AcidBasiliskScales|FireBasiliskScales|PoisonBasiliskScales|BasiliskMeat|MantisMeat|ShaugMeat|ChokeRoot|MandragoraRoot|WindSeedPlant|GumSeed|TreeSap|Cotton|Diamond|Leather|LifestoneFragment|Sulphur|Heartstone)$/i,
    },
    {
      path: "craft.knowledge.tablet",
      test: /(Tablet|Albedo|Rubedo|Cintrintas|Nigredo)$/i,
    },
  ];
  const RECIPE_BASE_GROUP_ORDER = (function () {
    const out = { __unassigned__: 9999 };
    for (let i = 0; i < RECIPE_BASE_GROUP_RULES.length; i++) {
      const path = String(RECIPE_BASE_GROUP_RULES[i].path || "");
      if (!path || path === "__unassigned__") continue;
      if (!Object.prototype.hasOwnProperty.call(out, path)) out[path] = i;
    }
    return out;
  })();
  const primaryRank = new Map();
  const secondaryRank = new Map();
  for (let i = 0; i < RECIPE_PRIMARY_MATERIAL_ORDER.length; i++)
    primaryRank.set(RECIPE_PRIMARY_MATERIAL_ORDER[i], i);
  for (let i = 0; i < RECIPE_SECONDARY_MATERIAL_ORDER.length; i++)
    secondaryRank.set(RECIPE_SECONDARY_MATERIAL_ORDER[i], i);
  const cache = new Map();

  function getCraftTierInfo(itemName) {
    const n = String(itemName || "");
    if (n.startsWith("MasterCraft") && n.length > "MasterCraft".length)
      return { tier: "mastercraft", base: n.slice("MasterCraft".length) };
    if (n.startsWith("Quality") && n.length > "Quality".length)
      return { tier: "quality", base: n.slice("Quality".length) };
    return { tier: "normal", base: n };
  }
  function getRecipeFamilyRule(baseName) {
    const manual = RECIPE_FAMILY_RULES_BY_BASE[String(baseName || "")] || null;
    return {
      hasExplicitRule: Boolean(manual),
      requireBaseSuffix: manual ? manual.requireBaseSuffix !== false : true,
      requireMaterialPrefixTokens: manual
        ? manual.requireMaterialPrefixTokens !== false
        : true,
    };
  }
  function namingWordSet(baseName) {
    const cls =
      RECIPE_NAMING_CLASS_BY_BASE[String(baseName || "").trim()] || "default";
    return new Set(RECIPE_NAMING_CLASSES[cls] || RECIPE_NAMING_CLASSES.default);
  }
  function familyAllowsPattern(baseName, patternId) {
    const manual = RECIPE_FAMILY_RULES_BY_BASE[String(baseName || "")] || null;
    if (!manual || !Array.isArray(manual.namingPatterns)) return true;
    return manual.namingPatterns.indexOf(patternId) !== -1;
  }
  function groupForBase(baseName) {
    const b = String(baseName || "").trim();
    for (let i = 0; i < RECIPE_BASE_GROUP_RULES.length; i++)
      if (RECIPE_BASE_GROUP_RULES[i].test.test(b))
        return RECIPE_BASE_GROUP_RULES[i].path;
    return "__unassigned__";
  }
  function bestRecipeBaseForName(n) {
    const recs = data.recipesByProduct && data.recipesByProduct[n];
    if (Array.isArray(recs) && recs.length) {
      let best = "";
      for (let i = 0; i < recs.length; i++) {
        const b = String((recs[i] && recs[i].recipeSetBaseName) || "").trim();
        if (!b) continue;
        if (
          !best ||
          b.localeCompare(best, undefined, {
            sensitivity: "base",
            numeric: true,
          }) < 0
        )
          best = b;
      }
      if (best) return best;
    }
    return "";
  }
  function detectPrimary(ingredients) {
    if (!Array.isArray(ingredients)) return "";
    for (let i = 0; i < RECIPE_PRIMARY_MATERIAL_ORDER.length; i++) {
      const want = RECIPE_PRIMARY_MATERIAL_ORDER[i];
      for (let j = 0; j < ingredients.length; j++)
        if (String((ingredients[j] && ingredients[j].name) || "") === want)
          return want;
    }
    return "";
  }
  function detectSecondary(ingredients) {
    if (!Array.isArray(ingredients)) return "";
    for (let i = 0; i < RECIPE_SECONDARY_MATERIAL_ORDER.length; i++) {
      const want = RECIPE_SECONDARY_MATERIAL_ORDER[i];
      for (let j = 0; j < ingredients.length; j++)
        if (String((ingredients[j] && ingredients[j].name) || "") === want)
          return want;
    }
    return "";
  }
  function getKey(name) {
    const keyName = String(name || "");
    if (cache.has(keyName)) return cache.get(keyName);
    const isBook =
      keyName.endsWith("RecipeBook") && keyName.length > "RecipeBook".length;
    const bookTarget = isBook
      ? keyName.slice(0, keyName.length - "RecipeBook".length)
      : "";
    const bookKey = isBook ? getKey(bookTarget) : null;
    const tier = getCraftTierInfo(keyName);
    const recs = data.recipesByProduct && data.recipesByProduct[keyName];
    const baseName = bestRecipeBaseForName(keyName) || tier.base || keyName;
    let primary = "",
      secondary = "";
    if (Array.isArray(recs) && recs.length) {
      const ingredients = (recs[0] && recs[0].ingredients) || null;
      primary = detectPrimary(ingredients);
      secondary = detectSecondary(ingredients);
    }
    const groupName = groupForBase(baseName);
    const key = {
      isRecipeBook: isBook,
      recipeBookOrder: isBook ? 1 : 0,
      recipeBookTargetName: bookTarget,
      recipeBookTargetGroupOrder: bookKey ? bookKey.groupOrder : 9999,
      recipeBookTargetGroupName: bookKey ? bookKey.groupName : "",
      recipeBookTargetBaseName: bookKey ? bookKey.baseName : bookTarget,
      baseName: baseName,
      groupName: groupName,
      groupOrder:
        RECIPE_BASE_GROUP_ORDER[groupName] ??
        RECIPE_BASE_GROUP_ORDER.__unassigned__,
      primaryName: primary,
      primaryOrder: primaryRank.has(primary) ? primaryRank.get(primary) : 9999,
      secondaryName: secondary,
      secondaryOrder: secondaryRank.has(secondary)
        ? secondaryRank.get(secondary)
        : 9999,
      tierOrder: Object.prototype.hasOwnProperty.call(
        RECIPE_TIER_ORDER,
        tier.tier,
      )
        ? RECIPE_TIER_ORDER[tier.tier]
        : 9999,
    };
    cache.set(keyName, key);
    return key;
  }
  function extractPrefixAndBasePattern(nameBase, baseName) {
    const allowed = namingWordSet(baseName);
    function explicitPrefix(p) {
      const words = splitInternalNameWords(String(p || ""));
      if (!words.length) return false;
      for (let i = 0; i < words.length; i++)
        if (!allowed.has(words[i])) return false;
      return true;
    }
    const full = String(nameBase || "");
    const base = String(baseName || "");
    if (!full || !base) return { matchedBase: false, prefix: "" };
    if (familyAllowsPattern(base, "base_suffix") && full.endsWith(base))
      return {
        matchedBase: true,
        prefix: full.slice(0, full.length - base.length),
      };
    const aliases = RECIPE_BASE_NAME_ALIASES[base];
    if (Array.isArray(aliases)) {
      for (let i = 0; i < aliases.length; i++) {
        const alias = String(aliases[i] || "");
        if (!alias) continue;
        if (
          familyAllowsPattern(base, "base_alias_suffix") &&
          full.endsWith(alias)
        )
          return {
            matchedBase: true,
            prefix: full.slice(0, full.length - alias.length),
          };
        if (
          familyAllowsPattern(base, "base_alias_prefix_plus_variant") &&
          full.startsWith(alias) &&
          full.length > alias.length
        ) {
          const tail = full.slice(alias.length);
          if (explicitPrefix(tail)) return { matchedBase: true, prefix: tail };
        }
      }
    }
    if (base.endsWith("Block")) {
      const stem = base.slice(0, -5);
      if (
        familyAllowsPattern(base, "material_plus_base_without_block") &&
        stem &&
        full.endsWith(stem)
      )
        return {
          matchedBase: true,
          prefix: full.slice(0, full.length - stem.length),
        };
      if (
        familyAllowsPattern(base, "base_without_block_plus_material_block") &&
        stem &&
        full.startsWith(stem) &&
        full.endsWith("Block") &&
        full.length >= stem.length + 5
      ) {
        const mid = full.slice(stem.length, full.length - 5);
        if (explicitPrefix(mid)) return { matchedBase: true, prefix: mid };
      }
    } else {
      if (
        familyAllowsPattern(base, "base_plus_variant") &&
        full.startsWith(base) &&
        full.length > base.length
      ) {
        const tail = full.slice(base.length);
        if (explicitPrefix(tail)) return { matchedBase: true, prefix: tail };
      }
    }
    return { matchedBase: false, prefix: "" };
  }
  function nameTokenForMaterialToken(tok) {
    let s = String(tok || "");
    s = s
      .replace(/Ingot$/i, "")
      .replace(/Block$/i, "")
      .replace(/Fragment$/i, "")
      .replace(/Brick$/i, "");
    return s;
  }
  function prefixMatchesMaterialTokens(prefix, key) {
    const p = String(prefix || "");
    if (!p) return true;
    const allowed = namingWordSet(key.baseName);
    const words = splitInternalNameWords(p);
    if (!words.length) return false;
    const s = key.secondaryName
      ? nameTokenForMaterialToken(key.secondaryName)
      : "";
    const pri = key.primaryName
      ? nameTokenForMaterialToken(key.primaryName)
      : "";
    if (!s && !pri) {
      for (let i = 0; i < words.length; i++)
        if (!allowed.has(words[i])) return false;
      return true;
    }
    const all = new Set();
    if (s) all.add(s);
    if (pri) all.add(pri);
    const aliasesS =
      RECIPE_NAME_TOKEN_ALIASES_BY_MATERIAL[key.secondaryName] || [];
    for (let i = 0; i < aliasesS.length; i++)
      all.add(String(aliasesS[i] || ""));
    const joined = words.join("");
    return all.has(joined);
  }

  function compareByRecipeBaseThenName(nameA, nameB) {
    const ka = getKey(nameA);
    const kb = getKey(nameB);
    if (ka.recipeBookOrder !== kb.recipeBookOrder)
      return ka.recipeBookOrder - kb.recipeBookOrder;
    if (ka.isRecipeBook && kb.isRecipeBook) {
      if (ka.recipeBookTargetGroupOrder !== kb.recipeBookTargetGroupOrder)
        return ka.recipeBookTargetGroupOrder - kb.recipeBookTargetGroupOrder;
      const c1 = ka.recipeBookTargetGroupName.localeCompare(
        kb.recipeBookTargetGroupName,
        undefined,
        { sensitivity: "base", numeric: true },
      );
      if (c1 !== 0) return c1;
      const c2 = ka.recipeBookTargetBaseName.localeCompare(
        kb.recipeBookTargetBaseName,
        undefined,
        { sensitivity: "base", numeric: true },
      );
      if (c2 !== 0) return c2;
    }
    if (ka.groupOrder !== kb.groupOrder) return ka.groupOrder - kb.groupOrder;
    const g = ka.groupName.localeCompare(kb.groupName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (g !== 0) return g;
    const b = ka.baseName.localeCompare(kb.baseName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (b !== 0) return b;
    if (ka.primaryOrder !== kb.primaryOrder)
      return ka.primaryOrder - kb.primaryOrder;
    const p = ka.primaryName.localeCompare(kb.primaryName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (p !== 0) return p;
    if (ka.secondaryOrder !== kb.secondaryOrder)
      return ka.secondaryOrder - kb.secondaryOrder;
    const s = ka.secondaryName.localeCompare(kb.secondaryName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (s !== 0) return s;
    if (ka.tierOrder !== kb.tierOrder) return ka.tierOrder - kb.tierOrder;
    return String(nameA || "").localeCompare(String(nameB || ""), undefined, {
      sensitivity: "base",
      numeric: true,
    });
  }

  function validateRecipeSortTokenCoverage(visibleItemNamesSet) {
    const failures = [];
    const items = data.ItemList || [];
    for (let i = 0; i < items.length; i++) {
      const name = String((items[i] && items[i].name) || "");
      if (!name) continue;
      if (visibleItemNamesSet && !visibleItemNamesSet.has(name)) continue;
      const key = getKey(name);
      const baseName = String(key.baseName || "");
      if (!baseName) {
        failures.push({
          name: name,
          reason: "missing baseName in recipe metadata",
        });
        continue;
      }
      if (
        RECIPE_REQUIRE_EXPLICIT_BASE_GROUPS &&
        key.groupName === "__unassigned__"
      ) {
        failures.push({
          name: name,
          reason: "missing explicit base-group rule",
          baseName: baseName,
        });
        continue;
      }
      const recs = data.recipesByProduct && data.recipesByProduct[name];
      const hasRecipeRows = Array.isArray(recs) && recs.length > 0;
      if (!hasRecipeRows) continue;
      const familyRule = getRecipeFamilyRule(baseName);
      if (RECIPE_REQUIRE_EXPLICIT_FAMILY_RULES && !familyRule.hasExplicitRule) {
        failures.push({
          name: name,
          reason: "missing explicit family rule for multi-item recipe base",
          baseName: baseName,
        });
        continue;
      }
      const tier = getCraftTierInfo(name);
      const parsed = extractPrefixAndBasePattern(tier.base, baseName);
      if (familyRule.requireBaseSuffix && !parsed.matchedBase) {
        failures.push({
          name: name,
          reason: "tier-stripped name does not match supported base patterns",
          tierStrippedName: tier.base,
          baseName: baseName,
          familyRule: familyRule,
        });
        continue;
      }
      if (!familyRule.requireMaterialPrefixTokens) continue;
      if (!prefixMatchesMaterialTokens(parsed.prefix, key)) {
        failures.push({
          name: name,
          reason: "name prefix does not fully match secondary/primary tokens",
          prefix: parsed.prefix,
          secondary: key.secondaryName || "",
          primary: key.primaryName || "",
          baseName: baseName,
          familyRule: familyRule,
        });
      }
    }
    if (failures.length) {
      console.groupCollapsed("[recipe-sort] token coverage mismatches:", failures.length);
      for (let i = 0; i < failures.length; i++) console.warn("[recipe-sort] mismatch", failures[i]);
      console.groupEnd();
    } else {
      console.info("[recipe-sort] token coverage: all visible items matched.");
    }
  }

  return {
    setData: function (payload) {
      data = payload || { ItemList: [], recipesByProduct: {} };
    },
    clearCache: function () {
      cache.clear();
    },
    compareByRecipeBaseThenName: compareByRecipeBaseThenName,
    validateRecipeSortTokenCoverage: validateRecipeSortTokenCoverage,
  };
}
