import type { DerivMsg } from "./types.ts";

type Waiter = {
  resolve: (msg: DerivMsg) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type PurchaseRef = {
  attemptId: string;
  accountId: string;
  reqId: number;
};

export class DerivSocket {
  private ws: WebSocket | null = null;
  private req = 1;
  private pending = new Map<number, Waiter>();
  private streams = new Map<number, (msg: DerivMsg) => void>();
  private bySub = new Map<string, (msg: DerivMsg) => void>();
  private late = new Map<number, (msg: DerivMsg) => void>();
  /** Survives close() and reconnect. The req id dies with the socket; the attempt id does not. */
  private purchases = new Map<string, PurchaseRef>();
  private opened: Promise<void> | null = null;
  private rejectOpen: ((err: Error) => void) | null = null;
  private closed: Promise<void> = Promise.resolve();
  private noteClose: () => void = () => {};

  connect(url: string): Promise<void> {
    this.close();
    this.opened = new Promise((resolve, reject) => {
      this.rejectOpen = reject;
      this.closed = new Promise((resolveClose) => {
        this.noteClose = resolveClose;
      });
      const ws = new WebSocket(url);
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error("Market socket timed out."));
        ws.close();
      }, 12000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.rejectOpen = null;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error("Market socket failed."));
      };
      ws.onmessage = (event) => {
        this.onMessage(String(event.data));
      };
      ws.onclose = () => {
        this.rejectAll("Socket closed.");
        this.noteClose();
      };
    });
    return this.opened;
  }

  close() {
    const ws = this.ws;
    const rejectOpen = this.rejectOpen;
    this.ws = null;
    this.opened = null;
    this.rejectOpen = null;
    this.noteClose();
    this.noteClose = () => {};
    rejectOpen?.(new Error("Socket closed."));
    if (ws) {
      ws.onopen = null;
      ws.onerror = null;
      ws.onclose = null;
      if (ws.readyState < 2) ws.close();
    }
    this.rejectAll("Socket closed.");
  }

  /** Remember a buy that may still be accepted after this socket dies. */
  notePurchase(attemptId: string, accountId: string, reqId: number) {
    if (!attemptId || !accountId) return;
    this.purchases.set(attemptId, { attemptId, accountId, reqId });
  }

  purchaseRefs(): PurchaseRef[] {
    return [...this.purchases.values()];
  }

  releasePurchase(attemptId: string) {
    const ref = this.purchases.get(attemptId);
    if (ref) this.late.delete(ref.reqId);
    this.purchases.delete(attemptId);
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  untilClosed(): Promise<void> {
    return this.closed;
  }

  request(
    payload: Record<string, unknown>,
    timeoutMs = 12000,
    onLate?: (msg: DerivMsg) => void,
    purchase?: { attemptId: string; accountId: string },
  ): Promise<DerivMsg> {
    const reqId = this.req++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        if (onLate) this.late.set(reqId, onLate);
        reject(new Error("Deriv request timed out."));
      }, timeoutMs);
      this.pending.set(reqId, { resolve, reject, timer });
      const sent = this.send({ ...payload, req_id: reqId });
      if (!sent) {
        clearTimeout(timer);
        return;
      }
      if (purchase) {
        this.notePurchase(purchase.attemptId, purchase.accountId, reqId);
        if (onLate) this.late.set(reqId, onLate);
      }
    });
  }

  /**
   * Subscribe and resolve on the first payload. Later messages go to onUpdate.
   * Call the returned forget() when finished — buys require a fresh streaming id.
   */
  stream(
    payload: Record<string, unknown>,
    onUpdate: (msg: DerivMsg) => void,
    timeoutMs = 12000,
  ): Promise<DerivMsg> {
    const reqId = this.req++;
    this.streams.set(reqId, onUpdate);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId);
        this.streams.delete(reqId);
        reject(new Error("Deriv stream timed out."));
      }, timeoutMs);
      this.pending.set(reqId, {
        resolve: (msg) => {
          clearTimeout(timer);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timer);
          this.streams.delete(reqId);
          reject(err);
        },
        timer,
      });
      this.send({ ...payload, req_id: reqId });
    });
  }

  forget(id: string | undefined) {
    if (!id) return;
    this.send({ forget: id });
  }

  private send(payload: Record<string, unknown>): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      const reqId = payload.req_id;
      if (typeof reqId === "number") {
        this.pending.get(reqId)?.reject(new Error("Socket is not open."));
        this.pending.delete(reqId);
        this.streams.delete(reqId);
      }
      return false;
    }
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  private onMessage(raw: string) {
    let msg: DerivMsg;
    try {
      msg = JSON.parse(raw) as DerivMsg;
    } catch {
      return;
    }
    const reqId = msg.req_id ?? (msg.echo_req?.req_id as number | undefined);
    if (msg.error && typeof reqId === "number") {
      const waiter = this.pending.get(reqId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pending.delete(reqId);
        this.streams.delete(reqId);
        waiter.reject(new Error(msg.error.message || "Deriv rejected the request."));
        return;
      }
      this.deliverLate(reqId, msg);
      return;
    }
    if (typeof reqId === "number" && msg.subscription?.id && this.streams.has(reqId)) {
      this.bySub.set(msg.subscription.id, this.streams.get(reqId)!);
    }
    if (typeof reqId === "number" && this.streams.has(reqId)) {
      this.streams.get(reqId)?.(msg);
    } else if (msg.subscription?.id && this.bySub.has(msg.subscription.id)) {
      this.bySub.get(msg.subscription.id)?.(msg);
    }
    if (typeof reqId === "number" && this.pending.has(reqId)) {
      const waiter = this.pending.get(reqId);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.pending.delete(reqId);
        waiter.resolve(msg);
      }
    } else if (typeof reqId === "number") {
      this.deliverLate(reqId, msg);
    }
  }

  private deliverLate(reqId: number, msg: DerivMsg) {
    const late = this.late.get(reqId);
    if (!late) return;
    this.late.delete(reqId);
    try {
      late(msg);
    } catch {
      /* A late buy handler must not break the socket. */
    }
  }

  private rejectAll(reason: string) {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
    this.pending.clear();
    this.streams.clear();
    this.bySub.clear();
    for (const reqId of [...this.late.keys()]) {
      const kept = [...this.purchases.values()].some((row) => row.reqId === reqId);
      if (!kept) this.late.delete(reqId);
    }
  }
}
