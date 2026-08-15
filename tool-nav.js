"use strict";

// Every tool page used to hand-pick two or three sibling links for its header,
// so the set of reachable tools depended on which page you happened to open.
// The catalogue below is the single source of truth and the switcher it builds
// is identical on every page.
(function exposeToolNavigation() {
  const TOOLS = [
    { file: "outline.html", name: "Outline Motion", summary: "透過画像の輪郭アニメーション", group: "画像" },
    { file: "color-focus.html", name: "Color Focus", summary: "選んだ色系統だけを着色", group: "画像" },
    { file: "slice-motion.html", name: "Slice Motion", summary: "画像を分割して組み上げる", group: "画像" },
    { file: "slide-puzzle.html", name: "Slide Puzzle", summary: "15パズルのように元へ戻す", group: "画像" },
    { file: "text-dial.html", name: "Dial Type", summary: "文字ダイヤルアニメーション", group: "文字" },
    { file: "text-reel.html", name: "Text Reel", summary: "スロットマシン風文字リール", group: "文字" },
    { file: "flip-panels.html", name: "Flip Panels", summary: "両面文字パネルを回転して確定", group: "文字" },
    { file: "word-conveyor.html", name: "Word Conveyor", summary: "電光掲示板のように1文を循環", group: "文字" },
    { file: "panel-reveal.html", name: "Panel Reveal", summary: "裏面から文章を1文字ずつ戻す", group: "文字" },
    { file: "polyomino-motion.html", name: "Polyomino Type", summary: "ばらけたミノを盤面へ戻す", group: "文字" },
    { file: "memory-flip.html", name: "Memory Flip", summary: "神経衰弱のようにめくって揃える", group: "文字" },
    { file: "reverse-kanji.html", name: "Kanji Writer", summary: "書き順アニメーション", group: "漢字" },
    { file: "random-kanji.html", name: "Random Kanji", summary: "ランダム画アニメーション", group: "漢字" },
    { file: "stroke-assemble.html", name: "Stroke Assemble", summary: "散らばった画を漢字へ戻す", group: "漢字" },
    { file: "radical-highlight.html", name: "Radical Highlight", summary: "部首や指定した画を強調する", group: "漢字" },
    { file: "grid-pulse.html", name: "Grid Pulse", summary: "格子が波打つループ背景", group: "背景" },
    { file: "color-grid.html", name: "Color Grid", summary: "格子の色が周期的に変わる", group: "背景" },
    { file: "gradient-loop.html", name: "Gradient Loop", summary: "色が漂うグラデーション背景", group: "背景" },
    { file: "stripe-drift.html", name: "Stripe Drift", summary: "縞と同心円が流れる背景", group: "背景" },
    { file: "noise-plasma.html", name: "Noise Plasma", summary: "うねる有機的な背景", group: "背景" },
  ];

  const GROUP_ORDER = ["画像", "文字", "漢字", "背景"];

  function currentFile() {
    return location.pathname.split("/").pop() || "index.html";
  }

  // Returns the header cluster every page shares, creating it when the page
  // only carried a brand block.
  function headerActions(header) {
    const existing = header.querySelector(".header-actions, .header-nav, .dial-nav, .kanji-nav");
    if (existing) {
      existing.classList.add("header-actions");
      existing.classList.remove("header-nav", "dial-nav", "kanji-nav");
      return existing;
    }
    const actions = document.createElement("div");
    actions.className = "header-actions";
    header.append(actions);
    return actions;
  }

  function buildSwitcher(activeFile) {
    const menu = document.createElement("details");
    menu.className = "tool-switcher";
    const summary = document.createElement("summary");
    const active = TOOLS.find((tool) => tool.file === activeFile);
    summary.innerHTML = `<span>${active ? active.name : "ツール"}</span><i aria-hidden="true">▾</i>`;
    summary.setAttribute("aria-label", "ほかのツールへ移動");
    const panel = document.createElement("div");
    panel.className = "tool-switcher-panel";

    GROUP_ORDER.forEach((group) => {
      const tools = TOOLS.filter((tool) => tool.group === group);
      if (!tools.length) return;
      const heading = document.createElement("p");
      heading.className = "tool-switcher-group";
      heading.textContent = group;
      panel.append(heading);
      tools.forEach((tool) => {
        const link = document.createElement("a");
        link.href = `./${tool.file}`;
        link.className = "tool-switcher-item";
        if (tool.file === activeFile) {
          link.classList.add("is-current");
          link.setAttribute("aria-current", "page");
        }
        link.innerHTML = `<strong></strong><small></small>`;
        link.querySelector("strong").textContent = tool.name;
        link.querySelector("small").textContent = tool.summary;
        panel.append(link);
      });
    });

    menu.append(summary, panel);
    document.addEventListener("click", (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    return menu;
  }

  function mountToolNav() {
    const header = document.querySelector(".tool-header");
    if (!header || header.querySelector(".tool-switcher")) return null;
    const actions = headerActions(header);
    // Page specific buttons stay first; the shared controls always trail them.
    [...actions.querySelectorAll(":scope > a:not(.home-link)")].forEach((link) => link.remove());
    const home = actions.querySelector(".home-link") || document.createElement("a");
    home.className = "home-link";
    home.href = "./index.html";
    home.setAttribute("aria-label", "ホーム");
    home.textContent = "⌂";
    actions.append(buildSwitcher(currentFile()), home);
    return actions;
  }

  window.MotionTools = { list: TOOLS, groups: GROUP_ORDER, mountToolNav };
})();
