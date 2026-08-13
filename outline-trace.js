"use strict";

const OutlineTrace = (() => {
  function polygonArea(points) {
    let sum = 0;
    for (let index = 0; index < points.length; index += 1) {
      const next = points[(index + 1) % points.length];
      sum += points[index].x * next.y - next.x * points[index].y;
    }
    return sum / 2;
  }

  function smooth(points, passes = 2) {
    let current = points;
    for (let pass = 0; pass < passes; pass += 1) {
      const next = [];
      for (let index = 0; index < current.length; index += 1) {
        const a = current[index];
        const b = current[(index + 1) % current.length];
        next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
        next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
      }
      current = next;
    }
    return current;
  }

  function simplify(points) {
    if (points.length <= 1200) return points;
    const step = Math.ceil(points.length / 1200);
    return points.filter((_, index) => index % step === 0);
  }

  function findLargestComponent(mask, width, height) {
    const visited = new Uint8Array(mask.length);
    let largest = [];
    const queue = new Int32Array(mask.length);

    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || visited[start]) continue;
      let read = 0;
      let write = 0;
      const component = [];
      queue[write++] = start;
      visited[start] = 1;

      while (read < write) {
        const index = queue[read++];
        component.push(index);
        const x = index % width;
        const y = Math.floor(index / width);
        if (x > 0) enqueue(index - 1);
        if (x + 1 < width) enqueue(index + 1);
        if (y > 0) enqueue(index - width);
        if (y + 1 < height) enqueue(index + width);
      }
      if (component.length > largest.length) largest = component;

      function enqueue(index) {
        if (mask[index] && !visited[index]) {
          visited[index] = 1;
          queue[write++] = index;
        }
      }
    }
    return largest;
  }

  function chooseBoundaryEdge(previous, candidates) {
    if (candidates.length === 1) return candidates[0].index;
    const previousAngle = Math.atan2(previous.y2 - previous.y1, previous.x2 - previous.x1);
    candidates.sort((a, b) => turnScore(previousAngle, a.edge) - turnScore(previousAngle, b.edge));
    return candidates[0].index;
  }

  function turnScore(previousAngle, edge) {
    const angle = Math.atan2(edge.y2 - edge.y1, edge.x2 - edge.x1);
    return (angle - previousAngle + Math.PI * 2) % (Math.PI * 2);
  }

  function buildOuterContour(component, width, height) {
    const componentMask = new Uint8Array(width * height);
    component.forEach((index) => {
      componentMask[index] = 1;
    });

    const edges = [];
    const addEdge = (x1, y1, x2, y2) => edges.push({ x1, y1, x2, y2, used: false });
    const isFilled = (x, y) => x >= 0 && x < width && y >= 0 && y < height && componentMask[y * width + x];

    component.forEach((index) => {
      const x = index % width;
      const y = Math.floor(index / width);
      if (!isFilled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!isFilled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!isFilled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!isFilled(x - 1, y)) addEdge(x, y + 1, x, y);
    });

    const byStart = new Map();
    edges.forEach((edge, index) => {
      const key = `${edge.x1},${edge.y1}`;
      const group = byStart.get(key) || [];
      group.push(index);
      byStart.set(key, group);
    });

    const loops = [];
    edges.forEach((edge, edgeIndex) => {
      if (edge.used) return;
      const loop = [];
      let currentIndex = edgeIndex;
      let guard = 0;
      while (guard < edges.length + 1) {
        const current = edges[currentIndex];
        if (current.used) break;
        current.used = true;
        loop.push({ x: current.x1, y: current.y1 });
        const nextKey = `${current.x2},${current.y2}`;
        const candidates = (byStart.get(nextKey) || []).filter((index) => !edges[index].used);
        if (!candidates.length) break;
        currentIndex = chooseBoundaryEdge(current, candidates.map((index) => ({ index, edge: edges[index] })));
        guard += 1;
      }
      if (loop.length >= 4) loops.push(loop);
    });

    loops.sort((a, b) => Math.abs(polygonArea(b)) - Math.abs(polygonArea(a)));
    return loops[0] || [];
  }

  function bounds(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  return Object.freeze({ smooth, simplify, findLargestComponent, buildOuterContour, bounds });
})();
