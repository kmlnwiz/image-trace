"use strict";

// The part-moving tools each shipped a fixed menu of orders — reading, reverse,
// random — with no way to say "this piece first, then that one". Panel Reveal
// grew a hand rolled picker for exactly that; this is the shared version behind
// the "指定" mode in every tool that moves pieces around.
(function exposeMotionOrder() {
  function createOrderPicker(options) {
    const grid = options.grid || null;
    const countLabel = options.countLabel || null;
    const editor = options.editor || null;
    let items = [];
    let order = [];

    function sanitize() {
      const valid = new Set(items.map((item) => item.id));
      const seen = new Set();
      order = order.filter((id) => {
        if (!valid.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    }

    // Picked ids lead in click order and everything else keeps its natural order
    // behind them, so even a partial selection yields a complete ranking.
    function ranks() {
      sanitize();
      const result = new Map(order.map((id, rank) => [id, rank]));
      let next = order.length;
      items.forEach((item) => {
        if (!result.has(item.id)) {
          result.set(item.id, next);
          next += 1;
        }
      });
      return result;
    }

    function refresh() {
      sanitize();
      if (grid) {
        grid.replaceChildren();
        items.forEach((item, index) => {
          const button = document.createElement("button");
          button.type = "button";
          const rank = order.indexOf(item.id);
          button.classList.toggle("is-assigned", rank >= 0);
          button.setAttribute("aria-label", `${item.label ?? index + 1} を順番に指定`);
          const label = document.createElement("span");
          label.textContent = String(item.label ?? index + 1);
          if (item.color) button.style.setProperty("--order-swatch", item.color);
          const badge = document.createElement("small");
          badge.textContent = rank >= 0 ? `${rank + 1}番` : String(index + 1);
          button.append(label, badge);
          button.addEventListener("click", () => {
            const current = order.indexOf(item.id);
            if (current >= 0) order.splice(current, 1);
            else order.push(item.id);
            refresh();
            options.onChange?.();
          });
          grid.append(button);
        });
      }
      if (countLabel) countLabel.value = `${order.length} / ${items.length}`;
    }

    return {
      setItems(next) {
        items = [...next];
        refresh();
      },
      getOrder() {
        sanitize();
        return [...order];
      },
      setOrder(next) {
        order = Array.isArray(next) ? [...next] : [];
        refresh();
      },
      ranks,
      refresh,
      selectAll() {
        order = items.map((item) => item.id);
        refresh();
        options.onChange?.();
      },
      clear() {
        order = [];
        refresh();
        options.onChange?.();
      },
      setVisible(visible) {
        if (editor) editor.hidden = !visible;
      },
    };
  }

  window.MotionOrder = { createOrderPicker };
})();
