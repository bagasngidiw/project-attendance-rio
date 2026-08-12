/**
 * EventBus — in-process domain event dispatcher (infrastructure concern).
 *
 * FR-012/FR-013 subscribe here to capture audit and activity events. The
 * audit logger is wired as a subscriber at the composition root; the design
 * keeps this synchronous and in-process for v1 with a clear seam for a
 * durable outbox later.
 */

class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  /**
   * @param {string} eventName
   * @param {(payload: object) => void | Promise<void>} handler
   */
  subscribe(eventName, handler) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(handler);
  }

  /**
   * Dispatches to all subscribers. Subscribers run sequentially; a failing
   * subscriber logs but never blocks the caller (observability must not
   * break the happy path).
   *
   * @param {string} eventName
   * @param {object} payload
   */
  async publish(eventName, payload) {
    const handlers = this.listeners.get(eventName) ?? [];
    for (const handler of handlers) {
      try {
        await handler(payload);
      } catch (err) {
        console.error(`[event-bus] subscriber failed for ${eventName}`, err);
      }
    }
  }
}

module.exports = { EventBus };
