"use strict";

const MEMORY_SETTINGS_KEY = "motion-lab:memory-flip-settings:v4";
const FONT_ASSET_KEY = "memory-flip-local-font";
const OUTPUT_WIDTH = 1600;
const OUTPUT_HEIGHT = 1000;
const MAX_CARDS = 14;
const MAX_COLUMNS = 7;
const MAX_ROWS = 2;
const CARD_FONT_SIZE = 96;
const SETTLED_TEXT_COLOR = "#e0041d";
const MAX_DUMMY_CHARACTERS = 28;
const DEAL_START_SECONDS = 0.25;
const DEAL_COLUMN_INTERVAL = 0.18;
const DEAL_ROW_INTERVAL = 0;
const DEAL_MOVE_DURATION = 0.32;
const DEAL_END_HOLD_SECONDS = 0.3;
const END_HOLD_SECONDS = 0.45;

const elements = {
  canvas: document.querySelector("#previewCanvas"),
  textInput: document.querySelector("#textInput"),
  characterCount: document.querySelector("#characterCount"),
  dummyText: document.querySelector("#dummyText"),
  dummyCharacterCount: document.querySelector("#dummyCharacterCount"),
  dummyPairCount: document.querySelector("#dummyPairCount"),
  dummyPairCountValue: document.querySelector("#dummyPairCountValue"),
  dummyLimitHint: document.querySelector("#dummyLimitHint"),
  shuffle: document.querySelector("#shuffleButton"),
  boardSummary: document.querySelector("#boardSummary"),
  panelGap: document.querySelector("#panelGap"),
  panelGapValue: document.querySelector("#panelGapValue"),
  cornerRadius: document.querySelector("#cornerRadius"),
  cornerRadiusValue: document.querySelector("#cornerRadiusValue"),
  fontStyle: document.querySelector("#fontStyle"),
  fontFile: document.querySelector("#fontFile"),
  fontFileName: document.querySelector("#fontFileName"),
  fontClear: document.querySelector("#fontClearButton"),
  panelColor: document.querySelector("#panelColor"),
  textColor: document.querySelector("#textColor"),
  backColor: document.querySelector("#backColor"),
  patternColor: document.querySelector("#patternColor"),
  settledColor: document.querySelector("#settledColor"),
  backgroundColor: document.querySelector("#backgroundColor"),
  duration: document.querySelector("#duration"),
  durationValue: document.querySelector("#durationValue"),
  turnInterval: document.querySelector("#turnInterval"),
  turnIntervalValue: document.querySelector("#turnIntervalValue"),
  openLimit: document.querySelector("#openLimit"),
  openLimitValue: document.querySelector("#openLimitValue"),
  matchTurnInterval: document.querySelector("#matchTurnInterval"),
  matchTurnIntervalValue: document.querySelector("#matchTurnIntervalValue"),
  matchPairCount: document.querySelector("#matchPairCount"),
  matchPairCountValue: document.querySelector("#matchPairCountValue"),
  revealTurn: document.querySelector("#revealTurn"),
  revealTurnValue: document.querySelector("#revealTurnValue"),
  flipDuration: document.querySelector("#flipDuration"),
  flipDurationValue: document.querySelector("#flipDurationValue"),
  holdDuration: document.querySelector("#holdDuration"),
  holdDurationValue: document.querySelector("#holdDurationValue"),
  removeDuration: document.querySelector("#removeDuration"),
  removeDurationValue: document.querySelector("#removeDurationValue"),
  requiredTime: document.querySelector("#requiredTime"),
  easing: document.querySelector("#easing"),
  matchDuration: document.querySelector("#matchDurationButton"),
  outputSize: document.querySelector("#outputSize"),
  stageDimensions: document.querySelector("#stageDimensions"),
  stageStatus: document.querySelector("#stageStatus"),
  imageTime: document.querySelector("#imageTime"),
  previewSpeed: document.querySelector("#previewSpeed"),
};

const context = elements.canvas.getContext("2d");
const fontStore = MotionFonts.createFontStore(FONT_ASSET_KEY);
const roundedRect = MotionToolkit.roundedRectPath;

const state = {
  seed: 20260821,
  panels: [],
  pairCount: 0,
  survivorCount: 0,
  columns: 0,
  rows: 0,
  rowCounts: [],
  pairTimes: [],
  turnTimes: [],
  turnStartAt: DEAL_START_SECONDS,
  allRevealAt: DEAL_START_SECONDS,
  localFontFamily: "",
  localFontName: "",
  lastFontStyle: "sans",
};

function normalizeKeepText(value) {
  return MotionToolkit.graphemes(value)
    .filter((character) => character.trim().length > 0)
    .slice(0, MAX_CARDS)
    .join("");
}

function keepCharacters() {
  return MotionToolkit.graphemes(elements.textInput.value)
    .filter((character) => character.trim().length > 0)
    .slice(0, MAX_CARDS);
}

function normalizeDummyText(value) {
  return MotionToolkit.graphemes(value)
    .filter((character) => character.trim().length > 0)
    .slice(0, MAX_DUMMY_CHARACTERS)
    .join("");
}

function dummyCharacters() {
  const survivors = new Set(keepCharacters());
  const seen = new Set();
  return MotionToolkit.graphemes(elements.dummyText.value)
    .filter((character) => {
      if (!character.trim() || survivors.has(character) || seen.has(character)) return false;
      seen.add(character);
      return true;
    })
    .slice(0, MAX_DUMMY_CHARACTERS);
}

function maximumDummyPairs() {
  return Math.min(
    Math.floor((MAX_CARDS - keepCharacters().length) / 2),
    dummyCharacters().length,
  );
}

function syncDummyLimit() {
  const maximum = maximumDummyPairs();
  elements.dummyPairCount.max = String(maximum);
  if (Number(elements.dummyPairCount.value) > maximum) {
    elements.dummyPairCount.value = String(maximum);
  }
}

function dummyPairs() {
  return MotionToolkit.clamp(Number(elements.dummyPairCount.value) || 0, 0, maximumDummyPairs());
}

function turnInterval() {
  return Math.max(0.15, Number(elements.turnInterval.value));
}

function openLimit() {
  return Math.max(2, Number(elements.openLimit.value));
}

function matchTurnInterval() {
  return Math.max(1, Number(elements.matchTurnInterval.value));
}

function revealTurn() {
  return MotionToolkit.clamp(
    Number(elements.revealTurn.value) || 1,
    Number(elements.revealTurn.min),
    Number(elements.revealTurn.max),
  );
}

function syncMatchPairLimit() {
  const maximum = Math.min(
    dummyPairs(),
    Math.floor((revealTurn() - 1) / matchTurnInterval()),
  );
  elements.matchPairCount.max = String(maximum);
  if (Number(elements.matchPairCount.value) > maximum) {
    elements.matchPairCount.value = String(maximum);
  }
}

function matchedPairCount() {
  return MotionToolkit.clamp(
    Number(elements.matchPairCount.value) || 0,
    0,
    Number(elements.matchPairCount.max),
  );
}

function flipTime() {
  return Math.max(0.1, Number(elements.flipDuration.value));
}

function holdTime() {
  return Math.max(0, Number(elements.holdDuration.value));
}

function removeTime() {
  return Math.max(0.1, Number(elements.removeDuration.value));
}

function saveSettings() {
  MotionStorage.write(MEMORY_SETTINGS_KEY, {
    text: elements.textInput.value,
    dummyText: elements.dummyText.value,
    dummyPairCount: elements.dummyPairCount.value,
    panelGap: elements.panelGap.value,
    cornerRadius: elements.cornerRadius.value,
    fontStyle: elements.fontStyle.value,
    localFontName: state.localFontName,
    panelColor: elements.panelColor.value,
    textColor: elements.textColor.value,
    backColor: elements.backColor.value,
    patternColor: elements.patternColor.value,
    settledColor: elements.settledColor.value,
    backgroundColor: elements.backgroundColor.value,
    duration: elements.duration.value,
    turnInterval: elements.turnInterval.value,
    openLimit: elements.openLimit.value,
    matchTurnInterval: elements.matchTurnInterval.value,
    matchPairCount: elements.matchPairCount.value,
    revealTurn: elements.revealTurn.value,
    flipDuration: elements.flipDuration.value,
    holdDuration: elements.holdDuration.value,
    removeDuration: elements.removeDuration.value,
    easing: elements.easing.value,
    previewSpeed: elements.previewSpeed.value,
    imageTime: elements.imageTime.value,
    outputSize: elements.outputSize.value,
    seed: state.seed,
  });
}

function restoreSettings() {
  const settings = MotionStorage.read(MEMORY_SETTINGS_KEY);
  if (!settings || typeof settings !== "object") return null;
  if (typeof settings.text === "string") elements.textInput.value = normalizeKeepText(settings.text);
  if (typeof settings.dummyText === "string") elements.dummyText.value = normalizeDummyText(settings.dummyText);
  ["dummyPairCount", "panelGap", "cornerRadius", "fontStyle", "panelColor", "textColor",
    "backColor", "patternColor", "settledColor", "backgroundColor", "duration", "turnInterval", "openLimit",
    "matchTurnInterval", "matchPairCount", "revealTurn", "flipDuration", "holdDuration", "removeDuration", "easing", "previewSpeed", "imageTime", "outputSize"]
    .forEach((name) => MotionStorage.restoreControl(elements[name], settings[name]));
  if (Number.isFinite(Number(settings.seed))) state.seed = Number(settings.seed);
  state.lastFontStyle = elements.fontStyle.value;
  syncDummyLimit();
  syncMatchPairLimit();
  return settings;
}

function shuffled(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

function buildBoard() {
  syncDummyLimit();
  syncMatchPairLimit();
  const survivors = keepCharacters();
  const pairCount = dummyPairs();
  const random = MotionToolkit.seededRandom(
    state.seed
    + MotionToolkit.hashSeed(elements.textInput.value)
    + MotionToolkit.hashSeed(elements.dummyText.value)
    + pairCount * 37,
  );
  const selectedDummies = shuffled(dummyCharacters(), random).slice(0, pairCount);
  const pairOrder = shuffled(Array.from({ length: pairCount }, (_, index) => index), random);
  const orderByPair = new Map(pairOrder.map((pair, order) => [pair, order]));

  const deck = survivors.map((character, survivorIndex) => ({
    character,
    survivor: true,
    survivorIndex,
    pair: null,
    matchOrder: null,
  }));
  selectedDummies.forEach((character, pair) => {
    const card = { character, survivor: false, pair, matchOrder: orderByPair.get(pair) };
    deck.push({ ...card }, { ...card });
  });

  const arrangedDeck = shuffled(deck, random);
  state.survivorCount = survivors.length;
  state.pairCount = pairCount;
  state.rows = arrangedDeck.length > 1 ? MAX_ROWS : arrangedDeck.length;
  state.rowCounts = state.rows === MAX_ROWS
    ? [Math.floor(arrangedDeck.length / 2), Math.ceil(arrangedDeck.length / 2)]
    : [arrangedDeck.length];
  state.columns = state.rowCounts.length ? Math.max(...state.rowCounts) : 0;
  state.panels = arrangedDeck.map((card, index) => ({
    ...card,
    index,
    row: state.rows === MAX_ROWS && index >= state.rowCounts[0] ? 1 : 0,
    column: state.rows === MAX_ROWS && index >= state.rowCounts[0]
      ? index - state.rowCounts[0]
      : index,
    partnerIndex: null,
    events: [],
    dealAt: DEAL_START_SECONDS,
  }));

  state.panels.forEach((panel) => {
    panel.dealAt = DEAL_START_SECONDS
      + panel.column * DEAL_COLUMN_INTERVAL
      + panel.row * DEAL_ROW_INTERVAL;
  });
  const finalDealAt = state.panels.length
    ? Math.max(...state.panels.map((panel) => panel.dealAt))
    : DEAL_START_SECONDS;
  state.turnStartAt = finalDealAt + DEAL_MOVE_DURATION + DEAL_END_HOLD_SECONDS;

  const panelsByPair = new Map();
  state.panels.forEach((panel) => {
    if (panel.survivor) return;
    const group = panelsByPair.get(panel.pair) || [];
    group.push(panel);
    panelsByPair.set(panel.pair, group);
  });
  panelsByPair.forEach((pairPanels) => {
    if (pairPanels.length !== 2) return;
    pairPanels[0].partnerIndex = pairPanels[1].index;
    pairPanels[1].partnerIndex = pairPanels[0].index;
  });
  buildFlipSchedule(random);
}

function pairStart(order) {
  return state.pairTimes[order] ?? Number.POSITIVE_INFINITY;
}

function pairRemovalStart(order) {
  return pairStart(order) + flipTime() + holdTime();
}

function pairRemovalEnd(order) {
  return pairRemovalStart(order) + removeTime();
}

function revealAllStart() {
  return state.allRevealAt;
}

function requiredSeconds() {
  if (!state.panels.length) return 0;
  const matchCount = matchedPairCount();
  const pairEnd = matchCount ? pairRemovalEnd(matchCount - 1) : state.turnStartAt;
  const revealEnd = revealAllStart() + flipTime();
  return Math.max(pairEnd, revealEnd) + END_HOLD_SECONDS;
}

function addFlipEvent(panel, time, up) {
  panel.events.push({ time: Math.max(0, time), up });
}

function chooseRandomCards({ count, completedMatches, blockedPairOrder, previousFaceUp, excluded, seenUp, random }) {
  if (count <= 0) return [];
  const selectedPairIds = new Set();
  const candidates = shuffled(state.panels.filter((panel) => {
    if (previousFaceUp.has(panel.index) || excluded.has(panel.index)) return false;
    if (panel.survivor) return true;
    if (panel.matchOrder < completedMatches) return false;
    return panel.matchOrder !== blockedPairOrder;
  }), random).sort((a, b) => Number(seenUp.has(a.index)) - Number(seenUp.has(b.index)));
  const selected = [];
  for (const panel of candidates) {
    if (!panel.survivor && selectedPairIds.has(panel.pair)) continue;
    selected.push(panel);
    if (!panel.survivor) selectedPairIds.add(panel.pair);
    if (selected.length >= count) break;
  }
  return selected;
}

function buildFlipSchedule(random) {
  const faceUp = new Set();
  const seenUp = new Set();
  const targetMatches = matchedPairCount();
  const finalTurn = revealTurn();
  let completedMatches = 0;
  state.pairTimes = [];
  state.turnTimes = [];
  state.allRevealAt = state.turnStartAt;
  let time = state.turnStartAt;

  if (!state.panels.length) return;

  for (let turn = 1; turn <= finalTurn; turn += 1) {
    state.turnTimes.push(time);
    const previousFaceUp = new Set(faceUp);

    if (turn === finalTurn) {
      state.allRevealAt = time;
      state.panels
        .filter((panel) => panel.survivor || panel.matchOrder >= targetMatches)
        .forEach((panel) => {
          if (!faceUp.has(panel.index)) addFlipEvent(panel, time, true);
          faceUp.add(panel.index);
          seenUp.add(panel.index);
        });
      break;
    }

    previousFaceUp.forEach((panelIndex) => addFlipEvent(state.panels[panelIndex], time, false));
    faceUp.clear();

    const isMatchTurn = completedMatches < targetMatches
      && turn % matchTurnInterval() === 0;
    const matchOrder = completedMatches;
    const matchedPanels = isMatchTurn
      ? state.panels.filter((panel) => panel.matchOrder === matchOrder)
      : [];
    if (isMatchTurn) {
      state.pairTimes[matchOrder] = time;
      matchedPanels.forEach((panel) => {
        addFlipEvent(panel, time, true);
        seenUp.add(panel.index);
      });
    }

    const nextTurn = turn + 1;
    const nextTurnMatches = completedMatches < targetMatches
      && nextTurn < finalTurn
      && nextTurn % matchTurnInterval() === 0;
    const excluded = new Set(matchedPanels.map((panel) => panel.index));
    const randomPanels = chooseRandomCards({
      count: Math.max(0, openLimit() - matchedPanels.length),
      completedMatches,
      blockedPairOrder: isMatchTurn || nextTurnMatches ? matchOrder : -1,
      previousFaceUp,
      excluded,
      seenUp,
      random,
    });
    randomPanels.forEach((panel) => {
      addFlipEvent(panel, time, true);
      faceUp.add(panel.index);
      seenUp.add(panel.index);
    });

    if (isMatchTurn) {
      time = pairRemovalEnd(matchOrder) + turnInterval();
      completedMatches += 1;
    } else {
      time += turnInterval();
    }
  }
  state.panels.forEach((panel) => panel.events.sort((a, b) => a.time - b.time));
}

function flipAmount(panel, seconds) {
  let amount = 0;
  for (const event of panel.events) {
    if (seconds <= event.time) break;
    const progress = MotionToolkit.clamp((seconds - event.time) / flipTime(), 0, 1);
    amount = MotionToolkit.lerp(
      amount,
      event.up ? 1 : 0,
      MotionToolkit.ease(progress, elements.easing.value),
    );
  }
  return amount;
}

function collectionAmount(panel, seconds) {
  if (panel.survivor) return 0;
  const progress = MotionToolkit.clamp((seconds - pairRemovalStart(panel.matchOrder)) / removeTime(), 0, 1);
  return MotionToolkit.ease(progress, "easeInOut");
}

function isPairForeground(panel, seconds) {
  return !panel.survivor
    && seconds >= pairStart(panel.matchOrder) + flipTime()
    && seconds < pairRemovalEnd(panel.matchOrder);
}

function collectedPairs(seconds) {
  let collected = 0;
  for (let order = 0; order < matchedPairCount(); order += 1) {
    if (seconds >= pairRemovalEnd(order)) collected += 1;
  }
  return collected;
}

function currentTurn(seconds) {
  return state.turnTimes.filter((time) => seconds >= time).length;
}

function fontFamily() {
  if (state.localFontFamily) return `"${state.localFontFamily}", sans-serif`;
  if (elements.fontStyle.value === "serif") return '"Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
  if (elements.fontStyle.value === "mono") return '"BIZ UDGothic", "MS Gothic", monospace';
  return '"Yu Gothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif';
}

function panelLayout() {
  const gap = Number(elements.panelGap.value);
  const columnCount = Math.max(1, state.columns);
  const rowCount = Math.max(1, state.rows);
  const outerX = 54;
  const outerY = 112;
  const collectionReserve = Math.min(210, elements.canvas.width * 0.2);
  const availableWidth = elements.canvas.width - outerX * 2 - collectionReserve;
  const availableHeight = elements.canvas.height - outerY * 2;
  const width = Math.min(170, (availableWidth - gap * Math.max(0, columnCount - 1)) / columnCount);
  const height = Math.min(
    250,
    width * (220 / 150),
    (availableHeight - gap * Math.max(0, rowCount - 1)) / rowCount * 0.84,
  );
  const blockWidth = width * columnCount + gap * Math.max(0, columnCount - 1);
  const blockHeight = height * rowCount + gap * Math.max(0, rowCount - 1);
  return {
    width,
    height,
    gap,
    left: outerX + collectionReserve + (availableWidth - blockWidth) / 2,
    blockWidth,
    top: (elements.canvas.height - blockHeight) / 2,
    collectionX: outerX + width / 2,
    collectionY: elements.canvas.height / 2,
  };
}

function panelCenter(panel, layout) {
  const rowCardCount = state.rowCounts[panel.row] || state.columns;
  const rowWidth = layout.width * rowCardCount + layout.gap * Math.max(0, rowCardCount - 1);
  const rowLeft = layout.left + (layout.blockWidth - rowWidth) / 2;
  return {
    x: rowLeft + panel.column * (layout.width + layout.gap) + layout.width / 2,
    y: layout.top + panel.row * (layout.height + layout.gap) + layout.height / 2,
  };
}

function dealAmount(panel, seconds) {
  const progress = MotionToolkit.clamp((seconds - panel.dealAt) / DEAL_MOVE_DURATION, 0, 1);
  return MotionToolkit.ease(progress, "easeOut");
}

function cardFrameInset(width) {
  return Math.max(5, Math.min(9, width * 0.045));
}

function drawFrontSurface(width, height, scaleX, radius, settled) {
  const visibleWidth = width * scaleX;
  roundedRect(context, -visibleWidth / 2, -height / 2, visibleWidth, height, radius * scaleX);
  context.fillStyle = elements.panelColor.value;
  context.fill();
  context.lineWidth = 6;
  context.strokeStyle = settled ? elements.settledColor.value : "rgba(12, 24, 30, 0.48)";
  context.stroke();
}

function fillPatternTriangle(points, shade) {
  context.save();
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  context.lineTo(points[1][0], points[1][1]);
  context.lineTo(points[2][0], points[2][1]);
  context.closePath();
  if (shade <= 1) {
    context.fillStyle = `rgba(0, 0, 0, ${shade === 0 ? 0.18 : 0.09})`;
  } else {
    context.fillStyle = elements.patternColor.value;
    context.globalAlpha *= [0, 0, 0.12, 0.22, 0.34, 0.46][shade];
  }
  context.fill();
  context.restore();
}

function drawBackPattern(width, height, scaleX, radius) {
  const inset = cardFrameInset(width);
  const innerLeft = -width / 2 + inset;
  const innerTop = -height / 2 + inset;
  const innerWidth = width - inset * 2;
  const innerHeight = height - inset * 2;

  context.save();
  context.scale(scaleX, 1);
  roundedRect(context, innerLeft, innerTop, innerWidth, innerHeight, Math.max(0, radius - inset / 2));
  context.fillStyle = elements.backColor.value;
  context.fill();
  context.clip();

  const side = innerWidth / 3.05;
  const triangleHeight = side * Math.sqrt(3) / 2;
  const rowCount = Math.ceil(innerHeight / triangleHeight) + 2;
  const columnCount = Math.ceil(innerWidth / side) + 3;
  for (let row = -1; row < rowCount; row += 1) {
    const y = innerTop + row * triangleHeight;
    const offset = row % 2 === 0 ? 0 : side / 2;
    for (let column = -2; column < columnCount; column += 1) {
      const x = innerLeft + column * side + offset;
      const firstShade = Math.abs(row * 11 + column * 7) % 6;
      const secondShade = Math.abs(row * 5 + column * 13 + 3) % 6;
      fillPatternTriangle([[x, y], [x + side, y], [x + side / 2, y + triangleHeight]], firstShade);
      fillPatternTriangle([
        [x + side, y],
        [x + side / 2, y + triangleHeight],
        [x + side * 1.5, y + triangleHeight],
      ], secondShade);
    }
  }
  context.restore();

  context.save();
  context.scale(scaleX, 1);
  roundedRect(context, innerLeft, innerTop, innerWidth, innerHeight, Math.max(0, radius - inset / 2));
  context.lineWidth = 1.5;
  context.strokeStyle = "rgba(12, 24, 30, 0.34)";
  context.stroke();
  context.restore();
}

function drawCollectionFrame(layout) {
  if (!state.panels.length) return;
  const radius = Number(elements.cornerRadius.value) + 8;
  const frameWidth = layout.width + 24;
  const frameHeight = layout.height + 24;
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.2)";
  context.shadowBlur = 12;
  roundedRect(
    context,
    layout.collectionX - frameWidth / 2,
    layout.collectionY - frameHeight / 2,
    frameWidth,
    frameHeight,
    radius,
  );
  context.fillStyle = "rgba(255, 255, 255, 0.06)";
  context.fill();
  context.shadowColor = "transparent";
  context.strokeStyle = "rgba(255, 255, 255, 0.9)";
  context.lineWidth = 6;
  context.stroke();
  context.restore();
}

function drawPanel(panel, layout, seconds) {
  const collected = collectionAmount(panel, seconds);
  const dealt = dealAmount(panel, seconds);
  const amount = flipAmount(panel, seconds);
  const angle = amount * Math.PI;
  const scaleX = Math.max(0.035, Math.abs(Math.cos(angle)));
  const isFront = amount >= 0.5;
  const matching = isPairForeground(panel, seconds);
  const boardCenter = panelCenter(panel, layout);
  const dealRank = panel.column * MAX_ROWS + panel.row;
  const deckOffset = Math.min(6, dealRank * 0.45);
  const deckCenter = {
    x: layout.collectionX + deckOffset,
    y: layout.collectionY - deckOffset,
  };
  const ownCenter = {
    x: MotionToolkit.lerp(deckCenter.x, boardCenter.x, dealt),
    y: MotionToolkit.lerp(deckCenter.y, boardCenter.y, dealt)
      - Math.sin(dealt * Math.PI) * Math.min(34, layout.height * 0.16),
  };
  const isTopCard = panel.partnerIndex == null || panel.index > panel.partnerIndex;
  const stackDepth = Math.min(6, panel.matchOrder ?? 0) * 1.4;
  const targetX = layout.collectionX + stackDepth + (isTopCard ? 2.5 : -2.5);
  const targetY = layout.collectionY - stackDepth + (isTopCard ? 2.5 : -2.5);
  const centerX = MotionToolkit.lerp(ownCenter.x, targetX, collected);
  const centerY = MotionToolkit.lerp(ownCenter.y, targetY, collected);
  const visibleWidth = layout.width * scaleX;
  const faceX = -visibleWidth / 2;
  const radius = Number(elements.cornerRadius.value);

  context.save();
  context.translate(centerX, centerY);
  context.shadowColor = `rgba(0, 0, 0, ${0.12 + 0.16 * scaleX})`;
  context.shadowBlur = 6 + 10 * scaleX;
  context.shadowOffsetY = 3 + 3 * scaleX;
  roundedRect(context, faceX, -layout.height / 2, visibleWidth, layout.height, radius * scaleX);
  context.fillStyle = isFront ? elements.panelColor.value : "#ffffff";
  context.fill();
  context.shadowColor = "transparent";
  if (isFront) {
    drawFrontSurface(layout.width, layout.height, scaleX, radius, matching);
  } else {
    drawBackPattern(layout.width, layout.height, scaleX, radius);
    roundedRect(context, faceX, -layout.height / 2, visibleWidth, layout.height, radius * scaleX);
    context.lineWidth = 3;
    context.strokeStyle = "rgba(12, 24, 30, 0.5)";
    context.stroke();
  }

  if (isFront) {
    context.save();
    context.beginPath();
    context.rect(faceX, -layout.height / 2, visibleWidth, layout.height);
    context.clip();
    context.scale(scaleX, 1);
    context.font = `800 ${CARD_FONT_SIZE}px ${fontFamily()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = matching ? SETTLED_TEXT_COLOR : elements.textColor.value;
    context.fillText(panel.character, 0, 2);
    context.restore();
  }

  if (isFront) {
    context.fillStyle = "rgba(255, 255, 255, 0.10)";
    context.fillRect(faceX, -layout.height / 2, Math.max(1, visibleWidth * 0.5), layout.height);
  } else {
    const sheen = context.createLinearGradient(faceX, 0, faceX + Math.max(1, visibleWidth), 0);
    sheen.addColorStop(0, "rgba(255, 255, 255, 0.16)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = sheen;
    context.fillRect(faceX, -layout.height / 2, Math.max(1, visibleWidth), layout.height);
  }
  context.restore();
}

function render(playhead = 0) {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.fillStyle = elements.backgroundColor.value;
  context.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  const seconds = playhead * Number(elements.duration.value);
  if (!state.panels.length) {
    context.fillStyle = elements.textColor.value;
    context.globalAlpha = 0.35;
    context.font = `700 44px ${fontFamily()}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("残す文字かダミーを指定", elements.canvas.width / 2, elements.canvas.height / 2);
    context.restore();
    updateStatus(seconds);
    return;
  }

  const layout = panelLayout();
  drawCollectionFrame(layout);
  [...state.panels]
    .sort((a, b) => {
      if (seconds < state.turnStartAt) return b.dealAt - a.dealAt;
      const foregroundDifference = Number(isPairForeground(a, seconds))
        - Number(isPairForeground(b, seconds));
      if (foregroundDifference !== 0) return foregroundDifference;
      return (a.matchOrder ?? state.pairCount + a.index) - (b.matchOrder ?? state.pairCount + b.index);
    })
    .forEach((panel) => drawPanel(panel, layout, seconds));
  context.restore();
  updateStatus(seconds);
}

function updateStatus(seconds) {
  if (seconds < state.turnStartAt) {
    const dealt = state.panels.filter((panel) => seconds >= panel.dealAt + DEAL_MOVE_DURATION).length;
    elements.stageStatus.textContent = `${dealt} / ${state.panels.length}枚を配布`;
    return;
  }
  const targetMatches = matchedPairCount();
  const collected = collectedPairs(seconds);
  if (seconds >= state.allRevealAt) {
    elements.stageStatus.textContent = `すべて表示 · ${collected} / ${targetMatches}組を回収`;
    return;
  }
  elements.stageStatus.textContent = `${currentTurn(seconds)} / ${revealTurn()}ターン · ${collected} / ${targetMatches}組を回収`;
}

function updateLabels() {
  const maximum = maximumDummyPairs();
  const totalCards = state.panels.length;
  elements.characterCount.value = `${state.survivorCount}文字`;
  elements.dummyCharacterCount.value = `${dummyCharacters().length}文字`;
  elements.dummyPairCountValue.value = `${state.pairCount} 組 / ${state.pairCount * 2}枚`;
  elements.dummyLimitHint.textContent = `入力候補と残す文字を合わせて最大14枚です。現在は最大${maximum}組まで追加できます。`;
  elements.boardSummary.value = totalCards
    ? `${state.rows}行 × ${state.columns}列 · ${totalCards}枚`
    : "0枚";
  elements.panelGapValue.value = `${elements.panelGap.value} px`;
  elements.cornerRadiusValue.value = `${elements.cornerRadius.value} px`;
  elements.durationValue.value = `${Number(elements.duration.value).toFixed(1)} 秒`;
  elements.turnIntervalValue.value = `${turnInterval().toFixed(2)} 秒 / ${Math.round(turnInterval() * 60)}f`;
  elements.openLimitValue.value = `${openLimit()} 枚`;
  elements.matchTurnIntervalValue.value = `${matchTurnInterval()} ターンごと`;
  elements.matchPairCountValue.value = `${matchedPairCount()} 組`;
  elements.revealTurnValue.value = `${revealTurn()} ターン目`;
  elements.flipDurationValue.value = `${flipTime().toFixed(2)} 秒 / ${Math.round(flipTime() * 60)}f`;
  elements.holdDurationValue.value = `${holdTime().toFixed(2)} 秒 / ${Math.round(holdTime() * 60)}f`;
  elements.removeDurationValue.value = `${removeTime().toFixed(2)} 秒 / ${Math.round(removeTime() * 60)}f`;
  elements.requiredTime.value = `必要 ${requiredSeconds().toFixed(1)} 秒`;
  [elements.panelColor, elements.textColor, elements.backColor, elements.patternColor,
  elements.settledColor, elements.backgroundColor]
    .forEach((control) => { control.nextElementSibling.value = control.value.toUpperCase(); });
}

const player = MotionToolkit.createPlayer({
  canvas: elements.canvas,
  getDuration: () => Number(elements.duration.value),
  isReady: () => state.panels.length > 0,
  render,
  onControlChange: saveSettings,
  getFileBase: () => `${elements.textInput.value.trim().slice(0, 8) || "memory"}-flip`,
});

function rebuildAndReset() {
  buildBoard();
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render(0);
}

function resetAndRender() {
  player.reset();
  player.update();
  updateLabels();
  saveSettings();
  render(0);
}

async function applyLocalFont(buffer, name) {
  const family = await MotionFonts.registerFontFile(buffer, "MemoryFlipLocal");
  state.localFontFamily = family;
  state.localFontName = name;
  elements.fontFileName.textContent = name;
  elements.fontClear.hidden = false;
  saveSettings();
  render(player.state.playhead);
}

async function loadLocalFont(file) {
  if (!file) return;
  if (file.size > MotionFonts.MAX_FONT_BYTES) {
    player.showToast("30MB以下のフォントを選択してください");
    return;
  }
  try {
    const buffer = await file.arrayBuffer();
    await applyLocalFont(buffer, file.name);
    await fontStore.write({ buffer, name: file.name });
    player.showToast(`${file.name}を適用しました`);
  } catch {
    player.showToast("フォントを読み込めませんでした");
  }
}

async function clearLocalFont(notify = true) {
  state.localFontFamily = "";
  state.localFontName = "";
  elements.fontFileName.textContent = "端末内のフォント";
  elements.fontClear.hidden = true;
  elements.fontFile.value = "";
  await fontStore.remove();
  saveSettings();
  render(player.state.playhead);
  if (notify) player.showToast("端末内のフォントを解除しました");
}

async function restoreLocalFont(settings) {
  if (!settings?.localFontName) return;
  try {
    const asset = await fontStore.read();
    if (!asset?.buffer) throw new Error("Stored font was not found");
    await applyLocalFont(asset.buffer, asset.name || settings.localFontName);
  } catch {
    await clearLocalFont(false);
  }
}

elements.textInput.addEventListener("input", () => {
  const normalized = normalizeKeepText(elements.textInput.value);
  if (elements.textInput.value !== normalized) elements.textInput.value = normalized;
  syncDummyLimit();
  rebuildAndReset();
});
elements.dummyText.addEventListener("input", () => {
  const normalized = normalizeDummyText(elements.dummyText.value);
  if (elements.dummyText.value !== normalized) elements.dummyText.value = normalized;
  syncDummyLimit();
  rebuildAndReset();
});
elements.dummyPairCount.addEventListener("input", rebuildAndReset);
[elements.turnInterval, elements.openLimit, elements.matchTurnInterval, elements.matchPairCount,
  elements.revealTurn, elements.flipDuration, elements.holdDuration, elements.removeDuration]
  .forEach((control) => control.addEventListener("input", rebuildAndReset));
[elements.duration, elements.panelGap, elements.cornerRadius]
  .forEach((control) => control.addEventListener("input", resetAndRender));
elements.easing.addEventListener("change", resetAndRender);
[elements.panelColor, elements.textColor, elements.backColor, elements.patternColor,
elements.settledColor, elements.backgroundColor]
  .forEach((control) => control.addEventListener("input", () => {
    saveSettings();
    updateLabels();
    render(player.state.playhead);
  }));
elements.shuffle.addEventListener("click", () => {
  state.seed = Date.now();
  rebuildAndReset();
  player.showToast("配置・ダミー文字・ペア順を再抽選しました");
});
elements.matchDuration.addEventListener("click", () => {
  const needed = MotionToolkit.clamp(
    Math.ceil(requiredSeconds() * 2) / 2,
    Number(elements.duration.min),
    Number(elements.duration.max),
  );
  elements.duration.value = String(needed);
  elements.duration.dispatchEvent(new Event("input", { bubbles: true }));
  player.showToast(`全体時間を${needed.toFixed(1)}秒にしました`);
});
elements.fontStyle.addEventListener("change", async () => {
  if (elements.fontStyle.value !== state.lastFontStyle) await clearLocalFont(false);
  state.lastFontStyle = elements.fontStyle.value;
  saveSettings();
  render(player.state.playhead);
});
elements.fontFile.addEventListener("change", async () => {
  await loadLocalFont(elements.fontFile.files?.[0]);
  elements.fontFile.value = "";
});
elements.fontClear.addEventListener("click", () => clearLocalFont());
elements.outputSize.addEventListener("change", () => {
  MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
  resetAndRender();
});

const restoredSettings = restoreSettings();
elements.textInput.value = normalizeKeepText(elements.textInput.value);
elements.dummyText.value = normalizeDummyText(elements.dummyText.value);
syncDummyLimit();
syncMatchPairLimit();
MotionToolkit.resizeOutputCanvas(elements.canvas, elements.outputSize.value, elements.stageDimensions, OUTPUT_WIDTH, OUTPUT_HEIGHT);
buildBoard();
updateLabels();
player.state.playhead = MotionToolkit.clamp(
  Number(elements.imageTime.value) / Math.max(0.1, Number(elements.duration.value)),
  0,
  1,
);
player.update();
render(player.state.playhead);
restoreLocalFont(restoredSettings);
