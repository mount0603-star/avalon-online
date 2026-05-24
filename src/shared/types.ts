import type { Allegiance, RoleId } from "./roles";

export type LadyHolderMode = "tail" | "random";
export type BotAiProvider = "openai" | "deepseek" | "custom";

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
  phase: "team-vote" | "lady" | "assassination" | "excalibur";
  message: string;
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
  startGame: () => void;
  proposeTeam: (teamIds: string[], excaliburHolderId?: string | null) => void;
  castTeamVote: (approve: boolean) => void;
  castMissionVote: (success: boolean) => void;
  useExcalibur: (targetId: string | null) => void;
  useLadyOfLake: (targetId: string, announcedAllegiance?: Allegiance | null) => void;
  assassinate: (targetId: string) => void;
  resetRoom: () => void;
  leaveRoom: () => void;
};

export type ServerToClientEvents = {
  roomState: (state: RoomView) => void;
  lobbyRooms: (rooms: LobbyRoomSummary[]) => void;
  roomError: (message: string) => void;
  roomClosed: (message: string) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  roomCode?: string;
  playerId?: string;
};
