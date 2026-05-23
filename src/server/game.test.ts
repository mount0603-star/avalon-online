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
  useLadyOfLake
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
