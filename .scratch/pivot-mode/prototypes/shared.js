// Throwaway prototype logic shared by the Pivot view sketches. Not production code.
(function () {
  const PROVIDERS = { claude: "✳", codex: "◎", cursor: "▲" };
  const STATUS = {
    working: { label: "working", cls: "st-working" },
    waiting: { label: "waiting on approval", cls: "st-waiting" },
    "needs-decision": { label: "needs a decision", cls: "st-decision" },
    blocked: { label: "blocked", cls: "st-blocked" },
    paused: { label: "paused", cls: "st-paused" },
    done: { label: "done", cls: "st-done" },
    failed: { label: "failed", cls: "st-failed" },
    unreported: { label: "stopped, no report", cls: "st-unreported" },
  };

  const tm = (id, title, status, elapsed, extra = {}) => ({
    id,
    title,
    status,
    elapsed,
    kind: "ship",
    provider: "claude",
    pr: null,
    branch:
      "pivot/" +
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 28),
    phase: null,
    ...extra,
  });

  const data = {
    projects: [
      { id: "t3", name: "t3-pivot" },
      { id: "forest", name: "forest-ui" },
    ],
    chats: [
      { id: "c1", project: "t3", title: "Fix composer focus bug" },
      { id: "c2", project: "t3", title: "Review managed processes PR" },
      { id: "c3", project: "forest", title: "Button variant cleanup" },
    ],
    pivots: [
      {
        id: "p1",
        project: "t3",
        title: "Integrate firstmate into T3",
        provider: "claude",
        teammates: [
          tm("t1", "Teammate status reporting", "working", "3m", {
            pr: 23,
            phase: "tests passing, wiring the reducer",
          }),
          tm("t2", "Wake reactor", "working", "12m", {
            provider: "codex",
            phase: "bug reproduced",
          }),
          tm("t3", "Bootstrap service extraction", "done", "41m", { pr: 21 }),
          tm("t4", "Flaky checkpoint test", "needs-decision", "8m", { provider: "cursor" }),
          tm("t5", "Dispatch MCP tool", "waiting", "5m", { pr: 24 }),
          tm("t6", "Scout: Codex steer support", "done", "19m", { kind: "scout" }),
          tm("t7", "Merge head pinning", "unreported", "27m", { provider: "codex" }),
        ],
        decisions: [
          {
            id: "d1",
            teammate: "t4",
            question:
              "The checkpoint test fails 1 in 20 runs on CI. Retry it, or fix the race first?",
            options: ["Retry up to 3 times", "Fix the race before merging"],
            recommendation: "Fix the race. Retries hide a real ordering bug in the reactor.",
          },
        ],
        messages: [
          {
            who: "user",
            text: "Split the status work into its own teammates and keep me posted on anything that needs me.",
          },
          {
            who: "pivot",
            text: "Dispatched 7 teammates. Two are working, one needs your call on the flaky test.",
          },
          {
            who: "wake",
            summary: "3 teammates changed",
            items: [
              "Bootstrap service extraction: done, PR #21 green",
              "Flaky checkpoint test: needs a decision",
              "Merge head pinning: stopped without a report",
            ],
          },
          {
            who: "pivot",
            text: "PR #21 is ready to merge. Merge head pinning went quiet, I'm reading its transcript.",
          },
        ],
      },
      {
        id: "p2",
        project: "t3",
        title: "Mobile release prep",
        provider: "codex",
        teammates: [
          tm("t8", "Android Dev servers sheet check", "working", "6m", { provider: "codex" }),
          tm("t9", "iOS release build", "paused", "1h", {
            phase: "waiting on the App Store build queue",
          }),
        ],
        decisions: [],
        messages: [{ who: "user", text: "Get the mobile app ready for a release build." }],
      },
      {
        id: "p3",
        project: "forest",
        title: "Docs site",
        provider: "cursor",
        teammates: [
          tm("t10", "Component docs pages", "working", "2m", { provider: "cursor", pr: 7 }),
        ],
        decisions: [],
        messages: [{ who: "user", text: "Build a docs site for the components." }],
      },
    ],
  };

  const prefs = {}; // per-Pivot view state: layout, open style, open teammate

  function h(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const projectName = (id) => data.projects.find((p) => p.id === id).name;
  const pivotById = (id) => data.pivots.find((p) => p.id === id);
  const findTeammate = (id) => {
    for (const pivot of data.pivots) {
      const found = pivot.teammates.find((t) => t.id === id);
      if (found) return { pivot, teammate: found };
    }
    return null;
  };

  function toast(text) {
    const node = h("div", { class: "toast" }, text);
    document.body.append(node);
    setTimeout(() => node.remove(), 2600);
  }

  function seg(options, current, onPick) {
    return h(
      "div",
      { class: "seg" },
      options.map(([value, label]) =>
        h("button", { class: value === current ? "on" : "", onclick: () => onPick(value) }, label),
      ),
    );
  }

  function statusDot(status) {
    return h("span", { class: "dot " + STATUS[status].cls });
  }

  function card(teammate, pivot, { compact, open, onOpen }) {
    const st = STATUS[teammate.status];
    const openDecision = pivot.decisions.find((d) => d.teammate === teammate.id);
    return h(
      "button",
      {
        class: `card ${st.cls} ${compact ? "compact" : ""} ${open ? "open" : ""}`,
        onclick: () => onOpen(teammate.id),
      },
      h(
        "div",
        { class: "top" },
        h("span", { class: "proj" }, "▣ ", projectName(pivot.project)),
        h("span", {}, statusDot(teammate.status), `${teammate.elapsed} ${st.label}`),
      ),
      h(
        "div",
        { class: "title", title: teammate.title },
        teammate.kind === "scout" ? "Scout · " : "",
        teammate.title,
      ),
      h(
        "div",
        { class: "foot" },
        h("span", {}, teammate.pr ? `PR#${teammate.pr}` : teammate.branch),
        openDecision ? h("span", { class: "attn badge warn" }, "needs you") : null,
        h("span", { class: "prov" }, PROVIDERS[teammate.provider]),
      ),
    );
  }

  function renderMessages(messages) {
    return messages.map((m) => {
      if (m.who === "wake") {
        return h(
          "details",
          { class: "wake" },
          h("summary", {}, "↻ ", m.summary),
          h(
            "ul",
            {},
            m.items.map((i) => h("li", {}, i)),
          ),
        );
      }
      if (m.who === "brief") {
        return h(
          "details",
          { class: "msg pivot-marked" },
          h("summary", { class: "who" }, "From the Pivot · Brief (click to expand)"),
          h("div", {}, m.text),
        );
      }
      const who = { user: "You", pivot: "Pivot", teammate: "Teammate", steer: "From the Pivot" }[
        m.who
      ];
      const cls = m.who === "user" ? "msg user" : m.who === "steer" ? "msg pivot-marked" : "msg";
      return h("div", { class: cls }, h("div", { class: "who" }, who), m.text);
    });
  }

  function composer(onSend, placeholder, model) {
    const area = h("textarea", {
      placeholder: placeholder || "Ask anything, @tag files/folders, or / for commands",
    });
    const send = () => {
      if (!area.value.trim()) return;
      onSend(area.value.trim());
      area.value = "";
    };
    area.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    return h(
      "div",
      { class: "composer" },
      area,
      h(
        "div",
        { class: "row" },
        h("span", {}, model || "✳ Claude Opus 5"),
        h("span", {}, "Low · 1M"),
        h("span", {}, "Full access"),
        h("button", { class: "send", onclick: send }, "↑"),
      ),
    );
  }

  function decisionsStrip(pivot, rerender) {
    if (pivot.decisions.length === 0) return null;
    const state = prefs[pivot.id];
    return h(
      "div",
      { class: "decisions" },
      h(
        "div",
        { class: "head" },
        `◆ ${pivot.decisions.length} decision${pivot.decisions.length > 1 ? "s" : ""} for you`,
        h(
          "button",
          {
            class: "btn",
            onclick: () => {
              state.decisionsOpen = !state.decisionsOpen;
              rerender();
            },
          },
          state.decisionsOpen ? "Hide" : "Answer",
        ),
      ),
      state.decisionsOpen
        ? pivot.decisions.map((d) => {
            const name = "d-" + d.id;
            const free = h("input", { type: "text", placeholder: "Or answer in your own words" });
            return h(
              "div",
              { class: "decision" },
              h(
                "div",
                {},
                h("b", {}, findTeammate(d.teammate)?.teammate.title ?? "Pivot", ": "),
                d.question,
              ),
              d.options.map((o) =>
                h("label", {}, h("input", { type: "radio", name, value: o }), " ", o),
              ),
              h("div", { class: "rec" }, "Pivot recommends: ", d.recommendation),
              free,
              h(
                "button",
                {
                  class: "btn primary",
                  onclick: (e) => {
                    const picked = e.target
                      .closest(".decision")
                      .querySelector(`input[name="${name}"]:checked`);
                    const answer = free.value.trim() || picked?.value;
                    if (!answer) return toast("Pick an option or write an answer");
                    pivot.decisions = pivot.decisions.filter((x) => x.id !== d.id);
                    pivot.messages.push({ who: "user", text: `Decision: ${answer}` });
                    pivot.messages.push({
                      who: "pivot",
                      text: "Got it. Passing that to the teammate now.",
                    });
                    const t = findTeammate(d.teammate);
                    if (t) t.teammate.status = "working";
                    rerender();
                  },
                },
                "Send answer",
              ),
            );
          })
        : null,
    );
  }

  function pivotChat(pivot, rerender) {
    const msgs = h("div", { class: "msgs" }, renderMessages(pivot.messages));
    requestAnimationFrame(() => (msgs.scrollTop = msgs.scrollHeight));
    return h(
      "div",
      { class: "pv-chat" },
      msgs,
      decisionsStrip(pivot, rerender),
      composer(
        (text) => {
          pivot.messages.push({ who: "user", text });
          pivot.messages.push({ who: "pivot", text: "On it." });
          rerender();
        },
        "Talk to the Pivot",
        PROVIDERS[pivot.provider] +
          " " +
          { claude: "Claude Opus 5", codex: "GPT-5 Codex", cursor: "Cursor" }[pivot.provider],
      ),
    );
  }

  function teammateTranscript(teammate) {
    const lines = [
      {
        who: "brief",
        text: `Role: teammate. Intent: "${teammate.title}". Spec: implement, test, open a PR, report done with the PR URL.`,
      },
      {
        who: "teammate",
        text: "Created branch " + teammate.branch + ". Reading the relevant modules.",
      },
    ];
    if (teammate.phase)
      lines.push({ who: "teammate", text: "Status: working · " + teammate.phase });
    if (teammate.status === "done")
      lines.push({
        who: "teammate",
        text:
          teammate.kind === "scout"
            ? "Report submitted."
            : `Status: done · PR https://github.com/teoaliano/t3-pivot/pull/${teammate.pr ?? 20}`,
      });
    if (teammate.status === "needs-decision")
      lines.push({
        who: "teammate",
        text: "Status: needs-decision · retry the flaky test or fix the race?",
      });
    lines.push({ who: "steer", text: "Keep the reducer pure, put the IO in the reactor." });
    return lines;
  }

  // The expanded teammate: chat (read-only unless `writable`), worktree, dev server.
  function teammatePanel(teammate, pivot, { onClose, writable, rerender }) {
    const state = (prefs["tm-" + teammate.id] ||= { tab: "chat" });
    const pick = (tab) => {
      state.tab = tab;
      rerender();
    };
    let pane;
    if (state.tab === "chat") {
      pane = [
        h("div", { class: "msgs" }, renderMessages(teammateTranscript(teammate))),
        teammate.status === "waiting"
          ? h(
              "div",
              { class: "approval" },
              "Approval requested:",
              h("code", {}, "rm -rf node_modules/.cache"),
              h(
                "button",
                {
                  class: "btn primary",
                  onclick: () => {
                    teammate.status = "working";
                    toast("Approved. The Pivot is told you answered.");
                    rerender();
                  },
                },
                "Approve",
              ),
              " ",
              h(
                "button",
                {
                  class: "btn",
                  onclick: () => {
                    teammate.status = "blocked";
                    rerender();
                  },
                },
                "Deny",
              ),
            )
          : null,
        writable
          ? composer(
              () => toast("Sent to the teammate. The Pivot is woken with your message."),
              "Message this teammate directly",
            )
          : h(
              "div",
              { class: "readonly-note" },
              "Read-only here. Ask the Pivot to steer this teammate.",
            ),
      ];
    } else if (state.tab === "worktree") {
      pane = h(
        "div",
        { class: "diff" },
        h("div", {}, "worktree: ~/.t3/worktrees/t3-pivot/", teammate.branch),
        h("div", {}, " "),
        h(
          "div",
          {},
          "packages/shared/src/teammateStatus.ts  ",
          h("span", { class: "add" }, "+84"),
          " ",
          h("span", { class: "del" }, "-0"),
        ),
        h(
          "div",
          {},
          "apps/server/src/mcp/toolkits/teammate/tools.ts  ",
          h("span", { class: "add" }, "+41"),
          " ",
          h("span", { class: "del" }, "-2"),
        ),
        h(
          "div",
          {},
          "packages/contracts/src/orchestration.ts  ",
          h("span", { class: "add" }, "+23"),
          " ",
          h("span", { class: "del" }, "-1"),
        ),
        h("div", {}, " "),
        h("div", { class: "add" }, "+ export function combineTeammateStatus(report, runtime) {"),
        h("div", { class: "add" }, "+   if (runtime.hasPendingApprovals) return 'waiting';"),
      );
    } else {
      pane = h(
        "div",
        { class: "browser" },
        h(
          "div",
          { class: "bar" },
          h("span", {}, statusDot("done"), "dev server running"),
          h("div", { class: "url" }, "http://localhost:5733/"),
          h("button", { class: "btn" }, "Restart"),
          h("button", { class: "btn" }, "Stop"),
        ),
        h("div", { class: "page" }, "Preview of this teammate's dev server"),
      );
    }
    return [
      h(
        "div",
        { class: "tm-head" },
        h(
          "span",
          { class: "prov", style: "color:#e0714a;font-size:18px" },
          PROVIDERS[teammate.provider],
        ),
        h(
          "div",
          { class: "grow" },
          h("b", {}, teammate.title),
          h(
            "div",
            { class: "sub" },
            statusDot(teammate.status),
            STATUS[teammate.status].label,
            " · ",
            teammate.branch,
            teammate.pr ? ` · PR #${teammate.pr}` : "",
          ),
        ),
        onClose ? h("button", { class: "btn", onclick: onClose, title: "Esc" }, "✕ Close") : null,
      ),
      h(
        "div",
        { class: "tm-tabs" },
        [
          ["chat", "Chat"],
          ["worktree", "Worktree"],
          ["server", "Dev server"],
        ].map(([v, l]) =>
          h("button", { class: state.tab === v ? "on" : "", onclick: () => pick(v) }, l),
        ),
      ),
      h("div", { class: "tm-pane" }, pane),
    ];
  }

  // The Pivot view: a layout tree of row and column splits holding panes.
  // Options:
  //   exit: { label, onExit } shows a leave button top left
  //   center: node for the top-center slot (the Chat | Pivot view switch in option B)
  //   compactCards: smaller cards
  const PANES = {
    chat: "Pivot chat",
    teammates: "Teammates",
    teammate: "Teammate",
    preview: "Preview",
    files: "Files",
    diff: "Diff",
  };
  const FOLLOWS_FOCUS = ["teammate", "preview", "files", "diff"];
  const pane = (kind) => ({ type: "pane", kind });
  const split = (type, children) => ({ type, children, sizes: children.map(() => 1) });
  const PRESETS = {
    "Teammates top, chat bottom": () => ({
      ...split("col", [pane("teammates"), pane("chat")]),
      sizes: [1, 2.2],
    }),
    "Chat left, teammates right": () => split("row", [pane("chat"), pane("teammates")]),
    "Three columns": () => split("row", [pane("chat"), pane("teammates"), pane("teammate")]),
    "Preview at the bottom": () =>
      split("col", [split("row", [pane("chat"), pane("teammates")]), pane("preview")]),
  };
  const WALLPAPERS = { none: "None", sample: "Sample landscape", file: "Choose an image…" };
  const global = { wallpaper: "sample", wallpaperUrl: null, dim: 0.35 };

  const panesIn = (node) =>
    !node ? [] : node.type === "pane" ? [node.kind] : node.children.flatMap(panesIn);
  function removePane(node, kind) {
    if (!node) return null;
    if (node.type === "pane") return node.kind === kind ? null : node;
    const children = [],
      sizes = [];
    node.children.forEach((child, i) => {
      const kept = removePane(child, kind);
      if (kept) {
        children.push(kept);
        sizes.push(node.sizes[i]);
      }
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return { ...node, children, sizes };
  }
  function addAtEdge(root, kind, edge) {
    const type = edge === "left" || edge === "right" ? "row" : "col";
    const first = edge === "left" || edge === "top";
    if (!root) return pane(kind);
    if (root.type === type) {
      return {
        ...root,
        children: first ? [pane(kind), ...root.children] : [...root.children, pane(kind)],
        sizes: first ? [1, ...root.sizes] : [...root.sizes, 1],
      };
    }
    return split(type, first ? [pane(kind), root] : [root, pane(kind)]);
  }

  function mountPivotView(root, pivotId, options = {}) {
    const pivot = pivotById(pivotId);
    const state = (prefs[pivot.id] ||= {
      tree: PRESETS["Teammates top, chat bottom"](),
      focus: pivot.teammates[0]?.id ?? null,
      pins: {},
      menu: null,
      showFinished: false,
      decisionsOpen: false,
    });
    const rerender = () => mountPivotView(root, pivotId, options);
    const setMenu = (name) => {
      state.menu = state.menu === name ? null : name;
      rerender();
    };
    root.__escape = state.menu
      ? () => {
          state.menu = null;
          rerender();
        }
      : null;
    const shown = panesIn(state.tree);
    const focusTeammate = (id) => {
      state.focus = id;
      for (const kind of FOLLOWS_FOCUS) delete state.pins[kind];
      if (!panesIn(state.tree).includes("teammate"))
        state.tree = addAtEdge(state.tree, "teammate", "right");
      rerender();
    };
    const teammateFor = (kind) =>
      pivot.teammates.find((t) => t.id === (state.pins[kind] ?? state.focus)) ?? pivot.teammates[0];

    const menu = (name, items, style) =>
      state.menu === name
        ? h(
            "div",
            { class: "menu", style: style || "left:auto;right:0;width:220px" },
            items.map(([label, run]) =>
              h(
                "button",
                {
                  onclick: (e) => {
                    e.stopPropagation();
                    state.menu = null;
                    run();
                  },
                },
                label,
              ),
            ),
          )
        : null;

    function paneBody(kind) {
      if (kind === "chat") return pivotChat(pivot, rerender);
      if (kind === "teammates") {
        const live = pivot.teammates.filter((t) => t.status !== "done");
        const finished = pivot.teammates.filter((t) => t.status === "done");
        const cardFor = (t) =>
          card(t, pivot, {
            compact: options.compactCards,
            open: state.focus === t.id,
            onOpen: focusTeammate,
          });
        return h(
          "div",
          { class: "pv-cards" },
          live.map(cardFor),
          finished.length
            ? h(
                "button",
                {
                  class: "btn finished-chip",
                  onclick: () => {
                    state.showFinished = !state.showFinished;
                    rerender();
                  },
                },
                `${state.showFinished ? "▾" : "▸"} ${finished.length} finished`,
              )
            : null,
          state.showFinished ? finished.map(cardFor) : null,
        );
      }
      const t = teammateFor(kind);
      if (!t) return h("div", { class: "empty" }, "No teammates yet");
      if (kind === "teammate")
        return h("div", { class: "lt-teammate" }, teammatePanel(t, pivot, { rerender }));
      if (kind === "preview")
        return h(
          "div",
          { class: "browser" },
          h(
            "div",
            { class: "bar" },
            statusDot("done"),
            h("div", { class: "url" }, "http://localhost:57", 30 + pivot.teammates.indexOf(t), "/"),
            h("button", { class: "btn" }, "Stop"),
          ),
          h("div", { class: "page" }, "Dev server of ", t.title),
        );
      if (kind === "files")
        return h(
          "div",
          { class: "diff" },
          [
            "apps/",
            "  server/src/mcp/toolkits/teammate/",
            "    tools.ts",
            "packages/",
            "  shared/src/teammateStatus.ts",
            "  contracts/src/orchestration.ts",
            "AGENTS.md",
          ].map((l) => h("div", { style: "white-space:pre" }, l)),
        );
      return h(
        "div",
        { class: "diff" },
        h("div", {}, t.branch),
        h("div", { class: "add" }, "+ export function combineTeammateStatus(report, runtime) {"),
        h("div", { class: "add" }, "+   if (runtime.hasPendingApprovals) return 'waiting';"),
        h("div", { class: "del" }, "- // TODO: status"),
      );
    }

    function renderPane(kind) {
      const picker = FOLLOWS_FOCUS.includes(kind)
        ? h(
            "select",
            {
              class: "lt-pick",
              onchange: (e) => {
                if (e.target.value === "") delete state.pins[kind];
                else state.pins[kind] = e.target.value;
                rerender();
              },
            },
            h("option", { value: "" }, "Follows focus"),
            pivot.teammates.map((t) =>
              h("option", { value: t.id, selected: state.pins[kind] === t.id }, t.title),
            ),
          )
        : null;
      const moves = ["left", "right", "top", "bottom"].map((edge) => [
        `Move to ${edge}`,
        () => {
          state.tree = addAtEdge(removePane(state.tree, kind), kind, edge);
          rerender();
        },
      ]);
      const hide =
        shown.length > 1
          ? [
              [
                "Hide",
                () => {
                  state.tree = removePane(state.tree, kind);
                  rerender();
                },
              ],
            ]
          : [];
      return h(
        "div",
        { class: "lt-pane " + (kind === "teammates" ? "see-through" : "") },
        h(
          "div",
          { class: "lt-head" },
          h(
            "b",
            { class: "grow" },
            PANES[kind],
            FOLLOWS_FOCUS.includes(kind) && !state.pins[kind]
              ? h("span", { class: "label" }, " · ", teammateFor(kind)?.title ?? "")
              : null,
          ),
          picker,
          h(
            "button",
            {
              class: "btn",
              onclick: (e) => {
                e.stopPropagation();
                setMenu("pane-" + kind);
              },
            },
            "⋯",
          ),
          menu("pane-" + kind, [...hide, ...moves], "left:auto;right:6px;top:30px;width:170px"),
        ),
        h("div", { class: "lt-body" }, paneBody(kind)),
      );
    }

    function renderNode(node) {
      if (node.type === "pane") return renderPane(node.kind);
      const container = h("div", { class: "lt-split lt-" + node.type });
      node.children.forEach((child, i) => {
        if (i > 0) {
          const divider = h("div", { class: "lt-divider" });
          divider.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            const horizontal = node.type === "row";
            const cells = [...container.children].filter((c) => c.classList.contains("lt-cell"));
            const a = cells[i - 1],
              b = cells[i];
            const total = node.sizes[i - 1] + node.sizes[i];
            const span =
              (horizontal ? a.offsetWidth + b.offsetWidth : a.offsetHeight + b.offsetHeight) || 1;
            const start = horizontal ? e.clientX : e.clientY;
            const startA = node.sizes[i - 1];
            const move = (ev) => {
              const delta = (((horizontal ? ev.clientX : ev.clientY) - start) / span) * total;
              const next = Math.min(total - 0.15 * total, Math.max(0.15 * total, startA + delta));
              node.sizes[i - 1] = next;
              node.sizes[i] = total - next;
              a.style.flex = `${node.sizes[i - 1]} 1 0`;
              b.style.flex = `${node.sizes[i]} 1 0`;
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          });
          container.append(divider);
        }
        container.append(
          h("div", { class: "lt-cell", style: `flex:${node.sizes[i]} 1 0` }, renderNode(child)),
        );
      });
      return container;
    }

    const hidden = Object.keys(PANES).filter((k) => !shown.includes(k));
    const fileInput = h("input", {
      type: "file",
      accept: "image/*",
      style: "display:none",
      onchange: (e) => {
        const file = e.target.files[0];
        if (!file) return;
        global.wallpaperUrl = URL.createObjectURL(file);
        global.wallpaper = "file";
        rerender();
      },
    });

    const top = h(
      "div",
      { class: "pv-top" },
      h(
        "div",
        { class: "left" },
        options.exit
          ? h("button", { class: "btn", onclick: options.exit.onExit }, options.exit.label)
          : null,
        h(
          "div",
          {},
          h("b", {}, pivot.title),
          h(
            "div",
            { class: "label" },
            projectName(pivot.project),
            " · Pivot · ",
            pivot.teammates.length,
            " teammates",
          ),
        ),
      ),
      options.center || h("span"),
      h(
        "div",
        { class: "right" },
        h(
          "button",
          {
            class: "btn",
            onclick: (e) => {
              e.stopPropagation();
              setMenu("preset");
            },
          },
          "Layout ▾",
        ),
        menu(
          "preset",
          Object.keys(PRESETS).map((name) => [
            name,
            () => {
              state.tree = PRESETS[name]();
              rerender();
            },
          ]),
        ),
        h(
          "button",
          {
            class: "btn",
            disabled: hidden.length === 0,
            onclick: (e) => {
              e.stopPropagation();
              setMenu("add");
            },
          },
          "+ Pane ▾",
        ),
        menu(
          "add",
          hidden.map((kind) => [
            `Show ${PANES[kind]}`,
            () => {
              state.tree = addAtEdge(state.tree, kind, "right");
              rerender();
            },
          ]),
        ),
        h(
          "button",
          {
            class: "btn",
            onclick: (e) => {
              e.stopPropagation();
              setMenu("wall");
            },
          },
          "Wallpaper ▾",
        ),
        menu("wall", [
          ...Object.entries(WALLPAPERS).map(([key, label]) => [
            label,
            () => {
              if (key === "file") fileInput.click();
              else {
                global.wallpaper = key;
                rerender();
              }
            },
          ]),
          [
            `Dim: ${Math.round(global.dim * 100)}% (click to cycle)`,
            () => {
              global.dim = global.dim >= 0.6 ? 0 : global.dim + 0.15;
              rerender();
            },
          ],
        ]),
        fileInput,
        h(
          "button",
          {
            class: "btn",
            onclick: (e) => {
              e.stopPropagation();
              setMenu("more");
            },
          },
          "⋯",
        ),
        menu("more", [
          [
            "New Pivot conversation",
            () => toast("New Pivot takes over 5 live teammates and 1 decision. This one retires."),
          ],
          [
            "Edit the Pivot's contract",
            () => toast("Opens AGENTS.md in the project's Pivot home."),
          ],
        ]),
      ),
    );

    const wall =
      global.wallpaper === "file" && global.wallpaperUrl
        ? `background-image: linear-gradient(rgba(0,0,0,${global.dim}), rgba(0,0,0,${global.dim})), url(${global.wallpaperUrl}); background-size: cover; background-position: center;`
        : global.wallpaper === "sample"
          ? `background-image: linear-gradient(rgba(0,0,0,${global.dim}), rgba(0,0,0,${global.dim})), radial-gradient(ellipse at 20% 70%, #2f6b3a 0 18%, transparent 19%), radial-gradient(ellipse at 85% 75%, #2c5f35 0 16%, transparent 17%), linear-gradient(180deg, #1c3f63 0%, #4d86b8 38%, #6c9ec2 50%, #3e7a4c 62%, #2a5a34 80%, #1b3a22 100%);`
          : "background: #0e1116;";
    const body = h(
      "div",
      { class: "lt-root" },
      state.tree
        ? renderNode(state.tree)
        : h("div", { class: "empty" }, "Every pane is hidden. Use + Pane."),
    );
    root.replaceChildren(
      h(
        "div",
        {
          class: "pv",
          style: wall,
          onclick: () => {
            if (state.menu) {
              state.menu = null;
              rerender();
            }
          },
        },
        top,
        body,
      ),
    );
  }

  // An ordinary chat in the main pane: a normal thread, a Pivot shown as chat, or a teammate thread.
  function mountChat(root, { title, project, messages, center, onSend, note, placeholder, right }) {
    root.__escape = null;
    const msgs = h("div", { class: "msgs" }, renderMessages(messages));
    requestAnimationFrame(() => (msgs.scrollTop = msgs.scrollHeight));
    root.replaceChildren(
      h(
        "div",
        { class: "header" },
        h("div", { class: "left" }, projectName(project), " / ", h("b", {}, title)),
        center || h("span"),
        h(
          "div",
          { class: "right" },
          right || null,
          h("button", { class: "btn" }, "Open in editor"),
        ),
      ),
      h(
        "div",
        { class: "chat" },
        msgs,
        note ? h("div", { class: "readonly-note" }, note) : null,
        composer(onSend || (() => toast("Sent")), placeholder),
      ),
    );
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const node of document.querySelectorAll("*")) {
      if (node.__escape) return node.__escape();
    }
  });

  window.Proto = {
    data,
    STATUS,
    PROVIDERS,
    h,
    seg,
    card,
    statusDot,
    toast,
    projectName,
    pivotById,
    findTeammate,
    mountPivotView,
    mountChat,
    teammatePanel,
    teammateTranscript,
    prefs,
  };
})();
