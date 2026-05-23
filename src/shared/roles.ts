export type Allegiance = "good" | "evil";

export type RoleId =
  | "merlin"
  | "percival"
  | "loyal"
  | "assassin"
  | "morgana"
  | "mordred"
  | "oberon"
  | "minion";

export type RoleDefinition = {
  id: RoleId;
  name: string;
  shortName: string;
  allegiance: Allegiance;
  summary: string;
};

export const ROLE_DEFINITIONS: Record<RoleId, RoleDefinition> = {
  merlin: {
    id: "merlin",
    name: "梅林",
    shortName: "梅林",
    allegiance: "good",
    summary: "知道多數邪惡玩家，但必須隱藏自己的身分。"
  },
  percival: {
    id: "percival",
    name: "派西維爾",
    shortName: "派西",
    allegiance: "good",
    summary: "會看到梅林候選人，但莫甘娜會混在其中。"
  },
  loyal: {
    id: "loyal",
    name: "亞瑟的忠臣",
    shortName: "忠臣",
    allegiance: "good",
    summary: "沒有額外情報，靠討論與投票守住任務。"
  },
  assassin: {
    id: "assassin",
    name: "刺客",
    shortName: "刺客",
    allegiance: "evil",
    summary: "邪惡陣營；好人完成三次任務後可刺殺梅林。"
  },
  morgana: {
    id: "morgana",
    name: "莫甘娜",
    shortName: "莫甘娜",
    allegiance: "evil",
    summary: "邪惡陣營；在派西維爾眼中會偽裝成梅林候選。"
  },
  mordred: {
    id: "mordred",
    name: "莫德雷德",
    shortName: "莫德",
    allegiance: "evil",
    summary: "邪惡陣營；不會被梅林看見。"
  },
  oberon: {
    id: "oberon",
    name: "奧伯倫",
    shortName: "奧伯倫",
    allegiance: "evil",
    summary: "邪惡陣營；不知道其他邪惡玩家，也不會被邪惡同伴看見。"
  },
  minion: {
    id: "minion",
    name: "莫德雷德的爪牙",
    shortName: "爪牙",
    allegiance: "evil",
    summary: "邪惡陣營；與其他邪惡玩家合作破壞任務。"
  }
};

export const ROLE_SET_BY_PLAYER_COUNT: Record<number, RoleId[]> = {
  5: ["merlin", "percival", "loyal", "assassin", "morgana"],
  6: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana"],
  7: ["merlin", "percival", "loyal", "loyal", "assassin", "morgana", "mordred"],
  8: ["merlin", "percival", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred"],
  9: ["merlin", "percival", "loyal", "loyal", "loyal", "loyal", "assassin", "morgana", "mordred"],
  10: [
    "merlin",
    "percival",
    "loyal",
    "loyal",
    "loyal",
    "loyal",
    "assassin",
    "morgana",
    "mordred",
    "oberon"
  ]
};

export const QUEST_TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5]
};

export const QUEST_FAIL_THRESHOLDS: Record<number, number[]> = {
  5: [1, 1, 1, 1, 1],
  6: [1, 1, 1, 1, 1],
  7: [1, 1, 1, 2, 1],
  8: [1, 1, 1, 2, 1],
  9: [1, 1, 1, 2, 1],
  10: [1, 1, 1, 2, 1]
};

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 10;

export function roleSide(role: RoleId): Allegiance {
  return ROLE_DEFINITIONS[role].allegiance;
}

export function getRoleSet(playerCount: number): RoleId[] {
  const roles = ROLE_SET_BY_PLAYER_COUNT[playerCount];
  if (!roles) {
    throw new Error(`Unsupported player count: ${playerCount}`);
  }
  return roles;
}

