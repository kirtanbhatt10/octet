# octet

[![tests](https://github.com/kirtanbhatt10/octet/actions/workflows/test.yml/badge.svg)](https://github.com/kirtanbhatt10/octet/actions/workflows/test.yml)

A complete computer in 256 bytes. Write assembly, press Run, and watch every byte of memory change.

**Try it:** https://kirtanbhatt10.github.io/octet/

octet is a made-up 8-bit machine small enough to hold in your head: four registers, 41 opcodes, a stack, and a 16 x 16 screen that is just the last 32 bytes of memory. The assembler, the CPU and the debugger all run in the browser with no build step and no dependencies.

## Why

Real architectures are hard to learn on because there is too much of them. Here the whole machine fits on one screen. You can see the program counter walk through your code, see the stack pointer move on a CALL, and see a pixel light up because you wrote a byte to address 0xE0. Nothing is hidden.

## A first program

            MOV A, text      ; A points at the first letter
    loop:   MOV B, [A]       ; load the byte A points at
            CMP B, 0
            JZ done          ; a zero byte ends the string
            OUTC B
            INC A
            JMP loop
    done:   HLT
    text:   DB "Hello, world!", 0

Pick an example from the menu, press **Step** to execute one instruction at a time, or **Run** and use the clock slider to go from one instruction every half second up to about 120,000 per second.

## The machine

| Part | Details |
| --- | --- |
| Memory | 256 bytes, addresses 0x00 to 0xFF. Code and data share it. |
| Registers | A, B, C, D, one byte each |
| Program counter | Starts at 0x00 |
| Stack | Starts at 0xDF and grows downward |
| Flags | Zero and Carry |
| Screen | 0xE0 to 0xFF. Two bytes per row, one bit per pixel, most significant bit on the left |
| Output | A text console written by OUT and OUTC |

## Instruction set

| Instruction | What it does |
| --- | --- |
| MOV dst, src | Copy a value. Either side may be a register, [address] or [register]. The source may also be a number. Memory-to-memory moves are not allowed. |
| ADD, SUB, AND, OR, XOR | First operand is a register, second is a register or a number. The result is stored in the first and sets the flags. |
| CMP a, b | Compare without storing. Zero is set when equal, Carry when a is less than b. |
| INC, DEC, SHL, SHR, NOT | One register. Shifts move the bit that falls off into Carry. |
| JMP, JZ, JNZ, JC, JNC | Jump always, or when Zero / Carry is set / clear. |
| PUSH, POP, CALL, RET | Stack operations and subroutines. |
| OUT, OUTC | Print a value as a decimal number followed by a newline, or as a single character. |
| HLT, NOP | Stop the machine; do nothing. |
| DB | Place raw bytes or a "string" in memory. |

Numbers can be written as 42, 0x2A, 0b101010 or '*'. Labels end with a colon. A semicolon starts a comment. Mnemonics and register names are case-insensitive.

Every instruction is one opcode byte followed by one byte per operand, so MOV A, 5 assembles to the three bytes 11 00 05. The full opcode table is the OPCODES object at the top of src/vm.js.

## Things it will tell you

The assembler reports errors with line numbers: unknown instructions, operand combinations an instruction does not accept, values that do not fit in a byte, undefined or duplicate labels, and programs larger than memory.

The CPU halts with a message instead of misbehaving silently when it meets an unknown opcode, a register number above 3, or a POP or RET on an empty stack.

## Limits

- 256 bytes is all there is. A program longer than 224 bytes runs into the screen.
- No interrupts, no keyboard input, no multiply or divide. Build them: the Multiply example shows how.
- Arithmetic is unsigned and wraps at 255.
- The stack is not protected. Push enough and it will overwrite your code, exactly as it would on real hardware.

## Run it locally

    git clone https://github.com/kirtanbhatt10/octet.git
    cd octet
    python3 -m http.server 8080

Then open http://localhost:8080. A local server is needed because browsers do not load ES modules from a file path.

## Tests

The assembler and CPU are one dependency-free module, tested with the Node built-in test runner (Node 20 or newer):

    node --test

20 tests cover instruction encoding, every addressing mode, flag behaviour, the stack, runtime faults, an assemble-then-disassemble round trip, and every bundled example (the screen examples are checked pixel by pixel).

## Use the machine from code

    import { assemble, createMachine, run } from './src/vm.js';

    const program = assemble('MOV A, 6\nADD A, 36\nOUT A\nHLT');
    const machine = run(createMachine(program.bytes));
    machine.out;      // '42\n'
    machine.reg[0];   // 42
    machine.steps;    // 4

Also exported: step (one instruction), disassemble (bytes back to text) and screen (the display as 16 rows of bits).

## Layout

    index.html           page and instruction reference
    style.css            styles
    src/vm.js            assembler, CPU, disassembler
    src/examples.js      bundled programs
    src/app.js           editor, clock and memory view
    test/vm.test.js      test suite

## Licence

MIT. See [LICENSE](LICENSE).
