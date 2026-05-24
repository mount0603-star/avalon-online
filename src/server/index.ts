import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  addBot,
  assassinate,
  attachSocket,
  buildRoomView,
  castMissionVote,
  castTeamVote,
  createRoom,
  detachSocket,
  isRoomIdleExpired,
  joinRoom,
  leaveRoom,
  proposeTeam,
  removeBot,
  resetRoom,
  rooms,
  runBotActionsForServer,
  setBotAiSettings,
  setExcaliburEnabled,
  setLadyEnabled,
  setLadyHolderMode,
  setLancelotEnabled,
  startGame,
  touchRoom,
  updateTeamDraft,
  useExcalibur,
  useLadyOfLake
} from "./game";
import type {
  ClientToServerEvents,
  InterServerEvents,
  LobbyRoomSummary,
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
const cleanupIntervalMs = 60 * 1000;

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
  socket.emit("lobbyRooms", buildLobbySummaries());

  socket.on("createRoom", (payload, ack) => {
    try {
      const { room, playerId } = createRoom(payload.name, payload.playerId);
      attachSocket(room, playerId, socket.id);
      socket.data.roomCode = room.code;
      socket.data.playerId = playerId;
      socket.join(room.code);
      touchRoom(room);
      ack({ roomCode: room.code, playerId });
      emitRoom(room.code);
      emitLobbyRooms();
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
      touchRoom(room);
      ack({ roomCode: room.code, playerId });
      emitRoom(room.code);
      emitLobbyRooms();
    } catch (error) {
      ack({ error: getErrorMessage(error) });
    }
  });

  socket.on("startGame", () => runAction(socket, (room, playerId) => startGame(room, playerId)));
  socket.on("addBot", () => runAction(socket, (room, playerId) => addBot(room, playerId)));
  socket.on("removeBot", (botId) => runAction(socket, (room, playerId) => removeBot(room, playerId, botId)));
  socket.on("setLadyEnabled", (enabled) => runAction(socket, (room, playerId) => setLadyEnabled(room, playerId, enabled)));
  socket.on("setLadyHolderMode", (mode) => runAction(socket, (room, playerId) => setLadyHolderMode(room, playerId, mode)));
  socket.on("setLancelotEnabled", (enabled) => runAction(socket, (room, playerId) => setLancelotEnabled(room, playerId, enabled)));
  socket.on("setExcaliburEnabled", (enabled) => runAction(socket, (room, playerId) => setExcaliburEnabled(room, playerId, enabled)));
  socket.on("setBotAiSettings", (settings) => runAction(socket, (room, playerId) => setBotAiSettings(room, playerId, settings)));
  socket.on("updateTeamDraft", (teamIds, excaliburHolderId) =>
    runAction(socket, (room, playerId) => updateTeamDraft(room, playerId, teamIds, excaliburHolderId))
  );
  socket.on("proposeTeam", (teamIds, excaliburHolderId) =>
    runAction(socket, (room, playerId) => proposeTeam(room, playerId, teamIds, excaliburHolderId))
  );
  socket.on("castTeamVote", (approve) => runAction(socket, (room, playerId) => castTeamVote(room, playerId, approve)));
  socket.on("castMissionVote", (success) => runAction(socket, (room, playerId) => castMissionVote(room, playerId, success)));
  socket.on("useExcalibur", (targetId) => runAction(socket, (room, playerId) => useExcalibur(room, playerId, targetId)));
  socket.on("useLadyOfLake", (targetId, announcedAllegiance) =>
    runAction(socket, (room, playerId) => useLadyOfLake(room, playerId, targetId, announcedAllegiance))
  );
  socket.on("assassinate", (targetId) => runAction(socket, (room, playerId) => assassinate(room, playerId, targetId)));
  socket.on("resetRoom", () => runAction(socket, (room, playerId) => resetRoom(room, playerId)));
  socket.on("leaveRoom", () => {
    const { roomCode, playerId } = socket.data;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room || !playerId) {
      socket.emit("roomClosed", "你已離開房間。");
      return;
    }

    try {
      const result = leaveRoom(room, playerId);
      socket.leave(room.code);
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      socket.emit("roomClosed", "你已離開房間。");

      if (result.shouldDeleteRoom) {
        closeRoom(room.code, "所有真人玩家都已離開，房間已關閉。");
        return;
      }

      touchRoom(room);
      emitRoom(room.code);
      emitLobbyRooms();
      void runBotsAndEmit(room);
    } catch (error) {
      socket.emit("roomError", getErrorMessage(error));
    }
  });

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
    touchRoom(room);
    emitRoom(room.code);
    emitLobbyRooms();
    void runBotsAndEmit(room);
  } catch (error) {
    socket.emit("roomError", getErrorMessage(error));
  }
}

async function runBotsAndEmit(room: NonNullable<ReturnType<typeof rooms.get>>): Promise<void> {
  await runBotActionsForServer(room);
  emitRoom(room.code);
  emitLobbyRooms();
}

function closeRoom(roomCode: string, message: string): void {
  if (!rooms.has(roomCode)) {
    return;
  }
  io.to(roomCode).emit("roomClosed", message);
  io.in(roomCode).socketsLeave(roomCode);
  rooms.delete(roomCode);
  emitLobbyRooms();
}

function cleanupIdleRooms(): void {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (isRoomIdleExpired(room, now)) {
      closeRoom(room.code, "房間超過 30 分鐘沒有動作，已自動關閉。");
    }
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

function emitLobbyRooms(): void {
  io.emit("lobbyRooms", buildLobbySummaries());
}

function buildLobbySummaries(): LobbyRoomSummary[] {
  return Array.from(rooms.values())
    .map((room) => ({
      hostName: room.players.get(room.hostId)?.name || "未知房主",
      playerCount: room.players.size,
      maxPlayers: 10,
      phase: room.game.phase,
      updatedAt: room.lastActivityAt
    }))
    .sort((first, second) => second.updatedAt - first.updatedAt);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "發生未知錯誤。";
}

const port = Number(process.env.PORT || 4000);
httpServer.listen(port, () => {
  console.log(`Avalon server listening on http://localhost:${port}`);
});

const cleanupTimer = setInterval(cleanupIdleRooms, cleanupIntervalMs);
cleanupTimer.unref?.();
