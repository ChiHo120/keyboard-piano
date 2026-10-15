const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function source(name) {
  const match = html.match(new RegExp('(?:async )?function ' + name + '[(][^]*?^}', 'm'));
  assert.ok(match, 'Missing function: ' + name);
  return match[0];
}

function loopContext(enabled = true) {
  const frames = [];
  const context = vm.createContext({
    selectedSong: { title: 'Test', notes: [['C4', .1, 0], ['D4', .1, 0], ['E4', .1, 0]] },
    loopStart: { value: '2' }, loopEnd: { value: '3' }, loopEnabled: { checked: enabled },
    songIndex: 2, songPhaseTimer: 0, songPhase: 'hold', songPhaseStarted: 0,
    performance: { now: () => 0 }, cancelAnimationFrame() {},
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    document: { querySelectorAll: () => [] }, updateSongPanel() {},
    songTimingLabel: {}, songTimingValue: {}, songTimingFill: { style: {} }, toast: {}
  });
  vm.runInContext(source('loopRange') + '\n' + source('beginRest'), context);
  return { context, frames };
}

test('loop wraps after final rest; disabling it completes the song', () => {
  for (const enabled of [true, false]) {
    const { context, frames } = loopContext(enabled);
    context.beginRest(2);
    assert.equal(context.songPhase, 'rest');
    frames.shift()(16);
    assert.equal(context.songIndex, enabled ? 1 : 3);
    assert.equal(context.songPhase, 'hold');
  }
});

test('loop range normalizes empty, reversed and out-of-range values', () => {
  const { context } = loopContext();
  for (const [start, end, expected] of [['', '', [0, 2]], ['-2', '99', [0, 2]], ['3', '1', [2, 2]], ['2.7', '3', [1, 2]]]) {
    context.loopStart.value = start;
    context.loopEnd.value = end;
    const range = context.loopRange();
    assert.deepEqual([range.start, range.end], expected);
  }
});

test('cancelled playback cannot release a restarted note or a manually held note', async () => {
  const waits = [];
  const holds = new Map();
  const context = vm.createContext({
    demoToken: 0, songDemoRunning: false, selectedSong: null,
    songPanel: { hidden: true }, demoTempo: { value: '100' }, holds,
    demoSong: {}, localSongPlayer: { pause() {}, currentTime: 0, playbackRate: 1 },
    document: { getElementById: () => ({ disabled: false }) },
    cancelPractice() {}, updateSongPanel() {},
    sleep: () => new Promise(resolve => waits.push(resolve)),
    press(note, id) {
      if (!holds.has(note)) holds.set(note, new Set());
      holds.get(note).add(id);
    },
    release(note, id) { holds.get(note)?.delete(id); }
  });
  vm.runInContext(source('stopDemo') + '\n' + source('playSeq'), context);
  context.press('C4', 'key:KeyA');
  const oldRun = context.playSeq([['C4', 1, 0]]);
  context.stopDemo();
  const newRun = context.playSeq([['C4', 1, 0]]);
  waits.shift()();
  await oldRun;
  assert.equal(context.songDemoRunning, true);
  assert.deepEqual([...holds.get('C4')], ['key:KeyA', 'demo:3']);
  context.stopDemo();
  assert.deepEqual([...holds.get('C4')], ['key:KeyA']);
  waits.shift()();
  await newRun;
  assert.equal(context.songDemoRunning, false);
});
