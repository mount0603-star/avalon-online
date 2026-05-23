import type { Allegiance, RoleId } from "./roles";

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
  | "lady"
  | "assassination"
  | "finished";

export type QuestResult = {
  index: number;
  team: string[];
  success: boolean;
  failCount: number;
  failThreshold: number;
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

export type LadyInspectionPublic = {
  fromId: string;
  targetId: string;
};

export type LadyResult = {
  targetId: string;
  allegiance: Allegiance;
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
  winner: Allegiance | null;
  winReason: string | null;
  assassinId: string | null;
  assassinTargetId: string | null;
  ladyEnabled: boolean;
  ladyHolderId: string | null;
  ladyUsedPlayerIds: string[];
  ladyInspections: LadyInspectionPublic[];
};

export type RoomView = {
  roomCode: string;
  you: PlayerPublic | null;
  players: PlayerPublic[];
  game: GamePublicState;
  yourRole: RoleId | null;
  roleKnowledge: RoleKnowledge[];
  ladyResult: LadyResult | null;
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

export type ClientToServerEvents = {
  createRoom: (payload: CreateRoomPayload, ack: (payload: RoomJoinedPayload | { error: string }) => void) => void;
  joinRoom: (payload: JoinRoomPayload, ack: (payload: RoomJoinedPayload | { error: string }) => void) => void;
  addBot: () => void;
  removeBot: (playerId: string) => void;
  startGame: () => void;
  proposeTeam: (teamIds: string[]) => void;
  castTeamVote: (approve: boolean) => void;
  castMissionVote: (success: boolean) => void;
  useLadyOfLake: (targetId: string) => void;
  assassinate: (targetId: string) => void;
  resetRoom: () => void;
};

export type ServerToClientEvents = {
  roomState: (state: RoomView) => void;
  roomError: (message: string) => void;
};

export type InterServerEvents = Record<string, never>;

export type SocketData = {
  roomCode?: string;
  playerId?: string;
};
