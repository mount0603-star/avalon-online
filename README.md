# Avalon Online

A first playable web version of an Avalon-style hidden-role game.

## Run Locally

```bash
npm install
npm run dev
```

The client runs on `http://localhost:5173` and the realtime server runs on `http://localhost:4000`.

## Deploy On Render

Create a Render Web Service from this GitHub repository.

- Build command: `npm ci && npm run build`
- Start command: `npm run start`
- Environment variable: `NODE_ENV=production`
- Health check path: `/health`

## Current Features

- Create a room and invite players with a room code
- 5 to 10 players
- Classic role set: Merlin, Percival, Loyal Servants, Assassin, Morgana, Mordred, Oberon, and Minions
- Hidden role knowledge
- Leader team proposal
- Team approval vote
- Mission vote
- Assassin finale
- In-memory rooms for quick private games

This project does not include official board-game artwork or rulebook text.
