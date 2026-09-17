import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { KeyboardEvent } from "react";
import { submitOnEnter } from "../src/submit-on-enter.ts";

function check(
  overrides: Omit<
    Partial<KeyboardEvent<HTMLTextAreaElement>>,
    "nativeEvent"
  > & {
    nativeEvent?: Partial<globalThis.KeyboardEvent>;
  },
  expected: { submits: number; consumed: boolean },
) {
  let submits = 0,
    prevented = false,
    stopped = false;
  const event = {
    key: "Enter",
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    repeat: false,
    nativeEvent: {},
    preventDefault: () => {
      prevented = true;
    },
    stopPropagation: () => {
      stopped = true;
    },
    ...overrides,
  } as KeyboardEvent<HTMLTextAreaElement>;
  submitOnEnter(event, () => {
    submits++;
  });
  assert.deepEqual({ submits, consumed: prevented && stopped }, expected);
  assert.equal(prevented, stopped);
}

for (const modifiers of [{}, { metaKey: true }, { ctrlKey: true }]) {
  test(`Enter submits and consumes the event: ${JSON.stringify(modifiers)}`, () => {
    check(modifiers, { submits: 1, consumed: true });
  });
  test(`Shift+Enter stays multiline: ${JSON.stringify(modifiers)}`, () => {
    check({ ...modifiers, shiftKey: true }, { submits: 0, consumed: false });
  });
}

test("IME confirmation (including Safari keyCode 229) never submits", () => {
  for (const nativeEvent of [{ isComposing: true }, { keyCode: 229 }]) {
    check({ nativeEvent }, { submits: 0, consumed: false });
  }
});
test("held Enter is consumed without a duplicate submission or newline", () => {
  check({ repeat: true }, { submits: 0, consumed: true });
});
test("other keys and Alt+Enter keep native behavior", () => {
  check({ key: "a" }, { submits: 0, consumed: false });
  check({ altKey: true }, { submits: 0, consumed: false });
});
