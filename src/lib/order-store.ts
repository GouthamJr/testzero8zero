// In-memory store for pending payment order IDs.
// Tracks orders created by /api/ccavenue/encrypt and validates them in /api/ccavenue/response.
// Orders expire after 30 minutes to prevent stale buildup.

const ORDER_TTL_MS = 30 * 60 * 1000; // 30 minutes

interface PendingOrder {
  createdAt: number;
}

const pendingOrders = new Map<string, PendingOrder>();

export function addPendingOrder(orderId: string) {
  cleanup();
  pendingOrders.set(orderId, { createdAt: Date.now() });
}

export function consumeOrder(orderId: string): boolean {
  cleanup();
  if (!pendingOrders.has(orderId)) return false;
  pendingOrders.delete(orderId);
  return true;
}

function cleanup() {
  const now = Date.now();
  for (const [id, order] of pendingOrders) {
    if (now - order.createdAt > ORDER_TTL_MS) {
      pendingOrders.delete(id);
    }
  }
}
