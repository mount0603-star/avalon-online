import { useEffect, useState, type CSSProperties } from "react";
import {
  Bot,
  Check,
  Circle,
  Clock,
  Copy,
  Crown,
  Eye,
  Flag,
  Hourglass,
  Link as LinkIcon,
  LogIn,
  LogOut,
  Plus,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
  Target,
  Trash2,
  Users,
  Vote,
  Waves,
  WifiOff,
  X
} from "lucide-react";
import { socket } from "./socket";
import type { BotAiProvider, LadyHolderMode, LobbyRoomSummary, PlayerPublic, RoomJoinedPayload, RoomView } from "../shared/types";
import councilHallUrl from "./assets/council-hall.png";
import merlinCardUrl from "./assets/role-cards/merlin.png";
import percivalCardUrl from "./assets/role-cards/percival.png";
import loyalCardUrl from "./assets/role-cards/loyal.png";
import loyalAltCardUrl from "./assets/role-cards/loyal-2.png";
import lancelotGoodCardUrl from "./assets/role-cards/lancelot-good.png";
import assassinCardUrl from "./assets/role-cards/assassin.png";
import morganaCardUrl from "./assets/role-cards/morgana.png";
import mordredCardUrl from "./assets/role-cards/mordred.png";
import oberonCardUrl from "./assets/role-cards/oberon.png";
import minionCardUrl from "./assets/role-cards/minion.png";
import lancelotEvilCardUrl from "./assets/role-cards/lancelot-evil.png";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLE_DEFINITIONS,
  getRoleSet,
  roleSide,
  type Allegiance,
  type RoleId
} from "../shared/roles";

const PLAYER_ID_KEY = "avalon-online.playerId";
const ROOM_CODE_KEY = "avalon-online.roomCode";
const PLAYER_NAME_KEY = "avalon-online.playerName";

function roomCodeFromUrl(): string {
  const code = new URLSearchParams(window.location.search).get("room") || "";
  return code.trim().toUpperCase().slice(0, 4);
}

function roomInviteUrl(roomCode: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomCode);
  return url.toString();
}

function replaceRoomCodeInUrl(roomCode: string | null): void {
  const url = new URL(window.location.href);
  if (roomCode) {
    url.searchParams.set("room", roomCode);
  } else {
    url.searchParams.delete("room");
  }
  window.history.replaceState(null, "", url.toString());
}

const phaseLabel: Record<RoomView["game"]["phase"], string> = {
  lobby: "大廳",
  "team-building": "組隊",
  "team-vote": "表決",
  mission: "任務",
  excalibur: "王者之劍",
  lady: "湖中女神",
  lancelot: "忠誠牌",
  assassination: "刺殺",
  finished: "結算"
};

const roleTone: Record<RoleId, string> = {
  merlin: "role-good",
  percival: "role-good",
  loyal: "role-good",
  lancelotGood: "role-good",
  assassin: "role-evil",
  morgana: "role-evil",
  mordred: "role-evil",
  oberon: "role-evil",
  lancelotEvil: "role-evil",
  minion: "role-evil"
};

const fullRoleGallery: RoleId[] = [
  "merlin",
  "percival",
  "loyal",
  "loyal",
  "lancelotGood",
  "assassin",
  "morgana",
  "mordred",
  "oberon",
  "lancelotEvil",
  "minion"
];

const roleCardImageUrls: Record<RoleId, string[]> = {
  merlin: [merlinCardUrl],
  percival: [percivalCardUrl],
  loyal: [loyalCardUrl, loyalAltCardUrl],
  lancelotGood: [lancelotGoodCardUrl],
  assassin: [assassinCardUrl],
  morgana: [morganaCardUrl],
  mordred: [mordredCardUrl],
  oberon: [oberonCardUrl],
  lancelotEvil: [lancelotEvilCardUrl],
  minion: [minionCardUrl]
};

const questTeamSizes: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5]
};

const questFailThresholds: Record<number, number[]> = {
  5: [1, 1, 1, 1, 1],
  6: [1, 1, 1, 1, 1],
  7: [1, 1, 1, 2, 1],
  8: [1, 1, 1, 2, 1],
  9: [1, 1, 1, 2, 1],
  10: [1, 1, 1, 2, 1]
};

const botAiDefaults: Record<BotAiProvider, { label: string; baseUrl: string; model: string }> = {
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5-mini"
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat"
  },
  gemini: {
    label: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash"
  },
  custom: {
    label: "自訂相容 API",
    baseUrl: "",
    model: ""
  }
};

export function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(PLAYER_NAME_KEY) || "");
  const [roomCode, setRoomCode] = useState(() => roomCodeFromUrl() || localStorage.getItem(ROOM_CODE_KEY) || "");
  const [error, setError] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<LobbyRoomSummary[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onState = (nextRoom: RoomView) => {
      setRoom(nextRoom);
      setError("");
      localStorage.setItem(ROOM_CODE_KEY, nextRoom.roomCode);
    };
    const onError = (message: string) => setError(message);
    const onClosed = (message: string) => {
      clearRoomSession({ preserveRoomCode: message === "你已離開房間。" });
      setError(message);
    };
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("roomState", onState);
    socket.on("lobbyRooms", setLobbyRooms);
    socket.on("roomError", onError);
    socket.on("roomClosed", onClosed);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("roomState", onState);
      socket.off("lobbyRooms", setLobbyRooms);
      socket.off("roomError", onError);
      socket.off("roomClosed", onClosed);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  useEffect(() => {
    const urlRoomCode = roomCodeFromUrl();
    const storedName = localStorage.getItem(PLAYER_NAME_KEY);
    const storedRoomCode = localStorage.getItem(ROOM_CODE_KEY);
    const storedPlayerId = localStorage.getItem(PLAYER_ID_KEY);

    if (urlRoomCode && urlRoomCode !== storedRoomCode) {
      localStorage.removeItem(PLAYER_ID_KEY);
      localStorage.setItem(ROOM_CODE_KEY, urlRoomCode);
      setRoomCode(urlRoomCode);
      return;
    }

    if (!storedName || !storedRoomCode || !storedPlayerId) {
      return;
    }

    setName(storedName);
    setRoomCode(storedRoomCode);

    let cancelled = false;
    const restoreRoom = () => {
      if (cancelled) {
        return;
      }
      socket.emit(
        "joinRoom",
        {
          roomCode: storedRoomCode,
          name: storedName,
          playerId: storedPlayerId
        },
        (payload) => {
          if (cancelled) {
            return;
          }
          if ("error" in payload) {
            setError("無法回到原本房間，可能房間已重開。");
            return;
          }
          persistSession(payload, storedName);
        }
      );
    };

    if (socket.connected) {
      restoreRoom();
    } else {
      socket.once("connect", restoreRoom);
    }

    return () => {
      cancelled = true;
      socket.off("connect", restoreRoom);
    };
  }, []);

  function persistSession(payload: RoomJoinedPayload, playerName: string) {
    localStorage.setItem(PLAYER_ID_KEY, payload.playerId);
    localStorage.setItem(ROOM_CODE_KEY, payload.roomCode);
    localStorage.setItem(PLAYER_NAME_KEY, playerName);
    setRoomCode(payload.roomCode);
    replaceRoomCodeInUrl(payload.roomCode);
  }

  function clearRoomSession({ preserveRoomCode = false }: { preserveRoomCode?: boolean } = {}) {
    const currentRoomCode = room?.roomCode || roomCode;
    localStorage.removeItem(PLAYER_ID_KEY);
    if (!preserveRoomCode) {
      localStorage.removeItem(ROOM_CODE_KEY);
      replaceRoomCodeInUrl(null);
    } else if (currentRoomCode) {
      localStorage.setItem(ROOM_CODE_KEY, currentRoomCode);
      replaceRoomCodeInUrl(currentRoomCode);
    }
    setRoom(null);
    setRoomCode(preserveRoomCode ? currentRoomCode : "");
  }

  function createRoom() {
    const cleanName = name.trim();
    if (!cleanName) {
      setError("請先輸入暱稱。");
      return;
    }
    setIsBusy(true);
    socket.emit(
      "createRoom",
      {
        name: cleanName,
        playerId: localStorage.getItem(PLAYER_ID_KEY) || undefined
      },
      (payload) => {
        setIsBusy(false);
        if ("error" in payload) {
          setError(payload.error);
          return;
        }
        persistSession(payload, cleanName);
      }
    );
  }

  function joinRoom() {
    const cleanName = name.trim();
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanName || !cleanCode) {
      setError("請輸入暱稱和房號。");
      return;
    }
    setIsBusy(true);
    socket.emit(
      "joinRoom",
      {
        roomCode: cleanCode,
        name: cleanName,
        playerId: localStorage.getItem(PLAYER_ID_KEY) || undefined
      },
      (payload) => {
        setIsBusy(false);
        if ("error" in payload) {
          setError(payload.error);
          return;
        }
        persistSession(payload, cleanName);
      }
    );
  }

  function leaveCurrentRoom() {
    socket.emit("leaveRoom");
    clearRoomSession({ preserveRoomCode: true });
    setError("");
  }

  return (
    <main
      className="app-shell"
      style={
        {
          "--hall-bg": `url(${councilHallUrl})`
        } as CSSProperties
      }
    >
      <section className="hero-band">
        <div>
          <p className="eyebrow">bevis與他的朋友私人遊戲 不公開</p>
          <h1>阿瓦隆線上版</h1>
        </div>
        <div className={connected ? "connection online" : "connection offline"}>
          {connected ? <Circle size={14} fill="currentColor" /> : <WifiOff size={16} />}
          {connected ? "已連線" : "離線"}
        </div>
      </section>

      {!room ? (
        <WelcomePanel
          name={name}
          roomCode={roomCode}
          error={error}
          isBusy={isBusy}
          onNameChange={setName}
          onRoomCodeChange={(value) => setRoomCode(value.toUpperCase())}
          onCreate={createRoom}
          onJoin={joinRoom}
          lobbyRooms={lobbyRooms}
        />
      ) : (
        <GameRoom room={room} error={error} onLeave={leaveCurrentRoom} />
      )}
    </main>
  );
}

type WelcomePanelProps = {
  name: string;
  roomCode: string;
  error: string;
  isBusy: boolean;
  onNameChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  lobbyRooms: LobbyRoomSummary[];
};

function WelcomePanel(props: WelcomePanelProps) {
  return (
    <section className="welcome-grid">
      <div className="join-panel">
        <label>
          暱稱
          <input value={props.name} maxLength={18} onChange={(event) => props.onNameChange(event.target.value)} placeholder="例如：亞瑟" />
        </label>
        <label>
          房號
          <input
            value={props.roomCode}
            maxLength={4}
            onChange={(event) => props.onRoomCodeChange(event.target.value)}
            placeholder="ABCD"
          />
        </label>
        {props.error ? <p className="error-line">{props.error}</p> : null}
        <div className="button-row">
          <button className="primary-button" onClick={props.onCreate} disabled={props.isBusy}>
            <Plus size={18} />
            建立房間
          </button>
          <button className="secondary-button" onClick={props.onJoin} disabled={props.isBusy}>
            <LogIn size={18} />
            加入房間
          </button>
        </div>
      </div>
      <LobbyRoomList rooms={props.lobbyRooms} />
      <RolePreview />
    </section>
  );
}

function LobbyRoomList({ rooms }: { rooms: LobbyRoomSummary[] }) {
  return (
    <div className="panel-block public-lobby">
      <div className="panel-title">
        <Users size={17} />
        目前遊戲
      </div>
      <p className="public-lobby-note">只顯示狀態，不公開房號。</p>
      {rooms.length === 0 ? (
        <p className="muted-line">目前沒有公開中的房間。</p>
      ) : (
        <div className="public-room-list">
          {rooms.slice(0, 8).map((room, index) => (
            <div className="public-room-row" key={`${room.hostName}-${room.updatedAt}-${index}`}>
              <div>
                <strong>{room.hostName} 的遊戲</strong>
                <span>{phaseLabel[room.phase]}</span>
              </div>
              <b>
                {room.playerCount}/{room.maxPlayers}
              </b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GameRoom({ room, error, onLeave }: { room: RoomView; error: string; onLeave: () => void }) {
  const isHost = room.you?.isHost ?? false;
  const isLobby = room.game.phase === "lobby";
  const [teamDraft, setTeamDraft] = useState<string[]>([]);
  const [excaliburHolderId, setExcaliburHolderId] = useState<string | null>(null);
  const isTeamDrafting = room.game.phase === "team-building" && room.you?.id === room.game.leaderId;
  const excaliburCandidates = teamDraft.filter((id) => id !== room.game.leaderId);

  useEffect(() => {
    setTeamDraft([]);
    setExcaliburHolderId(null);
  }, [room.roomCode, room.game.phase, room.game.questIndex, room.game.leaderId, room.game.teamSize]);

  useEffect(() => {
    if (room.game.phase !== "team-building") {
      return;
    }
    setTeamDraft(room.game.proposedTeam);
    setExcaliburHolderId(room.game.excaliburHolderId);
  }, [room.game.phase, room.game.proposedTeam, room.game.excaliburHolderId]);

  useEffect(() => {
    if (excaliburHolderId && !excaliburCandidates.includes(excaliburHolderId)) {
      setExcaliburHolderId(null);
    }
  }, [excaliburCandidates, excaliburHolderId]);

  function toggleTeamDraft(playerId: string) {
    if (!isTeamDrafting) {
      return;
    }
    setTeamDraft((current) => {
      let next: string[];
      if (current.includes(playerId)) {
        next = current.filter((id) => id !== playerId);
      } else if (current.length >= room.game.teamSize) {
        next = current;
      } else {
        next = [...current, playerId];
      }
      if (excaliburHolderId && !next.includes(excaliburHolderId)) {
        setExcaliburHolderId(null);
      }
      return next;
    });
  }

  useEffect(() => {
    if (!isTeamDrafting) {
      return;
    }
    const timer = window.setTimeout(() => {
      socket.emit("updateTeamDraft", teamDraft, excaliburHolderId);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [isTeamDrafting, teamDraft, excaliburHolderId]);

  return (
    <section className="room-layout">
      <header className="room-header">
        <div>
          <span className="eyebrow">Room</span>
          <div className="room-code">
            {room.roomCode}
            <button className="icon-button" aria-label="複製房號" title="複製房號" onClick={() => navigator.clipboard?.writeText(room.roomCode)}>
              <Copy size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="複製邀請網址"
              title="複製邀請網址"
              onClick={() => navigator.clipboard?.writeText(roomInviteUrl(room.roomCode))}
            >
              <LinkIcon size={16} />
            </button>
          </div>
        </div>
        <div className="room-actions">
          <IdleStatus room={room} />
          <div className="phase-pill">
            <Flag size={16} />
            {phaseLabel[room.game.phase]}
          </div>
          <button className="secondary-button compact-button" onClick={onLeave}>
            <LogOut size={17} />
            離開房間
          </button>
        </div>
      </header>

      {error ? <p className="error-line">{error}</p> : null}

      <div className={isLobby ? "game-grid lobby-game-grid" : "game-grid active-game-grid"}>
        <aside className="side-panel">
          <PlayerList room={room} teamDraft={teamDraft} onToggleTeamDraft={isTeamDrafting ? toggleTeamDraft : undefined} />
          <HostControls room={room} />
        </aside>

        <section className="play-panel">
          <RoleCard room={room} />
          {room.game.phase === "assassination" ? <PublicEvilReveal room={room} /> : null}
          <MissionBoard room={room} />
          <PhasePanel
            room={room}
            teamDraft={teamDraft}
            setTeamDraft={setTeamDraft}
            excaliburHolderId={excaliburHolderId}
            setExcaliburHolderId={setExcaliburHolderId}
          />
          {isHost && room.game.phase === "finished" ? <ResetControl /> : null}
        </section>

        {isLobby ? (
          <aside className="side-panel">
            <VoteHistory room={room} />
            <LadyHistory room={room} />
            <BotOpinions room={room} />
            <RolePreview room={room} />
          </aside>
        ) : (
          <aside className="side-panel status-side-panel">
            <CompactStatusPanel room={room} />
          </aside>
        )}
      </div>
    </section>
  );
}

function IdleStatus({ room }: { room: RoomView }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30 * 1000);
    return () => window.clearInterval(timer);
  }, [room.roomCode]);

  const remainingMs = Math.max(0, room.idleTimeoutAt - now);
  const isWarning = now >= room.idleWarningAt;

  return (
    <div className={isWarning ? "idle-pill warning" : "idle-pill"} title="任何房間操作都會重置閒置時間">
      <Clock size={16} />
      閒置 {formatDuration(remainingMs)} 後關房
    </div>
  );
}

function PlayerList({
  room,
  teamDraft,
  onToggleTeamDraft
}: {
  room: RoomView;
  teamDraft?: string[];
  onToggleTeamDraft?: (playerId: string) => void;
}) {
  const leaderId = room.game.leaderId;
  const canRemoveBots = room.you?.isHost && (room.game.phase === "lobby" || room.game.phase === "finished");
  const displayedPlayers = orderedRoomPlayers(room);
  return (
    <div className="panel-block">
      <div className="panel-title">
        <Users size={17} />
        玩家 {room.players.length}/{MAX_PLAYERS}
      </div>
      <div className="seat-grid">
        {displayedPlayers.map((player) => {
          const badge = intelBadge(room, player.id);
          const visibleRole = visibleRoleForPlayer(room, player.id);
          const isLeader = leaderId === player.id;
          const isDraftMember = teamDraft?.includes(player.id) ?? false;
          const isQuestMember = room.game.proposedTeam.includes(player.id) || isDraftMember;
          const isLadyHolder = room.game.ladyEnabled && room.game.ladyHolderId === player.id;
          const isPendingTeamVote = room.game.phase === "team-vote" && !room.game.teamVotesSubmitted.includes(player.id);
          const isPendingMissionVote =
            room.game.phase === "mission" && room.game.proposedTeam.includes(player.id) && !room.game.missionVotesSubmitted.includes(player.id);
          const orderIndex = seatOrderIndex(room, player.id);
          const cardClass = playerSeatClass(room, player, isDraftMember, Boolean(onToggleTeamDraft));
          const cardStyle = visibleRole ? roleCardStyle(visibleRole, roleVariantIndexForPlayer(room, player.id, visibleRole)) : undefined;
          const pendingLabel = isPendingTeamVote ? "尚未表決" : isPendingMissionVote ? "尚未送出任務" : null;
          return (
            <div
              className={cardClass}
              key={player.id}
              style={cardStyle}
              role={onToggleTeamDraft ? "button" : undefined}
              tabIndex={onToggleTeamDraft ? 0 : undefined}
              aria-pressed={onToggleTeamDraft ? isDraftMember : undefined}
              title={onToggleTeamDraft ? "點卡片選入或移出任務隊伍" : undefined}
              onClick={() => onToggleTeamDraft?.(player.id)}
              onKeyDown={(event) => {
                if (!onToggleTeamDraft || (event.key !== "Enter" && event.key !== " ")) {
                  return;
                }
                event.preventDefault();
                onToggleTeamDraft(player.id);
              }}
            >
              <div className="seat-corner-marks">
                {isLeader ? (
                  <span className="seat-corner-mark leader-mark" title="隊長" aria-label="隊長">
                    <Crown size={18} />
                  </span>
                ) : null}
                {isQuestMember ? (
                  <span className="seat-corner-mark quest-mark" title="任務隊員" aria-label="任務隊員">
                    <Shield size={18} />
                  </span>
                ) : null}
              </div>
              <div className="seat-bottom-marks">
                {isLadyHolder ? (
                  <span className="seat-bottom-mark lady-holder-mark" title="湖中女神持有者" aria-label="湖中女神持有者">
                    <Waves size={15} />
                    女神
                  </span>
                ) : null}
                {orderIndex !== null ? (
                  <span className="seat-bottom-mark seat-order-mark" title={`隊長順位 ${orderIndex + 1}`} aria-label={`隊長順位 ${orderIndex + 1}`}>
                    {orderIndex + 1}
                  </span>
                ) : null}
              </div>
              {pendingLabel ? (
                <span className="seat-pending-mark" title={pendingLabel} aria-label={pendingLabel}>
                  <Hourglass size={16} />
                </span>
              ) : null}
              <div className="seat-card-face">
                <span className={player.connected ? "status-dot online-dot" : "status-dot offline-dot"} />
                <div className="seat-name">{player.name}</div>
                <div className="seat-tags">
                  {player.isHost ? <span className="seat-tag host">房主</span> : null}
                  {player.isBot ? <span className="seat-tag bot">電腦</span> : null}
                  {leaderId === player.id ? <span className="seat-tag leader">隊長</span> : null}
                  {room.you?.id === player.id ? <span className="seat-tag you">你</span> : null}
                </div>
                {badge ? <div className={`intel-badge intel-${badge.tone}`}>{badge.text}</div> : null}
                {revealedRoleName(room, player.id) ? <div className="role-name-badge">{revealedRoleName(room, player.id)}</div> : null}
              </div>
              {canRemoveBots && player.isBot ? (
                <button
                  className="mini-icon-button"
                  type="button"
                  title={`移除 ${player.name}`}
                  aria-label={`移除 ${player.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    socket.emit("removeBot", player.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HostControls({ room }: { room: RoomView }) {
  if (!room.you?.isHost || room.game.phase !== "lobby") {
    return null;
  }

  return (
    <div className="panel-block host-controls">
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={room.ladyEnabledSetting}
          onChange={(event) => socket.emit("setLadyEnabled", event.currentTarget.checked)}
        />
        <span className="toggle-track" />
        <span className="toggle-label">
          <Waves size={17} />
          湖中女神
        </span>
      </label>
      <label className="setting-select-row">
        <span className="toggle-label">
          <Waves size={17} />
          女神起始
        </span>
        <select
          value={room.ladyHolderModeSetting}
          disabled={!room.ladyEnabledSetting}
          onChange={(event) => socket.emit("setLadyHolderMode", event.currentTarget.value as LadyHolderMode)}
        >
          <option value="tail">最尾端玩家</option>
          <option value="random">隨機玩家</option>
        </select>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={room.lancelotEnabledSetting}
          onChange={(event) => socket.emit("setLancelotEnabled", event.currentTarget.checked)}
        />
        <span className="toggle-track" />
        <span className="toggle-label">
          <RotateCcw size={17} />
          蘭斯洛特
        </span>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={room.excaliburEnabledSetting}
          onChange={(event) => socket.emit("setExcaliburEnabled", event.currentTarget.checked)}
        />
        <span className="toggle-track" />
        <span className="toggle-label">
          <Swords size={17} />
          王者之劍
        </span>
      </label>
      <BotAiSettings room={room} />
      <button className="secondary-button full-button" disabled={room.players.length >= MAX_PLAYERS} onClick={() => socket.emit("addBot")}>
        <Bot size={18} />
        新增電腦
      </button>
      <button className="primary-button full-button" disabled={room.players.length < MIN_PLAYERS} onClick={() => socket.emit("startGame")}>
        <Swords size={18} />
        開始遊戲
      </button>
    </div>
  );
}

function BotAiSettings({ room }: { room: RoomView }) {
  const [enabled, setEnabled] = useState(room.botAiSetting.enabled);
  const [provider, setProvider] = useState<BotAiProvider>(room.botAiSetting.provider);
  const [baseUrl, setBaseUrl] = useState(room.botAiSetting.baseUrl);
  const [model, setModel] = useState(room.botAiSetting.model);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setEnabled(room.botAiSetting.enabled);
    setProvider(room.botAiSetting.provider);
    setBaseUrl(room.botAiSetting.baseUrl);
    setModel(room.botAiSetting.model);
    setApiKey("");
  }, [room.roomCode, room.botAiSetting.enabled, room.botAiSetting.provider, room.botAiSetting.baseUrl, room.botAiSetting.model]);

  function updateProvider(nextProvider: BotAiProvider) {
    setProvider(nextProvider);
    const defaults = botAiDefaults[nextProvider];
    if (defaults.baseUrl) {
      setBaseUrl(defaults.baseUrl);
    }
    if (defaults.model) {
      setModel(defaults.model);
    }
  }

  function saveSettings() {
    socket.emit("setBotAiSettings", {
      enabled,
      provider,
      baseUrl,
      model,
      apiKey: apiKey.trim() || undefined
    });
  }

  return (
    <details className="bot-ai-config">
      <summary>
        <span>
          <Bot size={17} />
          API 電腦
        </span>
        <b>{room.botAiSetting.enabled ? "已開啟" : "規則 AI"}</b>
      </summary>
      <div className="bot-ai-fields">
        <label className="toggle-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
          <span className="toggle-track" />
          <span className="toggle-label">用 API 強化電腦</span>
        </label>
        <label>
          服務
          <select value={provider} disabled={!enabled} onChange={(event) => updateProvider(event.currentTarget.value as BotAiProvider)}>
            {Object.entries(botAiDefaults).map(([value, config]) => (
              <option value={value} key={value}>
                {config.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Base URL
          <input value={baseUrl} disabled={!enabled} onChange={(event) => setBaseUrl(event.currentTarget.value)} placeholder="https://api.openai.com/v1" />
        </label>
        <label>
          Model
          <input value={model} disabled={!enabled} onChange={(event) => setModel(event.currentTarget.value)} placeholder="gpt-5-mini" />
        </label>
        <label>
          API Key
          <input
            value={apiKey}
            disabled={!enabled}
            type="password"
            autoComplete="off"
            onChange={(event) => setApiKey(event.currentTarget.value)}
            placeholder={room.botAiSetting.apiKeyConfigured ? "已設定，留空沿用" : "貼上 API Key"}
          />
        </label>
        <p className="bot-ai-note">
          {room.botAiSetting.apiKeyConfigured ? "Key 已存在伺服器記憶體，不會回傳到玩家畫面。" : "未填 Key 時會維持本機規則 AI。"}
        </p>
        <button className="secondary-button full-button" type="button" onClick={saveSettings}>
          <Check size={17} />
          套用電腦設定
        </button>
      </div>
    </details>
  );
}

function ResetControl() {
  return (
    <button className="secondary-button full-button" onClick={() => socket.emit("resetRoom")}>
      <RotateCcw size={18} />
      回到大廳
    </button>
  );
}

function MissionBoard({ room }: { room: RoomView }) {
  const playerCount = Math.max(room.players.length, MIN_PLAYERS);
  const successCount = room.game.quests.filter((quest) => quest.success).length;
  const failureCount = room.game.quests.filter((quest) => !quest.success).length;
  const ladyIsActiveOrPlanned = room.game.phase === "lobby" ? room.ladyEnabledSetting : room.game.ladyEnabled;
  const latestLancelotDraw = room.game.lancelotDraws[room.game.lancelotDraws.length - 1];
  return (
    <div className="mission-board">
      <div className="board-top">
        <div className="panel-title">
          <Flag size={17} />
          任務盤
        </div>
        <BoardRoundStatus room={room} />
        <div className="score-runes" aria-label="任務勝敗">
          <span className="score-good">{successCount}</span>
          <small>:</small>
          <span className="score-evil">{failureCount}</span>
        </div>
      </div>
      <div className="quest-path">
        {[0, 1, 2, 3, 4].map((index) => {
          const quest = room.game.quests.find((item) => item.index === index);
          const isCurrent = room.game.questIndex === index && room.game.phase !== "lobby" && room.game.phase !== "finished";
          return (
            <div className="quest-step" key={index}>
              <div
                className={`quest-medallion ${quest?.success ? "quest-success" : ""} ${quest && !quest.success ? "quest-fail" : ""} ${isCurrent ? "quest-current" : ""}`}
              >
                <small>任務 {index + 1}</small>
                <strong>{questTeamSizes[playerCount]?.[index] || "-"}</strong>
                <span>{quest ? (quest.success ? "成功" : `${quest.failCount} 失敗`) : questFailText(playerCount, index)}</span>
              </div>
              <div className="quest-caption">{quest ? quest.team.map((id) => playerName(room, id)).join("、") : `${questTeamSizes[playerCount]?.[index] || "-"} 人`}</div>
            </div>
          );
        })}
      </div>
      <div className="reject-track" aria-label="否決次數">
        <span className="reject-label">否決軌</span>
        {[1, 2, 3, 4, 5].map((value) => (
          <span className={value <= room.game.failedVoteCount ? "reject-token active" : "reject-token"} key={value}>
            {value}
          </span>
        ))}
      </div>
      <div className="board-foot">
        <span>連續否決 {room.game.failedVoteCount}/5</span>
        {ladyIsActiveOrPlanned ? (
          <span>{room.game.phase === "lobby" ? "湖中女神：開啟" : `湖中女神持有者：${playerName(room, room.game.ladyHolderId)}`}</span>
        ) : (
          <span>湖中女神未啟用</span>
        )}
      </div>
      {room.game.lancelotEnabled ? (
        <div className={latestLancelotDraw?.switched ? "lancelot-event switched" : "lancelot-event"}>
          <RotateCcw size={16} />
          {latestLancelotDraw
            ? `任務 ${latestLancelotDraw.questIndex + 1} 後抽到${latestLancelotDraw.switched ? "忠誠變化" : "空白"}，剩 ${room.game.lancelotDeckRemaining} 張`
            : "蘭斯洛特忠誠牌庫待命"}
        </div>
      ) : null}
    </div>
  );
}

function BoardRoundStatus({ room }: { room: RoomView }) {
  if (room.game.phase === "team-building" && room.game.proposedTeam.length > 0) {
    return (
      <div className="board-round-status">
        <strong>預選隊伍</strong>
        <span>
          {room.game.proposedTeam.length}/{room.game.teamSize}
        </span>
        <small>{room.game.proposedTeam.map((id) => playerName(room, id)).join("、")}</small>
      </div>
    );
  }

  if (room.game.phase === "team-vote") {
    const pending = room.players.filter((player) => !room.game.teamVotesSubmitted.includes(player.id));
    return (
      <div className="board-round-status vote-status">
        <strong>隊伍表決</strong>
        <span>
          已投 {room.game.teamVotesSubmitted.length}/{room.players.length}
        </span>
        <small>{pending.length > 0 ? `未投：${pending.map((player) => player.name).join("、")}` : "全員已投"}</small>
      </div>
    );
  }

  if (room.game.phase === "mission") {
    const pending = room.game.proposedTeam.filter((id) => !room.game.missionVotesSubmitted.includes(id));
    return (
      <div className="board-round-status mission-status">
        <strong>任務送出</strong>
        <span>
          已送出 {room.game.missionVotesSubmitted.length}/{room.game.proposedTeam.length}
        </span>
        <small>{pending.length > 0 ? `未送出：${pending.map((id) => playerName(room, id)).join("、")}` : "任務卡已收齊"}</small>
      </div>
    );
  }

  return null;
}

function PublicEvilReveal({ room }: { room: RoomView }) {
  if (room.publicEvilPlayerIds.length === 0) {
    return null;
  }

  return (
    <div className="action-panel evil-reveal-panel">
      <h2>邪惡陣營公開</h2>
      <p>好人完成三次任務。現在只公開邪惡陣營，邪惡方要共同猜誰是梅林。</p>
      <div className="team-strip">
        {room.publicEvilPlayerIds.map((id) => (
          <span className="evil-chip" key={id}>
            {playerName(room, id)}
          </span>
        ))}
      </div>
    </div>
  );
}

function RoleCard({ room }: { room: RoomView }) {
  if (room.game.phase === "lobby") {
    return (
      <div className="identity-panel idle">
        <Sparkles size={22} />
        <div>
          <h2>等待開局</h2>
          <p>{room.players.length < MIN_PLAYERS ? `還需要 ${MIN_PLAYERS - room.players.length} 位玩家。` : "房主可以開始遊戲。"}</p>
        </div>
      </div>
    );
  }

  if (!room.yourRole) {
    return null;
  }

  const role = ROLE_DEFINITIONS[room.yourRole];
  const currentSide = room.yourAllegiance || role.allegiance;
  const side = currentSide === "good" ? "亞瑟陣營" : "邪惡陣營";
  const switchedSide = currentSide !== role.allegiance;
  return (
    <div className={`identity-panel ${currentSide === "good" ? "identity-good" : "identity-evil"}`}>
      <div className="identity-main">
        <div className="role-portrait card-art" style={roleCardStyle(room.yourRole, roleVariantIndexForPlayer(room, room.you?.id || "", room.yourRole))} />
        <div className="identity-copy">
          <span>{side}</span>
          <h2>{role.name}</h2>
          <p>{roleBrief(room.yourRole)}</p>
          {switchedSide ? (
            <div className="knowledge-line lancelot-note">
              <RotateCcw size={16} />
              <strong>目前忠誠</strong>
              <span>蘭斯洛特忠誠牌已讓你改為{currentSide === "good" ? "亞瑟陣營" : "邪惡陣營"}</span>
            </div>
          ) : null}
          {room.roleKnowledge.map((knowledge) => (
            <div className="knowledge-line" key={knowledge.label}>
              <Eye size={16} />
              <strong>{knowledge.label}</strong>
              <span>{knowledge.playerIds.length > 0 ? knowledge.playerIds.map((id) => playerName(room, id)).join("、") : "無"}</span>
            </div>
          ))}
          {room.ladyResult ? (
            <div className="knowledge-line lady-result">
              <Waves size={16} />
              <strong>湖中女神結果</strong>
              <span>
                {playerName(room, room.ladyResult.targetId)} 是{room.ladyResult.allegiance === "good" ? "好人陣營" : "邪惡陣營"}
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <InlineTurnAction room={room} />
    </div>
  );
}

function roleBrief(roleId: RoleId): string {
  const briefs: Record<RoleId, string> = {
    merlin: "知道多數邪惡玩家；別讓刺客看出你。",
    percival: "看見梅林候選；保護真正的梅林。",
    loyal: "無額外情報，靠表決與任務紀錄判斷。",
    lancelotGood: "目前為亞瑟陣營；忠誠牌可能改變你。",
    assassin: "邪惡陣營；好人三勝後共同刺殺梅林。",
    morgana: "邪惡陣營；會混入派西維爾的梅林候選。",
    mordred: "邪惡陣營；梅林看不見你。",
    oberon: "邪惡陣營；你不與其他壞人互認。",
    lancelotEvil: "目前為邪惡陣營；忠誠牌可能改變你。",
    minion: "邪惡陣營；支援同夥破壞任務。"
  };
  return briefs[roleId];
}

function PhasePanel({
  room,
  teamDraft,
  excaliburHolderId,
  setExcaliburHolderId
}: {
  room: RoomView;
  teamDraft: string[];
  setTeamDraft: (value: string[]) => void;
  excaliburHolderId: string | null;
  setExcaliburHolderId: (value: string | null) => void;
}) {
  if (room.game.phase === "lobby") {
    return <LobbyPanel room={room} />;
  }
  if (room.game.phase === "team-building") {
    return <TeamBuilder room={room} selected={teamDraft} excaliburHolderId={excaliburHolderId} setExcaliburHolderId={setExcaliburHolderId} />;
  }
  if (room.game.phase === "team-vote") {
    return null;
  }
  if (room.game.phase === "mission") {
    return null;
  }
  if (room.game.phase === "excalibur") {
    return <ExcaliburPanel room={room} />;
  }
  if (room.game.phase === "lady") {
    return <LadyOfLake room={room} />;
  }
  if (room.game.phase === "assassination") {
    return <Assassination room={room} />;
  }
  return <Finished room={room} />;
}

function LadyOfLake({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const isHolder = room.game.ladyHolderId === youId;
  const candidates = room.players.filter((player) => player.id !== youId && !room.game.ladyUsedPlayerIds.includes(player.id));
  const pending = room.ladyPendingResult;
  const canChooseTarget = isHolder && !pending && candidates.length > 0;

  return (
    <div className="action-panel lake-panel">
      <h2>湖中女神</h2>
      <p>
        持有者是 <strong>{playerName(room, room.game.ladyHolderId)}</strong>。先私下看真實陣營，再選擇要公開宣告什麼。
      </p>
      {pending ? (
        <div className="lake-result-box">
          <strong>{playerName(room, pending.targetId)} 真實是{pending.allegiance === "good" ? "好人" : "邪惡"}陣營</strong>
          <span>選擇你要公開宣告的陣營。</span>
          <div className="button-row">
            <button className="primary-button" onClick={() => socket.emit("useLadyOfLake", pending.targetId, "good")}>
              <Check size={18} />
              宣告好人
            </button>
            <button className="danger-button" onClick={() => socket.emit("useLadyOfLake", pending.targetId, "evil")}>
              <X size={18} />
              宣告邪惡
            </button>
          </div>
        </div>
      ) : room.ladyResult ? (
        <p className="lake-result-text">
          你查看了 <strong>{playerName(room, room.ladyResult.targetId)}</strong>：
          {room.ladyResult.allegiance === "good" ? "好人陣營" : "邪惡陣營"}
        </p>
      ) : null}
      {canChooseTarget ? (
        <div className="select-grid">
          {candidates.map((player) => (
            <button className="select-player" key={player.id} onClick={() => socket.emit("useLadyOfLake", player.id)}>
              <Waves size={18} />
              {player.name}
            </button>
          ))}
        </div>
      ) : isHolder && !pending ? (
        <div className="button-row">
          <p className="waiting-line">目前沒有可查看的目標，可以直接進入下一輪組隊。</p>
          <button className="secondary-button" onClick={() => socket.emit("useLadyOfLake", "", null)}>
            <RotateCcw size={18} />
            繼續
          </button>
        </div>
      ) : !pending ? (
        <p className="waiting-line">等待持有者使用湖中女神。</p>
      ) : null}
    </div>
  );
}

function LobbyPanel({ room }: { room: RoomView }) {
  return (
    <div className="action-panel">
      <h2>大廳</h2>
      <p>房號給朋友加入，湊齊 5 到 10 人後由房主開始。</p>
      <div className="lobby-meter">
        <span style={{ width: `${Math.min(100, (room.players.length / MIN_PLAYERS) * 100)}%` }} />
      </div>
    </div>
  );
}

function TeamBuilder({
  room,
  selected,
  excaliburHolderId,
  setExcaliburHolderId
}: {
  room: RoomView;
  selected: string[];
  excaliburHolderId: string | null;
  setExcaliburHolderId: (value: string | null) => void;
}) {
  const isLeader = room.you?.id === room.game.leaderId;
  const teamSize = room.game.teamSize;
  const excaliburCandidates = selected.filter((id) => id !== room.game.leaderId);
  const needsExcaliburHolder = room.game.excaliburEnabled;

  return (
    <div className="action-panel">
      <h2>第 {room.game.questIndex + 1} 次任務組隊</h2>
      <p>
        隊長是 <strong>{playerName(room, room.game.leaderId)}</strong>，需要 <strong>{teamSize}</strong> 人。
      </p>
      <p className="muted-line">{isLeader ? "直接點左邊玩家卡片選人；盾牌代表已選入任務。" : "等待隊長點選左邊卡片組隊。"}</p>
      <TeamDraftSummary room={room} selected={selected} teamSize={teamSize} />
      {needsExcaliburHolder && isLeader ? (
        <div className="excalibur-picker">
          <strong>王者之劍交給誰</strong>
          <div className="select-grid compact-select-grid">
            {excaliburCandidates.map((id) => (
              <button
                className={excaliburHolderId === id ? "select-player selected" : "select-player"}
                key={id}
                onClick={() => setExcaliburHolderId(id)}
              >
                <Swords size={18} />
                {playerName(room, id)}
              </button>
            ))}
          </div>
          {selected.includes(room.game.leaderId || "") ? <p className="muted-line">隊長不能把王者之劍交給自己。</p> : null}
        </div>
      ) : null}
      {isLeader ? (
        <button
          className="primary-button full-button"
          disabled={selected.length !== teamSize || (needsExcaliburHolder && !excaliburHolderId)}
          onClick={() => socket.emit("proposeTeam", selected, excaliburHolderId)}
        >
          <Vote size={18} />
          提交隊伍 {selected.length}/{teamSize}
        </button>
      ) : (
        <p className="muted-line">等待隊長提交隊伍。</p>
      )}
    </div>
  );
}

function TeamDraftSummary({ room, selected, teamSize }: { room: RoomView; selected: string[]; teamSize: number }) {
  return (
    <div className="team-draft-summary">
      <div>
        <strong>目前隊伍</strong>
        <span>
          {selected.length}/{teamSize}
        </span>
      </div>
      {selected.length > 0 ? (
        <div className="team-strip">
          {selected.map((id) => (
            <span key={id}>{playerName(room, id)}</span>
          ))}
        </div>
      ) : (
        <p className="muted-line">尚未選人。</p>
      )}
    </div>
  );
}

function TeamVote({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const voted = room.game.teamVotesSubmitted.includes(youId);
  return (
    <div className="action-panel">
      <h2>隊伍表決</h2>
      <TeamVoteCards room={room} />
      <p className="muted-line">
        已投票 {room.game.teamVotesSubmitted.length}/{room.players.length}
      </p>
      {voted ? (
        <p className="waiting-line">你已投票，等待其他玩家。</p>
      ) : (
        <p className="waiting-line">請在身份卡右側投票。</p>
      )}
    </div>
  );
}

function MissionVote({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const isOnTeam = room.game.proposedTeam.includes(youId);
  const submitted = room.game.missionVotesSubmitted.includes(youId);
  const canFail = room.yourAllegiance === "evil";

  return (
    <div className="action-panel">
      <h2>任務執行</h2>
      <MissionSubmitStatus room={room} />
      <p className="muted-line">
        已提交 {room.game.missionVotesSubmitted.length}/{room.game.proposedTeam.length}
      </p>
      {!isOnTeam ? <p className="waiting-line">你不在任務隊伍中，等待結果。</p> : null}
      {isOnTeam && submitted ? <p className="waiting-line">你已提交任務結果。</p> : null}
      {isOnTeam && !submitted ? <p className="waiting-line">{canFail ? "請在身份卡右側選擇成功或失敗。" : "請在身份卡右側送出任務成功。"}</p> : null}
    </div>
  );
}

function MissionSubmitStatus({ room }: { room: RoomView }) {
  return (
    <div className="vote-team-grid mission-submit-grid">
      {room.game.proposedTeam.map((id) => {
        const submitted = room.game.missionVotesSubmitted.includes(id);
        return (
          <div className={submitted ? "vote-team-card mission-submitted" : "vote-team-card mission-pending"} key={id}>
            {submitted ? <Check size={18} /> : <Clock size={18} />}
            <strong>{playerName(room, id)}</strong>
            <span>{submitted ? "已送出" : "尚未送出"}</span>
          </div>
        );
      })}
    </div>
  );
}

function ExcaliburPanel({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const isHolder = room.game.excaliburHolderId === youId;
  const candidates = room.game.proposedTeam.filter((id) => id !== youId);

  return (
    <div className="action-panel excalibur-panel">
      <h2>王者之劍</h2>
      <p>
        持有者是 <strong>{playerName(room, room.game.excaliburHolderId)}</strong>。可以更換一名其他任務隊員的任務卡，也可以不使用。
      </p>
      <TeamNames room={room} />
      {isHolder && room.game.excaliburVotes ? (
        <div className="excalibur-vote-grid">
          {candidates.map((id) => (
            <span className={room.game.excaliburVotes?.[id] ? "quest-success" : "quest-fail"} key={id}>
              {playerName(room, id)}：{room.game.excaliburVotes?.[id] ? "成功" : "失敗"}
            </span>
          ))}
        </div>
      ) : null}
      {isHolder ? (
        <div className="select-grid">
          {candidates.map((id) => (
            <button className="select-player" key={id} onClick={() => socket.emit("useExcalibur", id)}>
              <Swords size={18} />
              更換 {playerName(room, id)}
            </button>
          ))}
          <button className="secondary-button" onClick={() => socket.emit("useExcalibur", null)}>
            不使用
          </button>
        </div>
      ) : (
        <p className="waiting-line">等待王者之劍持有者決定。</p>
      )}
    </div>
  );
}

function Assassination({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const canVote = room.yourAllegiance === "evil";
  const voted = room.game.assassinationVotesSubmitted.includes(youId);
  return (
    <div className="action-panel final-panel">
      <h2>刺殺梅林</h2>
      <p>
        亞瑟陣營完成三次任務，邪惡陣營共同投票猜梅林。
        已投 {room.game.assassinationVotesSubmitted.length}/{room.game.assassinationVoteCount}
      </p>
      {canVote && !voted ? (
        <div className="select-grid">
          {room.players
            .filter((player) => !room.publicEvilPlayerIds.includes(player.id))
            .map((player) => (
              <button className="select-player" key={player.id} onClick={() => socket.emit("assassinate", player.id)}>
                <Target size={18} />
                {player.name}
              </button>
            ))}
        </div>
      ) : canVote ? (
        <p className="waiting-line">你已提交猜測，等待其他邪惡玩家。</p>
      ) : (
        <p className="waiting-line">等待邪惡陣營做最後刺殺。</p>
      )}
    </div>
  );
}

function Finished({ room }: { room: RoomView }) {
  return (
    <div className={room.game.winner === "good" ? "action-panel result-good" : "action-panel result-evil"}>
      <h2>{room.game.winner === "good" ? "亞瑟陣營獲勝" : "邪惡陣營獲勝"}</h2>
      <p>{room.game.winReason}</p>
      <div className="reveal-grid">
        {room.players.map((player) => {
          const role = room.revealedRoles?.[player.id];
          return (
            <div className="reveal-row" key={player.id}>
              <span>{player.name}</span>
              <strong className={role ? roleTone[role] : ""}>{role ? ROLE_DEFINITIONS[role].name : "未知"}</strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RolePreview({ room, compact = false }: { room?: RoomView; compact?: boolean }) {
  const playerCount = room ? Math.max(room.players.length, MIN_PLAYERS) : 0;
  const roles = room ? getRoleSet(playerCount, { lancelotEnabled: room.lancelotEnabledSetting && playerCount >= 7 }) : fullRoleGallery;
  const goodCount = roles.filter((role) => roleSide(role) === "good").length;
  const evilCount = roles.length - goodCount;
  const title = room ? `${roles.length} 人角色` : "角色圖鑑";

  if (compact && room) {
    return (
      <details className="panel-block role-preview collapsed-role-preview">
        <summary>
          <span>
            <Crown size={17} />
            {title}
          </span>
          <b>
            好 {goodCount} / 壞 {evilCount}
          </b>
        </summary>
        <RoleGallery roles={roles} />
      </details>
    );
  }

  return (
    <div className="panel-block role-preview">
      <div className="panel-title">
        <Crown size={17} />
        {title}
      </div>
      {room ? (
        <div className="role-config-summary">
          <span className="chip-good">好人 {goodCount}</span>
          <span className="chip-evil">邪惡 {evilCount}</span>
        </div>
      ) : null}
      <RoleGallery roles={roles} />
    </div>
  );
}

function RoleGallery({ roles }: { roles: RoleId[] }) {
  const seen = new Map<RoleId, number>();
  return (
    <div className="role-gallery-grid">
      {roles.map((roleId, index) => {
        const role = ROLE_DEFINITIONS[roleId];
        const occurrence = seen.get(roleId) || 0;
        seen.set(roleId, occurrence + 1);
        return (
          <div className={`role-gallery-card ${role.allegiance === "good" ? "chip-good" : "chip-evil"}`} key={`${role.id}-${index}`}>
            <span className="role-gallery-art card-thumb" style={roleCardStyle(role.id, occurrence)} aria-label={role.shortName} />
            <strong>{role.shortName}</strong>
          </div>
        );
      })}
    </div>
  );
}

function BotOpinions({ room, embedded = false }: { room: RoomView; embedded?: boolean }) {
  if (room.game.botOpinions.length === 0) {
    return null;
  }

  if (embedded) {
    return (
      <div className="history-list embedded-history">
        {room.game.botOpinions.slice(-4).map((opinion) => (
          <div className="bot-opinion-row" key={opinion.id}>
            <strong>{playerName(room, opinion.playerId)}</strong>
            <span>{opinion.message}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <details className="panel-block bot-opinions collapsed-info-panel">
      <summary>
        <span>
          <Bot size={17} />
          電腦意見
        </span>
        <b>{room.game.botOpinions.length}</b>
      </summary>
      <div className="history-list">
        {room.game.botOpinions.slice(-4).map((opinion) => (
          <div className="bot-opinion-row" key={opinion.id}>
            <strong>{playerName(room, opinion.playerId)}</strong>
            <span>{opinion.message}</span>
          </div>
        ))}
      </div>
    </details>
  );
}

function VoteHistory({ room, embedded = false }: { room: RoomView; embedded?: boolean }) {
  const content = (
    <div className="history-list detailed-history">
      {room.game.voteHistory.length === 0 ? <p className="muted-line">尚無紀錄</p> : null}
      {room.game.voteHistory.slice(-5).map((vote) => (
        <div className="history-row" key={vote.round}>
          <div className="history-head">
            <strong>#{vote.round}</strong>
            <span>{vote.approved ? "通過" : "否決"}</span>
            <small>
              {vote.approvals.length}:{vote.rejections.length}
            </small>
          </div>
          <p>隊長：{playerName(room, vote.leaderId)}</p>
          <p>隊伍：{vote.team.map((id) => playerName(room, id)).join("、")}</p>
          <div className="vote-split">
            <div>
              <b>贊成</b>
              <span>{vote.approvals.map((id) => playerName(room, id)).join("、") || "無"}</span>
            </div>
            <div>
              <b>反對</b>
              <span>{vote.rejections.map((id) => playerName(room, id)).join("、") || "無"}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="panel-block">
      <div className="panel-title">
        <Vote size={17} />
        表決紀錄
      </div>
      {content}
    </div>
  );
}

function LadyHistory({ room, embedded = false }: { room: RoomView; embedded?: boolean }) {
  if (!room.game.ladyEnabled) {
    return null;
  }

  const content = (
    <div className="history-list">
      {room.game.ladyInspections.length === 0 ? <p className="muted-line">尚未使用</p> : null}
      {room.game.ladyInspections.map((inspection, index) => (
        <div className="lady-history-row" key={`${inspection.fromId}-${inspection.targetId}-${index}`}>
          <strong>#{index + 1}</strong>
          <span className="lady-history-main">
            {playerName(room, inspection.fromId)} 查看 {playerName(room, inspection.targetId)}
            {inspection.announcedAllegiance ? <em>宣稱{inspection.announcedAllegiance === "good" ? "好人" : "邪惡"}</em> : null}
          </span>
        </div>
      ))}
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="panel-block">
      <div className="panel-title">
        <Waves size={17} />
        湖中女神紀錄
      </div>
      {content}
    </div>
  );
}

function TeamNames({ room }: { room: RoomView }) {
  return (
    <div className="team-strip">
      {room.game.proposedTeam.map((id) => (
        <span key={id}>{playerName(room, id)}</span>
      ))}
    </div>
  );
}

function InlineTurnAction({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const isVoting = room.game.phase === "team-vote";
  const isMission = room.game.phase === "mission";
  const voted = room.game.teamVotesSubmitted.includes(youId);
  const onMission = room.game.proposedTeam.includes(youId);
  const missionSubmitted = room.game.missionVotesSubmitted.includes(youId);
  if (!isVoting && !isMission) {
    return null;
  }

  if (isMission) {
    return (
      <div className="inline-turn-action inline-mission-action">
        <div className="inline-action-summary">
          <strong>任務執行</strong>
          <span>{room.game.proposedTeam.map((id) => playerName(room, id)).join("、")}</span>
          <small>
            已送出 {room.game.missionVotesSubmitted.length}/{room.game.proposedTeam.length}
          </small>
        </div>
        {onMission && !missionSubmitted ? (
          <div className="inline-action-buttons">
            <button className="primary-button" onClick={() => socket.emit("castMissionVote", true)}>
              <Check size={18} />
              成功
            </button>
            {room.yourAllegiance === "evil" ? (
              <button className="danger-button" onClick={() => socket.emit("castMissionVote", false)}>
                <X size={18} />
                失敗
              </button>
            ) : null}
          </div>
        ) : (
          <span className="inline-action-waiting">{missionSubmitted ? "已送出" : "等待隊員"}</span>
        )}
      </div>
    );
  }

  return (
    <div className="inline-turn-action">
      <div className="inline-action-summary">
        <strong>隊伍表決</strong>
        <span>{room.game.proposedTeam.map((id) => playerName(room, id)).join("、")}</span>
        <small>
          已投票 {room.game.teamVotesSubmitted.length}/{room.players.length}
        </small>
      </div>
      {voted ? (
        <span className="inline-action-waiting">已投票</span>
      ) : (
        <div className="inline-action-buttons">
          <button className="primary-button" onClick={() => socket.emit("castTeamVote", true)}>
            <Check size={18} />
            贊成
          </button>
          <button className="danger-button" onClick={() => socket.emit("castTeamVote", false)}>
            <X size={18} />
            反對
          </button>
        </div>
      )}
    </div>
  );
}

function TeamVoteCards({ room }: { room: RoomView }) {
  return (
    <div className="vote-team-grid">
      {room.game.proposedTeam.map((id) => {
        const index = seatOrderIndex(room, id);
        return (
          <div className="vote-team-card" key={id}>
            <Shield size={18} />
            <strong>{playerName(room, id)}</strong>
            <span>{index === null ? "隊員" : `順位 ${index + 1}`}</span>
          </div>
        );
      })}
    </div>
  );
}

function CompactStatusPanel({ room }: { room: RoomView }) {
  return (
    <div className="action-panel compact-status-panel">
      <div>
        <h2>本局資訊</h2>
        <div className="status-chip-row">
          <span>
            <Vote size={15} />
            表決 {room.game.voteHistory.length}
          </span>
          <span>
            <Waves size={15} />
            女神 {room.game.ladyInspections.length}
          </span>
          <span>
            <Bot size={15} />
            電腦意見 {room.game.botOpinions.length}
          </span>
        </div>
      </div>
      <details open={room.game.voteHistory.length > 0}>
        <summary>表決紀錄</summary>
        <VoteHistory room={room} embedded />
      </details>
      {room.game.ladyEnabled ? (
        <details open={room.game.ladyInspections.length > 0}>
          <summary>湖中女神紀錄</summary>
          <LadyHistory room={room} embedded />
        </details>
      ) : null}
      {room.game.botOpinions.length > 0 ? (
        <details open>
          <summary>電腦意見</summary>
          <BotOpinions room={room} embedded />
        </details>
      ) : null}
    </div>
  );
}

function orderedRoomPlayers(room: RoomView): PlayerPublic[] {
  if (room.game.playerOrder.length === 0) {
    return room.players;
  }
  const byId = new Map(room.players.map((player) => [player.id, player]));
  const ordered = room.game.playerOrder.map((id) => byId.get(id)).filter((player): player is PlayerPublic => Boolean(player));
  const missing = room.players.filter((player) => !room.game.playerOrder.includes(player.id));
  return [...ordered, ...missing];
}

function playerName(room: RoomView, playerId: string | null): string {
  if (!playerId) {
    return "未知";
  }
  return room.players.find((player) => player.id === playerId)?.name || "未知";
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60000));
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) {
    return `${hours} 小時 ${minutes} 分`;
  }
  return `${minutes} 分`;
}

function seatOrderIndex(room: RoomView, playerId: string): number | null {
  const order = room.game.playerOrder.length > 0 ? room.game.playerOrder : room.players.map((player) => player.id);
  const index = order.indexOf(playerId);
  return index >= 0 ? index : null;
}

function playerSeatClass(room: RoomView, player: PlayerPublic, isDraftMember = false, isSelectable = false): string {
  const visibleRole = visibleRoleForPlayer(room, player.id);
  const badge = intelBadge(room, player.id);
  const classes = ["seat-card"];
  if (visibleRole) {
    classes.push("known-card");
  } else {
    classes.push("hidden-card");
  }
  if (player.id === room.you?.id) {
    classes.push("self-card");
  }
  if (player.id === room.game.leaderId) {
    classes.push("leader-card");
  }
  if (room.game.proposedTeam.includes(player.id)) {
    classes.push("quest-member-card");
  }
  if (isDraftMember) {
    classes.push("draft-team-card", "quest-member-card");
  }
  if (isSelectable) {
    classes.push("selectable-seat-card");
  }
  if (badge) {
    classes.push(badge.tone === "evil" ? "intel-known-evil" : "intel-known-good");
  }
  if (room.ladyResult?.targetId === player.id) {
    classes.push(room.ladyResult.allegiance === "good" ? "lady-known-good" : "lady-known-evil");
  }
  if (room.ladyPendingResult?.targetId === player.id) {
    classes.push(room.ladyPendingResult.allegiance === "good" ? "lady-known-good" : "lady-known-evil");
  }
  return classes.join(" ");
}

function visibleRoleForPlayer(room: RoomView, playerId: string): RoleId | null {
  if (room.revealedRoles?.[playerId]) {
    return room.revealedRoles[playerId];
  }
  if (room.you?.id === playerId) {
    return room.yourRole;
  }
  return null;
}

function revealedRoleName(room: RoomView, playerId: string): string | null {
  const role = visibleRoleForPlayer(room, playerId);
  return role ? ROLE_DEFINITIONS[role].shortName : null;
}

function intelBadge(room: RoomView, playerId: string): { text: string; tone: "good" | "evil" | "candidate" } | null {
  if (room.you?.id === playerId) {
    return null;
  }

  const roleIntel = room.roleKnowledge.find((knowledge) => knowledge.playerIds.includes(playerId));
  if (roleIntel?.label.includes("梅林候選")) {
    return { text: "梅林候選", tone: "candidate" };
  }
  if (roleIntel?.label.includes("邪惡同伴")) {
    return { text: "邪惡同伴", tone: "evil" };
  }
  if (roleIntel?.label.includes("邪惡玩家")) {
    return { text: "邪惡", tone: "evil" };
  }
  if (room.ladyResult?.targetId === playerId) {
    return room.ladyResult.allegiance === "good" ? { text: "女神：好人", tone: "good" } : { text: "女神：邪惡", tone: "evil" };
  }
  if (room.ladyPendingResult?.targetId === playerId) {
    return room.ladyPendingResult.allegiance === "good" ? { text: "女神：好人", tone: "good" } : { text: "女神：邪惡", tone: "evil" };
  }
  return null;
}

function roleCardImage(role: RoleId, variantIndex = 0): string {
  const variants = roleCardImageUrls[role];
  return variants[Math.abs(variantIndex) % variants.length];
}

function roleCardStyle(role: RoleId, variantIndex = 0): CSSProperties {
  return { "--role-card-url": `url(${roleCardImage(role, variantIndex)})` } as CSSProperties;
}

function roleVariantIndexForPlayer(room: RoomView, playerId: string, role: RoleId): number {
  let occurrence = 0;
  for (const player of orderedRoomPlayers(room)) {
    if (visibleRoleForPlayer(room, player.id) !== role) {
      continue;
    }
    if (player.id === playerId) {
      return occurrence;
    }
    occurrence += 1;
  }
  return 0;
}

function questFailText(playerCount: number, index: number): string {
  const threshold = questFailThresholds[playerCount]?.[index] || 1;
  return threshold > 1 ? `${threshold} 張失敗` : "1 張失敗";
}

function teamSizeText(room: RoomView, fallbackCount: number, index: number): string {
  const count = room.players.length >= MIN_PLAYERS ? room.players.length : fallbackCount;
  return `${questTeamSizes[count]?.[index] || "-"} 人`;
}
