import { test } from "node:test";
import assert from "node:assert/strict";

import { Signal } from "../signal.js";

test("Signal delivers emitted values to a subscriber in order", () => {
  const signal = new Signal<number>();
  const received: number[] = [];

  signal.subscribe((value) => received.push(value));
  signal.emit(1);
  signal.emit(2);

  assert.deepEqual(received, [1, 2]);
});

test("Signal delivers each emission to every subscriber", () => {
  const signal = new Signal<string>();
  const a: string[] = [];
  const b: string[] = [];

  signal.subscribe((value) => a.push(value));
  signal.subscribe((value) => b.push(value));
  signal.emit("x");

  assert.deepEqual(a, ["x"]);
  assert.deepEqual(b, ["x"]);
});

test("disposing a subscription stops further delivery to it", () => {
  const signal = new Signal<number>();
  const received: number[] = [];

  const subscription = signal.subscribe((value) => received.push(value));
  signal.emit(1);
  subscription.dispose();
  signal.emit(2);

  assert.deepEqual(received, [1]);
});

test("a handler that unsubscribes mid-emit does not disrupt other handlers", () => {
  const signal = new Signal<number>();
  const order: string[] = [];

  const first = signal.subscribe(() => {
    order.push("first");
    first.dispose();
  });
  signal.subscribe(() => order.push("second"));

  signal.emit(0); // both fire; first unsubscribes
  signal.emit(0); // only second fires

  assert.deepEqual(order, ["first", "second", "second"]);
});

test("hasSubscribers reflects live subscriptions", () => {
  const signal = new Signal<void>();
  assert.equal(signal.hasSubscribers, false);

  const subscription = signal.subscribe(() => {});
  assert.equal(signal.hasSubscribers, true);

  subscription.dispose();
  assert.equal(signal.hasSubscribers, false);
});
