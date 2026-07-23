# commander-plugin-sail

A [Commander](https://github.com/stoatmagote/commander) plugin: let Twitch chat
control **Ship of Harkinian** (SoH) and **2 Ship 2 Harkinian** (2S2H) — spawn
actors, give items, fire effects, teleport — through the Sail protocol the games
already speak.

> Status: **scaffold (COM-17).** This commit is the repo skeleton; it loads and
> does nothing yet. Game control lands in follow-ups (see the roadmap below).

## Install

**Single file (recommended).** Drop `sail.plugin.js` into Commander's `plugins/`
folder and enable it on the Plugins page. Rebuild it after changing the source
with `deno task bundle`.

**From source (for development).** Drop the entry `mod.ts` **and** the `src/`
folder next to it into `plugins/` (Commander's loader doesn't recurse into
subfolders, so `src/` must sit alongside `mod.ts`). Editing anything under
`src/` needs a full Commander restart; the single-file bundle avoids that.

### Why a bundle, not a remote thin-entry

The original plan was a tiny `sail.plugin.ts` that imported the real code from a
tag-pinned `raw.githubusercontent` URL. That only works for a **public** repo,
and it needs the network on first load. This repo is private and Commander
already exposes the plugin API to plugins via an import-map alias
(`@twitch-commander/plugin`), so we instead ship a **self-contained bundle**
(`deno task bundle` → `sail.plugin.js`) — the same "drop ONE file" experience,
offline, no remote import. It's the same pattern the Segue and Predictions
plugins use.

### Release workflow

1. Bump `version` in `mod.ts` and `deno.json`.
2. `deno task bundle` to regenerate `sail.plugin.js`.
3. Commit, tag (e.g. `v0.2.0`), and attach `sail.plugin.js` to a GitHub release.

Commander's plugin update check reads this repo's latest release
(`update: "github:stoatmagote/commander-plugin-sail"` in the manifest) and
badges an out-of-date install.

## How it will work

SoH and 2S2H each **dial into** a small TCP server this plugin hosts (defaults:
SoH `43384`, 2S2H `43385`), speaking the Sail protocol (null-terminated JSON).
The plugin turns that into Commander functions (`sail.command`, `sail.effect`,
`sail.spawn`, `sail.teleport`) and catalog commands (`!spawn <name>`,
`!give <item>`), with a Sail tab showing per-game connection status. None of it
needs a Twitch account — it's pure game control.

## Roadmap

| Ticket | What                                                             |
| ------ | ---------------------------------------------------------------- |
| COM-17 | Repo scaffold (this commit)                                      |
| COM-36 | In-plugin TCP servers + Sail protocol client                     |
| COM-40 | Game-control functions (command / effect / teleport)             |
| COM-45 | Spawn with `OnActorInit` confirmation                            |
| COM-41 | Lookup tables (actor/item/scene/flag → name) + generator scripts |
| COM-50 | `!spawn` / `!give` catalog commands + the Sail tab               |

## Developing

```
deno task check    # type-check
deno task test     # unit tests
deno task fmt
deno task lint
deno task bundle    # → sail.plugin.js
```

`lookups/` holds generated name tables (COM-41); `scripts/` holds the generators
that build them from the game source trees.

## License

MIT
