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
  useExcalibur,
  assassinate,
  leaveRoom,
  setLadyEnabled,
  setLadyHolderMode,
  setLancelotEnabled,
  setExcaliburEnabled,
  setBotAiSettings,
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

  assert.equal(room.game.phase, "lady");
  assert.equal(room.game.ladyPendingResult?.targetId, targetId);
  assert.equal(buildRoomView(room, hostId).ladyPendingResult?.allegiance, room.game.ladyResults[hostId].allegiance);
  assert.equal(buildRoomView(room, targetId).ladyResult, null);

  room.game.ladyPendingResult = null;
  assert.equal(buildRoomView(room, hostId).ladyPendingResult?.targetId, targetId);

  useLadyOfLake(room, hostId, targetId, "good");

  assert.equal(room.game.phase, "team-building");
  assert.equal(room.game.ladyHolderId, targetId);
  assert.equal(room.game.ladyResults[hostId].targetId, targetId);
  assert.equal(buildRoomView(room, hostId).ladyResult?.targetId, targetId);
  assert.equal(buildRoomView(room, targetId).ladyResult, null);
  assert.equal(room.game.ladyInspections[0].announcedAllegiance, "good");
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

test("host can configure API bots without exposing the key", () => {
  const { room, playerId: hostId } = createRoom("A");

  setBotAiSettings(room, hostId, {
    enabled: true,
    provider: "deepseek",
    apiKey: "sk-test",
    model: "deepseek-chat"
  });

  const view = buildRoomView(room, hostId);
  assert.equal(view.botAiSetting.enabled, true);
  assert.equal(view.botAiSetting.provider, "deepseek");
  assert.equal(view.botAiSetting.apiKeyConfigured, true);
  assert.equal("apiKey" in view.botAiSetting, false);
});

test("lady holder can start from the tail player or a random player", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  const random = Math.random;

  try {
    Math.random = () => 0;
    startGame(room, hostId);
    assert.equal(room.game.ladyHolderId, room.game.playerOrder[room.game.playerOrder.length - 1]);
  } finally {
    Math.random = random;
  }

  room.game.phase = "lobby";
  setLadyHolderMode(room, hostId, "random");

  try {
    Math.random = () => 0;
    startGame(room, hostId);
    assert.equal(room.game.ladyHolderId, room.game.playerOrder[0]);
  } finally {
    Math.random = random;
  }
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

test("lancelot option swaps current allegiance when a loyalty card switches", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E", "F", "G"].forEach((name) => joinRoom(room.code, name));
  setLancelotEnabled(room, hostId, true);
  startGame(room, hostId);
  const [goodLancelotId, evilLancelotId] = room.game.playerOrder;
  room.players.get(goodLancelotId)!.role = "lancelotGood";
  room.players.get(evilLancelotId)!.role = "lancelotEvil";
  room.game.lancelotEnabled = true;
  room.game.lancelotAllegiances = {
    [goodLancelotId]: "good",
    [evilLancelotId]: "evil"
  };
  room.game.lancelotDeck = ["switch"];
  room.game.phase = "mission";
  room.game.questIndex = 1;
  room.game.proposedTeam = [goodLancelotId, evilLancelotId];

  castMissionVote(room, goodLancelotId, false);
  castMissionVote(room, evilLancelotId, true);

  assert.equal(room.game.lancelotDraws[0].switched, true);
  assert.equal(buildRoomView(room, goodLancelotId).yourAllegiance, "evil");
  assert.equal(buildRoomView(room, evilLancelotId).yourAllegiance, "good");

  room.game.phase = "mission";
  room.game.questIndex = 2;
  room.game.proposedTeam = [goodLancelotId];
  room.game.missionVotes = {};
  castMissionVote(room, goodLancelotId, false);
  assert.equal(room.game.quests[room.game.quests.length - 1]?.success, false);
});

test("excalibur holder can flip another mission card before reveal", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  setExcaliburEnabled(room, hostId, true);
  startGame(room, hostId);
  const leaderId = buildRoomView(room, hostId).game.leaderId!;
  const holderId = room.game.playerOrder.find((id) => id !== leaderId)!;
  room.players.get(leaderId)!.role = "loyal";
  room.players.get(holderId)!.role = "assassin";

  proposeTeam(room, leaderId, [leaderId, holderId], holderId);
  room.game.playerOrder.forEach((id) => castTeamVote(room, id, true));
  castMissionVote(room, leaderId, true);
  castMissionVote(room, holderId, false);

  assert.equal(room.game.phase, "excalibur");
  useExcalibur(room, holderId, leaderId);

  assert.equal(room.game.quests[0].excaliburTargetId, leaderId);
  assert.equal(room.game.quests[0].failCount, 2);
  assert.equal(room.game.quests[0].success, false);
});

test("evil team votes together for the final merlin assassination", () => {
  const { room, playerId: hostId } = createRoom("A");
  ["B", "C", "D", "E"].forEach((name) => joinRoom(room.code, name));
  startGame(room, hostId);
  const [merlinId, percivalId, loyalId, assassinId, morganaId] = room.game.playerOrder;
  room.players.get(merlinId)!.role = "merlin";
  room.players.get(percivalId)!.role = "percival";
  room.players.get(loyalId)!.role = "loyal";
  room.players.get(assassinId)!.role = "assassin";
  room.players.get(morganaId)!.role = "morgana";
  room.game.phase = "assassination";
  room.game.assassinationVotes = {};

  assassinate(room, assassinId, merlinId);
  assert.equal(room.game.phase, "assassination");
  assassinate(room, morganaId, percivalId);

  assert.equal(room.game.phase, "finished");
  assert.equal(room.game.winner, "evil");
  assert.equal(room.game.assassinTargetId, merlinId);
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
