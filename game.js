(function () {
  "use strict";

  const SIZE = 4;
  const WIN_VALUE = 2048;
  const BEST_KEY = "game2048_best";
  const ANIM_MS = 135;

  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const tileLayer = $("tile-layer");
  const gridBg = $("grid-bg");
  const scoreEl = $("score");
  const scoreAddEl = $("score-add");
  const bestEl = $("best");
  const undoBtn = $("undo");
  const newBtn = $("new-game");
  const overlay = $("overlay");
  const overlayTitle = $("overlay-title");
  const overlaySub = $("overlay-sub");
  const overlayBtn = $("overlay-btn");
  const helpBtn = $("help");
  const helpModal = $("help-modal");

  // cells: 4x4，元素为 tile 对象 {id,value,row,col,el} 或 null
  let cells = [];
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let tileId = 0;
  let history = [];   // 撤销栈
  let won = false;
  let busy = false;

  /* ---------- 网格背景 ---------- */
  function buildGrid() {
    gridBg.innerHTML = "";
    for (let i = 0; i < SIZE * SIZE; i++) {
      const c = document.createElement("div");
      c.className = "grid-cell";
      gridBg.appendChild(c);
    }
  }

  const emptyGrid = () => Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  const range = () => Array.from({ length: SIZE }, (_, i) => i);

  /* ---------- 坐标 → 像素 ---------- */
  function metrics() {
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap"));
    const inner = tileLayer.clientWidth;
    const cellSize = (inner - gap * (SIZE - 1)) / SIZE;
    return { gap, cellSize };
  }
  function place(el, row, col) {
    const { gap, cellSize } = metrics();
    el.style.width = cellSize + "px";
    el.style.height = cellSize + "px";
    el.style.left = col * (cellSize + gap) + "px";
    el.style.top = row * (cellSize + gap) + "px";
  }

  /* ---------- 方块 DOM ---------- */
  function createTileEl(tile, opts) {
    const el = document.createElement("div");
    el.className = "tile";
    el.dataset.id = tile.id;
    el.dataset.val = tile.value;
    if (tile.value > 2048) el.dataset.big = "1";
    const inner = document.createElement("div");
    inner.className = "tile-inner";
    inner.textContent = tile.value;
    el.appendChild(inner);
    place(el, tile.row, tile.col);
    if (opts && opts.appear) el.classList.add("appear");
    tileLayer.appendChild(el);
    tile.el = el;
    return el;
  }
  function refreshTileEl(tile, merged) {
    const el = tile.el;
    el.dataset.val = tile.value;
    if (tile.value > 2048) el.dataset.big = "1";
    el.querySelector(".tile-inner").textContent = tile.value;
    if (merged) {
      el.classList.remove("merged");
      void el.offsetWidth;
      el.classList.add("merged");
    }
  }

  function renderAll() {
    tileLayer.innerHTML = "";
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        const t = cells[r][c];
        if (t) { t.el = null; createTileEl(t); }
      }
  }

  /* ---------- 随机生成 ---------- */
  function spawn() {
    const empties = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (!cells[r][c]) empties.push([r, c]);
    if (!empties.length) return;
    const [r, c] = empties[Math.floor(Math.random() * empties.length)];
    const t = { id: ++tileId, value: Math.random() < 0.9 ? 2 : 4, row: r, col: c };
    cells[r][c] = t;
    createTileEl(t, { appear: true });
  }

  /* ---------- 分数 ---------- */
  function setScore(v, gained) {
    score = v;
    scoreEl.textContent = score;
    if (score > best) {
      best = score; bestEl.textContent = best;
      localStorage.setItem(BEST_KEY, best);
    }
    if (gained > 0) {
      scoreAddEl.textContent = "+" + gained;
      scoreAddEl.classList.remove("run");
      void scoreAddEl.offsetWidth;
      scoreAddEl.classList.add("run");
    }
  }

  /* ---------- 撤销快照 ---------- */
  function pushHistory() {
    const grid = cells.map((row) => row.map((t) => (t ? t.value : 0)));
    history.push({ grid, score });
    if (history.length > 25) history.shift();
    undoBtn.disabled = false;
  }
  function undo() {
    if (busy || !history.length) return;
    const prev = history.pop();
    cells = prev.grid.map((row, r) =>
      row.map((v, c) => (v ? { id: ++tileId, value: v, row: r, col: c, el: null } : null))
    );
    score = prev.score;
    scoreEl.textContent = score;
    renderAll();
    won = false;
    hideOverlay();
    undoBtn.disabled = history.length === 0;
  }

  /* ---------- 移动 ---------- */
  const serialize = () =>
    cells.map((row) => row.map((t) => (t ? t.value : 0)).join(",")).join("|");

  function buildLines(dir) {
    const lines = [];
    if (dir === "left" || dir === "right") {
      for (let r = 0; r < SIZE; r++) {
        const cols = dir === "left" ? range() : range().reverse();
        lines.push(cols.map((c) => ({ r, c })));
      }
    } else {
      for (let c = 0; c < SIZE; c++) {
        const rows = dir === "up" ? range() : range().reverse();
        lines.push(rows.map((r) => ({ r, c })));
      }
    }
    return lines;
  }

  function move(dir) {
    if (busy) return;
    const before = serialize();
    const beforeScore = score;
    const lines = buildLines(dir);
    let gained = 0;
    const mergedIds = new Set();
    const removeEls = [];

    for (const line of lines) {
      const tiles = line.map(({ r, c }) => cells[r][c]).filter(Boolean);
      const resolved = [];
      let target = 0;
      for (let i = 0; i < tiles.length; i++) {
        if (i + 1 < tiles.length && tiles[i].value === tiles[i + 1].value) {
          const keep = tiles[i], gone = tiles[i + 1];
          const slot = line[target];
          slide(keep, slot.r, slot.c);
          slide(gone, slot.r, slot.c);
          mergedIds.add(keep.id);
          removeEls.push(gone.el);
          gained += keep.value * 2;
          resolved.push({ tile: keep, r: slot.r, c: slot.c, merged: true });
          target++; i++;
        } else {
          const slot = line[target];
          slide(tiles[i], slot.r, slot.c);
          resolved.push({ tile: tiles[i], r: slot.r, c: slot.c, merged: false });
          target++;
        }
      }
      for (const { r, c } of line) cells[r][c] = null;
      for (const it of resolved) cells[it.r][it.c] = it.tile;
    }

    if (before === serialize() && gained === 0) return; // 无变化

    // 入栈历史（保存移动前状态）
    history.push({ grid: before.split("|").map((row) => row.split(",").map(Number)), score: beforeScore });
    if (history.length > 25) history.shift();
    undoBtn.disabled = false;

    if (gained) setScore(score + gained, gained);
    busy = true;

    setTimeout(() => {
      for (let r = 0; r < SIZE; r++)
        for (let c = 0; c < SIZE; c++) {
          const t = cells[r][c];
          if (t && mergedIds.has(t.id)) { t.value *= 2; refreshTileEl(t, true); }
        }
      removeEls.forEach((el) => el && el.remove());
      spawn();
      busy = false;
      checkState();
    }, ANIM_MS);
  }

  function slide(tile, r, c) {
    tile.row = r; tile.col = c;
    if (tile.el) place(tile.el, r, c);
  }

  /* ---------- 胜负 ---------- */
  function hasMoves() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (!cells[r][c]) return true;
        const v = cells[r][c].value;
        if (c + 1 < SIZE && cells[r][c + 1] && cells[r][c + 1].value === v) return true;
        if (r + 1 < SIZE && cells[r + 1][c] && cells[r + 1][c].value === v) return true;
      }
    return false;
  }
  function maxValue() {
    let m = 0;
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (cells[r][c]) m = Math.max(m, cells[r][c].value);
    return m;
  }
  function checkState() {
    if (!won && maxValue() >= WIN_VALUE) { won = true; showOverlay(true); return; }
    if (!hasMoves()) showOverlay(false);
  }
  function showOverlay(isWin) {
    overlay.classList.toggle("win", isWin);
    overlayTitle.textContent = isWin ? "你赢了！" : "游戏结束";
    overlaySub.textContent = "本局得分 " + score + (best ? " · 最高 " + best : "");
    overlayBtn.textContent = isWin ? "继续挑战" : "再来一局";
    overlay.dataset.win = isWin ? "1" : "0";
    overlay.hidden = false;
  }
  function hideOverlay() { overlay.hidden = true; }

  /* ---------- 新游戏 ---------- */
  function reset() {
    cells = emptyGrid();
    score = 0; won = false; busy = false; history = [];
    tileLayer.innerHTML = "";
    setScore(0, 0);
    bestEl.textContent = best;
    undoBtn.disabled = true;
    hideOverlay();
    spawn(); spawn();
  }

  /* ---------- 事件 ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !helpModal.hidden) { closeHelp(); return; }
    if (!helpModal.hidden) return;
    const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
    if (map[e.key]) { e.preventDefault(); move(map[e.key]); }
    else if (e.key === "z" || e.key === "Z") undo();
    else if (e.key === "r" || e.key === "R") reset();
  });

  let touchStart = null;
  // 滑动区域扩大到整个页面：在棋盘外的空白处也能滑动控制
  document.addEventListener("touchstart", (e) => {
    // 在弹窗打开时不接管滑动
    if (!helpModal.hidden) return;
    const t = e.touches[0]; touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    // 识别到滑动手势后阻止页面跟随滚动/回弹
    if (touchStart && e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x, dy = t.clientY - touchStart.y;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    if (Math.max(ax, ay) >= 20) {
      if (ax > ay) move(dx > 0 ? "right" : "left");
      else move(dy > 0 ? "down" : "up");
    }
    touchStart = null;
  }, { passive: true });

  newBtn.addEventListener("click", reset);
  undoBtn.addEventListener("click", undo);

  /* ---------- 玩法弹窗 ---------- */
  function openHelp() { helpModal.hidden = false; }
  function closeHelp() { helpModal.hidden = true; }
  helpBtn.addEventListener("click", openHelp);
  $("help-close").addEventListener("click", closeHelp);
  $("help-ok").addEventListener("click", closeHelp);
  helpModal.addEventListener("click", (e) => {
    if (e.target.dataset.close !== undefined) closeHelp();
  });
  overlayBtn.addEventListener("click", () => {
    if (overlay.dataset.win === "1") hideOverlay();
    else reset();
  });
  window.addEventListener("resize", () => {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (cells[r][c] && cells[r][c].el) place(cells[r][c].el, r, c);
  });

  /* ---------- 启动 ---------- */
  buildGrid();
  reset();
})();
