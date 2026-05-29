import { randomUUID } from "node:crypto";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  QUEST_FAIL_THRESHOLDS,
  QUEST_TEAM_SIZES,
  ROLE_DEFINITIONS,
  getRoleSet,
  roleSide,
  type Allegiance,
  type RoleId
} from "../shared/roles";
import type {
  GamePublicState,
  PlayerPublic,
  BotOpinion,
  BotAiProvider,
  BotAiPublicConfig,
  BotAiSettingsPayload,
  LadyHolderMode,
  LadyPendingResult,
  LadyResult,
  LancelotCard,
  LancelotDrawPublic,
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
  botOpinions: BotOpinion[];
  winner: "good" | "evil" | null;
  winReason: string | null;
  assassinTargetId: string | null;
  assassinationVotes: Record<string, string>;
  excaliburEnabled: boolean;
  excaliburHolderId: string | null;
  excaliburTargetId: string | null;
  ladyEnabled: boolean;
  ladyHolderId: string | null;
  ladyUsedPlayerIds: string[];
  ladyInspections: { fromId: string; targetId: string; announcedAllegiance: Allegiance | null }[];
  ladyResults: Record<string, LadyResult>;
  ladyPendingResult: LadyPendingResult | null;
  lancelotEnabled: boolean;
  lancelotAllegiances: Record<string, Allegiance>;
  lancelotDeck: LancelotCard[];
  lancelotDraws: LancelotDrawPublic[];
};

export type RoomInternal = {
  code: string;
  hostId: string;
  ladyEnabledSetting: boolean;
  ladyHolderModeSetting: LadyHolderMode;
  lancelotEnabledSetting: boolean;
  excaliburEnabledSetting: boolean;
  botAiSetting: BotAiInternalConfig;
  players: Map<string, PlayerInternal>;
  game: GameInternal;
  createdAt: number;
  lastActivityAt: number;
};

type BotAiInternalConfig = BotAiPublicConfig & {
  apiKey: string;
};

export const rooms = new Map<string, RoomInternal>();

export const IDLE_WARNING_MS = 15 * 60 * 1000;
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

const DEFAULT_BOT_AI_CONFIG: BotAiInternalConfig = {
  enabled: false,
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5-mini",
  apiKey: "",
  apiKeyConfigured: false
};
const BOT_AI_TIMEOUT_MS = 2200;
const BOT_NAME_PREFIX = "電腦";

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
    botOpinions: [],
    winner: null,
    winReason: null,
    assassinTargetId: null,
    assassinationVotes: {},
    excaliburEnabled: false,
    excaliburHolderId: null,
    excaliburTargetId: null,
    ladyEnabled: false,
    ladyHolderId: null,
    ladyUsedPlayerIds: [],
    ladyInspections: [],
    ladyResults: {},
    ladyPendingResult: null,
    lancelotEnabled: false,
    lancelotAllegiances: {},
    lancelotDeck: [],
    lancelotDraws: []
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

function nameKey(name: string): string {
  return normalizeName(name).toLocaleLowerCase("zh-TW");
}

function assertHumanName(name: string): void {
  if (/^電腦\d+$/i.test(normalizeName(name))) {
    throw new Error("暱稱不能使用電腦編號，請換一個比較好辨識的名字。");
  }
}

function assertNameAvailable(room: RoomInternal, name: string, exceptPlayerId?: string): void {
  const key = nameKey(name);
  const duplicated = Array.from(room.players.values()).find((player) => player.id !== exceptPlayerId && nameKey(player.name) === key);
  if (duplicated) {
    throw new Error("這個暱稱已經有人使用，請換一個名字。");
  }
}

function nextBotName(room: RoomInternal): string {
  return `${BOT_NAME_PREFIX}${room.players.size + 1}`;
}

function renumberBots(room: RoomInternal): void {
  orderedPlayers(room).forEach((player, index) => {
    if (!player.isBot || !player.id.startsWith("bot-")) {
      return;
    }
    player.name = `${BOT_NAME_PREFIX}${index + 1}`;
  });
}

function findRejoinablePlayerByName(room: RoomInternal, name: string): PlayerInternal | null {
  if (room.game.phase === "lobby") {
    return null;
  }
  const normalized = nameKey(name);
  const matches = Array.from(room.players.values()).filter((player) => nameKey(player.name) === normalized);
  const rejoinablePlayers = matches.filter((player) => player.isBot || !player.connected || player.socketId === null);
  if (rejoinablePlayers.length > 1) {
    throw new Error("這個暱稱在房間內不唯一，無法判斷要接回哪個位置。請換名字或請房主重開。");
  }
  return rejoinablePlayers[0] || null;
}

export function createRoom(name: string, existingPlayerId?: string): { room: RoomInternal; playerId: string } {
  assertHumanName(name);
  const code = generateRoomCode();
  const playerId = existingPlayerId || randomUUID();
  const now = Date.now();
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
    ladyEnabledSetting: true,
    ladyHolderModeSetting: "tail",
    lancelotEnabledSetting: false,
    excaliburEnabledSetting: false,
    botAiSetting: { ...DEFAULT_BOT_AI_CONFIG },
    players: new Map([[playerId, player]]),
    game: emptyGame(),
    createdAt: now,
    lastActivityAt: now
  };
  rooms.set(code, room);
  return { room, playerId };
}

export function joinRoom(roomCode: string, name: string, existingPlayerId?: string): { room: RoomInternal; playerId: string } {
  const room = rooms.get(roomCode.trim().toUpperCase());
  if (!room) {
    throw new Error("找不到這個房間。");
  }

  const normalizedName = normalizeName(name);
  assertHumanName(normalizedName);

  if (existingPlayerId && room.players.has(existingPlayerId)) {
    assertNameAvailable(room, normalizedName, existingPlayerId);
    const player = room.players.get(existingPlayerId)!;
    player.name = normalizedName;
    player.connected = true;
    player.isBot = false;
    return { room, playerId: existingPlayerId };
  }

  const reconnectingPlayer = findRejoinablePlayerByName(room, normalizedName);
  if (reconnectingPlayer) {
    reconnectingPlayer.connected = true;
    reconnectingPlayer.isBot = false;
    reconnectingPlayer.name = normalizedName;
    return { room, playerId: reconnectingPlayer.id };
  }

  if (room.game.phase !== "lobby") {
    throw new Error("遊戲已經開始，暫時不能加入新玩家。");
  }

  if (room.players.size >= MAX_PLAYERS) {
    throw new Error("房間已滿。");
  }

  assertNameAvailable(room, normalizedName);

  const playerId = existingPlayerId || randomUUID();
  const player: PlayerInternal = {
    id: playerId,
    name: normalizedName,
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

  const botName = nextBotName(room);
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
  if (room.game.phase !== "lobby" && room.game.phase !== "finished") {
    throw new Error("只有大廳或結算時可以移除電腦玩家。");
  }
  const bot = requirePlayer(room, botId);
  if (!bot.isBot) {
    throw new Error("只能移除電腦玩家。");
  }
  room.players.delete(botId);
  renumberBots(room);
}

export function kickPlayer(room: RoomInternal, hostId: string, targetId: string): void {
  assertHost(room, hostId);
  if (hostId === targetId) {
    throw new Error("房主不能踢出自己。");
  }
  const target = requirePlayer(room, targetId);

  if (target.isBot) {
    if (room.game.phase !== "lobby" && room.game.phase !== "finished") {
      throw new Error("遊戲進行中不能移除電腦玩家。");
    }
    room.players.delete(targetId);
    renumberBots(room);
    return;
  }

  if (room.game.phase === "lobby" || room.game.phase === "finished") {
    room.players.delete(targetId);
    return;
  }

  convertPlayerToBot(room, target);
  if (room.hostId === targetId) {
    promoteHost(room);
  }
}

export function setLadyEnabled(room: RoomInternal, hostId: string, enabled: boolean): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能更改湖中女神設定。");
  }
  room.ladyEnabledSetting = enabled;
}

export function setLadyHolderMode(room: RoomInternal, hostId: string, mode: LadyHolderMode): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能更改湖中女神設定。");
  }
  if (mode !== "tail" && mode !== "random") {
    throw new Error("不支援的湖中女神起始設定。");
  }
  room.ladyHolderModeSetting = mode;
}

export function setLancelotEnabled(room: RoomInternal, hostId: string, enabled: boolean): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能更改蘭斯洛特設定。");
  }
  room.lancelotEnabledSetting = enabled;
}

export function setExcaliburEnabled(room: RoomInternal, hostId: string, enabled: boolean): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能更改王者之劍設定。");
  }
  room.excaliburEnabledSetting = enabled;
}

export function setBotAiSettings(room: RoomInternal, hostId: string, settings: BotAiSettingsPayload): void {
  assertHost(room, hostId);
  if (room.game.phase !== "lobby") {
    throw new Error("遊戲開始後不能更改 AI 電腦設定。");
  }

  const provider = normalizeBotAiProvider(settings.provider);
  const baseUrl = normalizeBotAiBaseUrl(provider, settings.baseUrl);
  const model = normalizeBotAiModel(provider, settings.model);
  const apiKey = settings.apiKey?.trim() || room.botAiSetting.apiKey;

  if (settings.enabled && apiKey.length === 0) {
    throw new Error("啟用 API 電腦前需要填入 API Key。");
  }

  room.botAiSetting = {
    enabled: Boolean(settings.enabled),
    provider,
    baseUrl,
    model,
    apiKey,
    apiKeyConfigured: apiKey.length > 0
  };
}

export function updateTeamDraft(room: RoomInternal, playerId: string, teamIds: string[], excaliburHolderId?: string | null): void {
  assertPhase(room, "team-building");
  assertLeader(room, playerId);
  const requiredSize = currentTeamSize(room);
  const uniqueTeam = Array.from(new Set(teamIds)).slice(0, requiredSize);
  for (const id of uniqueTeam) {
    requirePlayer(room, id);
  }

  room.game.proposedTeam = uniqueTeam;
  if (room.game.excaliburEnabled && excaliburHolderId && uniqueTeam.includes(excaliburHolderId) && excaliburHolderId !== playerId) {
    room.game.excaliburHolderId = excaliburHolderId;
  } else if (room.game.phase === "team-building") {
    room.game.excaliburHolderId = null;
  }
}

export function leaveRoom(room: RoomInternal, playerId: string): { shouldDeleteRoom: boolean } {
  const player = requirePlayer(room, playerId);

  if (room.game.phase === "lobby") {
    room.players.delete(playerId);
    if (!hasHumanPlayers(room)) {
      return { shouldDeleteRoom: true };
    }
    if (room.hostId === playerId) {
      promoteHost(room);
    }
    return { shouldDeleteRoom: false };
  }

  convertPlayerToBot(room, player);
  if (room.hostId === playerId) {
    promoteHost(room);
  }

  return { shouldDeleteRoom: false };
}

export function attachSocket(room: RoomInternal, playerId: string, socketId: string): void {
  const player = requirePlayer(room, playerId);
  player.socketId = socketId;
  player.connected = true;
  player.isBot = false;
  player.isHost = room.hostId === playerId;
}

export function touchRoom(room: RoomInternal, now = Date.now()): void {
  room.lastActivityAt = now;
}

export function isRoomIdleExpired(room: RoomInternal, now = Date.now()): boolean {
  return now - room.lastActivityAt >= IDLE_TIMEOUT_MS;
}

export function detachSocket(socketId: string): RoomInternal | null {
  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (player.socketId === socketId) {
        player.socketId = null;
        if (room.game.phase === "lobby" || room.game.phase === "finished") {
          player.connected = false;
        } else {
          convertPlayerToBot(room, player);
          if (room.hostId === player.id) {
            promoteHost(room);
          }
        }
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

  const lancelotEnabled = room.lancelotEnabledSetting && playerCount >= 7;
  const roleDeck = shuffle(getRoleSet(playerCount, { lancelotEnabled }));
  const order = shuffle(Array.from(room.players.keys()));
  order.forEach((id, index) => {
    room.players.get(id)!.role = roleDeck[index];
  });

  const leaderIndex = 0;
  const ladyHolderId = room.ladyEnabledSetting ? initialLadyHolderId(room, order) : null;
  const lancelotAllegiances = Object.fromEntries(
    order
      .map((id) => room.players.get(id)!)
      .filter((player) => isLancelotRole(player.role))
      .map((player) => [player.id, roleSide(player.role!)])
  );

  room.game = {
    ...emptyGame(),
    phase: "team-building",
    playerOrder: order,
    leaderIndex,
    questIndex: 0,
    excaliburEnabled: room.excaliburEnabledSetting,
    ladyEnabled: room.ladyEnabledSetting,
    ladyHolderId,
    ladyUsedPlayerIds: ladyHolderId ? [ladyHolderId] : [],
    lancelotEnabled,
    lancelotAllegiances,
    lancelotDeck: lancelotEnabled ? shuffle<LancelotCard>(["switch", "switch", "blank", "blank", "blank"]) : []
  };
  renumberBots(room);
}

export function proposeTeam(room: RoomInternal, playerId: string, teamIds: string[], excaliburHolderId?: string | null): void {
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

  if (room.game.excaliburEnabled) {
    if (!excaliburHolderId) {
      throw new Error("請指定王者之劍持有者。");
    }
    if (!uniqueTeam.includes(excaliburHolderId)) {
      throw new Error("王者之劍只能交給任務隊員。");
    }
    if (excaliburHolderId === playerId) {
      throw new Error("隊長不能把王者之劍交給自己。");
    }
    room.game.excaliburHolderId = excaliburHolderId;
    room.game.excaliburTargetId = null;
  } else {
    room.game.excaliburHolderId = null;
    room.game.excaliburTargetId = null;
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

  const normalizedSuccess = player.role && playerAllegiance(room, player) === "good" ? true : success;
  room.game.missionVotes[playerId] = normalizedSuccess;

  if (Object.keys(room.game.missionVotes).length !== room.game.proposedTeam.length) {
    return;
  }

  if (room.game.excaliburEnabled && room.game.excaliburHolderId) {
    room.game.phase = "excalibur";
    return;
  }

  resolveMission(room);
}

export function useExcalibur(room: RoomInternal, playerId: string, targetId: string | null): void {
  assertPhase(room, "excalibur");
  const holder = requirePlayer(room, playerId);
  if (room.game.excaliburHolderId !== holder.id) {
    throw new Error("現在不是你持有王者之劍。");
  }

  if (targetId) {
    const target = requirePlayer(room, targetId);
    if (target.id === holder.id) {
      throw new Error("王者之劍不能更換自己的任務卡。");
    }
    if (!room.game.proposedTeam.includes(target.id)) {
      throw new Error("只能更換任務隊員的任務卡。");
    }
    if (room.game.missionVotes[target.id] === undefined) {
      throw new Error("目標尚未提交任務卡。");
    }
    room.game.missionVotes[target.id] = !room.game.missionVotes[target.id];
    room.game.excaliburTargetId = target.id;
  } else {
    room.game.excaliburTargetId = null;
  }

  resolveMission(room);
}

function resolveMission(room: RoomInternal): void {
  const failCount = Object.values(room.game.missionVotes).filter((value) => !value).length;
  const failThreshold = currentFailThreshold(room);
  const questSuccess = failCount < failThreshold;

  room.game.quests.push({
    index: room.game.questIndex,
    team: [...room.game.proposedTeam],
    success: questSuccess,
    failCount,
    failThreshold,
    excaliburHolderId: room.game.excaliburEnabled ? room.game.excaliburHolderId : null,
    excaliburTargetId: room.game.excaliburEnabled ? room.game.excaliburTargetId : null
  });
  addMissionResultBotOpinions(room, room.game.quests[room.game.quests.length - 1]);

  maybeDrawLancelotCard(room, room.game.questIndex);
  room.game.missionVotes = {};
  room.game.failedVoteCount = 0;
  room.game.excaliburHolderId = null;
  room.game.excaliburTargetId = null;

  const successCount = room.game.quests.filter((quest) => quest.success).length;
  const failureCount = room.game.quests.filter((quest) => !quest.success).length;

  if (failureCount >= 3) {
    finishGame(room, "evil", "邪惡陣營破壞了三次任務。");
    return;
  }

  if (successCount >= 3) {
    room.game.phase = "assassination";
    room.game.assassinationVotes = {};
    room.game.proposedTeam = [];
    return;
  }

  moveToNextQuest(room);
}

export function useLadyOfLake(room: RoomInternal, playerId: string, targetId: string, announcedAllegiance?: Allegiance | null): void {
  assertPhase(room, "lady");
  const holder = requirePlayer(room, playerId);
  const normalizedAnnouncement = normalizeAllegiance(announcedAllegiance);
  const pending = room.game.ladyPendingResult;

  if (room.game.ladyHolderId !== holder.id) {
    throw new Error("現在不是你持有湖中女神。");
  }

  if (pending && pending.fromId === holder.id && !targetId) {
    if (!normalizedAnnouncement) {
      return;
    }
    const pendingTarget = requirePlayer(room, pending.targetId);
    finalizeLadyOfLake(room, holder, pendingTarget, pending.allegiance, normalizedAnnouncement);
    return;
  }

  if (!pending && availableLadyTargets(room, holder.id).length === 0) {
    room.game.phase = "team-building";
    return;
  }

  const target = requirePlayer(room, targetId);

  if (target.id === holder.id) {
    throw new Error("湖中女神不能查看自己。");
  }
  if (room.game.ladyUsedPlayerIds.includes(target.id)) {
    throw new Error("這位玩家已經持有過湖中女神。");
  }
  if (!target.role) {
    throw new Error("目標還沒有身分。");
  }

  const actualAllegiance = playerAllegiance(room, target);
  if (pending) {
    if (pending.fromId !== holder.id || pending.targetId !== target.id) {
      throw new Error("請先完成目前這次湖中女神宣告。");
    }
    if (!normalizedAnnouncement) {
      return;
    }

    finalizeLadyOfLake(room, holder, target, pending.allegiance, normalizedAnnouncement);
    return;
  }

  room.game.ladyResults[playerId] = {
    targetId: target.id,
    allegiance: actualAllegiance
  };

  if (!holder.isBot && !normalizedAnnouncement) {
    room.game.ladyPendingResult = {
      fromId: holder.id,
      targetId: target.id,
      allegiance: actualAllegiance
    };
    return;
  }

  finalizeLadyOfLake(
    room,
    holder,
    target,
    actualAllegiance,
    normalizedAnnouncement || chooseBotLadyAnnouncement(room, holder, target, actualAllegiance)
  );
}

function finalizeLadyOfLake(
  room: RoomInternal,
  holder: PlayerInternal,
  target: PlayerInternal,
  actualAllegiance: Allegiance,
  announcedAllegiance: Allegiance
): void {
  room.game.ladyResults[holder.id] = {
    targetId: target.id,
    allegiance: actualAllegiance
  };
  room.game.ladyInspections.push({
    fromId: holder.id,
    targetId: target.id,
    announcedAllegiance
  });
  room.game.ladyPendingResult = null;
  room.game.ladyHolderId = target.id;
  room.game.ladyUsedPlayerIds.push(target.id);
  room.game.phase = "team-building";
}

function availableLadyTargets(room: RoomInternal, holderId: string): PlayerInternal[] {
  const used = new Set(room.game.ladyUsedPlayerIds);
  return orderedPlayers(room).filter((player) => player.id !== holderId && !used.has(player.id) && Boolean(player.role));
}

function skipLadyIfNoTargets(room: RoomInternal): boolean {
  if (room.game.phase !== "lady" || !room.game.ladyHolderId) {
    return false;
  }
  const holder = room.players.get(room.game.ladyHolderId);
  if (!holder || availableLadyTargets(room, holder.id).length === 0) {
    room.game.ladyPendingResult = null;
    room.game.phase = "team-building";
    return true;
  }
  return false;
}

export function assassinate(room: RoomInternal, playerId: string, targetId: string): void {
  assertPhase(room, "assassination");
  const voter = requirePlayer(room, playerId);
  const target = requirePlayer(room, targetId);
  if (playerAllegiance(room, voter) !== "evil") {
    throw new Error("只有邪惡陣營可以投票猜梅林。");
  }
  if (target.id === voter.id) {
    throw new Error("不能投給自己。");
  }
  if (target.role && playerAllegiance(room, target) === "evil") {
    throw new Error("不能刺殺邪惡陣營玩家。");
  }

  room.game.assassinationVotes[voter.id] = targetId;
  const voters = assassinationVoters(room);
  if (Object.keys(room.game.assassinationVotes).length < voters.length) {
    return;
  }

  const chosenTargetId = resolveAssassinationVote(room);
  const chosenTarget = requirePlayer(room, chosenTargetId);
  room.game.assassinTargetId = chosenTargetId;
  if (chosenTarget.role === "merlin") {
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
  renumberBots(room);
}

export function buildRoomView(room: RoomInternal, viewerId: string): RoomView {
  const viewer = room.players.get(viewerId) || null;
  const game = room.game;
  const playerCount = room.players.size;
  const rolesAreRevealed = game.phase === "finished";
  const publicEvilPlayerIds =
    game.phase === "assassination" || game.phase === "finished"
      ? orderedPlayers(room)
          .filter((player) => player.role && playerAllegiance(room, player) === "evil")
          .map((player) => player.id)
      : [];
  const assassin = Array.from(room.players.values()).find((player) => player.role === "assassin") || null;
  const revealedRoles = rolesAreRevealed
    ? Object.fromEntries(Array.from(room.players.values()).map((player) => [player.id, player.role!]))
    : null;
  const canSeeAssassinationVotes = rolesAreRevealed || (game.phase === "assassination" && Boolean(viewer?.role) && playerAllegiance(room, viewer!) === "evil");

  return {
    roomCode: room.code,
    ladyEnabledSetting: room.ladyEnabledSetting,
    ladyHolderModeSetting: room.ladyHolderModeSetting,
    lancelotEnabledSetting: room.lancelotEnabledSetting,
    excaliburEnabledSetting: room.excaliburEnabledSetting,
    botAiSetting: toPublicBotAiSetting(room.botAiSetting),
    idleWarningAt: room.lastActivityAt + IDLE_WARNING_MS,
    idleTimeoutAt: room.lastActivityAt + IDLE_TIMEOUT_MS,
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
      botOpinions: [...game.botOpinions],
      winner: game.winner,
      winReason: game.winReason,
      assassinId: rolesAreRevealed ? assassin?.id || null : null,
      assassinTargetId: game.assassinTargetId,
      assassinationVotes: canSeeAssassinationVotes ? { ...game.assassinationVotes } : {},
      assassinationVotesSubmitted: Object.keys(game.assassinationVotes),
      assassinationVoteCount: assassinationVoters(room).length,
      excaliburEnabled: game.excaliburEnabled,
      excaliburHolderId: game.excaliburHolderId,
      excaliburTargetId: game.excaliburTargetId,
      excaliburVotes: viewer?.id === game.excaliburHolderId ? { ...game.missionVotes } : null,
      ladyEnabled: game.ladyEnabled,
      ladyHolderId: game.ladyHolderId,
      ladyUsedPlayerIds: [...game.ladyUsedPlayerIds],
      ladyInspections: [...game.ladyInspections],
      lancelotEnabled: game.lancelotEnabled,
      lancelotDraws: [...game.lancelotDraws],
      lancelotDeckRemaining: game.lancelotDeck.length
    },
    yourRole: viewer?.role || null,
    yourAllegiance: viewer?.role ? playerAllegiance(room, viewer) : null,
    roleKnowledge: viewer?.role ? buildKnowledge(room, viewer.id, viewer.role) : [],
    ladyResult: viewer ? game.ladyResults[viewer.id] || null : null,
    ladyPendingResult: viewer ? visibleLadyPendingResult(room, viewer) : null,
    publicEvilPlayerIds,
    revealedRoles
  };
}

export function buildAdminRoomView(room: RoomInternal): RoomView {
  const view = buildRoomView(room, "__admin__");
  return {
    ...view,
    game: {
      ...view.game,
      assassinationVotes: { ...room.game.assassinationVotes }
    },
    you: null,
    yourRole: null,
    yourAllegiance: null,
    roleKnowledge: [],
    ladyResult: null,
    ladyPendingResult: null,
    publicEvilPlayerIds: orderedPlayers(room)
      .filter((player) => player.role && playerAllegiance(room, player) === "evil")
      .map((player) => player.id),
    revealedRoles: Object.fromEntries(
      orderedPlayers(room)
        .filter((player) => player.role)
        .map((player) => [player.id, player.role!])
    )
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

export async function runBotActionsForServer(room: RoomInternal): Promise<boolean> {
  let changed = false;
  for (let count = 0; count < 30; count += 1) {
    const acted = await runOneBotActionForServer(room);
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
          .filter((player) => player.id !== viewerId && player.role && playerAllegiance(room, player) === "evil" && player.role !== "oberon")
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

function addBotOpinion(
  room: RoomInternal,
  player: PlayerInternal,
  phase: BotOpinion["phase"],
  message: string,
  source: BotOpinion["source"] = "rules"
): void {
  const cleaned = message.trim();
  if (!cleaned || isBotOpinionBurstFull(room, phase)) {
    return;
  }
  room.game.botOpinions.push({
    id: room.game.botOpinions.length + 1,
    playerId: player.id,
    phase,
    message: cleaned,
    source
  });
  if (room.game.botOpinions.length > 12) {
    room.game.botOpinions = room.game.botOpinions.slice(-12);
  }
}

function isBotOpinionBurstFull(room: RoomInternal, phase: BotOpinion["phase"]): boolean {
  const limit: Record<BotOpinion["phase"], number> = {
    "team-building": 1,
    "team-vote": 2,
    mission: 2,
    lady: 1,
    assassination: 3,
    excalibur: 1
  };
  let recentSamePhase = 0;
  for (let index = room.game.botOpinions.length - 1; index >= 0; index -= 1) {
    if (room.game.botOpinions[index].phase !== phase) {
      break;
    }
    recentSamePhase += 1;
  }
  return recentSamePhase >= limit[phase];
}

function shouldShareBotTeamVoteOpinion(room: RoomInternal, bot: PlayerInternal, approve: boolean): boolean {
  const team = room.game.proposedTeam.map((id) => room.players.get(id)).filter(Boolean) as PlayerInternal[];
  const knownEvil = knownEvilIds(room, bot);
  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);
  const hasPrivateRead = team.some((player) => privateGood.has(player.id) || privateEvil.has(player.id));
  const hasKnownIssue = team.some((player) => knownEvil.has(player.id) || privateEvil.has(player.id));
  const hasSuspiciousIssue = team.some((player) => player.id !== bot.id && botSuspicionScore(room, bot, player) >= 1);
  const protectingKeyLine = bot.role === "percival" && Boolean(deducedMerlinIdForPercival(room, bot));
  const critical = isCriticalMoment(room);

  if (!approve) {
    if (hasPrivateRead || hasKnownIssue || protectingKeyLine) {
      return chance(0.82);
    }
    return chance(critical || hasSuspiciousIssue ? 0.68 : 0.48);
  }
  if (hasPrivateRead || protectingKeyLine || hasKnownIssue) {
    return chance(0.66);
  }
  if (critical && hasSuspiciousIssue) {
    return chance(0.42);
  }
  return chance(0.2);
}

function addMissionResultBotOpinions(room: RoomInternal, quest: QuestResult): void {
  const candidates = orderedPlayers(room).filter((player) => player.isBot);
  if (candidates.length === 0) {
    return;
  }

  const speakers = [...candidates]
    .sort((first, second) => botMissionCommentPriority(room, second, quest) - botMissionCommentPriority(room, first, quest))
    .slice(0, !quest.success && (quest.failCount >= 2 || isCriticalMoment(room)) && chance(0.38) ? 2 : 1);

  for (const speaker of speakers) {
    if (!quest.success || (isCriticalMoment(room) && chance(0.46)) || chance(0.22)) {
      addBotOpinion(room, speaker, "mission", botMissionResultOpinion(room, speaker, quest));
    }
  }
}

function botMissionCommentPriority(room: RoomInternal, bot: PlayerInternal, quest: QuestResult): number {
  const team = quest.team.map((id) => room.players.get(id)).filter(Boolean) as PlayerInternal[];
  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);
  let score = quest.success ? 0.6 : 1.4;
  if (team.some((player) => player.id === bot.id)) {
    score += 0.45;
  }
  if (team.some((player) => privateGood.has(player.id) || privateEvil.has(player.id))) {
    score += 1.2;
  }
  if (bot.role === "merlin" || bot.role === "percival") {
    score += 0.55;
  }
  return score + Math.random() * 0.4;
}

function botMissionResultOpinion(room: RoomInternal, bot: PlayerInternal, quest: QuestResult): string {
  const teamNames = quest.team.map((id) => room.players.get(id)?.name || "未知").join("、");
  const trustedNames = quest.team
    .filter((id) => privateLadyGoodIds(room, bot).has(id) || id === deducedMerlinIdForPercival(room, bot))
    .map((id) => room.players.get(id)?.name || "未知")
    .join("、");
  const isGoodPerspective = !bot.role || playerAllegiance(room, bot) === "good";
  const flaggedNames = quest.team
    .filter((id) => {
      const player = room.players.get(id);
      if (!player) {
        return false;
      }
      if (isGoodPerspective) {
        return privateLadyEvilIds(room, bot).has(id) || knownEvilIds(room, bot).has(id);
      }
      return player.id !== bot.id && (!player.role || playerAllegiance(room, player) === "good");
    })
    .map((id) => room.players.get(id)?.name || "未知")
    .join("、");

  if (quest.success) {
    if (trustedNames) {
      return pickLine([`這次成功，我會先保留 ${trustedNames} 這條線。`, `${trustedNames} 這條線目前可以加分。`, `這輪成功後，${trustedNames} 我會先放前面。`]);
    }
    return pickLine([`這次成功，${teamNames} 先加一點分。`, `成功局先記下來，後面對票型。`, `這隊過了，暫時不要急著拆。`]);
  }

  if (flaggedNames) {
    return pickLine([`任務失敗，我會優先盯 ${flaggedNames}。`, `${flaggedNames} 這條線要先避開。`, `這次失敗後，${flaggedNames} 不能輕放。`]);
  }
  if (quest.failCount >= 2) {
    return pickLine([`兩張失敗，這隊不只一個位置有問題。`, `這輪炸得太重，隊伍要整組重看。`, `兩張失敗代表這條線很髒。`]);
  }
  return pickLine([`任務失敗，這隊裡至少要挑一個出來。`, `這次失敗先從隊伍交集看。`, `失敗局先別急，下一隊要避開重複風險。`]);
}

function maybeDrawLancelotCard(room: RoomInternal, completedQuestIndex: number): void {
  if (!room.game.lancelotEnabled || completedQuestIndex < 1 || room.game.lancelotDeck.length === 0) {
    return;
  }

  const card = room.game.lancelotDeck.shift()!;
  const switched = card === "switch";
  if (switched) {
    for (const player of orderedPlayers(room)) {
      if (isLancelotRole(player.role)) {
        room.game.lancelotAllegiances[player.id] = playerAllegiance(room, player) === "good" ? "evil" : "good";
      }
    }
  }

  room.game.lancelotDraws.push({
    questIndex: completedQuestIndex,
    card,
    switched
  });
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
  const holderId = room.game.ladyHolderId;
  return (
    room.game.ladyEnabled &&
    completedQuestIndex >= 1 &&
    completedQuestIndex <= 3 &&
    room.game.ladyUsedPlayerIds.length < room.players.size &&
    Boolean(holderId) &&
    availableLadyTargets(room, holderId!).length > 0
  );
}

function initialLadyHolderId(room: RoomInternal, order: string[]): string | null {
  if (order.length === 0) {
    return null;
  }
  if (room.ladyHolderModeSetting === "random") {
    return order[Math.floor(Math.random() * order.length)];
  }
  return order[order.length - 1];
}

function runOneBotAction(room: RoomInternal): boolean {
  if (room.game.phase === "team-building") {
    const leaderId = currentLeaderId(room);
    const leader = leaderId ? room.players.get(leaderId) : null;
    if (leader?.isBot) {
      const team = chooseBotTeam(room, leader);
      proposeTeam(room, leader.id, team, room.game.excaliburEnabled ? chooseBotExcaliburHolder(room, leader, team) : null);
      addBotOpinion(room, leader, "team-building", botProposeTeamOpinion(room, leader, team));
      return true;
    }
  }

  if (room.game.phase === "team-vote") {
    const bot = Array.from(room.players.values()).find((player) => player.isBot && room.game.teamVotes[player.id] === undefined);
    if (bot) {
      const approve = chooseBotTeamVote(room, bot);
      const opinion = botTeamVoteOpinion(room, bot, approve);
      const shouldShare = shouldShareBotTeamVoteOpinion(room, bot, approve);
      castTeamVote(room, bot.id, approve);
      if (shouldShare) {
        addBotOpinion(room, bot, "team-vote", opinion);
      }
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

  if (room.game.phase === "excalibur") {
    const holder = room.game.excaliburHolderId ? room.players.get(room.game.excaliburHolderId) : null;
    if (holder?.isBot) {
      const targetId = chooseBotExcaliburTarget(room, holder);
      useExcalibur(room, holder.id, targetId);
      addBotOpinion(
        room,
        holder,
        "excalibur",
        botExcaliburOpinion(room, targetId)
      );
      return true;
    }
  }

  if (room.game.phase === "lady") {
    if (skipLadyIfNoTargets(room)) {
      return true;
    }
    const holder = room.game.ladyHolderId ? room.players.get(room.game.ladyHolderId) : null;
    if (holder?.isBot) {
      const targetId = chooseBotLadyTarget(room, holder);
      const target = room.players.get(targetId)!;
      const announcement = chooseBotLadyAnnouncement(room, holder, target, playerAllegiance(room, target));
      useLadyOfLake(room, holder.id, targetId, announcement);
      addBotOpinion(room, holder, "lady", botLadyOpinion(room, target, announcement));
      return true;
    }
  }

  if (room.game.phase === "assassination") {
    const bot = assassinationVoters(room).find((player) => player.isBot && room.game.assassinationVotes[player.id] === undefined);
    if (bot) {
      const targetId = chooseBotAssassinationTarget(room, bot);
      addBotOpinion(room, bot, "assassination", botAssassinationOpinion(room, targetId));
      assassinate(room, bot.id, targetId);
      return true;
    }
  }

  return false;
}

async function runOneBotActionForServer(room: RoomInternal): Promise<boolean> {
  if (room.game.phase === "team-building") {
    const leaderId = currentLeaderId(room);
    const leader = leaderId ? room.players.get(leaderId) : null;
    if (leader?.isBot) {
      const apiTeam = await chooseApiBotTeam(room, leader);
      if (room.game.phase !== "team-building" || currentLeaderId(room) !== leader.id || !room.players.has(leader.id)) {
        return false;
      }
      const team = apiTeam?.teamIds || chooseBotTeam(room, leader);
      const excaliburHolderId =
        room.game.excaliburEnabled ? apiTeam?.excaliburHolderId || chooseBotExcaliburHolder(room, leader, team) : null;
      proposeTeam(room, leader.id, team, excaliburHolderId);
      addBotOpinion(room, leader, "team-building", apiTeam?.message || botProposeTeamOpinion(room, leader, team), apiTeam ? "api" : "rules");
      return true;
    }
  }

  if (room.game.phase === "team-vote") {
    const bot = Array.from(room.players.values()).find(
      (player) => player.isBot && room.game.teamVotes[player.id] === undefined && !shouldBotWaitForMoreTeamVotes(room, player)
    );
    if (bot) {
      const proposedTeamKey = room.game.proposedTeam.join("|");
      const voteHistoryLength = room.game.voteHistory.length;
      const failedVoteCount = room.game.failedVoteCount;
      const apiVote = await chooseApiBotTeamVote(room, bot);
      if (
        room.game.phase !== "team-vote" ||
        room.game.teamVotes[bot.id] !== undefined ||
        room.game.proposedTeam.join("|") !== proposedTeamKey ||
        room.game.voteHistory.length !== voteHistoryLength ||
        room.game.failedVoteCount !== failedVoteCount
      ) {
        return false;
      }
      let approve = apiVote?.approve ?? chooseBotTeamVote(room, bot);
      if (!approve && currentLeaderId(room) === bot.id && chance(0.86)) {
        approve = true;
      }
      const opinion = apiVote?.message || botTeamVoteOpinion(room, bot, approve);
      const shouldShare = shouldShareBotTeamVoteOpinion(room, bot, approve);
      castTeamVote(room, bot.id, approve);
      if (apiVote || shouldShare) {
        addBotOpinion(room, bot, "team-vote", opinion, apiVote ? "api" : "rules");
      }
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

  if (room.game.phase === "excalibur") {
    const holder = room.game.excaliburHolderId ? room.players.get(room.game.excaliburHolderId) : null;
    if (holder?.isBot) {
      const holderId = holder.id;
      const proposedTeamKey = room.game.proposedTeam.join("|");
      const apiChoice = await chooseApiBotExcaliburTarget(room, holder);
      if (room.game.phase !== "excalibur" || room.game.excaliburHolderId !== holderId || room.game.proposedTeam.join("|") !== proposedTeamKey) {
        return false;
      }
      const targetId = apiChoice ? apiChoice.targetId : chooseBotExcaliburTarget(room, holder);
      useExcalibur(room, holder.id, targetId);
      addBotOpinion(
        room,
        holder,
        "excalibur",
        apiChoice?.message || botExcaliburOpinion(room, targetId),
        apiChoice ? "api" : "rules"
      );
      return true;
    }
  }

  if (room.game.phase === "lady") {
    if (skipLadyIfNoTargets(room)) {
      return true;
    }
    const holder = room.game.ladyHolderId ? room.players.get(room.game.ladyHolderId) : null;
    if (holder?.isBot) {
      const holderId = holder.id;
      const targetId = chooseBotLadyTarget(room, holder);
      const target = room.players.get(targetId)!;
      const apiChoice = await chooseApiBotLadyAnnouncement(room, holder, target, playerAllegiance(room, target));
      if (room.game.phase !== "lady" || room.game.ladyHolderId !== holderId || room.game.ladyPendingResult) {
        return false;
      }
      const announcement = apiChoice?.announcement || chooseBotLadyAnnouncement(room, holder, target, playerAllegiance(room, target));
      useLadyOfLake(room, holder.id, targetId, announcement);
      addBotOpinion(room, holder, "lady", apiChoice?.message || botLadyOpinion(room, target, announcement), apiChoice ? "api" : "rules");
      return true;
    }
  }

  if (room.game.phase === "assassination") {
    const bot = assassinationVoters(room).find((player) => player.isBot && room.game.assassinationVotes[player.id] === undefined);
    if (bot) {
      const apiChoice = await chooseApiBotAssassinationTarget(room, bot);
      if (room.game.phase !== "assassination" || room.game.assassinationVotes[bot.id] !== undefined) {
        return false;
      }
      const targetId = apiChoice?.targetId || chooseBotAssassinationTarget(room, bot);
      addBotOpinion(room, bot, "assassination", apiChoice?.message || botAssassinationOpinion(room, targetId), apiChoice ? "api" : "rules");
      assassinate(room, bot.id, targetId);
      return true;
    }
  }

  return false;
}

function chooseBotTeam(room: RoomInternal, bot: PlayerInternal): string[] {
  const size = currentTeamSize(room);
  const team: string[] = [];
  const add = (player?: PlayerInternal) => {
    if (player && !team.includes(player.id) && team.length < size) {
      team.push(player.id);
    }
  };

  if (chance(bot.role && playerAllegiance(room, bot) === "evil" ? 0.72 : 0.88)) {
    add(bot);
  }

  rankBotTeamCandidates(room, bot).forEach(add);
  orderedPlayers(room).forEach(add);
  return team.slice(0, size);
}

function shouldBotWaitForMoreTeamVotes(room: RoomInternal, bot: PlayerInternal): boolean {
  if (room.game.phase !== "team-vote" || room.game.teamVotes[bot.id] !== undefined) {
    return false;
  }

  const submittedCount = Object.keys(room.game.teamVotes).length;
  const halfTable = Math.ceil(room.players.size / 2);
  if (submittedCount >= halfTable) {
    return false;
  }

  const hasUnvotedHuman = Array.from(room.players.values()).some((player) => !player.isBot && room.game.teamVotes[player.id] === undefined);
  return hasUnvotedHuman;
}

function submittedTeamVoteInfluence(room: RoomInternal, bot: PlayerInternal): { score: number; names: string[] } {
  let score = 0;
  const names: string[] = [];

  for (const [voterId, approve] of Object.entries(room.game.teamVotes)) {
    if (voterId === bot.id) {
      continue;
    }
    const voter = room.players.get(voterId);
    if (!voter) {
      continue;
    }

    const weight = teamVoteInfluenceWeight(room, bot, voter);
    if (weight === 0) {
      continue;
    }
    score += approve ? weight : -weight;
    if (Math.abs(weight) >= 0.75 && names.length < 2) {
      names.push(voter.name);
    }
  }

  return { score, names };
}

function teamVoteInfluenceWeight(room: RoomInternal, bot: PlayerInternal, voter: PlayerInternal): number {
  if (!bot.role || !voter.role) {
    return 0;
  }

  const knownEvil = knownEvilIds(room, bot);
  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);

  if (playerAllegiance(room, bot) === "evil") {
    if (knownEvil.has(voter.id)) {
      return 1.05;
    }
    return publicGoodLeanScore(room, bot, voter) >= 0.75 ? 0.32 : 0;
  }

  if (privateGood.has(voter.id)) {
    return 1.45;
  }
  if (privateEvil.has(voter.id) || knownEvil.has(voter.id)) {
    return -1.25;
  }
  if (bot.role === "percival") {
    const protectedMerlinId = deducedMerlinIdForPercival(room, bot);
    const exposedMorganaId = exposedMorganaIdForPercival(room, bot);
    if (voter.id === protectedMerlinId) {
      return 1.9;
    }
    if (voter.id === exposedMorganaId) {
      return -1.45;
    }
    if (voter.role === "merlin" || voter.role === "morgana") {
      return 0.65;
    }
  }

  const publicLean = publicGoodLeanScore(room, bot, voter);
  if (publicLean >= 0.9) {
    return 0.72;
  }
  if (botSuspicionScore(room, bot, voter) >= 2.2) {
    return -0.48;
  }
  return 0;
}

function chooseBotTeamVote(room: RoomInternal, bot: PlayerInternal): boolean {
  const team = room.game.proposedTeam.map((id) => room.players.get(id)).filter(Boolean) as PlayerInternal[];
  const teamIds = team.map((player) => player.id);
  const selfOnTeam = team.some((player) => player.id === bot.id);
  const suspiciousCount = team.filter((player) => player.id !== bot.id && botSuspicionScore(room, bot, player) >= 1).length;
  const knownEvil = knownEvilIds(room, bot);
  const knownEvilCount = team.filter((player) => knownEvil.has(player.id)).length;
  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);
  const goodNudge = goodProtectionPoolIds(room, bot);
  const trustedGoodOnTeam = team.some((player) => privateGood.has(player.id) || goodNudge.has(player.id));
  const nudgeGoodCount = team.filter((player) => goodNudge.has(player.id)).length;
  const strongNudgeTeam = nudgeGoodCount >= Math.max(1, Math.min(team.length, currentTeamSize(room) - 1));
  const condemnedOnTeam = team.some((player) => privateEvil.has(player.id));
  const critical = isCriticalMoment(room);
  const opening = isOpeningRound(room);
  const proposedBySelf = currentLeaderId(room) === bot.id;
  const carryoverRisk = failedTeamCarryoverRisk(room, bot, teamIds);
  const voteInfluence = submittedTeamVoteInfluence(room, bot);

  if (proposedBySelf) {
    if (bot.role && playerAllegiance(room, bot) === "evil") {
      return chance(selfOnTeam ? 0.95 : critical ? 0.88 : 0.82);
    }
    if (knownEvilCount > 0 || condemnedOnTeam) {
      return chance(opening ? 0.7 : critical ? 0.42 : 0.58);
    }
    if (suspiciousCount > 1) {
      return chance(critical ? 0.62 : 0.76);
    }
    return chance(selfOnTeam || trustedGoodOnTeam || strongNudgeTeam ? 0.96 : 0.88);
  }

  if (voteInfluence.score <= -1.25 && (!bot.role || playerAllegiance(room, bot) === "good")) {
    return chance(opening ? 0.34 : critical ? 0.1 : 0.2);
  }

  if (voteInfluence.score >= 1.25 && (!bot.role || playerAllegiance(room, bot) === "good")) {
    return chance(critical ? 0.82 : 0.92);
  }

  if (room.game.failedVoteCount >= 4 && (!bot.role || playerAllegiance(room, bot) === "good")) {
    const hardIssue = knownEvilCount > 0 || condemnedOnTeam || suspiciousCount >= 2 || carryoverRisk >= 1.35;
    return chance(hardIssue ? 0.42 : 0.98);
  }

  if (bot.role && playerAllegiance(room, bot) === "evil") {
    const evilOnTeam = team.some((player) => knownEvil.has(player.id));
    if (evilOnTeam) {
      return chance(selfOnTeam ? 0.92 : critical ? 0.86 : 0.78);
    }
    if (room.game.failedVoteCount >= 4) {
      return chance(0.05);
    }
    if (suspiciousCount > 0) {
      return chance(critical ? 0.42 : 0.58);
    }
    return chance(opening ? 0.46 : critical ? 0.12 : 0.32);
  }

  if ((!bot.role || playerAllegiance(room, bot) === "good") && carryoverRisk >= 1.35 && !trustedGoodOnTeam && !strongNudgeTeam) {
    return chance(critical ? 0.08 : 0.22);
  }

  if (bot.role === "merlin") {
    if (knownEvilCount > 0 || condemnedOnTeam) {
      if (opening) {
        return chance(knownEvilCount + (condemnedOnTeam ? 1 : 0) >= 2 ? 0.28 : 0.52);
      }
      return chance(knownEvilCount + (condemnedOnTeam ? 1 : 0) >= 2 ? 0.08 : critical ? 0.16 : 0.34);
    }
    if (suspiciousCount > 0) {
      return chance(selfOnTeam || trustedGoodOnTeam ? (critical ? 0.62 : 0.76) : critical ? 0.34 : 0.58);
    }
    return chance(selfOnTeam || trustedGoodOnTeam ? 0.92 : 0.82);
  }

  if (bot.role === "percival") {
    const protectedMerlinId = deducedMerlinIdForPercival(room, bot);
    const exposedMorganaId = exposedMorganaIdForPercival(room, bot);
    const protectedMerlinOnTeam = protectedMerlinId ? team.some((player) => player.id === protectedMerlinId) : false;
    const exposedMorganaOnTeam = exposedMorganaId ? team.some((player) => player.id === exposedMorganaId) : false;
    const candidateOnTeam = team.some((player) => player.role === "merlin" || player.role === "morgana");
    if (exposedMorganaOnTeam || condemnedOnTeam) {
      return chance(opening ? 0.36 : critical ? 0.08 : 0.2);
    }
    if (suspiciousCount > 0) {
      return chance(
        protectedMerlinOnTeam || trustedGoodOnTeam ? (critical ? 0.6 : 0.72) : candidateOnTeam ? (critical ? 0.46 : 0.58) : critical ? 0.24 : 0.38
      );
    }
    return chance(protectedMerlinOnTeam || trustedGoodOnTeam ? 0.92 : candidateOnTeam ? (opening ? 0.9 : 0.82) : critical ? 0.62 : 0.72);
  }

  if (condemnedOnTeam) {
    return chance(opening ? 0.28 : critical ? 0.04 : 0.16);
  }

  if (suspiciousCount > 0) {
    return chance(
      selfOnTeam || trustedGoodOnTeam ? (critical ? 0.48 : 0.62) : Math.max(critical ? 0.08 : 0.18, 0.44 - suspiciousCount * (critical ? 0.18 : 0.12))
    );
  }
  return chance(selfOnTeam || trustedGoodOnTeam || strongNudgeTeam ? 0.9 : opening ? 0.82 : 0.74);
}

function botTeamVoteOpinion(room: RoomInternal, bot: PlayerInternal, approve = false): string {
  const teamNames = room.game.proposedTeam.map((id) => room.players.get(id)?.name || "未知").join("、");
  const carryoverRisk = failedTeamCarryoverRisk(room, bot, room.game.proposedTeam);
  const voteInfluence = submittedTeamVoteInfluence(room, bot);
  const otherTeamNames =
    room.game.proposedTeam
      .filter((id) => id !== bot.id)
      .map((id) => room.players.get(id)?.name || "未知")
      .join("、") || teamNames;
  const knownEvil = knownEvilIds(room, bot);
  const condemned = privateLadyEvilIds(room, bot);
  const trustedGood = privateLadyGoodIds(room, bot);
  const protectedMerlinId = bot.role === "percival" ? deducedMerlinIdForPercival(room, bot) : null;
  const exposedMorganaId = bot.role === "percival" ? exposedMorganaIdForPercival(room, bot) : null;
  const protectedRejectionSuspects = bot.role === "percival" ? percivalProtectedRejectionSuspectIds(room, bot) : new Set<string>();
  const trustedOnTeam = room.game.proposedTeam
    .filter((id) => trustedGood.has(id) || id === protectedMerlinId)
    .map((id) => room.players.get(id)?.name || "未知");
  const protectedSuspiciousOnTeam = room.game.proposedTeam
    .filter((id) => id !== bot.id && id !== protectedMerlinId && protectedRejectionSuspects.has(id))
    .map((id) => room.players.get(id)?.name || "未知");
  const directFlaggedOnTeam = room.game.proposedTeam
    .filter((id) => condemned.has(id) || id === exposedMorganaId)
    .map((id) => room.players.get(id)?.name || "未知");
  const flaggedOnTeam =
    directFlaggedOnTeam.length > 0 || bot.role !== "merlin"
      ? (directFlaggedOnTeam.length > 0
          ? directFlaggedOnTeam
          : room.game.proposedTeam.filter((id) => knownEvil.has(id)).map((id) => room.players.get(id)?.name || "未知"))
      : [];
  const hasKnownIssue = room.game.proposedTeam.some((id) => knownEvil.has(id) || condemned.has(id));
  const hasSuspiciousIssue = room.game.proposedTeam.some((id) => {
    const player = room.players.get(id);
    return player && player.id !== bot.id && botSuspicionScore(room, bot, player) >= 1;
  });
  if (approve) {
    if (room.game.failedVoteCount >= 4 && (!bot.role || playerAllegiance(room, bot) === "good")) {
      return pickLine([`已經尾派了，這隊沒有硬傷就先過。`, `再否決就太危險，先讓任務給資訊。`, `尾派我會保守一點，先讓它跑。`]);
    }
    if (playerAllegiance(room, bot) === "evil") {
      return pickLine([
        `這隊可以先跑，資訊會更清楚。`,
        `我可以接受 ${teamNames}，先讓任務給答案。`,
        `這組暫時說得過去，先通過看結果。`
      ]);
    }
    if (trustedOnTeam.length > 0) {
      const names = trustedOnTeam.join("、");
      if (protectedSuspiciousOnTeam.length === 0) {
        return pickLine([`我想保留 ${names} 這條線。`, `${names} 目前我願意放進隊伍。`, `這隊有我信得過的位置，可以跑。`]);
      }
      return pickLine([`有 ${names} 在，我先看這隊能不能洗乾淨。`, `${names} 這條線值得保留，但結果要記清楚。`]);
    }
    if (hasKnownIssue) {
      return pickLine([`我先不把話說死，這隊跑完會有更多資訊。`, `這組有風險，但現在先看結果。`]);
    }
    if (carryoverRisk <= -0.35) {
      return pickLine([`這隊有把前面的失敗組合拆開，可以看。`, `這組有換掉前面比較髒的位置，先跑。`, `前面那隊有調整過，我先給過。`]);
    }
    if (voteInfluence.score >= 1.25 && voteInfluence.names.length > 0) {
      return pickLine([`前面 ${voteInfluence.names.join("、")} 的票我會參考，先過。`, `有我願意參考的票先站這邊。`, `前面幾票方向一致，我先同意。`]);
    }
    return pickLine([`這隊目前看起來可以先跑。`, `我同意這組，資訊線比較乾淨。`, `先讓這隊執行，後面再對紀錄。`]);
  }
  if (voteInfluence.score <= -1.25 && playerAllegiance(room, bot) === "good") {
    return pickLine([`我跟前面可信的反對票走，這隊先擋。`, `前面有人已經擋這隊，我先不放過。`, `這隊既然被關鍵票擋住，我先反對。`]);
  }
  if (carryoverRisk >= 1.25 && playerAllegiance(room, bot) === "good") {
    return pickLine([`上一隊失敗，這隊改動不夠，我先擋。`, `這組跟前面失敗隊重疊太多，我反對。`, `前面的問題還沒拆開，這隊我不放。`]);
  }
  if (flaggedOnTeam.length > 0 && playerAllegiance(room, bot) === "good") {
    const names = flaggedOnTeam.join("、");
    return pickLine([`我不想讓 ${names} 進這輪。`, `${names} 這個位置我先避開。`, `這隊卡在 ${names}，我會反對。`]);
  }
  if (protectedSuspiciousOnTeam.length > 0 && playerAllegiance(room, bot) === "good") {
    const names = protectedSuspiciousOnTeam.join("、");
    return pickLine([
      `我想沿著上一輪反對票看，先避開 ${names}。`,
      `${names} 跟前面失敗局有交集，我先擋。`,
      `這隊又碰到 ${names}，我不想放過。`
    ]);
  }
  if ((hasKnownIssue || hasSuspiciousIssue) && playerAllegiance(room, bot) === "good") {
    return pickLine([
      `我反對這隊，${otherTeamNames} 裡有我不放心的位置。`,
      `這隊我不想放過，裡面有需要避開的人。`,
      `我不喜歡這組的資訊組合，先反對。`,
      `這組目前風險偏高，我想換一隊。`
    ]);
  }
  if (playerAllegiance(room, bot) === "evil") {
    const frameTarget = room.game.proposedTeam
      .map((id) => room.players.get(id))
      .find((player): player is PlayerInternal => Boolean(player && player.id !== bot.id && player.role && playerAllegiance(room, player) === "good"));
    return isCriticalMoment(room)
      ? pickLine([
          `這隊在關鍵局風險太高，我想再換一組。`,
          `這回合我會保守一點，先反對。`,
          frameTarget ? `${frameTarget.name} 那條線我還沒買單。` : `這隊過了不好回頭，我先擋一下。`
        ])
      : pickLine([
          `我先反對，這隊資訊還不夠乾淨。`,
          `我想看隊長換另一種組合。`,
          frameTarget ? `${frameTarget.name} 的票型我想再觀察。` : `這組我暫時不買單。`
        ]);
  }
  if (room.game.failedVoteCount >= 3) {
    return pickLine([`否決快到危險線，但這隊我還是不放心。`, `再否決有壓力，可是這組我覺得更危險。`]);
  }
  return pickLine([`我反對這隊，想看隊長換更乾淨的組合。`, `這組資訊不夠穩，我先投反對。`, `我會先壓一票反對，看看下一組。`]);
}

function botProposeTeamOpinion(room: RoomInternal, bot: PlayerInternal, teamIds: string[]): string {
  const teamNames = teamIds.map((id) => room.players.get(id)?.name || "未知").join("、");
  if (playerAllegiance(room, bot) === "evil") {
    const coverTarget = teamIds
      .map((id) => room.players.get(id))
      .find((player): player is PlayerInternal => Boolean(player && player.id !== bot.id && player.role && playerAllegiance(room, player) === "evil"));
    return pickLine([
      `我先派 ${teamNames}，讓這輪有資訊。`,
      coverTarget ? `我想保留 ${coverTarget.name} 這條線，先跑。` : `這組可以測一下場上的反應。`,
      `先用這隊推進，後面再看票型。`
    ]);
  }
  if (bot.role === "percival") {
    const protectedId = deducedMerlinIdForPercival(room, bot);
    const exposedId = exposedMorganaIdForPercival(room, bot);
    const protectedName = protectedId && teamIds.includes(protectedId) ? room.players.get(protectedId)?.name : null;
    const exposedName = exposedId && teamIds.includes(exposedId) ? room.players.get(exposedId)?.name : null;
    const suspectNames = teamIds
      .filter((id) => id !== bot.id && id !== protectedId && percivalProtectedRejectionSuspectIds(room, bot).has(id))
      .map((id) => room.players.get(id)?.name || "未知")
      .join("、");
    if (protectedName && !exposedName) {
      if (suspectNames) {
        return pickLine([`我保留 ${protectedName}，但 ${suspectNames} 這條要驗清楚。`, `這隊先保留 ${protectedName}，順便看 ${suspectNames}。`]);
      }
      return pickLine([`我想保留 ${protectedName} 這條線，先派這組。`, `${protectedName} 目前我會放進乾淨線。`, `這組有可用的線，先跑。`]);
    }
  }
  const trustedNames = teamIds
    .filter((id) => privateLadyGoodIds(room, bot).has(id))
    .map((id) => room.players.get(id)?.name || "未知")
    .join("、");
  if (trustedNames) {
    return pickLine([`我把 ${trustedNames} 留在隊伍裡，先看結果。`, `${trustedNames} 這條線目前比較穩。`, `這組有可用的乾淨線，先派。`]);
  }
  return pickLine([`我先派 ${teamNames}，這組目前比較穩。`, `這隊的紀錄相對乾淨，先試。`, `我想用這組確認任務結果。`]);
}

function botExcaliburOpinion(room: RoomInternal, targetId: string | null): string {
  const targetName = targetId ? room.players.get(targetId)?.name || "一名隊員" : "";
  if (targetId) {
    return pickLine([
      `我想換掉 ${targetName} 的任務卡，看看結果會不會更合理。`,
      `王者之劍我會指向 ${targetName}，這樣資訊比較有價值。`,
      `我選擇動 ${targetName}，這張卡值得確認。`
    ]);
  }
  return pickLine([`我先不動王者之劍，保留原本任務卡。`, `這次不用劍，讓結果照原樣公開。`, `我不更換任務卡，避免把資訊洗亂。`]);
}

function botLadyOpinion(room: RoomInternal, target: PlayerInternal, announcement: Allegiance): string {
  const claim = announcement === "good" ? "好人" : "可疑";
  if (playerAllegiance(room, target) === announcement) {
    return pickLine([`我查看 ${target.name}，我的公開說法是${claim}。`, `${target.name} 的結果我會宣告成${claim}。`, `這次女神我會說 ${target.name} 是${claim}。`]);
  }
  return pickLine([`我查看 ${target.name}，我的公開說法是${claim}。`, `我會把 ${target.name} 先放在${claim}那邊。`, `女神這次我宣告 ${target.name} 是${claim}。`]);
}

function botAssassinationOpinion(room: RoomInternal, targetId: string): string {
  const targetName = room.players.get(targetId)?.name || "這名玩家";
  return pickLine([`我最後會投 ${targetName}。`, `我偏向猜 ${targetName}。`, `從票型和任務看，我會選 ${targetName}。`, `我的刺殺票會給 ${targetName}。`]);
}

function chooseBotMissionVote(room: RoomInternal, bot: PlayerInternal): boolean {
  if (!bot.role || playerAllegiance(room, bot) === "good") {
    return true;
  }
  const currentFailCount = Object.values(room.game.missionVotes).filter((value) => !value).length;
  if (currentFailCount >= currentFailThreshold(room)) {
    return true;
  }

  const evilFailures = room.game.quests.filter((quest) => !quest.success).length;
  const goodSuccesses = room.game.quests.filter((quest) => quest.success).length;
  const baseFailChance = bot.role === "oberon" ? 0.68 : bot.role === "mordred" ? 0.78 : 0.84;
  const pressure = evilFailures >= 2 || goodSuccesses >= 2 ? 0.12 : 0;
  const earlyRestraint = room.game.questIndex === 0 && room.game.proposedTeam.length > 2 ? -0.16 : 0;
  return !chance(Math.min(0.97, Math.max(0.45, baseFailChance + pressure + earlyRestraint)));
}

function chooseBotExcaliburHolder(room: RoomInternal, bot: PlayerInternal, teamIds: string[]): string | null {
  const candidates = teamIds
    .map((id) => room.players.get(id))
    .filter((player): player is PlayerInternal => Boolean(player && player.id !== bot.id));
  if (candidates.length === 0) {
    return null;
  }

  if (bot.role && playerAllegiance(room, bot) === "evil") {
    const evilCandidates = candidates.filter((player) => playerAllegiance(room, player) === "evil" && player.role !== "oberon");
    if (evilCandidates.length > 0) {
      return evilCandidates[Math.floor(Math.random() * evilCandidates.length)].id;
    }
    return [...candidates].sort((first, second) => botSuspicionScore(room, bot, first) - botSuspicionScore(room, bot, second))[0].id;
  }

  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);
  return [...candidates].sort((first, second) => {
    const firstScore = (privateGood.has(first.id) ? -2 : 0) + (privateEvil.has(first.id) ? 4 : 0) + botSuspicionScore(room, bot, first);
    const secondScore = (privateGood.has(second.id) ? -2 : 0) + (privateEvil.has(second.id) ? 4 : 0) + botSuspicionScore(room, bot, second);
    return firstScore - secondScore;
  })[0].id;
}

function chooseBotExcaliburTarget(room: RoomInternal, bot: PlayerInternal): string | null {
  const targets = room.game.proposedTeam
    .map((id) => room.players.get(id))
    .filter((player): player is PlayerInternal => Boolean(player && player.id !== bot.id && room.game.missionVotes[player.id] !== undefined));

  if (targets.length === 0) {
    return null;
  }

  if (bot.role && playerAllegiance(room, bot) === "evil") {
    const successTargets = targets.filter((player) => room.game.missionVotes[player.id]);
    const goodSuccessTargets = successTargets.filter((player) => playerAllegiance(room, player) === "good");
    const pool = goodSuccessTargets.length > 0 ? goodSuccessTargets : successTargets;
    if (pool.length === 0) {
      return null;
    }
    return chance(isCriticalMoment(room) ? 0.94 : 0.78) ? pool[Math.floor(Math.random() * pool.length)].id : null;
  }

  const failedTargets = targets.filter((player) => room.game.missionVotes[player.id] === false);
  if (failedTargets.length > 0) {
    return [...failedTargets].sort((first, second) => botSuspicionScore(room, bot, second) - botSuspicionScore(room, bot, first))[0].id;
  }

  return null;
}

function chooseBotAssassinationTarget(room: RoomInternal, bot: PlayerInternal): string {
  const candidates = orderedPlayers(room).filter((player) => player.role && playerAllegiance(room, player) === "good");
  const scored = candidates.map((player, index) => {
    let score = 0;
    score += assassinationReadScore(room, player);
    score += (Math.random() - 0.5) * 1.8;
    return { player, score, index };
  });
  scored.sort((first, second) => second.score - first.score || first.index - second.index);
  const poolSize = Math.min(scored.length, Math.max(2, scored.length - 1));
  return weightedAssassinationPick(scored.slice(0, poolSize)).player.id;
}

function weightedAssassinationPick(scored: Array<{ player: PlayerInternal; score: number; index: number }>): { player: PlayerInternal; score: number; index: number } {
  const temperature = 1.55;
  const maxScore = Math.max(...scored.map((item) => item.score));
  const weighted = scored.map((item) => ({
    item,
    weight: Math.exp((item.score - maxScore) / temperature)
  }));
  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const item of weighted) {
    roll -= item.weight;
    if (roll <= 0) {
      return item.item;
    }
  }
  return scored[0];
}

function chooseBotLadyTarget(room: RoomInternal, bot: PlayerInternal): string {
  const candidates = availableLadyTargets(room, bot.id);

  if (bot.role && playerAllegiance(room, bot) === "evil") {
    const goodTargets = candidates.filter((player) => player.role && playerAllegiance(room, player) === "good");
    const pool = goodTargets.length > 0 ? goodTargets : candidates;
    return pool[Math.floor(Math.random() * pool.length)].id;
  }

  const unknownCandidates = candidates.filter((player) => !knownEvilIds(room, bot).has(player.id));
  const pool = unknownCandidates.length > 0 ? unknownCandidates : candidates;
  return [...pool].sort((first, second) => botSuspicionScore(room, bot, second) - botSuspicionScore(room, bot, first))[0].id;
}

function chooseBotLadyAnnouncement(
  room: RoomInternal,
  bot: PlayerInternal,
  target: PlayerInternal,
  actualAllegiance: Allegiance
): Allegiance {
  if (!bot.role || playerAllegiance(room, bot) === "good") {
    return actualAllegiance;
  }
  if (target.role && playerAllegiance(room, target) === "evil") {
    return chance(0.94) ? "good" : "evil";
  }
  return chance(isCriticalMoment(room) ? 0.88 : 0.74) ? "evil" : "good";
}

type ApiTeamChoice = {
  teamIds: string[];
  excaliburHolderId: string | null;
  message: string | null;
};

type ApiTargetChoice = {
  targetId: string | null;
  message: string | null;
};

type ApiLadyChoice = {
  announcement: Allegiance;
  message: string | null;
};

type BotAiDecision = {
  approve?: boolean;
  teamIds?: string[];
  targetId?: string | null;
  excaliburHolderId?: string | null;
  announcement?: Allegiance;
  message?: string;
};

async function chooseApiBotTeam(room: RoomInternal, bot: PlayerInternal): Promise<ApiTeamChoice | null> {
  if (!shouldUseBotAi(room, bot)) {
    return null;
  }
  const decision = await requestBotAiDecision(room, bot, "propose-team");
  if (!decision?.teamIds) {
    return null;
  }

  const teamIds = Array.from(new Set(decision.teamIds)).filter((id) => room.players.has(id));
  if (teamIds.length !== currentTeamSize(room)) {
    return null;
  }

  const excaliburHolderId =
    room.game.excaliburEnabled && decision.excaliburHolderId && teamIds.includes(decision.excaliburHolderId) && decision.excaliburHolderId !== bot.id
      ? decision.excaliburHolderId
      : null;

  return {
    teamIds,
    excaliburHolderId,
    message: sanitizeBotSpeech(decision.message)
  };
}

async function chooseApiBotTeamVote(room: RoomInternal, bot: PlayerInternal): Promise<{ approve: boolean; message: string | null } | null> {
  if (!shouldUseBotAi(room, bot)) {
    return null;
  }
  const decision = await requestBotAiDecision(room, bot, "team-vote");
  if (typeof decision?.approve !== "boolean") {
    return null;
  }
  return {
    approve: decision.approve,
    message: sanitizeBotSpeech(decision.message)
  };
}

async function chooseApiBotExcaliburTarget(room: RoomInternal, bot: PlayerInternal): Promise<ApiTargetChoice | null> {
  if (!shouldUseBotAi(room, bot)) {
    return null;
  }
  const decision = await requestBotAiDecision(room, bot, "excalibur");
  if (decision?.targetId === null) {
    return { targetId: null, message: sanitizeBotSpeech(decision.message) };
  }
  if (decision?.targetId && room.game.proposedTeam.includes(decision.targetId) && decision.targetId !== bot.id) {
    return { targetId: decision.targetId, message: sanitizeBotSpeech(decision.message) };
  }
  return null;
}

async function chooseApiBotLadyAnnouncement(
  room: RoomInternal,
  bot: PlayerInternal,
  target: PlayerInternal,
  actualAllegiance: Allegiance
): Promise<ApiLadyChoice | null> {
  if (!shouldUseBotAi(room, bot)) {
    return null;
  }
  const decision = await requestBotAiDecision(room, bot, "lady", { ladyTargetId: target.id, actualAllegiance });
  const announcement = normalizeAllegiance(decision?.announcement);
  return announcement ? { announcement, message: sanitizeBotSpeech(decision?.message) } : null;
}

async function chooseApiBotAssassinationTarget(room: RoomInternal, bot: PlayerInternal): Promise<ApiTargetChoice | null> {
  if (!shouldUseBotAi(room, bot)) {
    return null;
  }
  const decision = await requestBotAiDecision(room, bot, "assassination");
  const target = decision?.targetId ? room.players.get(decision.targetId) : null;
  if (target?.role && playerAllegiance(room, target) === "good") {
    return { targetId: target.id, message: sanitizeBotSpeech(decision.message) };
  }
  return null;
}

function shouldUseBotAi(room: RoomInternal, bot: PlayerInternal): boolean {
  return bot.isBot && room.botAiSetting.enabled && room.botAiSetting.apiKeyConfigured && room.botAiSetting.apiKey.length > 0;
}

async function requestBotAiDecision(
  room: RoomInternal,
  bot: PlayerInternal,
  task: "propose-team" | "team-vote" | "excalibur" | "lady" | "assassination",
  extra: Record<string, unknown> = {}
): Promise<BotAiDecision | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOT_AI_TIMEOUT_MS);
  try {
    const response = await fetch(`${room.botAiSetting.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${room.botAiSetting.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: room.botAiSetting.model,
        temperature: 0.65,
        messages: [
          {
            role: "system",
            content:
              "你是阿瓦隆電腦玩家。只用已提供資訊，別自爆角色/陣營/AI。發言像公開推理，可暗示不可報答案。只回短 JSON，message 22 字內。"
          },
          {
            role: "user",
            content: JSON.stringify(buildBotAiPromptState(room, bot, task, extra))
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseBotAiDecision(payload.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildBotAiPromptState(
  room: RoomInternal,
  bot: PlayerInternal,
  task: "propose-team" | "team-vote" | "excalibur" | "lady" | "assassination",
  extra: Record<string, unknown>
): Record<string, unknown> {
  const knowledge = bot.role ? buildKnowledge(room, bot.id, bot.role) : [];
  const knownMap = new Map<string, string[]>();
  for (const item of knowledge) {
    for (const id of item.playerIds) {
      knownMap.set(id, [...(knownMap.get(id) || []), item.label]);
    }
  }
  const ladyResult = room.game.ladyResults[bot.id] || null;
  if (ladyResult) {
    knownMap.set(ladyResult.targetId, [...(knownMap.get(ladyResult.targetId) || []), `湖中女神真實：${ladyResult.allegiance === "good" ? "好人" : "邪惡"}`]);
  }

  return {
    t: task,
    need: {
      "propose-team": `teamIds 長度 ${currentTeamSize(room)}；王者之劍啟用時 excaliburHolderId 要在隊伍內且不是隊長。`,
      "team-vote": "回 approve 和短理由。",
      excalibur: "回 targetId 或 null。",
      lady: "回 announcement: good/evil，可說謊。",
      assassination: "回 targetId。"
    }[task],
    out: "JSON only: approve?, teamIds?, targetId?, excaliburHolderId?, announcement?, message(22字內)",
    self: {
      id: bot.id,
      name: bot.name,
      role: bot.role,
      side: playerAllegiance(room, bot)
    },
    g: {
      phase: room.game.phase,
      q: room.game.questIndex + 1,
      teamSize: currentTeamSize(room),
      failNeed: currentFailThreshold(room),
      rejects: room.game.failedVoteCount,
      team: room.game.proposedTeam,
      quests: room.game.quests.slice(-3).map((quest) => [quest.index + 1, quest.success ? "S" : "F", quest.failCount, quest.team]),
      votes: room.game.voteHistory.slice(-3).map((vote) => [vote.approved ? "Y" : "N", vote.leaderId, vote.team, vote.approvals, vote.rejections])
    },
    p: orderedPlayers(room).map((player, index) => ({
      id: player.id,
      name: player.name,
      n: index + 1,
      self: player.id === bot.id,
      leader: currentLeaderId(room) === player.id,
      onTeam: room.game.proposedTeam.includes(player.id),
      known: knownMap.get(player.id) || []
    })),
    extra
  };
}

function parseBotAiDecision(content: string): BotAiDecision | null {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(trimmed) as BotAiDecision;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      return null;
    }
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as BotAiDecision;
    } catch {
      return null;
    }
  }
}

function sanitizeBotSpeech(message: unknown): string | null {
  if (typeof message !== "string") {
    return null;
  }
  const cleaned = message
    .replace(/梅林候選|梅林/g, "關鍵線")
    .replace(/派西維爾|派西/g, "看線位")
    .replace(/莫甘娜|刺客|莫德雷德|莫德|奧伯倫/g, "可疑位")
    .replace(/邪惡方|邪惡陣營|壞人方|好人方|亞瑟陣營|我是壞人|我是好人|我是AI|AI|API/gi, "這邊")
    .trim()
    .slice(0, 44);
  return cleaned.length > 0 ? cleaned : null;
}

function rankBotTeamCandidates(room: RoomInternal, bot: PlayerInternal): PlayerInternal[] {
  const knownEvil = knownEvilIds(room, bot);
  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);
  const goodNudge = goodProtectionPoolIds(room, bot);
  const protectedRejectionSuspects = bot.role === "percival" ? percivalProtectedRejectionSuspectIds(room, bot) : new Set<string>();
  const critical = isCriticalMoment(room);
  const opening = isOpeningRound(room);

  return orderedPlayers(room)
    .map((player, index) => {
      let score = 0;
      const suspicion = botSuspicionScore(room, bot, player);

      if (player.id === bot.id) {
        score += bot.role && playerAllegiance(room, bot) === "evil" ? 2.2 : 2.8;
      }

      if (bot.role && playerAllegiance(room, bot) === "evil") {
        if (knownEvil.has(player.id)) {
          score += player.id === bot.id ? 1.4 : critical ? 2.2 : 1.2;
        } else {
          score += 1.2 - suspicion * 0.35;
          if (privateGood.has(player.id)) {
            score += critical ? 0.55 : 0.35;
          }
        }
      } else if (bot.role === "merlin") {
        if (knownEvil.has(player.id) || privateEvil.has(player.id)) {
          score -= opening ? 0.6 : critical ? 4.2 : 2.6;
        } else {
          score += 1.4 - suspicion * (critical ? 1.3 : 0.75);
          if (goodNudge.has(player.id)) {
            score += critical ? 1.25 : 0.7;
          }
          if (privateGood.has(player.id)) {
            score += critical ? 2.1 : 1.45;
          }
        }
      } else if (bot.role === "percival") {
        const protectedMerlinId = deducedMerlinIdForPercival(room, bot);
        const exposedMorganaId = exposedMorganaIdForPercival(room, bot);
        if (protectedMerlinId && player.id === protectedMerlinId) {
          score += critical ? 2.5 : 3.1;
        } else if ((exposedMorganaId && player.id === exposedMorganaId) || privateEvil.has(player.id)) {
          score -= critical ? 4.5 : 3.1;
        } else if (player.role === "merlin" || player.role === "morgana") {
          score += (critical ? 0.65 : 1.1) + percivalMerlinSignalScore(room, bot, player) * 0.55;
        }
        if (protectedRejectionSuspects.has(player.id)) {
          score -= critical ? 2.2 : 1.4;
        }
        if (goodNudge.has(player.id)) {
          score += critical ? 1.45 : 0.85;
        }
        score += 1.1 - suspicion * (critical ? 1.2 : 0.7);
        if (privateGood.has(player.id)) {
          score += critical ? 2.0 : 1.4;
        }
      } else {
        score += 1 - suspicion * (critical ? 1.25 : 0.72);
        if (goodNudge.has(player.id)) {
          score += critical ? 1.25 : 0.75;
        }
        if (privateGood.has(player.id)) {
          score += critical ? 2.0 : 1.5;
        }
        if (privateEvil.has(player.id)) {
          score -= critical ? 4.0 : 2.6;
        }
      }

      score += (Math.random() - 0.5) * (opening ? 1.2 : critical ? 0.35 : 0.75);
      return { player, score, index };
    })
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map((item) => item.player);
}

function sortByBotTrust(room: RoomInternal, bot: PlayerInternal, players: PlayerInternal[]): PlayerInternal[] {
  const order = new Map(room.game.playerOrder.map((id, index) => [id, index]));
  return [...players].sort((first, second) => {
    const scoreDiff = botSuspicionScore(room, bot, first) - botSuspicionScore(room, bot, second);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return (order.get(first.id) ?? 0) - (order.get(second.id) ?? 0);
  });
}

function isOpeningRound(room: RoomInternal): boolean {
  return room.game.questIndex === 0 && room.game.quests.length === 0;
}

function goodProtectionPoolIds(room: RoomInternal, bot: PlayerInternal): Set<string> {
  const pool = new Set<string>();
  if (!bot.role || playerAllegiance(room, bot) !== "good") {
    return pool;
  }

  const limit = Math.max(1, currentTeamSize(room) - 1);
  const add = (id: string | null | undefined) => {
    if (id && id !== bot.id && pool.size < limit) {
      pool.add(id);
    }
  };

  privateLadyGoodIds(room, bot).forEach(add);
  add(deducedMerlinIdForPercival(room, bot));

  const knownBad = new Set([...knownEvilIds(room, bot), ...privateLadyEvilIds(room, bot)]);
  const ranked = orderedPlayers(room)
    .filter((player) => player.id !== bot.id && !knownBad.has(player.id))
    .map((player, index) => ({
      player,
      index,
      score: publicGoodLeanScore(room, bot, player)
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index);

  for (const item of ranked) {
    if (pool.size >= limit) {
      break;
    }
    if (item.score >= 0.35 || pool.size === 0) {
      pool.add(item.player.id);
    }
  }

  return pool;
}

function publicGoodLeanScore(room: RoomInternal, bot: PlayerInternal, player: PlayerInternal): number {
  let score = -botSuspicionScoreWithoutPercivalCandidateSignals(room, bot, player) * 0.42;

  const approvedVotes = room.game.voteHistory.filter((vote) => vote.approved);
  approvedVotes.forEach((vote, questOrder) => {
    const quest = room.game.quests[questOrder];
    if (!quest) {
      return;
    }
    const onTeam = vote.team.includes(player.id);
    if (quest.success && onTeam) {
      score += 0.72;
    }
    if (!quest.success && vote.rejections.includes(player.id)) {
      score += quest.failCount >= 2 ? 0.72 : 0.48;
    }
    if (!quest.success && onTeam && vote.approvals.includes(player.id)) {
      score -= 0.55;
    }
    if (!quest.success && !onTeam && vote.rejections.includes(player.id)) {
      score += 0.28;
    }
  });

  score -= publicVoteBehaviorSuspicion(room, player) * 0.35;

  if (bot.role === "percival" && (player.role === "merlin" || player.role === "morgana")) {
    score += percivalMerlinSignalScore(room, bot, player) * 0.65;
  }
  if (privateLadyGoodIds(room, bot).has(player.id)) {
    score += 2.4;
  }
  if (privateLadyEvilIds(room, bot).has(player.id)) {
    score -= 3.5;
  }
  return score;
}

function percivalCandidatePlayers(room: RoomInternal): PlayerInternal[] {
  return orderedPlayers(room).filter((player) => player.role === "merlin" || player.role === "morgana");
}

function percivalCandidateScores(room: RoomInternal, bot: PlayerInternal): Array<{ player: PlayerInternal; score: number }> {
  return percivalCandidatePlayers(room)
    .map((player) => ({
      player,
      score: percivalMerlinSignalScore(room, bot, player)
    }))
    .sort((first, second) => second.score - first.score);
}

function percivalMerlinSignalScore(room: RoomInternal, bot: PlayerInternal, candidate: PlayerInternal): number {
  if (bot.role !== "percival" || (candidate.role !== "merlin" && candidate.role !== "morgana")) {
    return 0;
  }

  let score = 0;
  const approvedVotes = room.game.voteHistory.filter((vote) => vote.approved);
  approvedVotes.forEach((vote, questOrder) => {
    const quest = room.game.quests[questOrder];
    if (!quest) {
      return;
    }

    const rejected = vote.rejections.includes(candidate.id);
    const approved = vote.approvals.includes(candidate.id);
    const onTeam = vote.team.includes(candidate.id);
    const wasLeader = vote.leaderId === candidate.id;

    if (!quest.success) {
      if (rejected) {
        score += quest.failCount >= 2 ? 1.3 : 1.05;
      }
      if (approved) {
        score -= onTeam ? 1.05 : 0.65;
      }
      if (wasLeader) {
        score -= 0.9;
      }
      if (onTeam) {
        score -= 0.25;
      }
    } else {
      if (approved) {
        score += onTeam ? 0.42 : 0.2;
      }
      if (rejected) {
        score -= 0.22;
      }
      if (wasLeader) {
        score += 0.32;
      }
    }
  });

  for (const inspection of room.game.ladyInspections) {
    if (inspection.targetId !== candidate.id) {
      continue;
    }
    if (inspection.announcedAllegiance === "good") {
      score += 0.28;
    }
    if (inspection.announcedAllegiance === "evil") {
      score -= 0.42;
    }
  }

  const privateRead = room.game.ladyResults[bot.id];
  if (privateRead?.targetId === candidate.id) {
    score += privateRead.allegiance === "good" ? 3.5 : -3.5;
  }

  score -= Math.min(2.4, botSuspicionScoreWithoutPercivalCandidateSignals(room, bot, candidate) * 0.34);
  return score;
}

function percivalProtectedRejectionSuspectIds(room: RoomInternal, bot: PlayerInternal): Set<string> {
  const protectedId = deducedMerlinIdForPercival(room, bot);
  const suspects = new Set<string>();
  if (bot.role !== "percival" || !protectedId) {
    return suspects;
  }

  const approvedVotes = room.game.voteHistory.filter((vote) => vote.approved);
  approvedVotes.forEach((vote, questOrder) => {
    const quest = room.game.quests[questOrder];
    if (!quest || quest.success || !vote.rejections.includes(protectedId)) {
      return;
    }
    for (const id of quest.team) {
      if (id !== protectedId) {
        suspects.add(id);
      }
    }
  });
  return suspects;
}

function deducedMerlinIdForPercival(room: RoomInternal, bot: PlayerInternal): string | null {
  if (bot.role !== "percival") {
    return null;
  }

  const ladyResult = room.game.ladyResults[bot.id];
  const target = ladyResult ? room.players.get(ladyResult.targetId) : null;
  if (ladyResult && target?.role === "merlin" && ladyResult.allegiance === "good") {
    return target.id;
  }

  const exposedMorganaId = exposedMorganaIdForPercival(room, bot);
  const directCandidate = otherPercivalCandidateId(room, exposedMorganaId, "merlin");
  if (directCandidate) {
    return directCandidate;
  }

  const [best, second] = percivalCandidateScores(room, bot);
  if (!best) {
    return null;
  }
  const gap = best.score - (second?.score ?? 0);
  return best.score >= 1.2 || gap >= 1.05 ? best.player.id : null;
}

function exposedMorganaIdForPercival(room: RoomInternal, bot: PlayerInternal): string | null {
  if (bot.role !== "percival") {
    return null;
  }

  const ladyResult = room.game.ladyResults[bot.id];
  if (ladyResult) {
    const target = room.players.get(ladyResult.targetId);
    if (target?.role === "morgana" && ladyResult.allegiance === "evil") {
      return target.id;
    }
    if (target?.role === "merlin" && ladyResult.allegiance === "good") {
      return otherPercivalCandidateId(room, target.id, "morgana");
    }
  }

  const scored = percivalCandidateScores(room, bot);
  const best = scored[0];
  const worst = scored[scored.length - 1];
  if (!best || !worst || best.player.id === worst.player.id) {
    return null;
  }
  return best.score - worst.score >= 1.4 || worst.score <= -0.9 ? worst.player.id : null;
}

function otherPercivalCandidateId(room: RoomInternal, knownCandidateId: string | null, expectedRole: "merlin" | "morgana"): string | null {
  if (!knownCandidateId) {
    return null;
  }
  const candidate = orderedPlayers(room).find((player) => player.role === expectedRole && player.id !== knownCandidateId);
  return candidate?.id || null;
}

function privateLadyGoodIds(room: RoomInternal, bot: PlayerInternal): Set<string> {
  const result = room.game.ladyResults[bot.id];
  return new Set(result?.allegiance === "good" ? [result.targetId] : []);
}

function privateLadyEvilIds(room: RoomInternal, bot: PlayerInternal): Set<string> {
  const result = room.game.ladyResults[bot.id];
  return new Set(result?.allegiance === "evil" ? [result.targetId] : []);
}

function isCriticalMoment(room: RoomInternal): boolean {
  const goodWins = room.game.quests.filter((quest) => quest.success).length;
  const evilWins = room.game.quests.filter((quest) => !quest.success).length;
  return room.game.questIndex >= 2 || goodWins >= 2 || evilWins >= 2 || room.game.failedVoteCount >= 3;
}

function chance(probability: number): boolean {
  return Math.random() < Math.max(0, Math.min(1, probability));
}

function pickLine(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)] || "";
}

function botSuspicionScore(room: RoomInternal, bot: PlayerInternal, player: PlayerInternal): number {
  if (bot.role && playerAllegiance(room, bot) === "good" && player.id === bot.id) {
    return 0;
  }

  let score = botSuspicionScoreWithoutPercivalCandidateSignals(room, bot, player);

  if (bot.role === "percival") {
    const protectedMerlinId = deducedMerlinIdForPercival(room, bot);
    const exposedMorganaId = exposedMorganaIdForPercival(room, bot);
    if (player.id === protectedMerlinId) {
      score -= 2.6;
    }
    if (player.id === exposedMorganaId) {
      score += 5.2;
    }
  }

  return Math.max(0, score);
}

function botSuspicionScoreWithoutPercivalCandidateSignals(room: RoomInternal, bot: PlayerInternal, player: PlayerInternal): number {
  if (bot.role && playerAllegiance(room, bot) === "good" && player.id === bot.id) {
    return 0;
  }

  let score = 0;
  const privateGood = privateLadyGoodIds(room, bot);
  const privateEvil = privateLadyEvilIds(room, bot);

  if (privateGood.has(player.id)) {
    score -= bot.role && playerAllegiance(room, bot) === "good" ? 2.2 : 0.5;
  }
  if (privateEvil.has(player.id)) {
    score += bot.role && playerAllegiance(room, bot) === "good" ? 5.0 : 0.6;
  }

  for (const quest of room.game.quests) {
    if (!quest.team.includes(player.id)) {
      continue;
    }

    if (quest.success) {
      score -= 0.45;
      continue;
    }

    const teamSizeWeight = quest.team.length <= 2 ? 1.6 : 1.15;
    score += Math.max(1, quest.failCount) * teamSizeWeight;
  }

  score += publicLadyClaimSuspicion(room, bot, player);
  score += publicVoteBehaviorSuspicion(room, player);

  return Math.max(0, score);
}

function publicVoteBehaviorSuspicion(room: RoomInternal, player: PlayerInternal): number {
  let score = 0;
  const approvedVotes = room.game.voteHistory.filter((vote) => vote.approved);

  approvedVotes.forEach((vote, questOrder) => {
    const quest = room.game.quests[questOrder];
    const onTeam = vote.team.includes(player.id);
    const approved = vote.approvals.includes(player.id);
    const rejected = vote.rejections.includes(player.id);

    if (onTeam && rejected) {
      score += quest ? (quest.success ? 0.55 : -0.45) : 0.24;
      if (vote.leaderId === player.id) {
        score += 0.55;
      }
    }

    if (!onTeam && approved) {
      score += quest ? (quest.success ? -0.12 : 0.55) : 0.18;
    }

    if (!quest) {
      return;
    }

    if (!quest.success && onTeam && approved) {
      score += 0.25;
    }
    if (!quest.success && !onTeam && rejected) {
      score -= 0.22;
    }
  });

  return score;
}

function latestFailedQuest(room: RoomInternal): QuestResult | null {
  for (let index = room.game.quests.length - 1; index >= 0; index -= 1) {
    const quest = room.game.quests[index];
    if (!quest.success) {
      return quest;
    }
  }
  return null;
}

function failedTeamCarryoverRisk(room: RoomInternal, bot: PlayerInternal, teamIds: string[]): number {
  const failedQuest = latestFailedQuest(room);
  if (!failedQuest) {
    return 0;
  }

  const failedTeam = new Set(failedQuest.team);
  const currentTeam = new Set(teamIds);
  const kept = failedQuest.team.filter((id) => currentTeam.has(id));
  const removed = failedQuest.team.filter((id) => !currentTeam.has(id));
  const added = teamIds.filter((id) => !failedTeam.has(id));
  let risk = 0;

  if (kept.length === failedQuest.team.length && teamIds.length >= failedQuest.team.length) {
    risk += failedQuest.failCount >= 2 ? 1.7 : 1.15;
  } else if (kept.length >= Math.max(1, failedQuest.team.length - 1) && added.length <= 1) {
    risk += failedQuest.failCount >= 2 ? 1.25 : 0.65;
  } else if (removed.length >= 1 && added.length >= 1) {
    risk -= 0.28;
  }

  for (const id of kept) {
    const player = room.players.get(id);
    if (player && player.id !== bot.id) {
      risk += Math.min(0.75, botSuspicionScoreWithoutPercivalCandidateSignals(room, bot, player) * 0.18);
    }
  }

  for (const id of removed) {
    const player = room.players.get(id);
    if (player && botSuspicionScoreWithoutPercivalCandidateSignals(room, bot, player) >= 1.1) {
      risk -= 0.38;
    }
  }

  for (const id of added) {
    if (privateLadyGoodIds(room, bot).has(id) || id === deducedMerlinIdForPercival(room, bot)) {
      risk -= 0.35;
    }
  }

  return risk;
}

function publicLadyClaimSuspicion(room: RoomInternal, bot: PlayerInternal, player: PlayerInternal): number {
  let score = 0;
  const botResult = room.game.ladyResults[bot.id];

  for (const inspection of room.game.ladyInspections) {
    if (inspection.targetId !== player.id || !inspection.announcedAllegiance) {
      continue;
    }

    const inspectorPrivatelyKnownEvil = botResult?.targetId === inspection.fromId && botResult.allegiance === "evil";
    const trustMultiplier = inspectorPrivatelyKnownEvil ? -0.7 : 1;
    score += (inspection.announcedAllegiance === "evil" ? 0.85 : -0.35) * trustMultiplier;
  }

  return score;
}

function assassinationReadScore(room: RoomInternal, player: PlayerInternal): number {
  let score = 0;
  for (const vote of room.game.voteHistory) {
    const teamHasKnownEvil = vote.team.some((id) => {
      const teammate = room.players.get(id);
      return teammate?.role && playerAllegiance(room, teammate) === "evil";
    });
    if (teamHasKnownEvil && vote.rejections.includes(player.id)) {
      score += vote.approved ? 0.55 : 0.9;
    }
    if (!teamHasKnownEvil && vote.approvals.includes(player.id)) {
      score += 0.25;
    }
  }

  for (const quest of room.game.quests) {
    if (quest.success && quest.team.includes(player.id)) {
      score += 0.24;
    }
    if (!quest.success && quest.team.includes(player.id)) {
      score -= 0.22;
    }
  }

  for (const inspection of room.game.ladyInspections) {
    if (inspection.targetId === player.id && inspection.announcedAllegiance === "good") {
      score += 0.18;
    }
    if (inspection.targetId === player.id && inspection.announcedAllegiance === "evil") {
      score -= 0.34;
    }
  }

  return score;
}

function assassinationVoters(room: RoomInternal): PlayerInternal[] {
  return orderedPlayers(room).filter((player) => player.role && playerAllegiance(room, player) === "evil");
}

function resolveAssassinationVote(room: RoomInternal): string {
  const tally = new Map<string, number>();
  for (const targetId of Object.values(room.game.assassinationVotes)) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }
  const assassin = orderedPlayers(room).find((player) => player.role === "assassin");
  const assassinVote = assassin ? room.game.assassinationVotes[assassin.id] : null;
  const order = new Map(room.game.playerOrder.map((id, index) => [id, index]));

  return [...tally.entries()]
    .sort((first, second) => {
      const voteDiff = second[1] - first[1];
      if (voteDiff !== 0) {
        return voteDiff;
      }
      if (assassinVote) {
        if (first[0] === assassinVote) {
          return -1;
        }
        if (second[0] === assassinVote) {
          return 1;
        }
      }
      return (order.get(first[0]) ?? 0) - (order.get(second[0]) ?? 0);
    })[0][0];
}

function knownEvilPlayers(room: RoomInternal, bot: PlayerInternal): PlayerInternal[] {
  if (!bot.role) {
    return [];
  }
  if (playerAllegiance(room, bot) === "evil") {
    return orderedPlayers(room).filter(
      (player) =>
        player.role && playerAllegiance(room, player) === "evil" && player.role !== "oberon" && (bot.role !== "oberon" || player.id === bot.id)
    );
  }
  if (bot.role === "merlin") {
    return orderedPlayers(room).filter((player) => player.role && roleSide(player.role) === "evil" && player.role !== "mordred");
  }
  if (bot.role === "percival") {
    const exposedMorganaId = exposedMorganaIdForPercival(room, bot);
    const exposedMorgana = exposedMorganaId ? room.players.get(exposedMorganaId) : null;
    if (exposedMorgana) {
      return [exposedMorgana];
    }
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

function toPublicBotAiSetting(setting: BotAiInternalConfig): BotAiPublicConfig {
  return {
    enabled: setting.enabled,
    provider: setting.provider,
    baseUrl: setting.baseUrl,
    model: setting.model,
    apiKeyConfigured: setting.apiKeyConfigured
  };
}

function visibleLadyPendingResult(room: RoomInternal, viewer: PlayerInternal): LadyPendingResult | null {
  const pending = room.game.ladyPendingResult;
  if (pending?.fromId === viewer.id) {
    return pending;
  }

  const result = room.game.ladyResults[viewer.id];
  if (!result || room.game.phase !== "lady" || room.game.ladyHolderId !== viewer.id) {
    return null;
  }

  const alreadyAnnounced = room.game.ladyInspections.some((inspection) => inspection.fromId === viewer.id && inspection.targetId === result.targetId);
  if (alreadyAnnounced) {
    return null;
  }

  return {
    fromId: viewer.id,
    targetId: result.targetId,
    allegiance: result.allegiance
  };
}

function normalizeBotAiProvider(provider: BotAiProvider): BotAiProvider {
  if (provider === "openai" || provider === "deepseek" || provider === "gemini" || provider === "custom") {
    return provider;
  }
  return "openai";
}

function normalizeBotAiBaseUrl(provider: BotAiProvider, baseUrl?: string): string {
  const cleaned = baseUrl?.trim().replace(/\/+$/, "");
  if (provider === "deepseek") {
    return cleaned || "https://api.deepseek.com";
  }
  if (provider === "gemini") {
    return cleaned || "https://generativelanguage.googleapis.com/v1beta/openai";
  }
  if (provider === "custom") {
    return cleaned || "https://api.openai.com/v1";
  }
  return cleaned || "https://api.openai.com/v1";
}

function normalizeBotAiModel(provider: BotAiProvider, model?: string): string {
  const cleaned = model?.trim();
  if (cleaned) {
    return cleaned.slice(0, 80);
  }
  if (provider === "deepseek") {
    return "deepseek-chat";
  }
  if (provider === "gemini") {
    return "gemini-2.5-flash";
  }
  return "gpt-5-mini";
}

function normalizeAllegiance(value: unknown): Allegiance | null {
  return value === "good" || value === "evil" ? value : null;
}

function isLancelotRole(role: RoleId | null): role is "lancelotGood" | "lancelotEvil" {
  return role === "lancelotGood" || role === "lancelotEvil";
}

function playerAllegiance(room: RoomInternal, player: PlayerInternal): Allegiance {
  if (!player.role) {
    return "good";
  }
  if (isLancelotRole(player.role)) {
    return room.game.lancelotAllegiances[player.id] || roleSide(player.role);
  }
  return roleSide(player.role);
}

function hasHumanPlayers(room: RoomInternal): boolean {
  return Array.from(room.players.values()).some((player) => !player.isBot);
}

function convertPlayerToBot(room: RoomInternal, player: PlayerInternal): void {
  player.socketId = null;
  player.connected = true;
  player.isBot = true;
  player.isHost = false;
  renumberBots(room);
}

function promoteHost(room: RoomInternal): void {
  const nextHost = Array.from(room.players.values()).find((player) => !player.isBot);
  if (!nextHost) {
    for (const player of room.players.values()) {
      player.isHost = player.id === room.hostId;
    }
    return;
  }

  for (const player of room.players.values()) {
    player.isHost = player.id === nextHost.id;
  }
  room.hostId = nextHost.id;
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
