// octet - page wiring. The machine itself lives in vm.js.
import { assemble, createMachine, step, disassemble, screen, DISPLAY_START } from './vm.js';
import { EXAMPLES } from './examples.js';

// Clock settings: [instructions per tick, frames between ticks].
const SPEEDS = [[1, 30], [1, 10], [1, 4], [1, 1], [4, 1], [16, 1], [64, 1], [256, 1], [2048, 1]];
const OUTPUT_LIMIT = 4000;

const $ = (id) => document.getElementById(id);
const hex = (value) => value.toString(16).toUpperCase().padStart(2, '0');
const source = $('source');

let built = assemble('');
let machine = createMachine([]);
let running = false;
let stale = false;
let frame = 0;

function grid(parent, className) {
  const nodes = [];
  for (let i = 0; i < 256; i++) {
    const node = document.createElement('span');
    node.className = className;
    parent.append(node);
    nodes.push(node);
  }
  return nodes;
}

const pixels = grid($('screen'), 'pixel');
const cells = grid($('memory'), 'cell');

function statusText() {
  if (!built.ok) return 'Fix the errors below, then assemble again.';
  if (stale) return 'Source changed. Press Run or Assemble to load it.';
  if (machine.error) return 'Crashed: ' + machine.error;
  if (machine.halted) return 'Halted after ' + machine.steps + ' instructions.';
  if (running) return 'Running. ' + machine.steps + ' instructions so far.';
  if (machine.steps) return 'Paused after ' + machine.steps + ' instructions.';
  return 'Ready. ' + built.bytes.length + ' of 256 bytes used.';
}

function render() {
  const rows = screen(machine.mem);
  pixels.forEach((pixel, i) => {
    pixel.className = rows[i >> 4][i & 15] ? 'pixel on' : 'pixel';
  });
  cells.forEach((cell, i) => {
    cell.textContent = hex(machine.mem[i]);
    let name = 'cell';
    if (i >= DISPLAY_START) name += ' video';
    if (i === machine.sp) name += ' sp';
    if (i === machine.pc && !machine.halted) name += ' pc';
    cell.className = name;
  });
  machine.reg.forEach((value, i) => {
    $('reg-' + i).textContent = hex(value);
  });
  $('reg-pc').textContent = hex(machine.pc);
  $('reg-sp').textContent = hex(machine.sp);
  $('flag-z').textContent = machine.z ? '1' : '0';
  $('flag-c').textContent = machine.c ? '1' : '0';
  if (machine.halted) {
    $('next').textContent = '-';
  } else {
    const line = built.lines[machine.pc];
    $('next').textContent = hex(machine.pc) + ':  ' + disassemble(machine.mem, machine.pc).text +
      (line ? '   (line ' + line + ')' : '');
  }
  $('output').textContent = machine.out.slice(-OUTPUT_LIMIT);
  $('status').textContent = statusText();
  $('status').className = !built.ok || machine.error ? 'status bad' : 'status';
  $('run').textContent = running ? 'Pause' : 'Run';
}

// Assemble the editor contents and put a fresh machine on the bench.
function load() {
  built = assemble(source.value);
  const list = $('errors');
  list.replaceChildren();
  built.errors.forEach((error) => {
    const item = document.createElement('li');
    item.textContent = (error.line ? 'Line ' + error.line + ': ' : '') + error.message;
    list.append(item);
  });
  machine = createMachine(built.ok ? built.bytes : []);
  if (!built.ok) machine.halted = true;
  running = false;
  stale = false;
  render();
  return built.ok;
}

function tick() {
  if (!running) return;
  const speed = SPEEDS[Number($('speed').value)];
  frame += 1;
  if (frame % speed[1] === 0) {
    for (let i = 0; i < speed[0] && !machine.halted; i++) step(machine);
  }
  if (machine.halted) running = false;
  render();
  if (running) requestAnimationFrame(tick);
}

$('run').addEventListener('click', () => {
  if (running) {
    running = false;
    render();
    return;
  }
  if ((stale || machine.halted) && !load()) return;
  running = true;
  render();
  requestAnimationFrame(tick);
});

$('step').addEventListener('click', () => {
  running = false;
  if (stale || machine.halted) load();
  else step(machine);
  render();
});

$('reset').addEventListener('click', load);

source.addEventListener('input', () => {
  stale = true;
  running = false;
  render();
});

const picker = $('example');
Object.keys(EXAMPLES).forEach((name) => {
  const option = document.createElement('option');
  option.textContent = name;
  picker.append(option);
});
picker.addEventListener('change', () => {
  source.value = EXAMPLES[picker.value];
  load();
});

source.value = EXAMPLES[picker.value];
load();
