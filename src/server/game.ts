import { randomUUID } from "node:crypto";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  QUEST_FAIL_THRESHOLDS,
  QUEST_TEAM_SIZES,
  ROLE_DEFINITIONS,
  getRoleSet,
  roleSide,
  type RoleId
} from "../shared/roles";
import type {
  GamePublicState,
  PlayerPublic,
  LadyResult,
  QuestResult,
  RoleKnowledge,
  RoomView,
  VoteRecord
} from "../shared/types";

export type PlayerInternal = PlayerPublic & {
  socketId: string | null;
  role: RoleId | null;
};

export type GameInternal = {
  phase: GamePublicState["phase"];
  playerOrder: string[];
  leaderIndex: number;
  questIndex: number;
  failedVoteCount: number;
  proposedTeam: string[];
  teamVotes: Record<string, boolean>;
  missionVotes: Record<string, boolean>;
  quests: QuestResult[];
  voteHistory: VoteRecord[];
  winner: "good" | "evil" | null;
  winReason: string | null;
  assassinTargetId: string | null;
  ladyEnabled: boolean;
  ladyHolderId: string | null;
  ladyUsedPlayerIds: string[];
  ladyInspections: { fromId: string; targetId: string }[];
  ladyResults: Record<string, LadyResult>;
};

export type RoomInternal = {
  code: string;
  hostId: string;
  players: Map<string, PlayerInternal>;
  game: GameInternal;
};

export const rooms = new Map<string, RoomInternal>();

const BOT_NAMES = ["蓋瑞斯", "崔斯坦", "伊蓮", "貝狄威爾", "蘭馬洛克", "艾克特", "凱", "加荷里斯"];

export function emptyGame(): GameInternal {
  return {
    phase: "lobby",
    playerOrder: [],
    leaderIndex: 0,
    questIndex: 0,
    failedVoteCount: 0,
    proposedTeam: [],
    teamVotes: {},
    missionVotes: {},
    quests: [],
    voteHistory: [],
    winner: null,
    winReason: null,
    assassinTargetId: null,
    ladyEnabled: false,
    ladyHolderId: null,
    ladyUsedPlayerIds: [],
    ladyInspections: [],
    ladyResults: {}
  };
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function normalizeName(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, " ");
  return cleaned.length > 0 ? cleaned.slice(0, 18) : "玩家";
}

export function createRoom(name: string, existingPlayerId?: string): { room: RoomInternal; playerId: string } {
  const code = generateRoomCode();
  const playerId = existingPlayerId || randomUUID();
  const player: PlayerInternal = {
    id: playerId,
    name: normalizeName(name),
    connected: true,
    isHost: true,
    isBot: false,
    socketId: null,
    role: null
  };
  const room: RoomInternal = {
    code,
    hostId: playerId,
    players: new Map([[playerId, player]]),
    game: emptyGame()
  };
  rooms.set(code, room);
  return { room, playerId };
}

export function joinRoom(roomCode: string, name: string, existingPlayerId?: string): { room: RoomInternal; playerId: string } {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) {
    throw new Error("找不到這個房間。");
  }

  if (existingPlayerId && room.players.has(existingPlayerId)) {
    const player = room.players.get(existingPlayerId)!;
    player.name = normalizeName(name);
    player.connected = true;
    return { room, playerId: existingPlayerId };
  }

  if (room.game.phase !== "lobby") {
    throw new Error("遊戲已經開始，暫時不能加入新玩家。");
  }

  if (room.players.size >= MAX_PLAYERS) {
    throw new Error("房間已滿。");
  }

  const playerId = existingPlayerId || randomUUID();
  const player: PlayerInternal = {
    id: playerId,
    name: normalizeName(name),
    connected: true,
    isHost: false,
    isBot: false,
    socketId: null,
    role: null
  };
  room.players.set(playerId, player);
  return { room, playerId };
}

export function addBot(room: RoomInternal, hostId: string): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能新增電腦玩家。");
  }
  if (room.players.size >= MAX_PLAYERS) {
    throw new Error("房間已滿。");
  }

  const usedNames = new Set(Array.from(room.players.values()).map((player) => player.name));
  const botName = BOT_NAMES.find((name) => !usedNames.has(name)) || `電腦 ${room.players.size + 1}`;
  const botId = `bot-${randomUUID()}`;
  room.players.set(botId, {
    id: botId,
    name: botName,
    connected: true,
    isHost: false,
    isBot: true,
    socketId: null,
    role: null
  });
}

export function removeBot(room: RoomInternal, hostId: string, botId: string): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能移除電腦玩家。");
  }
  const bot = requirePlayer(room, botId);
  if (!bot.isBot) {
    throw new Error("只能移除電腦玩家。");
  }
  room.players.delete(botId);
}

export function attachSocket(room: RoomInternal, playerId: string, socketId: string): void {
  const player = requirePlayer(room, playerId);
  player.socketId = socketId;
  player.connected = true;
}

export function detachSocket(socketId: string): RoomInternal | null {
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (player.socketId === socketId) {
        player.socketId = null;
        player.connected = false;
        return room;
      }
    }
  }
  return null;
}

export function startGame(room: RoomInternal, playerId: string): void {
  assertHost(room, playerId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲已經開始。");
  }

  const playerCount = room.players.size;
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new Error("需要 5 到 10 位玩家才能開始。");
  }

  const roleDeck = shuffle(getRoleSet(playerCount));
  const order = Array.from(room.players.keys());
  order.forEach((id, index) => {
    room.players.get(id)!.role = roleDeck[index];
  });

  room.game = {
    ...emptyGame(),
    phase: "team-building",
    playerOrder: order,
    leaderIndex: Math.floor(Math.random() * order.length),
    questIndex: 0,
    ladyEnabled: playerCount >= 7,
    ladyHolderId: playerCount >= 7 ? order[order.length - 1] : null,
    ladyUsedPlayerIds: playerCount >= 7 ? [order[order.length - 1]] : []
  };
}

export function proposeTeam(room: RoomInternal, playerId: string, teamIds: string[]): void {
  assertPhase(room, "team-building");
  assertLeader(room, playerId);

  const uniqueTeam = Array.from(new Set(teamIds));
  const requiredSize = currentTeamSize(room);
  if (uniqueTeam.length !== requiredSize) {
    throw new Error(`這次任務需要 ${requiredSize} 人。`);
  }

  for (const id of uniqueTeam) {
    requirePlayer(room, id);
  }

  room.game.proposedTeam = uniqueTeam;
  room.game.teamVotes = {};
  room.game.phase = "team-vote";
}

export function castTeamVote(room: RoomInternal, playerId: string, approve: boolean): void {
  assertPhase(room, "team-vote");
  requirePlayer(room, playerId);

  if (room.game.teamVotes[playerId] !== undefined) {
    throw new Error("你已經投過票了。");
  }

  room.game.teamVotes[playerId] = approve;

  if (Object.keys(room.game.teamVotes).length !== room.players.size) {
    return;
  }

  const approvals = Object.entries(room.game.teamVotes)
    .filter(([, value]) => value)
    .map(([id]) => id);
  const rejections = Object.entries(room.game.teamVotes)
    .filter(([, value]) => !value)
    .map(([id]) => id);
  const approved = approvals.length > rejections.length;

  room.game.voteHistory.push({
    round: room.game.voteHistory.length + 1,
    leaderId: currentLeaderId(room)!,
    team: [...room.game.proposedTeam],
    approvals,
    rejections,
    approved
  });

  room.game.teamVotes = {};

  if (approved) {
    room.game.missionVotes = {};
    room.game.phase = "mission";
    return;
  }

  room.game.failedVoteCount += 1;
  if (room.game.failedVoteCount >= 5) {
    finishGame(room, "evil", "連續五次組隊被否決，邪惡陣營獲勝。");
    return;
  }

  advanceLeader(room);
  room.game.proposedTeam = [];
  room.game.phase = "team-building";
}

export function castMissionVote(room: RoomInternal, playerId: string, success: boolean): void {
  assertPhase(room, "mission");
  const player = requirePlayer(room, playerId);
  if (!room.game.proposedTeam.includes(playerId)) {
    throw new Error("只有任務隊員可以提交任務結果。");
  }
  if (room.game.missionVotes[playerId] !== undefined) {
    throw new Error("你已經提交過任務結果了。");
  }

  const normalizedSuccess = player.role && roleSide(player.role) === "good" ? true : success;
  room.game.missionVotes[playerId] = normalizedSuccess;

  if (Object.keys(room.game.missionVotes).length !== room.game.proposedTeam.length) {
    return;
  }

  const failCount = Object.values(room.game.missionVotes).filter((value) => !value).length;
  const failThreshold = currentFailThreshold(room);
  const questSuccess = failCount < failThreshold;

  room.game.quests.push({
    index: room.game.questIndex,
    team: [...room.game.proposedTeam],
    success: questSuccess,
    failCount,
    failThreshold
  });

  room.game.missionVotes = {};
  room.game.failedVoteCount = 0;

  const successCount = room.game.quests.filter((quest) => quest.success).length;
  const failureCount = room.game.quests.filter((quest) => !quest.success).length;

  if (failureCount >= 3) {
    finishGame(room, "evil", "邪惡陣營破壞了三次任務。");
    return;
  }

  if (successCount >= 3) {
    room.game.phase = "assassination";
    room.game.proposedTeam = [];
    return;
  }

  moveToNextQuest(room);
}

export function useLadyOfLake(room: RoomInternal, playerId: string, targetId: string): void {
  assertPhase(room, "lady");
  const holder = requirePlayer(room, playerId);
  const target = requirePlayer(room, targetId);

  if (room.game.ladyHolderId !== holder.id) {
    throw new Error("現在不是你持有湖中女神。");
  }
  if (target.id === holder.id) {
    throw new Error("湖中女神不能查看自己。");
  }
  if (room.game.ladyUsedPlayerIds.includes(target.id)) {
    throw new Error("這位玩家已經持有過湖中女神。");
  }
  if (!target.role) {
    throw new Error("目標還沒有身分。");
  }

  room.game.ladyResults[playerId] = {
    targetId: target.id,
    allegiance: roleSide(target.role)
  };
  room.game.ladyInspections.push({ fromId: holder.id, targetId: target.id });
  room.game.ladyHolderId = target.id;
  room.game.ladyUsedPlayerIds.push(target.id);
  room.game.phase = "team-building";
}

export function assassinate(room: RoomInternal, playerId: string, targetId: string): void {
  assertPhase(room, "assassination");
  const assassin = requirePlayer(room, playerId);
  const target = requirePlayer(room, targetId);
  if (assassin.role !== "assassin") {
    throw new Error("只有刺客可以選擇刺殺目標。");
  }
  if (target.role === "assassin") {
    throw new Error("不能刺殺自己。");
  }

  room.game.assassinTargetId = targetId;
  if (target.role === "merlin") {
    finishGame(room, "evil", "刺客命中梅林，邪惡陣營逆轉勝。");
  } else {
    finishGame(room, "good", "刺客沒有命中梅林，亞瑟陣營獲勝。");
  }
}

export function resetRoom(room: RoomInternal, playerId: string): void {
  assertHost(room, playerId);
  for (const player of room.players.values()) {
    player.role = null;
  }
  room.game = emptyGame();
}

export function buildRoomView(room: RoomInternal, viewerId: string): RoomView {
  const viewer = room.players.get(viewerId) || null;
  const game = room.game;
  const playerCount = room.players.size;
  const rolesAreRevealed = game.phase === "finished";
  const assassin = Array.from(room.players.values()).find((player) => player.role === "assassin") || null;
  const revealedRoles = rolesAreRevealed
    ? Object.fromEntries(Array.from(room.players.values()).map((player) => [player.id, player.role!]))
    : null;

  return {
    roomCode: room.code,
    you: viewer ? toPublicPlayer(viewer) : null,
    players: orderedPlayers(room).map(toPublicPlayer),
    game: {
      phase: game.phase,
      playerOrder: [...game.playerOrder],
      leaderId: currentLeaderId(room),
      questIndex: game.questIndex,
      teamSize: game.phase === "lobby" ? 0 : currentTeamSize(room),
      failThreshold: game.phase === "lobby" ? 1 : currentFailThreshold(room),
      failedVoteCount: game.failedVoteCount,
      proposedTeam: [...game.proposedTeam],
      teamVotesSubmitted: Object.keys(game.teamVotes),
      missionVotesSubmitted: Object.keys(game.missionVotes),
      quests: [...game.quests],
      voteHistory: [...game.voteHistory],
      winner: game.winner,
      winReason: game.winReason,
      assassinId: assassin?.id || null,
      assassinTargetId: game.assassinTargetId,
      ladyEnabled: game.ladyEnabled,
      ladyHolderId: game.ladyHolderId,
      ladyUsedPlayerIds: [...game.ladyUsedPlayerIds],
      ladyInspections: [...game.ladyInspections]
    },
    yourRole: viewer?.role || null,
    roleKnowledge: viewer?.role ? buildKnowledge(room, viewer.id, viewer.role) : [],
    ladyResult: viewer ? game.ladyResults[viewer.id] || null : null,
    revealedRoles
  };
}

export function runBotActions(room: RoomInternal): boolean {
  let changed = false;
  for (let count = 0; count < 30; count += 1) {
    const acted = runOneBotAction(room);
    if (!acted) {
      return changed;
    }
    changed = true;
  }
  return changed;
}

export function activeRoleList(playerCount: number): RoleId[] {
  return getRoleSet(playerCount);
}

export function currentLeaderId(room: RoomInternal): string | null {
  if (room.game.phase === "lobby" || room.game.playerOrder.length === 0) {
    return null;
  }
  return room.game.playerOrder[room.game.leaderIndex] || null;
}

function buildKnowledge(room: RoomInternal, viewerId: string, role: RoleId): RoleKnowledge[] {
  const players = Array.from(room.players.values());
  if (role === "merlin") {
    return [
      {
        label: "梅林看見的邪惡玩家",
        playerIds: players
          .filter((player) => player.role && roleSide(player.role) === "evil" && player.role !== "mordred")
          .map((player) => player.id)
      }
    ];
  }

  if (role === "percival") {
    return [
      {
        label: "派西維爾看見的梅林候選",
        playerIds: players.filter((player) => player.role === "merlin" || player.role === "morgana").map((player) => player.id)
      }
    ];
  }

  if (roleSide(role) === "evil" && role !== "oberon") {
    return [
      {
        label: "你知道的邪惡同伴",
        playerIds: players
          .filter((player) => player.id !== viewerId && player.role && roleSide(player.role) === "evil" && player.role !== "oberon")
          .map((player) => player.id)
      }
    ];
  }

  return [];
}

function finishGame(room: RoomInternal, winner: "good" | "evil", reason: string): void {
  room.game.phase = "finished";
  room.game.winner = winner;
  room.game.winReason = reason;
}

function moveToNextQuest(room: RoomInternal): void {
  const completedQuestIndex = room.game.questIndex;
  room.game.questIndex += 1;
  advanceLeader(room);
  room.game.proposedTeam = [];

  if (shouldUseLadyOfLake(room, completedQuestIndex)) {
    room.game.phase = "lady";
    return;
  }

  room.game.phase = "team-building";
}

function shouldUseLadyOfLake(room: RoomInternal, completedQuestIndex: number): boolean {
  return (
    room.game.ladyEnabled &&
    completedQuestIndex >= 1 &&
    completedQuestIndex <= 3 &&
    room.game.ladyUsedPlayerIds.length < room.players.size &&
    Boolean(room.game.ladyHolderId)
  );
}

function runOneBotAction(room: RoomInternal): boolean {
  if (room.game.phase === "team-building") {
    const leaderId = currentLeaderId(room);
    const leader = leaderId ? room.players.get(leaderId) : null;
    if (leader?.isBot) {
      proposeTeam(room, leader.id, chooseBotTeam(room, leader));
      return true;
    }
  }

  if (room.game.phase === "team-vote") {
    const bot = Array.from(room.players.values()).find((player) => player.isBot && room.game.teamVotes[player.id] === undefined);
    if (bot) {
      castTeamVote(room, bot.id, chooseBotTeamVote(room, bot));
      return true;
    }
  }

  if (room.game.phase === "mission") {
    const bot = room.game.proposedTeam
      .map((id) => room.players.get(id))
      .find((player): player is PlayerInternal => Boolean(player && player.isBot && room.game.missionVotes[player.id] === undefined));
    if (bot) {
      castMissionVote(room, bot.id, chooseBotMissionVote(room, bot));
      return true;
    }
  }

  if (room.game.phase === "lady") {
    const holder = room.game.ladyHolderId ? room.players.get(room.game.ladyHolderId) : null;
    if (holder?.isBot) {
      useLadyOfLake(room, holder.id, chooseBotLadyTarget(room, holder));
      return true;
    }
  }

  if (room.game.phase === "assassination") {
    const assassin = Array.from(room.players.values()).find((player) => player.role === "assassin");
    if (assassin?.isBot) {
      const merlin = Array.from(room.players.values()).find((player) => player.role === "merlin");
      if (merlin) {
        assassinate(room, assassin.id, merlin.id);
        return true;
      }
    }
  }

  return false;
}

function chooseBotTeam(room: RoomInternal, bot: PlayerInternal): string[] {
  const size = currentTeamSize(room);
  const players = orderedPlayers(room);
  const team: string[] = [];
  const add = (player?: PlayerInternal) => {
    if (player && !team.includes(player.id) && team.length < size) {
      team.push(player.id);
    }
  };

  add(bot);

  if (bot.role && roleSide(bot.role) === "evil") {
    knownEvilPlayers(room, bot).forEach(add);
    players.filter((player) => player.role && roleSide(player.role) === "good").forEach(add);
  } else {
    players.filter((player) => !knownEvilIds(room, bot).has(player.id)).forEach(add);
  }

  players.forEach(add);
  return team.slice(0, size);
}

function chooseBotTeamVote(room: RoomInternal, bot: PlayerInternal): boolean {
  const team = room.game.proposedTeam.map((id) => room.players.get(id)).filter(Boolean) as PlayerInternal[];
  if (bot.role && roleSide(bot.role) === "evil") {
    return team.some((player) => player.role && roleSide(player.role) === "evil");
  }
  const knownEvil = knownEvilIds(room, bot);
  return !team.some((player) => knownEvil.has(player.id));
}

function chooseBotMissionVote(room: RoomInternal, bot: PlayerInternal): boolean {
  if (!bot.role || roleSide(bot.role) === "good") {
    return true;
  }
  const currentFailCount = Object.values(room.game.missionVotes).filter((value) => !value).length;
  return currentFailCount >= currentFailThreshold(room);
}

function chooseBotLadyTarget(room: RoomInternal, bot: PlayerInternal): string {
  const used = new Set(room.game.ladyUsedPlayerIds);
  const candidates = orderedPlayers(room).filter((player) => player.id !== bot.id && !used.has(player.id));
  const unknownCandidates = candidates.filter((player) => !knownEvilIds(room, bot).has(player.id));
  const pool = unknownCandidates.length > 0 ? unknownCandidates : candidates;
  return pool[Math.floor(Math.random() * pool.length)].id;
}

function knownEvilPlayers(room: RoomInternal, bot: PlayerInternal): PlayerInternal[] {
  if (!bot.role) {
    return [];
  }
  if (roleSide(bot.role) === "evil") {
    return orderedPlayers(room).filter(
      (player) => player.role && roleSide(player.role) === "evil" && player.role !== "oberon" && (bot.role !== "oberon" || player.id === bot.id)
    );
  }
  if (bot.role === "merlin") {
    return orderedPlayers(room).filter((player) => player.role && roleSide(player.role) === "evil" && player.role !== "mordred");
  }
  const ladyResult = room.game.ladyResults[bot.id];
  if (ladyResult?.allegiance === "evil") {
    const player = room.players.get(ladyResult.targetId);
    return player ? [player] : [];
  }
  return [];
}

function knownEvilIds(room: RoomInternal, bot: PlayerInternal): Set<string> {
  return new Set(knownEvilPlayers(room, bot).map((player) => player.id));
}

function orderedPlayers(room: RoomInternal): PlayerInternal[] {
  if (room.game.playerOrder.length > 0) {
    return room.game.playerOrder.map((id) => room.players.get(id)).filter(Boolean) as PlayerInternal[];
  }
  return Array.from(room.players.values());
}

function toPublicPlayer(player: PlayerInternal): PlayerPublic {
  return {
    id: player.id,
    name: player.name,
    connected: player.connected,
    isHost: player.isHost,
    isBot: player.isBot
  };
}

function currentTeamSize(room: RoomInternal): number {
  return QUEST_TEAM_SIZES[room.players.size][room.game.questIndex];
}

function currentFailThreshold(room: RoomInternal): number {
  return QUEST_FAIL_THRESHOLDS[room.players.size][room.game.questIndex];
}

function advanceLeader(room: RoomInternal): void {
  room.game.leaderIndex = (room.game.leaderIndex + 1) % room.game.playerOrder.length;
}

function requirePlayer(room: RoomInternal, playerId: string): PlayerInternal {
  const player = room.players.get(playerId);
  if (!player) {
    throw new Error("找不到玩家。");
  }
  return player;
}

function assertHost(room: RoomInternal, playerId: string): void {
  if (room.hostId !== playerId) {
    throw new Error("只有房主可以執行這個動作。");
  }
}

function assertLeader(room: RoomInternal, playerId: string): void {
  if (currentLeaderId(room) !== playerId) {
    throw new Error("現在不是你的隊長回合。");
  }
}

function assertPhase(room: RoomInternal, phase: GameInternal["phase"]): void {
  if (room.game.phase !== phase) {
    throw new Error("現在不能執行這個動作。");
  }
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

export function roleName(role: RoleId): string {
  return ROLE_DEFINITIONS[role].name;
}
