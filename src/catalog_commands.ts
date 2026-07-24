// src/catalog_commands.ts — the !spawn / !give chat commands (COM-50).
//
// One parametric command each, instead of hundreds of seeded rows. Each
// resolves the typed name against the catalog (fuzzy, with "did you mean"),
// checks the entry is enabled, charges its price (charge-first), acts on every
// connected game that has it, and refunds if nothing landed. Pure game control
// otherwise — anyone can run these.

import type {
  ChatApi,
  Ctx,
  Disposable,
  Invocation,
  PointsApi,
} from "@twitch-commander/plugin";
import type { SailGame } from "./protocol.ts";
import type { SailDispatch } from "./dispatch.ts";
import { GAME_LABEL } from "./dispatch.ts";
import type { Catalog } from "./catalog.ts";
import type { Spawner } from "./spawn.ts";

export interface CatalogCommandDeps {
  catalog: Catalog;
  dispatch: SailDispatch;
  spawner: Spawner;
  points: PointsApi;
  chat: ChatApi;
  confirmEnabled: () => boolean;
  windowMs: () => number;
  log: { info(m: string): void };
}

/** Register !spawn and !give; returns their disposables (auto-tracked by ctx). */
export function registerCatalogCommands(
  ctx: Ctx,
  deps: CatalogCommandDeps,
): Disposable[] {
  return [
    ctx.commands.register({
      trigger: "spawn",
      usableBy: "everyone",
      run: (inv) => handleSpawn(deps, inv),
    }),
    ctx.commands.register({
      trigger: "give",
      usableBy: "everyone",
      run: (inv) => handleGive(deps, inv),
    }),
  ];
}

function reply(deps: CatalogCommandDeps, inv: Invocation, text: string): void {
  deps.chat.send(text, { replyTo: inv.messageId }).catch(() => {});
}

/** Charge the price if points are on; returns the txn id (or null when off). */
function charge(
  deps: CatalogCommandDeps,
  inv: Invocation,
  price: number,
  reason: string,
  refId: string,
): { ok: true; txnId: number | null } | { ok: false } {
  if (!deps.points.enabled() || price <= 0) return { ok: true, txnId: null };
  const result = deps.points.tryCharge(inv.user.userId, price, {
    reason,
    refId,
  });
  if (result.ok) return { ok: true, txnId: result.txn.id };
  reply(
    deps,
    inv,
    `that costs ${price} points — you have ${result.balance}.`,
  );
  return { ok: false };
}

function refund(deps: CatalogCommandDeps, txnId: number | null): void {
  if (txnId !== null) {
    try {
      deps.points.refund(txnId, { reason: "sail: nothing landed" });
    } catch { /* points toggled off mid-flight — nothing to refund */ }
  }
}

async function handleSpawn(
  deps: CatalogCommandDeps,
  inv: Invocation,
): Promise<void> {
  const query = inv.args.join(" ").trim();
  if (!query) return reply(deps, inv, "usage: !spawn <name>");

  const result = deps.catalog.resolveActor(query);
  if (result.kind === "none") {
    return reply(deps, inv, `no actor matches "${query}".`);
  }
  if (result.kind === "suggest") {
    const names = result.entries.map((e) => e.name).join(", ");
    return reply(deps, inv, `did you mean: ${names}?`);
  }
  const entry = result.entry;
  if (!deps.catalog.actorEnabled(entry)) {
    return reply(deps, inv, `"${entry.name}" isn't available.`);
  }

  const games = deps.catalog.actorGames(entry).filter((g) =>
    deps.dispatch.connected(g)
  );
  if (games.length === 0) {
    return reply(deps, inv, connectHint(deps.catalog.actorGames(entry)));
  }

  const price = deps.catalog.actorPrice(entry);
  const charged = charge(deps, inv, price, `!spawn ${entry.name}`, entry.key);
  if (!charged.ok) return;

  const opts = {
    confirm: deps.confirmEnabled(),
    windowMs: deps.windowMs(),
  };
  const landed = await Promise.all(
    games.map((game) =>
      deps.spawner.spawn(game, deps.catalog.actorId(entry, game)!, opts)
    ),
  );
  if (!landed.some(Boolean)) {
    refund(deps, charged.txnId);
    return reply(
      deps,
      inv,
      deps.confirmEnabled()
        ? `couldn't spawn ${entry.name} — it may be invalid here. Refunded.`
        : `couldn't reach the game to spawn ${entry.name}. Refunded.`,
    );
  }
  const where = games.filter((_, i) => landed[i]).map((g) => GAME_LABEL[g]);
  deps.log.info(`!spawn ${entry.name} → ${where.join(", ")}`);
  reply(deps, inv, `spawned ${entry.name}!`);
}

async function handleGive(
  deps: CatalogCommandDeps,
  inv: Invocation,
): Promise<void> {
  const query = inv.args.join(" ").trim();
  if (!query) return reply(deps, inv, "usage: !give <item>");

  const result = deps.catalog.resolveItem(query);
  if (result.kind === "none") {
    return reply(deps, inv, `no item matches "${query}".`);
  }
  if (result.kind === "suggest") {
    const names = result.entries.map((e) => e.name).join(", ");
    return reply(deps, inv, `did you mean: ${names}?`);
  }
  const entry = result.entry;
  if (!deps.catalog.itemEnabled(entry)) {
    return reply(deps, inv, `"${entry.name}" isn't available.`);
  }

  const games = deps.catalog.itemGames(entry).filter((g) =>
    deps.dispatch.connected(g)
  );
  if (games.length === 0) {
    return reply(deps, inv, connectHint(deps.catalog.itemGames(entry)));
  }

  const price = deps.catalog.itemPrice(entry);
  const charged = charge(deps, inv, price, `!give ${entry.name}`, entry.key);
  if (!charged.ok) return;

  // Items are given by name (e.g. `give mask keaton`); no confirmation hook.
  const command = `give ${entry.name}`;
  const delivered = await Promise.all(
    games.map((game) => deps.dispatch.send(game, { type: "command", command })),
  );
  if (!delivered.some((s) => s === "success")) {
    refund(deps, charged.txnId);
    return reply(deps, inv, `couldn't give ${entry.name}. Refunded.`);
  }
  deps.log.info(`!give ${entry.name}`);
  reply(deps, inv, `gave ${entry.name}!`);
}

/** "X isn't connected" when the games that have this entry are all offline. */
function connectHint(games: SailGame[]): string {
  const names = games.map((g) => GAME_LABEL[g]).join(" or ");
  return `${names || "the game"} isn't connected.`;
}
