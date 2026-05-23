import assert from "node:assert/strict";
import test from "node:test";
import {
  createRoom,
  joinRoom,
  startGame,
  proposeTeam,
  castTeamVote,
  castMissionVote,
  buildRoomView
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

