/*
 * 블록 팡팡! — game.js
 *
 * 1부 Core : DOM을 전혀 쓰지 않는 순수 게임 규칙 (Node와 브라우저 양쪽에서 테스트 가능)
 * 2부 UI   : 입력, 렌더링, 효과, 사운드, 화면 전환
 */
(function (global) {
  'use strict';

  /* ======================================================================
   * 1부. Core — 게임 규칙
   * ==================================================================== */
  const Core = (function () {
    const BOARD_SIZE = 8;
    const EMPTY = 0;
    const TRAY_SIZE = 3;

    const POINTS_PER_CELL = 1;
    const POINTS_PER_LINE = 10;
    const MULTI_LINE_UNIT = 10; // 2줄 +10, 3줄 +30, 4줄 +60 ...
    const ALL_CLEAR_BONUS = 100;
    const COMBO_MAX_MULTIPLIER = 8;
    /** 줄을 못 지운 배치를 이 횟수까지는 허용하고, 그다음 배치에서 콤보가 끊긴다. */
    const COMBO_GRACE = 2;

    // 색상 번호: 1 파랑, 2 노랑, 3 주황, 4 초록, 5 보라, 6 분홍, 7 하늘
    // cells는 [행, 열] 상대 좌표. 회전 방향마다 별도 템플릿으로 등록한다.
    const SHAPE_TEMPLATES = [
      // 1칸
      { id: 'single', name: '1칸', color: 2, weight: 5, cells: [[0, 0]] },

      // 직선
      { id: 'h2', name: '가로 2칸', color: 7, weight: 8, cells: [[0, 0], [0, 1]] },
      { id: 'v2', name: '세로 2칸', color: 7, weight: 8, cells: [[0, 0], [1, 0]] },
      { id: 'h3', name: '가로 3칸', color: 1, weight: 8, cells: [[0, 0], [0, 1], [0, 2]] },
      { id: 'v3', name: '세로 3칸', color: 1, weight: 8, cells: [[0, 0], [1, 0], [2, 0]] },
      { id: 'h4', name: '가로 4칸', color: 5, weight: 5, cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
      { id: 'v4', name: '세로 4칸', color: 5, weight: 5, cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
      { id: 'h5', name: '가로 5칸', color: 6, weight: 3, cells: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
      { id: 'v5', name: '세로 5칸', color: 6, weight: 3, cells: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]] },

      // 정사각형, 직사각형
      { id: 'sq2', name: '2×2 정사각형', color: 2, weight: 8, cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
      { id: 'sq3', name: '3×3 정사각형', color: 3, weight: 3, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [2, 2]] },
      { id: 'rect23', name: '2×3 직사각형', color: 4, weight: 4, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]] },
      { id: 'rect32', name: '3×2 직사각형', color: 4, weight: 4, cells: [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]] },

      // 작은 꺾임 (ㄱ, ㄴ과 그 대칭)
      { id: 'giyeok', name: 'ㄱ자', color: 3, weight: 6, cells: [[0, 0], [0, 1], [1, 1]] },
      { id: 'nieun', name: 'ㄴ자', color: 3, weight: 6, cells: [[0, 0], [1, 0], [1, 1]] },
      { id: 'giyeok-m', name: 'ㄱ자 대칭', color: 3, weight: 6, cells: [[0, 0], [0, 1], [1, 0]] },
      { id: 'nieun-m', name: 'ㄴ자 대칭', color: 3, weight: 6, cells: [[0, 1], [1, 0], [1, 1]] },

      // L자 4방향
      { id: 'l-0', name: 'L자 0°', color: 4, weight: 3, cells: [[0, 0], [1, 0], [2, 0], [2, 1]] },
      { id: 'l-90', name: 'L자 90°', color: 4, weight: 3, cells: [[0, 0], [0, 1], [0, 2], [1, 0]] },
      { id: 'l-180', name: 'L자 180°', color: 4, weight: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
      { id: 'l-270', name: 'L자 270°', color: 4, weight: 3, cells: [[0, 2], [1, 0], [1, 1], [1, 2]] },

      // 반대 L자 4방향
      { id: 'j-0', name: '반대 L자 0°', color: 1, weight: 3, cells: [[0, 1], [1, 1], [2, 0], [2, 1]] },
      { id: 'j-90', name: '반대 L자 90°', color: 1, weight: 3, cells: [[0, 0], [1, 0], [1, 1], [1, 2]] },
      { id: 'j-180', name: '반대 L자 180°', color: 1, weight: 3, cells: [[0, 0], [0, 1], [1, 0], [2, 0]] },
      { id: 'j-270', name: '반대 L자 270°', color: 1, weight: 3, cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },

      // T자 4방향
      { id: 't-up', name: 'T자 위', color: 5, weight: 4, cells: [[0, 1], [1, 0], [1, 1], [1, 2]] },
      { id: 't-down', name: 'T자 아래', color: 5, weight: 4, cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
      { id: 't-left', name: 'T자 왼쪽', color: 5, weight: 4, cells: [[0, 1], [1, 0], [1, 1], [2, 1]] },
      { id: 't-right', name: 'T자 오른쪽', color: 5, weight: 4, cells: [[0, 0], [1, 0], [1, 1], [2, 0]] },

      // 지그재그
      { id: 's-h', name: '지그재그 S 가로', color: 7, weight: 3, cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
      { id: 's-v', name: '지그재그 S 세로', color: 7, weight: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
      { id: 'z-h', name: '지그재그 Z 가로', color: 6, weight: 3, cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
      { id: 'z-v', name: '지그재그 Z 세로', color: 6, weight: 3, cells: [[0, 1], [1, 0], [1, 1], [2, 0]] },

      // 큰 꺾임 (3×3 테두리)
      { id: 'big-nieun', name: '큰 ㄴ자', color: 2, weight: 2, cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
      { id: 'big-giyeok', name: '큰 ㄱ자', color: 2, weight: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },
      { id: 'big-nieun-m', name: '큰 ㄴ자 대칭', color: 2, weight: 2, cells: [[0, 2], [1, 2], [2, 0], [2, 1], [2, 2]] },
      { id: 'big-giyeok-m', name: '큰 ㄱ자 대칭', color: 2, weight: 2, cells: [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]] },

      // 계단형
      { id: 'stair-1', name: '계단 ↘', color: 4, weight: 1, cells: [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]] },
      { id: 'stair-2', name: '계단 ↙', color: 4, weight: 1, cells: [[0, 2], [1, 1], [1, 2], [2, 0], [2, 1]] },
      { id: 'stair-3', name: '계단 ↗', color: 1, weight: 1, cells: [[0, 1], [0, 2], [1, 0], [1, 1], [2, 0]] },
      { id: 'stair-4', name: '계단 ↖', color: 1, weight: 1, cells: [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]] },
    ];

    const SHAPES = SHAPE_TEMPLATES.map(function (t) {
      return Object.freeze({
        id: t.id,
        name: t.name,
        color: t.color,
        weight: t.weight,
        cells: t.cells,
        width: Math.max.apply(null, t.cells.map(function (p) { return p[1]; })) + 1,
        height: Math.max.apply(null, t.cells.map(function (p) { return p[0]; })) + 1,
      });
    });

    const SHAPE_BY_ID = new Map(SHAPES.map(function (s) { return [s.id, s]; }));

    function getShape(id) {
      return SHAPE_BY_ID.get(id) || null;
    }

    /* ---- 게임판 ---- */

    function createBoard() {
      return Array.from({ length: BOARD_SIZE }, function () {
        return new Array(BOARD_SIZE).fill(EMPTY);
      });
    }

    function isBoardEmpty(board) {
      return board.every(function (row) {
        return row.every(function (v) { return v === EMPTY; });
      });
    }

    /* ---- 배치 가능 검사 ---- */

    function canPlace(board, shape, row, col) {
      if (!shape || !Number.isInteger(row) || !Number.isInteger(col)) return false;
      return shape.cells.every(function (p) {
        const r = row + p[0];
        const c = col + p[1];
        return r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE && board[r][c] === EMPTY;
      });
    }

    function canPlaceAnywhere(board, shape) {
      for (let r = 0; r <= BOARD_SIZE - shape.height; r++) {
        for (let c = 0; c <= BOARD_SIZE - shape.width; c++) {
          if (canPlace(board, shape, r, c)) return true;
        }
      }
      return false;
    }

    /* ---- 블록 고정 ---- */

    function lockShape(board, shape, row, col) {
      return shape.cells.map(function (p) {
        const r = row + p[0];
        const c = col + p[1];
        board[r][c] = shape.color;
        return { row: r, col: c, color: shape.color };
      });
    }

    /* ---- 완성 줄 탐지 ---- */

    function findCompletedLines(board) {
      const rows = [];
      const cols = [];
      for (let i = 0; i < BOARD_SIZE; i++) {
        let rowFull = true;
        let colFull = true;
        for (let j = 0; j < BOARD_SIZE; j++) {
          if (board[i][j] === EMPTY) rowFull = false;
          if (board[j][i] === EMPTY) colFull = false;
        }
        if (rowFull) rows.push(i);
        if (colFull) cols.push(i);
      }
      return { rows: rows, cols: cols };
    }

    /* ---- 줄 삭제: 가로세로 교차 칸도 한 번만 지운다 ---- */

    function clearLines(board, lines) {
      const cleared = [];
      for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c < BOARD_SIZE; c++) {
          if (board[r][c] !== EMPTY && (lines.rows.indexOf(r) !== -1 || lines.cols.indexOf(c) !== -1)) {
            cleared.push({ row: r, col: c, color: board[r][c] });
            board[r][c] = EMPTY;
          }
        }
      }
      return cleared;
    }

    /** 놓았을 때 완성될 줄을 게임판을 바꾸지 않고 미리 계산한다. */
    function previewLines(board, shape, row, col) {
      const copy = board.map(function (r) { return r.slice(); });
      lockShape(copy, shape, row, col);
      return findCompletedLines(copy);
    }

    /* ---- 점수 계산: 점수 공식은 오직 이 함수에만 있다 ---- */

    function calculateScore(input) {
      const placedCells = input.placedCells;
      const linesCleared = input.linesCleared;
      const combo = input.combo;
      const allClear = input.allClear;

      const placement = placedCells * POINTS_PER_CELL;
      const linePoints = linesCleared * POINTS_PER_LINE;
      const multiLineBonus = linesCleared >= 2
        ? (MULTI_LINE_UNIT * linesCleared * (linesCleared - 1)) / 2
        : 0;
      const comboMultiplier = linesCleared > 0
        ? Math.min(Math.max(combo, 1), COMBO_MAX_MULTIPLIER)
        : 1;
      const lineTotal = (linePoints + multiLineBonus) * comboMultiplier;
      const allClearBonus = allClear ? ALL_CLEAR_BONUS : 0;

      return {
        placement: placement,
        linePoints: linePoints,
        multiLineBonus: multiLineBonus,
        comboMultiplier: comboMultiplier,
        allClearBonus: allClearBonus,
        total: placement + lineTotal + allClearBonus,
      };
    }

    /** 콤보 상태를 다음 배치 기준으로 갱신하고 현재 콤보를 돌려준다. */
    function advanceCombo(game, linesCleared) {
      if (linesCleared > 0) {
        game.combo += 1;
        game.comboMisses = 0;
      } else if (game.combo > 0) {
        game.comboMisses += 1;
        if (game.comboMisses > COMBO_GRACE) {
          game.combo = 0;
          game.comboMisses = 0;
        }
      }
      return game.combo;
    }

    /** game.score를 바꾸는 유일한 지점. */
    function applyScore(game, breakdown) {
      game.score += breakdown.total;
    }

    /* ---- 블록 생성 ---- */

    function weightedPick(list, rng) {
      let total = 0;
      for (let i = 0; i < list.length; i++) total += list[i].weight;
      let roll = rng() * total;
      for (let i = 0; i < list.length; i++) {
        roll -= list[i].weight;
        if (roll < 0) return list[i];
      }
      return list[list.length - 1];
    }

    /**
     * 서로 다른 모양 3개를 만든다. 재시도 없이 후보 목록에서 뽑으므로 항상 끝난다.
     * 첫 블록은 현재 판에 놓을 수 있는 모양 중에서 고르고, 나머지 둘은 일반 확률을 따른다.
     */
    function generateTray(board, rng) {
      const random = rng || Math.random;
      const tray = [];
      const fitting = SHAPES.filter(function (s) { return canPlaceAnywhere(board, s); });
      if (fitting.length > 0) tray.push(weightedPick(fitting, random));

      while (tray.length < TRAY_SIZE) {
        const pool = SHAPES.filter(function (s) { return tray.indexOf(s) === -1; });
        tray.push(weightedPick(pool, random));
      }

      for (let i = tray.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const tmp = tray[i];
        tray[i] = tray[j];
        tray[j] = tmp;
      }
      return tray;
    }

    /* ---- 게임 오버 판정 ---- */

    function isGameOver(board, tray) {
      const remaining = tray.filter(Boolean);
      if (remaining.length === 0) return false;
      return !remaining.some(function (s) { return canPlaceAnywhere(board, s); });
    }

    /* ---- 한 턴 진행 ---- */

    function createGame(rng) {
      const random = rng || Math.random;
      const board = createBoard();
      return {
        board: board,
        tray: generateTray(board, random),
        score: 0,
        combo: 0,
        comboMisses: 0,
        linesTotal: 0,
        moves: 0,
        over: false,
        rng: random,
      };
    }

    function playMove(game, slot, row, col) {
      if (game.over) return { ok: false, reason: 'game-over' };
      const shape = game.tray[slot];
      if (!shape) return { ok: false, reason: 'empty-slot' };
      if (!canPlace(game.board, shape, row, col)) return { ok: false, reason: 'illegal-position' };

      const placed = lockShape(game.board, shape, row, col);
      game.tray[slot] = null;
      game.moves += 1;

      const lines = findCompletedLines(game.board);
      const linesCleared = lines.rows.length + lines.cols.length;
      const cleared = clearLines(game.board, lines);
      game.linesTotal += linesCleared;

      const combo = advanceCombo(game, linesCleared);
      const allClear = linesCleared > 0 && isBoardEmpty(game.board);
      const breakdown = calculateScore({
        placedCells: placed.length,
        linesCleared: linesCleared,
        combo: combo,
        allClear: allClear,
      });
      applyScore(game, breakdown);

      let refilled = false;
      if (game.tray.every(function (s) { return s === null; })) {
        game.tray = generateTray(game.board, game.rng);
        refilled = true;
      }
      game.over = isGameOver(game.board, game.tray);

      return {
        ok: true,
        shape: shape,
        slot: slot,
        placed: placed,
        lines: lines,
        linesCleared: linesCleared,
        cleared: cleared,
        combo: combo,
        allClear: allClear,
        breakdown: breakdown,
        refilled: refilled,
        over: game.over,
      };
    }

    return {
      BOARD_SIZE: BOARD_SIZE,
      EMPTY: EMPTY,
      TRAY_SIZE: TRAY_SIZE,
      COMBO_GRACE: COMBO_GRACE,
      COMBO_MAX_MULTIPLIER: COMBO_MAX_MULTIPLIER,
      ALL_CLEAR_BONUS: ALL_CLEAR_BONUS,
      SHAPES: SHAPES,
      getShape: getShape,
      createBoard: createBoard,
      isBoardEmpty: isBoardEmpty,
      canPlace: canPlace,
      canPlaceAnywhere: canPlaceAnywhere,
      lockShape: lockShape,
      findCompletedLines: findCompletedLines,
      clearLines: clearLines,
      previewLines: previewLines,
      calculateScore: calculateScore,
      advanceCombo: advanceCombo,
      applyScore: applyScore,
      weightedPick: weightedPick,
      generateTray: generateTray,
      isGameOver: isGameOver,
      createGame: createGame,
      playMove: playMove,
    };
  })();

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  global.BlockPang = { Core: Core };
  // 게임 화면이 없는 곳(Node, 규칙 테스트 페이지)에서는 Core만 제공한다.
  if (typeof document === 'undefined' || !document.getElementById('board')) return;

  /* ======================================================================
   * 2부. UI
   * ==================================================================== */

  const N = Core.BOARD_SIZE;
  const $ = function (id) { return document.getElementById(id); };

  /* ---- localStorage (사생활 보호 모드 등에서 실패해도 게임은 계속된다) ---- */

  const KEYS = {
    best: 'blockpangpang.best',
    sound: 'blockpangpang.sound',
    tutorial: 'blockpangpang.tutorialDone',
  };

  const Store = {
    get: function (key) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    set: function (key, value) {
      try { localStorage.setItem(key, String(value)); } catch (e) { /* 저장 불가 환경 */ }
    },
  };

  /* ---- 사운드: Web Audio API로 모든 효과음을 직접 합성한다 ---- */

  const Sound = (function () {
    let ctx = null;
    let master = null;
    let noise = null;
    let enabled = Store.get(KEYS.sound) !== 'off';

    function unlock() {
      if (!enabled) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctx) {
          ctx = new AC();
          master = ctx.createGain();
          master.gain.value = 0.55;
          master.connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
      } catch (e) {
        ctx = null;
      }
    }

    function ready() {
      return enabled && ctx !== null && ctx.state === 'running';
    }

    function tone(o) {
      const t = ctx.currentTime + (o.at || 0);
      const dur = o.dur || 0.12;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = o.type || 'sine';
      osc.frequency.setValueAtTime(o.freq, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    function noiseBurst(o) {
      if (!noise) {
        noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      const t = ctx.currentTime + (o.at || 0);
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = noise;
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(o.freq, t);
      if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
      gain.gain.setValueAtTime(o.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start(t);
      src.stop(t + o.dur + 0.02);
    }

    function play(fn) {
      return function () {
        if (!ready()) return;
        try {
          fn.apply(null, arguments);
        } catch (e) {
          console.warn('[sound]', e); // 소리 실패가 게임을 멈추면 안 된다
        }
      };
    }

    const PENTATONIC = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

    return {
      unlock: unlock,
      isEnabled: function () { return enabled; },
      toggle: function () {
        enabled = !enabled;
        Store.set(KEYS.sound, enabled ? 'on' : 'off');
        if (enabled) unlock();
        return enabled;
      },
      click: play(function () {
        tone({ freq: 660, to: 520, dur: 0.05, type: 'triangle', vol: 0.16 });
      }),
      place: play(function (cells) {
        const base = 340 - cells * 22;
        tone({ freq: base * 1.5, to: base, dur: 0.09, type: 'triangle', vol: 0.34 });
        noiseBurst({ freq: 2200, dur: 0.035, vol: 0.09 });
      }),
      invalid: play(function () {
        tone({ freq: 170, to: 120, dur: 0.11, type: 'square', vol: 0.09 });
      }),
      clear: play(function (lines) {
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
        const count = Math.min(notes.length, lines + 2);
        for (let i = 0; i < count; i++) {
          tone({ freq: notes[i], at: i * 0.055, dur: 0.2, type: 'sine', vol: 0.26 });
        }
        noiseBurst({ freq: 700, to: 5200, dur: 0.3, vol: 0.14 });
      }),
      combo: play(function (level) {
        const start = Math.min(level - 2, PENTATONIC.length - 4);
        for (let i = 0; i < 4; i++) {
          tone({ freq: PENTATONIC[start + i], at: 0.14 + i * 0.05, dur: 0.14, type: 'square', vol: 0.09 });
        }
      }),
      gameOver: play(function () {
        [392, 329.63, 261.63, 196].forEach(function (f, i) {
          tone({ freq: f, to: f * 0.94, at: i * 0.17, dur: 0.3, type: 'triangle', vol: 0.3 });
        });
      }),
      record: play(function () {
        [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
          tone({ freq: f, at: i * 0.1, dur: 0.24, type: 'triangle', vol: 0.28 });
        });
      }),
    };
  })();

  function haptic(pattern) {
    if (!Sound.isEnabled() || typeof navigator.vibrate !== 'function') return;
    try { navigator.vibrate(pattern); } catch (e) { /* 미지원 기기 */ }
  }

  /* ---- 파티클: 효과가 있을 때만 rAF를 돌린다 ---- */

  const Particles = (function () {
    const COLORS = { 1: '#4d9bff', 2: '#ffd84a', 3: '#ff9838', 4: '#46e08c', 5: '#b07cff', 6: '#ff6db0', 7: '#3fdcec' };
    const MAX = 220;
    const canvas = $('fx-canvas');
    const ctx = canvas.getContext('2d');
    const sprites = {};
    let list = [];
    let raf = 0;
    let last = 0;
    let dpr = 1;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
    }

    function sprite(color) {
      if (sprites[color]) return sprites[color];
      const s = document.createElement('canvas');
      s.width = s.height = 32;
      const g = s.getContext('2d');
      const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.28, COLORS[color]);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      sprites[color] = s;
      return s;
    }

    function tick(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.globalCompositeOperation = 'lighter';

      let alive = 0;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        list[alive++] = p;
        p.vy += 900 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const k = p.life / p.maxLife;
        const size = p.size * (0.4 + 0.6 * k);
        ctx.globalAlpha = Math.min(1, k * 1.6);
        ctx.drawImage(sprite(p.color), p.x - size / 2, p.y - size / 2, size, size);
      }
      list.length = alive;
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      if (list.length > 0) {
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    return {
      resize: resize,
      burst: function (x, y, color, count) {
        for (let i = 0; i < count && list.length < MAX; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 90 + Math.random() * 260;
          const life = 0.35 + Math.random() * 0.35;
          list.push({
            x: x, y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 140,
            life: life, maxLife: life,
            size: 10 + Math.random() * 18,
            color: color,
          });
        }
        if (!raf && list.length > 0) {
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      },
      clear: function () {
        list = [];
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      },
    };
  })();

  /* ---- 상태 ---- */

  const PHASE = {
    MENU: 'menu',
    IDLE: 'idle',
    DRAGGING: 'dragging',
    RETURNING: 'returning',
    CLEARING: 'clearing',
    PAUSED: 'paused',
    OVER: 'over',
  };

  const CLEAR_MS = 420;
  /** 칸별 시작 지연의 상한. 지연 + CSS 효과 길이(360ms)가 CLEAR_MS를 넘으면 효과가 잘린다. */
  const CLEAR_MAX_STAGGER_MS = 60;
  const RETURN_MS = 170;
  const GAME_OVER_DELAY_MS = 950;
  const FLOAT_MS = 950;
  const BANNER_MS = 1150;
  /** 이 거리 이상 끌어야 드래그로 본다. 탭만으로 블록이 놓이는 것을 막는다. */
  const DRAG_THRESHOLD_PX = 10;

  let phase = PHASE.MENU;
  let game = Core.createGame();
  let best = Number(Store.get(KEYS.best)) || 0;
  let bestAtStart = best;
  let recordAnnounced = false;
  let queuedOverlay = null;
  let drag = null;
  let dragFrame = 0;
  let renderedScore = -1;
  let renderedBest = -1;

  /* ---- 타이머: 다시 시작하면 진행 중이던 효과를 전부 취소한다 ---- */

  const timers = new Set();

  function later(ms, fn) {
    const id = setTimeout(function () {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  }

  function cancelTimers() {
    timers.forEach(clearTimeout);
    timers.clear();
  }

  /* ---- DOM 구성 ---- */

  const boardEl = $('board');
  const boardWrap = $('board-wrap');
  const fxLayer = $('fx-layer');
  const ghostEl = $('ghost');
  const ghostInner = $('ghost-inner');
  const hintEl = $('hint');
  const slotEls = Array.prototype.slice.call(document.querySelectorAll('.slot'));
  const cellEls = [];
  const tileEls = [];
  const view = []; // 화면에 그려진 값. 바뀐 칸만 DOM을 건드린다.
  const slotIds = [null, null, null];

  (function buildBoard() {
    const frag = document.createDocumentFragment();
    for (let r = 0; r < N; r++) {
      cellEls.push([]);
      tileEls.push([]);
      view.push(new Array(N).fill(0));
      for (let c = 0; c < N; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        const tile = document.createElement('div');
        tile.className = 'tile';
        tile.dataset.c = '0';
        cell.appendChild(tile);
        frag.appendChild(cell);
        cellEls[r].push(cell);
        tileEls[r].push(tile);
      }
    }
    boardEl.appendChild(frag);
  })();

  function buildPiece(shape) {
    const piece = document.createElement('div');
    piece.className = 'piece';
    piece.style.setProperty('--cols', shape.width);
    piece.style.setProperty('--rows', shape.height);
    shape.cells.forEach(function (p) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.c = String(shape.color);
      tile.style.gridRow = String(p[0] + 1);
      tile.style.gridColumn = String(p[1] + 1);
      piece.appendChild(tile);
    });
    return piece;
  }

  /* ---- 렌더링 ---- */

  function setCell(r, c, value, cls) {
    const tile = tileEls[r][c];
    const className = cls ? 'tile ' + cls : 'tile';
    if (view[r][c] !== value) {
      view[r][c] = value;
      tile.dataset.c = String(value);
    }
    if (tile.className !== className) tile.className = className;
  }

  function renderBoard() {
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) setCell(r, c, game.board[r][c]);
    }
  }

  function renderTray() {
    game.tray.forEach(function (shape, i) {
      const el = slotEls[i];
      const id = shape ? shape.id : null;
      if (slotIds[i] !== id) {
        slotIds[i] = id;
        el.replaceChildren();
        if (shape) {
          const piece = buildPiece(shape);
          piece.classList.add('deal');
          piece.style.animationDelay = i * 60 + 'ms';
          el.appendChild(piece);
          el.setAttribute('aria-label', shape.name + ' 블록');
        } else {
          el.setAttribute('aria-label', '빈 칸');
        }
      }
      el.classList.toggle('is-empty', !shape);
      el.classList.toggle('is-stuck', !!shape && !Core.canPlaceAnywhere(game.board, shape));
    });
  }

  function emptySlot(i) {
    slotIds[i] = null;
    slotEls[i].replaceChildren();
    slotEls[i].classList.add('is-empty');
    slotEls[i].classList.remove('is-stuck', 'dragging');
  }

  function bump(el) {
    if (el.animate) {
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 240, easing: 'ease-out' }
      );
    }
  }

  function renderHud() {
    if (game.score !== renderedScore) {
      const grew = game.score > renderedScore && renderedScore >= 0;
      renderedScore = game.score;
      $('score').textContent = game.score.toLocaleString('ko-KR');
      if (grew) bump($('score'));
    }
    if (game.score > best) {
      best = game.score;
      Store.set(KEYS.best, best);
    }
    if (best !== renderedBest) {
      renderedBest = best;
      const text = best.toLocaleString('ko-KR');
      $('best').textContent = text;
      $('title-best').textContent = text;
    }
    renderCombo();
  }

  function renderCombo() {
    const chip = $('combo');
    const active = game.combo > 0;
    chip.classList.toggle('is-active', active);
    $('combo-value').textContent = active
      ? '×' + Math.min(Math.max(game.combo, 1), Core.COMBO_MAX_MULTIPLIER)
      : '–';
    const left = active ? Core.COMBO_GRACE + 1 - game.comboMisses : 0;
    Array.prototype.forEach.call($('combo-pips').children, function (pip, i) {
      pip.classList.toggle('on', i < left);
    });
  }

  function renderAll() {
    renderBoard();
    renderTray();
    renderHud();
  }

  /* ---- 드래그 ---- */

  function measureBoard(d) {
    const a = cellEls[0][0].getBoundingClientRect();
    const b = cellEls[0][1].getBoundingClientRect();
    d.boardLeft = a.left;
    d.boardTop = a.top;
    d.cell = a.width;
    d.pitch = b.left - a.left;
    d.gap = d.pitch - d.cell;
    d.width = d.shape.width * d.pitch - d.gap;
    d.height = d.shape.height * d.pitch - d.gap;
    // 터치는 블록 전체가 손가락 위로 올라오도록, 마우스는 커서 중심에 둔다.
    d.lift = d.pointerType === 'mouse' ? 0 : d.height / 2 + Math.max(36, d.pitch * 1.1);
    ghostEl.style.setProperty('--cell', d.cell + 'px');
    ghostEl.style.setProperty('--gap', d.gap + 'px');
  }

  function ghostTopLeft(d) {
    return { left: d.x - d.width / 2, top: d.y - d.height / 2 - d.lift };
  }

  function moveGhost(left, top) {
    ghostEl.style.transform = 'translate3d(' + left + 'px,' + top + 'px,0)';
  }

  function hideGhost() {
    ghostEl.hidden = true;
    ghostEl.classList.remove('returning', 'bad');
    ghostInner.replaceChildren();
    ghostInner.style.transform = '';
    slotEls.forEach(function (el) { el.classList.remove('dragging'); });
  }

  let markedCells = [];

  function clearPreview() {
    for (let i = 0; i < markedCells.length; i++) {
      markedCells[i].classList.remove('pv-ok', 'pv-bad', 'pv-line');
      delete markedCells[i].dataset.pc;
    }
    markedCells = [];
  }

  function markCell(r, c, cls, color) {
    const el = cellEls[r][c];
    el.classList.add(cls);
    if (color) el.dataset.pc = String(color);
    markedCells.push(el);
  }

  function updatePreview(d) {
    if (!d.moved) return;
    const pos = ghostTopLeft(d);
    const row = Math.round((pos.top - d.boardTop) / d.pitch);
    const col = Math.round((pos.left - d.boardLeft) / d.pitch);
    const inBoard = d.shape.cells.filter(function (p) {
      const r = row + p[0];
      const c = col + p[1];
      return r >= 0 && r < N && c >= 0 && c < N;
    });
    const key = inBoard.length ? row + ',' + col : 'none';
    if (key === d.previewKey) return;
    d.previewKey = key;
    clearPreview();
    d.valid = false;
    if (!inBoard.length) {
      ghostEl.classList.remove('bad');
      return;
    }

    d.row = row;
    d.col = col;
    d.valid = Core.canPlace(game.board, d.shape, row, col);
    ghostEl.classList.toggle('bad', !d.valid);

    if (d.valid) {
      const lines = Core.previewLines(game.board, d.shape, row, col);
      lines.rows.forEach(function (r) {
        for (let c = 0; c < N; c++) markCell(r, c, 'pv-line');
      });
      lines.cols.forEach(function (c) {
        for (let r = 0; r < N; r++) markCell(r, c, 'pv-line');
      });
    }
    inBoard.forEach(function (p) {
      markCell(row + p[0], col + p[1], d.valid ? 'pv-ok' : 'pv-bad', d.shape.color);
    });
  }

  function applyDragPosition(d) {
    const pos = ghostTopLeft(d);
    moveGhost(pos.left, pos.top);
    updatePreview(d);
  }

  function onDragFrame() {
    dragFrame = 0;
    if (drag) applyDragPosition(drag);
  }

  function stopDragFrame() {
    if (dragFrame) cancelAnimationFrame(dragFrame);
    dragFrame = 0;
  }

  function onSlotPointerDown(e) {
    if (phase !== PHASE.IDLE || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.currentTarget;
    const slot = Number(el.dataset.slot);
    const shape = game.tray[slot];
    if (!shape) return;
    e.preventDefault();

    const d = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      slot: slot,
      shape: shape,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      previewKey: 'none',
      valid: false,
      row: 0,
      col: 0,
      miniScale: 1,
    };
    measureBoard(d);

    const source = el.querySelector('.piece');
    d.miniScale = source ? source.getBoundingClientRect().width / d.width : 0.5;

    drag = d;
    phase = PHASE.DRAGGING;
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* window 리스너가 대신 처리 */ }

    ghostInner.replaceChildren(buildPiece(shape));
    ghostInner.style.transition = 'none';
    ghostInner.style.transform = 'scale(' + d.miniScale + ')';
    ghostEl.hidden = false;
    el.classList.add('dragging');
    applyDragPosition(d);
    void ghostInner.offsetWidth; // 시작 배율을 확정한 뒤 전환을 켠다
    ghostInner.style.transition = '';
    ghostInner.style.transform = 'scale(1)';
  }

  function trackPointer(d, e) {
    d.x = e.clientX;
    d.y = e.clientY;
    if (!d.moved && Math.hypot(d.x - d.startX, d.y - d.startY) >= DRAG_THRESHOLD_PX) d.moved = true;
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    trackPointer(drag, e);
    if (!dragFrame) dragFrame = requestAnimationFrame(onDragFrame);
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    stopDragFrame();
    trackPointer(drag, e);
    updatePreview(drag);
    if (drag.valid) commitDrag();
    else cancelDrag();
  }

  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    cancelDrag();
  }

  /** 잡은 블록을 원위치로 부드럽게 돌려보낸다. */
  function cancelDrag() {
    const d = drag;
    if (!d) return;
    if (d.previewKey !== 'none') Sound.invalid();
    drag = null;
    stopDragFrame();
    clearPreview();
    phase = PHASE.RETURNING;

    const rect = slotEls[d.slot].getBoundingClientRect();
    ghostEl.classList.remove('bad');
    ghostEl.classList.add('returning');
    moveGhost(rect.left + rect.width / 2 - d.width / 2, rect.top + rect.height / 2 - d.height / 2);
    ghostInner.style.transform = 'scale(' + d.miniScale + ')';

    later(RETURN_MS, function () {
      hideGhost();
      settle();
    });
  }

  /** 효과 없이 드래그를 즉시 끝낸다. (일시정지, 다시 시작 등) */
  function abortDrag() {
    drag = null;
    stopDragFrame();
    clearPreview();
    hideGhost();
  }

  function commitDrag() {
    const d = drag;
    drag = null;
    clearPreview();
    const result = Core.playMove(game, d.slot, d.row, d.col);
    if (!result.ok) {
      drag = d;
      cancelDrag();
      return;
    }
    hideGhost();
    presentMove(result);
  }

  /* ---- 한 수의 결과를 화면에 표현 ---- */

  function presentMove(result) {
    hideHint();
    emptySlot(result.slot);

    result.placed.forEach(function (p) { setCell(p.row, p.col, p.color, 'pop'); });
    renderHud();
    showFloat(result);
    Sound.place(result.placed.length);
    haptic(8);

    if (result.linesCleared === 0) {
      renderTray();
      if (game.over) enterGameOver();
      else phase = PHASE.IDLE;
      return;
    }

    phase = PHASE.CLEARING;
    playClearEffects(result);
    announce(result);

    later(CLEAR_MS, function () {
      result.cleared.forEach(function (p) {
        setCell(p.row, p.col, 0);
        tileEls[p.row][p.col].style.animationDelay = '';
      });
      renderTray();
      if (game.over) {
        queuedOverlay = null;
        enterGameOver();
      } else {
        settle();
      }
    });
  }

  function playClearEffects(result) {
    const m = {};
    measureBoardInto(m);
    const lastPlaced = result.placed[0];
    const perCell = Math.max(2, Math.min(6, Math.floor(200 / result.cleared.length)));

    result.cleared.forEach(function (p) {
      const dist = Math.abs(p.row - lastPlaced.row) + Math.abs(p.col - lastPlaced.col);
      const tile = tileEls[p.row][p.col];
      setCell(p.row, p.col, p.color, 'clearing');
      tile.style.animationDelay = Math.min(dist * 9, CLEAR_MAX_STAGGER_MS) + 'ms';
      Particles.burst(
        m.left + p.col * m.pitch + m.cell / 2,
        m.top + p.row * m.pitch + m.cell / 2,
        p.color,
        perCell
      );
    });

    Sound.clear(result.linesCleared);
    if (result.combo >= 2) Sound.combo(result.combo);
    haptic(result.linesCleared >= 2 ? [24, 30, 24, 30, 40] : [20, 30, 20]);

    if (result.linesCleared >= 3 && boardWrap.animate) {
      boardWrap.animate(
        [
          { transform: 'translateX(0)' },
          { transform: 'translateX(-5px)' },
          { transform: 'translateX(5px)' },
          { transform: 'translateX(-3px)' },
          { transform: 'translateX(0)' },
        ],
        { duration: 260 }
      );
    }
  }

  function measureBoardInto(m) {
    const a = cellEls[0][0].getBoundingClientRect();
    const b = cellEls[0][1].getBoundingClientRect();
    m.left = a.left;
    m.top = a.top;
    m.cell = a.width;
    m.pitch = b.left - a.left;
  }

  function showFloat(result) {
    let sumR = 0;
    let sumC = 0;
    result.placed.forEach(function (p) { sumR += p.row; sumC += p.col; });
    const x = ((sumC / result.placed.length + 0.5) / N) * 100;
    const y = ((sumR / result.placed.length + 0.5) / N) * 100;
    // 가운데 배너가 뜨는 경우에는 점수가 가려지지 않도록 배너 아래에 표시한다.
    const hasBanner = result.allClear || result.linesCleared >= 2 || result.combo >= 2;

    const el = document.createElement('div');
    el.className = 'float' + (result.linesCleared > 0 ? ' is-big' : '');
    el.textContent = '+' + result.breakdown.total;
    el.style.left = (hasBanner ? 50 : Math.max(12, Math.min(88, x))) + '%';
    el.style.top = (hasBanner ? 80 : Math.max(10, Math.min(90, y))) + '%';
    fxLayer.appendChild(el);
    later(FLOAT_MS, function () { el.remove(); });
  }

  function showBanner(text, cls) {
    const el = document.createElement('div');
    el.className = 'banner ' + cls;
    el.textContent = text;
    fxLayer.appendChild(el);
    later(BANNER_MS, function () { el.remove(); });
  }

  function announce(result) {
    if (result.allClear) showBanner('ALL CLEAR!', 'banner-main is-gold');
    else if (result.linesCleared >= 4) showBanner('PERFECT!', 'banner-main is-gold');
    else if (result.linesCleared === 3) showBanner('EXCELLENT!', 'banner-main');
    else if (result.linesCleared === 2) showBanner('GREAT!', 'banner-main');

    if (result.combo >= 2) {
      showBanner('COMBO ×' + result.breakdown.comboMultiplier, 'banner-combo');
    }
    if (!recordAnnounced && bestAtStart > 0 && game.score > bestAtStart) {
      recordAnnounced = true;
      showBanner('신기록!', 'banner-record');
    }
  }

  /** 애니메이션이 끝나 다시 입력을 받을 수 있는 상태로 돌아간다. */
  function settle() {
    phase = PHASE.IDLE;
    if (queuedOverlay) {
      const kind = queuedOverlay;
      queuedOverlay = null;
      openOverlay(kind);
    }
  }

  /* ---- 화면 전환 ---- */

  function show(id) { $(id).hidden = false; }
  function hide(id) { $(id).hidden = true; }

  function hideAllScreens() {
    ['screen-title', 'screen-pause', 'screen-confirm', 'screen-over', 'screen-tutorial'].forEach(hide);
  }

  function resetTransient() {
    cancelTimers();
    abortDrag();
    queuedOverlay = null;
    fxLayer.replaceChildren();
    Particles.clear();
    boardEl.classList.remove('is-dead');
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) tileEls[r][c].style.animationDelay = '';
    }
  }

  function startNewGame() {
    resetTransient();
    game = Core.createGame();
    bestAtStart = best;
    recordAnnounced = false;
    renderAll();
    hideAllScreens();
    phase = PHASE.IDLE;
    if (Store.get(KEYS.tutorial) === 'hint') showHint();
  }

  function showHint() { hintEl.hidden = false; }

  function hideHint() {
    if (hintEl.hidden) return;
    hintEl.hidden = true;
    Store.set(KEYS.tutorial, 'done');
  }

  function goToTitle() {
    resetTransient();
    hideAllScreens();
    hideHint();
    show('screen-title');
    phase = PHASE.MENU;
  }

  function openOverlay(kind) {
    phase = PHASE.PAUSED;
    show(kind === 'confirm' ? 'screen-confirm' : 'screen-pause');
  }

  function requestOverlay(kind) {
    if (phase === PHASE.DRAGGING) {
      abortDrag();
      phase = PHASE.IDLE;
    }
    if (phase === PHASE.RETURNING || phase === PHASE.CLEARING) {
      queuedOverlay = kind;
      return;
    }
    if (phase === PHASE.IDLE) openOverlay(kind);
  }

  function resumeGame() {
    hide('screen-pause');
    hide('screen-confirm');
    phase = PHASE.IDLE;
  }

  function requestRestart() {
    if (phase === PHASE.OVER || phase === PHASE.MENU) return;
    if (game.score === 0 && phase === PHASE.IDLE) startNewGame();
    else requestOverlay('confirm');
  }

  function enterGameOver() {
    phase = PHASE.OVER;
    boardEl.classList.add('is-dead');
    Sound.gameOver();
    haptic([60, 50, 120]);
    later(GAME_OVER_DELAY_MS, showGameOverScreen);
  }

  function showGameOverScreen() {
    const isRecord = game.score > bestAtStart && game.score > 0;
    $('over-score').textContent = game.score.toLocaleString('ko-KR');
    $('over-best').textContent = best.toLocaleString('ko-KR');
    $('over-record').hidden = !isRecord;
    $('over-norecord').hidden = isRecord;
    show('screen-over');
    if (isRecord) Sound.record();
  }

  /* ---- 튜토리얼 ---- */

  function demoBoard(rows) {
    const el = document.createElement('div');
    el.className = 'demo-board';
    el.style.setProperty('--n', rows[0].length);
    rows.forEach(function (row) {
      row.split('').forEach(function (ch) {
        const cell = document.createElement('div');
        cell.className = 'demo-cell';
        if (ch !== '.') {
          const tile = document.createElement('div');
          tile.className = 'tile' + (ch === '*' ? ' demo-flash' : '');
          tile.dataset.c = ch === '*' ? '2' : ch;
          cell.appendChild(tile);
        }
        el.appendChild(cell);
      });
    });
    return el;
  }

  const TUTORIAL = [
    {
      title: '끌어다 놓기',
      text: '아래 블록 3개 중 하나를 끌어서 빈 칸에 놓으세요. 블록은 돌릴 수 없어요.',
      build: function () {
        const wrap = document.createElement('div');
        wrap.className = 'demo-wrap';
        wrap.appendChild(demoBoard(['......', '.33...', '.3....', '....11', '444.11']));
        const piece = buildPiece(Core.getShape('sq2'));
        piece.classList.add('demo-piece');
        wrap.appendChild(piece);
        return wrap;
      },
    },
    {
      title: '줄을 채우면 팡!',
      text: '가로나 세로 8칸을 꽉 채우면 줄이 사라져요. 여러 줄을 한 번에 지우면 보너스 점수!',
      build: function () {
        const wrap = document.createElement('div');
        wrap.className = 'demo-wrap';
        wrap.appendChild(demoBoard(['..5...', '..5.1.', '******', '.4..1.', '.4.33.']));
        return wrap;
      },
    },
    {
      title: '콤보를 이어 가세요',
      text: '줄을 계속 지우면 점수 배수가 올라가요. 놓을 곳이 없는 블록만 남으면 게임 오버!',
      build: function () {
        const wrap = document.createElement('div');
        wrap.className = 'demo-wrap';
        const chip = document.createElement('div');
        chip.className = 'demo-combo';
        chip.textContent = 'COMBO ×3';
        wrap.appendChild(chip);
        wrap.appendChild(demoBoard(['.2..6.', '.2..6.', '******', '7...66', '77...1']));
        return wrap;
      },
    },
  ];

  let tutorialStep = 0;
  let tutorialDone = null;

  function renderTutorial() {
    const step = TUTORIAL[tutorialStep];
    $('tutorial-art').replaceChildren(step.build());
    $('tutorial-title').textContent = step.title;
    $('tutorial-text').textContent = step.text;
    $('btn-tutorial-prev').disabled = tutorialStep === 0;
    $('btn-tutorial-next').textContent = tutorialStep === TUTORIAL.length - 1 ? '알겠어요!' : '다음';
    Array.prototype.forEach.call($('tutorial-dots').children, function (dot, i) {
      dot.classList.toggle('on', i === tutorialStep);
    });
  }

  function openTutorial(onDone) {
    tutorialStep = 0;
    tutorialDone = onDone;
    renderTutorial();
    show('screen-tutorial');
  }

  function closeTutorial() {
    hide('screen-tutorial');
    const done = tutorialDone;
    tutorialDone = null;
    if (done) done();
  }

  function startFromTitle() {
    if (Store.get(KEYS.tutorial)) {
      startNewGame();
      return;
    }
    openTutorial(function () {
      Store.set(KEYS.tutorial, 'hint'); // 첫 판에서 안내 문구를 한 번 보여준다
      startNewGame();
    });
  }

  /* ---- 이벤트 연결 ---- */

  function renderSoundButtons() {
    const on = Sound.isEnabled();
    document.querySelectorAll('.sound-toggle').forEach(function (btn) {
      btn.classList.toggle('is-off', !on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? '사운드 끄기' : '사운드 켜기');
    });
  }

  function bindClick(id, fn) {
    $(id).addEventListener('click', fn);
  }

  function bindEvents() {
    slotEls.forEach(function (el) {
      el.addEventListener('pointerdown', onSlotPointerDown);
      el.addEventListener('lostpointercapture', function (e) {
        if (drag && e.pointerId === drag.pointerId) cancelDrag();
      });
    });
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    // iOS Safari 예전 버전을 위한 스크롤, 확대 방지. 안내 화면의 세로 스크롤만 허용한다.
    document.addEventListener('touchmove', function (e) {
      if (!e.cancelable) return;
      if (drag || !e.target.closest('.scrollable')) e.preventDefault();
    }, { passive: false });
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('dragstart', function (e) { e.preventDefault(); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    // 터치 기기에서는 pointerdown이 사용자 동작으로 인정되지 않아 손을 뗄 때도 오디오를 깨운다.
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(function (type) {
      document.addEventListener(type, Sound.unlock, true);
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('button')) Sound.click();
    });

    window.addEventListener('resize', function () {
      Particles.resize();
      if (drag) {
        measureBoard(drag);
        drag.previewKey = 'stale';
        applyDragPosition(drag);
      }
    });
    window.addEventListener('blur', function () { if (drag) cancelDrag(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) requestOverlay('pause');
    });
    window.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (drag) cancelDrag();
      else if (phase === PHASE.IDLE) requestOverlay('pause');
      else if (phase === PHASE.PAUSED && $('screen-tutorial').hidden) resumeGame();
    });

    bindClick('btn-start', startFromTitle);
    bindClick('btn-howto', function () { openTutorial(null); });
    bindClick('btn-pause', function () { requestOverlay('pause'); });
    bindClick('btn-restart', requestRestart);
    bindClick('btn-resume', resumeGame);
    bindClick('btn-pause-restart', startNewGame);
    bindClick('btn-pause-howto', function () { openTutorial(null); });
    bindClick('btn-pause-title', goToTitle);
    bindClick('btn-confirm-yes', startNewGame);
    bindClick('btn-confirm-no', resumeGame);
    bindClick('btn-retry', startNewGame);
    bindClick('btn-over-title', goToTitle);

    bindClick('btn-tutorial-prev', function () {
      if (tutorialStep > 0) {
        tutorialStep -= 1;
        renderTutorial();
      }
    });
    bindClick('btn-tutorial-next', function () {
      if (tutorialStep < TUTORIAL.length - 1) {
        tutorialStep += 1;
        renderTutorial();
      } else {
        closeTutorial();
      }
    });
    bindClick('btn-tutorial-skip', closeTutorial);

    document.querySelectorAll('.sound-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        Sound.toggle();
        renderSoundButtons();
      });
    });
  }

  /* ---- 시작 ---- */

  bindEvents();
  Particles.resize();
  renderSoundButtons();
  renderAll();

  /* ---- 자동화 테스트(tests/e2e.js)용 관찰 창구. 게임 진행에는 쓰이지 않는다. ---- */

  global.BlockPang.debug = {
    snapshot: function () {
      return {
        phase: phase,
        score: game.score,
        best: best,
        combo: game.combo,
        over: game.over,
        board: game.board.map(function (r) { return r.slice(); }),
        tray: game.tray.map(function (s) { return s ? s.id : null; }),
        dragging: drag !== null,
      };
    },
    loadScenario: function (s) {
      resetTransient();
      game = Core.createGame();
      game.board = s.board.map(function (r) { return r.slice(); });
      game.tray = s.tray.map(function (id) { return id ? Core.getShape(id) : null; });
      game.score = s.score || 0;
      game.combo = s.combo || 0;
      game.over = false;
      bestAtStart = best;
      recordAnnounced = false;
      renderAll();
      hideAllScreens();
      hideHint();
      phase = PHASE.IDLE;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
