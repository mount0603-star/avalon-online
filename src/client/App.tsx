import { useEffect, useState, type CSSProperties } from "react";
import {
  Bot,
  Check,
  Circle,
  Copy,
  Crown,
  Eye,
  Flag,
  LogIn,
  Plus,
  RotateCcw,
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
import type { PlayerPublic, RoomJoinedPayload, RoomView } from "../shared/types";
import roleCardsUrl from "./assets/role-cards.png";
import councilHallUrl from "./assets/council-hall.png";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLE_DEFINITIONS,
  getRoleSet,
  roleSide,
  type RoleId
} from "../shared/roles";

const PLAYER_ID_KEY = "avalon-online.playerId";
const ROOM_CODE_KEY = "avalon-online.roomCode";
const PLAYER_NAME_KEY = "avalon-online.playerName";

const phaseLabel: Record<RoomView["game"]["phase"], string> = {
  lobby: "大廳",
  "team-building": "組隊",
  "team-vote": "表決",
  mission: "任務",
  lady: "湖中女神",
  assassination: "刺殺",
  finished: "結算"
};

const roleTone: Record<RoleId, string> = {
  merlin: "role-good",
  percival: "role-good",
  loyal: "role-good",
  assassin: "role-evil",
  morgana: "role-evil",
  mordred: "role-evil",
  oberon: "role-evil",
  minion: "role-evil"
};

const roleMark: Record<RoleId, string> = {
  merlin: "✦",
  percival: "◇",
  loyal: "♜",
  assassin: "†",
  morgana: "☾",
  mordred: "♛",
  oberon: "◌",
  minion: "◆"
};

export function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(PLAYER_NAME_KEY) || "");
  const [roomCode, setRoomCode] = useState(() => localStorage.getItem(ROOM_CODE_KEY) || "");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onState = (nextRoom: RoomView) => {
      setRoom(nextRoom);
      setError("");
      localStorage.setItem(ROOM_CODE_KEY, nextRoom.roomCode);
    };
    const onError = (message: string) => setError(message);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on("roomState", onState);
    socket.on("roomError", onError);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);

    return () => {
      socket.off("roomState", onState);
      socket.off("roomError", onError);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  function persistSession(payload: RoomJoinedPayload, playerName: string) {
    localStorage.setItem(PLAYER_ID_KEY, payload.playerId);
    localStorage.setItem(ROOM_CODE_KEY, payload.roomCode);
    localStorage.setItem(PLAYER_NAME_KEY, playerName);
    setRoomCode(payload.roomCode);
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

  return (
    <main
      className="app-shell"
      style={{ "--card-sheet": `url(${roleCardsUrl})`, "--hall-bg": `url(${councilHallUrl})` } as CSSProperties}
    >
      <section className="hero-band">
        <div>
          <p className="eyebrow">Hidden role table</p>
          <h1>Avalon Online</h1>
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
        />
      ) : (
        <GameRoom room={room} error={error} />
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
      <RolePreview playerCount={5} />
    </section>
  );
}

function GameRoom({ room, error }: { room: RoomView; error: string }) {
  const isHost = room.you?.isHost ?? false;

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
          </div>
        </div>
        <div className="phase-pill">
          <Flag size={16} />
          {phaseLabel[room.game.phase]}
        </div>
      </header>

      {error ? <p className="error-line">{error}</p> : null}

      <div className="game-grid">
        <aside className="side-panel">
          <PlayerList room={room} />
          <QuestBoard room={room} />
        </aside>

        <section className="play-panel">
          <RoleCard room={room} />
          <PhasePanel room={room} />
        </section>

        <aside className="side-panel">
          {room.game.phase === "lobby" ? <RolePreview playerCount={room.players.length} /> : <VoteHistory room={room} />}
          {isHost && room.game.phase === "lobby" ? (
            <button className="secondary-button full-button" disabled={room.players.length >= MAX_PLAYERS} onClick={() => socket.emit("addBot")}>
              <Bot size={18} />
              新增電腦
            </button>
          ) : null}
          {isHost && room.game.phase === "lobby" ? (
            <button className="primary-button full-button" disabled={room.players.length < MIN_PLAYERS} onClick={() => socket.emit("startGame")}>
              <Swords size={18} />
              開始遊戲
            </button>
          ) : null}
          {isHost && room.game.phase === "finished" ? (
            <button className="secondary-button full-button" onClick={() => socket.emit("resetRoom")}>
              <RotateCcw size={18} />
              回到大廳
            </button>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function PlayerList({ room }: { room: RoomView }) {
  const leaderId = room.game.leaderId;
  const canRemoveBots = room.you?.isHost && room.game.phase === "lobby";
  return (
    <div className="panel-block">
      <div className="panel-title">
        <Users size={17} />
        玩家 {room.players.length}/{MAX_PLAYERS}
      </div>
      <div className="player-list">
        {room.players.map((player) => (
          <div className="player-row" key={player.id}>
            <span className={player.connected ? "status-dot online-dot" : "status-dot offline-dot"} />
            <span className="player-name">{player.name}</span>
            {player.isHost ? <Crown className="small-mark" size={15} /> : null}
            {player.isBot ? <span className="tag bot-tag">電腦</span> : null}
            {leaderId === player.id ? <span className="tag">隊長</span> : null}
            {room.you?.id === player.id ? <span className="tag muted">你</span> : null}
            {canRemoveBots && player.isBot ? (
              <button className="mini-icon-button" aria-label={`移除 ${player.name}`} onClick={() => socket.emit("removeBot", player.id)}>
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function QuestBoard({ room }: { room: RoomView }) {
  const playerCount = Math.max(room.players.length, MIN_PLAYERS);
  return (
    <div className="panel-block">
      <div className="panel-title">
        <Flag size={17} />
        任務進度
      </div>
      <div className="quest-track">
        {[0, 1, 2, 3, 4].map((index) => {
          const quest = room.game.quests.find((item) => item.index === index);
          const isCurrent = room.game.questIndex === index && room.game.phase !== "lobby" && room.game.phase !== "finished";
          return (
            <div className={`quest-node ${quest?.success ? "quest-success" : ""} ${quest && !quest.success ? "quest-fail" : ""} ${isCurrent ? "quest-current" : ""}`} key={index}>
              <span>{index + 1}</span>
              {quest ? <small>{quest.success ? "成功" : `${quest.failCount} 失敗`}</small> : <small>{teamSizeText(room, playerCount, index)}</small>}
            </div>
          );
        })}
      </div>
      <div className="counter-line">
        <span>否決</span>
        <strong>{room.game.failedVoteCount}/5</strong>
      </div>
      {room.game.ladyEnabled ? (
        <div className="counter-line lady-line">
          <span>湖中女神</span>
          <strong>{playerName(room, room.game.ladyHolderId)}</strong>
        </div>
      ) : null}
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
  const side = role.allegiance === "good" ? "亞瑟陣營" : "邪惡陣營";
  return (
    <div className={`identity-panel ${role.allegiance === "good" ? "identity-good" : "identity-evil"}`}>
      <div className={`role-portrait card-art card-art-${room.yourRole}`}>
        <span>{roleMark[room.yourRole]}</span>
      </div>
      <div>
        <span>{side}</span>
        <h2>{role.name}</h2>
        <p>{role.summary}</p>
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
  );
}

function PhasePanel({ room }: { room: RoomView }) {
  if (room.game.phase === "lobby") {
    return <LobbyPanel room={room} />;
  }
  if (room.game.phase === "team-building") {
    return <TeamBuilder room={room} />;
  }
  if (room.game.phase === "team-vote") {
    return <TeamVote room={room} />;
  }
  if (room.game.phase === "mission") {
    return <MissionVote room={room} />;
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

  return (
    <div className="action-panel lake-panel">
      <h2>湖中女神</h2>
      <p>
        持有者是 <strong>{playerName(room, room.game.ladyHolderId)}</strong>。查看一名尚未持有過女神的玩家，只會知道他的陣營。
      </p>
      {room.ladyResult ? (
        <p className="lake-result-text">
          你查看了 <strong>{playerName(room, room.ladyResult.targetId)}</strong>：
          {room.ladyResult.allegiance === "good" ? "好人陣營" : "邪惡陣營"}
        </p>
      ) : null}
      {isHolder ? (
        <div className="select-grid">
          {candidates.map((player) => (
            <button className="select-player" key={player.id} onClick={() => socket.emit("useLadyOfLake", player.id)}>
              <Waves size={18} />
              {player.name}
            </button>
          ))}
        </div>
      ) : (
        <p className="waiting-line">等待持有者使用湖中女神。</p>
      )}
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

function TeamBuilder({ room }: { room: RoomView }) {
  const [selected, setSelected] = useState<string[]>([]);
  const isLeader = room.you?.id === room.game.leaderId;
  const teamSize = room.game.teamSize;

  useEffect(() => {
    setSelected([]);
  }, [room.game.questIndex, room.game.leaderId, teamSize]);

  function togglePlayer(playerId: string) {
    setSelected((current) => {
      if (current.includes(playerId)) {
        return current.filter((id) => id !== playerId);
      }
      if (current.length >= teamSize) {
        return current;
      }
      return [...current, playerId];
    });
  }

  return (
    <div className="action-panel">
      <h2>第 {room.game.questIndex + 1} 次任務組隊</h2>
      <p>
        隊長是 <strong>{playerName(room, room.game.leaderId)}</strong>，需要 <strong>{teamSize}</strong> 人。
      </p>
      <div className="select-grid">
        {room.players.map((player) => {
          const checked = selected.includes(player.id);
          return (
            <button
              className={checked ? "select-player selected" : "select-player"}
              key={player.id}
              disabled={!isLeader}
              onClick={() => togglePlayer(player.id)}
            >
              {checked ? <Check size={18} /> : <Plus size={18} />}
              {player.name}
            </button>
          );
        })}
      </div>
      {isLeader ? (
        <button className="primary-button" disabled={selected.length !== teamSize} onClick={() => socket.emit("proposeTeam", selected)}>
          <Vote size={18} />
          提交隊伍 {selected.length}/{teamSize}
        </button>
      ) : (
        <p className="muted-line">等待隊長提交隊伍。</p>
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
      <TeamNames room={room} />
      <p className="muted-line">
        已投票 {room.game.teamVotesSubmitted.length}/{room.players.length}
      </p>
      {voted ? (
        <p className="waiting-line">你已投票，等待其他玩家。</p>
      ) : (
        <div className="button-row">
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

function MissionVote({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const isOnTeam = room.game.proposedTeam.includes(youId);
  const submitted = room.game.missionVotesSubmitted.includes(youId);
  const canFail = room.yourRole ? roleSide(room.yourRole) === "evil" : false;

  return (
    <div className="action-panel">
      <h2>任務執行</h2>
      <TeamNames room={room} />
      <p className="muted-line">
        已提交 {room.game.missionVotesSubmitted.length}/{room.game.proposedTeam.length}
      </p>
      {!isOnTeam ? <p className="waiting-line">你不在任務隊伍中，等待結果。</p> : null}
      {isOnTeam && submitted ? <p className="waiting-line">你已提交任務結果。</p> : null}
      {isOnTeam && !submitted ? (
        <div className="button-row">
          <button className="primary-button" onClick={() => socket.emit("castMissionVote", true)}>
            <Check size={18} />
            任務成功
          </button>
          {canFail ? (
            <button className="danger-button" onClick={() => socket.emit("castMissionVote", false)}>
              <X size={18} />
              任務失敗
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Assassination({ room }: { room: RoomView }) {
  const youId = room.you?.id || "";
  const isAssassin = room.game.assassinId === youId;
  return (
    <div className="action-panel final-panel">
      <h2>刺客時刻</h2>
      <p>亞瑟陣營完成三次任務，刺客還有最後一擊。</p>
      {isAssassin ? (
        <div className="select-grid">
          {room.players
            .filter((player) => player.id !== youId)
            .map((player) => (
              <button className="select-player" key={player.id} onClick={() => socket.emit("assassinate", player.id)}>
                <Target size={18} />
                {player.name}
              </button>
            ))}
        </div>
      ) : (
        <p className="waiting-line">等待刺客選擇目標。</p>
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

function RolePreview({ playerCount }: { playerCount: number }) {
  const safeCount = playerCount >= MIN_PLAYERS && playerCount <= MAX_PLAYERS ? playerCount : MIN_PLAYERS;
  const roles = getRoleSet(safeCount);
  const grouped = roles.reduce<Record<RoleId, number>>((acc, role) => {
    acc[role] = (acc[role] || 0) + 1;
    return acc;
  }, {} as Record<RoleId, number>);

  return (
    <div className="panel-block role-preview">
      <div className="panel-title">
        <Crown size={17} />
        {safeCount} 人角色
      </div>
      <div className="role-chip-grid">
        {Object.entries(grouped).map(([roleId, count]) => {
          const role = ROLE_DEFINITIONS[roleId as RoleId];
          return (
            <div className={`role-chip ${role.allegiance === "good" ? "chip-good" : "chip-evil"}`} key={role.id}>
              <span className={`role-mini card-thumb card-art-${role.id}`}>{roleMark[role.id]}</span>
              <span>{role.shortName}</span>
              {count > 1 ? <strong>x{count}</strong> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VoteHistory({ room }: { room: RoomView }) {
  return (
    <div className="panel-block">
      <div className="panel-title">
        <Vote size={17} />
        表決紀錄
      </div>
      <div className="history-list">
        {room.game.voteHistory.length === 0 ? <p className="muted-line">尚無紀錄</p> : null}
        {room.game.voteHistory.slice(-5).map((vote) => (
          <div className="history-row" key={vote.round}>
            <strong>#{vote.round}</strong>
            <span>{vote.approved ? "通過" : "否決"}</span>
            <small>
              {vote.approvals.length}:{vote.rejections.length}
            </small>
          </div>
        ))}
      </div>
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

function playerName(room: RoomView, playerId: string | null): string {
  if (!playerId) {
    return "未知";
  }
  return room.players.find((player) => player.id === playerId)?.name || "未知";
}

function teamSizeText(room: RoomView, fallbackCount: number, index: number): string {
  const count = room.players.length >= MIN_PLAYERS ? room.players.length : fallbackCount;
  const table: Record<number, number[]> = {
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5]
  };
  return `${table[count]?.[index] || "-"} 人`;
}
