import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoom,
  joinRoom,
  startGame,
  proposeTeam,
  castTeamVote,
  castMissionVote,
  buildRoomView,
  addBot,
  runBotActions,
  useLadyOfLake,
  leaveRoom,
  setLadyEnabled,
  isRoomIdleExpired,
  IDLE_TIMEOUT_MS
} from "./game";
import { ROLE_DEFINITIONS, getRoleSet, roleSide } from "../shared/roles";

test("role sets match the player count and required sides", () => {
  for (let count = 5; count <= 10; count += 1) {
    const roles = getRoleSet(count);
    assert.equal(roles.length, count);
    assert.ok(roles.includes("merlin"));
    assert.ok(roles.includes("assassin"));
    assert.equal(roles.filter((role) => roleSide(role) === "good").length, count <= 7 ? (count === 5 ? 3 : 4) : count <= 9 ? count - 3 : 6);
    assert.equal(roles.filter((role) => roleSide(role) === "evil").length, count <= 6 ? 2 : count <= 9 ? 3 : 4);
  }
});

test("good mission votes are forced to success", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);

  const leaderId = buildRoomView(room, hostId).game.leaderId!;
  proposeTeam(room, leaderId, room.game.playerOrder.slice(0, 2));
  room.game.playerOrder.forEach((id) => castTeamVote(room, id, true));

  const goodTeamMember = room.game.proposedTeam.find((id) => roleSide(room.players.get(id)!.role!) === "good");
  if (!goodTeamMember) {
    return;
  }

  castMissionVote(room, goodTeamMember, false);
  assert.equal(room.game.missionVotes[goodTeamMember], true);
});

test("role definitions have public display names", () => {
  for (const role of Object.values(ROLE_DEFINITIONS)) {
    assert.ok(role.name.length > 0);
    assert.ok(role.summary.length > 0);
  }
});

test("percival sees merlin and morgana while merlin cannot see mordred", () => {
  const { room, playerId: hostId } = createRoom("Merlin");
  ["Percival", "Loyal 1", "Loyal 2", "Assassin", "Morgana", "Mordred"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);
  const [merlinId, percivalId, loyalAId, loyalBId, assassinId, morganaId, mordredId] = room.game.playerOrder;

  room.players.get(merlinId)!.role = "merlin";
  room.players.get(percivalId)!.role = "percival";
  room.players.get(loyalAId)!.role = "loyal";
  room.players.get(loyalBId)!.role = "loyal";
  room.players.get(assassinId)!.role = "assassin";
  room.players.get(morganaId)!.role = "morgana";
  room.players.get(mordredId)!.role = "mordred";

  const percivalKnowledge = buildRoomView(room, percivalId).roleKnowledge.flatMap((item) => item.playerIds);
  assert.deepEqual(new Set(percivalKnowledge), new Set([merlinId, morganaId]));

  const merlinKnowledge = buildRoomView(room, merlinId).roleKnowledge.flatMap((item) => item.playerIds);
  assert.ok(merlinKnowledge.includes(assassinId));
  assert.ok(merlinKnowledge.includes(morganaId));
  assert.equal(merlinKnowledge.includes(mordredId), false);
});

test("bot leaders can propose a legal team", () => {
  const { room, playerId: hostId } = createRoom("A");
  for (let index = 0; index < 4; index += 1) {
    addBot(room, hostId);
  }
  startGame(room, hostId);
  const botLeaderIndex = room.game.playerOrder.findIndex((id) => room.players.get(id)?.isBot);
  room.game.leaderIndex = botLeaderIndex;

  assert.equal(runBotActions(room), true);
  assert.equal(room.game.phase, "team-vote");
  assert.equal(room.game.proposedTeam.length, 2);
});

test("lady of the lake reveals allegiance only to the holder and passes token", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E", "F", "G"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);
  const targetId = room.game.playerOrder.find((id) => id !== hostId)!;
  room.game.phase = "lady";
  room.game.ladyEnabled = true;
  room.game.ladyHolderId = hostId;
  room.game.ladyUsedPlayerIds = [hostId];

  useLadyOfLake(room, hostId, targetId);

  assert.equal(room.game.phase, "team-building");
  assert.equal(room.game.ladyHolderId, targetId);
  assert.equal(room.game.ladyResults[hostId].targetId, targetId);
  assert.equal(buildRoomView(room, hostId).ladyResult?.targetId, targetId);
  assert.equal(buildRoomView(room, targetId).ladyResult, null);
});

test("host can disable lady of the lake before the game starts", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));

  assert.equal(room.ladyEnabledSetting, true);
  setLadyEnabled(room, hostId, false);
  startGame(room, hostId);

  assert.equal(room.game.ladyEnabled, false);
  assert.equal(room.game.ladyHolderId, null);
});

test("bot lady announcements can lie for evil holders", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);
  const [holderId, targetId] = room.game.playerOrder;
  room.players.get(holderId)!.isBot = true;
  room.players.get(holderId)!.role = "morgana";
  room.players.get(targetId)!.role = "loyal";
  room.game.phase = "lady";
  room.game.ladyEnabled = true;
  room.game.ladyHolderId = holderId;
  room.game.ladyUsedPlayerIds = [holderId];

  const random = Math.random;
  Math.random = () => 0;
  try {
    useLadyOfLake(room, holderId, targetId);
  } finally {
    Math.random = random;
  }

  assert.equal(room.game.ladyInspections[0].announcedAllegiance, "evil");
});

test("percival bot uses lady result to protect the other merlin candidate", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);
  const [percivalId, merlinId, morganaId, assassinId, loyalId] = room.game.playerOrder;
  room.players.get(percivalId)!.isBot = true;
  room.players.get(percivalId)!.role = "percival";
  room.players.get(merlinId)!.role = "merlin";
  room.players.get(morganaId)!.role = "morgana";
  room.players.get(assassinId)!.role = "assassin";
  room.players.get(loyalId)!.role = "loyal";
  room.game.leaderIndex = 0;
  room.game.questIndex = 2;
  room.game.ladyResults[percivalId] = { targetId: morganaId, allegiance: "evil" };

  const random = Math.random;
  Math.random = () => 0.5;
  try {
    runBotActions(room);
  } finally {
    Math.random = random;
  }

  assert.ok(room.game.proposedTeam.includes(merlinId));
  assert.equal(room.game.proposedTeam.includes(morganaId), false);
});

test("leaving during a game lets a bot take over and promotes a human host", () => {
  const { room, playerId: hostId } = createRoom("A");
  const { playerId: nextHostId } = joinRoom(room.code, "B");
  ["C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);

  const result = leaveRoom(room, hostId);

  assert.equal(result.shouldDeleteRoom, false);
  assert.equal(room.players.get(hostId)?.isBot, true);
  assert.equal(room.hostId, nextHostId);
  assert.equal(room.players.get(nextHostId)?.isHost, true);
});

test("idle rooms expire after the configured timeout", () => {
  const { room } = createRoom("A");
  const now = Date.now();
  room.lastActivityAt = now - IDLE_TIMEOUT_MS - 1;

  assert.equal(isRoomIdleExpired(room, now), true);
});
