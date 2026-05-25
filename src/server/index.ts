import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  addBot,
  assassinate,
  attachSocket,
  buildAdminRoomView,
  buildRoomView,
  castMissionVote,
  castTeamVote,
  createRoom,
  detachSocket,
  IDLE_TIMEOUT_MS,
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
  AdminLogEntry,
  AdminSnapshot,
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
const voiceRooms = new Map<string, Set<string>>();
const adminSpectators = new Map<string, Set<string>>();
const adminLogs: AdminLogEntry[] = [];
const botRunQueues = new Map<string, Promise<void>>();
let nextAdminLogId = 1;
type AppSocket = Parameters<Parameters<typeof io.on>[1]>[0];

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
      recordAdminLog("建立房間", room.code);
      ack({ roomCode: room.code, playerId });
      emitRoom(room.code);
      emitLobbyRooms();
      emitAdminSnapshot();
    } catch (error) {
      recordAdminLog(`建立房間失敗：${getErrorMessage(error)}`, undefined, "error");
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
      recordAdminLog(`${payload.name} 加入房間`, room.code);
      ack({ roomCode: room.code, playerId });
      emitRoom(room.code);
      emitLobbyRooms();
      emitAdminSnapshot();
    } catch (error) {
      recordAdminLog(`加入房間 ${payload.roomCode?.trim().toUpperCase() || "未知"} 失敗：${getErrorMessage(error)}`, undefined, "warning");
      ack({ error: getErrorMessage(error) });
    }
  });

  socket.on("adminLogin", (payload, ack) => {
    if (!isAdminCredential(payload.username, payload.password)) {
      recordAdminLog("管理者登入失敗", undefined, "warning");
      ack({ ok: false, error: "帳號或密碼錯誤。" });
      return;
    }
    socket.data.adminAuthenticated = true;
    recordAdminLog("管理者登入");
    ack({ ok: true, snapshot: buildAdminSnapshot() });
  });

  socket.on("adminList", (ack) => {
    if (!socket.data.adminAuthenticated) {
      ack({ ok: false, error: "尚未登入管理者。" });
      return;
    }
    ack({ ok: true, snapshot: buildAdminSnapshot() });
  });

  socket.on("adminCloseRoom", (roomCode, ack) => {
    if (!socket.data.adminAuthenticated) {
      ack({ ok: false, error: "尚未登入管理者。" });
      return;
    }
    const code = roomCode.trim().toUpperCase();
    if (!rooms.has(code)) {
      ack({ ok: false, error: "找不到這個房間。" });
      return;
    }
    recordAdminLog("管理者關閉房間", code, "warning");
    closeRoom(code, "管理者已關閉房間。");
    ack({ ok: true, snapshot: buildAdminSnapshot() });
  });

  socket.on("adminSpectateRoom", (roomCode, ack) => {
    if (!socket.data.adminAuthenticated) {
      ack({ ok: false, error: "尚未登入管理者。" });
      return;
    }
    const code = roomCode.trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      ack({ ok: false, error: "找不到這個房間。" });
      return;
    }
    setAdminSpectatingRoom(socket, code);
    recordAdminLog("管理者進入旁觀", code);
    ack({ ok: true, state: buildAdminRoomView(room), snapshot: buildAdminSnapshot() });
  });

  socket.on("adminLeaveSpectate", () => clearAdminSpectatingRoom(socket));

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
  socket.on("voiceJoin", () => {
    const { roomCode, playerId } = socket.data;
    const room = roomCode ? rooms.get(roomCode) : null;
    const player = playerId ? room?.players.get(playerId) : null;
    if (!room || !playerId || !player || player.isBot) {
      socket.emit("roomError", "無法加入語音。");
      return;
    }

    const voicePeers = voiceRooms.get(room.code) || new Set<string>();
    voiceRooms.set(room.code, voicePeers);
    const existingPeers = [...voicePeers].filter((id) => id !== playerId && Boolean(room.players.get(id)?.socketId));
    voicePeers.add(playerId);
    socket.data.voiceEnabled = true;
    touchRoom(room);
    socket.emit("voicePeers", existingPeers);
    socket.to(room.code).emit("voicePeerJoined", playerId);
  });
  socket.on("voiceLeave", () => leaveVoice(socket));
  socket.on("voiceSignal", (targetPlayerId, signal) => {
    const { roomCode, playerId } = socket.data;
    const room = roomCode ? rooms.get(roomCode) : null;
    const target = targetPlayerId ? room?.players.get(targetPlayerId) : null;
    if (!room || !playerId || !target?.socketId || !voiceRooms.get(room.code)?.has(playerId)) {
      return;
    }
    io.to(target.socketId).emit("voiceSignal", playerId, signal);
  });
  socket.on("resetRoom", () => runAction(socket, (room, playerId) => resetRoom(room, playerId)));
  socket.on("leaveRoom", () => {
    const { roomCode, playerId } = socket.data;
    const room = roomCode ? rooms.get(roomCode) : null;
    if (!room || !playerId) {
      socket.emit("roomClosed", "你已離開房間。");
      return;
    }

    try {
      leaveVoice(socket);
      const result = leaveRoom(room, playerId);
      socket.leave(room.code);
      socket.data.roomCode = undefined;
      socket.data.playerId = undefined;
      socket.emit("roomClosed", "你已離開房間。");
      recordAdminLog("玩家離開房間", room.code);

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
    leaveVoice(socket);
    clearAdminSpectatingRoom(socket);
    const room = detachSocket(socket.id);
    if (room) {
      emitRoom(room.code);
      emitAdminRoom(room.code);
      emitAdminSnapshot();
    }
  });
});

function leaveVoice(socket: Parameters<Parameters<typeof io.on>[1]>[0]): void {
  const { roomCode, playerId } = socket.data;
  if (!roomCode || !playerId || !socket.data.voiceEnabled) {
    return;
  }

  const voicePeers = voiceRooms.get(roomCode);
  if (!voicePeers) {
    socket.data.voiceEnabled = false;
    return;
  }

  voicePeers.delete(playerId);
  socket.data.voiceEnabled = false;
  socket.to(roomCode).emit("voicePeerLeft", playerId);
  if (voicePeers.size === 0) {
    voiceRooms.delete(roomCode);
  }
}

function isAdminCredential(username: string, password: string): boolean {
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "1qaz@WSX";
  return username === adminUsername && password === adminPassword;
}

function setAdminSpectatingRoom(socket: AppSocket, roomCode: string): void {
  clearAdminSpectatingRoom(socket);
  socket.data.adminSpectatingRoomCode = roomCode;
  const spectators = adminSpectators.get(roomCode) || new Set<string>();
  spectators.add(socket.id);
  adminSpectators.set(roomCode, spectators);
}

function clearAdminSpectatingRoom(socket: AppSocket): void {
  const roomCode = socket.data.adminSpectatingRoomCode;
  if (!roomCode) {
    return;
  }
  const spectators = adminSpectators.get(roomCode);
  spectators?.delete(socket.id);
  if (spectators?.size === 0) {
    adminSpectators.delete(roomCode);
  }
  socket.data.adminSpectatingRoomCode = undefined;
}

function recordAdminLog(message: string, roomCode?: string, level: AdminLogEntry["level"] = "info"): void {
  adminLogs.push({
    id: nextAdminLogId,
    at: Date.now(),
    level,
    message,
    roomCode
  });
  nextAdminLogId += 1;
  if (adminLogs.length > 120) {
    adminLogs.splice(0, adminLogs.length - 120);
  }
  emitAdminSnapshot();
}

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
    emitAdminSnapshot();
    void runBotsAndEmit(room);
  } catch (error) {
    socket.emit("roomError", getErrorMessage(error));
  }
}

async function runBotsAndEmit(room: NonNullable<ReturnType<typeof rooms.get>>): Promise<void> {
  const roomCode = room.code;
  const previousRun = botRunQueues.get(roomCode) || Promise.resolve();
  const nextRun = previousRun
    .catch(() => undefined)
    .then(async () => {
      const currentRoom = rooms.get(roomCode);
      if (!currentRoom) {
        return;
      }

      try {
        await runBotActionsForServer(currentRoom);
      } catch (error) {
        recordAdminLog(`電腦行動失敗：${getErrorMessage(error)}`, roomCode, "error");
      }

      if (!rooms.has(roomCode)) {
        return;
      }
      emitRoom(roomCode);
      emitLobbyRooms();
      emitAdminSnapshot();
    });

  botRunQueues.set(roomCode, nextRun);
  void nextRun.finally(() => {
    if (botRunQueues.get(roomCode) === nextRun) {
      botRunQueues.delete(roomCode);
    }
  });
  return nextRun;
}

function closeRoom(roomCode: string, message: string): void {
  botRunQueues.delete(roomCode);
  if (!rooms.has(roomCode)) {
    return;
  }
  notifyAdminRoomClosed(roomCode, message);
  io.to(roomCode).emit("roomClosed", message);
  voiceRooms.delete(roomCode);
  io.in(roomCode).socketsLeave(roomCode);
  rooms.delete(roomCode);
  recordAdminLog(message, roomCode, "warning");
  emitLobbyRooms();
  emitAdminSnapshot();
}

function cleanupIdleRooms(): void {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (isRoomIdleExpired(room, now)) {
      recordAdminLog("房間閒置逾時", room.code, "warning");
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
  emitAdminRoom(roomCode);
}

function emitLobbyRooms(): void {
  io.emit("lobbyRooms", buildLobbySummaries());
}

function emitAdminSnapshot(): void {
  const snapshot = buildAdminSnapshot();
  for (const [, client] of io.sockets.sockets) {
    if (client.data.adminAuthenticated) {
      client.emit("adminSnapshot", snapshot);
    }
  }
}

function emitAdminRoom(roomCode: string): void {
  const room = rooms.get(roomCode);
  const spectators = adminSpectators.get(roomCode);
  if (!room || !spectators) {
    return;
  }
  const view = buildAdminRoomView(room);
  for (const socketId of spectators) {
    io.to(socketId).emit("adminRoomState", view);
  }
}

function notifyAdminRoomClosed(roomCode: string, message: string): void {
  const spectators = adminSpectators.get(roomCode);
  if (!spectators) {
    return;
  }
  for (const socketId of spectators) {
    const client = io.sockets.sockets.get(socketId);
    client?.emit("adminRoomClosed", message);
    if (client) {
      client.data.adminSpectatingRoomCode = undefined;
    }
  }
  adminSpectators.delete(roomCode);
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

function buildAdminSnapshot(): AdminSnapshot {
  return {
    rooms: Array.from(rooms.values())
      .map((room) => {
        const players = Array.from(room.players.values());
        return {
          roomCode: room.code,
          hostName: room.players.get(room.hostId)?.name || "未知房主",
          playerCount: room.players.size,
          humanCount: players.filter((player) => !player.isBot).length,
          botCount: players.filter((player) => player.isBot).length,
          maxPlayers: 10,
          phase: room.game.phase,
          createdAt: room.createdAt,
          updatedAt: room.lastActivityAt,
          idleTimeoutAt: room.lastActivityAt + IDLE_TIMEOUT_MS
        };
      })
      .sort((first, second) => second.updatedAt - first.updatedAt),
    logs: [...adminLogs].sort((first, second) => second.id - first.id)
  };
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
