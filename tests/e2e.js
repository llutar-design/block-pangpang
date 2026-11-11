#!/usr/bin/env node
/*
 * 실제 Chrome/Edge를 띄워 터치와 마우스 입력으로 게임을 조작하는 E2E 테스트.
 * 추가 설치 없이 Node 22 이상의 내장 WebSocket과 Chrome DevTools Protocol만 사용한다.
 *
 *   node tests/e2e.js [스크린샷 저장 폴더]
 *   (브라우저 경로를 지정하려면 환경변수 CHROME_PATH)
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const shotDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
const pageUrl = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const N = 8;

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome/Edge를 찾지 못했습니다. CHROME_PATH를 지정하세요.');
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        this.listeners.forEach((fn) => fn(msg));
      }
    });
  }

  send(method, params, sessionId) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params: params || {}, sessionId }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

let cdp;
let session;
const pageErrors = [];
const send = (method, params) => cdp.send(method, params, session);

async function evaluate(expr) {
  const res = await send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error('evaluate 실패: ' + (res.exceptionDetails.exception?.description || expr));
  }
  return res.result.value;
}

const snap = () => evaluate('BlockPang.debug.snapshot()');
const rectOf = (selector) => evaluate(`(() => {
  const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
})()`);
const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
const cellRect = (row, col) => rectOf(`#board .cell:nth-child(${row * N + col + 1})`);
const isVisible = (selector) => evaluate(`!document.querySelector(${JSON.stringify(selector)}).hidden`);

async function waitFor(fn, label, timeout = 4000) {
  const start = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - start > timeout) throw new Error('시간 초과: ' + label);
    await sleep(25);
  }
}

const waitIdle = () => waitFor(async () => (await snap()).phase === 'idle', 'idle 상태');

async function shot(name) {
  if (!shotDir) return;
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(shotDir, name + '.png'), Buffer.from(data, 'base64'));
}

async function setViewport(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: mobile ? 2 : 1, mobile: !!mobile,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: !!mobile, maxTouchPoints: 5 });
  await sleep(120);
}

/* ---- 입력 ---- */

const touch = {
  start: (x, y, id = 0) => send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] }),
  move: (x, y, id = 0) => send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] }),
  end: () => send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  cancel: () => send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
};

const mouse = {
  move: (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }),
  down: (x, y) => send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }),
  up: (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }),
};

async function tap(selector) {
  const c = center(await rectOf(selector));
  await touch.start(c.x, c.y);
  await touch.end();
  await sleep(60);
}

async function clickMouse(selector) {
  const c = center(await rectOf(selector));
  await mouse.down(c.x, c.y);
  await mouse.up(c.x, c.y);
  await sleep(60);
}

const nextFrame = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');

/**
 * 실제 고스트의 화면 위치를 읽어 손가락을 보정한 뒤, 목표 칸에 고스트를 맞춘다.
 * 입력이 고스트를 어디에 그리는지와 판정이 일치하는지를 그대로 확인하는 방식이다.
 */
async function moveGhostTo(input, startPoint, row, col) {
  const target = await cellRect(row, col);
  let x = target.left + 10;
  let y = Math.max(target.top + 60, 10);
  await input.move(x, y);
  await nextFrame();
  const ghost = await rectOf('#ghost');
  x += target.left - ghost.left;
  y += target.top - ghost.top;
  await input.move(x, y);
  await nextFrame();
  await input.move(x, y);
  await nextFrame();
  return { x, y };
}

async function dragTouch(slot, row, col) {
  const start = center(await rectOf(`.slot[data-slot="${slot}"]`));
  await touch.start(start.x, start.y);
  await nextFrame();
  await sleep(130);
  const end = await moveGhostTo(touch, start, row, col);
  await touch.end();
  await sleep(30);
  return end;
}

async function dragMouse(slot, row, col) {
  const start = center(await rectOf(`.slot[data-slot="${slot}"]`));
  await mouse.move(start.x, start.y);
  await mouse.down(start.x, start.y);
  await nextFrame();
  await sleep(130);
  const end = await moveGhostTo(mouse, start, row, col);
  await mouse.up(end.x, end.y);
  await sleep(30);
}

/* ---- 도우미 ---- */

function emptyBoard() {
  return Array.from({ length: N }, () => new Array(N).fill(0));
}

/** row 줄이 한 칸만 비어 있는 판. 줄을 지워도 판이 다 비지 않도록 다른 줄에 한 칸을 둔다. */
function nearlyFullRow(row) {
  const b = emptyBoard();
  for (let c = 0; c < N - 1; c++) b[row][c] = 1 + (c % 7);
  b[row === 7 ? 6 : 7][0] = 5;
  return b;
}

function checker() {
  return emptyBoard().map((r, i) => r.map((_, j) => ((i + j) % 2 ? 1 + (j % 7) : 0)));
}

const loadScenario = (s) => evaluate(`BlockPang.debug.loadScenario(${JSON.stringify(s)})`);
const count = (b) => b.flat().filter(Boolean).length;

let passed = 0;
let failed = 0;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertEq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg}: 기대값 ${JSON.stringify(b)}, 실제값 ${JSON.stringify(a)}`);
  }
};

async function test(name, fn) {
  const errorsBefore = pageErrors.length;
  try {
    await fn();
    assertEq(pageErrors.slice(errorsBefore), [], '페이지 오류');
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + err.message);
    try { await touch.end(); } catch (e) { /* 터치가 없으면 무시 */ }
  }
}

async function reloadPage() {
  await send('Page.navigate', { url: pageUrl });
  await waitFor(() => evaluate('document.readyState === "complete" && !!window.BlockPang && !!BlockPang.debug')
    .catch(() => false), '페이지 로드');
}

async function overlaps(selectors) {
  const rects = [];
  for (const s of selectors) rects.push({ s, r: await rectOf(s) });
  const hits = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i].r;
      const b = rects[j].r;
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) {
        hits.push(rects[i].s + ' × ' + rects[j].s);
      }
    }
  }
  return hits;
}

const PLAY_PARTS = ['.brand', '#btn-pause', '#btn-restart', '#game .sound-toggle', '.scores', '#board-wrap',
  '.slot[data-slot="0"]', '.slot[data-slot="1"]', '.slot[data-slot="2"]'];

async function assertLayoutFits(width, height) {
  assertEq(await overlaps(PLAY_PARTS), [], '겹치는 요소');
  for (const s of PLAY_PARTS) {
    const r = await rectOf(s);
    assert(r.left >= -0.5 && r.right <= width + 0.5 && r.top >= -0.5 && r.bottom <= height + 0.5,
      `${s} 화면 밖: ${JSON.stringify(r)}`);
  }
  const scroll = await evaluate('[document.documentElement.scrollWidth, document.documentElement.scrollHeight]');
  assert(scroll[0] <= width && scroll[1] <= height, '페이지 스크롤 발생: ' + scroll);
}

/* ---- 테스트 본문 ---- */

async function runTests() {
  await test('첫 화면: 게임 이름, 시작하기, 최고 점수, 게임 방법을 보여 준다', async () => {
    await setViewport(360, 640, true);
    await reloadPage();
    assert(await isVisible('#screen-title'), '첫 화면');
    const text = await evaluate('document.querySelector("#screen-title").innerText');
    for (const word of ['시작하기', '최고 점수', '게임 방법']) assert(text.includes(word), word + ' 없음');
    assertEq(await evaluate('document.title'), '블록 팡팡!', '문서 제목');
    await sleep(250);
    await shot('01-title-360');
  });

  await test('튜토리얼: 게임 방법 버튼으로 3단계를 넘겨 보고 첫 화면으로 돌아온다', async () => {
    await tap('#btn-howto');
    assert(await isVisible('#screen-tutorial'), '튜토리얼 열림');
    await sleep(300);
    await shot('02-tutorial-360');
    await tap('#btn-tutorial-next');
    await tap('#btn-tutorial-next');
    assertEq(await evaluate('document.querySelector("#btn-tutorial-next").textContent'), '알겠어요!', '마지막 단계');
    await tap('#btn-tutorial-next');
    assert(!(await isVisible('#screen-tutorial')), '튜토리얼 닫힘');
    assert(await isVisible('#screen-title'), '첫 화면 유지');
  });

  await test('처음 플레이: 시작하면 튜토리얼 뒤에 게임이 시작되고 안내가 첫 배치 후 사라진다', async () => {
    await tap('#btn-start');
    assert(await isVisible('#screen-tutorial'), '첫 시작 튜토리얼');
    await tap('#btn-tutorial-skip');
    const s = await snap();
    assertEq(s.phase, 'idle', '게임 시작');
    assertEq(count(s.board), 0, '빈 판');
    assertEq(s.tray.filter(Boolean).length, 3, '블록 3개');
    assert(await isVisible('#hint'), '첫 판 안내');
    await sleep(450);
    await shot('03-start-360');
    await loadScenarioKeepHint();
  });

  async function loadScenarioKeepHint() {
    const before = await snap();
    await dragTouch(0, 0, 0);
    const after = await snap();
    assert(count(after.board) > count(before.board), '첫 배치');
    assert(!(await isVisible('#hint')), '안내 사라짐');
  }

  await test('360×640 화면: 버튼과 블록이 겹치지 않고 화면 안에 들어온다', async () => {
    await assertLayoutFits(360, 640);
  });

  await test('[검증 9] 터치 드래그: 고스트가 손가락 위에 뜨고 스크롤 없이 정확한 칸에 놓인다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['sq2', 'h3', 'v3'] });
    const start = center(await rectOf('.slot[data-slot="0"]'));
    await touch.start(start.x, start.y);
    await nextFrame();
    await sleep(130);
    const target = await cellRect(3, 2);
    await touch.move(target.left + 20, target.top + 150);
    await nextFrame();
    const ghost = await rectOf('#ghost');
    assert(ghost.bottom < target.top + 150 - 20, `고스트가 손가락 위에 있어야 함: ${ghost.bottom}`);
    const end = await moveGhostTo(touch, start, 3, 2);
    assertEq((await snap()).phase, 'dragging', '드래그 상태');

    const preview = await evaluate(`[...document.querySelectorAll('#board .pv-ok')].map(e => [...e.parentNode.children].indexOf(e)).sort((a,b)=>a-b)`);
    assertEq(preview, [26, 27, 34, 35], '미리보기 칸');
    await shot('04-drag-preview-360');

    assertEq(await evaluate('[window.scrollX, window.scrollY, document.body.scrollTop]'), [0, 0, 0], '스크롤');
    await touch.end();
    await sleep(30);
    assert(end.y > 0, '좌표');
    const s = await snap();
    assertEq([s.board[3][2] > 0, s.board[3][3] > 0, s.board[4][2] > 0, s.board[4][3] > 0], [true, true, true, true], '배치 칸');
    assertEq(count(s.board), 4, '배치 칸 수');
    assertEq(s.score, 4, '점수');
    assertEq(s.tray, [null, 'h3', 'v3'], '트레이');
  });

  await test('[검증 2] 겹치는 곳에 놓으면 붉게 표시되고 원위치로 돌아간다', async () => {
    const board = emptyBoard();
    board[4][4] = 3;
    await loadScenario({ board, tray: ['sq2', 'h3', 'v3'] });
    const start = center(await rectOf('.slot[data-slot="0"]'));
    await touch.start(start.x, start.y);
    await nextFrame();
    await sleep(130);
    await moveGhostTo(touch, start, 3, 3);
    assertEq(await evaluate(`document.querySelectorAll('#board .pv-bad').length`), 4, '붉은 미리보기');
    await shot('05-drag-invalid-360');
    await touch.end();
    await sleep(30);
    assertEq((await snap()).phase, 'returning', '복귀 애니메이션');
    await waitIdle();
    const s = await snap();
    assertEq(count(s.board), 1, '판 변화 없음');
    assertEq(s.score, 0, '점수 변화 없음');
    assertEq(s.tray, ['sq2', 'h3', 'v3'], '블록 유지');
    assert(!(await isVisible('#ghost')), '고스트 숨김');
    assertEq(await evaluate(`document.querySelectorAll('#board .pv-ok,#board .pv-bad,#board .pv-line').length`), 0, '미리보기 정리');
  });

  await test('[검증 3] 판 밖으로 드래그해 놓거나 일부만 걸치면 놓이지 않는다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['h5', 'h3', 'v3'] });
    const start = center(await rectOf('.slot[data-slot="0"]'));
    await touch.start(start.x, start.y);
    await nextFrame();
    await sleep(130);
    // 5칸 블록의 왼쪽 끝을 마지막 열에 맞추면 4칸이 판 밖으로 나간다.
    await moveGhostTo(touch, start, 0, 7);
    const bad = await evaluate(`document.querySelectorAll('#board .pv-bad').length`);
    assertEq(bad, 1, '판 안에 걸친 1칸만 붉게 표시');
    await touch.end();
    await waitIdle();
    assertEq(count((await snap()).board), 0, '판 변화 없음');

    await touch.start(start.x, start.y);
    await nextFrame();
    await touch.move(2, 2);
    await nextFrame();
    await touch.end();
    await waitIdle();
    const s = await snap();
    assertEq(count(s.board), 0, '완전히 밖');
    assertEq(s.tray[0], 'h5', '블록 유지');
  });

  await test('드래그 취소(touchcancel): 블록이 원위치로 돌아간다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['sq2', 'h3', 'v3'] });
    const start = center(await rectOf('.slot[data-slot="1"]'));
    await touch.start(start.x, start.y);
    await nextFrame();
    await moveGhostTo(touch, start, 2, 2);
    await touch.cancel();
    await waitIdle();
    const s = await snap();
    assertEq(count(s.board), 0, '판 변화 없음');
    assertEq(s.tray, ['sq2', 'h3', 'v3'], '블록 유지');
    assertEq(await evaluate(`document.querySelectorAll('.slot.dragging').length`), 0, '슬롯 복구');
  });

  await test('[검증 6, 연속 드래그] 18번 연속 드래그해도 좌표가 어긋나지 않고 3개씩 다시 채워진다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['single', 'h2', 'v2'] });
    let expectedScore = 0;
    const positions = [];
    for (let r = 0; r < N; r += 2) for (let c = 0; c < N; c += 2) positions.push([r, c]);

    for (let i = 0; i < 18; i++) {
      await waitIdle();
      if (i % 3 === 0) {
        await loadScenario({ board: emptyBoard(), tray: ['single', 'h2', 'v2'] });
        expectedScore = 0;
      }
      const before = await snap();
      const slot = before.tray.findIndex(Boolean);
      const id = before.tray[slot];
      const [row, col] = positions[(i * 5) % positions.length];
      await dragTouch(slot, row, col);
      const after = await snap();
      const cells = id === 'single' ? [[0, 0]] : id === 'h2' ? [[0, 0], [0, 1]] : [[0, 0], [1, 0]];
      for (const [dr, dc] of cells) {
        assert(after.board[row + dr][col + dc] > 0, `${i}번째 드래그 ${id} @${row},${col}`);
      }
      expectedScore += cells.length;
      assertEq(after.score, expectedScore, '점수');
      assertEq(count(after.board), expectedScore, '칸 수');
      if (i % 3 === 2) {
        assertEq(after.tray.filter(Boolean).length, 3, '다시 3개');
        assertEq(new Set(after.tray).size, 3, '서로 다른 모양');
      } else {
        assertEq(after.tray.filter(Boolean).length, 2 - (i % 3), '남은 블록 수');
      }
    }
  });

  await test('[검증 4] 화면에서 가로줄이 지워지고 점수와 +점수 효과가 나타난다', async () => {
    await loadScenario({ board: nearlyFullRow(5), tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 5, 7);
    let s = await snap();
    assertEq(s.phase, 'clearing', '제거 애니메이션 상태');
    assertEq(s.score, 11, '점수');
    assertEq(await evaluate(`document.querySelector('.float').textContent`), '+11', '점수 효과');
    assert((await evaluate(`document.querySelectorAll('#board .tile.clearing').length`)) === 8, '제거 효과 8칸');
    await sleep(120);
    await shot('06-line-clear-360');
    await waitIdle();
    s = await snap();
    assertEq(count(s.board), 1, '줄 제거');
    assertEq(await evaluate(`document.querySelectorAll('#board .tile:not([data-c="0"])').length`), 1, '화면도 같은 상태');
    assertEq(await evaluate(`document.querySelector('#score').textContent`), '11', '점수 표시');
  });

  await test('[검증 5] 화면에서 가로세로 동시 제거 시 점수가 한 번만 더해진다', async () => {
    const b = emptyBoard();
    for (let i = 0; i < N; i++) {
      if (i !== 4) b[2][i] = 1;
      if (i !== 2) b[i][4] = 4;
    }
    b[7][0] = 5;
    await loadScenario({ board: b, tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 2, 4);
    const animationEnd = await evaluate(`Math.max(...[...document.querySelectorAll('.tile.clearing')].flatMap(t => t.getAnimations().map(a => a.effect.getComputedTiming().endTime)))`);
    assert(animationEnd <= 420, `제거 효과가 입력 잠금 시간 안에 끝나야 함: ${animationEnd}ms`);
    await sleep(150);
    await shot('07-cross-clear-360');
    await waitIdle();
    const s = await snap();
    assertEq(s.score, 1 + 20 + 10, '점수 31');
    assertEq(count(s.board), 1, '남은 칸');
    assertEq(await evaluate(`document.querySelector('#score').textContent`), '31', '표시');
  });

  await test('콤보: 연속 제거 시 COMBO 배너와 배수가 표시된다', async () => {
    const b = nearlyFullRow(0);
    for (let c = 0; c < N - 1; c++) b[1][c] = 2;
    await loadScenario({ board: b, tray: ['single', 'h3', 'v3'], combo: 1 });
    await dragTouch(0, 0, 7);
    const banner = await evaluate(`[...document.querySelectorAll('.banner')].map(e => e.textContent)`);
    assert(banner.includes('COMBO ×2'), '콤보 배너: ' + banner);
    assertEq(await evaluate(`document.querySelector('#combo-value').textContent`), '×2', '콤보 표시');
    assertEq((await snap()).score, 21, '콤보 점수');
    await sleep(350);
    await shot('08-combo-360');
    await waitIdle();
  });

  await test('[검증 12] 제거 애니메이션 중 빠른 연속 터치를 무시하고 오류가 없다', async () => {
    await loadScenario({ board: nearlyFullRow(3), tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 3, 7);
    assertEq((await snap()).phase, 'clearing', '제거 중');

    const slotC = center(await rectOf('.slot[data-slot="1"]'));
    const boardC = center(await rectOf('#board'));
    // 제거 효과는 420ms이므로 끝나기 전인 250ms 동안만 입력을 퍼붓는다.
    const startedAt = Date.now();
    let rounds = 0;
    while (Date.now() - startedAt < 250) {
      await touch.start(slotC.x, slotC.y);
      await touch.move(boardC.x, boardC.y);
      await touch.end();
      rounds++;
    }
    assert(rounds >= 2, '입력 횟수 부족: ' + rounds);
    const during = await snap();
    assertEq(during.tray, [null, 'h3', 'v3'], '트레이 그대로');
    assertEq(during.dragging, false, '드래그 시작 안 됨');
    await waitIdle();
    const s = await snap();
    assertEq(s.score, 11, '점수 중복 없음');
    assertEq(s.tray, [null, 'h3', 'v3'], '트레이 유지');
    assert(!(await isVisible('#ghost')), '고스트 없음');
  });

  await test('[검증 12] 두 손가락으로 동시에 잡아도 하나만 드래그되고, 놓자마자 재터치해도 안전하다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['single', 'h3', 'v3'] });
    const a = center(await rectOf('.slot[data-slot="0"]'));
    const b = center(await rectOf('.slot[data-slot="1"]'));
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }, { x: b.x, y: b.y, id: 2 }] });
    await nextFrame();
    assertEq(await evaluate(`document.querySelectorAll('.slot.dragging').length`), 1, '드래그 슬롯 수');
    await touch.end();
    await waitIdle();

    for (let i = 0; i < 8; i++) {
      await touch.start(a.x, a.y);
      await touch.end();
    }
    await waitIdle();
    const s = await snap();
    assertEq(s.tray, ['single', 'h3', 'v3'], '블록 유지');
    assertEq(count(s.board), 0, '판 변화 없음');
  });

  await test('탭만 하거나 살짝 흔들면 블록이 판에 놓이지 않는다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['single', 'sq2', 'h2'] });
    for (const slot of [0, 1, 2]) {
      const c = center(await rectOf(`.slot[data-slot="${slot}"]`));
      await touch.start(c.x, c.y);
      await touch.move(c.x + 4, c.y - 4);
      await nextFrame();
      assertEq(await evaluate(`document.querySelectorAll('#board .pv-ok,#board .pv-bad').length`), 0, '미리보기 없음');
      await touch.end();
      await waitIdle();
    }
    const s = await snap();
    assertEq(s.tray, ['single', 'sq2', 'h2'], '블록 유지');
    assertEq(count(s.board), 0, '판 변화 없음');
  });

  await test('일시정지: 입력을 막고 계속하기로 돌아온다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['single', 'h3', 'v3'] });
    await tap('#btn-pause');
    assert(await isVisible('#screen-pause'), '일시정지 화면');
    assertEq((await snap()).phase, 'paused', '상태');
    await sleep(250);
    await shot('09-pause-360');
    await tap('#btn-resume');
    assert(!(await isVisible('#screen-pause')), '닫힘');
    await dragTouch(0, 1, 1);
    assertEq((await snap()).score, 1, '재개 후 플레이');
  });

  await test('제거 애니메이션 중 일시정지를 누르면 끝난 뒤 일시정지가 열린다', async () => {
    await loadScenario({ board: nearlyFullRow(3), tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 3, 7);
    await tap('#btn-pause');
    await waitFor(() => isVisible('#screen-pause'), '일시정지 열림');
    assertEq((await snap()).phase, 'paused', '상태');
    assertEq(count((await snap()).board), 1, '제거 완료');
    await tap('#btn-resume');
  });

  await test('[검증 11] 다시 시작: 애니메이션 도중이어도 이전 상태가 남지 않는다', async () => {
    await loadScenario({ board: nearlyFullRow(3), tray: ['single', 'h3', 'v3'], score: 50, combo: 3 });
    await dragTouch(0, 3, 7);
    await tap('#btn-restart');
    await waitFor(() => isVisible('#screen-confirm'), '확인 창');
    await tap('#btn-confirm-yes');
    const s = await snap();
    assertEq(s.score, 0, '점수');
    assertEq(s.combo, 0, '콤보');
    assertEq(count(s.board), 0, '판');
    assertEq(s.tray.filter(Boolean).length, 3, '블록');
    assertEq(s.phase, 'idle', '상태');
    assertEq(await evaluate(`document.querySelectorAll('#board .tile:not([data-c="0"]), #board .clearing, .float, .banner').length`), 0, '잔여 화면');
    assertEq(await evaluate(`document.querySelector('#score').textContent`), '0', '점수 표시');
    await sleep(700);
    assertEq((await snap()).phase, 'idle', '이전 타이머가 상태를 바꾸지 않음');
  });

  await test('[검증 7] 놓을 수 있는 블록이 남으면 게임 오버가 나지 않는다', async () => {
    await loadScenario({ board: checker(), tray: ['single', 'sq3', 'h5'], score: 5 });
    const empty = await snap();
    let spot = null;
    for (let r = 0; r < N && !spot; r++) {
      for (let c = 0; c < N && !spot; c++) if (!empty.board[r][c]) spot = [r, c];
    }
    const b = checker();
    b[spot[0]][spot[1]] = 0;
    await loadScenario({ board: b, tray: ['sq3', 'single', 'h5'], score: 5 });
    assertEq((await snap()).over, false, '시작 시 over 아님');
    assert((await evaluate(`document.querySelectorAll('.slot.is-stuck').length`)) === 2, '못 놓는 블록 표시');
    await sleep(350);
    await shot('10-stuck-360');
  });

  await test('[검증 8, 7장] 게임 오버 화면이 뜨고 다시 도전하면 새 게임이 정상 시작된다', async () => {
    await evaluate(`localStorage.setItem('blockpangpang.best', '0')`);
    await reloadPage();
    await tap('#btn-start');
    await loadScenario({ board: checker(), tray: ['single', 'sq3', 'h5'], score: 200 });
    await dragTouch(0, 0, 0);
    let s = await snap();
    assertEq(s.over, true, 'over');
    assertEq(s.phase, 'over', '상태');
    assert(!(await isVisible('#screen-over')), '잠깐 뒤에 표시');
    await sleep(200);
    await shot('11-dead-board-360');
    await waitFor(() => isVisible('#screen-over'), '게임 오버 화면');
    assertEq(await evaluate(`document.querySelector('#over-score').textContent`), '201', '최종 점수');
    assert(await isVisible('#over-record'), '최고 기록 갱신 표시');
    await sleep(300);
    await shot('12-gameover-360');

    await tap('#btn-retry');
    s = await snap();
    assertEq(s.phase, 'idle', '새 게임 상태');
    assertEq(s.over, false, 'over 해제');
    assertEq(s.score, 0, '점수 초기화');
    assertEq(count(s.board), 0, '판 초기화');
    assertEq(s.tray.filter(Boolean).length, 3, '블록 3개');
    assertEq(await evaluate(`document.querySelector('#board').classList.contains('is-dead')`), false, '회색 효과 해제');
    await dragTouch(s.tray.findIndex(Boolean), 0, 0);
    assert((await snap()).score > 0, '새 게임에서 플레이 가능');
  });

  await test('기록을 못 깨면 게임 오버 화면에 신기록을 표시하지 않는다', async () => {
    await loadScenario({ board: checker(), tray: ['single', 'sq3', 'h5'], score: 10 });
    await dragTouch(0, 0, 0);
    await waitFor(() => isVisible('#screen-over'), '게임 오버 화면');
    assert(!(await isVisible('#over-record')), '신기록 숨김');
    assert(await isVisible('#over-norecord'), '일반 문구');
    assertEq(await evaluate(`document.querySelector('#over-best').textContent`), '201', '최고 점수');
    await tap('#btn-retry');
  });

  await test('[검증 10] 새로고침 후 최고 점수와 사운드 설정이 유지된다', async () => {
    const before = (await snap()).best;
    assertEq(before, 201, '저장 전');
    await tap('#game .sound-toggle');
    assertEq(await evaluate(`localStorage.getItem('blockpangpang.sound')`), 'off', '사운드 저장');
    await reloadPage();
    assertEq((await snap()).best, 201, '메모리');
    assertEq(await evaluate(`document.querySelector('#title-best').textContent`), '201', '첫 화면 표시');
    assertEq(await evaluate(`document.querySelector('.sound-toggle').classList.contains('is-off')`), true, '사운드 꺼짐 유지');
    await tap('.title-sound');
    assertEq(await evaluate(`localStorage.getItem('blockpangpang.sound')`), 'on', '사운드 켜기 저장');
  });

  await test('효과음과 진동: 터치만으로 오디오가 켜지고 배치, 제거, 콤보, 게임 오버 소리가 재생된다', async () => {
    // 이 테스트는 자동재생 허용 플래그 없이 실행되므로, 터치로 오디오가 깨어나는 경로까지 검증한다.
    await tap('#btn-start');
    const oscillators = () => evaluate('window.__osc || 0');
    const vibrations = () => evaluate('(window.__vib || []).length');

    await loadScenario({ board: emptyBoard(), tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 2, 2);
    const afterPlace = await oscillators();
    assert(afterPlace >= 1, '배치 효과음');
    assert((await vibrations()) >= 1, '배치 진동');

    await loadScenario({ board: nearlyFullRow(0), tray: ['single', 'h3', 'v3'], combo: 2 });
    await dragTouch(0, 0, 7);
    await waitIdle();
    const afterClear = await oscillators();
    assert(afterClear - afterPlace >= 1 + 3 + 4, `제거+콤보 효과음: ${afterClear - afterPlace}`);

    await loadScenario({ board: checker(), tray: ['single', 'sq3', 'h5'], score: 100000 });
    await dragTouch(0, 0, 0);
    await waitFor(() => isVisible('#screen-over'), '게임 오버 화면');
    const afterOver = await oscillators();
    assert(afterOver - afterClear >= 1 + 4 + 4, `게임 오버+신기록 효과음: ${afterOver - afterClear}`);
    await tap('#btn-retry');

    await tap('#game .sound-toggle');
    const muted = await oscillators();
    const vibMuted = await vibrations();
    await loadScenario({ board: emptyBoard(), tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 2, 2);
    assertEq(await oscillators(), muted, '사운드 OFF면 소리 없음');
    assertEq(await vibrations(), vibMuted, '사운드 OFF면 진동 없음');
    await tap('#game .sound-toggle');
    await evaluate(`localStorage.setItem('blockpangpang.best', '201')`);
    await reloadPage();
    await tap('#btn-start');
  });

  await test('한 판 전체: 조작한 상태 없이 첫 수부터 게임 오버까지 터치로 끝까지 플레이한다', async () => {
    await tap('#btn-restart');
    if (await isVisible('#screen-confirm')) await tap('#btn-confirm-yes');
    let s = await snap();
    assertEq(count(s.board), 0, '빈 판에서 시작');
    assertEq(s.score, 0, '0점에서 시작');

    let moves = 0;
    let sawClear = false;
    while (moves < 200) {
      s = await snap();
      if (s.over) break;
      const move = await evaluate(`(() => {
        const { Core } = BlockPang;
        const g = BlockPang.debug.snapshot();
        const options = [];
        g.tray.forEach((id, slot) => {
          if (!id) return;
          const shape = Core.getShape(id);
          for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            if (Core.canPlace(g.board, shape, r, c)) options.push({ slot, row: r, col: c });
          }
        });
        return options[Math.floor(Math.random() * options.length)] || null;
      })()`);
      assert(move, '게임 오버가 아닌데 둘 곳이 없음');

      const scoreBefore = s.score;
      await dragTouch(move.slot, move.row, move.col);
      const after = await snap();
      assert(after.score > scoreBefore, `${moves + 1}번째 수가 놓이지 않음: ${JSON.stringify(move)}`);
      assertEq(await evaluate(`document.querySelector('#score').textContent.replace(/,/g, '')`), String(after.score), '점수 표시');
      if (after.phase === 'clearing') sawClear = true;
      moves++;
      if (after.over) break;
      await waitIdle();
    }

    s = await snap();
    assert(s.over, `게임이 끝나지 않음 (${moves}수)`);
    assert(moves >= 5, '수가 너무 적음: ' + moves);
    await waitFor(() => isVisible('#screen-over'), '게임 오버 화면');
    assertEq(await evaluate(`document.querySelector('#over-score').textContent.replace(/,/g, '')`), String(s.score), '최종 점수');
    const stuck = await evaluate(`(() => {
      const g = BlockPang.debug.snapshot();
      return g.tray.filter(Boolean).every((id) => !BlockPang.Core.canPlaceAnywhere(g.board, BlockPang.Core.getShape(id)));
    })()`);
    assert(stuck, '놓을 수 있는 블록이 남았는데 게임 오버');
    console.log(`        (${moves}수, ${s.score}점, 줄 제거 ${sawClear ? '있음' : '없음'})`);
    await tap('#btn-retry');
    assertEq((await snap()).phase, 'idle', '새 게임');
  });

  await test('나머지 버튼: 일시정지의 다시 시작·처음으로, 게임 오버의 처음으로, 튜토리얼 이전', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['single', 'h3', 'v3'] });
    await dragTouch(0, 1, 1);
    assertEq((await snap()).score, 1, '플레이');
    await tap('#btn-pause');
    await tap('#btn-pause-restart');
    let s = await snap();
    assertEq([s.phase, s.score, count(s.board)], ['idle', 0, 0], '일시정지의 다시 시작');
    assert(!(await isVisible('#screen-pause')), '일시정지 닫힘');

    await tap('#btn-pause');
    await tap('#btn-pause-title');
    assert(await isVisible('#screen-title'), '일시정지에서 첫 화면으로');
    assertEq((await snap()).phase, 'menu', '메뉴 상태');

    await tap('#btn-howto');
    await tap('#btn-tutorial-next');
    assertEq(await evaluate(`document.querySelector('#tutorial-title').textContent`), '줄을 채우면 팡!', '2단계');
    await tap('#btn-tutorial-prev');
    assertEq(await evaluate(`document.querySelector('#tutorial-title').textContent`), '끌어다 놓기', '이전 단계');
    await tap('#btn-tutorial-skip');

    await tap('#btn-start');
    await loadScenario({ board: checker(), tray: ['single', 'sq3', 'h5'] });
    await dragTouch(0, 0, 0);
    await waitFor(() => isVisible('#screen-over'), '게임 오버 화면');
    await tap('#btn-over-title');
    assert(await isVisible('#screen-title'), '게임 오버에서 첫 화면으로');
    assert(!(await isVisible('#screen-over')), '게임 오버 닫힘');
    assertEq(await evaluate(`document.querySelector('#board').classList.contains('is-dead')`), false, '회색 효과 해제');

    await tap('#btn-start');
    s = await snap();
    assertEq([s.phase, s.score, s.over, count(s.board)], ['idle', 0, false, 0], '새 게임');
  });

  await test('PC 마우스 드래그: 정확한 칸에 놓이고 고스트가 커서 중심에 있다', async () => {
    await setViewport(1280, 800, false);
    await assertLayoutFits(1280, 800);
    await loadScenario({ board: emptyBoard(), tray: ['t-down', 'h3', 'v3'] });
    await sleep(350);
    await shot('13-desktop-1280');
    await dragMouse(0, 4, 3);
    const s = await snap();
    assertEq(count(s.board), 4, '칸 수');
    for (const [r, c] of [[4, 3], [4, 4], [4, 5], [5, 4]]) assert(s.board[r][c] > 0, `${r},${c}`);
    assertEq(s.tray, [null, 'h3', 'v3'], '트레이');
  });

  await test('PC 마우스: 우클릭은 드래그를 시작하지 않고, 판 밖에 놓으면 복귀한다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['sq2', 'h3', 'v3'] });
    const c = center(await rectOf('.slot[data-slot="0"]'));
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: c.x, y: c.y, button: 'right', buttons: 2, clickCount: 1 });
    assertEq((await snap()).phase, 'idle', '우클릭 무시');
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: c.x, y: c.y, button: 'right', buttons: 0, clickCount: 1 });

    await mouse.move(c.x, c.y);
    await mouse.down(c.x, c.y);
    await mouse.move(20, 20);
    await nextFrame();
    await mouse.up(20, 20);
    await waitIdle();
    assertEq(count((await snap()).board), 0, '판 변화 없음');
    await clickMouse('#btn-pause');
    assertEq((await snap()).phase, 'paused', '마우스로 버튼 동작');
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    assertEq((await snap()).phase, 'idle', 'Esc로 재개');
  });

  await test('드래그 중 창 크기가 바뀌어도 좌표를 다시 맞춘다', async () => {
    await loadScenario({ board: emptyBoard(), tray: ['sq2', 'h3', 'v3'] });
    const c = center(await rectOf('.slot[data-slot="0"]'));
    await mouse.move(c.x, c.y);
    await mouse.down(c.x, c.y);
    await nextFrame();
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    await sleep(200);
    const target = await cellRect(2, 2);
    await mouse.move(target.left + 3, target.top + 3);
    await nextFrame();
    const ghost = await rectOf('#ghost');
    const x = target.left + 3 + (target.left - ghost.left);
    const y = target.top + 3 + (target.top - ghost.top);
    await mouse.move(x, y);
    await nextFrame();
    await sleep(150);
    await mouse.up(x, y);
    await sleep(30);
    const s = await snap();
    assertEq([s.board[2][2] > 0, s.board[3][3] > 0, count(s.board)], [true, true, 4], '리사이즈 후 배치');
  });

  for (const [w, h, mobile] of [[320, 568, true], [360, 780, true], [412, 915, true], [768, 1024, true], [740, 360, true]]) {
    await test(`반응형 ${w}×${h}: 겹침과 넘침이 없다`, async () => {
      await setViewport(w, h, mobile);
      await loadScenario({ board: nearlyFullRow(4), tray: ['sq3', 'h5', 'v5'] });
      await sleep(350);
      await assertLayoutFits(w, h);
      await shot(`14-responsive-${w}x${h}`);
    });
  }

  await test('가로 모드에서도 터치 드래그가 정확하다', async () => {
    await setViewport(740, 360, true);
    await loadScenario({ board: emptyBoard(), tray: ['sq2', 'h3', 'v3'] });
    await dragTouch(1, 2, 3);
    const s = await snap();
    assertEq([s.board[2][3] > 0, s.board[2][4] > 0, s.board[2][5] > 0, count(s.board)], [true, true, true, 3], '배치');
  });

  await test('외부 네트워크 요청을 하지 않는다', async () => {
    const urls = await evaluate(`performance.getEntriesByType('resource').map(e => e.name)`);
    const external = urls.filter((u) => !u.startsWith('file:') && !u.startsWith('data:'));
    assertEq(external, [], '외부 요청');
  });

  await test('브라우저 테스트 페이지(tests/index.html)도 전부 통과한다', async () => {
    await send('Page.navigate', { url: pageUrl.replace(/index\.html$/, 'tests/index.html') });
    await waitFor(() => evaluate(`document.querySelector('#summary') && document.querySelector('#summary').textContent !== '실행 중'`).catch(() => false), '규칙 테스트 완료', 30000);
    const summary = await evaluate(`document.querySelector('#summary').textContent`);
    assert(/실패 0$/.test(summary), summary);
  });
}

async function main() {
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blockpang-e2e-'));
  const browser = spawn(findBrowser(), [
    '--headless=new',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${userDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      const timer = setTimeout(() => reject(new Error('브라우저 시작 시간 초과')), 20000);
      browser.stderr.on('data', (d) => {
        buf += d;
        const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) { clearTimeout(timer); resolve(m[1]); }
      });
      browser.on('exit', () => reject(new Error('브라우저가 종료되었습니다')));
    });

    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    cdp = new Cdp(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));

    cdp.listeners.push((msg) => {
      if (msg.method === 'Runtime.exceptionThrown') {
        pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        pageErrors.push(msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
      } else if (msg.method === 'Runtime.consoleAPICalled' && ['warning', 'error'].includes(msg.params.type)) {
        pageErrors.push(msg.params.args.map((a) => a.value || a.description).join(' '));
      }
    });

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');

    // 실제로 재생을 시도한 소리와 진동을 세기 위한 계측. 게임 코드는 그대로 실행된다.
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const original = BaseAudioContext.prototype.createOscillator;
        BaseAudioContext.prototype.createOscillator = function () {
          if (this.state === 'running') window.__osc = (window.__osc || 0) + 1;
          return original.call(this);
        };
        navigator.vibrate = (p) => { (window.__vib = window.__vib || []).push(p); return true; };
      })();`,
    });

    await runTests();
    console.log('\n통과 ' + passed + ' / 실패 ' + failed);
    process.exitCode = failed > 0 ? 1 : 0;
    await cdp.send('Browser.close').catch(() => {});
  } finally {
    browser.kill();
    await sleep(400);
    try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* Windows 파일 잠금 */ }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
