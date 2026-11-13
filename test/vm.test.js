import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble, createMachine, step, run, disassemble, screen, OPCODES, STACK_TOP } from '../src/vm.js';
import { EXAMPLES } from '../src/examples.js';

const NL = String.fromCharCode(10);
const asm = (...lines) => assemble(lines.join(NL));
const exec = (...lines) => {
  const built = asm(...lines);
  assert.deepEqual(built.errors, []);
  return run(createMachine(built.bytes));
};

test('every opcode byte is unique', () => {
  const seen = new Set();
  for (const name of Object.keys(OPCODES)) {
    for (const code of Object.values(OPCODES[name])) {
      assert.ok(!seen.has(code), name + ' reuses an opcode');
      seen.add(code);
    }
  }
  assert.equal(seen.size, 41);
});

test('assembler encodes instructions and operands', () => {
  assert.deepEqual(asm('MOV A, 5').bytes, [0x11, 0, 5]);
  assert.deepEqual(asm('mov b, a').bytes, [0x10, 1, 0]);
  assert.deepEqual(asm('MOV C, [0x20]').bytes, [0x12, 2, 0x20]);
  assert.deepEqual(asm('MOV D, [A]').bytes, [0x13, 3, 0]);
  assert.deepEqual(asm('MOV [0xE0], A').bytes, [0x14, 0xE0, 0]);
  assert.deepEqual(asm('MOV [B], A').bytes, [0x15, 1, 0]);
  assert.deepEqual(asm('MOV [0xE0], 255').bytes, [0x16, 0xE0, 255]);
  assert.deepEqual(asm('MOV [ b ], 0b101').bytes, [0x17, 1, 5]);
  assert.deepEqual(asm('HLT').bytes, [0x00]);
  assert.deepEqual(asm('RET').bytes, [0x54]);
});

test('number formats, characters, strings and comments', () => {
  assert.deepEqual(asm('DB 10, 0x1F, 0b11, ' + "'A'").bytes, [10, 31, 3, 65]);
  assert.deepEqual(asm('DB "Hi; ok", 0 ; trailing comment').bytes, [72, 105, 59, 32, 111, 107, 0]);
  assert.deepEqual(asm('DB "a,b"').bytes, [97, 44, 98]);
  assert.deepEqual(asm("OUTC ';'").bytes, [0x63, 59]);
  assert.deepEqual(asm('; only a comment', '', '   ').bytes, []);
});

test('labels resolve forwards and backwards', () => {
  const built = asm('start: JMP end', 'NOP', 'end: JMP start', 'data: DB 1');
  assert.deepEqual(built.bytes, [0x40, 3, 0x01, 0x40, 0, 1]);
  assert.deepEqual(built.labels, { start: 0, end: 3, data: 5 });
  assert.deepEqual(built.lines, { 0: 1, 2: 2, 3: 3, 5: 4 });
  assert.deepEqual(asm('MOV A, [data]', 'HLT', 'data: DB 9').bytes, [0x12, 0, 4, 0x00, 9]);
});

test('assembler reports errors with line numbers', () => {
  const check = (lines, line, pattern) => {
    const built = asm(...lines);
    assert.equal(built.ok, false);
    assert.equal(built.errors[0].line, line);
    assert.match(built.errors[0].message, pattern);
  };
  check(['NOP', 'FLY A'], 2, /Unknown instruction/);
  check(['MOV 5, A'], 1, /does not accept/);
  check(['ADD A'], 1, /does not accept/);
  check(['MOV A, 256'], 1, /does not fit/);
  check(['JMP nowhere'], 1, /Cannot understand/);
  check(['x: NOP', 'x: NOP'], 2, /defined twice/);
  check(['a: NOP'], 1, /register/);
  check(['MOV A,'], 1, /Empty operand/);
  check(['DB'], 1, /at least one/);
  const big = [];
  for (let i = 0; i < 90; i++) big.push('MOV A, 1');
  check(big, 0, /270 bytes/);
});

test('arithmetic sets zero and carry', () => {
  let m = exec('MOV A, 200', 'ADD A, 100', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [44, false, true]);
  m = exec('MOV A, 1', 'ADD A, 255', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [0, true, true]);
  m = exec('MOV A, 5', 'MOV B, 7', 'SUB A, B', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [254, false, true]);
  m = exec('MOV A, 7', 'SUB A, 7', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [0, true, false]);
  m = exec('MOV A, 3', 'CMP A, 9', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [3, false, true]);
  m = exec('MOV A, 255', 'INC A', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [0, true, true]);
  m = exec('MOV A, 0', 'DEC A', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [255, false, true]);
});

test('logic and shifts', () => {
  assert.equal(exec('MOV A, 0b1100', 'AND A, 0b1010', 'HLT').reg[0], 0b1000);
  assert.equal(exec('MOV A, 0b1100', 'OR A, 0b1010', 'HLT').reg[0], 0b1110);
  assert.equal(exec('MOV A, 0b1100', 'XOR A, 0b1010', 'HLT').reg[0], 0b0110);
  assert.equal(exec('MOV A, 0x0F', 'NOT A', 'HLT').reg[0], 0xF0);
  let m = exec('MOV A, 0x81', 'SHL A', 'HLT');
  assert.deepEqual([m.reg[0], m.c], [0x02, true]);
  m = exec('MOV A, 0x01', 'SHR A', 'HLT');
  assert.deepEqual([m.reg[0], m.z, m.c], [0, true, true]);
});

test('memory access through addresses and pointers', () => {
  const m = exec('MOV [0x80], 42', 'MOV A, 0x80', 'MOV B, [A]', 'MOV C, [0x80]', 'INC A', 'MOV [A], C', 'HLT');
  assert.equal(m.reg[1], 42);
  assert.equal(m.reg[2], 42);
  assert.equal(m.mem[0x81], 42);
});

test('conditional jumps', () => {
  assert.equal(exec('MOV A, 3', 'top: DEC A', 'JNZ top', 'HLT').steps, 8);
  assert.equal(exec('MOV A, 1', 'CMP A, 1', 'JZ yes', 'OUT 0', 'yes: OUT 1', 'HLT').out, '1' + NL);
  assert.equal(exec('MOV A, 1', 'CMP A, 2', 'JC yes', 'OUT 0', 'yes: OUT 1', 'HLT').out, '1' + NL);
  assert.equal(exec('MOV A, 2', 'CMP A, 1', 'JNC yes', 'OUT 0', 'yes: OUT 1', 'HLT').out, '1' + NL);
});

test('stack, CALL and RET', () => {
  const m = exec('PUSH 7', 'MOV A, 9', 'PUSH A', 'POP B', 'POP C', 'CALL sub', 'HLT', 'sub: MOV D, 1', 'RET');
  assert.deepEqual(m.reg, [9, 9, 7, 1]);
  assert.equal(m.sp, STACK_TOP);
  assert.equal(m.error, '');
});

test('runtime faults halt the machine with a message', () => {
  assert.match(exec('POP A').error, /empty stack/);
  assert.match(exec('RET').error, /empty stack/);
  assert.match(run(createMachine([0xFF])).error, /Unknown opcode 0xFF at address 0x00/);
  assert.match(run(createMachine([0x30, 9])).error, /Bad register/);
});

test('run stops at the step budget and step is a no-op once halted', () => {
  const loop = createMachine(asm('top: JMP top').bytes);
  run(loop, 50);
  assert.equal(loop.steps, 50);
  assert.equal(loop.halted, false);
  run(loop, 25);
  assert.equal(loop.steps, 75);
  const done = exec('HLT');
  const steps = done.steps;
  step(done);
  assert.equal(done.steps, steps);
});

test('disassembler round-trips the assembler', () => {
  const source = ['MOV A, [0xE0]', 'MOV [B], 0x05', 'ADD C, D', 'JNZ 0x00', 'PUSH 0x09', 'RET', 'HLT'];
  const mem = createMachine(asm(...source).bytes).mem;
  let address = 0;
  for (const line of source) {
    const d = disassemble(mem, address);
    assert.equal(d.text, line);
    address += d.size;
  }
  assert.deepEqual(disassemble([0xFF], 0), { text: 'DB 0xFF', size: 1 });
});

test('example: hello world', () => {
  assert.equal(run(createMachine(assemble(EXAMPLES['Hello, world']).bytes)).out, 'Hello, world!');
});

test('example: fibonacci', () => {
  const m = run(createMachine(assemble(EXAMPLES['Fibonacci']).bytes));
  assert.equal(m.out, [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233].join(NL) + NL);
});

test('example: multiply', () => {
  const m = run(createMachine(assemble(EXAMPLES['Multiply (subroutine)']).bytes));
  assert.equal(m.out, '42' + NL);
  assert.equal(m.sp, STACK_TOP);
});

test('example: diagonal line', () => {
  const m = run(createMachine(assemble(EXAMPLES['Diagonal line']).bytes));
  assert.equal(m.halted, true);
  screen(m.mem).forEach((row, y) => row.forEach((pixel, x) => assert.equal(pixel, x === y ? 1 : 0)));
});

test('example: checkerboard', () => {
  const m = run(createMachine(assemble(EXAMPLES['Checkerboard']).bytes));
  assert.equal(m.halted, true);
  screen(m.mem).forEach((row, y) => row.forEach((pixel, x) => assert.equal(pixel, (x + y) % 2 === 0 ? 1 : 0)));
});

test('example: binary counter keeps running and mirrors A', () => {
  const m = run(createMachine(assemble(EXAMPLES['Binary counter (runs forever)']).bytes), 1 + 4 * 300);
  assert.equal(m.halted, false);
  assert.equal(m.mem[0xEF], (300 - 1) & 255);
  assert.equal(m.mem[0xF1], m.mem[0xEF]);
});

test('every example assembles cleanly and fits below the screen', () => {
  for (const name of Object.keys(EXAMPLES)) {
    const built = assemble(EXAMPLES[name]);
    assert.deepEqual(built.errors, [], name);
    assert.ok(built.bytes.length <= 0xE0, name);
  }
});
