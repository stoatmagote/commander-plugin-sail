// src/tab.ts — the Sail control tab (COM-50).
//
// Live per-game connection status, a searchable catalog grid (enable/disable,
// price override, per-game availability), a rolling hook/event log, and a
// "refresh lookups" button. Talks to the plugin over window.commander
// (request/response + pushes); no modals (the sandbox blocks them).

export const TAB_HTML: string = String.raw`
<style>
  .wrap { max-width: 52rem; }
  .status { display: flex; gap: .6rem; flex-wrap: wrap; margin-bottom: .8rem; }
  .pill { border-radius: 999px; padding: .25rem .7rem; font-size: .85rem; border: 1px solid #333; background: #1b1922; }
  .pill.on { border-color: #3ea66b; color: #6fe3a0; }
  .pill.off { color: #9b95ab; }
  .pill.err { border-color: #a6553e; color: #e39b8a; }
  .bar { display: flex; gap: .5rem; align-items: center; margin-bottom: .6rem; flex-wrap: wrap; }
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
  <div class="status" id="status"><span class="muted">connecting…</span></div>

  <div class="cap">Catalog</div>
  <div class="bar">
    <button id="tab-actor" class="sel" data-kind="actor">Actors</button>
    <button id="tab-item" data-kind="item">Items</button>
    <input type="search" id="filter" placeholder="filter by name…" />
    <span class="muted" id="count"></span>
  </div>
  <table>
    <thead>
      <tr><th>On</th><th>Name</th><th>Games</th><th>Price</th></tr>
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
        games.textContent = r.games.map(function (g) { return GAME[g]; }).join(" + ") || "—";
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
      $("refreshMsg").textContent = "refreshing…";
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
    req({ type: "status" }).then(function (res) { if (res) renderStatus(res.games); });
    req({ type: "recent" }).then(function (res) {
      if (res && res.hooks) res.hooks.forEach(logLine);
    });
    loadRows();
  })();
</script>
`;
