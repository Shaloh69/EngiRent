import { EventEmitter } from "events";

// Shared pub/sub bus between Socket.io handlers and SSE connections.
// Socket handlers emit here; SSE endpoint listeners receive here.
const kioskEventBus = new EventEmitter();
kioskEventBus.setMaxListeners(200); // supports up to 200 concurrent SSE clients

export default kioskEventBus;
