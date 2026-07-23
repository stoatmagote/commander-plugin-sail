// commander-plugin-sail — control Ship of Harkinian / 2 Ship 2 Harkinian from
// Twitch.
//
// Drop this folder (or the bundled single file) into Commander's plugins/
// directory. This is the scaffold (COM-17): it loads and does nothing yet. The
// pieces land in follow-ups:
//   - COM-36  in-plugin TCP servers the games dial into + the Sail protocol
//   - COM-40  game-control functions (command / effect / teleport)
//   - COM-45  spawn with OnActorInit confirmation
//   - COM-41  lookup tables (actor/item/scene/flag → name) + generators
//   - COM-50  !spawn / !give catalog commands + the Sail tab
//
// Logic will live under src/; this entry wires it to Commander's ctx.

import { type Ctx, definePlugin, type Plugin } from "@twitch-commander/plugin";

const plugin: Plugin = definePlugin({
  id: "sail",
  name: "Sail Game Control",
  version: "0.1.0",
  update: "github:stoatmagote/commander-plugin-sail",
  apiVersion: 1,

  setup(ctx: Ctx) {
    ctx.log.info(
      "sail plugin loaded (scaffold — game control arrives in COM-36+)",
    );
  },
});

export default plugin;
