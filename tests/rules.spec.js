/*
 * 게임 규칙 테스트. Node(tests/run-tests.js)와 브라우저(tests/index.html)가 함께 사용한다.
 * 항목 앞의 [검증 n]은 요구사항 9번의 검증 번호다.
 */
(function (root) {
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function defineTests(Core, test, assert) {
    const N = Core.BOARD_SIZE;
    const S = Core.getShape;

    function fullBoard() {
      return Core.createBoard().map(function (r) { return r.map(function () { return 1; }); });
    }

    function gameWith(board, trayIds, rng) {
      const g = Core.createGame(rng || makeRng(1));
      g.board = board;
      g.tray = trayIds.map(function (id) { return id ? S(id) : null; });
      return g;
    }

    function filled(board) {
      let n = 0;
      board.forEach(function (r) { r.forEach(function (v) { if (v) n++; }); });
      return n;
    }

    /* ---- 블록 템플릿 ---- */

    test('블록 템플릿이 20종 이상이고 필수 모양을 모두 포함한다', function () {
      assert.ok(Core.SHAPES.length >= 20, '종류 수: ' + Core.SHAPES.length);
      ['single', 'h2', 'v2', 'h3', 'v3', 'h4', 'v4', 'h5', 'v5', 'sq2', 'sq3',
        'l-0', 't-up', 'giyeok', 'nieun', 's-h', 'z-h', 'stair-1'].forEach(function (id) {
        assert.ok(S(id), id + ' 없음');
      });
    });

    test('템플릿 좌표가 정규화되어 있고 중복이 없다', function () {
      const geometry = new Set();
      const ids = new Set();
      Core.SHAPES.forEach(function (s) {
        assert.ok(!ids.has(s.id), '중복 id ' + s.id);
        ids.add(s.id);
        assert.ok(s.weight > 0, s.id + ' 가중치');
        assert.ok(s.color >= 1 && s.color <= 7, s.id + ' 색상');
        const rows = s.cells.map(function (p) { return p[0]; });
        const cols = s.cells.map(function (p) { return p[1]; });
        assert.equal(Math.min.apply(null, rows), 0, s.id + ' 최소 행');
        assert.equal(Math.min.apply(null, cols), 0, s.id + ' 최소 열');
        const key = s.cells.map(String).sort().join('|');
        assert.equal(new Set(s.cells.map(String)).size, s.cells.length, s.id + ' 칸 중복');
        assert.ok(!geometry.has(key), '같은 모양 중복 ' + s.id);
        geometry.add(key);
      });
    });

    /* ---- 배치 ---- */

    test('[검증 1] 빈 판에서 모든 블록을 가능한 모든 위치에 놓을 수 있다', function () {
      Core.SHAPES.forEach(function (s) {
        for (let r = 0; r <= N - s.height; r++) {
          for (let c = 0; c <= N - s.width; c++) {
            assert.ok(Core.canPlace(Core.createBoard(), s, r, c), s.id + ' @' + r + ',' + c);
          }
        }
      });
    });

    test('[검증 2] 기존 블록과 한 칸이라도 겹치면 놓을 수 없다', function () {
      Core.SHAPES.forEach(function (s) {
        s.cells.forEach(function (p) {
          const b = Core.createBoard();
          b[2 + p[0]][2 + p[1]] = 3;
          assert.equal(Core.canPlace(b, s, 2, 2), false, s.id);
        });
      });
      const g = gameWith(Core.createBoard(), ['sq2', 'h2', 'v2']);
      assert.ok(Core.playMove(g, 0, 0, 0).ok);
      const before = JSON.stringify(g.board);
      const r = Core.playMove(g, 1, 1, 1);
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'illegal-position');
      assert.equal(JSON.stringify(g.board), before, '거부된 수가 판을 바꾸면 안 된다');
      assert.equal(g.tray[1].id, 'h2', '거부된 블록은 트레이에 남는다');
    });

    test('[검증 3] 게임판 경계 밖에는 놓을 수 없다', function () {
      const b = Core.createBoard();
      Core.SHAPES.forEach(function (s) {
        assert.equal(Core.canPlace(b, s, -1, 0), false, s.id + ' 위');
        assert.equal(Core.canPlace(b, s, 0, -1), false, s.id + ' 왼쪽');
        assert.equal(Core.canPlace(b, s, N - s.height + 1, 0), false, s.id + ' 아래');
        assert.equal(Core.canPlace(b, s, 0, N - s.width + 1), false, s.id + ' 오른쪽');
      });
      assert.equal(Core.canPlace(b, S('single'), 0.5, 0), false, '정수가 아닌 좌표');
      assert.equal(Core.canPlace(b, S('single'), NaN, 0), false, 'NaN 좌표');
    });

    test('블록을 놓으면 해당 칸에 정확히 고정되고 칸당 1점을 얻는다', function () {
      const g = gameWith(Core.createBoard(), ['rect23', 'h2', 'v2']);
      const r = Core.playMove(g, 0, 3, 4);
      assert.ok(r.ok);
      assert.equal(g.score, 6);
      assert.equal(filled(g.board), 6);
      S('rect23').cells.forEach(function (p) {
        assert.equal(g.board[3 + p[0]][4 + p[1]], S('rect23').color);
      });
    });

    test('빈 슬롯이나 잘못된 슬롯 번호는 거부한다', function () {
      const g = gameWith(Core.createBoard(), [null, 'h2', 'v2']);
      assert.equal(Core.playMove(g, 0, 0, 0).reason, 'empty-slot');
      assert.equal(Core.playMove(g, 9, 0, 0).reason, 'empty-slot');
      assert.equal(g.score, 0);
    });

    /* ---- 줄 제거 ---- */

    test('[검증 4] 가로줄이 완성되면 그 줄만 정확히 사라진다', function () {
      const b = Core.createBoard();
      for (let c = 0; c < 7; c++) b[3][c] = 2;
      b[4][0] = 5;
      const g = gameWith(b, ['single', 'h2', 'v2']);
      const r = Core.playMove(g, 0, 3, 7);
      assert.deepEqual(r.lines, { rows: [3], cols: [] });
      assert.equal(r.cleared.length, 8);
      assert.equal(filled(g.board), 1);
      assert.equal(g.board[4][0], 5, '다른 줄은 그대로');
    });

    test('[검증 4] 세로줄이 완성되면 그 줄만 정확히 사라진다', function () {
      const b = Core.createBoard();
      for (let r = 1; r < 8; r++) b[r][5] = 2;
      b[1][4] = 5;
      const g = gameWith(b, ['single', 'h2', 'v2']);
      const r = Core.playMove(g, 0, 0, 5);
      assert.deepEqual(r.lines, { rows: [], cols: [5] });
      assert.equal(r.cleared.length, 8);
      assert.equal(filled(g.board), 1);
      assert.equal(g.board[1][4], 5);
    });

    test('줄이 사라져도 위쪽 블록이 아래로 떨어지지 않는다', function () {
      const b = Core.createBoard();
      for (let c = 0; c < 7; c++) b[5][c] = 2;
      b[2][2] = 4;
      const g = gameWith(b, ['single', 'h2', 'v2']);
      Core.playMove(g, 0, 5, 7);
      assert.equal(g.board[2][2], 4);
      assert.equal(g.board[3][2], 0);
    });

    test('[검증 5] 가로세로 동시 제거: 교차 칸을 한 번만 세고 점수를 한 번만 더한다', function () {
      const b = Core.createBoard();
      for (let i = 0; i < 8; i++) {
        if (i !== 4) { b[2][i] = 1; }
      }
      for (let i = 0; i < 8; i++) {
        if (i !== 2) { b[i][4] = 1; }
      }
      const g = gameWith(b, ['single', 'h2', 'v2']);
      const r = Core.playMove(g, 0, 2, 4);
      assert.equal(r.linesCleared, 2);
      assert.equal(r.cleared.length, 15, '8 + 8 - 교차 1');
      assert.ok(Core.isBoardEmpty(g.board));
      // 배치 1 + (줄 20 + 2줄 보너스 10) × 콤보 1 + 전부 제거 100
      assert.equal(g.score, 131);
      assert.equal(r.breakdown.total, 131);
    });

    test('[검증 5] 여러 가로세로줄을 한 번에 지워도 중복 없이 계산한다', function () {
      const b = Core.createBoard();
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (!(r < 2 && c < 2) && (r < 2 || c < 2)) b[r][c] = 1;
        }
      }
      b[7][7] = 6;
      const g = gameWith(b, ['sq2', 'h2', 'v2']);
      const r = Core.playMove(g, 0, 0, 0);
      assert.equal(r.linesCleared, 4);
      assert.equal(r.cleared.length, 28, '4×8 - 교차 4');
      assert.equal(filled(g.board), 1);
      assert.equal(g.score, 4 + 40 + 60);
    });

    /* ---- 점수 ---- */

    test('점수 공식: 줄, 다중 줄, 콤보 배수, 전부 제거', function () {
      const f = Core.calculateScore;
      assert.equal(f({ placedCells: 3, linesCleared: 0, combo: 0, allClear: false }).total, 3);
      assert.equal(f({ placedCells: 3, linesCleared: 1, combo: 1, allClear: false }).total, 13);
      assert.equal(f({ placedCells: 1, linesCleared: 2, combo: 1, allClear: false }).total, 31);
      assert.equal(f({ placedCells: 1, linesCleared: 3, combo: 1, allClear: false }).total, 61);
      assert.equal(f({ placedCells: 1, linesCleared: 1, combo: 3, allClear: false }).total, 31);
      assert.equal(f({ placedCells: 1, linesCleared: 2, combo: 2, allClear: false }).total, 61);
      assert.equal(f({ placedCells: 1, linesCleared: 1, combo: 99, allClear: false }).comboMultiplier,
        Core.COMBO_MAX_MULTIPLIER);
      assert.equal(f({ placedCells: 1, linesCleared: 1, combo: 1, allClear: true }).total, 111);
    });

    test('콤보: 연속 제거 시 배수가 오르고 유예를 넘기면 끊어진다', function () {
      const nearLine = function (row) {
        const b = Core.createBoard();
        for (let c = 0; c < 7; c++) b[row][c] = 2;
        b[7][7] = 3;
        return b;
      };
      const g = gameWith(nearLine(0), ['single', 'h2', 'v2']);
      let r = Core.playMove(g, 0, 0, 7);
      assert.equal(r.combo, 1);
      assert.equal(r.breakdown.comboMultiplier, 1);

      for (let c = 0; c < 7; c++) g.board[1][c] = 2;
      g.tray = [S('single'), S('h2'), S('v2')];
      r = Core.playMove(g, 0, 1, 7);
      assert.equal(r.combo, 2);
      assert.equal(r.breakdown.comboMultiplier, 2);
      assert.equal(r.breakdown.total, 21);

      for (let i = 0; i < Core.COMBO_GRACE; i++) {
        g.tray = [S('single'), S('h2'), S('v2')];
        r = Core.playMove(g, 0, 4, i);
        assert.equal(r.combo, 2, '유예 ' + i);
      }
      g.tray = [S('single'), S('h2'), S('v2')];
      r = Core.playMove(g, 0, 4, 5);
      assert.equal(r.combo, 0, '유예 초과');
      assert.equal(g.comboMisses, 0);
    });

    /* ---- 트레이 ---- */

    test('[검증 6] 세 블록을 모두 써야 정확히 세 개가 다시 생성된다', function () {
      const g = gameWith(Core.createBoard(), ['single', 'h2', 'v2']);
      let r = Core.playMove(g, 0, 0, 0);
      assert.equal(r.refilled, false);
      assert.equal(g.tray.filter(Boolean).length, 2);
      r = Core.playMove(g, 1, 3, 0);
      assert.equal(r.refilled, false);
      assert.equal(g.tray.filter(Boolean).length, 1);
      r = Core.playMove(g, 2, 5, 5);
      assert.equal(r.refilled, true);
      assert.equal(g.tray.length, 3);
      assert.equal(g.tray.filter(Boolean).length, 3);
    });

    test('트레이의 블록 3개는 서로 다른 모양이다', function () {
      const rng = makeRng(7);
      for (let i = 0; i < 3000; i++) {
        const t = Core.generateTray(Core.createBoard(), rng);
        assert.equal(t.length, 3);
        assert.equal(new Set(t.map(function (s) { return s.id; })).size, 3);
      }
    });

    test('블록 생성: 무작위 판에서도 최소 하나는 놓을 수 있다', function () {
      const rng = makeRng(99);
      for (let i = 0; i < 3000; i++) {
        const density = rng();
        const b = Core.createBoard().map(function (row) {
          return row.map(function () { return rng() < density ? 1 : 0; });
        });
        if (b.every(function (row) { return row.every(Boolean); })) continue;
        const t = Core.generateTray(b, rng);
        assert.ok(t.some(function (s) { return Core.canPlaceAnywhere(b, s); }), '판 ' + i);
      }
    });

    test('블록 생성: 빈칸이 1개뿐이면 1칸 블록을 반드시 포함한다', function () {
      const b = fullBoard();
      b[6][3] = 0;
      const rng = makeRng(5);
      for (let i = 0; i < 200; i++) {
        assert.ok(Core.generateTray(b, rng).some(function (s) { return s.id === 'single'; }));
      }
    });

    test('블록 생성: 놓을 곳이 전혀 없는 판에서도 멈추지 않고 3개를 돌려준다', function () {
      const b = fullBoard();
      const rng = makeRng(3);
      const t = Core.generateTray(b, rng);
      assert.equal(t.length, 3);
      assert.equal(Core.isGameOver(b, t), true);
    });

    test('블록 생성: 난수가 극단값이어도 끝나고 유효한 결과를 낸다', function () {
      [function () { return 0; }, function () { return 0.999999999; }].forEach(function (rng) {
        const t = Core.generateTray(Core.createBoard(), rng);
        assert.equal(t.length, 3);
        assert.equal(new Set(t).size, 3);
      });
    });

    test('블록 생성: 가중치가 높은 모양이 더 자주 나온다', function () {
      const rng = makeRng(11);
      const count = {};
      for (let i = 0; i < 40000; i++) {
        const s = Core.weightedPick(Core.SHAPES, rng);
        count[s.id] = (count[s.id] || 0) + 1;
      }
      assert.ok(count.h3 > count.h5 * 2, 'h3(8) > h5(3)');
      assert.ok(count.h5 > count['stair-1'] * 2, 'h5(3) > 계단(1)');
    });

    /* ---- 게임 오버 ---- */

    test('[검증 7] 하나라도 놓을 수 있으면 게임 오버가 아니다', function () {
      const b = fullBoard();
      b[0][0] = 0;
      assert.equal(Core.isGameOver(b, [S('sq3'), S('single'), S('h5')]), false);
      assert.equal(Core.isGameOver(b, [null, S('single'), null]), false);
    });

    test('[검증 7] 게임 도중 놓을 수 있는 블록이 남으면 over가 false로 유지된다', function () {
      const b = fullBoard();
      b[0][0] = 0;
      b[0][1] = 0;
      b[7][7] = 0;
      const g = gameWith(b, ['single', 'h2', 'sq3']);
      const r = Core.playMove(g, 0, 7, 7);
      assert.ok(r.ok);
      assert.equal(r.over, false);
      assert.equal(g.over, false);
    });

    test('[검증 8] 어떤 블록도 놓을 수 없으면 게임 오버다', function () {
      const b = fullBoard();
      b[0][0] = 0;
      assert.equal(Core.isGameOver(b, [S('sq3'), S('h2'), S('h5')]), true);
      assert.equal(Core.isGameOver(b, [null, S('v2'), null]), true);
    });

    test('[검증 8] 마지막 수 뒤 남은 블록이 들어갈 곳이 없으면 게임 오버가 되고 이후 수를 거부한다', function () {
      // 체커보드: 완성된 줄이 없고 1칸 블록만 들어간다.
      const b = Core.createBoard().map(function (row, r) {
        return row.map(function (_, c) { return (r + c) % 2 ? 1 : 0; });
      });
      const g = gameWith(b, ['single', 'sq3', 'h5']);
      const r = Core.playMove(g, 0, 0, 0);
      assert.ok(r.ok);
      assert.equal(r.over, true, '3×3과 5칸은 들어갈 곳이 없다');
      assert.equal(g.over, true);
      const after = Core.playMove(g, 1, 0, 0);
      assert.equal(after.ok, false);
      assert.equal(after.reason, 'game-over');
    });

    test('빈 트레이는 게임 오버로 판정하지 않는다', function () {
      assert.equal(Core.isGameOver(fullBoard(), [null, null, null]), false);
    });

    /* ---- 새 게임 ---- */

    test('[검증 11] 새 게임은 이전 게임 상태를 공유하지 않는다', function () {
      const a = Core.createGame(makeRng(2));
      a.board[0][0] = 3;
      a.score = 999;
      a.combo = 5;
      a.over = true;
      const b = Core.createGame(makeRng(2));
      assert.equal(filled(b.board), 0);
      assert.equal(b.score, 0);
      assert.equal(b.combo, 0);
      assert.equal(b.comboMisses, 0);
      assert.equal(b.over, false);
      assert.equal(b.tray.filter(Boolean).length, 3);
      assert.notEqual(a.board, b.board);
    });

    test('게임 시작: 빈 판과 놓을 수 있는 블록 3개를 준다', function () {
      const rng = makeRng(21);
      for (let i = 0; i < 500; i++) {
        const g = Core.createGame(rng);
        assert.ok(Core.isBoardEmpty(g.board));
        assert.equal(g.tray.length, 3);
        g.tray.forEach(function (s) { assert.ok(Core.canPlaceAnywhere(g.board, s)); });
      }
    });

    /* ---- 전체 판 시뮬레이션 ---- */

    test('시뮬레이션 500판: 처음부터 게임 오버까지 모든 불변 조건을 지킨다', function () {
      let finished = 0;
      let maxLines = 0;
      for (let seed = 1; seed <= 500; seed++) {
        const rng = makeRng(seed);
        const g = Core.createGame(rng);
        let expected = 0;
        let moves = 0;

        while (!g.over && moves < 3000) {
          const options = [];
          g.tray.forEach(function (s, slot) {
            if (!s) return;
            for (let r = 0; r < N; r++) {
              for (let c = 0; c < N; c++) {
                if (Core.canPlace(g.board, s, r, c)) options.push([slot, r, c]);
              }
            }
          });
          assert.ok(options.length > 0, 'over가 아닌데 둘 곳이 없음');

          const pick = options[Math.floor(rng() * options.length)];
          const before = filled(g.board);
          const r = Core.playMove(g, pick[0], pick[1], pick[2]);
          moves++;
          assert.ok(r.ok);
          expected += r.breakdown.total;
          assert.equal(g.score, expected, '점수 합계 일치');
          assert.equal(filled(g.board), before + r.placed.length - r.cleared.length, '칸 수 보존');

          const left = Core.findCompletedLines(g.board);
          assert.equal(left.rows.length + left.cols.length, 0, '완성 줄이 남으면 안 된다');
          assert.ok(g.tray.filter(Boolean).length >= 1, '트레이가 비면 안 된다');
          maxLines = Math.max(maxLines, r.linesCleared);
        }
        assert.ok(g.over, '판이 끝나야 한다');
        finished++;

        const noneFits = g.tray.filter(Boolean).every(function (s) {
          return !Core.canPlaceAnywhere(g.board, s);
        });
        assert.ok(noneFits, 'over일 때 놓을 수 있는 블록이 없어야 한다');
      }
      assert.equal(finished, 500);
      assert.ok(maxLines >= 1, '시뮬레이션 중 줄 제거 발생');
    });
  }

  const api = { defineTests: defineTests, makeRng: makeRng };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RulesSpec = api;
})(typeof window !== 'undefined' ? window : globalThis);
