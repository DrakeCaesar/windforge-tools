/**
 * Port of Data/scripts/colourdefinitions.lua
 * Game uses CreateColor(r,g,b) -> vec4 (r/255, g/255, b/255, 1). Here we keep 8-bit RGB
 * and clamp channels to 0–255 for CSS (source data sometimes exceeds 255).
 */

function clampByte(n) {
  var x = Number(n);
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(255, Math.round(x)));
}

/** Same semantics as Lua CreateColor: store sRGB bytes (clamped). */
function createColor(r, g, b) {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

/** @type {Record<string, { r: number, g: number, b: number }>} */
var COLOR_DEFINITIONS = {
  Bronze: createColor(165, 80, 30),
  Iron: createColor(125, 125, 125),
  Steel: createColor(225, 225, 225),
  Titanium: createColor(230, 300, 350),
  Adamantium: createColor(120, 60, 99),
  JadeSteel: createColor(60, 230, 170),
  VulcanSteel: createColor(210, 45, 30),
  Cloudstone: createColor(550, 500, 500),
  Moonstone: createColor(90, 60, 190),
  GreenCloth: createColor(120, 155, 70),
  BlueCloth: createColor(85, 128, 200),
  RedCloth: createColor(199, 15, 15),
  YellowCloth: createColor(250, 206, 31),
  WhiteCloth: createColor(240, 233, 215),
  BlackCloth: createColor(25, 25, 63),
  BrownCloth: createColor(127, 100, 73),
  GrayCloth: createColor(127, 127, 127),
  BlackRubber: createColor(38, 42, 44),
  Leather: createColor(81, 71, 61),
  BrownLeather: createColor(81, 71, 61),
  BlackLeather: createColor(38, 38, 38),
  GreenScale: createColor(107, 121, 11),
  RedScale: createColor(183, 15, 15),
  VioletScale: createColor(53, 11, 57),
  Wood: createColor(75, 54, 17),
  HotAirCloth: createColor(200, 180, 150),
  HydrogenCloth: createColor(180, 110, 50),
  HelliumCloth: createColor(110, 160, 200),
  Beige: createColor(255, 239, 213),
  White: createColor(255, 255, 255),
  Purple: createColor(255, 0, 255),
  Blue: createColor(0, 0, 255),
  Cyan: createColor(0, 255, 255),
  Green: createColor(0, 255, 0),
  Red: createColor(255, 0, 0),
  Yellow: createColor(255, 255, 0),

  IconWood1: createColor(244, 180, 0),
  IconWood2: createColor(86, 52, 11),
  IconDirt1: createColor(211, 180, 151),
  IconDirt2: createColor(107, 86, 0),
  IconSand1: createColor(255, 241, 184),
  IconSand2: createColor(244, 180, 0),
  IconStone1: createColor(255, 255, 255),
  IconStone2: createColor(58, 58, 58),
  IconBronze1: createColor(255, 178, 125),
  IconBronze2: createColor(188, 76, 0),
  IconIron1: createColor(216, 216, 216),
  IconIron2: createColor(2, 2, 2),
  IconSteel1: createColor(159, 216, 255),
  IconSteel2: createColor(58, 58, 58),
  IconTitanium1: createColor(159, 216, 255),
  IconTitanium2: createColor(0, 114, 178),
  IconAdamantium1: createColor(190, 131, 252),
  IconAdamantium2: createColor(82, 32, 178),
  IconJadeSteel1: createColor(149, 244, 154),
  IconJadeSteel2: createColor(0, 130, 99),
  IconVulcanSteel1: createColor(255, 153, 153),
  IconVulcanSteel2: createColor(201, 13, 13),
  IconCloudstone1: createColor(255, 255, 255),
  IconCloudstone2: createColor(153, 153, 153),
  IconMoonstone1: createColor(216, 216, 216),
  IconMoonstone2: createColor(0, 51, 112),
  IconHeartstone1: createColor(255, 0, 228),
  IconHeartstone2: createColor(255, 0, 0),
  IconLodestone1: createColor(216, 216, 216),
  IconLodestone2: createColor(69, 79, 136),
  IconDiamond1: createColor(255, 255, 255),
  IconDiamond2: createColor(222, 251, 255),
  IconFirestone1: createColor(255, 186, 0),
  IconFirestone2: createColor(222, 0, 0),
  IconChargestone1: createColor(222, 251, 255),
  IconChargestone2: createColor(69, 79, 136),
  IconSulphur1: createColor(240, 255, 0),
  IconSulphur2: createColor(169, 178, 18),
  IconBackgroundRuinBlockA1: createColor(64, 64, 64),
  IconBackgroundRuinBlockA2: createColor(200, 200, 200),
  IconBackgroundRuinBlockB1: createColor(64, 150, 64),
  IconBackgroundRuinBlockB2: createColor(200, 200, 200),
  IconBackgroundRuinBlockC1: createColor(64, 64, 150),
  IconBackgroundRuinBlockC2: createColor(200, 200, 200),
  IconRuinBlock1: createColor(64, 64, 64),
  IconRuinBlock2: createColor(200, 200, 200),
  IconHydrogen1: createColor(255, 0, 0),
  IconHydrogen2: createColor(255, 255, 255),
  IconHellium1: createColor(0, 114, 178),
  IconHellium2: createColor(255, 255, 255),
  IconSulphuricAcid1: createColor(244, 180, 0),
  IconSulphuricAcid2: createColor(255, 255, 255),
  IconBottle1: createColor(255, 255, 255),
  IconBottle2: createColor(255, 255, 255),
  IconCloth1: createColor(153, 153, 153),
  IconCloth2: createColor(255, 255, 255),
  IconPlant1: createColor(48, 255, 0),
  IconPlant2: createColor(138, 255, 0),
  IconPurple1: createColor(127, 0, 127),
  IconPurple2: createColor(255, 0, 255),
  IconBlue1: createColor(0, 0, 127),
  IconBlue2: createColor(0, 0, 255),
  IconCyan1: createColor(0, 127, 127),
  IconCyan2: createColor(0, 255, 255),
  IconGreen1: createColor(0, 127, 0),
  IconGreen2: createColor(0, 255, 0),
  IconRed1: createColor(127, 0, 0),
  IconRed2: createColor(255, 0, 0),
  IconYellow1: createColor(127, 127, 0),
  IconYellow2: createColor(255, 255, 0),
};

function lookupColorName(name) {
  if (!name || typeof name !== "string") return null;
  return COLOR_DEFINITIONS[name] || null;
}

function colorToCssRgb(c) {
  if (!c) return "transparent";
  return "rgb(" + c.r + "," + c.g + "," + c.b + ")";
}

/** Matches engine vec4 (0–1 linear-ish; same as Lua table). */
function colorToVec4(c) {
  if (!c) return [0, 0, 0, 1];
  return [c.r / 255, c.g / 255, c.b / 255, 1];
}

export const WindforgeColors = {
  createColor: createColor,
  clampByte: clampByte,
  COLOR_DEFINITIONS: COLOR_DEFINITIONS,
  lookupColorName: lookupColorName,
  colorToCssRgb: colorToCssRgb,
  colorToVec4: colorToVec4,
};
