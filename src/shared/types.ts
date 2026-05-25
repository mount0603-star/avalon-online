import type { Allegiance, RoleId } from "./roles";

export type LadyHolderMode = "tail" | "random";
export type BotAiProvider = "openai" | "deepseek" | "gemini" | "custom";

export type BotAiPublicConfig = {
  enabled: boolean;
  provider: BotAiProvider;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
};

export type BotAiSettingsPayload = {
  enabled: boolean;
  provider: BotAiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
};

export type PlayerPublic = {
  id: string;
  name: string;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
};

export type GamePhase =
  | "lobby"
  | "team-building"
  | "team-vote"
  | "mission"
  | "excalibur"
  | "lady"
  | "lancelot"
  | "assassination"
  | "finished";

export type QuestResult = {
  index: number;
  team: string[];
  success: boolean;
  failCount: number;
  failThreshold: number;
  excaliburHolderId: string | null;
  excaliburTargetId: string | null;
};

export type LancelotCard = "switch" | "blank";

export type LancelotDrawPublic = {
  questIndex: number;
  card: LancelotCard;
  switched: boolean;
};

export type VoteRecord = {
  round: number;
  leaderId: string;
  team: string[];
  approvals: string[];
  rejections: string[];
  approved: boolean;
};

export type RoleKnowledge = {
  label: string;
  playerIds: string[];
};

export type BotOpinion = {
  id: number;
  playerId: string;
  phase: "team-building" | "team-vote" | "mission" | "lady" | "assassination" | "excalibur";
  message: string;
  source: "rules" | "api";
};

export type LadyInspectionPublic = {
  fromId: string;
  targetId: string;
  announcedAllegiance: Allegiance | null;
};

export type LadyResult = {
  targetId: string;
  allegiance: Allegiance;
};

export type LadyPendingResult = LadyResult & {
  fromId: string;
};

export type GamePublicState = {
  phase: GamePhase;
  playerOrder: string[];
  leaderId: string | null;
  questIndex: number;
  teamSize: number;
  failThreshold: number;
  failedVoteCount: number;
  proposedTeam: string[];
  teamVotesSubmitted: string[];
  missionVotesSubmitted: string[];
  quests: QuestResult[];
  voteHistory: VoteRecord[];
  botOpinions: BotOpinion[];
  winner: Allegiance | null;
  winReason: string | null;
  assassinId: string | null;
  assassinTargetId: string | null;
  assassinationVotesSubmitted: string[];
  assassinationVoteCount: number;
  excaliburEnabled: boolean;
  excaliburHolderId: string | null;
  excaliburTargetId: string | null;
  excaliburVotes: Record<string, boolean> | null;
  ladyEnabled: boolean;
  ladyHolderId: string | null;
  ladyUsedPlayerIds: string[];
  ladyInspections: LadyInspectionPublic[];
  lancelotEnabled: boolean;
  lancelotDraws: LancelotDrawPublic[];
  lancelotDeckRemaining: number;
};

export type RoomView = {
  roomCode: string;
  ladyEnabledSetting: boolean;
  ladyHolderModeSetting: LadyHolderMode;
  lancelotEnabledSetting: boolean;
  excaliburEnabledSetting: boolean;
  botAiSetting: BotAiPublicConfig;
  idleWarningAt: number;
  idleTimeoutAt: number;
  you: PlayerPublic | null;
  players: PlayerPublic[];
  game: GamePublicState;
  yourRole: RoleId | null;
  yourAllegiance: Allegiance | null;
  roleKnowledge: RoleKnowledge[];
  ladyResult: LadyResult | null;
  ladyPendingResult: LadyPendingResult | null;
  publicEvilPlayerIds: string[];
  revealedRoles: Record<string, RoleId> | null;
  error?: string;
};

export type CreateRoomPayload = {
  name: string;
  playerId?: string;
};

export type JoinRoomPayload = {
  roomCode: string;
  name: string;
  playerId?: string;
};

export type RoomJoinedPayload = {
  roomCode: string;
  playerId: string;
};

export type LobbyRoomSummary = {
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  phase: GamePhase;
  updatedAt: number;
};

export type AdminRoomSummary = LobbyRoomSummary & {
  roomCode: string;
  humanCount: number;
  botCount: number;
  createdAt: number;
  idleTimeoutAt: number;
};

export type AdminLogEntry = {
  id: number;
  at: number;
  level: "info" | "warning" | "error";
  message: string;
  roomCode?: string;
};

export type AdminSnapshot = {
  rooms: AdminRoomSummary[];
  logs: AdminLogEntry[];
};

export type VoiceSignalPayload =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit };

export type ClientToServerEvents = {
  createRoom: (payload: CreateRoomPayload, ack: (payload: RoomJoinedPayload | { error: string }) => void) => void;
  joinRoom: (payload: JoinRoomPayload, ack: (payload: RoomJoinedPayload | { error: string }) => void) => void;
  addBot: () => void;
  removeBot: (playerId: string) => void;
  setLadyEnabled: (enabled: boolean) => void;
  setLadyHolderMode: (mode: LadyHolderMode) => void;
  setLancelotEnabled: (enabled: boolean) => void;
  setExcaliburEnabled: (enabled: boolean) => void;
  setBotAiSettings: (settings: BotAiSettingsPayload) => void;
  updateTeamDraft: (teamIds: string[], excaliburHolderId?: string | null) => void;
  startGame: () => void;
  proposeTeam: (teamIds: string[], excaliburHolderId?: string | null) => void;
  castTeamVote: (approve: boolean) => void;
  castMissionVote: (success: boolean) => void;
  useExcalibur: (targetId: string | null) => void;
  useLadyOfLake: (targetId: string, announcedAllegiance?: Allegiance | null) => void;
  assassinate: (targetId: string) => void;
  voiceJoin: () => void;
  voiceLeave: () => void;
  voiceSignal: (targetPlayerId: string, signal: VoiceSignalPayload) => void;
  adminLogin: (
    payload: { username: string; password: string },
    ack: (payload: { ok: true; snapshot: AdminSnapshot } | { ok: false; error: string }) => void
  ) => void;
  adminList: (ack: (payload: { ok: true; snapshot: AdminSnapshot } | { ok: false; error: string }) => void) => void;
  adminCloseRoom: (roomCode: string, ack: (payload: { ok: true; snapshot: AdminSnapshot } | { ok: false; error: string }) => void) => void;
  adminSpectateRoom: (
    roomCode: string,
    ack: (payload: { ok: true; state: RoomView; snapshot: AdminSnapshot } | { ok: false; error: string }) => void
  ) => void;
  adminLeaveSpectate: () => void;
  resetRoom: () => void;
  leaveRoom: () => void;
};

export type ServerToClientEvents = {
  roomState: (state: RoomView) => void;
  lobbyRooms: (rooms: LobbyRoomSummary[]) => void;
  roomError: (message: string) => void;
  roomClosed: (message: string) => void;
  voicePeers: (playerIds: string[]) => void;
  voicePeerJoined: (playerId: string) => void;
  voicePeerLeft: (playerId: string) => void;
  voiceSignal: (fromPlayerId: string, signal: VoiceSignalPayload) => void;
  adminSnapshot: (snapshot: AdminSnapshot) => void;
  adminRoomState: (state: RoomView) => void;
  adminRoomClosed: (message: string) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  roomCode?: string;
  playerId?: string;
  voiceEnabled?: boolean;
  adminAuthenticated?: boolean;
  adminSpectatingRoomCode?: string;
};
