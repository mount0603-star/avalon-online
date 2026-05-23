import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types";

const isLocalVite = window.location.port === "5173";
const serverUrl =
  import.meta.env.VITE_SERVER_URL ||
  (isLocalVite ? `${window.location.protocol}//${window.location.hostname}:4000` : window.location.origin);

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(serverUrl, {
  autoConnect: true,
  transports: ["websocket", "polling"]
});
