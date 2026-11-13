// octet - assembler and virtual machine for a computer with 256 bytes of memory.
// Pure functions only: no DOM, no dependencies. Runs in the browser and in Node.

export const MEM_SIZE = 256;
export const DISPLAY_START = 0xE0; // 32 bytes: a 16 x 16 one-bit screen
export const STACK_TOP = 0xDF;     // the stack grows down from here
export const REGISTERS = ['A', 'B', 'C', 'D'];

const NL = String.fromCharCode(10);

// Operand kinds: R register, I immediate or label, M [address], P [register].
export const OPCODES = {
  HLT: { '': 0x00 },
  NOP: { '': 0x01 },
  MOV: { 'R,R': 0x10, 'R,I': 0x11, 'R,M': 0x12, 'R,P': 0x13, 'M,R': 0x14, 'P,R': 0x15, 'M,I': 0x16, 'P,I': 0x17 },
  ADD: { 'R,R': 0x20, 'R,I': 0x21 },
  SUB: { 'R,R': 0x22, 'R,I': 0x23 },
  AND: { 'R,R': 0x24, 'R,I': 0x25 },
  OR: { 'R,R': 0x26, 'R,I': 0x27 },
  XOR: { 'R,R': 0x28, 'R,I': 0x29 },
  CMP: { 'R,R': 0x2A, 'R,I': 0x2B },
  INC: { R: 0x30 },
  DEC: { R: 0x31 },
  SHL: { R: 0x32 },
  SHR: { R: 0x33 },
  NOT: { R: 0x34 },
  JMP: { I: 0x40 },
  JZ: { I: 0x41 },
  JNZ: { I: 0x42 },
  JC: { I: 0x43 },
  JNC: { I: 0x44 },
  PUSH: { R: 0x50, I: 0x51 },
  POP: { R: 0x52 },
  CALL: { I: 0x53 },
  RET: { '': 0x54 },
  OUT: { R: 0x60, I: 0x61 },
  OUTC: { R: 0x62, I: 0x63 },
};

// opcode byte -> { name, kinds }
const DECODE = {};
for (const name of Object.keys(OPCODES)) {
  for (const pattern of Object.keys(OPCODES[name])) {
    DECODE[OPCODES[name][pattern]] = { name, kinds: pattern ? pattern.split(',') : [] };
  }
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function hex(value) {
  return '0x' + value.toString(16).toUpperCase().padStart(2, '0');
}

function stripComment(line) {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ';') {
      return line.slice(0, i);
    }
  }
  return line;
}

function splitOperands(text) {
  const out = [];
  let current = '';
  let quote = '';
  for (const ch of text) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ',') {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() || out.length) out.push(current.trim());
  return out;
}

function parseNumber(token) {
  if (/^0x[0-9a-f]+$/i.test(token)) return parseInt(token.slice(2), 16);
  if (/^0b[01]+$/i.test(token)) return parseInt(token.slice(2), 2);
  if (/^[0-9]+$/.test(token)) return parseInt(token, 10);
  if (token.length === 3 && token[0] === "'" && token[2] === "'") return token.charCodeAt(1);
  return null;
}

function parseOperand(token) {
  const reg = REGISTERS.indexOf(token.toUpperCase());
  if (reg >= 0) return { kind: 'R', value: reg };
  if (token[0] === '[' && token[token.length - 1] === ']') {
    const inner = token.slice(1, -1).trim();
    const innerReg = REGISTERS.indexOf(inner.toUpperCase());
    if (innerReg >= 0) return { kind: 'P', value: innerReg };
    return { kind: 'M', expr: inner };
  }
  return { kind: 'I', expr: token };
}

// Turn source text into machine code.
// Returns { ok, bytes, labels, lines, errors } where lines maps address -> source line.
export function assemble(source) {
  const errors = [];
  const labels = {};
  const items = [];
  let address = 0;

  String(source).split(NL).forEach((rawLine, index) => {
    const line = index + 1;
    let text = stripComment(rawLine).trim();
    const colon = text.indexOf(':');
    if (colon > 0 && IDENT.test(text.slice(0, colon).trim())) {
      const label = text.slice(0, colon).trim();
      if (REGISTERS.includes(label.toUpperCase())) {
        errors.push({ line, message: 'A label cannot be named after register ' + label.toUpperCase() });
      } else if (label in labels) {
        errors.push({ line, message: 'Label "' + label + '" is defined twice' });
      } else {
        labels[label] = address;
      }
      text = text.slice(colon + 1).trim();
    }
    if (!text) return;

    const space = text.search(/\s/);
    const mnemonic = (space < 0 ? text : text.slice(0, space)).toUpperCase();
    const operands = splitOperands(space < 0 ? '' : text.slice(space + 1));

    if (mnemonic === 'DB') {
      if (!operands.length) {
        errors.push({ line, message: 'DB needs at least one value' });
        return;
      }
      const values = [];
      for (const token of operands) {
        if (token.length >= 2 && token[0] === '"' && token[token.length - 1] === '"') {
          for (const ch of token.slice(1, -1)) values.push({ value: ch.charCodeAt(0) });
        } else {
          values.push({ expr: token });
        }
      }
      items.push({ line, address, values });
      address += values.length;
      return;
    }

    const variants = OPCODES[mnemonic];
    if (!variants) {
      errors.push({ line, message: 'Unknown instruction "' + mnemonic + '"' });
      return;
    }
    if (operands.some((token) => token === '')) {
      errors.push({ line, message: 'Empty operand' });
      return;
    }
    const parsed = operands.map(parseOperand);
    const opcode = variants[parsed.map((p) => p.kind).join(',')];
    if (opcode === undefined) {
      errors.push({ line, message: mnemonic + ' does not accept these operands' });
      return;
    }
    items.push({ line, address, values: [{ value: opcode }].concat(parsed) });
    address += 1 + parsed.length;
  });

  if (address > MEM_SIZE) {
    errors.push({ line: 0, message: 'Program needs ' + address + ' bytes but memory holds only ' + MEM_SIZE });
  }

  const bytes = [];
  const lines = {};
  for (const item of items) {
    lines[item.address] = item.line;
    for (const entry of item.values) {
      let value = entry.value;
      if (value === undefined) {
        value = parseNumber(entry.expr);
        if (value === null && IDENT.test(entry.expr) && entry.expr in labels) value = labels[entry.expr];
        if (value === null) {
          errors.push({ line: item.line, message: 'Cannot understand "' + entry.expr + '"' });
          value = 0;
        } else if (value > 255) {
          errors.push({ line: item.line, message: entry.expr + ' does not fit in one byte (0 to 255)' });
          value = 0;
        }
      }
      bytes.push(value);
    }
  }

  errors.sort((a, b) => a.line - b.line);
  return { ok: errors.length === 0, bytes, labels, lines, errors };
}

export function createMachine(bytes) {
  const mem = new Uint8Array(MEM_SIZE);
  mem.set(Array.from(bytes || []).slice(0, MEM_SIZE));
  return {
    mem,
    reg: [0, 0, 0, 0],
    pc: 0,
    sp: STACK_TOP,
    z: false,
    c: false,
    halted: false,
    error: '',
    out: '',
    steps: 0,
  };
}

function fail(m, message) {
  m.halted = true;
  m.error = message;
  return m;
}

// Execute exactly one instruction. Mutates and returns the machine.
export function step(m) {
  if (m.halted) return m;
  const at = m.pc;
  const next = () => {
    const value = m.mem[m.pc];
    m.pc = (m.pc + 1) & 255;
    return value;
  };
  const info = DECODE[next()];
  if (!info) return fail(m, 'Unknown opcode ' + hex(m.mem[at]) + ' at address ' + hex(at));
  const kinds = info.kinds;
  const args = kinds.map(next);
  for (let i = 0; i < kinds.length; i++) {
    if ((kinds[i] === 'R' || kinds[i] === 'P') && args[i] > 3) {
      return fail(m, 'Bad register number ' + args[i] + ' at address ' + hex(at));
    }
  }
  const read = (i) => {
    if (kinds[i] === 'R') return m.reg[args[i]];
    if (kinds[i] === 'M') return m.mem[args[i]];
    if (kinds[i] === 'P') return m.mem[m.reg[args[i]]];
    return args[i];
  };
  const setReg = (value, carry) => {
    m.reg[args[0]] = value & 255;
    m.z = (value & 255) === 0;
    m.c = carry;
  };
  const push = (value) => {
    m.mem[m.sp] = value;
    m.sp = (m.sp - 1) & 255;
  };
  const pop = () => {
    m.sp = (m.sp + 1) & 255;
    return m.mem[m.sp];
  };
  const a = kinds[0] === 'R' ? m.reg[args[0]] : 0;

  switch (info.name) {
    case 'HLT': m.halted = true; break;
    case 'NOP': break;
    case 'MOV': {
      const value = read(1);
      if (kinds[0] === 'R') m.reg[args[0]] = value;
      else if (kinds[0] === 'M') m.mem[args[0]] = value;
      else m.mem[m.reg[args[0]]] = value;
      break;
    }
    case 'ADD': setReg(a + read(1), a + read(1) > 255); break;
    case 'SUB': setReg(a - read(1), a < read(1)); break;
    case 'CMP': m.z = a === read(1); m.c = a < read(1); break;
    case 'AND': setReg(a & read(1), false); break;
    case 'OR': setReg(a | read(1), false); break;
    case 'XOR': setReg(a ^ read(1), false); break;
    case 'INC': setReg(a + 1, a === 255); break;
    case 'DEC': setReg(a - 1, a === 0); break;
    case 'SHL': setReg(a << 1, (a & 0x80) !== 0); break;
    case 'SHR': setReg(a >> 1, (a & 1) !== 0); break;
    case 'NOT': setReg(~a, false); break;
    case 'JMP': m.pc = args[0]; break;
    case 'JZ': if (m.z) m.pc = args[0]; break;
    case 'JNZ': if (!m.z) m.pc = args[0]; break;
    case 'JC': if (m.c) m.pc = args[0]; break;
    case 'JNC': if (!m.c) m.pc = args[0]; break;
    case 'PUSH': push(read(0)); break;
    case 'CALL': push(m.pc); m.pc = args[0]; break;
    case 'POP':
      if (m.sp === STACK_TOP) return fail(m, 'POP with an empty stack at address ' + hex(at));
      m.reg[args[0]] = pop();
      break;
    case 'RET':
      if (m.sp === STACK_TOP) return fail(m, 'RET with an empty stack at address ' + hex(at));
      m.pc = pop();
      break;
    case 'OUT': m.out += String(read(0)) + NL; break;
    case 'OUTC': m.out += String.fromCharCode(read(0)); break;
    default: return fail(m, 'Unhandled instruction ' + info.name);
  }
  m.steps += 1;
  return m;
}

// Run until the machine halts or the step budget is spent.
export function run(m, maxSteps) {
  const limit = m.steps + (maxSteps === undefined ? 100000 : maxSteps);
  while (!m.halted && m.steps < limit) step(m);
  return m;
}

// Decode the instruction at an address into readable text.
export function disassemble(mem, address) {
  const info = DECODE[mem[address & 255]];
  if (!info) return { text: 'DB ' + hex(mem[address & 255]), size: 1 };
  const parts = info.kinds.map((kind, i) => {
    const value = mem[(address + 1 + i) & 255];
    const reg = REGISTERS[value] || '?';
    if (kind === 'R') return reg;
    if (kind === 'P') return '[' + reg + ']';
    if (kind === 'M') return '[' + hex(value) + ']';
    return hex(value);
  });
  return { text: info.name + (parts.length ? ' ' + parts.join(', ') : ''), size: 1 + info.kinds.length };
}

// Read the 16 x 16 screen out of memory as rows of 0 and 1.
export function screen(mem) {
  const rows = [];
  for (let y = 0; y < 16; y++) {
    const row = [];
    for (let x = 0; x < 16; x++) {
      const byte = mem[DISPLAY_START + y * 2 + (x >> 3)];
      row.push((byte >> (7 - (x & 7))) & 1);
    }
    rows.push(row);
  }
  return rows;
}
