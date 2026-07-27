var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));

// ../Commander/plugin-api/mod.ts
function definePlugin(plugin2) {
  return plugin2;
}

// src/dispatch.ts
var SAIL_TARGETS = [
  "soh",
  "2s2h",
  "both",
  "any"
];
var GAME_LABEL = {
  soh: "Ship of Harkinian",
  "2s2h": "2 Ship 2 Harkinian"
};
function intendedGames(target) {
  if (target === "soh") return [
    "soh"
  ];
  if (target === "2s2h") return [
    "2s2h"
  ];
  if (target.includes(",")) {
    const named = target.split(",").map((g) => g.trim());
    return [
      "soh",
      "2s2h"
    ].filter((g) => named.includes(g));
  }
  return [
    "soh",
    "2s2h"
  ];
}
function liveGames(target, isConnected) {
  const live = intendedGames(target).filter(isConnected);
  return target === "any" ? live.slice(0, 1) : live;
}
function describeOffline(target) {
  if (target === "both" || target === "any") return "no game is connected";
  const games = intendedGames(target);
  if (games.length === 0) return "no game is connected";
  return `${games.map((g) => GAME_LABEL[g]).join(" or ")} isn't connected`;
}
var ServerDispatch = class {
  #servers;
  /** Holds the live map, so restarting the listeners doesn't stale this out. */
  constructor(servers2) {
    this.#servers = servers2;
  }
  connected(game) {
    return this.#servers.get(game)?.connected ?? false;
  }
  send(game, body) {
    const client = this.#servers.get(game)?.clients[0];
    if (!client) return Promise.resolve("failure");
    return client.send(body);
  }
};

// src/functions.ts
var EFFECT_NAMES = [
  "SetSceneFlag",
  "UnsetSceneFlag",
  "SetFlag",
  "UnsetFlag",
  "ModifyHeartContainers",
  "FillMagic",
  "EmptyMagic",
  "ModifyRupees",
  "NoUI",
  "ModifyGravity",
  "ModifyHealth",
  "SetPlayerHealth",
  "FreezePlayer",
  "BurnPlayer",
  "ElectrocutePlayer",
  "KnockbackPlayer",
  "ModifyLinkSize",
  "InvisibleLink",
  "PacifistMode",
  "DisableZTargeting",
  "WeatherRainstorm",
  "ReverseControls",
  "ForceEquipBoots",
  "ModifyRunSpeedModifier",
  "OneHitKO",
  "ModifyDefenseModifier",
  "GiveOrTakeShield",
  "TeleportPlayer",
  "ClearAssignedButtons",
  "SetTimeOfDay",
  "SetCollisionViewer",
  "SetCosmeticsColor",
  "RandomizeCosmetics",
  "PressButton",
  "PressRandomButton",
  "AddOrTakeAmmo",
  "RandomBombFuseTimer",
  "DisableLedgeGrabs",
  "RandomWind",
  "RandomBonks",
  "PlayerInvincibility",
  "SlipperyFloor"
];
function parseParameters(raw) {
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter((part) => part.length > 0).map((part) => {
    const n = Number(part);
    return Number.isFinite(n) ? n : part;
  });
}
var ok = (out) => out ? {
  ok: true,
  out
} : {
  ok: true
};
var fail = (error) => ({
  ok: false,
  error
});
function splitCommands(raw) {
  return (raw ?? "").split(/[;\n]/).map((line) => line.trim()).filter((line) => line.length > 0);
}
var MIRROR_CVAR = {
  soh: "gEnhancements.MirroredWorld",
  "2s2h": "gModes.MirroredWorld.State"
};
function targetParam() {
  return {
    key: "target",
    label: "Game",
    type: "select",
    options: [
      ...SAIL_TARGETS
    ],
    default: "any",
    required: true
  };
}
function readTarget(raw) {
  const value = (raw ?? "").trim();
  if (SAIL_TARGETS.includes(value)) return value;
  const named = value.split(",").map((g) => g.trim()).filter(Boolean);
  const games = named.filter((g) => g === "soh" || g === "2s2h");
  if (games.length === 0 || games.length !== named.length) return "any";
  const canonical = [
    "soh",
    "2s2h"
  ];
  return canonical.filter((g) => games.includes(g)).join(",");
}
function buildSailFunctions(deps) {
  const { dispatch } = deps;
  const isConnected = (game) => dispatch.connected(game);
  return [
    {
      id: "command",
      name: "Run a console command",
      description: "Send a console command (e.g. `spawn 0x0018`). Works on both games.",
      requires: {
        account: "none"
      },
      params: [
        targetParam(),
        {
          key: "command",
          label: "Console command",
          type: "string",
          required: true
        }
      ],
      run: async (ctx) => {
        const command = (ctx.params.command ?? "").trim();
        if (!command) return fail("no command was given");
        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));
        const results = await Promise.all(games.map(async (game) => ({
          game,
          status: await dispatch.send(game, {
            type: "command",
            command
          })
        })));
        return summarize(results);
      }
    },
    {
      id: "notify",
      name: "Show a notification in-game",
      description: "Pop a message up on screen \u2014 e.g. announcing who redeemed something. Sends the game's `notify` console command. Stock SoH has no such command; it needs the patched build (SoH 9.2.3 with `notify` added), and an unpatched one accepts the line and shows nothing rather than failing.",
      requires: {
        account: "none"
      },
      params: [
        {
          // Free text rather than a dropdown: this is normally driven by an
          // earlier step (`{step1.out.games}`), and the editor's select would
          // overwrite a templated value with whichever option it displayed.
          key: "target",
          label: "Game (soh | 2s2h | both | any, or a comma list)",
          type: "string",
          default: "any"
        },
        {
          key: "message",
          label: "Message",
          type: "string",
          required: true,
          description: "Templated, so {user} and {arg.name} work: `{user} spawned a {arg.actor.label}!`"
        }
      ],
      run: async (ctx) => {
        const message = (ctx.params.message ?? "").replace(/\s+/g, " ").trim();
        if (!message) return fail("no message was given");
        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));
        const results = await Promise.all(games.map(async (game) => ({
          game,
          status: await dispatch.send(game, {
            type: "command",
            command: `notify ${message}`
          })
        })));
        return summarize(results);
      }
    },
    {
      id: "mirror",
      name: "Mirror the world",
      description: "Flip the world horizontally, right now. Each game keeps this in a differently-named CVar, so this picks the right one per game \u2014 a single `set` can't cover both.",
      requires: {
        account: "none"
      },
      params: [
        targetParam(),
        {
          key: "state",
          label: "Mirrored",
          type: "select",
          options: [
            "on",
            "off"
          ],
          default: "on"
        }
      ],
      run: async (ctx) => {
        const on = (ctx.params.state ?? "on").trim().toLowerCase() !== "off";
        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));
        const results = await Promise.all(games.map(async (game) => ({
          game,
          status: await dispatch.send(game, {
            type: "command",
            command: `set ${MIRROR_CVAR[game]} ${on ? 1 : 0}`
          })
        })));
        return summarize(results);
      }
    },
    {
      id: "multi",
      name: "Per-game command",
      description: "Run one or more console commands on each game, with optional per-game overrides. Separate multiple commands with a semicolon (;). Sends only to connected games and succeeds if at least one accepts \u2014 so one command works whether SoH, 2S2H, or both are running. Use this whenever the commands differ between the games (e.g. mirror world, which needs two CVars per game).",
      requires: {
        account: "none"
      },
      params: [
        {
          key: "command",
          label: "Commands (both games)",
          type: "string",
          description: "Console command(s) \u2014 separate several with a semicolon (;) \u2014 sent to any connected game without a per-game override below. Leave blank if every game has its own."
        },
        {
          key: "soh_command",
          label: "SoH commands (override)",
          type: "string",
          description: "Console command(s) for SoH; separate several with a semicolon (;)."
        },
        {
          key: "s2h_command",
          label: "2S2H commands (override)",
          type: "string",
          description: "Console command(s) for 2S2H; separate several with a semicolon (;)."
        }
      ],
      run: async (ctx) => {
        const base = splitCommands(ctx.params.command);
        const soh = splitCommands(ctx.params.soh_command);
        const s2h = splitCommands(ctx.params.s2h_command);
        const forGame = {
          soh: soh.length > 0 ? soh : base,
          "2s2h": s2h.length > 0 ? s2h : base
        };
        const wanted = [
          "soh",
          "2s2h"
        ].filter((g) => forGame[g].length > 0);
        if (wanted.length === 0) return fail("no command was given");
        const live = wanted.filter(isConnected);
        if (live.length === 0) {
          return fail(describeOffline(wanted.length === 1 ? wanted[0] : "both"));
        }
        const results = await Promise.all(live.map(async (game) => {
          let allOk = true;
          for (const command of forGame[game]) {
            const status = await dispatch.send(game, {
              type: "command",
              command
            });
            if (status !== "success") allOk = false;
          }
          return {
            game,
            status: allOk ? "success" : "failure"
          };
        }));
        return summarize(results);
      }
    },
    {
      id: "effect",
      name: "Apply or remove an effect",
      description: "Fire one of SoH's named effects. 2S2H stubs effects, so set a 2S2H console-command override to cover it in the same step.",
      requires: {
        account: "none"
      },
      params: [
        targetParam(),
        {
          key: "name",
          label: "Effect",
          type: "select",
          options: [
            ...EFFECT_NAMES
          ],
          required: true
        },
        {
          key: "action",
          label: "Action",
          type: "select",
          options: [
            "apply",
            "remove"
          ],
          default: "apply",
          required: true
        },
        {
          key: "parameters",
          label: "Parameters (comma-separated)",
          type: "string"
        },
        {
          key: "s2h_command",
          label: "2S2H console-command override",
          type: "string",
          description: "Sent to 2S2H instead of the effect, which 2S2H doesn't implement."
        }
      ],
      run: async (ctx) => {
        const name = (ctx.params.name ?? "").trim();
        if (!name) return fail("no effect was given");
        const action = ctx.params.action === "remove" ? "remove" : "apply";
        const override = (ctx.params.s2h_command ?? "").trim();
        const target = readTarget(ctx.params.target);
        const games = liveGames(target, isConnected);
        if (games.length === 0) return fail(describeOffline(target));
        const unsupported = games.filter((g) => g === "2s2h" && !override);
        const actionable = games.filter((g) => g !== "2s2h" || override);
        if (actionable.length === 0) {
          return fail(`effects aren't supported on ${GAME_LABEL["2s2h"]} \u2014 set a 2S2H console-command override`);
        }
        const results = await Promise.all(actionable.map(async (game) => {
          if (game === "2s2h") {
            return {
              game,
              status: await dispatch.send(game, {
                type: "command",
                command: override
              })
            };
          }
          const effect = {
            type: action,
            name
          };
          if (action === "apply") {
            const parameters = parseParameters(ctx.params.parameters);
            if (parameters.length > 0) effect.parameters = parameters;
          }
          return {
            game,
            status: await dispatch.send(game, {
              type: "effect",
              effect
            })
          };
        }));
        const summary = summarize(results);
        if (summary.ok && unsupported.length > 0) {
          return ok({
            ...summary.out ?? {},
            unsupported: unsupported.join(",")
          });
        }
        return summary;
      }
    },
    {
      id: "teleport",
      name: "Teleport to an entrance",
      description: "Teleport the player to an entrance id. 2 Ship 2 Harkinian only.",
      requires: {
        account: "none"
      },
      params: [
        {
          key: "entranceId",
          label: "Entrance id",
          type: "number",
          required: true
        }
      ],
      run: async (ctx) => {
        const entranceId = Number((ctx.params.entranceId ?? "").trim());
        if (!Number.isInteger(entranceId)) {
          return fail(`"${ctx.params.entranceId}" is not an entrance id`);
        }
        if (!dispatch.connected("2s2h")) {
          return fail(`${GAME_LABEL["2s2h"]} isn't connected`);
        }
        const status = await dispatch.send("2s2h", {
          type: "effect",
          effect: {
            type: "teleport",
            entranceId
          }
        });
        return status === "success" ? ok({
          games: "2s2h",
          entranceId
        }) : fail(`2S2H reported ${status}`);
      }
    }
  ];
}
function summarize(results) {
  const delivered = results.filter((r) => r.status === "success");
  if (delivered.length === 0) {
    const detail = results.map((r) => `${r.game}: ${r.status}`).join(", ");
    return fail(detail || "nothing was sent");
  }
  return ok({
    games: delivered.map((r) => r.game).join(","),
    delivered: delivered.length
  });
}

// src/lookups.data.ts
var BUNDLED_LOOKUPS = {
  "soh": {
    "items": {
      "0": "ITEM_STICK",
      "1": "ITEM_NUT",
      "2": "ITEM_BOMB",
      "3": "ITEM_BOW",
      "4": "ITEM_ARROW_FIRE",
      "5": "ITEM_DINS_FIRE",
      "6": "ITEM_SLINGSHOT",
      "7": "ITEM_OCARINA_FAIRY",
      "8": "ITEM_OCARINA_TIME",
      "9": "ITEM_BOMBCHU",
      "10": "ITEM_HOOKSHOT",
      "11": "ITEM_LONGSHOT",
      "12": "ITEM_ARROW_ICE",
      "13": "ITEM_FARORES_WIND",
      "14": "ITEM_BOOMERANG",
      "15": "ITEM_LENS",
      "16": "ITEM_BEAN",
      "17": "ITEM_HAMMER",
      "18": "ITEM_ARROW_LIGHT",
      "19": "ITEM_NAYRUS_LOVE",
      "20": "ITEM_BOTTLE",
      "21": "ITEM_POTION_RED",
      "22": "ITEM_POTION_GREEN",
      "23": "ITEM_POTION_BLUE",
      "24": "ITEM_FAIRY",
      "25": "ITEM_FISH",
      "26": "ITEM_MILK_BOTTLE",
      "27": "ITEM_LETTER_RUTO",
      "28": "ITEM_BLUE_FIRE",
      "29": "ITEM_BUG",
      "30": "ITEM_BIG_POE",
      "31": "ITEM_MILK_HALF",
      "32": "ITEM_POE",
      "33": "ITEM_WEIRD_EGG",
      "34": "ITEM_CHICKEN",
      "35": "ITEM_LETTER_ZELDA",
      "36": "ITEM_MASK_KEATON",
      "37": "ITEM_MASK_SKULL",
      "38": "ITEM_MASK_SPOOKY",
      "39": "ITEM_MASK_BUNNY",
      "40": "ITEM_MASK_GORON",
      "41": "ITEM_MASK_ZORA",
      "42": "ITEM_MASK_GERUDO",
      "43": "ITEM_MASK_TRUTH",
      "44": "ITEM_SOLD_OUT",
      "45": "ITEM_POCKET_EGG",
      "46": "ITEM_POCKET_CUCCO",
      "47": "ITEM_COJIRO",
      "48": "ITEM_ODD_MUSHROOM",
      "49": "ITEM_ODD_POTION",
      "50": "ITEM_SAW",
      "51": "ITEM_SWORD_BROKEN",
      "52": "ITEM_PRESCRIPTION",
      "53": "ITEM_FROG",
      "54": "ITEM_EYEDROPS",
      "55": "ITEM_CLAIM_CHECK",
      "56": "ITEM_BOW_ARROW_FIRE",
      "57": "ITEM_BOW_ARROW_ICE",
      "58": "ITEM_BOW_ARROW_LIGHT",
      "59": "ITEM_SWORD_KOKIRI",
      "60": "ITEM_SWORD_MASTER",
      "61": "ITEM_SWORD_BGS",
      "62": "ITEM_SHIELD_DEKU",
      "63": "ITEM_SHIELD_HYLIAN",
      "64": "ITEM_SHIELD_MIRROR",
      "65": "ITEM_TUNIC_KOKIRI",
      "66": "ITEM_TUNIC_GORON",
      "67": "ITEM_TUNIC_ZORA",
      "68": "ITEM_BOOTS_KOKIRI",
      "69": "ITEM_BOOTS_IRON",
      "70": "ITEM_BOOTS_HOVER",
      "71": "ITEM_BULLET_BAG_30",
      "72": "ITEM_BULLET_BAG_40",
      "73": "ITEM_BULLET_BAG_50",
      "74": "ITEM_QUIVER_30",
      "75": "ITEM_QUIVER_40",
      "76": "ITEM_QUIVER_50",
      "77": "ITEM_BOMB_BAG_20",
      "78": "ITEM_BOMB_BAG_30",
      "79": "ITEM_BOMB_BAG_40",
      "80": "ITEM_BRACELET",
      "81": "ITEM_GAUNTLETS_SILVER",
      "82": "ITEM_GAUNTLETS_GOLD",
      "83": "ITEM_SCALE_SILVER",
      "84": "ITEM_SCALE_GOLDEN",
      "85": "ITEM_SWORD_KNIFE",
      "86": "ITEM_WALLET_ADULT",
      "87": "ITEM_WALLET_GIANT",
      "88": "ITEM_SEEDS",
      "89": "ITEM_FISHING_POLE",
      "90": "ITEM_SONG_MINUET",
      "91": "ITEM_SONG_BOLERO",
      "92": "ITEM_SONG_SERENADE",
      "93": "ITEM_SONG_REQUIEM",
      "94": "ITEM_SONG_NOCTURNE",
      "95": "ITEM_SONG_PRELUDE",
      "96": "ITEM_SONG_LULLABY",
      "97": "ITEM_SONG_EPONA",
      "98": "ITEM_SONG_SARIA",
      "99": "ITEM_SONG_SUN",
      "100": "ITEM_SONG_TIME",
      "101": "ITEM_SONG_STORMS",
      "102": "ITEM_MEDALLION_FOREST",
      "103": "ITEM_MEDALLION_FIRE",
      "104": "ITEM_MEDALLION_WATER",
      "105": "ITEM_MEDALLION_SPIRIT",
      "106": "ITEM_MEDALLION_SHADOW",
      "107": "ITEM_MEDALLION_LIGHT",
      "108": "ITEM_KOKIRI_EMERALD",
      "109": "ITEM_GORON_RUBY",
      "110": "ITEM_ZORA_SAPPHIRE",
      "111": "ITEM_STONE_OF_AGONY",
      "112": "ITEM_GERUDO_CARD",
      "113": "ITEM_SKULL_TOKEN",
      "114": "ITEM_HEART_CONTAINER",
      "115": "ITEM_HEART_PIECE",
      "116": "ITEM_KEY_BOSS",
      "117": "ITEM_COMPASS",
      "118": "ITEM_DUNGEON_MAP",
      "119": "ITEM_KEY_SMALL",
      "120": "ITEM_MAGIC_SMALL",
      "121": "ITEM_MAGIC_LARGE",
      "122": "ITEM_HEART_PIECE_2",
      "123": "ITEM_SINGLE_MAGIC",
      "124": "ITEM_DOUBLE_MAGIC",
      "125": "ITEM_DOUBLE_DEFENSE",
      "126": "ITEM_INVALID_4",
      "127": "ITEM_INVALID_5",
      "128": "ITEM_INVALID_6",
      "129": "ITEM_INVALID_7",
      "130": "ITEM_MILK",
      "131": "ITEM_HEART",
      "132": "ITEM_RUPEE_GREEN",
      "133": "ITEM_RUPEE_BLUE",
      "134": "ITEM_RUPEE_RED",
      "135": "ITEM_RUPEE_PURPLE",
      "136": "ITEM_RUPEE_GOLD",
      "137": "ITEM_INVALID_8",
      "138": "ITEM_STICKS_5",
      "139": "ITEM_STICKS_10",
      "140": "ITEM_NUTS_5",
      "141": "ITEM_NUTS_10",
      "142": "ITEM_BOMBS_5",
      "143": "ITEM_BOMBS_10",
      "144": "ITEM_BOMBS_20",
      "145": "ITEM_BOMBS_30",
      "146": "ITEM_ARROWS_SMALL",
      "147": "ITEM_ARROWS_MEDIUM",
      "148": "ITEM_ARROWS_LARGE",
      "149": "ITEM_SEEDS_30",
      "150": "ITEM_BOMBCHUS_5",
      "151": "ITEM_BOMBCHUS_20",
      "152": "ITEM_STICK_UPGRADE_20",
      "153": "ITEM_STICK_UPGRADE_30",
      "154": "ITEM_NUT_UPGRADE_30",
      "155": "ITEM_NUT_UPGRADE_40",
      "252": "ITEM_LAST_USED",
      "254": "ITEM_NONE_FE",
      "255": "ITEM_NONE"
    },
    "scenes": {
      "0": "SCENE_DEKU_TREE",
      "1": "SCENE_DODONGOS_CAVERN",
      "2": "SCENE_JABU_JABU",
      "3": "SCENE_FOREST_TEMPLE",
      "4": "SCENE_FIRE_TEMPLE",
      "5": "SCENE_WATER_TEMPLE",
      "6": "SCENE_SPIRIT_TEMPLE",
      "7": "SCENE_SHADOW_TEMPLE",
      "8": "SCENE_BOTTOM_OF_THE_WELL",
      "9": "SCENE_ICE_CAVERN",
      "10": "SCENE_GANONS_TOWER",
      "11": "SCENE_GERUDO_TRAINING_GROUND",
      "12": "SCENE_THIEVES_HIDEOUT",
      "13": "SCENE_INSIDE_GANONS_CASTLE",
      "14": "SCENE_GANONS_TOWER_COLLAPSE_INTERIOR",
      "15": "SCENE_INSIDE_GANONS_CASTLE_COLLAPSE",
      "16": "SCENE_TREASURE_BOX_SHOP",
      "17": "SCENE_DEKU_TREE_BOSS",
      "18": "SCENE_DODONGOS_CAVERN_BOSS",
      "19": "SCENE_JABU_JABU_BOSS",
      "20": "SCENE_FOREST_TEMPLE_BOSS",
      "21": "SCENE_FIRE_TEMPLE_BOSS",
      "22": "SCENE_WATER_TEMPLE_BOSS",
      "23": "SCENE_SPIRIT_TEMPLE_BOSS",
      "24": "SCENE_SHADOW_TEMPLE_BOSS",
      "25": "SCENE_GANONDORF_BOSS",
      "26": "SCENE_GANONS_TOWER_COLLAPSE_EXTERIOR",
      "27": "SCENE_MARKET_ENTRANCE_DAY",
      "28": "SCENE_MARKET_ENTRANCE_NIGHT",
      "29": "SCENE_MARKET_ENTRANCE_RUINS",
      "30": "SCENE_BACK_ALLEY_DAY",
      "31": "SCENE_BACK_ALLEY_NIGHT",
      "32": "SCENE_MARKET_DAY",
      "33": "SCENE_MARKET_NIGHT",
      "34": "SCENE_MARKET_RUINS",
      "35": "SCENE_TEMPLE_OF_TIME_EXTERIOR_DAY",
      "36": "SCENE_TEMPLE_OF_TIME_EXTERIOR_NIGHT",
      "37": "SCENE_TEMPLE_OF_TIME_EXTERIOR_RUINS",
      "38": "SCENE_KNOW_IT_ALL_BROS_HOUSE",
      "39": "SCENE_TWINS_HOUSE",
      "40": "SCENE_MIDOS_HOUSE",
      "41": "SCENE_SARIAS_HOUSE",
      "42": "SCENE_KAKARIKO_CENTER_GUEST_HOUSE",
      "43": "SCENE_BACK_ALLEY_HOUSE",
      "44": "SCENE_BAZAAR",
      "45": "SCENE_KOKIRI_SHOP",
      "46": "SCENE_GORON_SHOP",
      "47": "SCENE_ZORA_SHOP",
      "48": "SCENE_POTION_SHOP_KAKARIKO",
      "49": "SCENE_POTION_SHOP_MARKET",
      "50": "SCENE_BOMBCHU_SHOP",
      "51": "SCENE_HAPPY_MASK_SHOP",
      "52": "SCENE_LINKS_HOUSE",
      "53": "SCENE_DOG_LADY_HOUSE",
      "54": "SCENE_STABLE",
      "55": "SCENE_IMPAS_HOUSE",
      "56": "SCENE_LAKESIDE_LABORATORY",
      "57": "SCENE_CARPENTERS_TENT",
      "58": "SCENE_GRAVEKEEPERS_HUT",
      "59": "SCENE_GREAT_FAIRYS_FOUNTAIN_MAGIC",
      "60": "SCENE_FAIRYS_FOUNTAIN",
      "61": "SCENE_GREAT_FAIRYS_FOUNTAIN_SPELLS",
      "62": "SCENE_GROTTOS",
      "63": "SCENE_REDEAD_GRAVE",
      "64": "SCENE_GRAVE_WITH_FAIRYS_FOUNTAIN",
      "65": "SCENE_ROYAL_FAMILYS_TOMB",
      "66": "SCENE_SHOOTING_GALLERY",
      "67": "SCENE_TEMPLE_OF_TIME",
      "68": "SCENE_CHAMBER_OF_THE_SAGES",
      "69": "SCENE_CASTLE_COURTYARD_GUARDS_DAY",
      "70": "SCENE_CASTLE_COURTYARD_GUARDS_NIGHT",
      "71": "SCENE_CUTSCENE_MAP",
      "72": "SCENE_WINDMILL_AND_DAMPES_GRAVE",
      "73": "SCENE_FISHING_POND",
      "74": "SCENE_CASTLE_COURTYARD_ZELDA",
      "75": "SCENE_BOMBCHU_BOWLING_ALLEY",
      "76": "SCENE_LON_LON_BUILDINGS",
      "77": "SCENE_MARKET_GUARD_HOUSE",
      "78": "SCENE_POTION_SHOP_GRANNY",
      "79": "SCENE_GANON_BOSS",
      "80": "SCENE_HOUSE_OF_SKULLTULA",
      "81": "SCENE_HYRULE_FIELD",
      "82": "SCENE_KAKARIKO_VILLAGE",
      "83": "SCENE_GRAVEYARD",
      "84": "SCENE_ZORAS_RIVER",
      "85": "SCENE_KOKIRI_FOREST",
      "86": "SCENE_SACRED_FOREST_MEADOW",
      "87": "SCENE_LAKE_HYLIA",
      "88": "SCENE_ZORAS_DOMAIN",
      "89": "SCENE_ZORAS_FOUNTAIN",
      "90": "SCENE_GERUDO_VALLEY",
      "91": "SCENE_LOST_WOODS",
      "92": "SCENE_DESERT_COLOSSUS",
      "93": "SCENE_GERUDOS_FORTRESS",
      "94": "SCENE_HAUNTED_WASTELAND",
      "95": "SCENE_HYRULE_CASTLE",
      "96": "SCENE_DEATH_MOUNTAIN_TRAIL",
      "97": "SCENE_DEATH_MOUNTAIN_CRATER",
      "98": "SCENE_GORON_CITY",
      "99": "SCENE_LON_LON_RANCH",
      "100": "SCENE_OUTSIDE_GANONS_CASTLE",
      "101": "SCENE_TEST01",
      "102": "SCENE_BESITU",
      "103": "SCENE_DEPTH_TEST",
      "104": "SCENE_SYOTES",
      "105": "SCENE_SYOTES2",
      "106": "SCENE_SUTARU",
      "107": "SCENE_HAIRAL_NIWA2",
      "108": "SCENE_SASATEST",
      "109": "SCENE_TESTROOM"
    },
    "actors": {
      "0": "ACTOR_PLAYER",
      "2": "ACTOR_EN_TEST",
      "4": "ACTOR_EN_GIRLA",
      "7": "ACTOR_EN_PART",
      "8": "ACTOR_EN_LIGHT",
      "9": "ACTOR_EN_DOOR",
      "10": "ACTOR_EN_BOX",
      "11": "ACTOR_BG_DY_YOSEIZO",
      "12": "ACTOR_BG_HIDAN_FIREWALL",
      "13": "ACTOR_EN_POH",
      "14": "ACTOR_EN_OKUTA",
      "15": "ACTOR_BG_YDAN_SP",
      "16": "ACTOR_EN_BOM",
      "17": "ACTOR_EN_WALLMAS",
      "18": "ACTOR_EN_DODONGO",
      "19": "ACTOR_EN_FIREFLY",
      "20": "ACTOR_EN_HORSE",
      "21": "ACTOR_EN_ITEM00",
      "22": "ACTOR_EN_ARROW",
      "24": "ACTOR_EN_ELF",
      "25": "ACTOR_EN_NIW",
      "27": "ACTOR_EN_TITE",
      "28": "ACTOR_EN_REEBA",
      "29": "ACTOR_EN_PEEHAT",
      "30": "ACTOR_EN_BUTTE",
      "32": "ACTOR_EN_INSECT",
      "33": "ACTOR_EN_FISH",
      "35": "ACTOR_EN_HOLL",
      "36": "ACTOR_EN_SCENE_CHANGE",
      "37": "ACTOR_EN_ZF",
      "38": "ACTOR_EN_HATA",
      "39": "ACTOR_BOSS_DODONGO",
      "40": "ACTOR_BOSS_GOMA",
      "41": "ACTOR_EN_ZL1",
      "42": "ACTOR_EN_VIEWER",
      "43": "ACTOR_EN_GOMA",
      "44": "ACTOR_BG_PUSHBOX",
      "45": "ACTOR_EN_BUBBLE",
      "46": "ACTOR_DOOR_SHUTTER",
      "47": "ACTOR_EN_DODOJR",
      "48": "ACTOR_EN_BDFIRE",
      "50": "ACTOR_EN_BOOM",
      "51": "ACTOR_EN_TORCH2",
      "52": "ACTOR_EN_BILI",
      "53": "ACTOR_EN_TP",
      "55": "ACTOR_EN_ST",
      "56": "ACTOR_EN_BW",
      "57": "ACTOR_EN_A_OBJ",
      "58": "ACTOR_EN_EIYER",
      "59": "ACTOR_EN_RIVER_SOUND",
      "60": "ACTOR_EN_HORSE_NORMAL",
      "61": "ACTOR_EN_OSSAN",
      "62": "ACTOR_BG_TREEMOUTH",
      "63": "ACTOR_BG_DODOAGO",
      "64": "ACTOR_BG_HIDAN_DALM",
      "65": "ACTOR_BG_HIDAN_HROCK",
      "66": "ACTOR_EN_HORSE_GANON",
      "67": "ACTOR_BG_HIDAN_ROCK",
      "68": "ACTOR_BG_HIDAN_RSEKIZOU",
      "69": "ACTOR_BG_HIDAN_SEKIZOU",
      "70": "ACTOR_BG_HIDAN_SIMA",
      "71": "ACTOR_BG_HIDAN_SYOKU",
      "72": "ACTOR_EN_XC",
      "73": "ACTOR_BG_HIDAN_CURTAIN",
      "74": "ACTOR_BG_SPOT00_HANEBASI",
      "75": "ACTOR_EN_MB",
      "76": "ACTOR_EN_BOMBF",
      "77": "ACTOR_EN_ZL2",
      "78": "ACTOR_BG_HIDAN_FSLIFT",
      "79": "ACTOR_EN_OE2",
      "80": "ACTOR_BG_YDAN_HASI",
      "81": "ACTOR_BG_YDAN_MARUTA",
      "82": "ACTOR_BOSS_GANONDROF",
      "84": "ACTOR_EN_AM",
      "85": "ACTOR_EN_DEKUBABA",
      "86": "ACTOR_EN_M_FIRE1",
      "87": "ACTOR_EN_M_THUNDER",
      "88": "ACTOR_BG_DDAN_JD",
      "89": "ACTOR_BG_BREAKWALL",
      "90": "ACTOR_EN_JJ",
      "91": "ACTOR_EN_HORSE_ZELDA",
      "92": "ACTOR_BG_DDAN_KD",
      "93": "ACTOR_DOOR_WARP1",
      "94": "ACTOR_OBJ_SYOKUDAI",
      "95": "ACTOR_ITEM_B_HEART",
      "96": "ACTOR_EN_DEKUNUTS",
      "97": "ACTOR_BG_MENKURI_KAITEN",
      "98": "ACTOR_BG_MENKURI_EYE",
      "99": "ACTOR_EN_VALI",
      "100": "ACTOR_BG_MIZU_MOVEBG",
      "101": "ACTOR_BG_MIZU_WATER",
      "102": "ACTOR_ARMS_HOOK",
      "103": "ACTOR_EN_FHG",
      "104": "ACTOR_BG_MORI_HINERI",
      "105": "ACTOR_EN_BB",
      "106": "ACTOR_BG_TOKI_HIKARI",
      "107": "ACTOR_EN_YUKABYUN",
      "108": "ACTOR_BG_TOKI_SWD",
      "109": "ACTOR_EN_FHG_FIRE",
      "110": "ACTOR_BG_MJIN",
      "111": "ACTOR_BG_HIDAN_KOUSI",
      "112": "ACTOR_DOOR_TOKI",
      "113": "ACTOR_BG_HIDAN_HAMSTEP",
      "114": "ACTOR_EN_BIRD",
      "119": "ACTOR_EN_WOOD02",
      "124": "ACTOR_EN_LIGHTBOX",
      "125": "ACTOR_EN_PU_BOX",
      "128": "ACTOR_EN_TRAP",
      "129": "ACTOR_EN_AROW_TRAP",
      "130": "ACTOR_EN_VASE",
      "132": "ACTOR_EN_TA",
      "133": "ACTOR_EN_TK",
      "134": "ACTOR_BG_MORI_BIGST",
      "135": "ACTOR_BG_MORI_ELEVATOR",
      "136": "ACTOR_BG_MORI_KAITENKABE",
      "137": "ACTOR_BG_MORI_RAKKATENJO",
      "138": "ACTOR_EN_VM",
      "139": "ACTOR_DEMO_EFFECT",
      "140": "ACTOR_DEMO_KANKYO",
      "141": "ACTOR_BG_HIDAN_FWBIG",
      "142": "ACTOR_EN_FLOORMAS",
      "143": "ACTOR_EN_HEISHI1",
      "144": "ACTOR_EN_RD",
      "145": "ACTOR_EN_PO_SISTERS",
      "146": "ACTOR_BG_HEAVY_BLOCK",
      "147": "ACTOR_BG_PO_EVENT",
      "148": "ACTOR_OBJ_MURE",
      "149": "ACTOR_EN_SW",
      "150": "ACTOR_BOSS_FD",
      "151": "ACTOR_OBJECT_KANKYO",
      "152": "ACTOR_EN_DU",
      "153": "ACTOR_EN_FD",
      "154": "ACTOR_EN_HORSE_LINK_CHILD",
      "155": "ACTOR_DOOR_ANA",
      "156": "ACTOR_BG_SPOT02_OBJECTS",
      "157": "ACTOR_BG_HAKA",
      "158": "ACTOR_MAGIC_WIND",
      "159": "ACTOR_MAGIC_FIRE",
      "161": "ACTOR_EN_RU1",
      "162": "ACTOR_BOSS_FD2",
      "163": "ACTOR_EN_FD_FIRE",
      "164": "ACTOR_EN_DH",
      "165": "ACTOR_EN_DHA",
      "166": "ACTOR_EN_RL",
      "167": "ACTOR_EN_ENCOUNT1",
      "168": "ACTOR_DEMO_DU",
      "169": "ACTOR_DEMO_IM",
      "170": "ACTOR_DEMO_TRE_LGT",
      "171": "ACTOR_EN_FW",
      "172": "ACTOR_BG_VB_SIMA",
      "173": "ACTOR_EN_VB_BALL",
      "174": "ACTOR_BG_HAKA_MEGANE",
      "175": "ACTOR_BG_HAKA_MEGANEBG",
      "176": "ACTOR_BG_HAKA_SHIP",
      "177": "ACTOR_BG_HAKA_SGAMI",
      "179": "ACTOR_EN_HEISHI2",
      "180": "ACTOR_EN_ENCOUNT2",
      "181": "ACTOR_EN_FIRE_ROCK",
      "182": "ACTOR_EN_BROB",
      "183": "ACTOR_MIR_RAY",
      "184": "ACTOR_BG_SPOT09_OBJ",
      "185": "ACTOR_BG_SPOT18_OBJ",
      "186": "ACTOR_BOSS_VA",
      "187": "ACTOR_BG_HAKA_TUBO",
      "188": "ACTOR_BG_HAKA_TRAP",
      "189": "ACTOR_BG_HAKA_HUTA",
      "190": "ACTOR_BG_HAKA_ZOU",
      "191": "ACTOR_BG_SPOT17_FUNEN",
      "192": "ACTOR_EN_SYATEKI_ITM",
      "193": "ACTOR_EN_SYATEKI_MAN",
      "194": "ACTOR_EN_TANA",
      "195": "ACTOR_EN_NB",
      "196": "ACTOR_BOSS_MO",
      "197": "ACTOR_EN_SB",
      "198": "ACTOR_EN_BIGOKUTA",
      "199": "ACTOR_EN_KAREBABA",
      "200": "ACTOR_BG_BDAN_OBJECTS",
      "201": "ACTOR_DEMO_SA",
      "202": "ACTOR_DEMO_GO",
      "203": "ACTOR_EN_IN",
      "204": "ACTOR_EN_TR",
      "205": "ACTOR_BG_SPOT16_BOMBSTONE",
      "207": "ACTOR_BG_HIDAN_KOWARERUKABE",
      "208": "ACTOR_BG_BOMBWALL",
      "209": "ACTOR_BG_SPOT08_ICEBLOCK",
      "210": "ACTOR_EN_RU2",
      "211": "ACTOR_OBJ_DEKUJR",
      "212": "ACTOR_BG_MIZU_UZU",
      "213": "ACTOR_BG_SPOT06_OBJECTS",
      "214": "ACTOR_BG_ICE_OBJECTS",
      "215": "ACTOR_BG_HAKA_WATER",
      "217": "ACTOR_EN_MA2",
      "218": "ACTOR_EN_BOM_CHU",
      "219": "ACTOR_EN_HORSE_GAME_CHECK",
      "220": "ACTOR_BOSS_TW",
      "221": "ACTOR_EN_RR",
      "222": "ACTOR_EN_BA",
      "223": "ACTOR_EN_BX",
      "224": "ACTOR_EN_ANUBICE",
      "225": "ACTOR_EN_ANUBICE_FIRE",
      "226": "ACTOR_BG_MORI_HASHIGO",
      "227": "ACTOR_BG_MORI_HASHIRA4",
      "228": "ACTOR_BG_MORI_IDOMIZU",
      "229": "ACTOR_BG_SPOT16_DOUGHNUT",
      "230": "ACTOR_BG_BDAN_SWITCH",
      "231": "ACTOR_EN_MA1",
      "232": "ACTOR_BOSS_GANON",
      "233": "ACTOR_BOSS_SST",
      "236": "ACTOR_EN_NY",
      "237": "ACTOR_EN_FR",
      "238": "ACTOR_ITEM_SHIELD",
      "239": "ACTOR_BG_ICE_SHELTER",
      "240": "ACTOR_EN_ICE_HONO",
      "241": "ACTOR_ITEM_OCARINA",
      "244": "ACTOR_MAGIC_DARK",
      "245": "ACTOR_DEMO_6K",
      "246": "ACTOR_EN_ANUBICE_TAG",
      "247": "ACTOR_BG_HAKA_GATE",
      "248": "ACTOR_BG_SPOT15_SAKU",
      "249": "ACTOR_BG_JYA_GOROIWA",
      "250": "ACTOR_BG_JYA_ZURERUKABE",
      "252": "ACTOR_BG_JYA_COBRA",
      "253": "ACTOR_BG_JYA_KANAAMI",
      "254": "ACTOR_FISHING",
      "255": "ACTOR_OBJ_OSHIHIKI",
      "256": "ACTOR_BG_GATE_SHUTTER",
      "257": "ACTOR_EFF_DUST",
      "258": "ACTOR_BG_SPOT01_FUSYA",
      "259": "ACTOR_BG_SPOT01_IDOHASHIRA",
      "260": "ACTOR_BG_SPOT01_IDOMIZU",
      "261": "ACTOR_BG_PO_SYOKUDAI",
      "262": "ACTOR_BG_GANON_OTYUKA",
      "263": "ACTOR_BG_SPOT15_RRBOX",
      "264": "ACTOR_BG_UMAJUMP",
      "266": "ACTOR_ARROW_FIRE",
      "267": "ACTOR_ARROW_ICE",
      "268": "ACTOR_ARROW_LIGHT",
      "271": "ACTOR_ITEM_ETCETERA",
      "272": "ACTOR_OBJ_KIBAKO",
      "273": "ACTOR_OBJ_TSUBO",
      "274": "ACTOR_EN_WONDER_ITEM",
      "275": "ACTOR_EN_IK",
      "276": "ACTOR_DEMO_IK",
      "277": "ACTOR_EN_SKJ",
      "278": "ACTOR_EN_SKJNEEDLE",
      "279": "ACTOR_EN_G_SWITCH",
      "280": "ACTOR_DEMO_EXT",
      "281": "ACTOR_DEMO_SHD",
      "282": "ACTOR_EN_DNS",
      "283": "ACTOR_ELF_MSG",
      "284": "ACTOR_EN_HONOTRAP",
      "285": "ACTOR_EN_TUBO_TRAP",
      "286": "ACTOR_OBJ_ICE_POLY",
      "287": "ACTOR_BG_SPOT03_TAKI",
      "288": "ACTOR_BG_SPOT07_TAKI",
      "289": "ACTOR_EN_FZ",
      "290": "ACTOR_EN_PO_RELAY",
      "291": "ACTOR_BG_RELAY_OBJECTS",
      "292": "ACTOR_EN_DIVING_GAME",
      "293": "ACTOR_EN_KUSA",
      "294": "ACTOR_OBJ_BEAN",
      "295": "ACTOR_OBJ_BOMBIWA",
      "298": "ACTOR_OBJ_SWITCH",
      "299": "ACTOR_OBJ_ELEVATOR",
      "300": "ACTOR_OBJ_LIFT",
      "301": "ACTOR_OBJ_HSBLOCK",
      "302": "ACTOR_EN_OKARINA_TAG",
      "303": "ACTOR_EN_YABUSAME_MARK",
      "304": "ACTOR_EN_GOROIWA",
      "305": "ACTOR_EN_EX_RUPPY",
      "306": "ACTOR_EN_TORYO",
      "307": "ACTOR_EN_DAIKU",
      "309": "ACTOR_EN_NWC",
      "310": "ACTOR_EN_BLKOBJ",
      "311": "ACTOR_ITEM_INBOX",
      "312": "ACTOR_EN_GE1",
      "313": "ACTOR_OBJ_BLOCKSTOP",
      "314": "ACTOR_EN_SDA",
      "315": "ACTOR_EN_CLEAR_TAG",
      "316": "ACTOR_EN_NIW_LADY",
      "317": "ACTOR_EN_GM",
      "318": "ACTOR_EN_MS",
      "319": "ACTOR_EN_HS",
      "320": "ACTOR_BG_INGATE",
      "321": "ACTOR_EN_KANBAN",
      "322": "ACTOR_EN_HEISHI3",
      "323": "ACTOR_EN_SYATEKI_NIW",
      "324": "ACTOR_EN_ATTACK_NIW",
      "325": "ACTOR_BG_SPOT01_IDOSOKO",
      "326": "ACTOR_EN_SA",
      "327": "ACTOR_EN_WONDER_TALK",
      "328": "ACTOR_BG_GJYO_BRIDGE",
      "329": "ACTOR_EN_DS",
      "330": "ACTOR_EN_MK",
      "331": "ACTOR_EN_BOM_BOWL_MAN",
      "332": "ACTOR_EN_BOM_BOWL_PIT",
      "333": "ACTOR_EN_OWL",
      "334": "ACTOR_EN_ISHI",
      "335": "ACTOR_OBJ_HANA",
      "336": "ACTOR_OBJ_LIGHTSWITCH",
      "337": "ACTOR_OBJ_MURE2",
      "338": "ACTOR_EN_GO",
      "339": "ACTOR_EN_FU",
      "341": "ACTOR_EN_CHANGER",
      "342": "ACTOR_BG_JYA_MEGAMI",
      "343": "ACTOR_BG_JYA_LIFT",
      "344": "ACTOR_BG_JYA_BIGMIRROR",
      "345": "ACTOR_BG_JYA_BOMBCHUIWA",
      "346": "ACTOR_BG_JYA_AMISHUTTER",
      "347": "ACTOR_BG_JYA_BOMBIWA",
      "348": "ACTOR_BG_SPOT18_BASKET",
      "350": "ACTOR_EN_GANON_ORGAN",
      "351": "ACTOR_EN_SIOFUKI",
      "352": "ACTOR_EN_STREAM",
      "354": "ACTOR_EN_MM",
      "355": "ACTOR_EN_KO",
      "356": "ACTOR_EN_KZ",
      "357": "ACTOR_EN_WEATHER_TAG",
      "358": "ACTOR_BG_SST_FLOOR",
      "359": "ACTOR_EN_ANI",
      "360": "ACTOR_EN_EX_ITEM",
      "361": "ACTOR_BG_JYA_IRONOBJ",
      "362": "ACTOR_EN_JS",
      "363": "ACTOR_EN_JSJUTAN",
      "364": "ACTOR_EN_CS",
      "365": "ACTOR_EN_MD",
      "366": "ACTOR_EN_HY",
      "367": "ACTOR_EN_GANON_MANT",
      "368": "ACTOR_EN_OKARINA_EFFECT",
      "369": "ACTOR_EN_MAG",
      "370": "ACTOR_DOOR_GERUDO",
      "371": "ACTOR_ELF_MSG2",
      "372": "ACTOR_DEMO_GT",
      "373": "ACTOR_EN_PO_FIELD",
      "374": "ACTOR_EFC_ERUPC",
      "375": "ACTOR_BG_ZG",
      "376": "ACTOR_EN_HEISHI4",
      "377": "ACTOR_EN_ZL3",
      "378": "ACTOR_BOSS_GANON2",
      "379": "ACTOR_EN_KAKASI",
      "380": "ACTOR_EN_TAKARA_MAN",
      "381": "ACTOR_OBJ_MAKEOSHIHIKI",
      "382": "ACTOR_OCEFF_SPOT",
      "383": "ACTOR_END_TITLE",
      "385": "ACTOR_EN_TORCH",
      "386": "ACTOR_DEMO_EC",
      "387": "ACTOR_SHOT_SUN",
      "388": "ACTOR_EN_DY_EXTRA",
      "389": "ACTOR_EN_WONDER_TALK2",
      "390": "ACTOR_EN_GE2",
      "391": "ACTOR_OBJ_ROOMTIMER",
      "392": "ACTOR_EN_SSH",
      "393": "ACTOR_EN_STH",
      "394": "ACTOR_OCEFF_WIPE",
      "395": "ACTOR_OCEFF_STORM",
      "396": "ACTOR_EN_WEIYER",
      "397": "ACTOR_BG_SPOT05_SOKO",
      "398": "ACTOR_BG_JYA_1FLIFT",
      "399": "ACTOR_BG_JYA_HAHENIRON",
      "400": "ACTOR_BG_SPOT12_GATE",
      "401": "ACTOR_BG_SPOT12_SAKU",
      "402": "ACTOR_EN_HINTNUTS",
      "403": "ACTOR_EN_NUTSBALL",
      "404": "ACTOR_BG_SPOT00_BREAK",
      "405": "ACTOR_EN_SHOPNUTS",
      "406": "ACTOR_EN_IT",
      "407": "ACTOR_EN_GELDB",
      "408": "ACTOR_OCEFF_WIPE2",
      "409": "ACTOR_OCEFF_WIPE3",
      "410": "ACTOR_EN_NIW_GIRL",
      "411": "ACTOR_EN_DOG",
      "412": "ACTOR_EN_SI",
      "413": "ACTOR_BG_SPOT01_OBJECTS2",
      "414": "ACTOR_OBJ_COMB",
      "415": "ACTOR_BG_SPOT11_BAKUDANKABE",
      "416": "ACTOR_OBJ_KIBAKO2",
      "417": "ACTOR_EN_DNT_DEMO",
      "418": "ACTOR_EN_DNT_JIJI",
      "419": "ACTOR_EN_DNT_NOMAL",
      "420": "ACTOR_EN_GUEST",
      "421": "ACTOR_BG_BOM_GUARD",
      "422": "ACTOR_EN_HS2",
      "423": "ACTOR_DEMO_KEKKAI",
      "424": "ACTOR_BG_SPOT08_BAKUDANKABE",
      "425": "ACTOR_BG_SPOT17_BAKUDANKABE",
      "427": "ACTOR_OBJ_MURE3",
      "428": "ACTOR_EN_TG",
      "429": "ACTOR_EN_MU",
      "430": "ACTOR_EN_GO2",
      "431": "ACTOR_EN_WF",
      "432": "ACTOR_EN_SKB",
      "433": "ACTOR_DEMO_GJ",
      "434": "ACTOR_DEMO_GEFF",
      "435": "ACTOR_BG_GND_FIREMEIRO",
      "436": "ACTOR_BG_GND_DARKMEIRO",
      "437": "ACTOR_BG_GND_SOULMEIRO",
      "438": "ACTOR_BG_GND_NISEKABE",
      "439": "ACTOR_BG_GND_ICEBLOCK",
      "440": "ACTOR_EN_GB",
      "441": "ACTOR_EN_GS",
      "442": "ACTOR_BG_MIZU_BWALL",
      "443": "ACTOR_BG_MIZU_SHUTTER",
      "444": "ACTOR_EN_DAIKU_KAKARIKO",
      "445": "ACTOR_BG_BOWL_WALL",
      "446": "ACTOR_EN_WALL_TUBO",
      "447": "ACTOR_EN_PO_DESERT",
      "448": "ACTOR_EN_CROW",
      "449": "ACTOR_DOOR_KILLER",
      "450": "ACTOR_BG_SPOT11_OASIS",
      "451": "ACTOR_BG_SPOT18_FUTA",
      "452": "ACTOR_BG_SPOT18_SHUTTER",
      "453": "ACTOR_EN_MA3",
      "454": "ACTOR_EN_COW",
      "455": "ACTOR_BG_ICE_TURARA",
      "456": "ACTOR_BG_ICE_SHUTTER",
      "457": "ACTOR_EN_KAKASI2",
      "458": "ACTOR_EN_KAKASI3",
      "459": "ACTOR_OCEFF_WIPE4",
      "460": "ACTOR_EN_EG",
      "461": "ACTOR_BG_MENKURI_NISEKABE",
      "462": "ACTOR_EN_ZO",
      "463": "ACTOR_OBJ_MAKEKINSUTA",
      "464": "ACTOR_EN_GE3",
      "465": "ACTOR_OBJ_TIMEBLOCK",
      "466": "ACTOR_OBJ_HAMISHI",
      "467": "ACTOR_EN_ZL4",
      "468": "ACTOR_EN_MM2",
      "469": "ACTOR_BG_JYA_BLOCK",
      "470": "ACTOR_OBJ_WARP2BLOCK"
    }
  },
  "2s2h": {
    "items": {
      "0": "ITEM_OCARINA_OF_TIME",
      "1": "ITEM_BOW",
      "2": "ITEM_ARROW_FIRE",
      "3": "ITEM_ARROW_ICE",
      "4": "ITEM_ARROW_LIGHT",
      "5": "ITEM_OCARINA_FAIRY",
      "6": "ITEM_BOMB",
      "7": "ITEM_BOMBCHU",
      "8": "ITEM_DEKU_STICK",
      "9": "ITEM_DEKU_NUT",
      "10": "ITEM_MAGIC_BEANS",
      "11": "ITEM_SLINGSHOT",
      "12": "ITEM_POWDER_KEG",
      "13": "ITEM_PICTOGRAPH_BOX",
      "14": "ITEM_LENS_OF_TRUTH",
      "15": "ITEM_HOOKSHOT",
      "16": "ITEM_SWORD_GREAT_FAIRY",
      "18": "ITEM_BOTTLE",
      "19": "ITEM_POTION_RED",
      "20": "ITEM_POTION_GREEN",
      "21": "ITEM_POTION_BLUE",
      "22": "ITEM_FAIRY",
      "23": "ITEM_DEKU_PRINCESS",
      "24": "ITEM_MILK_BOTTLE",
      "25": "ITEM_MILK_HALF",
      "26": "ITEM_FISH",
      "27": "ITEM_BUG",
      "28": "ITEM_BLUE_FIRE",
      "29": "ITEM_POE",
      "30": "ITEM_BIG_POE",
      "31": "ITEM_SPRING_WATER",
      "32": "ITEM_HOT_SPRING_WATER",
      "33": "ITEM_ZORA_EGG",
      "34": "ITEM_GOLD_DUST",
      "35": "ITEM_MUSHROOM",
      "36": "ITEM_SEAHORSE",
      "37": "ITEM_CHATEAU",
      "38": "ITEM_HYLIAN_LOACH",
      "39": "ITEM_OBABA_DRINK",
      "40": "ITEM_MOONS_TEAR",
      "41": "ITEM_DEED_LAND",
      "42": "ITEM_DEED_SWAMP",
      "43": "ITEM_DEED_MOUNTAIN",
      "44": "ITEM_DEED_OCEAN",
      "45": "ITEM_ROOM_KEY",
      "46": "ITEM_LETTER_MAMA",
      "47": "ITEM_LETTER_TO_KAFEI",
      "48": "ITEM_PENDANT_OF_MEMORIES",
      "49": "ITEM_TINGLE_MAP",
      "50": "ITEM_MASK_DEKU",
      "51": "ITEM_MASK_GORON",
      "52": "ITEM_MASK_ZORA",
      "53": "ITEM_MASK_FIERCE_DEITY",
      "54": "ITEM_MASK_TRUTH",
      "55": "ITEM_MASK_KAFEIS_MASK",
      "56": "ITEM_MASK_ALL_NIGHT",
      "57": "ITEM_MASK_BUNNY",
      "58": "ITEM_MASK_KEATON",
      "59": "ITEM_MASK_GARO",
      "60": "ITEM_MASK_ROMANI",
      "61": "ITEM_MASK_CIRCUS_LEADER",
      "62": "ITEM_MASK_POSTMAN",
      "63": "ITEM_MASK_COUPLE",
      "64": "ITEM_MASK_GREAT_FAIRY",
      "65": "ITEM_MASK_GIBDO",
      "66": "ITEM_MASK_DON_GERO",
      "67": "ITEM_MASK_KAMARO",
      "68": "ITEM_MASK_CAPTAIN",
      "69": "ITEM_MASK_STONE",
      "70": "ITEM_MASK_BREMEN",
      "71": "ITEM_MASK_BLAST",
      "72": "ITEM_MASK_SCENTS",
      "73": "ITEM_MASK_GIANT",
      "74": "ITEM_BOW_FIRE",
      "75": "ITEM_BOW_ICE",
      "76": "ITEM_BOW_LIGHT",
      "77": "ITEM_SWORD_KOKIRI",
      "78": "ITEM_SWORD_RAZOR",
      "79": "ITEM_SWORD_GILDED",
      "80": "ITEM_SWORD_DEITY",
      "81": "ITEM_SHIELD_HERO",
      "82": "ITEM_SHIELD_MIRROR",
      "83": "ITEM_QUIVER_30",
      "84": "ITEM_QUIVER_40",
      "85": "ITEM_QUIVER_50",
      "86": "ITEM_BOMB_BAG_20",
      "87": "ITEM_BOMB_BAG_30",
      "88": "ITEM_BOMB_BAG_40",
      "89": "ITEM_WALLET_DEFAULT",
      "90": "ITEM_WALLET_ADULT",
      "91": "ITEM_WALLET_GIANT",
      "92": "ITEM_FISHING_ROD",
      "93": "ITEM_REMAINS_ODOLWA",
      "94": "ITEM_REMAINS_GOHT",
      "95": "ITEM_REMAINS_GYORG",
      "96": "ITEM_REMAINS_TWINMOLD",
      "97": "ITEM_SONG_SONATA",
      "98": "ITEM_SONG_LULLABY",
      "99": "ITEM_SONG_NOVA",
      "100": "ITEM_SONG_ELEGY",
      "101": "ITEM_SONG_OATH",
      "102": "ITEM_SONG_SARIA",
      "103": "ITEM_SONG_TIME",
      "104": "ITEM_SONG_HEALING",
      "105": "ITEM_SONG_EPONA",
      "106": "ITEM_SONG_SOARING",
      "107": "ITEM_SONG_STORMS",
      "108": "ITEM_SONG_SUN",
      "109": "ITEM_BOMBERS_NOTEBOOK",
      "110": "ITEM_SKULL_TOKEN",
      "111": "ITEM_HEART_CONTAINER",
      "112": "ITEM_HEART_PIECE",
      "113": "ITEM_71",
      "114": "ITEM_72",
      "115": "ITEM_SONG_LULLABY_INTRO",
      "116": "ITEM_KEY_BOSS",
      "117": "ITEM_COMPASS",
      "118": "ITEM_DUNGEON_MAP",
      "119": "ITEM_STRAY_FAIRIES",
      "120": "ITEM_KEY_SMALL",
      "121": "ITEM_MAGIC_JAR_SMALL",
      "122": "ITEM_MAGIC_JAR_BIG",
      "123": "ITEM_HEART_PIECE_2",
      "124": "ITEM_INVALID_1",
      "125": "ITEM_INVALID_2",
      "126": "ITEM_INVALID_3",
      "127": "ITEM_INVALID_4",
      "128": "ITEM_INVALID_5",
      "129": "ITEM_INVALID_6",
      "130": "ITEM_INVALID_7",
      "131": "ITEM_RECOVERY_HEART",
      "132": "ITEM_RUPEE_GREEN",
      "133": "ITEM_RUPEE_BLUE",
      "134": "ITEM_RUPEE_10",
      "135": "ITEM_RUPEE_RED",
      "136": "ITEM_RUPEE_PURPLE",
      "137": "ITEM_RUPEE_SILVER",
      "138": "ITEM_RUPEE_HUGE",
      "139": "ITEM_DEKU_STICKS_5",
      "140": "ITEM_DEKU_STICKS_10",
      "141": "ITEM_DEKU_NUTS_5",
      "142": "ITEM_DEKU_NUTS_10",
      "143": "ITEM_BOMBS_5",
      "144": "ITEM_BOMBS_10",
      "145": "ITEM_BOMBS_20",
      "146": "ITEM_BOMBS_30",
      "147": "ITEM_ARROWS_10",
      "148": "ITEM_ARROWS_30",
      "149": "ITEM_ARROWS_40",
      "150": "ITEM_ARROWS_50",
      "151": "ITEM_BOMBCHUS_20",
      "152": "ITEM_BOMBCHUS_10",
      "153": "ITEM_BOMBCHUS_1",
      "154": "ITEM_BOMBCHUS_5",
      "155": "ITEM_DEKU_STICK_UPGRADE_20",
      "156": "ITEM_DEKU_STICK_UPGRADE_30",
      "157": "ITEM_DEKU_NUT_UPGRADE_30",
      "158": "ITEM_DEKU_NUT_UPGRADE_40",
      "159": "ITEM_CHATEAU_2",
      "160": "ITEM_MILK",
      "161": "ITEM_GOLD_DUST_2",
      "162": "ITEM_HYLIAN_LOACH_2",
      "163": "ITEM_SEAHORSE_CAUGHT",
      "164": "ITEM_MAP_POINT_GREAT_BAY",
      "165": "ITEM_MAP_POINT_ZORA_HALL",
      "166": "ITEM_MAP_POINT_ROMANI_RANCH",
      "167": "ITEM_MAP_POINT_DEKU_PALACE",
      "168": "ITEM_MAP_POINT_WOODFALL",
      "169": "ITEM_MAP_POINT_CLOCK_TOWN",
      "170": "ITEM_MAP_POINT_SNOWHEAD",
      "171": "ITEM_MAP_POINT_IKANA_GRAVEYARD",
      "172": "ITEM_MAP_POINT_IKANA_CANYON",
      "173": "ITEM_MAP_POINT_GORON_VILLAGE",
      "174": "ITEM_MAP_POINT_STONE_TOWER",
      "175": "ITEM_MAP_POINT_GREAT_BAY_COAST",
      "176": "ITEM_MAP_POINT_SOUTHERN_SWAMP",
      "177": "ITEM_MAP_POINT_MOUNTAIN_VILLAGE",
      "178": "ITEM_MAP_POINT_MILK_ROAD",
      "179": "ITEM_MAP_POINT_ZORA_CAPE",
      "184": "ITEM_B8",
      "185": "ITEM_B9",
      "186": "ITEM_BA",
      "187": "ITEM_BB",
      "188": "ITEM_BC",
      "189": "ITEM_BD",
      "190": "ITEM_BE",
      "191": "ITEM_BF",
      "192": "ITEM_C0",
      "193": "ITEM_C1",
      "194": "ITEM_C2",
      "195": "ITEM_C3",
      "196": "ITEM_C4",
      "197": "ITEM_C5",
      "198": "ITEM_C6",
      "199": "ITEM_C7",
      "200": "ITEM_C8",
      "201": "ITEM_C9",
      "202": "ITEM_CA",
      "203": "ITEM_CB",
      "204": "ITEM_CC",
      "252": "ITEM_FC",
      "253": "ITEM_FD",
      "254": "ITEM_FE",
      "255": "ITEM_NONE"
    },
    "scenes": {
      "0": "Southern Swamp (Clear)",
      "7": "Lone Peak Shrine & Grottos",
      "8": "Cutscene Scene",
      "10": "Magic Hags' Potion Shop",
      "11": "Majora's Lair",
      "12": "Beneath the Graveyard",
      "13": "Curiosity Shop",
      "16": "Mama's House & Barn",
      "17": "Honey & Darling's Shop",
      "18": "The Mayor's Residence",
      "19": "Ikana Canyon",
      "20": "Pirates' Fortress",
      "21": "Milk Bar",
      "22": "Stone Tower Temple",
      "23": "Treasure Chest Shop",
      "24": "Inverted Stone Tower Temple",
      "25": "Clock Tower Rooftop",
      "26": "Before Clock Town",
      "27": "Woodfall Temple",
      "28": "Path to Mountain Village",
      "29": "Ancient Castle of Ikana",
      "30": "Deku Scrub Playground",
      "31": "Odolwa's Lair",
      "32": "Town Shooting Gallery",
      "33": "Snowhead Temple",
      "34": "Milk Road",
      "35": "Pirates' Fortress Interior",
      "36": "Swamp Shooting Gallery",
      "37": "Pinnacle Rock",
      "38": "Fairy's Fountain",
      "39": "Swamp Spider House",
      "40": "Oceanside Spider House",
      "41": "Astral Observatory",
      "42": "Moon Deku Trial",
      "43": "Deku Palace",
      "44": "Mountain Smithy",
      "45": "Termina Field",
      "46": "Post Office",
      "47": "Marine Research Lab",
      "48": "Beneath Graveyard and Dampe's House",
      "50": "Goron Shrine",
      "51": "Zora Hall",
      "52": "Trading Post",
      "53": "Romani Ranch",
      "54": "Twinmold's Lair",
      "55": "Great Bay Coast",
      "56": "Zora Cape",
      "57": "Lottery Shop",
      "59": "Pirates' Fortress Moat",
      "60": "Fisherman's Hut",
      "61": "Goron Shop",
      "62": "Deku King's Chamber",
      "63": "Moon Goron Trial",
      "64": "Road to Southern Swamp",
      "65": "Doggy Racetrack",
      "66": "Cucco Shack",
      "67": "Ikana Graveyard",
      "68": "Goht's Lair",
      "69": "Southern Swamp (poison)",
      "70": "Woodfall",
      "71": "Moon Zora Trial",
      "72": "Goron Village (spring)",
      "73": "Great Bay Temple",
      "74": "Waterfall Rapids",
      "75": "Beneath the Well",
      "76": "Zora Hall Rooms",
      "77": "Goron Village (winter)",
      "78": "Goron Graveyard",
      "79": "Sakon's Hideout",
      "80": "Mountain Village (winter)",
      "81": "Ghost Hut",
      "82": "Deku Shrine",
      "83": "Road to Ikana",
      "84": "Swordsman's School",
      "85": "Music Box House",
      "86": "Igos du Ikana's Lair",
      "87": "Tourist Information",
      "88": "Stone Tower",
      "89": "Inverted Stone Tower",
      "90": "Mountain Village (spring)",
      "91": "Path to Snowhead",
      "92": "Snowhead",
      "93": "Path to Goron Village (winter)",
      "94": "Path to Goron Village (spring)",
      "95": "Gyorg's Lair",
      "96": "Secret Shrine",
      "97": "Stock Pot Inn",
      "98": "Great Bay Cutscene",
      "99": "Clock Tower Interior",
      "100": "Woods of Mystery",
      "101": "Lost Woods (Intro)",
      "102": "Moon Link Trial",
      "103": "The Moon",
      "104": "Bomb Shop",
      "105": "Giants' Chamber",
      "106": "Gorman Track",
      "107": "Goron Racetrack",
      "108": "East Clock Town",
      "109": "West Clock Town",
      "110": "North Clock Town",
      "111": "South Clock Town",
      "112": "Laundry Pool"
    },
    "actors": {
      "0": "Player",
      "1": "Crater Marks",
      "2": "Shop Items",
      "3": "Enemy body parts",
      "4": "Deku Shrine Flames",
      "5": "Wooden Door",
      "6": "Chest",
      "7": "Gekko (Miniboss)",
      "8": "Octorok",
      "9": "Bomb / Powder Keg",
      "10": "Wallmaster",
      "11": "Dodongo",
      "12": "Keese",
      "13": "Epona",
      "14": "Collectibles",
      "15": "Arrow / Deku Nut",
      "16": "Fairy",
      "17": "Cucco",
      "18": "Tektite",
      "20": "Peehat",
      "21": "Butterfly",
      "22": "Non-burrowing bug",
      "23": "Fish",
      "24": "Loading Hall/Hole",
      "25": "Dinolfos",
      "26": "Red Flag on Post",
      "27": "(Empty)",
      "28": "Cutscene Actor(?)",
      "29": "Shabom (OoT)",
      "30": "Studded Lifting Door/Ikana Castle Rolling Door",
      "32": "Zora Boomerang",
      "33": "Elegy of Emptiness Shell",
      "34": "Frog Choir Frog",
      "36": "Large Skulltula",
      "38": "gameplay_keep item(?)",
      "39": "Stone Tower Temple Inverter",
      "40": "Environmental noises",
      "42": "Trading Post Shop",
      "45": "Death Armos (Inv. Stone Tower)",
      "47": "Bomb Flower",
      "50": "Armos",
      "51": "Deku Baba",
      "52": "Deku Nut Effect",
      "53": "Spin Attack/Sword Beam",
      "54": "Great Bay Temple Weather(?)",
      "56": "Blue Warp portal/crystal / Majora's Mask boss warp platform",
      "57": "Torch",
      "58": "Heart Container",
      "59": "Mad Scrub",
      "60": "Red Bubble",
      "61": "Hookshot Tip",
      "62": "Blue Bubble",
      "63": "Termina Field Fountain Water",
      "65": "Tree/Shrub",
      "67": "Gomess",
      "68": "Gomess's Bat",
      "71": "Beamos",
      "72": "Cutscene Effect",
      "73": "BG Effect (Lost Woods/Giant's Chamber/Moon)",
      "74": "Floormaster",
      "76": "Redead/Gibdo (can't talk to player)",
      "77": "Grey Square Stone Elevator (Stone Tower Temple)",
      "79": "Bug/Insect/Butterfly spawner",
      "80": "Skullwalltula",
      "81": "Snow/Rain (SK backstory)/Bubble (Pinnacle Rock)",
      "84": "Child Epona (OoT) (Broken)",
      "85": "Grotto Hold Entrance",
      "91": "Spawner (Dragonfly/Skullfish/Wallmaster)",
      "92": "Light from Treasure Chest",
      "95": "Majora's Mask Balloon (Astral Observatory)",
      "96": "(Empty)",
      "97": "Twisting Path w/Stone Doors to Clock Tower",
      "98": "Reflectable light ray (OoT) (Broken)",
      "100": "Shellblade",
      "101": "Fused Jellies & Gekko",
      "102": "Wilted Dekubaba/Mini Baba",
      "103": "Gorman Brother",
      "105": "Adult Ruto (OoT)",
      "106": "Bombchu",
      "107": "Gorman Race Track Dirt Patch",
      "108": "Like Like",
      "115": "(Unknown) - EnFr",
      "121": "Fishing Pond Elements",
      "122": "Pushable Block",
      "123": "Dust Effect",
      "124": "Horse Jumping Fence",
      "125": "Fire Arrow",
      "126": "Ice Arrow",
      "127": "Light Arrow",
      "128": "Leftover Collectible Items (OoT)",
      "129": "Small grabbable crate",
      "130": "Pot",
      "132": "Iron Knuckle",
      "137": "(Unknown) - DemoShd",
      "138": "King's Chamber Deku Guard (Deku Palace)",
      "139": "Tatl Hint (proximity C-Up?)",
      "140": "Fire-shooting Eye Switch",
      "141": "Flying Pot Trap",
      "142": "Large Ice Block (meltable)",
      "143": "Freezard",
      "144": "Grass",
      "145": "Floating Bean Plant/Soft Soil",
      "146": "Bombable Boulder",
      "147": "Floor/Eye Switch",
      "149": "Brown Elevator (Dampe's Grave)",
      "150": "Hookshot Block",
      "151": "Ocarina Music Staff Spot",
      "153": "Rolling Boulder",
      "156": "Carpenter",
      "157": "Cucco chick",
      "158": "In-chest Item Draw (unused)",
      "159": "White-clad Gerudo Pirate",
      "160": "Push Block trigger (Snowhead)",
      "161": "Dynamic Player Shadow",
      "162": "Various Effects",
      "164": "Gorman",
      "165": "Bean Seller",
      "166": "Grog",
      "167": "Swamp Tour Boat",
      "168": "Square Signpost",
      "170": "Attacking Cucco",
      "174": "Marine Researcher",
      "175": "Kaepora Gaebora",
      "176": "Liftable Rocks/Silver Boulders",
      "177": "Orange Graveyard Flower",
      "178": "Sun Switch / STT Flip switch",
      "179": "Rock Circle Spawner",
      "181": "Honey & Darling",
      "184": "Water Vortex (OoT)",
      "185": "Rock Sirloin",
      "188": "Local Weather Changes",
      "189": "Man in Tree in South Termina Field",
      "191": "Moon Child",
      "196": "Song of Storms Storm",
      "197": "Title Logo",
      "198": "Tatl Hint (Z-Target C-Up?)",
      "199": "Stone Tower vertically oscillating platform (unused)",
      "202": "Pierre the Scarecrow",
      "203": "Pushable Block Switch Flag Handler",
      "204": "Sun's Song Ocarina Effect",
      "206": "Grotto chest spawner",
      "208": "Sun hitbox (OoT)/Fairy Spawner(?)",
      "211": "Room Timer",
      "212": "Cursed Man (Swamp Spider House)",
      "214": "Song of Time Ocarina Effect",
      "215": "Song of Storms Ocarina Effect",
      "216": "Proximity-based cutscene trigger",
      "217": "Mini Jelly Droplet",
      "218": "Deku Nut projectile",
      "223": "Epona's Song Ocarina Effect",
      "224": "Saria's Song Ocarina Effect (OoT)",
      "226": "Dog",
      "227": "Gold Skulltula Token",
      "228": "Beehive",
      "229": "Large Wooden Crate",
      "231": "Targetable Nothing",
      "232": "Group Rupee spawner",
      "233": "Target Game (Honey & Darling)",
      "236": "Wolfos/White Wolfos",
      "237": "Stalchild",
      "239": "Gossip Stone",
      "240": "Invisible Sound Emitter",
      "241": "Guay",
      "243": "Cow",
      "246": "Scarecrow's Song Ocarina Effect",
      "248": "Zora (Unused)",
      "249": "Soft Soil w/Skulltula (Swamp Spider House)",
      "250": "Aviel (Gerudo Pirate Leader)",
      "252": "Bronze Boulder",
      "253": "Glitched Skull Kid T-pose",
      "254": "Postman's Letter to Himself",
      "256": "Staircase",
      "258": "Puzzle Block",
      "259": "Blade Trap",
      "261": "Non-Hostile Armos",
      "262": "(Unknown)",
      "265": "Dragonfly",
      "267": "Optimized Manager for ObjGrassUnit grasses",
      "268": "Carried grass from ObjGrassUnit",
      "269": "Grass pattern initializer",
      "272": "Wall of Fire from BgSpoutFire",
      "273": "Dummied out Enemy",
      "274": "Garo Spawner",
      "275": "Garo",
      "276": "Falling row of blocks (unused)",
      "277": "Igos du Ikana/IdI Lackey",
      "278": "Warp to Moon Trial Entrance",
      "279": "Mamamu Yan",
      "280": "(Empty)",
      "281": "(Empty)",
      "282": "(Empty)",
      "283": "Stalchild/Fire Wall spawner (Keeta Chase)",
      "284": "Bomber Line",
      "285": "Shooting Gallery Guy",
      "287": "Icicle",
      "288": "Shooting Gallery Guay",
      "289": "(Empty)",
      "290": "Market NPC (Unused)",
      "291": "Bomb Shop Lady NPC (Unused)",
      "292": "Professor Shikashi (Astral Observatory)",
      "293": "Spider web",
      "296": "Goron Race Controls",
      "297": "Odolwa/Odolwa Bug/Odolwa Afterimage",
      "298": "Twinmold",
      "299": "Gyorg",
      "300": "Wart",
      "301": "Bio Deku Baba",
      "302": "Igos du Ikana window",
      "303": "Majora",
      "304": "Great Fairy",
      "306": "(Empty)",
      "309": "Shop (Zora/Goron/Bomb)",
      "312": "Goron",
      "314": "Carnivorous Lily Pad",
      "315": "Stone Tower Smoke",
      "316": "Moving Deku Flower Platform",
      "317": "Big Wooden Flower (Woodfall Temple)",
      "318": "Breakable Pot with Grass",
      "319": "Horizontal Spike-Covered Log",
      "320": "Boss Mask cutscene object",
      "321": "Shooting Gallery Wolfos",
      "322": "Ice-Sliding Pushable Block",
      "323": "Ice Block Surrounding Frozen Enemy",
      "324": "Snapper",
      "325": "Shooting Gallery Scrub",
      "326": "Tatl Message (Proximity?)",
      "327": "Enemy Frog (beta)",
      "328": "Tree Trunk (Lost Woods cutscene)",
      "329": "Glitched Skull Kid T-Pose (cutscene)",
      "330": "Chuchu",
      "331": "Desbreko",
      "332": "Clock Tower spotlight (unused)",
      "333": "Clock Town smoking chimney",
      "334": "Stock Pot Inn bell",
      "335": "Shooting Gallery Octorok",
      "337": "West Clock Town bank closing shutter",
      "338": "Child Zelda",
      "339": "Stray Fairy group manager",
      "340": "Mask effect handler (when Link falls in intro)",
      "341": "Nejiron",
      "342": "Vertical spike rollers",
      "343": "Romani Ranch Chimney Smoke",
      "344": "Lens of Truth-affected object",
      "345": "Kafei",
      "346": "Three-day events",
      "347": "Bad Bat",
      "348": "Mikau's Grave/Song Pedestal",
      "349": "Wizrobe",
      "350": "Wizrobe Warp Platform",
      "351": "Wizrobe Fire/Ice Attack",
      "352": "EoE Beam of Light",
      "353": "Pillar of Water (Giant's Chamber)",
      "354": "Ring of Fire",
      "355": "Wooden Ladder",
      "356": "Black/White Boe",
      "357": "Cutscene Object for Great Fairy Mask/Sword",
      "359": "Exploding Snow Mountain? (unused)",
      "360": "Koume (Boat House)",
      "361": "Hallucinatory Mad Scrub",
      "362": "Deku King",
      "364": "Spiked Fence (Termina Field)",
      "365": "Milk Road/Goron Racetrack Boulder",
      "366": "(Empty)",
      "367": "Real Bombchu",
      "368": "Water/Rock Drop Spawner/Gyorg splashing effect",
      "369": "Keaton Grass",
      "370": "Proximity-activated Fire Wall Spawner",
      "372": "Great Bay Moving parts",
      "373": "Great Fairy Beam",
      "374": "Tingle (w/Balloon)",
      "375": "Bank Teller",
      "376": "Pirates' Fortress Telescope",
      "377": "Floating Ice Platform (Mountain Village)",
      "378": "Patrolling Deku Guard",
      "379": "Bugs from Bottle",
      "380": "Moon/Moon effect/Moon Tear",
      "381": "Counting Game Postman",
      "382": "Sliding Doors (Deku Shrine)",
      "383": "Deku Butler",
      "384": "Skullfish",
      "385": "Defeated Skullfish",
      "386": "Garo Master",
      "387": "Deku Flower",
      "388": "Eyegore",
      "389": "Spike metal mine",
      "390": "Poisoned/Purified Water Element",
      "391": "Koume (Woods of Mystery)",
      "392": "Kotake",
      "395": "Spring Water modifier",
      "396": "Song of Time Effect",
      "397": "Beaver Bro",
      "398": "Rubble (Eyegore)",
      "399": "Central Pillar (Snowhead Temple)",
      "400": "Lost Woods Cutscene Trees/Floor",
      "401": "Skull Kid (Cutscene)/Majora's Mask (Cutscene)",
      "402": "Tatl/Tael (Cutscene)",
      "403": "Woodfall scene object",
      "404": "Ocarina of Time (Clock Tower rooftop cutscenes)",
      "405": "Deku Mask (Cutscene)",
      "406": "Tatl/Tael (unused)",
      "407": "Cutscene Mask object",
      "408": "Mountain Village Snowy landscape fadeout",
      "409": "Milk Bar Object",
      "410": "Large Great Bay Turtle",
      "411": "Pirates' Fortress CS character",
      "412": "Clock Tower Component",
      "414": "Monkey",
      "415": "Pillar (weak to Eyegore, unused)",
      "416": "Deku Palace Entrace guard",
      "417": "Bombable Wall (Snowhead Temple)",
      "418": "Clock Tower Swinging Doors",
      "419": "Raisable pillar (Snowhead Temple)",
      "420": "Romani",
      "421": "Beaver Race Ring",
      "422": "Poe Balloon (Romani Ranch)",
      "423": "Wooden Door (copy)",
      "424": "Big Octo",
      "425": "Ice Platform from Ice Arrow",
      "426": "Triforce Elevator?",
      "427": "Event Trigger",
      "428": "Sliding doors",
      "429": "Spotlight (Human -> Deku cutscene)",
      "430": "Rotating Platform (Honey & Darling)",
      "431": "Bottle Water",
      "432": "Stray Fairy",
      "433": "Stray Fairy (bubble)",
      "435": "Target (Honey & Darling)",
      "436": "Bomb Basket (Honey & Darling)",
      "437": "Happy Mask Salesman",
      "438": "Inside Clock Tower Cog/Organ",
      "439": "Kotake (Southern Swamp/Woods of Mystery)",
      "440": "Door (to top of Clock Tower)",
      "441": "Lily Pad",
      "442": "Snapper",
      "443": "Treasure Chest Shop board manager",
      "444": "Water (Honey & Darling)",
      "445": "Business Scrub (carrying bags)",
      "446": "Cuttable Ivy",
      "448": "Lens of Truth Platform",
      "449": "Treasure Chest Shop Girl",
      "450": "Great Bay Fisherman",
      "451": "Potion Shop Owner (OoT)",
      "452": "Curiosity Shop Man",
      "453": "Swamp Tourist Center Guide",
      "455": "Gate-Blocking Soldier",
      "456": "Large Icicle",
      "457": "Deku Scrub Playground Employee",
      "458": "Dampe",
      "460": "Scenery (West Clocktown)",
      "461": "Rupee Elevator (Deku Scrub Elevator)",
      "462": "Song of Soaring effect",
      "463": "Sun Block",
      "464": "Reflectable light ray",
      "465": "Dexihand",
      "466": "Deku Scrub Playground Rupee",
      "467": "Floating Block (Deku Shrine/Snowhead Temple)",
      "468": "Snow-Covered Tree",
      "469": "Postman",
      "470": "2D Song Button (Termina Field)",
      "471": "Tatl Hint (Proximity C-Up Copy?)",
      "472": "Tatl Message (Proximity copy?)",
      "473": "Lab Heart Piece/Garo Master Falling rock/Garo Master Bomb",
      "474": "Talking Gibdo",
      "475": "Giant",
      "476": "Large Snowball",
      "477": "Goht",
      "478": "Spirit House Owner",
      "479": "Monkey Instrument Prompt",
      "480": "Goron Shrine Gate",
      "481": "Seahorse Spawner (unused)",
      "482": "Stone Bridge",
      "483": "Gravestone",
      "484": "Goron Link Switch",
      "486": "Eeno",
      "487": "Skulltula bonk detector",
      "488": "Poe Sister",
      "489": "Hiploop",
      "490": "Goht Debris",
      "491": "Fireworks",
      "492": "Switch/Chest/Collectible Detector",
      "493": "Updraft Current/Water Current",
      "494": "Racetrack Dog",
      "495": "Swordsman",
      "496": "Keeta Race Gatepost",
      "497": "Marine Research Lab Fish",
      "498": "Postbox",
      "499": "Poe",
      "500": "Tent-Shaped spide web",
      "501": "Zora Egg",
      "502": "Zubora",
      "503": "Darmani's Ghost",
      "504": "Practice Log",
      "505": "Small Snowball",
      "506": "Darmani's Ghost (copy)",
      "507": "Darmani's Gravestone",
      "508": "Deku Princess",
      "509": "Biggoron",
      "510": "Goron Hot Spring Water",
      "511": "Gabora",
      "512": "Alien",
      "513": "Goron Elder's Son",
      "514": "Anju",
      "516": "Giant Bee",
      "517": "Seahorse",
      "518": "Deep Python",
      "519": "Gong",
      "520": "Big Poe",
      "521": "Cuttable Board (Swordsman's School)",
      "522": "Little Cow Statue Head",
      "523": "Guy looking at Moon/Uncursed Man (Swamp Spider House)",
      "524": "Deep Python manager",
      "525": "Flat's Tomb Curtain",
      "526": "Bombable Wall (Ocean Spider House)",
      "527": "Fireplace Gate (Ocean Spider House)",
      "528": "Skullkid Painting (Ocean Spider House)",
      "529": "Drawers (Ocean Spider House)",
      "530": "Stalchildren Circle",
      "531": "Goron Elder",
      "532": "Koume on Broom",
      "533": "Cremia's Cart",
      "534": "(New!) Leevers",
      "535": "Milk Bar Chair",
      "536": "Rotating Room Pushblock (Stone Tower Temple)",
      "537": "Mirror (Stone Tower Temple)",
      "538": "Rotating Room (Stone Tower Temple)",
      "539": "Seesaw/Waterwhell w/ platforms (Great Bay Temple)",
      "540": "Waterfall (Great Bay Temple)",
      "541": "Fighter Pirate",
      "542": "Purple Gerudo Pirate",
      "543": "Romani (paired)",
      "544": "Cremia",
      "545": "Flag/Carnival Platform (South Clock Town)",
      "546": "Elevator (Great Bay Temple)",
      "547": "Owl Statue",
      "548": "Mikau",
      "549": "Spiked Rotating Platform",
      "550": "Goron Elder's Drum",
      "551": "Twinmold Arena",
      "552": "Zora with Directions/Pot Game Zora",
      "553": "Tree",
      "554": "Elevator Platform",
      "555": "Sliding grated shutters",
      "556": "Pirate Boat",
      "557": "Wooden Barrel/Breakable Pirate Panel",
      "558": "Switch-Activated Geyser",
      "559": "Boat Cruise Target",
      "560": "Mirror shield reflection and glow",
      "561": "Japas (Zora Bassist)",
      "562": "Tatl Hint (3rd proximity C-Up?)",
      "563": "Sakon's Hideout Object",
      "564": "Toto",
      "565": "Patrolling Gibdos",
      "566": "Bomb Shop Lady (used)",
      "567": "Sakon",
      "568": "Zora Drummer Tijo",
      "569": "Lottery Shop",
      "570": "Goron with Don Gero's Mask",
      "571": "Mushroom",
      "572": "Palm Tree",
      "573": "Moth Swarm (Woodfall Temple)",
      "574": "Wart's Bubble",
      "575": "Small fish (Gyorg)",
      "576": "Goron Shrine Chandelier",
      "577": "Evan (Zora Synthesizer)",
      "578": "Goron Shrine Goron/Bomb Shop Goron",
      "579": "Anju's Grandma",
      "580": "Juggler",
      "581": "Stone Tower Block",
      "582": "Stone Tower Floor Switch",
      "583": "Flat/Sharp",
      "584": "Guru Guru",
      "585": "Ocarina Effect (Sonata/Lullaby/Bossa Nova/Elegy/Oath)",
      "586": "Shiro",
      "587": "Song of Soaring Ocarina Effect",
      "588": "Business Scrub (Heart Piece)",
      "589": "Guay (Astral Observatory Telescope)",
      "590": "Song of Healing Ocarina Effect",
      "591": "Turtle Awakening Wave",
      "592": "Gibdo (Pamela's Father)",
      "593": "Pamela's Father",
      "594": "Lulu (Zora Vocalist)",
      "595": "Anju's Mother",
      "596": "Closet Door (Music Box House)",
      "597": "Bombable Tan Floor File (Stone Tower Temple)",
      "598": "Large light ray (Stone Tower Temple)",
      "599": "Metal Shutter (Stone Tower Temple)",
      "600": "Bombable Wall (Beneath the Well)",
      "601": "Flat's Tomb",
      "602": "Giant Rupee",
      "603": "Sharp's Cave",
      "604": "Waterwheel/Stone Tower Door/Sakon's Hideout Door",
      "605": "Pamela",
      "606": "Hookshottable Tree",
      "607": "Sleeping Deku Scrub",
      "608": "Complaining Water",
      "609": "Green Target Spot",
      "610": "Madame Aroma",
      "611": "Mr. Barten",
      "612": "Bomb Shop Bag (Stolen)",
      "613": "Invisible Rupee Hitbox",
      "614": "Guay (circling Clock Town)",
      "615": "Seagull",
      "616": "Destructible Item (Twinmold Arena)",
      "617": "Invisible Enemy (unused)",
      "618": "Milk Road Carpenter",
      "619": "Mutoh (carpenter boss)",
      "620": "Viscen (Clock Town Guard leader)",
      "621": "Soldier (Mayor's Office)",
      "622": "Shiro (Unused?)",
      "623": "Mayor Detour",
      "624": "Laundry Pool Bell",
      "625": "Cremia & Romani's Dinner",
      "626": "Moon Crash CS Fire Wall",
      "627": "Punchable Pillar Segments (Stone Tower Temple)",
      "628": "Trade Quest business scrub",
      "629": "Skull Kid effect",
      "630": "Link the Goron",
      "631": "Racing Goron",
      "632": "Igos du Ikana's head/IdI lackey's head",
      "633": "Guy waving at telescope",
      "634": "Kamaro",
      "635": "Judo (Red)/Marilla (Blue) Rosa",
      "636": "Rupees (from telescope)",
      "637": "Hand in Toilet",
      "638": "Bomber Jim",
      "639": "Bomber (being chased)",
      "640": "Blue-Hatted Bomber",
      "641": "Hideout Guard",
      "642": "Majora's Mask Balloon (Clock Town)",
      "643": "Moon's Tear",
      "644": "Dialogue Handler (Music Box House)",
      "645": "Object (Ancient Castle of Ikana)",
      "646": "Indigo-Gos",
      "647": "Gorman Bros. Building",
      "648": "Cow Barn Roof",
      "649": "Deku Butler's Son's Corpse",
      "650": "Underwater Grate",
      "651": "Milk Jar",
      "652": "Keaton",
      "653": "Bombable Wall (Astral Laboratory)",
      "654": "Hot Checkered Celing (Ikana Castle)",
      "655": "Captain Keeta",
      "656": "Mayor's Receptionist",
      "657": "Takkuri",
      "658": "Jumping Game",
      "659": "Jumping Game Torch",
      "660": "2nd Floor Window (Stockpot Inn)",
      "661": "Ikana Canyon Cleansing CS Effect",
      "662": "Moon Disappearing CS",
      "663": "Rainbow Hookshot Pillar",
      "664": "Bombable, Climbable Wall (Moon)",
      "665": "Anju (Wedding Dress)",
      "666": "Alien CS Actor",
      "667": "Floating Block (Deku Shrine/Snowhead Temple)",
      "668": "Warp Beam from Moon?",
      "669": "Madame Aroma (Cutscene)",
      "670": "Anju (Cutscene)",
      "671": "Anju's Mother (Cutscene)",
      "672": "Anju's Grandma (Credits)",
      "673": "Wedding Dress Mannequin",
      "674": "Mayor Detour (credits)",
      "675": "Tingle (Cutscene)",
      "676": "Tingle Confetti",
      "677": "Hinting Stalchild (Oceanside Spider House)",
      "678": "Cutscene?",
      "679": "Brown Bird",
      "680": "Viscen watching moon (cutscene)",
      "681": "Mutoh watching moon (cutscene)",
      "682": "Soldier watching moon (cutscene)",
      "683": "Carpenter watching moon (cutscene)",
      "684": "Cutscene character (unused)",
      "685": "Dm_An duplicate",
      "686": "Item Drop Spawner (soft soil)",
      "687": "Invisible Ruppe",
      "688": "Stump/Lighting (credits end)",
      "689": "Bomb Shop Man (credits)"
    },
    "flag_types": {
      "0": "FLAG_NONE",
      "1": "FLAG_WEEK_EVENT_REG",
      "2": "FLAG_WEEK_EVENT_REG_HORSE_RACE",
      "3": "FLAG_EVENT_INF",
      "4": "FLAG_SCENES_VISIBLE",
      "5": "FLAG_OWL_ACTIVATION",
      "6": "FLAG_PERM_SCENE_CHEST",
      "7": "FLAG_PERM_SCENE_SWITCH",
      "8": "FLAG_PERM_SCENE_CLEARED_ROOM",
      "9": "FLAG_PERM_SCENE_COLLECTIBLE",
      "10": "FLAG_PERM_SCENE_UNK_14",
      "11": "FLAG_PERM_SCENE_ROOMS",
      "12": "FLAG_CYCL_SCENE_CHEST",
      "13": "FLAG_CYCL_SCENE_SWITCH",
      "14": "FLAG_CYCL_SCENE_CLEARED_ROOM",
      "15": "FLAG_CYCL_SCENE_COLLECTIBLE",
      "16": "FLAG_RANDO_INF"
    }
  }
};

// src/lookups.ts
var PREFIX = {
  items: "ITEM",
  scenes: "SCENE",
  actors: "ACTOR",
  flag_types: "FLAG"
};
function hexFallback(category, id) {
  return `${PREFIX[category]} 0x${id.toString(16).padStart(4, "0")}`;
}
var FIELD_CATEGORY = {
  actorId: "actors",
  getItemId: "items",
  itemId: "items",
  sceneNum: "scenes",
  flagType: "flag_types"
};
var LookupStore = class {
  #tables;
  constructor(base = BUNDLED_LOOKUPS) {
    this.#tables = structuredClone(base);
  }
  /** Resolve an id to a name, falling back to a hex label when unknown. */
  name(game, category, id) {
    return this.#tables[game]?.[category]?.[String(id)] ?? hexFallback(category, id);
  }
  /** How many entries a table has (0 if absent). */
  count(game, category) {
    const table = this.#tables[game]?.[category];
    return table ? Object.keys(table).length : 0;
  }
  /** Replace a single table (from a refresh or a cache). */
  set(game, category, map) {
    (this.#tables[game] ??= {})[category] = {
      ...map
    };
  }
  /**
   * Overlay a cached snapshot (e.g. from ctx.storage) onto the bundled tables,
   * keeping the bundled table wherever the cache has nothing. Ignores garbage.
   */
  applyCache(cached) {
    if (!cached || typeof cached !== "object") return;
    for (const [game, cats] of Object.entries(cached)) {
      if (!cats || typeof cats !== "object") continue;
      for (const [category, map] of Object.entries(cats)) {
        const coerced = coerceMap(map);
        if (Object.keys(coerced).length > 0) this.set(game, category, coerced);
      }
    }
  }
  /** The current tables, for persisting to ctx.storage after a refresh. */
  snapshot() {
    return structuredClone(this.#tables);
  }
  /**
   * Re-fetch every loaded table from `<baseUrl>/<category>_<game>.json`.
   * Never throws; a failed or empty fetch leaves that table as-is, so a bad
   * refresh can't wipe working data.
   */
  async refresh(fetcher, baseUrl) {
    const base = baseUrl.replace(/\/+$/, "");
    const out = [];
    for (const [game, cats] of Object.entries(this.#tables)) {
      for (const category of Object.keys(cats)) {
        const url = `${base}/${category}_${game}.json`;
        try {
          const res = await fetcher(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const map = coerceMap(await res.json());
          const count = Object.keys(map).length;
          if (count === 0) throw new Error("no entries");
          this.set(game, category, map);
          out.push({
            game,
            category,
            ok: true,
            count
          });
        } catch (err) {
          out.push({
            game,
            category,
            ok: false,
            count: 0,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
    }
    return out;
  }
};
function annotateHook(game, hook, store) {
  const parts = [];
  for (const [key, value] of Object.entries(hook)) {
    if (key === "type") continue;
    const category = FIELD_CATEGORY[key];
    if (category && typeof value === "number") {
      parts.push(`${key}=${value} (${store.name(game, category, value)})`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.length > 0 ? `${hook.type} ${parts.join(" ")}` : String(hook.type);
}
function coerceMap(value) {
  const out = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out[k] = String(v);
    }
  }
  return out;
}

// src/protocol.ts
var TS2H_DEFAULT_HOOKS = [
  "OnSceneInit",
  "OnItemGive",
  "OnFlagSet",
  "OnFlagUnset",
  "OnSceneFlagSet",
  "OnSceneFlagUnset"
];
var encoder = new TextEncoder();
var decoder = new TextDecoder();
function encodePacket(packet) {
  return encoder.encode(JSON.stringify(packet) + "\0");
}
function parseIncoming(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const obj = raw;
  if (obj.type === "result" && typeof obj.id === "string") {
    const status = obj.status;
    if (status === "success" || status === "failure" || status === "try_again" || status === "timeout") {
      return {
        id: obj.id,
        type: "result",
        status
      };
    }
    return null;
  }
  if (obj.type === "hook") {
    const hook = obj.hook;
    if (hook && typeof hook === "object" && typeof hook.type === "string") {
      return {
        type: "hook",
        hook
      };
    }
  }
  return null;
}
function newPacketId() {
  return crypto.randomUUID();
}
var PacketFramer = class {
  #buffer = new Uint8Array(0);
  push(chunk) {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;
    const packets = [];
    let start = 0;
    for (let i = 0; i < this.#buffer.length; i++) {
      if (this.#buffer[i] !== 0) continue;
      const body = this.#buffer.subarray(start, i);
      if (body.length > 0) packets.push(decoder.decode(body));
      start = i + 1;
    }
    this.#buffer = this.#buffer.slice(start);
    return packets;
  }
  /** Bytes buffered awaiting a terminator (diagnostics / tests). */
  get pending() {
    return this.#buffer.length;
  }
};

// src/client.ts
var nextClientId = 1;
var SailClient = class {
  game;
  id;
  #conn;
  #log;
  #onHook;
  #onClose;
  #framer = new PacketFramer();
  #pending = /* @__PURE__ */ new Map();
  #closed = false;
  #timeoutMs;
  #retryDelayMs;
  #maxRetries;
  constructor(deps) {
    this.#conn = deps.conn;
    this.game = deps.game;
    this.id = nextClientId++;
    this.#log = deps.log;
    this.#onHook = deps.onHook;
    this.#onClose = deps.onClose;
    this.#timeoutMs = deps.timeoutMs ?? 5e3;
    this.#retryDelayMs = deps.retryDelayMs ?? 500;
    this.#maxRetries = deps.maxRetries ?? 5;
    void this.#readLoop();
  }
  get closed() {
    return this.#closed;
  }
  /** Send a console command (the channel both games support). */
  command(command) {
    return this.send({
      type: "command",
      command
    });
  }
  /** Send an effect packet (apply/remove/command/teleport shapes). */
  effect(effect) {
    return this.send({
      type: "effect",
      effect
    });
  }
  /** Subscribe to a hook (2S2H emits nothing until you do). */
  subscribe(eventName, eventIdFilter) {
    const body = {
      type: "subscribe",
      eventName
    };
    if (eventIdFilter !== void 0) body.eventIdFilter = eventIdFilter;
    return this.send(body);
  }
  /** Stop receiving a hook previously subscribed to. */
  unsubscribe(eventName, eventIdFilter) {
    const body = {
      type: "unsubscribe",
      eventName
    };
    if (eventIdFilter !== void 0) body.eventIdFilter = eventIdFilter;
    return this.send(body);
  }
  /**
   * Send a packet and resolve with the game's verdict, retrying "try_again".
   * Never rejects.
   */
  async send(body) {
    let status = "failure";
    for (let attempt = 0; attempt <= this.#maxRetries; attempt++) {
      if (this.#closed) return "failure";
      status = await this.#sendOnce({
        ...body,
        id: newPacketId()
      });
      if (status !== "try_again") return status;
      this.#log?.debug(`[sail:${this.game}] try_again \u2014 retry ${attempt + 1}/${this.#maxRetries} in ${this.#retryDelayMs}ms`);
      if (attempt < this.#maxRetries) await delay(this.#retryDelayMs);
    }
    return status;
  }
  async #sendOnce(packet) {
    try {
      await writeAll(this.#conn, encodePacket(packet));
    } catch (err) {
      this.#log?.warn(`[sail:${this.game}] write failed: ${err instanceof Error ? err.message : String(err)}`);
      this.close();
      return "failure";
    }
    return await new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(packet.id);
        resolve("timeout");
      }, this.#timeoutMs);
      this.#pending.set(packet.id, {
        resolve,
        timer
      });
    });
  }
  async #readLoop() {
    const buf = new Uint8Array(4096);
    while (!this.#closed) {
      let count;
      try {
        count = await this.#conn.read(buf);
      } catch {
        break;
      }
      if (count === null) break;
      for (const body of this.#framer.push(buf.subarray(0, count))) {
        this.#handle(body);
      }
    }
    this.close();
  }
  #handle(body) {
    const packet = parseIncoming(body);
    if (!packet) {
      this.#log?.debug(`[sail:${this.game}] ignoring malformed packet`);
      return;
    }
    if (packet.type === "result") {
      const pending = this.#pending.get(packet.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.#pending.delete(packet.id);
      pending.resolve(packet.status);
      return;
    }
    try {
      this.#onHook?.(packet.hook);
    } catch (err) {
      this.#log?.error(`[sail:${this.game}] hook handler threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  /** Close the connection and fail everything in flight. Idempotent. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.resolve("failure");
    }
    this.#pending.clear();
    try {
      this.#conn.close();
    } catch {
    }
    this.#onClose?.();
  }
};
async function writeAll(conn, data) {
  let offset = 0;
  while (offset < data.length) {
    const written = await conn.write(data.subarray(offset));
    if (written <= 0) throw new Error("connection refused the write");
    offset += written;
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// src/server.ts
var SailServer = class {
  game;
  #deps;
  #listener;
  #clients = /* @__PURE__ */ new Set();
  #error = null;
  #stopped = false;
  constructor(deps) {
    this.#deps = deps;
    this.game = deps.game;
  }
  /** True once a game has connected. */
  get connected() {
    return this.#clients.size > 0;
  }
  get clients() {
    return [
      ...this.#clients
    ];
  }
  /** The port actually bound (resolves port 0), or the requested one. */
  get port() {
    const addr = this.#listener?.addr;
    return addr && addr.transport === "tcp" ? addr.port : this.#deps.port;
  }
  /** Why the listener isn't up (e.g. the port is taken), or null. */
  get error() {
    return this.#error;
  }
  get listening() {
    return this.#listener !== void 0;
  }
  /**
   * Start listening. A bind failure (port in use) is recorded and logged rather
   * than thrown — one game's port conflict shouldn't take the plugin down.
   */
  start() {
    if (this.#listener) return;
    this.#stopped = false;
    try {
      this.#listener = Deno.listen({
        port: this.#deps.port,
        hostname: "127.0.0.1"
      });
      this.#error = null;
      this.#deps.log?.info(`[sail:${this.game}] listening on 127.0.0.1:${this.port}`);
    } catch (err) {
      this.#error = err instanceof Error ? err.message : String(err);
      this.#deps.log?.error(`[sail:${this.game}] could not listen on port ${this.#deps.port}: ${this.#error}`);
      return;
    }
    void this.#acceptLoop(this.#listener);
  }
  async #acceptLoop(listener) {
    try {
      for await (const conn of listener) {
        if (this.#stopped) {
          try {
            conn.close();
          } catch {
          }
          return;
        }
        this.#adopt(conn);
      }
    } catch {
    }
  }
  #adopt(conn) {
    const client = new SailClient({
      conn,
      game: this.game,
      log: this.#deps.log,
      ...this.#deps.clientOptions,
      onHook: (hook) => this.#deps.onHook?.(this.game, hook),
      onClose: () => {
        if (!this.#clients.delete(client)) return;
        this.#deps.log?.info(`[sail:${this.game}] game disconnected`);
        this.#deps.onDisconnect?.(client);
      }
    });
    this.#clients.add(client);
    this.#deps.log?.info(`[sail:${this.game}] game connected`);
    const hooks = this.#deps.autoSubscribe ?? (this.game === "2s2h" ? TS2H_DEFAULT_HOOKS : []);
    if (hooks.length > 0) void this.#subscribeAll(client, hooks);
    this.#deps.onConnect?.(client);
  }
  async #subscribeAll(client, hooks) {
    for (const hook of hooks) {
      if (client.closed) return;
      const status = await client.subscribe(hook);
      if (status !== "success") {
        this.#deps.log?.warn(`[sail:${this.game}] subscribe ${hook} \u2192 ${status}`);
      }
    }
  }
  /** Close the listener and every connection, freeing the port. */
  stop() {
    this.#stopped = true;
    const listener = this.#listener;
    this.#listener = void 0;
    try {
      listener?.close();
    } catch {
    }
    for (const client of [
      ...this.#clients
    ]) client.close();
    this.#clients.clear();
  }
};

// src/spawn.ts
var SPAWN_VERBS = [
  "spawn",
  "safespawn",
  "spawnfwd"
];
function parseActorId(raw) {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const n = /^0x/i.test(s) ? parseInt(s.slice(2), 16) : Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function buildSpawnCommand(verb, actorId, params) {
  const v = SPAWN_VERBS.includes(verb) ? verb : "spawn";
  const extra = params.trim();
  return extra ? `${v} ${actorId} ${extra}` : `${v} ${actorId}`;
}
var SPAWN_EFFECTS = [
  "SpawnEnemyWithOffset",
  "SpawnActor"
];
var SPAWN_MECHANISMS = [
  ...SPAWN_VERBS,
  ...SPAWN_EFFECTS
];
function buildSpawnPacket(verb, actorId, params) {
  if (!SPAWN_EFFECTS.includes(verb)) {
    return {
      type: "command",
      command: buildSpawnCommand(verb, actorId, params)
    };
  }
  const extra = Number.parseInt(params.trim(), 10);
  return {
    type: "effect",
    effect: {
      type: "apply",
      name: verb,
      parameters: [
        actorId,
        Number.isFinite(extra) ? extra : 0
      ]
    }
  };
}
var SpawnConfirmer = class {
  #waiters = [];
  #setTimer;
  #clearTimer;
  constructor(timers) {
    this.#setTimer = timers?.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.#clearTimer = timers?.clearTimer ?? ((h) => clearTimeout(h));
  }
  get pending() {
    return this.#waiters.length;
  }
  /** Wait for an OnActorInit matching (game, actorId) within timeoutMs. */
  await(game, actorId, timeoutMs) {
    let done = false;
    let timer;
    const waiter = {
      game,
      actorId,
      settle: () => {
      }
    };
    const confirmed = new Promise((resolve) => {
      waiter.settle = (value) => {
        if (done) return;
        done = true;
        this.#clearTimer(timer);
        this.#remove(waiter);
        resolve(value);
      };
      timer = this.#setTimer(() => waiter.settle(false), timeoutMs);
    });
    this.#waiters.push(waiter);
    return {
      confirmed,
      cancel: () => waiter.settle(false)
    };
  }
  /** Feed a hook; an OnActorInit confirms the oldest matching waiter. */
  deliver(game, hook) {
    if (hook.type !== "OnActorInit") return;
    const actorId = Number(hook.actorId);
    if (!Number.isInteger(actorId)) return;
    const waiter = this.#waiters.find((w) => w.game === game && w.actorId === actorId);
    waiter?.settle(true);
  }
  /** Fail every in-flight wait (teardown). */
  cancelAll() {
    for (const waiter of [
      ...this.#waiters
    ]) waiter.settle(false);
  }
  #remove(waiter) {
    const idx = this.#waiters.indexOf(waiter);
    if (idx !== -1) this.#waiters.splice(idx, 1);
  }
};
var Spawner = class {
  #dispatch;
  #confirmer;
  // 2S2H doesn't push OnActorInit by default (too chatty), so we subscribe to
  // it filtered to the actor id, and unsubscribe when the last concurrent spawn
  // of that id finishes. Refcounted per actor id.
  #s2hSubs = /* @__PURE__ */ new Map();
  constructor(dispatch, confirmer2) {
    this.#dispatch = dispatch;
    this.#confirmer = confirmer2;
  }
  /** Spawn one actor on one game; resolves true only if it was confirmed. */
  async spawn(game, actorId, opts) {
    const packet = buildSpawnPacket(opts.verb ?? "spawn", actorId, opts.extra ?? "");
    if (!opts.confirm) {
      const status = await this.#dispatch.send(game, packet);
      return status === "success";
    }
    if (game === "2s2h") await this.#acquire2s2h(actorId);
    try {
      const wait = this.#confirmer.await(game, actorId, opts.windowMs);
      const status = await this.#dispatch.send(game, packet);
      if (status !== "success") {
        wait.cancel();
        return false;
      }
      return await wait.confirmed;
    } finally {
      if (game === "2s2h") await this.#release2s2h(actorId);
    }
  }
  async #acquire2s2h(actorId) {
    const count = this.#s2hSubs.get(actorId) ?? 0;
    this.#s2hSubs.set(actorId, count + 1);
    if (count === 0) {
      await this.#dispatch.send("2s2h", {
        type: "subscribe",
        eventName: "OnActorInit",
        eventIdFilter: actorId
      });
    }
  }
  async #release2s2h(actorId) {
    const count = (this.#s2hSubs.get(actorId) ?? 1) - 1;
    if (count <= 0) {
      this.#s2hSubs.delete(actorId);
      await this.#dispatch.send("2s2h", {
        type: "unsubscribe",
        eventName: "OnActorInit",
        eventIdFilter: actorId
      });
    } else {
      this.#s2hSubs.set(actorId, count);
    }
  }
};
var ok2 = (out) => ({
  ok: true,
  out
});
var fail2 = (error) => ({
  ok: false,
  error
});
function buildSpawnFunction(deps) {
  const { dispatch, spawner } = deps;
  const isConnected = (game) => dispatch.connected(game);
  return {
    id: "spawn",
    name: "Spawn an actor",
    description: "Spawn an actor by id and confirm it appeared (via OnActorInit) before charging. No confirmation \u2192 the viewer is refunded.",
    requires: {
      account: "none"
    },
    params: [
      targetParam(),
      {
        key: "actorId",
        label: "Actor (id, 0x-hex, or catalog key)",
        type: "string",
        required: true
      },
      {
        key: "verb",
        label: "Spawn command for 2S2H",
        type: "select",
        options: [
          ...SPAWN_VERBS
        ],
        default: "safespawn"
      },
      {
        // Both games now have the custom `safespawn` (SoH 9.2.3 was patched to
        // match 2S2H), so the default is the same on each. SoH keeps its own
        // field because it can also spawn through the Sail effects, which 2S2H
        // stubs — SpawnEnemyWithOffset trades safespawn's object preloading for
        // a floor raycast and upstream's per-actor safety checks.
        key: "soh_verb",
        label: "Spawn mechanism for SoH",
        type: "select",
        options: [
          ...SPAWN_MECHANISMS
        ],
        default: "safespawn"
      },
      {
        key: "params",
        label: "Extra arguments",
        type: "string"
      }
    ],
    run: async (ctx) => {
      const raw = (ctx.params.actorId ?? "").trim();
      const target = readTarget(ctx.params.target);
      const games = liveGames(target, isConnected);
      if (games.length === 0) return fail2(describeOffline(target));
      const literal = parseActorId(raw);
      const entry = literal === null ? deps.catalog?.actorByKey(raw) : void 0;
      if (literal === null && !entry) {
        return fail2(`"${raw}" is not an actor id`);
      }
      const targets = games.map((game) => ({
        game,
        actorId: literal ?? deps.catalog.actorId(entry, game)
      })).filter((t) => t.actorId !== void 0);
      if (targets.length === 0) {
        return fail2(`${entry?.name ?? raw} isn't in the connected game`);
      }
      const verbFor = (game) => game === "soh" ? ctx.params.soh_verb || "safespawn" : ctx.params.verb || "safespawn";
      const opts = {
        extra: ctx.params.params ?? "",
        confirm: deps.confirmEnabled(),
        windowMs: deps.windowMs()
      };
      const results = await Promise.all(targets.map((t) => spawner.spawn(t.game, t.actorId, {
        ...opts,
        verb: verbFor(t.game)
      })));
      if (!results.every(Boolean)) {
        return fail2(deps.confirmEnabled() ? `spawn not confirmed within ${deps.windowMs()}ms` : "the spawn wasn't accepted");
      }
      return ok2({
        actorId: targets[0].actorId,
        name: entry?.name ?? raw,
        games: targets.map((t) => t.game).join(","),
        confirmed: targets.length
      });
    }
  };
}

// src/fuzzy.ts
function normalize(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function fuzzyResolve(query, entries, nameOf, limit = 3) {
  const q = normalize(query);
  if (!q) return {
    kind: "none"
  };
  const scored = entries.map((entry) => ({
    entry,
    name: normalize(nameOf(entry))
  }));
  const exact = scored.filter((s) => s.name === q);
  if (exact.length === 1) return {
    kind: "match",
    entry: exact[0].entry
  };
  if (exact.length > 1) {
    return {
      kind: "suggest",
      entries: exact.slice(0, limit).map((s) => s.entry)
    };
  }
  const strong = scored.filter((s) => s.name.startsWith(q) || s.name.split(" ").includes(q));
  if (strong.length === 1) return {
    kind: "match",
    entry: strong[0].entry
  };
  if (strong.length > 1) {
    const byShortest = strong.sort((a, b) => a.name.length - b.name.length).slice(0, limit).map((s) => s.entry);
    return {
      kind: "suggest",
      entries: byShortest
    };
  }
  const near = scored.map((s) => ({
    entry: s.entry,
    sim: similarity(q, s.name)
  })).filter((s) => s.sim >= 0.6).sort((a, b) => b.sim - a.sim).slice(0, limit).map((s) => s.entry);
  return near.length > 0 ? {
    kind: "suggest",
    entries: near
  } : {
    kind: "none"
  };
}
function similarity(a, b) {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({
    length: n + 1
  }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [
      curr,
      prev
    ];
  }
  return prev[n];
}

// src/catalog.data.ts
var BUNDLED_CATALOG = {
  "actors": [
    {
      "key": "ACTOR_EN_GAKUFU",
      "name": "2d song button",
      "kind": "actor",
      "s2h": 470
    },
    {
      "key": "ACTOR_OBJ_YADO",
      "name": "2nd floor window",
      "kind": "actor",
      "s2h": 660
    },
    {
      "key": "ACTOR_EN_RU",
      "name": "adult ruto",
      "kind": "actor",
      "s2h": 105
    },
    {
      "key": "ACTOR_EN_INVADEPOH",
      "name": "alien",
      "kind": "actor",
      "s2h": 512
    },
    {
      "key": "ACTOR_EN_INVADEPOH_DEMO",
      "name": "alien cs actor",
      "kind": "actor",
      "s2h": 666
    },
    {
      "key": "ACTOR_EN_AN",
      "name": "anju",
      "kind": "actor",
      "s2h": 514
    },
    {
      "key": "ACTOR_EN_AND",
      "name": "anju",
      "kind": "actor",
      "s2h": 665
    },
    {
      "key": "ACTOR_DM_AN",
      "name": "anju",
      "kind": "actor",
      "s2h": 670
    },
    {
      "key": "ACTOR_EN_NB",
      "name": "anju s grandma",
      "kind": "actor",
      "s2h": 579,
      "soh": 195
    },
    {
      "key": "ACTOR_DM_NB",
      "name": "anju s grandma",
      "kind": "actor",
      "s2h": 672
    },
    {
      "key": "ACTOR_EN_AH",
      "name": "anju s mother",
      "kind": "actor",
      "s2h": 595
    },
    {
      "key": "ACTOR_DM_AH",
      "name": "anju s mother",
      "kind": "actor",
      "s2h": 671
    },
    {
      "key": "ACTOR_EN_ANUBICE",
      "name": "anubice",
      "kind": "enemy",
      "soh": 224
    },
    {
      "key": "ACTOR_EN_ANUBICE_FIRE",
      "name": "anubice fire",
      "kind": "enemy",
      "soh": 225
    },
    {
      "key": "ACTOR_EN_ANUBICE_TAG",
      "name": "anubice tag",
      "kind": "actor",
      "soh": 246
    },
    {
      "key": "ACTOR_EN_AM",
      "name": "armos",
      "kind": "enemy",
      "s2h": 50,
      "soh": 84
    },
    {
      "key": "ACTOR_EN_AROW_TRAP",
      "name": "arow trap",
      "kind": "actor",
      "soh": 129
    },
    {
      "key": "ACTOR_EN_ARROW",
      "name": "arrow deku nut",
      "kind": "actor",
      "s2h": 15,
      "soh": 22
    },
    {
      "key": "ACTOR_EN_ATTACK_NIW",
      "name": "attacking cucco",
      "kind": "enemy",
      "s2h": 170,
      "soh": 324
    },
    {
      "key": "ACTOR_EN_GE3",
      "name": "aviel",
      "kind": "actor",
      "s2h": 250,
      "soh": 464
    },
    {
      "key": "ACTOR_EN_BA",
      "name": "ba",
      "kind": "enemy",
      "soh": 222
    },
    {
      "key": "ACTOR_EN_BAT",
      "name": "bad bat",
      "kind": "enemy",
      "s2h": 347
    },
    {
      "key": "ACTOR_EN_GINKO_MAN",
      "name": "bank teller",
      "kind": "actor",
      "s2h": 375
    },
    {
      "key": "ACTOR_EN_BDFIRE",
      "name": "bdfire",
      "kind": "enemy",
      "soh": 48
    },
    {
      "key": "ACTOR_EN_VM",
      "name": "beamos",
      "kind": "enemy",
      "s2h": 71,
      "soh": 138
    },
    {
      "key": "ACTOR_EN_MS",
      "name": "bean seller",
      "kind": "actor",
      "s2h": 165,
      "soh": 318
    },
    {
      "key": "ACTOR_EN_AZ",
      "name": "beaver bro",
      "kind": "actor",
      "s2h": 397
    },
    {
      "key": "ACTOR_EN_TWIG",
      "name": "beaver race ring",
      "kind": "actor",
      "s2h": 421
    },
    {
      "key": "ACTOR_OBJ_COMB",
      "name": "beehive",
      "kind": "actor",
      "s2h": 228,
      "soh": 414
    },
    {
      "key": "ACTOR_BG_BDAN_OBJECTS",
      "name": "bg bdan objects",
      "kind": "actor",
      "soh": 200
    },
    {
      "key": "ACTOR_BG_BDAN_SWITCH",
      "name": "bg bdan switch",
      "kind": "actor",
      "soh": 230
    },
    {
      "key": "ACTOR_BG_BOM_GUARD",
      "name": "bg bom guard",
      "kind": "actor",
      "soh": 421
    },
    {
      "key": "ACTOR_BG_BOMBWALL",
      "name": "bg bombwall",
      "kind": "actor",
      "soh": 208
    },
    {
      "key": "ACTOR_BG_BOWL_WALL",
      "name": "bg bowl wall",
      "kind": "actor",
      "soh": 445
    },
    {
      "key": "ACTOR_BG_DDAN_JD",
      "name": "bg ddan jd",
      "kind": "actor",
      "soh": 88
    },
    {
      "key": "ACTOR_BG_DDAN_KD",
      "name": "bg ddan kd",
      "kind": "actor",
      "soh": 92
    },
    {
      "key": "ACTOR_BG_DODOAGO",
      "name": "bg dodoago",
      "kind": "actor",
      "soh": 63
    },
    {
      "key": "ACTOR_DEMO_KANKYO",
      "name": "bg effect",
      "kind": "actor",
      "s2h": 73,
      "soh": 140
    },
    {
      "key": "ACTOR_BG_GANON_OTYUKA",
      "name": "bg ganon otyuka",
      "kind": "actor",
      "soh": 262
    },
    {
      "key": "ACTOR_BG_GATE_SHUTTER",
      "name": "bg gate shutter",
      "kind": "actor",
      "soh": 256
    },
    {
      "key": "ACTOR_BG_GJYO_BRIDGE",
      "name": "bg gjyo bridge",
      "kind": "actor",
      "soh": 328
    },
    {
      "key": "ACTOR_BG_GND_DARKMEIRO",
      "name": "bg gnd darkmeiro",
      "kind": "actor",
      "soh": 436
    },
    {
      "key": "ACTOR_BG_GND_FIREMEIRO",
      "name": "bg gnd firemeiro",
      "kind": "actor",
      "soh": 435
    },
    {
      "key": "ACTOR_BG_GND_ICEBLOCK",
      "name": "bg gnd iceblock",
      "kind": "actor",
      "soh": 439
    },
    {
      "key": "ACTOR_BG_GND_NISEKABE",
      "name": "bg gnd nisekabe",
      "kind": "actor",
      "soh": 438
    },
    {
      "key": "ACTOR_BG_GND_SOULMEIRO",
      "name": "bg gnd soulmeiro",
      "kind": "actor",
      "soh": 437
    },
    {
      "key": "ACTOR_BG_HAKA",
      "name": "bg haka",
      "kind": "actor",
      "soh": 157
    },
    {
      "key": "ACTOR_BG_HAKA_GATE",
      "name": "bg haka gate",
      "kind": "actor",
      "soh": 247
    },
    {
      "key": "ACTOR_BG_HAKA_HUTA",
      "name": "bg haka huta",
      "kind": "actor",
      "soh": 189
    },
    {
      "key": "ACTOR_BG_HAKA_MEGANE",
      "name": "bg haka megane",
      "kind": "actor",
      "soh": 174
    },
    {
      "key": "ACTOR_BG_HAKA_MEGANEBG",
      "name": "bg haka meganebg",
      "kind": "actor",
      "soh": 175
    },
    {
      "key": "ACTOR_BG_HAKA_SGAMI",
      "name": "bg haka sgami",
      "kind": "actor",
      "soh": 177
    },
    {
      "key": "ACTOR_BG_HAKA_SHIP",
      "name": "bg haka ship",
      "kind": "actor",
      "soh": 176
    },
    {
      "key": "ACTOR_BG_HAKA_TRAP",
      "name": "bg haka trap",
      "kind": "actor",
      "soh": 188
    },
    {
      "key": "ACTOR_BG_HAKA_TUBO",
      "name": "bg haka tubo",
      "kind": "actor",
      "soh": 187
    },
    {
      "key": "ACTOR_BG_HAKA_WATER",
      "name": "bg haka water",
      "kind": "actor",
      "soh": 215
    },
    {
      "key": "ACTOR_BG_HAKA_ZOU",
      "name": "bg haka zou",
      "kind": "actor",
      "soh": 190
    },
    {
      "key": "ACTOR_BG_HEAVY_BLOCK",
      "name": "bg heavy block",
      "kind": "actor",
      "soh": 146
    },
    {
      "key": "ACTOR_BG_HIDAN_CURTAIN",
      "name": "bg hidan curtain",
      "kind": "actor",
      "soh": 73
    },
    {
      "key": "ACTOR_BG_HIDAN_DALM",
      "name": "bg hidan dalm",
      "kind": "actor",
      "soh": 64
    },
    {
      "key": "ACTOR_BG_HIDAN_FIREWALL",
      "name": "bg hidan firewall",
      "kind": "actor",
      "soh": 12
    },
    {
      "key": "ACTOR_BG_HIDAN_FSLIFT",
      "name": "bg hidan fslift",
      "kind": "actor",
      "soh": 78
    },
    {
      "key": "ACTOR_BG_HIDAN_FWBIG",
      "name": "bg hidan fwbig",
      "kind": "actor",
      "soh": 141
    },
    {
      "key": "ACTOR_BG_HIDAN_HAMSTEP",
      "name": "bg hidan hamstep",
      "kind": "actor",
      "soh": 113
    },
    {
      "key": "ACTOR_BG_HIDAN_HROCK",
      "name": "bg hidan hrock",
      "kind": "actor",
      "soh": 65
    },
    {
      "key": "ACTOR_BG_HIDAN_KOUSI",
      "name": "bg hidan kousi",
      "kind": "actor",
      "soh": 111
    },
    {
      "key": "ACTOR_BG_HIDAN_KOWARERUKABE",
      "name": "bg hidan kowarerukabe",
      "kind": "actor",
      "soh": 207
    },
    {
      "key": "ACTOR_BG_HIDAN_ROCK",
      "name": "bg hidan rock",
      "kind": "actor",
      "soh": 67
    },
    {
      "key": "ACTOR_BG_HIDAN_RSEKIZOU",
      "name": "bg hidan rsekizou",
      "kind": "actor",
      "soh": 68
    },
    {
      "key": "ACTOR_BG_HIDAN_SEKIZOU",
      "name": "bg hidan sekizou",
      "kind": "actor",
      "soh": 69
    },
    {
      "key": "ACTOR_BG_HIDAN_SIMA",
      "name": "bg hidan sima",
      "kind": "actor",
      "soh": 70
    },
    {
      "key": "ACTOR_BG_HIDAN_SYOKU",
      "name": "bg hidan syoku",
      "kind": "actor",
      "soh": 71
    },
    {
      "key": "ACTOR_BG_ICE_OBJECTS",
      "name": "bg ice objects",
      "kind": "actor",
      "soh": 214
    },
    {
      "key": "ACTOR_BG_ICE_SHELTER",
      "name": "bg ice shelter",
      "kind": "actor",
      "soh": 239
    },
    {
      "key": "ACTOR_BG_ICE_SHUTTER",
      "name": "bg ice shutter",
      "kind": "actor",
      "soh": 456
    },
    {
      "key": "ACTOR_BG_ICE_TURARA",
      "name": "bg ice turara",
      "kind": "actor",
      "soh": 455
    },
    {
      "key": "ACTOR_BG_JYA_1FLIFT",
      "name": "bg jya 1flift",
      "kind": "actor",
      "soh": 398
    },
    {
      "key": "ACTOR_BG_JYA_AMISHUTTER",
      "name": "bg jya amishutter",
      "kind": "actor",
      "soh": 346
    },
    {
      "key": "ACTOR_BG_JYA_BIGMIRROR",
      "name": "bg jya bigmirror",
      "kind": "actor",
      "soh": 344
    },
    {
      "key": "ACTOR_BG_JYA_BLOCK",
      "name": "bg jya block",
      "kind": "actor",
      "soh": 469
    },
    {
      "key": "ACTOR_BG_JYA_BOMBCHUIWA",
      "name": "bg jya bombchuiwa",
      "kind": "actor",
      "soh": 345
    },
    {
      "key": "ACTOR_BG_JYA_BOMBIWA",
      "name": "bg jya bombiwa",
      "kind": "actor",
      "soh": 347
    },
    {
      "key": "ACTOR_BG_JYA_COBRA",
      "name": "bg jya cobra",
      "kind": "actor",
      "soh": 252
    },
    {
      "key": "ACTOR_BG_JYA_GOROIWA",
      "name": "bg jya goroiwa",
      "kind": "actor",
      "soh": 249
    },
    {
      "key": "ACTOR_BG_JYA_HAHENIRON",
      "name": "bg jya haheniron",
      "kind": "actor",
      "soh": 399
    },
    {
      "key": "ACTOR_BG_JYA_IRONOBJ",
      "name": "bg jya ironobj",
      "kind": "actor",
      "soh": 361
    },
    {
      "key": "ACTOR_BG_JYA_KANAAMI",
      "name": "bg jya kanaami",
      "kind": "actor",
      "soh": 253
    },
    {
      "key": "ACTOR_BG_JYA_LIFT",
      "name": "bg jya lift",
      "kind": "actor",
      "soh": 343
    },
    {
      "key": "ACTOR_BG_JYA_MEGAMI",
      "name": "bg jya megami",
      "kind": "actor",
      "soh": 342
    },
    {
      "key": "ACTOR_BG_JYA_ZURERUKABE",
      "name": "bg jya zurerukabe",
      "kind": "actor",
      "soh": 250
    },
    {
      "key": "ACTOR_BG_MENKURI_EYE",
      "name": "bg menkuri eye",
      "kind": "actor",
      "soh": 98
    },
    {
      "key": "ACTOR_BG_MENKURI_KAITEN",
      "name": "bg menkuri kaiten",
      "kind": "actor",
      "soh": 97
    },
    {
      "key": "ACTOR_BG_MENKURI_NISEKABE",
      "name": "bg menkuri nisekabe",
      "kind": "actor",
      "soh": 461
    },
    {
      "key": "ACTOR_BG_MIZU_BWALL",
      "name": "bg mizu bwall",
      "kind": "actor",
      "soh": 442
    },
    {
      "key": "ACTOR_BG_MIZU_MOVEBG",
      "name": "bg mizu movebg",
      "kind": "actor",
      "soh": 100
    },
    {
      "key": "ACTOR_BG_MIZU_SHUTTER",
      "name": "bg mizu shutter",
      "kind": "actor",
      "soh": 443
    },
    {
      "key": "ACTOR_BG_MIZU_UZU",
      "name": "bg mizu uzu",
      "kind": "actor",
      "soh": 212
    },
    {
      "key": "ACTOR_BG_MIZU_WATER",
      "name": "bg mizu water",
      "kind": "actor",
      "soh": 101
    },
    {
      "key": "ACTOR_BG_MJIN",
      "name": "bg mjin",
      "kind": "actor",
      "soh": 110
    },
    {
      "key": "ACTOR_BG_MORI_BIGST",
      "name": "bg mori bigst",
      "kind": "actor",
      "soh": 134
    },
    {
      "key": "ACTOR_BG_MORI_ELEVATOR",
      "name": "bg mori elevator",
      "kind": "actor",
      "soh": 135
    },
    {
      "key": "ACTOR_BG_MORI_HASHIGO",
      "name": "bg mori hashigo",
      "kind": "actor",
      "soh": 226
    },
    {
      "key": "ACTOR_BG_MORI_HASHIRA4",
      "name": "bg mori hashira4",
      "kind": "actor",
      "soh": 227
    },
    {
      "key": "ACTOR_BG_MORI_HINERI",
      "name": "bg mori hineri",
      "kind": "actor",
      "soh": 104
    },
    {
      "key": "ACTOR_BG_MORI_IDOMIZU",
      "name": "bg mori idomizu",
      "kind": "actor",
      "soh": 228
    },
    {
      "key": "ACTOR_BG_MORI_KAITENKABE",
      "name": "bg mori kaitenkabe",
      "kind": "actor",
      "soh": 136
    },
    {
      "key": "ACTOR_BG_MORI_RAKKATENJO",
      "name": "bg mori rakkatenjo",
      "kind": "actor",
      "soh": 137
    },
    {
      "key": "ACTOR_BG_PO_EVENT",
      "name": "bg po event",
      "kind": "actor",
      "soh": 147
    },
    {
      "key": "ACTOR_BG_PO_SYOKUDAI",
      "name": "bg po syokudai",
      "kind": "actor",
      "soh": 261
    },
    {
      "key": "ACTOR_BG_PUSHBOX",
      "name": "bg pushbox",
      "kind": "actor",
      "soh": 44
    },
    {
      "key": "ACTOR_BG_RELAY_OBJECTS",
      "name": "bg relay objects",
      "kind": "actor",
      "soh": 291
    },
    {
      "key": "ACTOR_BG_SPOT00_BREAK",
      "name": "bg spot00 break",
      "kind": "actor",
      "soh": 404
    },
    {
      "key": "ACTOR_BG_SPOT00_HANEBASI",
      "name": "bg spot00 hanebasi",
      "kind": "actor",
      "soh": 74
    },
    {
      "key": "ACTOR_BG_SPOT01_FUSYA",
      "name": "bg spot01 fusya",
      "kind": "actor",
      "soh": 258
    },
    {
      "key": "ACTOR_BG_SPOT01_IDOHASHIRA",
      "name": "bg spot01 idohashira",
      "kind": "actor",
      "soh": 259
    },
    {
      "key": "ACTOR_BG_SPOT01_IDOMIZU",
      "name": "bg spot01 idomizu",
      "kind": "actor",
      "soh": 260
    },
    {
      "key": "ACTOR_BG_SPOT01_IDOSOKO",
      "name": "bg spot01 idosoko",
      "kind": "actor",
      "soh": 325
    },
    {
      "key": "ACTOR_BG_SPOT01_OBJECTS2",
      "name": "bg spot01 objects2",
      "kind": "actor",
      "soh": 413
    },
    {
      "key": "ACTOR_BG_SPOT02_OBJECTS",
      "name": "bg spot02 objects",
      "kind": "actor",
      "soh": 156
    },
    {
      "key": "ACTOR_BG_SPOT03_TAKI",
      "name": "bg spot03 taki",
      "kind": "actor",
      "soh": 287
    },
    {
      "key": "ACTOR_BG_SPOT05_SOKO",
      "name": "bg spot05 soko",
      "kind": "actor",
      "soh": 397
    },
    {
      "key": "ACTOR_BG_SPOT06_OBJECTS",
      "name": "bg spot06 objects",
      "kind": "actor",
      "soh": 213
    },
    {
      "key": "ACTOR_BG_SPOT07_TAKI",
      "name": "bg spot07 taki",
      "kind": "actor",
      "soh": 288
    },
    {
      "key": "ACTOR_BG_SPOT08_BAKUDANKABE",
      "name": "bg spot08 bakudankabe",
      "kind": "actor",
      "soh": 424
    },
    {
      "key": "ACTOR_BG_SPOT08_ICEBLOCK",
      "name": "bg spot08 iceblock",
      "kind": "actor",
      "soh": 209
    },
    {
      "key": "ACTOR_BG_SPOT09_OBJ",
      "name": "bg spot09 obj",
      "kind": "actor",
      "soh": 184
    },
    {
      "key": "ACTOR_BG_SPOT11_BAKUDANKABE",
      "name": "bg spot11 bakudankabe",
      "kind": "actor",
      "soh": 415
    },
    {
      "key": "ACTOR_BG_SPOT11_OASIS",
      "name": "bg spot11 oasis",
      "kind": "actor",
      "soh": 450
    },
    {
      "key": "ACTOR_BG_SPOT12_GATE",
      "name": "bg spot12 gate",
      "kind": "actor",
      "soh": 400
    },
    {
      "key": "ACTOR_BG_SPOT12_SAKU",
      "name": "bg spot12 saku",
      "kind": "actor",
      "soh": 401
    },
    {
      "key": "ACTOR_BG_SPOT15_RRBOX",
      "name": "bg spot15 rrbox",
      "kind": "actor",
      "soh": 263
    },
    {
      "key": "ACTOR_BG_SPOT15_SAKU",
      "name": "bg spot15 saku",
      "kind": "actor",
      "soh": 248
    },
    {
      "key": "ACTOR_BG_SPOT16_BOMBSTONE",
      "name": "bg spot16 bombstone",
      "kind": "actor",
      "soh": 205
    },
    {
      "key": "ACTOR_BG_SPOT16_DOUGHNUT",
      "name": "bg spot16 doughnut",
      "kind": "actor",
      "soh": 229
    },
    {
      "key": "ACTOR_BG_SPOT17_BAKUDANKABE",
      "name": "bg spot17 bakudankabe",
      "kind": "actor",
      "soh": 425
    },
    {
      "key": "ACTOR_BG_SPOT17_FUNEN",
      "name": "bg spot17 funen",
      "kind": "actor",
      "soh": 191
    },
    {
      "key": "ACTOR_BG_SPOT18_BASKET",
      "name": "bg spot18 basket",
      "kind": "actor",
      "soh": 348
    },
    {
      "key": "ACTOR_BG_SPOT18_FUTA",
      "name": "bg spot18 futa",
      "kind": "actor",
      "soh": 451
    },
    {
      "key": "ACTOR_BG_SPOT18_OBJ",
      "name": "bg spot18 obj",
      "kind": "actor",
      "soh": 185
    },
    {
      "key": "ACTOR_BG_SPOT18_SHUTTER",
      "name": "bg spot18 shutter",
      "kind": "actor",
      "soh": 452
    },
    {
      "key": "ACTOR_BG_SST_FLOOR",
      "name": "bg sst floor",
      "kind": "actor",
      "soh": 358
    },
    {
      "key": "ACTOR_BG_TOKI_HIKARI",
      "name": "bg toki hikari",
      "kind": "actor",
      "soh": 106
    },
    {
      "key": "ACTOR_BG_TOKI_SWD",
      "name": "bg toki swd",
      "kind": "actor",
      "soh": 108
    },
    {
      "key": "ACTOR_BG_TREEMOUTH",
      "name": "bg treemouth",
      "kind": "actor",
      "soh": 62
    },
    {
      "key": "ACTOR_BG_VB_SIMA",
      "name": "bg vb sima",
      "kind": "actor",
      "soh": 172
    },
    {
      "key": "ACTOR_BG_YDAN_HASI",
      "name": "bg ydan hasi",
      "kind": "actor",
      "soh": 80
    },
    {
      "key": "ACTOR_BG_YDAN_MARUTA",
      "name": "bg ydan maruta",
      "kind": "actor",
      "soh": 81
    },
    {
      "key": "ACTOR_BG_YDAN_SP",
      "name": "bg ydan sp",
      "kind": "actor",
      "soh": 15
    },
    {
      "key": "ACTOR_BG_ZG",
      "name": "bg zg",
      "kind": "actor",
      "soh": 375
    },
    {
      "key": "ACTOR_EN_BIGOKUTA",
      "name": "big octo",
      "kind": "boss",
      "s2h": 424,
      "soh": 198
    },
    {
      "key": "ACTOR_EN_BIGPO",
      "name": "big poe",
      "kind": "enemy",
      "s2h": 520
    },
    {
      "key": "ACTOR_BG_NUMA_HANA",
      "name": "big wooden flower",
      "kind": "actor",
      "s2h": 317
    },
    {
      "key": "ACTOR_EN_DAI",
      "name": "biggoron",
      "kind": "actor",
      "s2h": 509
    },
    {
      "key": "ACTOR_EN_BILI",
      "name": "bili",
      "kind": "enemy",
      "soh": 52
    },
    {
      "key": "ACTOR_BOSS_05",
      "name": "bio deku baba",
      "kind": "enemy",
      "s2h": 301
    },
    {
      "key": "ACTOR_EN_BIRD",
      "name": "bird",
      "kind": "actor",
      "soh": 114
    },
    {
      "key": "ACTOR_EN_MKK",
      "name": "black white boe",
      "kind": "enemy",
      "s2h": 356
    },
    {
      "key": "ACTOR_OBJ_TOGE",
      "name": "blade trap",
      "kind": "actor",
      "s2h": 259
    },
    {
      "key": "ACTOR_EN_BLKOBJ",
      "name": "blkobj",
      "kind": "actor",
      "soh": 310
    },
    {
      "key": "ACTOR_EN_BB",
      "name": "blue bubble",
      "kind": "enemy",
      "s2h": 62,
      "soh": 105
    },
    {
      "key": "ACTOR_EN_BOMBERS",
      "name": "blue hatted bomber",
      "kind": "actor",
      "s2h": 640
    },
    {
      "key": "ACTOR_DOOR_WARP1",
      "name": "blue warp portal crystal majora s mask boss warp platform",
      "kind": "actor",
      "s2h": 56,
      "soh": 93
    },
    {
      "key": "ACTOR_EN_JC_MATO",
      "name": "boat cruise target",
      "kind": "actor",
      "s2h": 559
    },
    {
      "key": "ACTOR_EN_BOJ_01",
      "name": "boj 01",
      "kind": "actor",
      "s2h": 280
    },
    {
      "key": "ACTOR_EN_BOJ_02",
      "name": "boj 02",
      "kind": "actor",
      "s2h": 281
    },
    {
      "key": "ACTOR_EN_BOJ_03",
      "name": "boj 03",
      "kind": "actor",
      "s2h": 282
    },
    {
      "key": "ACTOR_EN_BOJ_04",
      "name": "boj 04",
      "kind": "actor",
      "s2h": 289
    },
    {
      "key": "ACTOR_EN_BOJ_05",
      "name": "boj 05",
      "kind": "actor",
      "s2h": 306
    },
    {
      "key": "ACTOR_EN_BOM_BOWL_PIT",
      "name": "bom bowl pit",
      "kind": "actor",
      "soh": 332
    },
    {
      "key": "ACTOR_EN_FU_KAGO",
      "name": "bomb basket",
      "kind": "actor",
      "s2h": 436
    },
    {
      "key": "ACTOR_EN_BOMBF",
      "name": "bomb flower",
      "kind": "actor",
      "s2h": 47,
      "soh": 76
    },
    {
      "key": "ACTOR_EN_BOM",
      "name": "bomb powder keg",
      "kind": "actor",
      "s2h": 9,
      "soh": 16
    },
    {
      "key": "ACTOR_EN_NIMOTSU",
      "name": "bomb shop bag",
      "kind": "actor",
      "s2h": 612
    },
    {
      "key": "ACTOR_EN_BABA",
      "name": "bomb shop lady",
      "kind": "actor",
      "s2h": 566
    },
    {
      "key": "ACTOR_EN_BBA_01",
      "name": "bomb shop lady npc",
      "kind": "actor",
      "s2h": 291
    },
    {
      "key": "ACTOR_EN_RSN",
      "name": "bomb shop man",
      "kind": "actor",
      "s2h": 689
    },
    {
      "key": "ACTOR_OBJ_BOMBIWA",
      "name": "bombable boulder",
      "kind": "actor",
      "s2h": 146,
      "soh": 295
    },
    {
      "key": "ACTOR_BG_LAST_BWALL",
      "name": "bombable climbable wall",
      "kind": "actor",
      "s2h": 664
    },
    {
      "key": "ACTOR_BG_IKANA_BOMBWALL",
      "name": "bombable tan floor file",
      "kind": "actor",
      "s2h": 597
    },
    {
      "key": "ACTOR_BG_HAKUGIN_BOMBWALL",
      "name": "bombable wall",
      "kind": "actor",
      "s2h": 417
    },
    {
      "key": "ACTOR_BG_KIN2_BOMBWALL",
      "name": "bombable wall",
      "kind": "actor",
      "s2h": 526
    },
    {
      "key": "ACTOR_BG_HAKA_BOMBWALL",
      "name": "bombable wall",
      "kind": "actor",
      "s2h": 600
    },
    {
      "key": "ACTOR_BG_ASTR_BOMBWALL",
      "name": "bombable wall",
      "kind": "actor",
      "s2h": 653
    },
    {
      "key": "ACTOR_EN_BOM_CHU",
      "name": "bombchu",
      "kind": "actor",
      "s2h": 106,
      "soh": 218
    },
    {
      "key": "ACTOR_EN_BOMJIMB",
      "name": "bomber",
      "kind": "actor",
      "s2h": 639
    },
    {
      "key": "ACTOR_EN_BOMJIMA",
      "name": "bomber jim",
      "kind": "actor",
      "s2h": 638
    },
    {
      "key": "ACTOR_EN_BOM_BOWL_MAN",
      "name": "bomber line",
      "kind": "actor",
      "s2h": 284,
      "soh": 331
    },
    {
      "key": "ACTOR_DM_HINA",
      "name": "boss mask cutscene object",
      "kind": "actor",
      "s2h": 320
    },
    {
      "key": "ACTOR_OBJ_AQUA",
      "name": "bottle water",
      "kind": "actor",
      "s2h": 431
    },
    {
      "key": "ACTOR_OBJ_FLOWERPOT",
      "name": "breakable pot with grass",
      "kind": "actor",
      "s2h": 318
    },
    {
      "key": "ACTOR_EN_BROB",
      "name": "brob",
      "kind": "enemy",
      "soh": 182
    },
    {
      "key": "ACTOR_OBJ_HAMISHI",
      "name": "bronze boulder",
      "kind": "actor",
      "s2h": 252,
      "soh": 466
    },
    {
      "key": "ACTOR_EN_BH",
      "name": "brown bird",
      "kind": "actor",
      "s2h": 679
    },
    {
      "key": "ACTOR_OBJ_LIFT",
      "name": "brown elevator",
      "kind": "actor",
      "s2h": 149,
      "soh": 300
    },
    {
      "key": "ACTOR_OBJ_MURE",
      "name": "bug insect butterfly spawner",
      "kind": "actor",
      "s2h": 79,
      "soh": 148
    },
    {
      "key": "ACTOR_EN_MUSHI2",
      "name": "bugs from bottle",
      "kind": "actor",
      "s2h": 379
    },
    {
      "key": "ACTOR_EN_SELLNUTS",
      "name": "business scrub",
      "kind": "actor",
      "s2h": 445
    },
    {
      "key": "ACTOR_EN_SCOPENUTS",
      "name": "business scrub",
      "kind": "actor",
      "s2h": 588
    },
    {
      "key": "ACTOR_EN_BUTTE",
      "name": "butterfly",
      "kind": "actor",
      "s2h": 21,
      "soh": 30
    },
    {
      "key": "ACTOR_EN_BW",
      "name": "bw",
      "kind": "enemy",
      "soh": 56
    },
    {
      "key": "ACTOR_EN_BX",
      "name": "bx",
      "kind": "enemy",
      "soh": 223
    },
    {
      "key": "ACTOR_EN_BSB",
      "name": "captain keeta",
      "kind": "actor",
      "s2h": 655
    },
    {
      "key": "ACTOR_EN_RAF",
      "name": "carnivorous lily pad",
      "kind": "actor",
      "s2h": 314
    },
    {
      "key": "ACTOR_EN_DAIKU",
      "name": "carpenter",
      "kind": "actor",
      "s2h": 156,
      "soh": 307
    },
    {
      "key": "ACTOR_EN_ENDING_HERO5",
      "name": "carpenter watching moon",
      "kind": "actor",
      "s2h": 683
    },
    {
      "key": "ACTOR_OBJ_GRASS_CARRY",
      "name": "carried grass from objgrassunit",
      "kind": "actor",
      "s2h": 268
    },
    {
      "key": "ACTOR_BG_HAKUGIN_POST",
      "name": "central pillar",
      "kind": "actor",
      "s2h": 399
    },
    {
      "key": "ACTOR_EN_CHANGER",
      "name": "changer",
      "kind": "actor",
      "soh": 341
    },
    {
      "key": "ACTOR_EN_BOX",
      "name": "chest",
      "kind": "actor",
      "s2h": 6,
      "soh": 10
    },
    {
      "key": "ACTOR_EN_HORSE_LINK_CHILD",
      "name": "child epona",
      "kind": "actor",
      "s2h": 84,
      "soh": 154
    },
    {
      "key": "ACTOR_DM_ZL",
      "name": "child zelda",
      "kind": "actor",
      "s2h": 338
    },
    {
      "key": "ACTOR_EN_SLIME",
      "name": "chuchu",
      "kind": "enemy",
      "s2h": 330
    },
    {
      "key": "ACTOR_OBJ_TOKEIDAI",
      "name": "clock tower component",
      "kind": "actor",
      "s2h": 412
    },
    {
      "key": "ACTOR_OBJ_TOUDAI",
      "name": "clock tower spotlight",
      "kind": "actor",
      "s2h": 332
    },
    {
      "key": "ACTOR_OBJ_TOKEI_TOBIRA",
      "name": "clock tower swinging doors",
      "kind": "actor",
      "s2h": 418
    },
    {
      "key": "ACTOR_OBJ_ENTOTU",
      "name": "clock town smoking chimney",
      "kind": "actor",
      "s2h": 333
    },
    {
      "key": "ACTOR_OBJ_HGDOOR",
      "name": "closet door",
      "kind": "actor",
      "s2h": 596
    },
    {
      "key": "ACTOR_EN_ITEM00",
      "name": "collectibles",
      "kind": "actor",
      "s2h": 14,
      "soh": 21
    },
    {
      "key": "ACTOR_EN_ZOW",
      "name": "complaining water",
      "kind": "actor",
      "s2h": 608
    },
    {
      "key": "ACTOR_EN_MM3",
      "name": "counting game postman",
      "kind": "actor",
      "s2h": 381
    },
    {
      "key": "ACTOR_EN_COW",
      "name": "cow",
      "kind": "actor",
      "s2h": 243,
      "soh": 454
    },
    {
      "key": "ACTOR_OBJ_USIYANE",
      "name": "cow barn roof",
      "kind": "actor",
      "s2h": 648
    },
    {
      "key": "ACTOR_EN_TEST",
      "name": "crater marks",
      "kind": "enemy",
      "s2h": 1,
      "soh": 2
    },
    {
      "key": "ACTOR_EN_MA_YTO",
      "name": "cremia",
      "kind": "actor",
      "s2h": 544
    },
    {
      "key": "ACTOR_OBJ_DINNER",
      "name": "cremia romani s dinner",
      "kind": "actor",
      "s2h": 625
    },
    {
      "key": "ACTOR_OBJ_UM",
      "name": "cremia s cart",
      "kind": "actor",
      "s2h": 533
    },
    {
      "key": "ACTOR_EN_CS",
      "name": "cs",
      "kind": "actor",
      "soh": 364
    },
    {
      "key": "ACTOR_EN_NIW",
      "name": "cucco",
      "kind": "actor",
      "s2h": 17,
      "soh": 25
    },
    {
      "key": "ACTOR_EN_NWC",
      "name": "cucco chick",
      "kind": "actor",
      "s2h": 157,
      "soh": 309
    },
    {
      "key": "ACTOR_EN_FSN",
      "name": "curiosity shop man",
      "kind": "actor",
      "s2h": 452
    },
    {
      "key": "ACTOR_EN_SSH",
      "name": "cursed man",
      "kind": "actor",
      "s2h": 212,
      "soh": 392
    },
    {
      "key": "ACTOR_DM_TAG",
      "name": "cutscene",
      "kind": "actor",
      "s2h": 678
    },
    {
      "key": "ACTOR_EN_VIEWER",
      "name": "cutscene actor",
      "kind": "actor",
      "s2h": 28,
      "soh": 42
    },
    {
      "key": "ACTOR_EN_ENDING_HERO6",
      "name": "cutscene character",
      "kind": "actor",
      "s2h": 684
    },
    {
      "key": "ACTOR_DEMO_EFFECT",
      "name": "cutscene effect",
      "kind": "actor",
      "s2h": 72,
      "soh": 139
    },
    {
      "key": "ACTOR_DM_CHAR05",
      "name": "cutscene mask object",
      "kind": "actor",
      "s2h": 407
    },
    {
      "key": "ACTOR_DEMO_GETITEM",
      "name": "cutscene object for great fairy mask sword",
      "kind": "actor",
      "s2h": 357
    },
    {
      "key": "ACTOR_OBJ_KENDO_KANBAN",
      "name": "cuttable board",
      "kind": "actor",
      "s2h": 521
    },
    {
      "key": "ACTOR_BG_DKJAIL_IVY",
      "name": "cuttable ivy",
      "kind": "actor",
      "s2h": 446
    },
    {
      "key": "ACTOR_EN_DAIKU_KAKARIKO",
      "name": "daiku kakariko",
      "kind": "actor",
      "soh": 444
    },
    {
      "key": "ACTOR_EN_TK",
      "name": "dampe",
      "kind": "actor",
      "s2h": 458,
      "soh": 133
    },
    {
      "key": "ACTOR_EN_GG",
      "name": "darmani s ghost",
      "kind": "actor",
      "s2h": 503
    },
    {
      "key": "ACTOR_EN_GG2",
      "name": "darmani s ghost",
      "kind": "actor",
      "s2h": 506
    },
    {
      "key": "ACTOR_OBJ_GHAKA",
      "name": "darmani s gravestone",
      "kind": "actor",
      "s2h": 507
    },
    {
      "key": "ACTOR_EN_FAMOS",
      "name": "death armos",
      "kind": "enemy",
      "s2h": 45
    },
    {
      "key": "ACTOR_EN_DRAGON",
      "name": "deep python",
      "kind": "enemy",
      "s2h": 518
    },
    {
      "key": "ACTOR_BG_SINKAI_KABE",
      "name": "deep python manager",
      "kind": "actor",
      "s2h": 524
    },
    {
      "key": "ACTOR_EN_PRZ",
      "name": "defeated skullfish",
      "kind": "enemy",
      "s2h": 385
    },
    {
      "key": "ACTOR_EN_DEKUBABA",
      "name": "deku baba",
      "kind": "enemy",
      "s2h": 51,
      "soh": 85
    },
    {
      "key": "ACTOR_EN_DNO",
      "name": "deku butler",
      "kind": "actor",
      "s2h": 383
    },
    {
      "key": "ACTOR_EN_NNH",
      "name": "deku butler s son s corpse",
      "kind": "actor",
      "s2h": 649
    },
    {
      "key": "ACTOR_OBJ_ETCETERA",
      "name": "deku flower",
      "kind": "actor",
      "s2h": 387
    },
    {
      "key": "ACTOR_EN_DNQ",
      "name": "deku king",
      "kind": "actor",
      "s2h": 362
    },
    {
      "key": "ACTOR_DM_CHAR03",
      "name": "deku mask",
      "kind": "actor",
      "s2h": 405
    },
    {
      "key": "ACTOR_EN_M_FIRE1",
      "name": "deku nut effect",
      "kind": "actor",
      "s2h": 52,
      "soh": 86
    },
    {
      "key": "ACTOR_EN_NUTSBALL",
      "name": "deku nut projectile",
      "kind": "actor",
      "s2h": 218,
      "soh": 403
    },
    {
      "key": "ACTOR_EN_GUARD_NUTS",
      "name": "deku palace entrace guard",
      "kind": "actor",
      "s2h": 416
    },
    {
      "key": "ACTOR_EN_DNP",
      "name": "deku princess",
      "kind": "actor",
      "s2h": 508
    },
    {
      "key": "ACTOR_EN_LIFT_NUTS",
      "name": "deku scrub playground employee",
      "kind": "actor",
      "s2h": 457
    },
    {
      "key": "ACTOR_EN_GAMELUPY",
      "name": "deku scrub playground rupee",
      "kind": "actor",
      "s2h": 466
    },
    {
      "key": "ACTOR_EN_LIGHT",
      "name": "deku shrine flames",
      "kind": "actor",
      "s2h": 4,
      "soh": 8
    },
    {
      "key": "ACTOR_DEMO_6K",
      "name": "demo 6k",
      "kind": "actor",
      "soh": 245
    },
    {
      "key": "ACTOR_DEMO_DU",
      "name": "demo du",
      "kind": "actor",
      "soh": 168
    },
    {
      "key": "ACTOR_DEMO_EC",
      "name": "demo ec",
      "kind": "actor",
      "soh": 386
    },
    {
      "key": "ACTOR_DEMO_EXT",
      "name": "demo ext",
      "kind": "actor",
      "soh": 280
    },
    {
      "key": "ACTOR_DEMO_GEFF",
      "name": "demo geff",
      "kind": "boss",
      "soh": 434
    },
    {
      "key": "ACTOR_DEMO_GJ",
      "name": "demo gj",
      "kind": "actor",
      "soh": 433
    },
    {
      "key": "ACTOR_DEMO_GO",
      "name": "demo go",
      "kind": "actor",
      "soh": 202
    },
    {
      "key": "ACTOR_DEMO_GT",
      "name": "demo gt",
      "kind": "actor",
      "soh": 372
    },
    {
      "key": "ACTOR_DEMO_IK",
      "name": "demo ik",
      "kind": "actor",
      "soh": 276
    },
    {
      "key": "ACTOR_DEMO_IM",
      "name": "demo im",
      "kind": "actor",
      "soh": 169
    },
    {
      "key": "ACTOR_DEMO_KEKKAI",
      "name": "demo kekkai",
      "kind": "actor",
      "soh": 423
    },
    {
      "key": "ACTOR_DEMO_SA",
      "name": "demo sa",
      "kind": "actor",
      "soh": 201
    },
    {
      "key": "ACTOR_DEMO_SHD",
      "name": "demoshd",
      "kind": "enemy",
      "s2h": 137,
      "soh": 281
    },
    {
      "key": "ACTOR_EN_PR",
      "name": "desbreko",
      "kind": "enemy",
      "s2h": 331
    },
    {
      "key": "ACTOR_EN_TANRON5",
      "name": "destructible item",
      "kind": "boss",
      "s2h": 616
    },
    {
      "key": "ACTOR_EN_WDHAND",
      "name": "dexihand",
      "kind": "enemy",
      "s2h": 465
    },
    {
      "key": "ACTOR_EN_DH",
      "name": "dh",
      "kind": "enemy",
      "soh": 164
    },
    {
      "key": "ACTOR_EN_DHA",
      "name": "dha",
      "kind": "enemy",
      "soh": 165
    },
    {
      "key": "ACTOR_OBJ_MU_PICT",
      "name": "dialogue handler",
      "kind": "actor",
      "s2h": 644
    },
    {
      "key": "ACTOR_EN_DINOFOS",
      "name": "dinolfos",
      "kind": "enemy",
      "s2h": 25
    },
    {
      "key": "ACTOR_EN_DIVING_GAME",
      "name": "diving game",
      "kind": "actor",
      "soh": 292
    },
    {
      "key": "ACTOR_DM_GM",
      "name": "dm gm",
      "kind": "actor",
      "s2h": 685
    },
    {
      "key": "ACTOR_EN_DNT_DEMO",
      "name": "dnt demo",
      "kind": "actor",
      "soh": 417
    },
    {
      "key": "ACTOR_EN_DNT_JIJI",
      "name": "dnt jiji",
      "kind": "actor",
      "soh": 418
    },
    {
      "key": "ACTOR_EN_DNT_NOMAL",
      "name": "dnt nomal",
      "kind": "actor",
      "soh": 419
    },
    {
      "key": "ACTOR_EN_DODOJR",
      "name": "dodojr",
      "kind": "enemy",
      "soh": 47
    },
    {
      "key": "ACTOR_EN_DODONGO",
      "name": "dodongo",
      "kind": "enemy",
      "s2h": 11,
      "soh": 18
    },
    {
      "key": "ACTOR_BOSS_DODONGO",
      "name": "dodongo",
      "kind": "boss",
      "soh": 39
    },
    {
      "key": "ACTOR_EN_DG",
      "name": "dog",
      "kind": "enemy",
      "s2h": 226
    },
    {
      "key": "ACTOR_EN_DOG",
      "name": "dog",
      "kind": "actor",
      "soh": 411
    },
    {
      "key": "ACTOR_OBJ_TOKEI_STEP",
      "name": "door",
      "kind": "actor",
      "s2h": 440
    },
    {
      "key": "ACTOR_DOOR_GERUDO",
      "name": "door gerudo",
      "kind": "actor",
      "soh": 370
    },
    {
      "key": "ACTOR_DOOR_KILLER",
      "name": "door killer",
      "kind": "actor",
      "soh": 449
    },
    {
      "key": "ACTOR_DOOR_TOKI",
      "name": "door toki",
      "kind": "actor",
      "soh": 112
    },
    {
      "key": "ACTOR_EN_GRASSHOPPER",
      "name": "dragonfly",
      "kind": "enemy",
      "s2h": 265
    },
    {
      "key": "ACTOR_BG_KIN2_SHELF",
      "name": "drawers",
      "kind": "actor",
      "s2h": 529
    },
    {
      "key": "ACTOR_EN_DS",
      "name": "ds",
      "kind": "actor",
      "soh": 329
    },
    {
      "key": "ACTOR_EN_DU",
      "name": "du",
      "kind": "actor",
      "soh": 152
    },
    {
      "key": "ACTOR_EN_BU",
      "name": "dummied out enemy",
      "kind": "enemy",
      "s2h": 273
    },
    {
      "key": "ACTOR_EFF_DUST",
      "name": "dust effect",
      "kind": "actor",
      "s2h": 123,
      "soh": 257
    },
    {
      "key": "ACTOR_EN_SDA",
      "name": "dynamic player shadow",
      "kind": "boss",
      "s2h": 161,
      "soh": 314
    },
    {
      "key": "ACTOR_EN_SNOWMAN",
      "name": "eeno",
      "kind": "enemy",
      "s2h": 486
    },
    {
      "key": "ACTOR_EFC_ERUPC",
      "name": "efc erupc",
      "kind": "actor",
      "soh": 374
    },
    {
      "key": "ACTOR_EN_EG",
      "name": "eg",
      "kind": "actor",
      "soh": 460
    },
    {
      "key": "ACTOR_EN_EIYER",
      "name": "eiyer",
      "kind": "enemy",
      "soh": 58
    },
    {
      "key": "ACTOR_EN_TORCH2",
      "name": "elegy of emptiness shell",
      "kind": "boss",
      "s2h": 33,
      "soh": 51
    },
    {
      "key": "ACTOR_BG_DBLUE_ELEVATOR",
      "name": "elevator",
      "kind": "actor",
      "s2h": 546
    },
    {
      "key": "ACTOR_OBJ_Y2LIFT",
      "name": "elevator platform",
      "kind": "actor",
      "s2h": 554
    },
    {
      "key": "ACTOR_END_TITLE",
      "name": "end title",
      "kind": "actor",
      "soh": 383
    },
    {
      "key": "ACTOR_EN_PART",
      "name": "enemy body parts",
      "kind": "actor",
      "s2h": 3,
      "soh": 7
    },
    {
      "key": "ACTOR_EN_FG",
      "name": "enemy frog",
      "kind": "actor",
      "s2h": 327
    },
    {
      "key": "ACTOR_EN_FR",
      "name": "enfr",
      "kind": "actor",
      "s2h": 115,
      "soh": 237
    },
    {
      "key": "ACTOR_EN_RIVER_SOUND",
      "name": "environmental noises",
      "kind": "actor",
      "s2h": 40,
      "soh": 59
    },
    {
      "key": "ACTOR_EFF_CHANGE",
      "name": "eoe beam of light",
      "kind": "actor",
      "s2h": 352
    },
    {
      "key": "ACTOR_EN_HORSE",
      "name": "epona",
      "kind": "actor",
      "s2h": 13,
      "soh": 20
    },
    {
      "key": "ACTOR_OCEFF_WIPE2",
      "name": "epona s song ocarina effect",
      "kind": "actor",
      "s2h": 223,
      "soh": 408
    },
    {
      "key": "ACTOR_EN_ZOS",
      "name": "evan",
      "kind": "actor",
      "s2h": 577
    },
    {
      "key": "ACTOR_EN_TIME_TAG",
      "name": "event trigger",
      "kind": "actor",
      "s2h": 427
    },
    {
      "key": "ACTOR_EN_EX_ITEM",
      "name": "ex item",
      "kind": "actor",
      "soh": 360
    },
    {
      "key": "ACTOR_EN_EX_RUPPY",
      "name": "ex ruppy",
      "kind": "actor",
      "soh": 305
    },
    {
      "key": "ACTOR_EN_DNB",
      "name": "exploding snow mountain",
      "kind": "actor",
      "s2h": 359
    },
    {
      "key": "ACTOR_EN_EGOL",
      "name": "eyegore",
      "kind": "enemy",
      "s2h": 388
    },
    {
      "key": "ACTOR_EN_ELF",
      "name": "fairy",
      "kind": "actor",
      "s2h": 16,
      "soh": 24
    },
    {
      "key": "ACTOR_OBJ_CHIKUWA",
      "name": "falling row of blocks",
      "kind": "actor",
      "s2h": 276
    },
    {
      "key": "ACTOR_BOSS_FD",
      "name": "fd",
      "kind": "boss",
      "soh": 150
    },
    {
      "key": "ACTOR_EN_FD",
      "name": "fd",
      "kind": "enemy",
      "soh": 153
    },
    {
      "key": "ACTOR_EN_FD_FIRE",
      "name": "fd fire",
      "kind": "enemy",
      "soh": 163
    },
    {
      "key": "ACTOR_BOSS_FD2",
      "name": "fd2",
      "kind": "boss",
      "soh": 162
    },
    {
      "key": "ACTOR_EN_FHG",
      "name": "fhg",
      "kind": "actor",
      "soh": 103
    },
    {
      "key": "ACTOR_EN_FHG_FIRE",
      "name": "fhg fire",
      "kind": "boss",
      "soh": 109
    },
    {
      "key": "ACTOR_EN_KAIZOKU",
      "name": "fighter pirate",
      "kind": "enemy",
      "s2h": 541
    },
    {
      "key": "ACTOR_ARROW_FIRE",
      "name": "fire arrow",
      "kind": "actor",
      "s2h": 125,
      "soh": 266
    },
    {
      "key": "ACTOR_EN_FIRE_ROCK",
      "name": "fire rock",
      "kind": "enemy",
      "s2h": 96,
      "soh": 181
    },
    {
      "key": "ACTOR_EN_HONOTRAP",
      "name": "fire shooting eye switch",
      "kind": "actor",
      "s2h": 140,
      "soh": 284
    },
    {
      "key": "ACTOR_EN_FIREFLY2",
      "name": "firefly2",
      "kind": "enemy",
      "s2h": 366
    },
    {
      "key": "ACTOR_BG_KIN2_FENCE",
      "name": "fireplace gate",
      "kind": "actor",
      "s2h": 527
    },
    {
      "key": "ACTOR_EN_HANABI",
      "name": "fireworks",
      "kind": "actor",
      "s2h": 491
    },
    {
      "key": "ACTOR_EN_FISH",
      "name": "fish",
      "kind": "actor",
      "s2h": 23,
      "soh": 33
    },
    {
      "key": "ACTOR_FISHING",
      "name": "fishing",
      "kind": "actor",
      "soh": 254
    },
    {
      "key": "ACTOR_EN_FISHING",
      "name": "fishing pond elements",
      "kind": "actor",
      "s2h": 121
    },
    {
      "key": "ACTOR_OBJ_TOKEI_TURRET",
      "name": "flag carnival platform",
      "kind": "actor",
      "s2h": 545
    },
    {
      "key": "ACTOR_BG_HAKA_TOMB",
      "name": "flat s tomb",
      "kind": "actor",
      "s2h": 601
    },
    {
      "key": "ACTOR_BG_HAKA_CURTAIN",
      "name": "flat s tomb curtain",
      "kind": "actor",
      "s2h": 525
    },
    {
      "key": "ACTOR_EN_PO_COMPOSER",
      "name": "flat sharp",
      "kind": "actor",
      "s2h": 583
    },
    {
      "key": "ACTOR_OBJ_BEAN",
      "name": "floating bean plant soft soil",
      "kind": "actor",
      "s2h": 145,
      "soh": 294
    },
    {
      "key": "ACTOR_BG_DANPEI_MOVEBG",
      "name": "floating block",
      "kind": "actor",
      "s2h": 467
    },
    {
      "key": "ACTOR_OBJ_DANPEILIFT",
      "name": "floating block",
      "kind": "actor",
      "s2h": 667
    },
    {
      "key": "ACTOR_OBJ_DRIFTICE",
      "name": "floating ice platform",
      "kind": "actor",
      "s2h": 377
    },
    {
      "key": "ACTOR_OBJ_SWITCH",
      "name": "floor eye switch",
      "kind": "actor",
      "s2h": 147,
      "soh": 298
    },
    {
      "key": "ACTOR_EN_FLOORMAS",
      "name": "floormaster",
      "kind": "enemy",
      "s2h": 74,
      "soh": 142
    },
    {
      "key": "ACTOR_EN_TUBO_TRAP",
      "name": "flying pot trap",
      "kind": "actor",
      "s2h": 141,
      "soh": 285
    },
    {
      "key": "ACTOR_EN_FZ",
      "name": "freezard",
      "kind": "enemy",
      "s2h": 143,
      "soh": 289
    },
    {
      "key": "ACTOR_EN_MINIFROG",
      "name": "frog choir frog",
      "kind": "actor",
      "s2h": 34
    },
    {
      "key": "ACTOR_EN_BIGSLIME",
      "name": "fused jellies gekko",
      "kind": "boss",
      "s2h": 101
    },
    {
      "key": "ACTOR_EN_FW",
      "name": "fw",
      "kind": "enemy",
      "soh": 171
    },
    {
      "key": "ACTOR_EN_G_SWITCH",
      "name": "g switch",
      "kind": "actor",
      "soh": 279
    },
    {
      "key": "ACTOR_EN_KGY",
      "name": "gabora",
      "kind": "actor",
      "s2h": 511
    },
    {
      "key": "ACTOR_EN_A_OBJ",
      "name": "gameplay keep item",
      "kind": "actor",
      "s2h": 38,
      "soh": 57
    },
    {
      "key": "ACTOR_BOSS_GANON",
      "name": "ganon",
      "kind": "boss",
      "soh": 232
    },
    {
      "key": "ACTOR_EN_GANON_MANT",
      "name": "ganon mant",
      "kind": "boss",
      "soh": 367
    },
    {
      "key": "ACTOR_EN_GANON_ORGAN",
      "name": "ganon organ",
      "kind": "boss",
      "soh": 350
    },
    {
      "key": "ACTOR_BOSS_GANON2",
      "name": "ganon2",
      "kind": "boss",
      "soh": 378
    },
    {
      "key": "ACTOR_BOSS_GANONDROF",
      "name": "ganondrof",
      "kind": "boss",
      "soh": 82
    },
    {
      "key": "ACTOR_EN_JSO",
      "name": "garo",
      "kind": "enemy",
      "s2h": 275
    },
    {
      "key": "ACTOR_EN_JSO2",
      "name": "garo master",
      "kind": "enemy",
      "s2h": 386
    },
    {
      "key": "ACTOR_EN_ENCOUNT3",
      "name": "garo spawner",
      "kind": "enemy",
      "s2h": 274
    },
    {
      "key": "ACTOR_EN_STOP_HEISHI",
      "name": "gate blocking soldier",
      "kind": "actor",
      "s2h": 455
    },
    {
      "key": "ACTOR_EN_GB",
      "name": "gb",
      "kind": "actor",
      "soh": 440
    },
    {
      "key": "ACTOR_EN_PAMETFROG",
      "name": "gekko",
      "kind": "boss",
      "s2h": 7
    },
    {
      "key": "ACTOR_EN_GELDB",
      "name": "geldb",
      "kind": "enemy",
      "soh": 407
    },
    {
      "key": "ACTOR_EN_GIANT",
      "name": "giant",
      "kind": "actor",
      "s2h": 475
    },
    {
      "key": "ACTOR_EN_BEE",
      "name": "giant bee",
      "kind": "enemy",
      "s2h": 516
    },
    {
      "key": "ACTOR_EN_SC_RUPPE",
      "name": "giant rupee",
      "kind": "actor",
      "s2h": 602
    },
    {
      "key": "ACTOR_EN_HG",
      "name": "gibdo",
      "kind": "actor",
      "s2h": 592
    },
    {
      "key": "ACTOR_EN_ZL4",
      "name": "glitched skull kid t pose",
      "kind": "actor",
      "s2h": 253,
      "soh": 467
    },
    {
      "key": "ACTOR_DM_SA",
      "name": "glitched skull kid t pose",
      "kind": "actor",
      "s2h": 329
    },
    {
      "key": "ACTOR_EN_GO2",
      "name": "go2",
      "kind": "actor",
      "soh": 430
    },
    {
      "key": "ACTOR_BOSS_HAKUGIN",
      "name": "goht",
      "kind": "boss",
      "s2h": 477
    },
    {
      "key": "ACTOR_EN_HAKUROCK",
      "name": "goht debris",
      "kind": "actor",
      "s2h": 490
    },
    {
      "key": "ACTOR_EN_SI",
      "name": "gold skulltula token",
      "kind": "actor",
      "s2h": 227,
      "soh": 412
    },
    {
      "key": "ACTOR_BOSS_GOMA",
      "name": "goma",
      "kind": "boss",
      "soh": 40
    },
    {
      "key": "ACTOR_EN_GOMA",
      "name": "goma",
      "kind": "enemy",
      "soh": 43
    },
    {
      "key": "ACTOR_EN_DEATH",
      "name": "gomess",
      "kind": "enemy",
      "s2h": 67
    },
    {
      "key": "ACTOR_EN_MINIDEATH",
      "name": "gomess s bat",
      "kind": "enemy",
      "s2h": 68
    },
    {
      "key": "ACTOR_OBJ_DORA",
      "name": "gong",
      "kind": "actor",
      "s2h": 519
    },
    {
      "key": "ACTOR_EN_GM",
      "name": "gorman",
      "kind": "actor",
      "s2h": 164,
      "soh": 317
    },
    {
      "key": "ACTOR_OBJ_KEPN_KOYA",
      "name": "gorman bros building",
      "kind": "actor",
      "s2h": 647
    },
    {
      "key": "ACTOR_EN_IN",
      "name": "gorman brother",
      "kind": "actor",
      "s2h": 103,
      "soh": 203
    },
    {
      "key": "ACTOR_EN_HORSE_GAME_CHECK",
      "name": "gorman race track dirt patch",
      "kind": "actor",
      "s2h": 107,
      "soh": 219
    },
    {
      "key": "ACTOR_EN_GO",
      "name": "goron",
      "kind": "actor",
      "s2h": 312,
      "soh": 338
    },
    {
      "key": "ACTOR_EN_JG",
      "name": "goron elder",
      "kind": "actor",
      "s2h": 531
    },
    {
      "key": "ACTOR_OBJ_JG_GAKKI",
      "name": "goron elder s drum",
      "kind": "actor",
      "s2h": 550
    },
    {
      "key": "ACTOR_EN_GK",
      "name": "goron elder s son",
      "kind": "actor",
      "s2h": 513
    },
    {
      "key": "ACTOR_BG_GORON_OYU",
      "name": "goron hot spring water",
      "kind": "actor",
      "s2h": 510
    },
    {
      "key": "ACTOR_BG_HAKUGIN_SWITCH",
      "name": "goron link switch",
      "kind": "actor",
      "s2h": 484
    },
    {
      "key": "ACTOR_EN_MT_TAG",
      "name": "goron race controls",
      "kind": "actor",
      "s2h": 296
    },
    {
      "key": "ACTOR_OBJ_CHAN",
      "name": "goron shrine chandelier",
      "kind": "actor",
      "s2h": 576
    },
    {
      "key": "ACTOR_BG_TOBIRA01",
      "name": "goron shrine gate",
      "kind": "actor",
      "s2h": 480
    },
    {
      "key": "ACTOR_EN_S_GORO",
      "name": "goron shrine goron bomb shop goron",
      "kind": "actor",
      "s2h": 578
    },
    {
      "key": "ACTOR_EN_GEG",
      "name": "goron with don gero s mask",
      "kind": "actor",
      "s2h": 570
    },
    {
      "key": "ACTOR_EN_GS",
      "name": "gossip stone",
      "kind": "actor",
      "s2h": 239,
      "soh": 441
    },
    {
      "key": "ACTOR_EN_KUSA",
      "name": "grass",
      "kind": "actor",
      "s2h": 144,
      "soh": 293
    },
    {
      "key": "ACTOR_OBJ_GRASS_UNIT",
      "name": "grass pattern initializer",
      "kind": "actor",
      "s2h": 269
    },
    {
      "key": "ACTOR_OBJ_HAKAISI",
      "name": "gravestone",
      "kind": "actor",
      "s2h": 483
    },
    {
      "key": "ACTOR_EN_TSN",
      "name": "great bay fisherman",
      "kind": "actor",
      "s2h": 450
    },
    {
      "key": "ACTOR_BG_DBLUE_MOVEBG",
      "name": "great bay moving parts",
      "kind": "actor",
      "s2h": 372
    },
    {
      "key": "ACTOR_BG_BREAKWALL",
      "name": "great bay temple weather",
      "kind": "actor",
      "s2h": 54,
      "soh": 89
    },
    {
      "key": "ACTOR_BG_DY_YOSEIZO",
      "name": "great fairy",
      "kind": "actor",
      "s2h": 304,
      "soh": 11
    },
    {
      "key": "ACTOR_EN_DY_EXTRA",
      "name": "great fairy beam",
      "kind": "actor",
      "s2h": 373,
      "soh": 388
    },
    {
      "key": "ACTOR_EN_TALK",
      "name": "green target spot",
      "kind": "actor",
      "s2h": 609
    },
    {
      "key": "ACTOR_BG_F40_FLIFT",
      "name": "grey square stone elevator",
      "kind": "actor",
      "s2h": 77
    },
    {
      "key": "ACTOR_EN_HS",
      "name": "grog",
      "kind": "actor",
      "s2h": 166,
      "soh": 319
    },
    {
      "key": "ACTOR_EN_TORCH",
      "name": "grotto chest spawner",
      "kind": "actor",
      "s2h": 206,
      "soh": 385
    },
    {
      "key": "ACTOR_DOOR_ANA",
      "name": "grotto hold entrance",
      "kind": "actor",
      "s2h": 85,
      "soh": 155
    },
    {
      "key": "ACTOR_OBJ_MURE3",
      "name": "group rupee spawner",
      "kind": "actor",
      "s2h": 232,
      "soh": 427
    },
    {
      "key": "ACTOR_EN_CROW",
      "name": "guay",
      "kind": "enemy",
      "s2h": 241,
      "soh": 448
    },
    {
      "key": "ACTOR_EN_SCOPECROW",
      "name": "guay",
      "kind": "actor",
      "s2h": 589
    },
    {
      "key": "ACTOR_EN_RUPPECROW",
      "name": "guay",
      "kind": "enemy",
      "s2h": 614
    },
    {
      "key": "ACTOR_EN_GUEST",
      "name": "guest",
      "kind": "actor",
      "soh": 420
    },
    {
      "key": "ACTOR_EN_GURUGURU",
      "name": "guru guru",
      "kind": "actor",
      "s2h": 584
    },
    {
      "key": "ACTOR_EN_STH",
      "name": "guy looking at moon uncursed man",
      "kind": "actor",
      "s2h": 523,
      "soh": 393
    },
    {
      "key": "ACTOR_EN_STH2",
      "name": "guy waving at telescope",
      "kind": "actor",
      "s2h": 633
    },
    {
      "key": "ACTOR_BOSS_03",
      "name": "gyorg",
      "kind": "boss",
      "s2h": 299
    },
    {
      "key": "ACTOR_EN_DNK",
      "name": "hallucinatory mad scrub",
      "kind": "actor",
      "s2h": 361
    },
    {
      "key": "ACTOR_EN_BJT",
      "name": "hand in toilet",
      "kind": "actor",
      "s2h": 637
    },
    {
      "key": "ACTOR_EN_OSN",
      "name": "happy mask salesman",
      "kind": "actor",
      "s2h": 437
    },
    {
      "key": "ACTOR_ITEM_B_HEART",
      "name": "heart container",
      "kind": "boss",
      "s2h": 58,
      "soh": 95
    },
    {
      "key": "ACTOR_EN_HEISHI1",
      "name": "heishi1",
      "kind": "actor",
      "soh": 143
    },
    {
      "key": "ACTOR_EN_HEISHI2",
      "name": "heishi2",
      "kind": "actor",
      "soh": 179
    },
    {
      "key": "ACTOR_EN_HEISHI3",
      "name": "heishi3",
      "kind": "actor",
      "soh": 322
    },
    {
      "key": "ACTOR_EN_HEISHI4",
      "name": "heishi4",
      "kind": "actor",
      "soh": 376
    },
    {
      "key": "ACTOR_EN_BOMBERS2",
      "name": "hideout guard",
      "kind": "actor",
      "s2h": 641
    },
    {
      "key": "ACTOR_EN_HINT_SKB",
      "name": "hinting stalchild",
      "kind": "actor",
      "s2h": 677
    },
    {
      "key": "ACTOR_EN_HINTNUTS",
      "name": "hintnuts",
      "kind": "enemy",
      "soh": 402
    },
    {
      "key": "ACTOR_EN_PP",
      "name": "hiploop",
      "kind": "enemy",
      "s2h": 489
    },
    {
      "key": "ACTOR_EN_FU",
      "name": "honey darling",
      "kind": "actor",
      "s2h": 181,
      "soh": 339
    },
    {
      "key": "ACTOR_OBJ_HSBLOCK",
      "name": "hookshot block",
      "kind": "actor",
      "s2h": 150,
      "soh": 301
    },
    {
      "key": "ACTOR_ARMS_HOOK",
      "name": "hookshot tip",
      "kind": "actor",
      "s2h": 61,
      "soh": 102
    },
    {
      "key": "ACTOR_OBJ_HSSTUMP",
      "name": "hookshottable tree",
      "kind": "actor",
      "s2h": 606
    },
    {
      "key": "ACTOR_OBJ_SPINYROLL",
      "name": "horizontal spike covered log",
      "kind": "actor",
      "s2h": 319
    },
    {
      "key": "ACTOR_EN_HORSE_GANON",
      "name": "horse ganon",
      "kind": "actor",
      "soh": 66
    },
    {
      "key": "ACTOR_BG_UMAJUMP",
      "name": "horse jumping fence",
      "kind": "actor",
      "s2h": 124,
      "soh": 264
    },
    {
      "key": "ACTOR_EN_HORSE_NORMAL",
      "name": "horse normal",
      "kind": "actor",
      "soh": 60
    },
    {
      "key": "ACTOR_EN_HORSE_ZELDA",
      "name": "horse zelda",
      "kind": "actor",
      "soh": 91
    },
    {
      "key": "ACTOR_BG_IKNIN_SUSCEIL",
      "name": "hot checkered celing",
      "kind": "actor",
      "s2h": 654
    },
    {
      "key": "ACTOR_EN_HY",
      "name": "hy",
      "kind": "actor",
      "soh": 366
    },
    {
      "key": "ACTOR_ARROW_ICE",
      "name": "ice arrow",
      "kind": "actor",
      "s2h": 126,
      "soh": 267
    },
    {
      "key": "ACTOR_OBJ_ICEBLOCK",
      "name": "ice block surrounding frozen enemy",
      "kind": "actor",
      "s2h": 323
    },
    {
      "key": "ACTOR_EN_ICE_HONO",
      "name": "ice hono",
      "kind": "actor",
      "soh": 240
    },
    {
      "key": "ACTOR_BG_ICEFLOE",
      "name": "ice platform from ice arrow",
      "kind": "actor",
      "s2h": 425
    },
    {
      "key": "ACTOR_OBJ_SKATEBLOCK",
      "name": "ice sliding pushable block",
      "kind": "actor",
      "s2h": 322
    },
    {
      "key": "ACTOR_BG_ICICLE",
      "name": "icicle",
      "kind": "actor",
      "s2h": 287
    },
    {
      "key": "ACTOR_EN_KNIGHT",
      "name": "igos du ikana idi lackey",
      "kind": "boss",
      "s2h": 277
    },
    {
      "key": "ACTOR_EN_OSK",
      "name": "igos du ikana s head idi lackey s head",
      "kind": "actor",
      "s2h": 632
    },
    {
      "key": "ACTOR_BOSS_06",
      "name": "igos du ikana window",
      "kind": "boss",
      "s2h": 302
    },
    {
      "key": "ACTOR_DEMO_SYOTEN",
      "name": "ikana canyon cleansing cs effect",
      "kind": "actor",
      "s2h": 661
    },
    {
      "key": "ACTOR_ITEM_INBOX",
      "name": "in chest item draw",
      "kind": "actor",
      "s2h": 158,
      "soh": 311
    },
    {
      "key": "ACTOR_EFF_ZORABAND",
      "name": "indigo gos",
      "kind": "actor",
      "s2h": 646
    },
    {
      "key": "ACTOR_BG_CTOWER_GEAR",
      "name": "inside clock tower cog organ",
      "kind": "actor",
      "s2h": 438
    },
    {
      "key": "ACTOR_EN_TANRON6",
      "name": "invisible enemy",
      "kind": "enemy",
      "s2h": 617
    },
    {
      "key": "ACTOR_EN_HIT_TAG",
      "name": "invisible rupee hitbox",
      "kind": "actor",
      "s2h": 613
    },
    {
      "key": "ACTOR_EN_INVISIBLE_RUPPE",
      "name": "invisible ruppe",
      "kind": "actor",
      "s2h": 687
    },
    {
      "key": "ACTOR_OBJ_SOUND",
      "name": "invisible sound emitter",
      "kind": "actor",
      "s2h": 240
    },
    {
      "key": "ACTOR_EN_IK",
      "name": "iron knuckle",
      "kind": "boss",
      "s2h": 132,
      "soh": 275
    },
    {
      "key": "ACTOR_EN_IT",
      "name": "it",
      "kind": "actor",
      "soh": 406
    },
    {
      "key": "ACTOR_OBJ_SWPRIZE",
      "name": "item drop spawner",
      "kind": "actor",
      "s2h": 686
    },
    {
      "key": "ACTOR_ITEM_OCARINA",
      "name": "item ocarina",
      "kind": "actor",
      "soh": 241
    },
    {
      "key": "ACTOR_ITEM_SHIELD",
      "name": "item shield",
      "kind": "actor",
      "soh": 238
    },
    {
      "key": "ACTOR_EN_ZOB",
      "name": "japas",
      "kind": "actor",
      "s2h": 561
    },
    {
      "key": "ACTOR_EN_JJ",
      "name": "jj",
      "kind": "actor",
      "soh": 90
    },
    {
      "key": "ACTOR_EN_JSJUTAN",
      "name": "jsjutan",
      "kind": "actor",
      "soh": 363
    },
    {
      "key": "ACTOR_EN_RZ",
      "name": "judo marilla rosa",
      "kind": "actor",
      "s2h": 635
    },
    {
      "key": "ACTOR_EN_JA",
      "name": "juggler",
      "kind": "actor",
      "s2h": 580
    },
    {
      "key": "ACTOR_EN_JGAME_TSN",
      "name": "jumping game",
      "kind": "actor",
      "s2h": 658
    },
    {
      "key": "ACTOR_OBJ_JGAME_LIGHT",
      "name": "jumping game torch",
      "kind": "actor",
      "s2h": 659
    },
    {
      "key": "ACTOR_EN_OWL",
      "name": "kaepora gaebora",
      "kind": "actor",
      "s2h": 175,
      "soh": 333
    },
    {
      "key": "ACTOR_EN_TEST3",
      "name": "kafei",
      "kind": "actor",
      "s2h": 345
    },
    {
      "key": "ACTOR_EN_KAKASI2",
      "name": "kakasi2",
      "kind": "actor",
      "soh": 457
    },
    {
      "key": "ACTOR_EN_KAKASI3",
      "name": "kakasi3",
      "kind": "actor",
      "soh": 458
    },
    {
      "key": "ACTOR_EN_YB",
      "name": "kamaro",
      "kind": "actor",
      "s2h": 634
    },
    {
      "key": "ACTOR_EN_KITAN",
      "name": "keaton",
      "kind": "actor",
      "s2h": 652
    },
    {
      "key": "ACTOR_EN_KUSA2",
      "name": "keaton grass",
      "kind": "actor",
      "s2h": 369
    },
    {
      "key": "ACTOR_EN_FIREFLY",
      "name": "keese",
      "kind": "enemy",
      "s2h": 12,
      "soh": 19
    },
    {
      "key": "ACTOR_BG_BOTIHASIRA",
      "name": "keeta race gatepost",
      "kind": "actor",
      "s2h": 496
    },
    {
      "key": "ACTOR_EN_DNS",
      "name": "king s chamber deku guard",
      "kind": "actor",
      "s2h": 138,
      "soh": 282
    },
    {
      "key": "ACTOR_EN_KO",
      "name": "ko",
      "kind": "actor",
      "soh": 355
    },
    {
      "key": "ACTOR_EN_TRT",
      "name": "kotake",
      "kind": "actor",
      "s2h": 392
    },
    {
      "key": "ACTOR_EN_TRT2",
      "name": "kotake",
      "kind": "actor",
      "s2h": 439
    },
    {
      "key": "ACTOR_EN_DNH",
      "name": "koume",
      "kind": "actor",
      "s2h": 360
    },
    {
      "key": "ACTOR_EN_TRU",
      "name": "koume",
      "kind": "actor",
      "s2h": 391
    },
    {
      "key": "ACTOR_EN_TRU_MT",
      "name": "koume on broom",
      "kind": "actor",
      "s2h": 532
    },
    {
      "key": "ACTOR_EN_KZ",
      "name": "kz",
      "kind": "actor",
      "soh": 356
    },
    {
      "key": "ACTOR_EN_COL_MAN",
      "name": "lab heart piece garo master falling rock garo master bomb",
      "kind": "actor",
      "s2h": 473
    },
    {
      "key": "ACTOR_DM_CHAR08",
      "name": "large great bay turtle",
      "kind": "actor",
      "s2h": 410
    },
    {
      "key": "ACTOR_OBJ_ICE_POLY",
      "name": "large ice block",
      "kind": "actor",
      "s2h": 142,
      "soh": 286
    },
    {
      "key": "ACTOR_OBJ_BIGICICLE",
      "name": "large icicle",
      "kind": "actor",
      "s2h": 456
    },
    {
      "key": "ACTOR_BG_IKANA_RAY",
      "name": "large light ray",
      "kind": "actor",
      "s2h": 598
    },
    {
      "key": "ACTOR_EN_ST",
      "name": "large skulltula",
      "kind": "enemy",
      "s2h": 36,
      "soh": 55
    },
    {
      "key": "ACTOR_OBJ_SNOWBALL",
      "name": "large snowball",
      "kind": "actor",
      "s2h": 476
    },
    {
      "key": "ACTOR_OBJ_KIBAKO2",
      "name": "large wooden crate",
      "kind": "actor",
      "s2h": 229,
      "soh": 416
    },
    {
      "key": "ACTOR_EN_CHA",
      "name": "laundry pool bell",
      "kind": "actor",
      "s2h": 624
    },
    {
      "key": "ACTOR_EN_NEO_REEBA",
      "name": "leevers",
      "kind": "enemy",
      "s2h": 534
    },
    {
      "key": "ACTOR_ITEM_ETCETERA",
      "name": "leftover collectible items",
      "kind": "actor",
      "s2h": 128,
      "soh": 271
    },
    {
      "key": "ACTOR_EN_TEST2",
      "name": "lens of truth affected object",
      "kind": "actor",
      "s2h": 344
    },
    {
      "key": "ACTOR_OBJ_VISIBLOCK",
      "name": "lens of truth platform",
      "kind": "actor",
      "s2h": 448
    },
    {
      "key": "ACTOR_EN_ISHI",
      "name": "liftable rocks silver boulders",
      "kind": "actor",
      "s2h": 176,
      "soh": 334
    },
    {
      "key": "ACTOR_ARROW_LIGHT",
      "name": "light arrow",
      "kind": "actor",
      "s2h": 127,
      "soh": 268
    },
    {
      "key": "ACTOR_DEMO_TRE_LGT",
      "name": "light from treasure chest",
      "kind": "actor",
      "s2h": 92,
      "soh": 170
    },
    {
      "key": "ACTOR_EN_LIGHTBOX",
      "name": "lightbox",
      "kind": "actor",
      "soh": 124
    },
    {
      "key": "ACTOR_EN_RR",
      "name": "like like",
      "kind": "enemy",
      "s2h": 108,
      "soh": 221
    },
    {
      "key": "ACTOR_BG_LOTUS",
      "name": "lily pad",
      "kind": "actor",
      "s2h": 441
    },
    {
      "key": "ACTOR_EN_IG",
      "name": "link the goron",
      "kind": "actor",
      "s2h": 630
    },
    {
      "key": "ACTOR_OBJ_HARIKO",
      "name": "little cow statue head",
      "kind": "actor",
      "s2h": 522
    },
    {
      "key": "ACTOR_EN_HOLL",
      "name": "loading hall hole",
      "kind": "actor",
      "s2h": 24,
      "soh": 35
    },
    {
      "key": "ACTOR_EN_WEATHER_TAG",
      "name": "local weather changes",
      "kind": "actor",
      "s2h": 188,
      "soh": 357
    },
    {
      "key": "ACTOR_DM_OPSTAGE",
      "name": "lost woods cutscene trees floor",
      "kind": "actor",
      "s2h": 400
    },
    {
      "key": "ACTOR_EN_KUJIYA",
      "name": "lottery shop",
      "kind": "actor",
      "s2h": 569
    },
    {
      "key": "ACTOR_EN_ZOV",
      "name": "lulu",
      "kind": "actor",
      "s2h": 594
    },
    {
      "key": "ACTOR_EN_MA1",
      "name": "ma1",
      "kind": "actor",
      "soh": 231
    },
    {
      "key": "ACTOR_EN_MA2",
      "name": "ma2",
      "kind": "actor",
      "soh": 217
    },
    {
      "key": "ACTOR_EN_MA3",
      "name": "ma3",
      "kind": "actor",
      "soh": 453
    },
    {
      "key": "ACTOR_EN_DEKUNUTS",
      "name": "mad scrub",
      "kind": "enemy",
      "s2h": 59,
      "soh": 96
    },
    {
      "key": "ACTOR_EN_AL",
      "name": "madame aroma",
      "kind": "actor",
      "s2h": 610
    },
    {
      "key": "ACTOR_DM_AL",
      "name": "madame aroma",
      "kind": "actor",
      "s2h": 669
    },
    {
      "key": "ACTOR_MAGIC_DARK",
      "name": "magic dark",
      "kind": "actor",
      "soh": 244
    },
    {
      "key": "ACTOR_MAGIC_FIRE",
      "name": "magic fire",
      "kind": "actor",
      "soh": 159
    },
    {
      "key": "ACTOR_MAGIC_WIND",
      "name": "magic wind",
      "kind": "actor",
      "soh": 158
    },
    {
      "key": "ACTOR_BOSS_07",
      "name": "majora",
      "kind": "boss",
      "s2h": 303
    },
    {
      "key": "ACTOR_EN_ENCOUNT2",
      "name": "majora s mask balloon",
      "kind": "enemy",
      "s2h": 95,
      "soh": 180
    },
    {
      "key": "ACTOR_EN_BOMBAL",
      "name": "majora s mask balloon",
      "kind": "actor",
      "s2h": 642
    },
    {
      "key": "ACTOR_EN_AOB_01",
      "name": "mamamu yan",
      "kind": "actor",
      "s2h": 279
    },
    {
      "key": "ACTOR_EN_ANI",
      "name": "man in tree in south termina field",
      "kind": "actor",
      "s2h": 189,
      "soh": 359
    },
    {
      "key": "ACTOR_EN_FISH2",
      "name": "marine research lab fish",
      "kind": "actor",
      "s2h": 497
    },
    {
      "key": "ACTOR_EN_MK",
      "name": "marine researcher",
      "kind": "actor",
      "s2h": 174,
      "soh": 330
    },
    {
      "key": "ACTOR_EN_CNE_01",
      "name": "market npc",
      "kind": "actor",
      "s2h": 290
    },
    {
      "key": "ACTOR_DM_TSG",
      "name": "mask effect handler",
      "kind": "actor",
      "s2h": 340
    },
    {
      "key": "ACTOR_EN_DT",
      "name": "mayor detour",
      "kind": "actor",
      "s2h": 623
    },
    {
      "key": "ACTOR_EN_ENDING_HERO",
      "name": "mayor detour",
      "kind": "actor",
      "s2h": 674
    },
    {
      "key": "ACTOR_EN_RECEPGIRL",
      "name": "mayor s receptionist",
      "kind": "actor",
      "s2h": 656
    },
    {
      "key": "ACTOR_EN_MB",
      "name": "mb",
      "kind": "enemy",
      "soh": 75
    },
    {
      "key": "ACTOR_EN_MD",
      "name": "md",
      "kind": "actor",
      "soh": 365
    },
    {
      "key": "ACTOR_BG_IKANA_SHUTTER",
      "name": "metal shutter",
      "kind": "actor",
      "s2h": 599
    },
    {
      "key": "ACTOR_EN_ZOG",
      "name": "mikau",
      "kind": "actor",
      "s2h": 548
    },
    {
      "key": "ACTOR_EN_SEKIHI",
      "name": "mikau s grave song pedestal",
      "kind": "actor",
      "s2h": 348
    },
    {
      "key": "ACTOR_BG_MBAR_CHAIR",
      "name": "milk bar chair",
      "kind": "actor",
      "s2h": 535
    },
    {
      "key": "ACTOR_DM_CHAR07",
      "name": "milk bar object",
      "kind": "actor",
      "s2h": 409
    },
    {
      "key": "ACTOR_OBJ_MILK_BIN",
      "name": "milk jar",
      "kind": "actor",
      "s2h": 651
    },
    {
      "key": "ACTOR_EN_DAIKU2",
      "name": "milk road carpenter",
      "kind": "actor",
      "s2h": 618
    },
    {
      "key": "ACTOR_OBJ_HUGEBOMBIWA",
      "name": "milk road goron racetrack boulder",
      "kind": "actor",
      "s2h": 365
    },
    {
      "key": "ACTOR_EN_MINISLIME",
      "name": "mini jelly droplet",
      "kind": "boss",
      "s2h": 217
    },
    {
      "key": "ACTOR_BG_IKANA_MIRROR",
      "name": "mirror",
      "kind": "actor",
      "s2h": 537
    },
    {
      "key": "ACTOR_MIR_RAY3",
      "name": "mirror shield reflection and glow",
      "kind": "actor",
      "s2h": 560
    },
    {
      "key": "ACTOR_BOSS_MO",
      "name": "mo",
      "kind": "boss",
      "soh": 196
    },
    {
      "key": "ACTOR_EN_MNK",
      "name": "monkey",
      "kind": "actor",
      "s2h": 414
    },
    {
      "key": "ACTOR_EN_ONPUMAN",
      "name": "monkey instrument prompt",
      "kind": "actor",
      "s2h": 479
    },
    {
      "key": "ACTOR_EN_JS",
      "name": "moon child",
      "kind": "actor",
      "s2h": 191,
      "soh": 362
    },
    {
      "key": "ACTOR_EFF_LASTDAY",
      "name": "moon crash cs fire wall",
      "kind": "actor",
      "s2h": 626
    },
    {
      "key": "ACTOR_DEMO_MOONEND",
      "name": "moon disappearing cs",
      "kind": "actor",
      "s2h": 662
    },
    {
      "key": "ACTOR_EN_FALL",
      "name": "moon moon effect moon tear",
      "kind": "actor",
      "s2h": 380
    },
    {
      "key": "ACTOR_OBJ_MOON_STONE",
      "name": "moon s tear",
      "kind": "actor",
      "s2h": 643
    },
    {
      "key": "ACTOR_EN_TANRON1",
      "name": "moth swarm",
      "kind": "enemy",
      "s2h": 573
    },
    {
      "key": "ACTOR_DM_CHAR06",
      "name": "mountain village snowy landscape fadeout",
      "kind": "actor",
      "s2h": 408
    },
    {
      "key": "ACTOR_OBJ_RAILLIFT",
      "name": "moving deku flower platform",
      "kind": "actor",
      "s2h": 316
    },
    {
      "key": "ACTOR_EN_TAB",
      "name": "mr barten",
      "kind": "actor",
      "s2h": 611
    },
    {
      "key": "ACTOR_EN_MU",
      "name": "mu",
      "kind": "actor",
      "soh": 429
    },
    {
      "key": "ACTOR_OBJ_KINOKO",
      "name": "mushroom",
      "kind": "actor",
      "s2h": 571
    },
    {
      "key": "ACTOR_EN_MUTO",
      "name": "mutoh",
      "kind": "actor",
      "s2h": 619
    },
    {
      "key": "ACTOR_EN_ENDING_HERO3",
      "name": "mutoh watching moon",
      "kind": "actor",
      "s2h": 681
    },
    {
      "key": "ACTOR_EN_BAGUO",
      "name": "nejiron",
      "kind": "enemy",
      "s2h": 341
    },
    {
      "key": "ACTOR_EN_NIW_GIRL",
      "name": "niw girl",
      "kind": "actor",
      "soh": 410
    },
    {
      "key": "ACTOR_EN_NIW_LADY",
      "name": "niw lady",
      "kind": "actor",
      "soh": 316
    },
    {
      "key": "ACTOR_EN_INSECT",
      "name": "non burrowing bug",
      "kind": "actor",
      "s2h": 22,
      "soh": 32
    },
    {
      "key": "ACTOR_OBJ_ARMOS",
      "name": "non hostile armos",
      "kind": "actor",
      "s2h": 261
    },
    {
      "key": "ACTOR_EN_NY",
      "name": "ny",
      "kind": "enemy",
      "soh": 236
    },
    {
      "key": "ACTOR_OBJ_BOYO",
      "name": "obj boyo",
      "kind": "actor",
      "s2h": 262
    },
    {
      "key": "ACTOR_OBJ_DEKUJR",
      "name": "obj dekujr",
      "kind": "actor",
      "soh": 211
    },
    {
      "key": "ACTOR_OBJ_ELEVATOR",
      "name": "obj elevator",
      "kind": "actor",
      "soh": 299
    },
    {
      "key": "ACTOR_OBJ_TIMEBLOCK",
      "name": "obj timeblock",
      "kind": "actor",
      "soh": 465
    },
    {
      "key": "ACTOR_OBJ_WARP2BLOCK",
      "name": "obj warp2block",
      "kind": "actor",
      "soh": 470
    },
    {
      "key": "ACTOR_BG_IKNINSIDE",
      "name": "object",
      "kind": "actor",
      "s2h": 645
    },
    {
      "key": "ACTOR_OCEFF_WIPE5",
      "name": "ocarina effect",
      "kind": "actor",
      "s2h": 585
    },
    {
      "key": "ACTOR_EN_OKARINA_TAG",
      "name": "ocarina music staff spot",
      "kind": "actor",
      "s2h": 151,
      "soh": 302
    },
    {
      "key": "ACTOR_DM_CHAR02",
      "name": "ocarina of time",
      "kind": "actor",
      "s2h": 404
    },
    {
      "key": "ACTOR_EN_OKUTA",
      "name": "octorok",
      "kind": "enemy",
      "s2h": 8,
      "soh": 14
    },
    {
      "key": "ACTOR_BOSS_01",
      "name": "odolwa odolwa bug odolwa afterimage",
      "kind": "boss",
      "s2h": 297
    },
    {
      "key": "ACTOR_EN_OE2",
      "name": "oe2",
      "kind": "actor",
      "soh": 79
    },
    {
      "key": "ACTOR_OBJ_GRASS",
      "name": "optimized manager for objgrassunit grasses",
      "kind": "actor",
      "s2h": 267
    },
    {
      "key": "ACTOR_OBJ_HANA",
      "name": "orange graveyard flower",
      "kind": "actor",
      "s2h": 177,
      "soh": 335
    },
    {
      "key": "ACTOR_OBJ_WARPSTONE",
      "name": "owl statue",
      "kind": "actor",
      "s2h": 547
    },
    {
      "key": "ACTOR_OBJ_YASI",
      "name": "palm tree",
      "kind": "actor",
      "s2h": 572
    },
    {
      "key": "ACTOR_EN_PAMERA",
      "name": "pamela",
      "kind": "actor",
      "s2h": 605
    },
    {
      "key": "ACTOR_EN_HGO",
      "name": "pamela s father",
      "kind": "actor",
      "s2h": 593
    },
    {
      "key": "ACTOR_EN_LOOK_NUTS",
      "name": "patrolling deku guard",
      "kind": "actor",
      "s2h": 378
    },
    {
      "key": "ACTOR_EN_RAILGIBUD",
      "name": "patrolling gibdos",
      "kind": "enemy",
      "s2h": 565
    },
    {
      "key": "ACTOR_EN_PEEHAT",
      "name": "peehat",
      "kind": "enemy",
      "s2h": 20,
      "soh": 29
    },
    {
      "key": "ACTOR_EN_KAKASI",
      "name": "pierre the scarecrow",
      "kind": "actor",
      "s2h": 202,
      "soh": 379
    },
    {
      "key": "ACTOR_EN_EGBLOCK",
      "name": "pillar",
      "kind": "actor",
      "s2h": 415
    },
    {
      "key": "ACTOR_DM_STATUE",
      "name": "pillar of water",
      "kind": "actor",
      "s2h": 353
    },
    {
      "key": "ACTOR_OBJ_BOAT",
      "name": "pirate boat",
      "kind": "actor",
      "s2h": 556
    },
    {
      "key": "ACTOR_DM_CHAR09",
      "name": "pirates fortress cs character",
      "kind": "actor",
      "s2h": 411
    },
    {
      "key": "ACTOR_EN_WARP_UZU",
      "name": "pirates fortress telescope",
      "kind": "actor",
      "s2h": 376
    },
    {
      "key": "ACTOR_PLAYER",
      "name": "player",
      "kind": "actor",
      "s2h": 0,
      "soh": 0
    },
    {
      "key": "ACTOR_EN_PO_DESERT",
      "name": "po desert",
      "kind": "actor",
      "soh": 447
    },
    {
      "key": "ACTOR_EN_PO_FIELD",
      "name": "po field",
      "kind": "enemy",
      "soh": 373
    },
    {
      "key": "ACTOR_EN_PO_RELAY",
      "name": "po relay",
      "kind": "actor",
      "soh": 290
    },
    {
      "key": "ACTOR_EN_POH",
      "name": "poe",
      "kind": "enemy",
      "s2h": 499,
      "soh": 13
    },
    {
      "key": "ACTOR_EN_PO_FUSEN",
      "name": "poe balloon",
      "kind": "actor",
      "s2h": 422
    },
    {
      "key": "ACTOR_EN_PO_SISTERS",
      "name": "poe sister",
      "kind": "enemy",
      "s2h": 488,
      "soh": 145
    },
    {
      "key": "ACTOR_OBJ_PURIFY",
      "name": "poisoned purified water element",
      "kind": "actor",
      "s2h": 390
    },
    {
      "key": "ACTOR_EN_PST",
      "name": "postbox",
      "kind": "actor",
      "s2h": 498
    },
    {
      "key": "ACTOR_EN_PM",
      "name": "postman",
      "kind": "actor",
      "s2h": 469
    },
    {
      "key": "ACTOR_EN_MM2",
      "name": "postman s letter to himself",
      "kind": "actor",
      "s2h": 254,
      "soh": 468
    },
    {
      "key": "ACTOR_OBJ_TSUBO",
      "name": "pot",
      "kind": "actor",
      "s2h": 130,
      "soh": 273
    },
    {
      "key": "ACTOR_EN_DS2N",
      "name": "potion shop owner",
      "kind": "actor",
      "s2h": 451
    },
    {
      "key": "ACTOR_EN_MARUTA",
      "name": "practice log",
      "kind": "actor",
      "s2h": 504
    },
    {
      "key": "ACTOR_EN_BJI_01",
      "name": "professor shikashi",
      "kind": "actor",
      "s2h": 292
    },
    {
      "key": "ACTOR_BG_SPOUT_FIRE",
      "name": "proximity activated fire wall spawner",
      "kind": "actor",
      "s2h": 370
    },
    {
      "key": "ACTOR_OBJ_DEMO",
      "name": "proximity based cutscene trigger",
      "kind": "actor",
      "s2h": 216
    },
    {
      "key": "ACTOR_EN_PU_BOX",
      "name": "pu box",
      "kind": "actor",
      "soh": 125
    },
    {
      "key": "ACTOR_BG_IKANA_DHARMA",
      "name": "punchable pillar segments",
      "kind": "actor",
      "s2h": 627
    },
    {
      "key": "ACTOR_EN_GE2",
      "name": "purple gerudo pirate",
      "kind": "actor",
      "s2h": 542,
      "soh": 390
    },
    {
      "key": "ACTOR_OBJ_BLOCKSTOP",
      "name": "push block trigger",
      "kind": "actor",
      "s2h": 160,
      "soh": 313
    },
    {
      "key": "ACTOR_OBJ_OSHIHIKI",
      "name": "pushable block",
      "kind": "actor",
      "s2h": 122,
      "soh": 255
    },
    {
      "key": "ACTOR_OBJ_MAKEOSHIHIKI",
      "name": "pushable block switch flag handler",
      "kind": "actor",
      "s2h": 203,
      "soh": 381
    },
    {
      "key": "ACTOR_OBJ_PZLBLOCK",
      "name": "puzzle block",
      "kind": "actor",
      "s2h": 258
    },
    {
      "key": "ACTOR_EN_RACEDOG",
      "name": "racetrack dog",
      "kind": "actor",
      "s2h": 494
    },
    {
      "key": "ACTOR_EN_RG",
      "name": "racing goron",
      "kind": "actor",
      "s2h": 631
    },
    {
      "key": "ACTOR_BG_LBFSHOT",
      "name": "rainbow hookshot pillar",
      "kind": "actor",
      "s2h": 663
    },
    {
      "key": "ACTOR_BG_HAKUGIN_ELVPOLE",
      "name": "raisable pillar",
      "kind": "actor",
      "s2h": 419
    },
    {
      "key": "ACTOR_EN_RAT",
      "name": "real bombchu",
      "kind": "enemy",
      "s2h": 367
    },
    {
      "key": "ACTOR_EN_BBFALL",
      "name": "red bubble",
      "kind": "enemy",
      "s2h": 60
    },
    {
      "key": "ACTOR_EN_HATA",
      "name": "red flag on post",
      "kind": "actor",
      "s2h": 26,
      "soh": 38
    },
    {
      "key": "ACTOR_EN_RD",
      "name": "redead gibdo",
      "kind": "enemy",
      "s2h": 76,
      "soh": 144
    },
    {
      "key": "ACTOR_EN_REEBA",
      "name": "reeba",
      "kind": "actor",
      "soh": 28
    },
    {
      "key": "ACTOR_MIR_RAY",
      "name": "reflectable light ray",
      "kind": "actor",
      "s2h": 98,
      "soh": 183
    },
    {
      "key": "ACTOR_MIR_RAY2",
      "name": "reflectable light ray",
      "kind": "actor",
      "s2h": 464
    },
    {
      "key": "ACTOR_OBJ_FIRESHIELD",
      "name": "ring of fire",
      "kind": "actor",
      "s2h": 354
    },
    {
      "key": "ACTOR_EN_RL",
      "name": "rl",
      "kind": "actor",
      "soh": 166
    },
    {
      "key": "ACTOR_OBJ_MURE2",
      "name": "rock circle spawner",
      "kind": "actor",
      "s2h": 179,
      "soh": 337
    },
    {
      "key": "ACTOR_EN_MM",
      "name": "rock sirloin",
      "kind": "actor",
      "s2h": 185,
      "soh": 354
    },
    {
      "key": "ACTOR_EN_GOROIWA",
      "name": "rolling boulder",
      "kind": "actor",
      "s2h": 153,
      "soh": 304
    },
    {
      "key": "ACTOR_EN_MA4",
      "name": "romani",
      "kind": "actor",
      "s2h": 420
    },
    {
      "key": "ACTOR_EN_MA_YTS",
      "name": "romani",
      "kind": "actor",
      "s2h": 543
    },
    {
      "key": "ACTOR_OBJ_SMORK",
      "name": "romani ranch chimney smoke",
      "kind": "actor",
      "s2h": 343
    },
    {
      "key": "ACTOR_OBJ_ROOMTIMER",
      "name": "room timer",
      "kind": "enemy",
      "s2h": 211,
      "soh": 391
    },
    {
      "key": "ACTOR_BG_FU_KAITEN",
      "name": "rotating platform",
      "kind": "actor",
      "s2h": 430
    },
    {
      "key": "ACTOR_BG_IKANA_ROTARYROOM",
      "name": "rotating room",
      "kind": "actor",
      "s2h": 538
    },
    {
      "key": "ACTOR_BG_IKANA_BLOCK",
      "name": "rotating room pushblock",
      "kind": "actor",
      "s2h": 536
    },
    {
      "key": "ACTOR_EN_RU1",
      "name": "ru1",
      "kind": "actor",
      "soh": 161
    },
    {
      "key": "ACTOR_EN_RU2",
      "name": "ru2",
      "kind": "actor",
      "soh": 210
    },
    {
      "key": "ACTOR_EN_ESTONE",
      "name": "rubble",
      "kind": "actor",
      "s2h": 398
    },
    {
      "key": "ACTOR_OBJ_LUPYGAMELIFT",
      "name": "rupee elevator",
      "kind": "actor",
      "s2h": 461
    },
    {
      "key": "ACTOR_EN_SCOPECOIN",
      "name": "rupees",
      "kind": "actor",
      "s2h": 636
    },
    {
      "key": "ACTOR_EN_SA",
      "name": "sa",
      "kind": "actor",
      "soh": 326
    },
    {
      "key": "ACTOR_EN_SUTTARI",
      "name": "sakon",
      "kind": "actor",
      "s2h": 567
    },
    {
      "key": "ACTOR_OBJ_NOZOKI",
      "name": "sakon s hideout object",
      "kind": "actor",
      "s2h": 563
    },
    {
      "key": "ACTOR_OCEFF_WIPE3",
      "name": "saria s song ocarina effect",
      "kind": "actor",
      "s2h": 224,
      "soh": 409
    },
    {
      "key": "ACTOR_OCEFF_WIPE4",
      "name": "scarecrow s song ocarina effect",
      "kind": "actor",
      "s2h": 246,
      "soh": 459
    },
    {
      "key": "ACTOR_EN_SCENE_CHANGE",
      "name": "scene change",
      "kind": "actor",
      "soh": 36
    },
    {
      "key": "ACTOR_BG_MARKET_STEP",
      "name": "scenery",
      "kind": "actor",
      "s2h": 460
    },
    {
      "key": "ACTOR_EN_TANRON4",
      "name": "seagull",
      "kind": "actor",
      "s2h": 615
    },
    {
      "key": "ACTOR_EN_OT",
      "name": "seahorse",
      "kind": "actor",
      "s2h": 517
    },
    {
      "key": "ACTOR_EN_TAG_OBJ",
      "name": "seahorse spawner",
      "kind": "actor",
      "s2h": 481
    },
    {
      "key": "ACTOR_BG_DBLUE_BALANCE",
      "name": "seesaw waterwhell w platforms",
      "kind": "actor",
      "s2h": 539
    },
    {
      "key": "ACTOR_EN_BUBBLE",
      "name": "shabom",
      "kind": "enemy",
      "s2h": 29,
      "soh": 45
    },
    {
      "key": "ACTOR_BG_IKNV_DOUKUTU",
      "name": "sharp s cave",
      "kind": "actor",
      "s2h": 603
    },
    {
      "key": "ACTOR_EN_SB",
      "name": "shellblade",
      "kind": "enemy",
      "s2h": 100,
      "soh": 197
    },
    {
      "key": "ACTOR_EN_STONE_HEISHI",
      "name": "shiro",
      "kind": "actor",
      "s2h": 586
    },
    {
      "key": "ACTOR_EN_DEMO_HEISHI",
      "name": "shiro",
      "kind": "actor",
      "s2h": 622
    },
    {
      "key": "ACTOR_EN_SYATEKI_CROW",
      "name": "shooting gallery guay",
      "kind": "enemy",
      "s2h": 288
    },
    {
      "key": "ACTOR_EN_SYATEKI_MAN",
      "name": "shooting gallery guy",
      "kind": "actor",
      "s2h": 285,
      "soh": 193
    },
    {
      "key": "ACTOR_EN_SYATEKI_OKUTA",
      "name": "shooting gallery octorok",
      "kind": "enemy",
      "s2h": 335
    },
    {
      "key": "ACTOR_EN_SYATEKI_DEKUNUTS",
      "name": "shooting gallery scrub",
      "kind": "enemy",
      "s2h": 325
    },
    {
      "key": "ACTOR_EN_SYATEKI_WF",
      "name": "shooting gallery wolfos",
      "kind": "enemy",
      "s2h": 321
    },
    {
      "key": "ACTOR_EN_SOB1",
      "name": "shop",
      "kind": "actor",
      "s2h": 309
    },
    {
      "key": "ACTOR_EN_GIRLA",
      "name": "shop items",
      "kind": "actor",
      "s2h": 2,
      "soh": 4
    },
    {
      "key": "ACTOR_EN_SHOPNUTS",
      "name": "shopnuts",
      "kind": "enemy",
      "soh": 405
    },
    {
      "key": "ACTOR_EN_SIOFUKI",
      "name": "siofuki",
      "kind": "actor",
      "soh": 351
    },
    {
      "key": "ACTOR_EN_SKJ",
      "name": "skj",
      "kind": "enemy",
      "soh": 277
    },
    {
      "key": "ACTOR_EN_SKJNEEDLE",
      "name": "skjneedle",
      "kind": "enemy",
      "soh": 278
    },
    {
      "key": "ACTOR_EFF_STK",
      "name": "skull kid effect",
      "kind": "actor",
      "s2h": 629
    },
    {
      "key": "ACTOR_DM_STK",
      "name": "skull kid majora s mask",
      "kind": "actor",
      "s2h": 401
    },
    {
      "key": "ACTOR_EN_PR2",
      "name": "skullfish",
      "kind": "enemy",
      "s2h": 384
    },
    {
      "key": "ACTOR_BG_KIN2_PICTURE",
      "name": "skullkid painting",
      "kind": "actor",
      "s2h": 528
    },
    {
      "key": "ACTOR_TG_SW",
      "name": "skulltula bonk detector",
      "kind": "actor",
      "s2h": 487
    },
    {
      "key": "ACTOR_EN_SW",
      "name": "skullwalltula",
      "kind": "actor",
      "s2h": 80,
      "soh": 149
    },
    {
      "key": "ACTOR_EN_HIDDEN_NUTS",
      "name": "sleeping deku scrub",
      "kind": "actor",
      "s2h": 607
    },
    {
      "key": "ACTOR_BG_CRACE_MOVEBG",
      "name": "sliding doors",
      "kind": "actor",
      "s2h": 382
    },
    {
      "key": "ACTOR_BG_OPEN_SHUTTER",
      "name": "sliding doors",
      "kind": "actor",
      "s2h": 428
    },
    {
      "key": "ACTOR_OBJ_Y2SHUTTER",
      "name": "sliding grated shutters",
      "kind": "actor",
      "s2h": 555
    },
    {
      "key": "ACTOR_EN_TANRON3",
      "name": "small fish",
      "kind": "boss",
      "s2h": 575
    },
    {
      "key": "ACTOR_OBJ_KIBAKO",
      "name": "small grabbable crate",
      "kind": "actor",
      "s2h": 129,
      "soh": 272
    },
    {
      "key": "ACTOR_OBJ_SNOWBALL2",
      "name": "small snowball",
      "kind": "actor",
      "s2h": 505
    },
    {
      "key": "ACTOR_EN_BIGPAMET",
      "name": "snapper",
      "kind": "boss",
      "s2h": 324
    },
    {
      "key": "ACTOR_EN_KAME",
      "name": "snapper",
      "kind": "enemy",
      "s2h": 442
    },
    {
      "key": "ACTOR_EN_SNOWWD",
      "name": "snow covered tree",
      "kind": "actor",
      "s2h": 468
    },
    {
      "key": "ACTOR_OBJECT_KANKYO",
      "name": "snow rain bubble",
      "kind": "actor",
      "s2h": 81,
      "soh": 151
    },
    {
      "key": "ACTOR_OBJ_MAKEKINSUTA",
      "name": "soft soil w skulltula",
      "kind": "actor",
      "s2h": 249,
      "soh": 463
    },
    {
      "key": "ACTOR_EN_HEISHI",
      "name": "soldier",
      "kind": "actor",
      "s2h": 621
    },
    {
      "key": "ACTOR_EN_ENDING_HERO4",
      "name": "soldier watching moon",
      "kind": "actor",
      "s2h": 682
    },
    {
      "key": "ACTOR_OCEFF_WIPE7",
      "name": "song of healing ocarina effect",
      "kind": "actor",
      "s2h": 590
    },
    {
      "key": "ACTOR_EN_TEST7",
      "name": "song of soaring effect",
      "kind": "actor",
      "s2h": 462
    },
    {
      "key": "ACTOR_OCEFF_WIPE6",
      "name": "song of soaring ocarina effect",
      "kind": "actor",
      "s2h": 587
    },
    {
      "key": "ACTOR_OCEFF_STORM",
      "name": "song of storms ocarina effect",
      "kind": "actor",
      "s2h": 215,
      "soh": 395
    },
    {
      "key": "ACTOR_EN_OKARINA_EFFECT",
      "name": "song of storms storm",
      "kind": "actor",
      "s2h": 196,
      "soh": 368
    },
    {
      "key": "ACTOR_EN_TEST6",
      "name": "song of time effect",
      "kind": "actor",
      "s2h": 396
    },
    {
      "key": "ACTOR_OCEFF_WIPE",
      "name": "song of time ocarina effect",
      "kind": "actor",
      "s2h": 214,
      "soh": 394
    },
    {
      "key": "ACTOR_EN_ENCOUNT1",
      "name": "spawner",
      "kind": "actor",
      "s2h": 91,
      "soh": 167
    },
    {
      "key": "ACTOR_BG_SPDWEB",
      "name": "spider web",
      "kind": "actor",
      "s2h": 293
    },
    {
      "key": "ACTOR_OBJ_MINE",
      "name": "spike metal mine",
      "kind": "actor",
      "s2h": 389
    },
    {
      "key": "ACTOR_BG_KEIKOKU_SAKU",
      "name": "spiked fence",
      "kind": "actor",
      "s2h": 364
    },
    {
      "key": "ACTOR_OBJ_ROTLIFT",
      "name": "spiked rotating platform",
      "kind": "actor",
      "s2h": 549
    },
    {
      "key": "ACTOR_EN_M_THUNDER",
      "name": "spin attack sword beam",
      "kind": "actor",
      "s2h": 53,
      "soh": 87
    },
    {
      "key": "ACTOR_EN_GB2",
      "name": "spirit house owner",
      "kind": "actor",
      "s2h": 478
    },
    {
      "key": "ACTOR_BG_OPEN_SPOT",
      "name": "spotlight",
      "kind": "actor",
      "s2h": 429
    },
    {
      "key": "ACTOR_EN_TEST5",
      "name": "spring water modifier",
      "kind": "actor",
      "s2h": 395
    },
    {
      "key": "ACTOR_EN_KANBAN",
      "name": "square signpost",
      "kind": "actor",
      "s2h": 168,
      "soh": 321
    },
    {
      "key": "ACTOR_BOSS_SST",
      "name": "sst",
      "kind": "boss",
      "soh": 233
    },
    {
      "key": "ACTOR_DOOR_SPIRAL",
      "name": "staircase",
      "kind": "actor",
      "s2h": 256
    },
    {
      "key": "ACTOR_EN_SKB",
      "name": "stalchild",
      "kind": "enemy",
      "s2h": 237,
      "soh": 432
    },
    {
      "key": "ACTOR_EN_ENCOUNT4",
      "name": "stalchild fire wall spawner",
      "kind": "actor",
      "s2h": 283
    },
    {
      "key": "ACTOR_EN_RAIL_SKB",
      "name": "stalchildren circle",
      "kind": "enemy",
      "s2h": 530
    },
    {
      "key": "ACTOR_OBJ_BELL",
      "name": "stock pot inn bell",
      "kind": "actor",
      "s2h": 334
    },
    {
      "key": "ACTOR_OBJ_DHOUSE",
      "name": "stone bridge",
      "kind": "actor",
      "s2h": 482
    },
    {
      "key": "ACTOR_BG_F40_BLOCK",
      "name": "stone tower block",
      "kind": "actor",
      "s2h": 581
    },
    {
      "key": "ACTOR_BG_F40_SWITCH",
      "name": "stone tower floor switch",
      "kind": "actor",
      "s2h": 582
    },
    {
      "key": "ACTOR_OBJ_FUNEN",
      "name": "stone tower smoke",
      "kind": "actor",
      "s2h": 315
    },
    {
      "key": "ACTOR_OBJ_WTURN",
      "name": "stone tower temple inverter",
      "kind": "actor",
      "s2h": 39
    },
    {
      "key": "ACTOR_BG_F40_SWLIFT",
      "name": "stone tower vertically oscillating platform",
      "kind": "actor",
      "s2h": 199
    },
    {
      "key": "ACTOR_EN_ELFORG",
      "name": "stray fairy",
      "kind": "actor",
      "s2h": 432
    },
    {
      "key": "ACTOR_EN_ELFBUB",
      "name": "stray fairy",
      "kind": "actor",
      "s2h": 433
    },
    {
      "key": "ACTOR_EN_ELFGRP",
      "name": "stray fairy group manager",
      "kind": "actor",
      "s2h": 339
    },
    {
      "key": "ACTOR_DOOR_SHUTTER",
      "name": "studded lifting door ikana castle rolling door",
      "kind": "actor",
      "s2h": 30,
      "soh": 46
    },
    {
      "key": "ACTOR_OBJ_ENDING",
      "name": "stump lighting",
      "kind": "actor",
      "s2h": 688
    },
    {
      "key": "ACTOR_OBJ_LIGHTBLOCK",
      "name": "sun block",
      "kind": "actor",
      "s2h": 463
    },
    {
      "key": "ACTOR_SHOT_SUN",
      "name": "sun hitbox fairy spawner",
      "kind": "actor",
      "s2h": 208,
      "soh": 387
    },
    {
      "key": "ACTOR_OCEFF_SPOT",
      "name": "sun s song ocarina effect",
      "kind": "actor",
      "s2h": 204,
      "soh": 382
    },
    {
      "key": "ACTOR_OBJ_LIGHTSWITCH",
      "name": "sun switch stt flip switch",
      "kind": "actor",
      "s2h": 178,
      "soh": 336
    },
    {
      "key": "ACTOR_BG_INGATE",
      "name": "swamp tour boat",
      "kind": "actor",
      "s2h": 167,
      "soh": 320
    },
    {
      "key": "ACTOR_EN_SHN",
      "name": "swamp tourist center guide",
      "kind": "actor",
      "s2h": 453
    },
    {
      "key": "ACTOR_OBJ_HUNSUI",
      "name": "switch activated geyser",
      "kind": "actor",
      "s2h": 558
    },
    {
      "key": "ACTOR_OBJ_DOWSING",
      "name": "switch chest collectible detector",
      "kind": "actor",
      "s2h": 492
    },
    {
      "key": "ACTOR_EN_KENDO_JS",
      "name": "swordsman",
      "kind": "actor",
      "s2h": 495
    },
    {
      "key": "ACTOR_EN_SYATEKI_ITM",
      "name": "syateki itm",
      "kind": "actor",
      "soh": 192
    },
    {
      "key": "ACTOR_EN_SYATEKI_NIW",
      "name": "syateki niw",
      "kind": "actor",
      "soh": 323
    },
    {
      "key": "ACTOR_EN_TA",
      "name": "ta",
      "kind": "actor",
      "soh": 132
    },
    {
      "key": "ACTOR_EN_TAKARA_MAN",
      "name": "takara man",
      "kind": "actor",
      "soh": 380
    },
    {
      "key": "ACTOR_EN_THIEFBIRD",
      "name": "takkuri",
      "kind": "enemy",
      "s2h": 657
    },
    {
      "key": "ACTOR_EN_TALK_GIBUD",
      "name": "talking gibdo",
      "kind": "enemy",
      "s2h": 474
    },
    {
      "key": "ACTOR_EN_TANA",
      "name": "tana",
      "kind": "actor",
      "soh": 194
    },
    {
      "key": "ACTOR_EN_FU_MATO",
      "name": "target",
      "kind": "actor",
      "s2h": 435
    },
    {
      "key": "ACTOR_EN_TG",
      "name": "target game",
      "kind": "actor",
      "s2h": 233,
      "soh": 428
    },
    {
      "key": "ACTOR_EN_HS2",
      "name": "targetable nothing",
      "kind": "actor",
      "s2h": 231,
      "soh": 422
    },
    {
      "key": "ACTOR_ELF_MSG",
      "name": "tatl hint",
      "kind": "actor",
      "s2h": 139,
      "soh": 283
    },
    {
      "key": "ACTOR_ELF_MSG2",
      "name": "tatl hint",
      "kind": "actor",
      "s2h": 198,
      "soh": 371
    },
    {
      "key": "ACTOR_ELF_MSG4",
      "name": "tatl hint",
      "kind": "actor",
      "s2h": 471
    },
    {
      "key": "ACTOR_ELF_MSG6",
      "name": "tatl hint",
      "kind": "actor",
      "s2h": 562
    },
    {
      "key": "ACTOR_ELF_MSG3",
      "name": "tatl message",
      "kind": "actor",
      "s2h": 326
    },
    {
      "key": "ACTOR_ELF_MSG5",
      "name": "tatl message",
      "kind": "actor",
      "s2h": 472
    },
    {
      "key": "ACTOR_DM_CHAR00",
      "name": "tatl tael",
      "kind": "actor",
      "s2h": 402
    },
    {
      "key": "ACTOR_DM_CHAR04",
      "name": "tatl tael",
      "kind": "actor",
      "s2h": 406
    },
    {
      "key": "ACTOR_EN_TITE",
      "name": "tektite",
      "kind": "enemy",
      "s2h": 18,
      "soh": 27
    },
    {
      "key": "ACTOR_OBJ_SPIDERTENT",
      "name": "tent shaped spide web",
      "kind": "actor",
      "s2h": 500
    },
    {
      "key": "ACTOR_BG_KEIKOKU_SPR",
      "name": "termina field fountain water",
      "kind": "actor",
      "s2h": 63
    },
    {
      "key": "ACTOR_EN_TEST4",
      "name": "three day events",
      "kind": "actor",
      "s2h": 346
    },
    {
      "key": "ACTOR_EN_BAL",
      "name": "tingle",
      "kind": "actor",
      "s2h": 374
    },
    {
      "key": "ACTOR_DM_BAL",
      "name": "tingle",
      "kind": "actor",
      "s2h": 675
    },
    {
      "key": "ACTOR_EN_PAPER",
      "name": "tingle confetti",
      "kind": "actor",
      "s2h": 676
    },
    {
      "key": "ACTOR_EN_MAG",
      "name": "title logo",
      "kind": "actor",
      "s2h": 197,
      "soh": 369
    },
    {
      "key": "ACTOR_OBJ_SYOKUDAI",
      "name": "torch",
      "kind": "actor",
      "s2h": 57,
      "soh": 94
    },
    {
      "key": "ACTOR_EN_TORYO",
      "name": "toryo",
      "kind": "actor",
      "soh": 306
    },
    {
      "key": "ACTOR_EN_TOTO",
      "name": "toto",
      "kind": "actor",
      "s2h": 564
    },
    {
      "key": "ACTOR_EN_TP",
      "name": "tp",
      "kind": "enemy",
      "soh": 53
    },
    {
      "key": "ACTOR_EN_TR",
      "name": "tr",
      "kind": "actor",
      "soh": 204
    },
    {
      "key": "ACTOR_EN_AKINDONUTS",
      "name": "trade quest business scrub",
      "kind": "actor",
      "s2h": 628
    },
    {
      "key": "ACTOR_EN_OSSAN",
      "name": "trading post shop",
      "kind": "actor",
      "s2h": 42,
      "soh": 61
    },
    {
      "key": "ACTOR_EN_TRAP",
      "name": "trap",
      "kind": "actor",
      "soh": 128
    },
    {
      "key": "ACTOR_OBJ_TAKARAYA_WALL",
      "name": "treasure chest shop board manager",
      "kind": "actor",
      "s2h": 443
    },
    {
      "key": "ACTOR_EN_TAKARAYA",
      "name": "treasure chest shop girl",
      "kind": "actor",
      "s2h": 449
    },
    {
      "key": "ACTOR_OBJ_TREE",
      "name": "tree",
      "kind": "actor",
      "s2h": 553
    },
    {
      "key": "ACTOR_EN_WOOD02",
      "name": "tree shrub",
      "kind": "actor",
      "s2h": 65,
      "soh": 119
    },
    {
      "key": "ACTOR_DM_RAVINE",
      "name": "tree trunk",
      "kind": "actor",
      "s2h": 328
    },
    {
      "key": "ACTOR_OBJ_OCARINALIFT",
      "name": "triforce elevator",
      "kind": "actor",
      "s2h": 426
    },
    {
      "key": "ACTOR_EFF_KAMEJIMA_WAVE",
      "name": "turtle awakening wave",
      "kind": "actor",
      "s2h": 591
    },
    {
      "key": "ACTOR_BOSS_TW",
      "name": "tw",
      "kind": "boss",
      "soh": 220
    },
    {
      "key": "ACTOR_BOSS_02",
      "name": "twinmold",
      "kind": "boss",
      "s2h": 298
    },
    {
      "key": "ACTOR_BG_INIBS_MOVEBG",
      "name": "twinmold arena",
      "kind": "actor",
      "s2h": 551
    },
    {
      "key": "ACTOR_BG_CTOWER_ROT",
      "name": "twisting path w stone doors to clock tower",
      "kind": "actor",
      "s2h": 97
    },
    {
      "key": "ACTOR_OBJ_KZSAKU",
      "name": "underwater grate",
      "kind": "actor",
      "s2h": 650
    },
    {
      "key": "ACTOR_OBJ_WIND",
      "name": "updraft current water current",
      "kind": "actor",
      "s2h": 493
    },
    {
      "key": "ACTOR_BOSS_VA",
      "name": "va",
      "kind": "boss",
      "soh": 186
    },
    {
      "key": "ACTOR_EN_VALI",
      "name": "vali",
      "kind": "enemy",
      "soh": 99
    },
    {
      "key": "ACTOR_EN_CLEAR_TAG",
      "name": "various effects",
      "kind": "boss",
      "s2h": 162,
      "soh": 315
    },
    {
      "key": "ACTOR_EN_VASE",
      "name": "vase",
      "kind": "actor",
      "soh": 130
    },
    {
      "key": "ACTOR_EN_VB_BALL",
      "name": "vb ball",
      "kind": "boss",
      "soh": 173
    },
    {
      "key": "ACTOR_OBJ_VSPINYROLL",
      "name": "vertical spike rollers",
      "kind": "actor",
      "s2h": 342
    },
    {
      "key": "ACTOR_EN_BAISEN",
      "name": "viscen",
      "kind": "actor",
      "s2h": 620
    },
    {
      "key": "ACTOR_EN_ENDING_HERO2",
      "name": "viscen watching moon",
      "kind": "actor",
      "s2h": 680
    },
    {
      "key": "ACTOR_BG_FIRE_WALL",
      "name": "wall of fire from bgspoutfire",
      "kind": "actor",
      "s2h": 272
    },
    {
      "key": "ACTOR_EN_WALL_TUBO",
      "name": "wall tubo",
      "kind": "actor",
      "soh": 446
    },
    {
      "key": "ACTOR_EN_WALLMAS",
      "name": "wallmaster",
      "kind": "enemy",
      "s2h": 10,
      "soh": 17
    },
    {
      "key": "ACTOR_EN_FALL2",
      "name": "warp beam from moon",
      "kind": "actor",
      "s2h": 668
    },
    {
      "key": "ACTOR_EN_WARP_TAG",
      "name": "warp to moon trial entrance",
      "kind": "actor",
      "s2h": 278
    },
    {
      "key": "ACTOR_BOSS_04",
      "name": "wart",
      "kind": "boss",
      "s2h": 300
    },
    {
      "key": "ACTOR_EN_TANRON2",
      "name": "wart s bubble",
      "kind": "boss",
      "s2h": 574
    },
    {
      "key": "ACTOR_BG_FU_MIZU",
      "name": "water",
      "kind": "actor",
      "s2h": 444
    },
    {
      "key": "ACTOR_EN_WATER_EFFECT",
      "name": "water rock drop spawner gyorg splashing effect",
      "kind": "boss",
      "s2h": 368
    },
    {
      "key": "ACTOR_EN_STREAM",
      "name": "water vortex",
      "kind": "actor",
      "s2h": 184,
      "soh": 352
    },
    {
      "key": "ACTOR_BG_DBLUE_WATERFALL",
      "name": "waterfall",
      "kind": "actor",
      "s2h": 540
    },
    {
      "key": "ACTOR_BG_IKNV_OBJ",
      "name": "waterwheel stone tower door sakon s hideout door",
      "kind": "actor",
      "s2h": 604
    },
    {
      "key": "ACTOR_EN_DRS",
      "name": "wedding dress mannequin",
      "kind": "actor",
      "s2h": 673
    },
    {
      "key": "ACTOR_EN_WEIYER",
      "name": "weiyer",
      "kind": "enemy",
      "soh": 396
    },
    {
      "key": "ACTOR_OBJ_SHUTTER",
      "name": "west clock town bank closing shutter",
      "kind": "actor",
      "s2h": 337
    },
    {
      "key": "ACTOR_EN_GE1",
      "name": "white clad gerudo pirate",
      "kind": "actor",
      "s2h": 159,
      "soh": 312
    },
    {
      "key": "ACTOR_EN_KAREBABA",
      "name": "wilted dekubaba mini baba",
      "kind": "enemy",
      "s2h": 102,
      "soh": 199
    },
    {
      "key": "ACTOR_EN_WIZ",
      "name": "wizrobe",
      "kind": "enemy",
      "s2h": 349
    },
    {
      "key": "ACTOR_EN_WIZ_FIRE",
      "name": "wizrobe fire ice attack",
      "kind": "enemy",
      "s2h": 351
    },
    {
      "key": "ACTOR_EN_WIZ_BROCK",
      "name": "wizrobe warp platform",
      "kind": "actor",
      "s2h": 350
    },
    {
      "key": "ACTOR_EN_WF",
      "name": "wolfos white wolfos",
      "kind": "enemy",
      "s2h": 236,
      "soh": 431
    },
    {
      "key": "ACTOR_EN_WONDER_ITEM",
      "name": "wonder item",
      "kind": "actor",
      "soh": 274
    },
    {
      "key": "ACTOR_EN_WONDER_TALK",
      "name": "wonder talk",
      "kind": "actor",
      "soh": 327
    },
    {
      "key": "ACTOR_EN_WONDER_TALK2",
      "name": "wonder talk2",
      "kind": "actor",
      "soh": 389
    },
    {
      "key": "ACTOR_OBJ_TARU",
      "name": "wooden barrel breakable pirate panel",
      "kind": "actor",
      "s2h": 557
    },
    {
      "key": "ACTOR_EN_DOOR",
      "name": "wooden door",
      "kind": "actor",
      "s2h": 5,
      "soh": 9
    },
    {
      "key": "ACTOR_EN_DOOR_ETC",
      "name": "wooden door",
      "kind": "actor",
      "s2h": 423
    },
    {
      "key": "ACTOR_BG_LADDER",
      "name": "wooden ladder",
      "kind": "actor",
      "s2h": 355
    },
    {
      "key": "ACTOR_DM_CHAR01",
      "name": "woodfall scene object",
      "kind": "actor",
      "s2h": 403
    },
    {
      "key": "ACTOR_EN_XC",
      "name": "xc",
      "kind": "actor",
      "soh": 72
    },
    {
      "key": "ACTOR_EN_YABUSAME_MARK",
      "name": "yabusame mark",
      "kind": "actor",
      "soh": 303
    },
    {
      "key": "ACTOR_EN_YUKABYUN",
      "name": "yukabyun",
      "kind": "enemy",
      "soh": 107
    },
    {
      "key": "ACTOR_EN_ZF",
      "name": "zf",
      "kind": "enemy",
      "soh": 37
    },
    {
      "key": "ACTOR_EN_ZL1",
      "name": "zl1",
      "kind": "actor",
      "s2h": 27,
      "soh": 41
    },
    {
      "key": "ACTOR_EN_ZL2",
      "name": "zl2",
      "kind": "actor",
      "soh": 77
    },
    {
      "key": "ACTOR_EN_ZL3",
      "name": "zl3",
      "kind": "actor",
      "soh": 377
    },
    {
      "key": "ACTOR_EN_ZO",
      "name": "zora",
      "kind": "actor",
      "s2h": 248,
      "soh": 462
    },
    {
      "key": "ACTOR_EN_BOOM",
      "name": "zora boomerang",
      "kind": "actor",
      "s2h": 32,
      "soh": 50
    },
    {
      "key": "ACTOR_EN_ZOD",
      "name": "zora drummer tijo",
      "kind": "actor",
      "s2h": 568
    },
    {
      "key": "ACTOR_EN_ZORAEGG",
      "name": "zora egg",
      "kind": "actor",
      "s2h": 501
    },
    {
      "key": "ACTOR_EN_ZOT",
      "name": "zora with directions pot game zora",
      "kind": "actor",
      "s2h": 552
    },
    {
      "key": "ACTOR_EN_KBT",
      "name": "zubora",
      "kind": "actor",
      "s2h": 502
    }
  ],
  "items": [
    {
      "key": "ITEM_71",
      "name": "71",
      "s2h": true
    },
    {
      "key": "ITEM_72",
      "name": "72",
      "s2h": true
    },
    {
      "key": "ITEM_ARROW_FIRE",
      "name": "arrow fire",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_ARROW_ICE",
      "name": "arrow ice",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_ARROW_LIGHT",
      "name": "arrow light",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_ARROWS_10",
      "name": "arrows 10",
      "s2h": true
    },
    {
      "key": "ITEM_ARROWS_30",
      "name": "arrows 30",
      "s2h": true
    },
    {
      "key": "ITEM_ARROWS_40",
      "name": "arrows 40",
      "s2h": true
    },
    {
      "key": "ITEM_ARROWS_50",
      "name": "arrows 50",
      "s2h": true
    },
    {
      "key": "ITEM_ARROWS_LARGE",
      "name": "arrows large",
      "soh": true
    },
    {
      "key": "ITEM_ARROWS_MEDIUM",
      "name": "arrows medium",
      "soh": true
    },
    {
      "key": "ITEM_ARROWS_SMALL",
      "name": "arrows small",
      "soh": true
    },
    {
      "key": "ITEM_B8",
      "name": "b8",
      "s2h": true
    },
    {
      "key": "ITEM_B9",
      "name": "b9",
      "s2h": true
    },
    {
      "key": "ITEM_BA",
      "name": "ba",
      "s2h": true
    },
    {
      "key": "ITEM_BB",
      "name": "bb",
      "s2h": true
    },
    {
      "key": "ITEM_BC",
      "name": "bc",
      "s2h": true
    },
    {
      "key": "ITEM_BD",
      "name": "bd",
      "s2h": true
    },
    {
      "key": "ITEM_BE",
      "name": "be",
      "s2h": true
    },
    {
      "key": "ITEM_BEAN",
      "name": "bean",
      "soh": true
    },
    {
      "key": "ITEM_BF",
      "name": "bf",
      "s2h": true
    },
    {
      "key": "ITEM_BIG_POE",
      "name": "big poe",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BLUE_FIRE",
      "name": "blue fire",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMB",
      "name": "bomb",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMB_BAG_20",
      "name": "bomb bag 20",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMB_BAG_30",
      "name": "bomb bag 30",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMB_BAG_40",
      "name": "bomb bag 40",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBCHU",
      "name": "bombchu",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBCHUS_1",
      "name": "bombchus 1",
      "s2h": true
    },
    {
      "key": "ITEM_BOMBCHUS_10",
      "name": "bombchus 10",
      "s2h": true
    },
    {
      "key": "ITEM_BOMBCHUS_20",
      "name": "bombchus 20",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBCHUS_5",
      "name": "bombchus 5",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBERS_NOTEBOOK",
      "name": "bombers notebook",
      "s2h": true
    },
    {
      "key": "ITEM_BOMBS_10",
      "name": "bombs 10",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBS_20",
      "name": "bombs 20",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBS_30",
      "name": "bombs 30",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOMBS_5",
      "name": "bombs 5",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOOMERANG",
      "name": "boomerang",
      "soh": true
    },
    {
      "key": "ITEM_BOOTS_HOVER",
      "name": "boots hover",
      "soh": true
    },
    {
      "key": "ITEM_BOOTS_IRON",
      "name": "boots iron",
      "soh": true
    },
    {
      "key": "ITEM_BOOTS_KOKIRI",
      "name": "boots kokiri",
      "soh": true
    },
    {
      "key": "ITEM_BOTTLE",
      "name": "bottle",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOW",
      "name": "bow",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BOW_ARROW_FIRE",
      "name": "bow arrow fire",
      "soh": true
    },
    {
      "key": "ITEM_BOW_ARROW_ICE",
      "name": "bow arrow ice",
      "soh": true
    },
    {
      "key": "ITEM_BOW_ARROW_LIGHT",
      "name": "bow arrow light",
      "soh": true
    },
    {
      "key": "ITEM_BOW_FIRE",
      "name": "bow fire",
      "s2h": true
    },
    {
      "key": "ITEM_BOW_ICE",
      "name": "bow ice",
      "s2h": true
    },
    {
      "key": "ITEM_BOW_LIGHT",
      "name": "bow light",
      "s2h": true
    },
    {
      "key": "ITEM_BRACELET",
      "name": "bracelet",
      "soh": true
    },
    {
      "key": "ITEM_BUG",
      "name": "bug",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_BULLET_BAG_30",
      "name": "bullet bag 30",
      "soh": true
    },
    {
      "key": "ITEM_BULLET_BAG_40",
      "name": "bullet bag 40",
      "soh": true
    },
    {
      "key": "ITEM_BULLET_BAG_50",
      "name": "bullet bag 50",
      "soh": true
    },
    {
      "key": "ITEM_C0",
      "name": "c0",
      "s2h": true
    },
    {
      "key": "ITEM_C1",
      "name": "c1",
      "s2h": true
    },
    {
      "key": "ITEM_C2",
      "name": "c2",
      "s2h": true
    },
    {
      "key": "ITEM_C3",
      "name": "c3",
      "s2h": true
    },
    {
      "key": "ITEM_C4",
      "name": "c4",
      "s2h": true
    },
    {
      "key": "ITEM_C5",
      "name": "c5",
      "s2h": true
    },
    {
      "key": "ITEM_C6",
      "name": "c6",
      "s2h": true
    },
    {
      "key": "ITEM_C7",
      "name": "c7",
      "s2h": true
    },
    {
      "key": "ITEM_C8",
      "name": "c8",
      "s2h": true
    },
    {
      "key": "ITEM_C9",
      "name": "c9",
      "s2h": true
    },
    {
      "key": "ITEM_CA",
      "name": "ca",
      "s2h": true
    },
    {
      "key": "ITEM_CB",
      "name": "cb",
      "s2h": true
    },
    {
      "key": "ITEM_CC",
      "name": "cc",
      "s2h": true
    },
    {
      "key": "ITEM_CHATEAU",
      "name": "chateau",
      "s2h": true
    },
    {
      "key": "ITEM_CHATEAU_2",
      "name": "chateau 2",
      "s2h": true
    },
    {
      "key": "ITEM_CHICKEN",
      "name": "chicken",
      "soh": true
    },
    {
      "key": "ITEM_CLAIM_CHECK",
      "name": "claim check",
      "soh": true
    },
    {
      "key": "ITEM_COJIRO",
      "name": "cojiro",
      "soh": true
    },
    {
      "key": "ITEM_COMPASS",
      "name": "compass",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_DEED_LAND",
      "name": "deed land",
      "s2h": true
    },
    {
      "key": "ITEM_DEED_MOUNTAIN",
      "name": "deed mountain",
      "s2h": true
    },
    {
      "key": "ITEM_DEED_OCEAN",
      "name": "deed ocean",
      "s2h": true
    },
    {
      "key": "ITEM_DEED_SWAMP",
      "name": "deed swamp",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_NUT",
      "name": "deku nut",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_NUT_UPGRADE_30",
      "name": "deku nut upgrade 30",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_NUT_UPGRADE_40",
      "name": "deku nut upgrade 40",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_NUTS_10",
      "name": "deku nuts 10",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_NUTS_5",
      "name": "deku nuts 5",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_PRINCESS",
      "name": "deku princess",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_STICK",
      "name": "deku stick",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_STICK_UPGRADE_20",
      "name": "deku stick upgrade 20",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_STICK_UPGRADE_30",
      "name": "deku stick upgrade 30",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_STICKS_10",
      "name": "deku sticks 10",
      "s2h": true
    },
    {
      "key": "ITEM_DEKU_STICKS_5",
      "name": "deku sticks 5",
      "s2h": true
    },
    {
      "key": "ITEM_DINS_FIRE",
      "name": "dins fire",
      "soh": true
    },
    {
      "key": "ITEM_DOUBLE_DEFENSE",
      "name": "double defense",
      "soh": true
    },
    {
      "key": "ITEM_DOUBLE_MAGIC",
      "name": "double magic",
      "soh": true
    },
    {
      "key": "ITEM_DUNGEON_MAP",
      "name": "dungeon map",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_EYEDROPS",
      "name": "eyedrops",
      "soh": true
    },
    {
      "key": "ITEM_FAIRY",
      "name": "fairy",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_FARORES_WIND",
      "name": "farores wind",
      "soh": true
    },
    {
      "key": "ITEM_FC",
      "name": "fc",
      "s2h": true
    },
    {
      "key": "ITEM_FD",
      "name": "fd",
      "s2h": true
    },
    {
      "key": "ITEM_FE",
      "name": "fe",
      "s2h": true
    },
    {
      "key": "ITEM_FISH",
      "name": "fish",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_FISHING_POLE",
      "name": "fishing pole",
      "soh": true
    },
    {
      "key": "ITEM_FISHING_ROD",
      "name": "fishing rod",
      "s2h": true
    },
    {
      "key": "ITEM_FROG",
      "name": "frog",
      "soh": true
    },
    {
      "key": "ITEM_GAUNTLETS_GOLD",
      "name": "gauntlets gold",
      "soh": true
    },
    {
      "key": "ITEM_GAUNTLETS_SILVER",
      "name": "gauntlets silver",
      "soh": true
    },
    {
      "key": "ITEM_GERUDO_CARD",
      "name": "gerudo card",
      "soh": true
    },
    {
      "key": "ITEM_GOLD_DUST",
      "name": "gold dust",
      "s2h": true
    },
    {
      "key": "ITEM_GOLD_DUST_2",
      "name": "gold dust 2",
      "s2h": true
    },
    {
      "key": "ITEM_GORON_RUBY",
      "name": "goron ruby",
      "soh": true
    },
    {
      "key": "ITEM_HAMMER",
      "name": "hammer",
      "soh": true
    },
    {
      "key": "ITEM_HEART",
      "name": "heart",
      "soh": true
    },
    {
      "key": "ITEM_HEART_CONTAINER",
      "name": "heart container",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_HEART_PIECE",
      "name": "heart piece",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_HEART_PIECE_2",
      "name": "heart piece 2",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_HOOKSHOT",
      "name": "hookshot",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_HOT_SPRING_WATER",
      "name": "hot spring water",
      "s2h": true
    },
    {
      "key": "ITEM_HYLIAN_LOACH",
      "name": "hylian loach",
      "s2h": true
    },
    {
      "key": "ITEM_HYLIAN_LOACH_2",
      "name": "hylian loach 2",
      "s2h": true
    },
    {
      "key": "ITEM_INVALID_1",
      "name": "invalid 1",
      "s2h": true
    },
    {
      "key": "ITEM_INVALID_2",
      "name": "invalid 2",
      "s2h": true
    },
    {
      "key": "ITEM_INVALID_3",
      "name": "invalid 3",
      "s2h": true
    },
    {
      "key": "ITEM_INVALID_4",
      "name": "invalid 4",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_INVALID_5",
      "name": "invalid 5",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_INVALID_6",
      "name": "invalid 6",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_INVALID_7",
      "name": "invalid 7",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_INVALID_8",
      "name": "invalid 8",
      "soh": true
    },
    {
      "key": "ITEM_KEY_BOSS",
      "name": "key boss",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_KEY_SMALL",
      "name": "key small",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_KOKIRI_EMERALD",
      "name": "kokiri emerald",
      "soh": true
    },
    {
      "key": "ITEM_LAST_USED",
      "name": "last used",
      "soh": true
    },
    {
      "key": "ITEM_LENS",
      "name": "lens",
      "soh": true
    },
    {
      "key": "ITEM_LENS_OF_TRUTH",
      "name": "lens of truth",
      "s2h": true
    },
    {
      "key": "ITEM_LETTER_MAMA",
      "name": "letter mama",
      "s2h": true
    },
    {
      "key": "ITEM_LETTER_RUTO",
      "name": "letter ruto",
      "soh": true
    },
    {
      "key": "ITEM_LETTER_TO_KAFEI",
      "name": "letter to kafei",
      "s2h": true
    },
    {
      "key": "ITEM_LETTER_ZELDA",
      "name": "letter zelda",
      "soh": true
    },
    {
      "key": "ITEM_LONGSHOT",
      "name": "longshot",
      "soh": true
    },
    {
      "key": "ITEM_MAGIC_BEANS",
      "name": "magic beans",
      "s2h": true
    },
    {
      "key": "ITEM_MAGIC_JAR_BIG",
      "name": "magic jar big",
      "s2h": true
    },
    {
      "key": "ITEM_MAGIC_JAR_SMALL",
      "name": "magic jar small",
      "s2h": true
    },
    {
      "key": "ITEM_MAGIC_LARGE",
      "name": "magic large",
      "soh": true
    },
    {
      "key": "ITEM_MAGIC_SMALL",
      "name": "magic small",
      "soh": true
    },
    {
      "key": "ITEM_MAP_POINT_CLOCK_TOWN",
      "name": "map point clock town",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_DEKU_PALACE",
      "name": "map point deku palace",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_GORON_VILLAGE",
      "name": "map point goron village",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_GREAT_BAY",
      "name": "map point great bay",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_GREAT_BAY_COAST",
      "name": "map point great bay coast",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_IKANA_CANYON",
      "name": "map point ikana canyon",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_IKANA_GRAVEYARD",
      "name": "map point ikana graveyard",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_MILK_ROAD",
      "name": "map point milk road",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_MOUNTAIN_VILLAGE",
      "name": "map point mountain village",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_ROMANI_RANCH",
      "name": "map point romani ranch",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_SNOWHEAD",
      "name": "map point snowhead",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_SOUTHERN_SWAMP",
      "name": "map point southern swamp",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_STONE_TOWER",
      "name": "map point stone tower",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_WOODFALL",
      "name": "map point woodfall",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_ZORA_CAPE",
      "name": "map point zora cape",
      "s2h": true
    },
    {
      "key": "ITEM_MAP_POINT_ZORA_HALL",
      "name": "map point zora hall",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_ALL_NIGHT",
      "name": "mask all night",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_BLAST",
      "name": "mask blast",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_BREMEN",
      "name": "mask bremen",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_BUNNY",
      "name": "mask bunny",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MASK_CAPTAIN",
      "name": "mask captain",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_CIRCUS_LEADER",
      "name": "mask circus leader",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_COUPLE",
      "name": "mask couple",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_DEKU",
      "name": "mask deku",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_DON_GERO",
      "name": "mask don gero",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_FIERCE_DEITY",
      "name": "mask fierce deity",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_GARO",
      "name": "mask garo",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_GERUDO",
      "name": "mask gerudo",
      "soh": true
    },
    {
      "key": "ITEM_MASK_GIANT",
      "name": "mask giant",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_GIBDO",
      "name": "mask gibdo",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_GORON",
      "name": "mask goron",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MASK_GREAT_FAIRY",
      "name": "mask great fairy",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_KAFEIS_MASK",
      "name": "mask kafeis mask",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_KAMARO",
      "name": "mask kamaro",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_KEATON",
      "name": "mask keaton",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MASK_POSTMAN",
      "name": "mask postman",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_ROMANI",
      "name": "mask romani",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_SCENTS",
      "name": "mask scents",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_SKULL",
      "name": "mask skull",
      "soh": true
    },
    {
      "key": "ITEM_MASK_SPOOKY",
      "name": "mask spooky",
      "soh": true
    },
    {
      "key": "ITEM_MASK_STONE",
      "name": "mask stone",
      "s2h": true
    },
    {
      "key": "ITEM_MASK_TRUTH",
      "name": "mask truth",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MASK_ZORA",
      "name": "mask zora",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MEDALLION_FIRE",
      "name": "medallion fire",
      "soh": true
    },
    {
      "key": "ITEM_MEDALLION_FOREST",
      "name": "medallion forest",
      "soh": true
    },
    {
      "key": "ITEM_MEDALLION_LIGHT",
      "name": "medallion light",
      "soh": true
    },
    {
      "key": "ITEM_MEDALLION_SHADOW",
      "name": "medallion shadow",
      "soh": true
    },
    {
      "key": "ITEM_MEDALLION_SPIRIT",
      "name": "medallion spirit",
      "soh": true
    },
    {
      "key": "ITEM_MEDALLION_WATER",
      "name": "medallion water",
      "soh": true
    },
    {
      "key": "ITEM_MILK",
      "name": "milk",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MILK_BOTTLE",
      "name": "milk bottle",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MILK_HALF",
      "name": "milk half",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_MOONS_TEAR",
      "name": "moons tear",
      "s2h": true
    },
    {
      "key": "ITEM_MUSHROOM",
      "name": "mushroom",
      "s2h": true
    },
    {
      "key": "ITEM_NAYRUS_LOVE",
      "name": "nayrus love",
      "soh": true
    },
    {
      "key": "ITEM_NONE",
      "name": "none",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_NONE_FE",
      "name": "none fe",
      "soh": true
    },
    {
      "key": "ITEM_NUT",
      "name": "nut",
      "soh": true
    },
    {
      "key": "ITEM_NUT_UPGRADE_30",
      "name": "nut upgrade 30",
      "soh": true
    },
    {
      "key": "ITEM_NUT_UPGRADE_40",
      "name": "nut upgrade 40",
      "soh": true
    },
    {
      "key": "ITEM_NUTS_10",
      "name": "nuts 10",
      "soh": true
    },
    {
      "key": "ITEM_NUTS_5",
      "name": "nuts 5",
      "soh": true
    },
    {
      "key": "ITEM_OBABA_DRINK",
      "name": "obaba drink",
      "s2h": true
    },
    {
      "key": "ITEM_OCARINA_FAIRY",
      "name": "ocarina fairy",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_OCARINA_OF_TIME",
      "name": "ocarina of time",
      "s2h": true
    },
    {
      "key": "ITEM_OCARINA_TIME",
      "name": "ocarina time",
      "soh": true
    },
    {
      "key": "ITEM_ODD_MUSHROOM",
      "name": "odd mushroom",
      "soh": true
    },
    {
      "key": "ITEM_ODD_POTION",
      "name": "odd potion",
      "soh": true
    },
    {
      "key": "ITEM_PENDANT_OF_MEMORIES",
      "name": "pendant of memories",
      "s2h": true
    },
    {
      "key": "ITEM_PICTOGRAPH_BOX",
      "name": "pictograph box",
      "s2h": true
    },
    {
      "key": "ITEM_POCKET_CUCCO",
      "name": "pocket cucco",
      "soh": true
    },
    {
      "key": "ITEM_POCKET_EGG",
      "name": "pocket egg",
      "soh": true
    },
    {
      "key": "ITEM_POE",
      "name": "poe",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_POTION_BLUE",
      "name": "potion blue",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_POTION_GREEN",
      "name": "potion green",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_POTION_RED",
      "name": "potion red",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_POWDER_KEG",
      "name": "powder keg",
      "s2h": true
    },
    {
      "key": "ITEM_PRESCRIPTION",
      "name": "prescription",
      "soh": true
    },
    {
      "key": "ITEM_QUIVER_30",
      "name": "quiver 30",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_QUIVER_40",
      "name": "quiver 40",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_QUIVER_50",
      "name": "quiver 50",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_RECOVERY_HEART",
      "name": "recovery heart",
      "s2h": true
    },
    {
      "key": "ITEM_REMAINS_GOHT",
      "name": "remains goht",
      "s2h": true
    },
    {
      "key": "ITEM_REMAINS_GYORG",
      "name": "remains gyorg",
      "s2h": true
    },
    {
      "key": "ITEM_REMAINS_ODOLWA",
      "name": "remains odolwa",
      "s2h": true
    },
    {
      "key": "ITEM_REMAINS_TWINMOLD",
      "name": "remains twinmold",
      "s2h": true
    },
    {
      "key": "ITEM_ROOM_KEY",
      "name": "room key",
      "s2h": true
    },
    {
      "key": "ITEM_RUPEE_10",
      "name": "rupee 10",
      "s2h": true
    },
    {
      "key": "ITEM_RUPEE_BLUE",
      "name": "rupee blue",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_RUPEE_GOLD",
      "name": "rupee gold",
      "soh": true
    },
    {
      "key": "ITEM_RUPEE_GREEN",
      "name": "rupee green",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_RUPEE_HUGE",
      "name": "rupee huge",
      "s2h": true
    },
    {
      "key": "ITEM_RUPEE_PURPLE",
      "name": "rupee purple",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_RUPEE_RED",
      "name": "rupee red",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_RUPEE_SILVER",
      "name": "rupee silver",
      "s2h": true
    },
    {
      "key": "ITEM_SAW",
      "name": "saw",
      "soh": true
    },
    {
      "key": "ITEM_SCALE_GOLDEN",
      "name": "scale golden",
      "soh": true
    },
    {
      "key": "ITEM_SCALE_SILVER",
      "name": "scale silver",
      "soh": true
    },
    {
      "key": "ITEM_SEAHORSE",
      "name": "seahorse",
      "s2h": true
    },
    {
      "key": "ITEM_SEAHORSE_CAUGHT",
      "name": "seahorse caught",
      "s2h": true
    },
    {
      "key": "ITEM_SEEDS",
      "name": "seeds",
      "soh": true
    },
    {
      "key": "ITEM_SEEDS_30",
      "name": "seeds 30",
      "soh": true
    },
    {
      "key": "ITEM_SHIELD_DEKU",
      "name": "shield deku",
      "soh": true
    },
    {
      "key": "ITEM_SHIELD_HERO",
      "name": "shield hero",
      "s2h": true
    },
    {
      "key": "ITEM_SHIELD_HYLIAN",
      "name": "shield hylian",
      "soh": true
    },
    {
      "key": "ITEM_SHIELD_MIRROR",
      "name": "shield mirror",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SINGLE_MAGIC",
      "name": "single magic",
      "soh": true
    },
    {
      "key": "ITEM_SKULL_TOKEN",
      "name": "skull token",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SLINGSHOT",
      "name": "slingshot",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SOLD_OUT",
      "name": "sold out",
      "soh": true
    },
    {
      "key": "ITEM_SONG_BOLERO",
      "name": "song bolero",
      "soh": true
    },
    {
      "key": "ITEM_SONG_ELEGY",
      "name": "song elegy",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_EPONA",
      "name": "song epona",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SONG_HEALING",
      "name": "song healing",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_LULLABY",
      "name": "song lullaby",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SONG_LULLABY_INTRO",
      "name": "song lullaby intro",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_MINUET",
      "name": "song minuet",
      "soh": true
    },
    {
      "key": "ITEM_SONG_NOCTURNE",
      "name": "song nocturne",
      "soh": true
    },
    {
      "key": "ITEM_SONG_NOVA",
      "name": "song nova",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_OATH",
      "name": "song oath",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_PRELUDE",
      "name": "song prelude",
      "soh": true
    },
    {
      "key": "ITEM_SONG_REQUIEM",
      "name": "song requiem",
      "soh": true
    },
    {
      "key": "ITEM_SONG_SARIA",
      "name": "song saria",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SONG_SERENADE",
      "name": "song serenade",
      "soh": true
    },
    {
      "key": "ITEM_SONG_SOARING",
      "name": "song soaring",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_SONATA",
      "name": "song sonata",
      "s2h": true
    },
    {
      "key": "ITEM_SONG_STORMS",
      "name": "song storms",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SONG_SUN",
      "name": "song sun",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SONG_TIME",
      "name": "song time",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SPRING_WATER",
      "name": "spring water",
      "s2h": true
    },
    {
      "key": "ITEM_STICK",
      "name": "stick",
      "soh": true
    },
    {
      "key": "ITEM_STICK_UPGRADE_20",
      "name": "stick upgrade 20",
      "soh": true
    },
    {
      "key": "ITEM_STICK_UPGRADE_30",
      "name": "stick upgrade 30",
      "soh": true
    },
    {
      "key": "ITEM_STICKS_10",
      "name": "sticks 10",
      "soh": true
    },
    {
      "key": "ITEM_STICKS_5",
      "name": "sticks 5",
      "soh": true
    },
    {
      "key": "ITEM_STONE_OF_AGONY",
      "name": "stone of agony",
      "soh": true
    },
    {
      "key": "ITEM_STRAY_FAIRIES",
      "name": "stray fairies",
      "s2h": true
    },
    {
      "key": "ITEM_SWORD_BGS",
      "name": "sword bgs",
      "soh": true
    },
    {
      "key": "ITEM_SWORD_BROKEN",
      "name": "sword broken",
      "soh": true
    },
    {
      "key": "ITEM_SWORD_DEITY",
      "name": "sword deity",
      "s2h": true
    },
    {
      "key": "ITEM_SWORD_GILDED",
      "name": "sword gilded",
      "s2h": true
    },
    {
      "key": "ITEM_SWORD_GREAT_FAIRY",
      "name": "sword great fairy",
      "s2h": true
    },
    {
      "key": "ITEM_SWORD_KNIFE",
      "name": "sword knife",
      "soh": true
    },
    {
      "key": "ITEM_SWORD_KOKIRI",
      "name": "sword kokiri",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_SWORD_MASTER",
      "name": "sword master",
      "soh": true
    },
    {
      "key": "ITEM_SWORD_RAZOR",
      "name": "sword razor",
      "s2h": true
    },
    {
      "key": "ITEM_TINGLE_MAP",
      "name": "tingle map",
      "s2h": true
    },
    {
      "key": "ITEM_TUNIC_GORON",
      "name": "tunic goron",
      "soh": true
    },
    {
      "key": "ITEM_TUNIC_KOKIRI",
      "name": "tunic kokiri",
      "soh": true
    },
    {
      "key": "ITEM_TUNIC_ZORA",
      "name": "tunic zora",
      "soh": true
    },
    {
      "key": "ITEM_WALLET_ADULT",
      "name": "wallet adult",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_WALLET_DEFAULT",
      "name": "wallet default",
      "s2h": true
    },
    {
      "key": "ITEM_WALLET_GIANT",
      "name": "wallet giant",
      "s2h": true,
      "soh": true
    },
    {
      "key": "ITEM_WEIRD_EGG",
      "name": "weird egg",
      "soh": true
    },
    {
      "key": "ITEM_ZORA_EGG",
      "name": "zora egg",
      "s2h": true
    },
    {
      "key": "ITEM_ZORA_SAPPHIRE",
      "name": "zora sapphire",
      "soh": true
    }
  ]
};

// src/catalog.ts
var DEFAULT_ACTOR_PRICE = {
  boss: 300,
  enemy: 100,
  actor: 50
};
var DEFAULT_ITEM_PRICE = 50;
var DEFAULT_ACTOR_DISTANCE = 120;
var Catalog = class {
  #actors;
  #items;
  #overrides = {};
  constructor(base = BUNDLED_CATALOG) {
    this.#actors = base.actors;
    this.#items = base.items;
  }
  get actorCount() {
    return this.#actors.length;
  }
  get itemCount() {
    return this.#items.length;
  }
  /** Load the streamer's saved overrides (from ctx.storage). */
  setOverrides(overrides) {
    this.#overrides = overrides && typeof overrides === "object" ? overrides : {};
  }
  overrides() {
    return this.#overrides;
  }
  /** Patch one entry's override; returns the merged override map to persist. */
  setOverride(kind, key, patch) {
    const id = `${kind}:${key}`;
    const merged = {
      ...this.#overrides[id],
      ...patch
    };
    if (merged.enabled === true) delete merged.enabled;
    if (merged.price === void 0) delete merged.price;
    if (merged.distance === void 0) delete merged.distance;
    this.#overrides = {
      ...this.#overrides,
      [id]: merged
    };
    if (Object.keys(this.#overrides[id]).length === 0) {
      delete this.#overrides[id];
    }
    return this.#overrides;
  }
  #ov(kind, key) {
    return this.#overrides[`${kind}:${key}`] ?? {};
  }
  // ---- actors ----
  resolveActor(query) {
    return fuzzyResolve(query, this.#actors, (e) => e.name);
  }
  /** Exact lookup by catalog key — how a resolved command argument arrives. */
  actorByKey(key) {
    const k = (key ?? "").trim().toUpperCase();
    return this.#actors.find((e) => e.key.toUpperCase() === k);
  }
  /**
   * The enabled actors as options for a command argument (COM-57). The value is
   * the catalog key rather than an id, because the same actor is numbered
   * differently in each game — sail.spawn resolves it per game. Each carries
   * its price, so `!spawn ganon` costs what the grid says it costs, and its
   * spawn distance as `meta.distance` for the step to pass to safespawn.
   *
   * Every actor carries a distance rather than only the overridden ones:
   * `{arg.actor.meta.distance}` fails the step when the chosen option doesn't
   * have the key, which is the right behaviour for a typo but would otherwise
   * break `!spawn` for every actor nobody had tuned yet.
   */
  actorOptions() {
    return this.#actors.filter((e) => this.actorEnabled(e)).map((e) => ({
      value: e.key,
      label: e.name,
      cost: this.actorPrice(e),
      meta: {
        distance: String(this.actorDistance(e))
      }
    }));
  }
  actorEnabled(e) {
    return this.#ov("actor", e.key).enabled ?? true;
  }
  actorPrice(e) {
    return this.#ov("actor", e.key).price ?? DEFAULT_ACTOR_PRICE[e.kind];
  }
  /** Streamer override, else the catalog's own value, else the game default. */
  actorDistance(e) {
    return this.#ov("actor", e.key).distance ?? e.distance ?? DEFAULT_ACTOR_DISTANCE;
  }
  actorGames(e) {
    const games = [];
    if (e.soh !== void 0) games.push("soh");
    if (e.s2h !== void 0) games.push("2s2h");
    return games;
  }
  actorId(e, game) {
    return game === "soh" ? e.soh : e.s2h;
  }
  // ---- items ----
  resolveItem(query) {
    return fuzzyResolve(query, this.#items, (e) => e.name);
  }
  /** Enabled items as options. The value is the name the game's `give` takes. */
  itemOptions() {
    return this.#items.filter((e) => this.itemEnabled(e)).map((e) => ({
      value: e.name,
      cost: this.itemPrice(e)
    }));
  }
  itemEnabled(e) {
    return this.#ov("item", e.key).enabled ?? true;
  }
  itemPrice(e) {
    return this.#ov("item", e.key).price ?? DEFAULT_ITEM_PRICE;
  }
  itemGames(e) {
    const games = [];
    if (e.soh) games.push("soh");
    if (e.s2h) games.push("2s2h");
    return games;
  }
  // ---- grid ----
  /** Rows for the tab, optionally filtered by a search term. Capped by limit. */
  rows(kind, filter = "", limit = 200) {
    const f = filter.trim().toLowerCase();
    const out = [];
    if (kind === "actor") {
      for (const e of this.#actors) {
        if (f && !e.name.includes(f) && !e.key.toLowerCase().includes(f)) {
          continue;
        }
        out.push({
          kind: "actor",
          key: e.key,
          name: e.name,
          actorKind: e.kind,
          games: this.actorGames(e),
          price: this.actorPrice(e),
          defaultPrice: DEFAULT_ACTOR_PRICE[e.kind],
          enabled: this.actorEnabled(e),
          distance: this.actorDistance(e),
          defaultDistance: e.distance ?? DEFAULT_ACTOR_DISTANCE
        });
        if (out.length >= limit) break;
      }
    } else {
      for (const e of this.#items) {
        if (f && !e.name.includes(f) && !e.key.toLowerCase().includes(f)) {
          continue;
        }
        out.push({
          kind: "item",
          key: e.key,
          name: e.name,
          games: this.itemGames(e),
          price: this.itemPrice(e),
          defaultPrice: DEFAULT_ITEM_PRICE,
          enabled: this.itemEnabled(e)
        });
        if (out.length >= limit) break;
      }
    }
    return out;
  }
};

// src/launcher.ts
function psPath(p) {
  return p.replace(/\//g, "\\").replace(/'/g, "''");
}
function detachedCommand(path, cwd, os = Deno.build.os) {
  if (os !== "windows") return {
    cmd: path,
    args: []
  };
  return {
    cmd: "powershell",
    args: [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${psPath(path)}' -WorkingDirectory '${psPath(cwd)}'`
    ]
  };
}
var realLaunchHost = {
  stat: (path) => {
    Deno.statSync(path);
  },
  spawn: (path, cwd) => {
    const { cmd, args } = detachedCommand(path, cwd);
    const child = new Deno.Command(cmd, {
      // Only meaningful off Windows, where we exec the game itself.
      cwd: cmd === path ? cwd : void 0,
      args,
      stdout: "null",
      stderr: "null",
      stdin: "null"
    }).spawn();
    child.unref();
  }
};
var realRunner = {
  async run(cmd, args) {
    const out = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "null"
    }).output();
    return {
      stdout: new TextDecoder().decode(out.stdout)
    };
  }
};
function buildPickerScript(title) {
  const safeTitle = title.replace(/'/g, "''");
  return [
    "Add-Type -AssemblyName System.Windows.Forms;",
    "$f = New-Object System.Windows.Forms.OpenFileDialog;",
    "$f.Filter = 'Executables (*.exe)|*.exe|All files (*.*)|*.*';",
    `$f.Title = '${safeTitle}';`,
    "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK)",
    "{ [Console]::Out.Write($f.FileName) }"
  ].join(" ");
}
function makeFilePicker(runner = realRunner, os = Deno.build.os) {
  return {
    async pick(title) {
      if (os !== "windows") return null;
      try {
        const { stdout } = await runner.run("powershell", [
          "-NoProfile",
          "-STA",
          "-Command",
          buildPickerScript(title)
        ]);
        return stdout.trim() || null;
      } catch {
        return null;
      }
    }
  };
}
function dirOf(p) {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? "." : norm.slice(0, idx);
}
function launchGame(exePath, host = realLaunchHost) {
  const path = (exePath ?? "").trim();
  if (!path) {
    return {
      ok: false,
      error: "no executable path set \u2014 add one in the plugin settings"
    };
  }
  try {
    host.stat(path);
  } catch {
    return {
      ok: false,
      error: `not found: ${path}`
    };
  }
  try {
    host.spawn(path, dirOf(path));
    return {
      ok: true
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// src/tab.ts
var _a;
var TAB_HTML = String.raw(_a || (_a = __template([`
<style>
  .wrap { max-width: 52rem; }
  .status { display: flex; gap: .6rem; flex-wrap: wrap; margin-bottom: .8rem; }
  .pill { border-radius: 999px; padding: .25rem .7rem; font-size: .85rem; border: 1px solid #333; background: #1b1922; }
  .pill.on { border-color: #3ea66b; color: #6fe3a0; }
  .pill.off { color: #9b95ab; }
  .pill.err { border-color: #a6553e; color: #e39b8a; }
  .bar { display: flex; gap: .5rem; align-items: center; margin-bottom: .6rem; flex-wrap: wrap; }
  .game-row { display: flex; gap: .5rem; align-items: center; margin-bottom: .4rem; }
  .game-row .launch { white-space: nowrap; }
  input.path { flex: 1; }
  button, input, select { font: inherit; }
  button { background: #17151d; border: 1px solid #322e3f; color: #e8e5f0; border-radius: 8px; padding: .35rem .7rem; cursor: pointer; }
  button:hover { border-color: #9b6bff; }
  button.sel { border-color: #9b6bff; color: #9b6bff; }
  input[type=text], input[type=search] { background: #17151d; border: 1px solid #322e3f; color: #e8e5f0; border-radius: 8px; padding: .35rem .6rem; }
  input.price { width: 4.5rem; text-align: right; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; }
  th, td { text-align: left; padding: .3rem .5rem; border-bottom: 1px solid #262230; }
  th { color: #9b95ab; font-weight: 600; }
  td.dim, .dim { color: #7b7688; }
  .kind { font-size: .72rem; text-transform: uppercase; letter-spacing: .04em; color: #9b95ab; }
  .kind.boss { color: #e3b34a; }
  .kind.enemy { color: #e39b8a; }
  .games { font-size: .75rem; color: #7b7688; }
  #log { background: #141219; border: 1px solid #262230; border-radius: 8px; padding: .5rem .7rem; height: 9rem; overflow-y: auto; font-family: ui-monospace, monospace; font-size: .78rem; color: #b7b2c4; }
  #log div { white-space: pre-wrap; }
  .muted { color: #7b7688; font-size: .85rem; }
  .cap { margin: 1rem 0 .3rem; font-weight: 600; }
  #refreshMsg { font-size: .8rem; color: #9b95ab; }
</style>

<div class="wrap">
  <div class="status" id="status"><span class="muted">connecting\u2026</span></div>

  <div class="cap">Games</div>
  <div class="game-row">
    <button class="launch" data-game="soh">\u25B6 Launch SoH</button>
    <input type="text" class="path" id="path-soh" placeholder="path to soh.exe" />
    <button data-browse="soh">Browse\u2026</button>
  </div>
  <div class="game-row">
    <button class="launch" data-game="2s2h">\u25B6 Launch 2S2H</button>
    <input type="text" class="path" id="path-2s2h" placeholder="path to 2ship.exe" />
    <button data-browse="2s2h">Browse\u2026</button>
  </div>
  <div id="launchMsg" class="muted"></div>

  <div class="cap">Catalog</div>
  <div class="bar">
    <button id="tab-actor" class="sel" data-kind="actor">Actors</button>
    <button id="tab-item" data-kind="item">Items</button>
    <input type="search" id="filter" placeholder="filter by name\u2026" />
    <span class="muted" id="count"></span>
  </div>
  <table>
    <thead>
      <tr><th>On</th><th>Name</th><th>Games</th><th>Price</th><th id="distHead"></th></tr>
    </thead>
    <tbody id="rows"></tbody>
  </table>

  <div class="cap">Recent hooks</div>
  <div id="log"></div>

  <div class="cap">Lookups</div>
  <div class="bar">
    <button id="refresh">Refresh lookups</button>
    <span id="refreshMsg"></span>
  </div>
</div>

<script>
  (function () {
    var $ = function (id) { return document.getElementById(id); };
    var kind = "actor";
    var GAME = { soh: "SoH", "2s2h": "2S2H" };

    function req(msg) { return commander.request(msg); }

    function setMsg(t) { $("launchMsg").textContent = t; }

    // Launch buttons.
    Array.prototype.forEach.call(document.querySelectorAll(".launch"), function (b) {
      b.addEventListener("click", function () {
        var g = b.getAttribute("data-game");
        setMsg("launching " + GAME[g] + "\u2026");
        req({ type: "launch", game: g }).then(function (res) {
          if (!res) { setMsg("no response"); return; }
          setMsg(res.ok ? (GAME[g] + " launched") : (res.error || "launch failed"));
        });
      });
    });

    // Path fields: save on edit.
    ["soh", "2s2h"].forEach(function (g) {
      $("path-" + g).addEventListener("change", function () {
        req({ type: "set-path", game: g, path: $("path-" + g).value });
      });
    });

    // Browse buttons: open the native file dialog on the plugin side.
    Array.prototype.forEach.call(document.querySelectorAll("[data-browse]"), function (b) {
      b.addEventListener("click", function () {
        var g = b.getAttribute("data-browse");
        setMsg("opening file picker\u2026");
        req({ type: "browse", game: g }).then(function (res) {
          if (!res) { setMsg("no response"); return; }
          if (res.cancelled) { setMsg("cancelled"); return; }
          if (res.error) { setMsg(res.error); return; }
          if (res.path) { $("path-" + g).value = res.path; setMsg("selected: " + res.path); }
        });
      });
    });

    function loadPaths() {
      req({ type: "paths" }).then(function (res) {
        if (!res) return;
        $("path-soh").value = res.soh || "";
        $("path-2s2h").value = res["2s2h"] || "";
      });
    }

    function renderStatus(games) {
      var el = $("status");
      el.innerHTML = "";
      if (!games || !games.length) { el.innerHTML = '<span class="muted">no listeners</span>'; return; }
      games.forEach(function (g) {
        var span = document.createElement("span");
        var cls = g.error ? "err" : (g.connected ? "on" : "off");
        span.className = "pill " + cls;
        span.textContent = GAME[g.game] + ": " +
          (g.error ? "port error" : (g.connected ? "connected" : "waiting :" + g.port));
        el.appendChild(span);
      });
    }

    function renderRows(rows, total) {
      var body = $("rows");
      body.innerHTML = "";
      $("count").textContent = rows.length + (total > rows.length ? " of " + total + " (filter to see more)" : "");
      $("distHead").textContent = kind === "actor" ? "Distance" : "";
      rows.forEach(function (r) {
        var tr = document.createElement("tr");

        var on = document.createElement("td");
        var cb = document.createElement("input");
        cb.type = "checkbox"; cb.checked = r.enabled;
        cb.addEventListener("change", function () {
          req({ type: "toggle", entryKind: r.kind, key: r.key, enabled: cb.checked });
        });
        on.appendChild(cb); tr.appendChild(on);

        var name = document.createElement("td");
        name.textContent = r.name + " ";
        if (r.actorKind && r.actorKind !== "actor") {
          var k = document.createElement("span");
          k.className = "kind " + r.actorKind; k.textContent = r.actorKind;
          name.appendChild(k);
        }
        tr.appendChild(name);

        var games = document.createElement("td");
        games.className = "games";
        games.textContent = r.games.map(function (g) { return GAME[g]; }).join(" + ") || "\u2014";
        tr.appendChild(games);

        var priceCell = document.createElement("td");
        var price = document.createElement("input");
        price.type = "text"; price.className = "price"; price.value = String(r.price);
        price.title = "default " + r.defaultPrice;
        price.addEventListener("change", function () {
          var v = parseInt(price.value, 10);
          req({ type: "price", entryKind: r.kind, key: r.key, price: isNaN(v) ? null : v });
        });
        priceCell.appendChild(price); tr.appendChild(priceCell);

        // Distance is spawn-only, so items get an empty cell.
        var distCell = document.createElement("td");
        if (r.kind === "actor") {
          var dist = document.createElement("input");
          dist.type = "text"; dist.className = "price"; dist.value = String(r.distance);
          dist.title = "how far in front of the player it spawns (default " + r.defaultDistance + ") \u2014 blank to reset";
          dist.addEventListener("change", function () {
            var v = parseInt(dist.value, 10);
            req({ type: "distance", key: r.key, distance: isNaN(v) ? null : v })
              .then(loadRows);
          });
          distCell.appendChild(dist);
        }
        tr.appendChild(distCell);

        body.appendChild(tr);
      });
    }

    var filterTimer = null;
    function loadRows() {
      req({ type: "rows", kind: kind, filter: $("filter").value }).then(function (res) {
        if (res) renderRows(res.rows || [], res.total || 0);
      });
    }
    $("filter").addEventListener("input", function () {
      clearTimeout(filterTimer);
      filterTimer = setTimeout(loadRows, 150);
    });

    function selectKind(k) {
      kind = k;
      $("tab-actor").className = k === "actor" ? "sel" : "";
      $("tab-item").className = k === "item" ? "sel" : "";
      loadRows();
    }
    $("tab-actor").addEventListener("click", function () { selectKind("actor"); });
    $("tab-item").addEventListener("click", function () { selectKind("item"); });

    function logLine(line) {
      var el = $("log");
      var d = document.createElement("div");
      d.textContent = line;
      el.appendChild(d);
      while (el.childNodes.length > 200) el.removeChild(el.firstChild);
      el.scrollTop = el.scrollHeight;
    }

    $("refresh").addEventListener("click", function () {
      $("refreshMsg").textContent = "refreshing\u2026";
      req({ type: "refresh-lookups" }).then(function (res) {
        if (!res) { $("refreshMsg").textContent = "no response"; return; }
        if (res.error) { $("refreshMsg").textContent = res.error; return; }
        var ok = (res.results || []).filter(function (r) { return r.ok; }).length;
        var total = (res.results || []).length;
        $("refreshMsg").textContent = "updated " + ok + "/" + total + " tables";
      });
    });

    commander.on(function (msg) {
      if (!msg) return;
      if (msg.type === "status") renderStatus(msg.games);
      else if (msg.type === "hook") logLine(msg.line);
    });

    // Initial load.
    loadPaths();
    req({ type: "status" }).then(function (res) { if (res) renderStatus(res.games); });
    req({ type: "recent" }).then(function (res) {
      if (res && res.hooks) res.hooks.forEach(logLine);
    });
    loadRows();
  })();
<\/script>
`])));

// mod.ts
var LOOKUP_CACHE_KEY = "lookups_cache";
var OVERRIDES_KEY = "catalog_overrides";
var EXE_KEY = {
  soh: "soh_exe",
  "2s2h": "s2h_exe"
};
var GAME_TITLE = {
  soh: "Ship of Harkinian",
  "2s2h": "2 Ship 2 Harkinian"
};
var picker = makeFilePicker();
var DEFAULT_SOH_PORT = 43384;
var DEFAULT_S2H_PORT = 43385;
var DEFAULT_CONFIRM_WINDOW_MS = 1500;
var MAX_RECENT_HOOKS = 60;
var servers = /* @__PURE__ */ new Map();
var confirmer;
var lookups;
var recentHooks = [];
function stopAll() {
  for (const server of servers.values()) server.stop();
  servers.clear();
}
var plugin = definePlugin({
  id: "sail",
  name: "Sail Game Control",
  version: "0.3.0",
  update: "github:stoatmagote/commander-plugin-sail",
  apiVersion: 1,
  setup(ctx) {
    ctx.settings.define([
      {
        key: "soh_port",
        label: "Ship of Harkinian port",
        type: "number",
        default: DEFAULT_SOH_PORT,
        description: "The port SoH's Sail connects to. Must match the game's setting."
      },
      {
        key: "s2h_port",
        label: "2 Ship 2 Harkinian port",
        type: "number",
        default: DEFAULT_S2H_PORT,
        description: "The port 2S2H's Sail connects to. Must match the game's setting."
      },
      {
        key: "spawn_confirm",
        label: "Confirm spawns",
        type: "boolean",
        default: true,
        description: "Wait for the game to confirm a spawn (OnActorInit) before charging. Off = charge as soon as the command is accepted."
      },
      {
        key: "spawn_confirm_window_ms",
        label: "Spawn confirm window (ms)",
        type: "number",
        default: DEFAULT_CONFIRM_WINDOW_MS,
        description: "How long to wait for a spawn's OnActorInit before refunding."
      },
      {
        key: "lookups_url",
        label: "Lookups refresh URL",
        type: "string",
        default: "",
        description: "Base URL the Sail tab's Refresh button fetches <category>_<game>.json from. Leave blank to stick with the bundled tables."
      }
    ]);
    confirmer = new SpawnConfirmer();
    lookups = new LookupStore();
    lookups.applyCache(ctx.storage.get(LOOKUP_CACHE_KEY));
    const catalog = new Catalog();
    catalog.setOverrides(ctx.storage.get(OVERRIDES_KEY));
    const confirmEnabled = () => ctx.settings.get("spawn_confirm") === true;
    const windowMs = () => {
      const raw = Number(ctx.settings.get("spawn_confirm_window_ms"));
      return raw > 0 ? raw : DEFAULT_CONFIRM_WINDOW_MS;
    };
    const pushStatus = () => ctx.ui.send({
      type: "status",
      games: statusGames()
    });
    const recordHook = (game, hook) => {
      confirmer?.deliver(game, hook);
      const line = `[${game}] ${renderHook(game, hook)}`;
      recentHooks.push(line);
      while (recentHooks.length > MAX_RECENT_HOOKS) recentHooks.shift();
      ctx.log.debug(`[sail:${game}] ${renderHook(game, hook)}`);
      ctx.ui.send({
        type: "hook",
        line
      });
    };
    const port = (key, fallback) => {
      const raw = Number(ctx.settings.get(key));
      return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : fallback;
    };
    const startAll = () => {
      stopAll();
      for (const [game, key] of [
        [
          "soh",
          "soh_port"
        ],
        [
          "2s2h",
          "s2h_port"
        ]
      ]) {
        const fallback = game === "soh" ? DEFAULT_SOH_PORT : DEFAULT_S2H_PORT;
        servers.set(game, new SailServer({
          game,
          port: port(key, fallback),
          log: ctx.log,
          onHook: recordHook,
          onConnect: pushStatus,
          onDisconnect: pushStatus
        }));
      }
      for (const server of servers.values()) server.start();
    };
    startAll();
    const dispatch = new ServerDispatch(servers);
    const spawner = new Spawner(dispatch, confirmer);
    for (const spec of buildSailFunctions({
      dispatch
    })) {
      ctx.functions.register(spec);
    }
    ctx.functions.register(buildSpawnFunction({
      dispatch,
      spawner,
      catalog,
      confirmEnabled,
      windowMs
    }));
    ctx.functions.register({
      id: "status",
      name: "Sail status",
      description: "Report which games are connected, as {out.text}.",
      requires: {
        account: "none"
      },
      params: [],
      run: () => Promise.resolve({
        ok: true,
        out: {
          text: statusLine()
        }
      })
    });
    ctx.options.register({
      id: "actors",
      label: "Sail actors",
      list: () => catalog.actorOptions()
    });
    ctx.options.register({
      id: "items",
      label: "Sail items",
      list: () => catalog.itemOptions()
    });
    ctx.commands.registerDefault({
      key: "spawn",
      trigger: "spawn",
      description: "Spawn something in the game, e.g. !spawn cucco",
      params: [
        {
          name: "actor",
          type: "choice",
          optionSource: "sail.actors"
        }
      ],
      steps: [
        {
          // safespawn puts the actor in front of the player rather than on
          // their head, and loads its object first so actors the current scene
          // never loaded still work. Both games have it (SoH 9.2.3 was patched
          // to match 2S2H).
          //
          // `params` is everything after the actor id, so this sends
          // `safespawn <id> 0 <distance>` — 0 is the spawn parameter, and the
          // distance is the actor's own, editable per actor in the Sail tab.
          functionId: "sail.spawn",
          params: {
            target: "any",
            actorId: "{arg.actor}",
            verb: "safespawn",
            soh_verb: "safespawn",
            params: "0 {arg.actor.meta.distance}"
          }
        },
        {
          // Only reached when the spawn was confirmed — a failed step stops
          // the run — so the notification can never claim something that
          // didn't happen.
          functionId: "sail.notify",
          params: {
            // Exactly the games that confirmed the spawn — not "any"/"both",
            // which would announce a SoH-only actor inside 2S2H too.
            target: "{step1.out.games}",
            message: "{user} spawned a {arg.actor.label}!"
          }
        }
      ]
    });
    ctx.commands.registerDefault({
      key: "give",
      trigger: "give",
      description: "Give Link an item, e.g. !give bombs",
      params: [
        {
          name: "item",
          type: "choice",
          optionSource: "sail.items"
        }
      ],
      steps: [
        {
          functionId: "sail.command",
          params: {
            target: "any",
            command: "give {arg.item}"
          }
        }
      ]
    });
    ctx.commands.registerDefault({
      key: "status",
      trigger: "sail",
      description: "Report which games are connected.",
      usableBy: "streamer",
      steps: [
        {
          functionId: "sail.status",
          params: {}
        },
        {
          functionId: "core.say",
          params: {
            message: "{step1.out.text}",
            reply_to_invoker: "true"
          }
        }
      ]
    });
    ctx.ui.registerTab({
      id: "sail",
      title: "Sail",
      html: TAB_HTML
    });
    ctx.ui.onRequest((raw) => handleTabRequest(ctx, catalog, raw));
    ctx.settings.onChange((key) => {
      if (key === "soh_port" || key === "s2h_port") {
        ctx.log.info("port changed \u2014 restarting the Sail listeners");
        startAll();
        pushStatus();
      }
    });
  },
  teardown() {
    stopAll();
    confirmer?.cancelAll();
    confirmer = void 0;
    lookups = void 0;
    recentHooks.length = 0;
  }
});
var mod_default = plugin;
function statusGames() {
  return [
    ...servers.values()
  ].map((server) => ({
    game: server.game,
    connected: server.connected,
    listening: server.listening,
    port: server.port,
    error: server.error
  }));
}
async function handleTabRequest(ctx, catalog, raw) {
  const req = raw ?? {};
  switch (req.type) {
    case "status":
      return {
        games: statusGames()
      };
    case "recent":
      return {
        hooks: [
          ...recentHooks
        ]
      };
    case "paths":
      return {
        soh: String(ctx.storage.get(EXE_KEY.soh) ?? ""),
        "2s2h": String(ctx.storage.get(EXE_KEY["2s2h"]) ?? "")
      };
    case "set-path": {
      const game = req.game === "2s2h" ? "2s2h" : "soh";
      ctx.storage.set(EXE_KEY[game], String(req.path ?? "").trim());
      return {
        ok: true
      };
    }
    case "browse": {
      const game = req.game === "2s2h" ? "2s2h" : "soh";
      const path = await picker.pick(`Select the ${GAME_TITLE[game]} executable`);
      if (!path) return {
        cancelled: true
      };
      ctx.storage.set(EXE_KEY[game], path);
      return {
        path
      };
    }
    case "launch": {
      const game = req.game === "2s2h" ? "2s2h" : "soh";
      const exe = String(ctx.storage.get(EXE_KEY[game]) ?? "");
      const result = launchGame(exe);
      if (result.ok) ctx.log.info(`launched ${game}: ${exe}`);
      else ctx.log.warn(`launch ${game} failed: ${result.error}`);
      return result;
    }
    case "rows": {
      const kind = req.kind === "item" ? "item" : "actor";
      const filter = typeof req.filter === "string" ? req.filter : "";
      const rows = catalog.rows(kind, filter);
      const total = kind === "actor" ? catalog.actorCount : catalog.itemCount;
      return {
        rows,
        total
      };
    }
    case "toggle": {
      const kind = req.entryKind === "item" ? "item" : "actor";
      catalog.setOverride(kind, String(req.key), {
        enabled: req.enabled === true
      });
      ctx.storage.set(OVERRIDES_KEY, catalog.overrides());
      return {
        ok: true
      };
    }
    case "price": {
      const kind = req.entryKind === "item" ? "item" : "actor";
      const price = typeof req.price === "number" && req.price >= 0 ? req.price : void 0;
      catalog.setOverride(kind, String(req.key), {
        price
      });
      ctx.storage.set(OVERRIDES_KEY, catalog.overrides());
      return {
        ok: true
      };
    }
    case "distance": {
      const distance = typeof req.distance === "number" && req.distance > 0 ? req.distance : void 0;
      catalog.setOverride("actor", String(req.key), {
        distance
      });
      ctx.storage.set(OVERRIDES_KEY, catalog.overrides());
      return {
        ok: true
      };
    }
    case "refresh-lookups": {
      const url = String(ctx.settings.get("lookups_url") || "").trim();
      if (!url) return {
        error: "set a Lookups refresh URL in settings first"
      };
      if (!lookups) return {
        error: "not ready"
      };
      const results = await lookups.refresh((u) => fetch(u), url);
      ctx.storage.set(LOOKUP_CACHE_KEY, lookups.snapshot());
      return {
        results
      };
    }
    default:
      return {
        error: "unknown request"
      };
  }
}
function renderHook(game, hook) {
  if (lookups) return annotateHook(game, hook, lookups);
  const fields = Object.entries(hook).filter(([key]) => key !== "type").map(([key, value]) => `${key}=${String(value)}`).join(" ");
  return fields ? `${hook.type} ${fields}` : hook.type;
}
function statusLine() {
  const label = {
    soh: "SoH",
    "2s2h": "2S2H"
  };
  const parts = [
    ...servers.values()
  ].map((server) => {
    if (server.error) return `${label[server.game]}: port error`;
    if (!server.listening) return `${label[server.game]}: off`;
    return `${label[server.game]}: ${server.connected ? "connected" : `waiting on ${server.port}`}`;
  });
  return parts.length > 0 ? parts.join(" | ") : "Sail isn't listening.";
}
export {
  mod_default as default
};
