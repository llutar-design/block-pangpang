#!/usr/bin/env node
/* 규칙 테스트 실행: node tests/run-tests.js */
'use strict';

const assert = require('assert');
const path = require('path');
const Core = require(path.join(__dirname, '..', 'game.js'));
const { defineTests } = require('./rules.spec.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('  FAIL  ' + name);
    console.log('        ' + err.message);
  }
}

defineTests(Core, test, assert.strict);
console.log('\n통과 ' + passed + ' / 실패 ' + failed);
process.exitCode = failed > 0 ? 1 : 0;
