import assert from "node:assert/strict";
import test from "node:test";
import { DerivSocket, type PurchaseRef } from "./socket.ts";
import type { DerivMsg } from "./types.ts";

test("closing the socket keeps the original purchase reference", () => {
  const sock = new DerivSocket();
  sock.notePurchase("buy-1", "CR1", 7);
  sock.notePurchase("buy-2", "VRTC9", 8);
  sock.close();
  sock.close();
  assert.deepEqual(sock.purchaseRefs(), [
    { attemptId: "buy-1", accountId: "CR1", reqId: 7 },
    { attemptId: "buy-2", accountId: "VRTC9", reqId: 8 },
  ] satisfies PurchaseRef[]);
  sock.releasePurchase("buy-1");
  assert.deepEqual(sock.purchaseRefs().map((row) => row.attemptId), ["buy-2"]);
});

test("a buy that never leaves is not remembered, and a late frame after close still confirms", async () => {
  const previous = globalThis.WebSocket;
  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    static last: FakeSocket | null = null;
    readyState = FakeSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(_url: string) {
      FakeSocket.last = this;
      queueMicrotask(() => {
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
      });
    }
    send(_data: string) {}
    close() {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.();
    }
  }
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  try {
    const idle = new DerivSocket();
    await assert.rejects(
      idle.request({ buy: "proposal", price: 1 }, 1000, () => {}, { attemptId: "buy-x", accountId: "CR1" }),
      /Socket is not open/,
    );
    assert.deepEqual(idle.purchaseRefs(), []);

    const sock = new DerivSocket();
    await sock.connect("ws://unit.test/trade");
    const socket = FakeSocket.last;
    assert.ok(socket);
    const seen: { msg: DerivMsg | null } = { msg: null };
    const flight = sock.request(
      { buy: "proposal", price: 1 },
      5000,
      (msg) => {
        seen.msg = msg;
      },
      { attemptId: "buy-9", accountId: "CR1" },
    );
    const closed = assert.rejects(flight, /Socket closed/);
    assert.deepEqual(
      sock.purchaseRefs().map((row) => row.attemptId),
      ["buy-9"],
    );
    sock.close();
    socket.onmessage?.({
      data: JSON.stringify({ msg_type: "buy", req_id: 1, buy: { contract_id: 55, transaction_id: 9 } }),
    });
    await closed;
    assert.equal(seen.msg?.buy?.contract_id, 55);
    assert.deepEqual(
      sock.purchaseRefs().map((row) => ({ attemptId: row.attemptId, accountId: row.accountId })),
      [{ attemptId: "buy-9", accountId: "CR1" }],
    );
  } finally {
    globalThis.WebSocket = previous;
  }
});
