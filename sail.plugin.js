// ../Commander/plugin-api/mod.ts
function definePlugin(plugin2) {
  return plugin2;
}

// mod.ts
var plugin = definePlugin({
  id: "sail",
  name: "Sail Game Control",
  version: "0.1.0",
  update: "github:stoatmagote/commander-plugin-sail",
  apiVersion: 1,
  setup(ctx) {
    ctx.log.info("sail plugin loaded (scaffold \u2014 game control arrives in COM-36+)");
  }
});
var mod_default = plugin;
export {
  mod_default as default
};
