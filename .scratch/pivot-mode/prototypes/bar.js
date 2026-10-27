// Prototype navigation bar, injected at the top of each sketch.
(function () {
  const pages = [
    ["index.html", "Overview"],
    ["a-sidebar-tabs.html", "A · Sidebar tabs"],
    ["b-unified-sidebar.html", "B · One sidebar + view switch"],
    ["c-mode-rail.html", "C · Mode rail + Pivot board"],
    ["d-always-on-deck.html", "D · Deck inside the chat"],
  ];
  const here = location.pathname.split("/").pop() || "index.html";
  const bar = document.createElement("div");
  bar.className = "proto-bar";
  bar.innerHTML =
    "<b>Pivot mode sketches</b>" +
    pages
      .map(([href, label]) => `<a href="${href}" class="${href === here ? "on" : ""}">${label}</a>`)
      .join("") +
    `<span class="hint">${document.body.dataset.hint || ""}</span>`;
  document.body.prepend(bar);
})();
