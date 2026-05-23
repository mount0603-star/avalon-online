import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  assassinate,
  attachSocket,
  buildRoomView,
  castMissionVote,
  castTeamVote,
  createRoom,
  detachSocket,
  joinRoom,
  proposeTeam,
  resetRoom,
  rooms,
  startGame
} from "./game";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData
} from "../shared/types";

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../../dist/client");

app.get("/health", (_request, response) => {
  response.json({ ok: true });
});

app.use(express.static(staticDir));
app.get("*", (_request, response, next) => {
  if (process.env.NODE_ENV !== "production") {
    next();
    return;
  }
  response.sendFile(path.join(staticDir, "index.html"));
});

io.on("connection", (socket) => {
  socket.on("createRoom", (payload, ack) => {
    try {
      const { room, playerId } = createRoom(payload.name, payload.playerId);
      attachSocket(room, playerId, socket.id);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      socket.join(room.code);
      ack({ roomCode: room.code, playerId });
      emitRoom(room.code);
    } catch (error) {
      ack({ error: getErrorMessage(error) });
    }
  });

  socket.on("joinRoom", (payload, ack) => {
    try {
      const { room, playerId } = joinRoom(payload.roomCode, payload.name, payload.playerId);
      attachSocket(room, playerId, socket.id);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      socket.join(room.code);
      ack({ roomCode: room.code, playerId });
      emitRoom(room.code);
    } catch (error) {
      ack({ error: getErrorMessage(error) });
    }
  });

  socket.on("startGame", () => runAction(socket, (room, playerId) => startGame(room, playerId)));
  socket.on("proposeTeam", (teamIds) => runAction(socket, (room, playerId) => proposeTeam(room, playerId, teamIds)));
  socket.on("castTeamVote", (approve) => runAction(socket, (room, playerId) => castTeamVote(room, playerId, approve)));
  socket.on("castMissionVote", (success) => runAction(socket, (room, playerId) => castMissionVote(room, playerId, success)));
  socket.on("assassinate", (targetId) => runAction(socket, (room, playerId) => assassinate(room, playerId, targetId)));
  socket.on("resetRoom", () => runAction(socket, (room, playerId) => resetRoom(room, playerId)));

  socket.on("disconnect", () => {
    const room = detachSocket(socket.id);
    if (room) {
      emitRoom(room.code);
    }
  });
});

function runAction(
  socket: Parameters<Parameters<typeof io.on>[1]>[0],
  action: (room: NonNullable<ReturnType<typeof rooms.get>>, playerId: string) => void
): void {
  const { roomCode, playerId } = socket.data;
  const room = roomCode ? rooms.get(roomCode) : null;
  if (!room || !playerId) {
    socket.emit("roomError", "你還沒有加入房間。");
    return;
  }

  try {
    action(room, playerId);
    emitRoom(room.code);
  } catch (error) {
    socket.emit("roomError", getErrorMessage(error));
  }
}

function emitRoom(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) {
    return;
  }
  for (const player of room.players.values()) {
    if (player.socketId) {
      io.to(player.socketId).emit("roomState", buildRoomView(room, player.id));
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "發生未知錯誤。";
}

const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => {
  console.log(`Avalon server listening on http://localhost:${port}`);
});
