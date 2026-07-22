const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const port = process.env.PORT || 3000;
const dataFile = path.join(__dirname, "data", "tournaments.json");

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function readDb() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return { tournaments: {} };
  }
}

function saveDb(db) {
  fs.mkdirSync(path.dirname(dataFile), { recursive: true });
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2));
}

function token(length = 18) {
  return crypto.randomBytes(length).toString("hex");
}

function getTournament(invite) {
  return readDb().tournaments[invite];
}

function publicState(tournament) {
  return {
    ...tournament,
    master: undefined,
    players: tournament.players.map(({ key, ...player }) => player)
  };
}

function saveTournament(tournament) {
  const db = readDb();
  db.tournaments[tournament.invite] = tournament;
  saveDb(db);

  io.to(tournament.invite).emit("state", publicState(tournament));
}

function player(tournament, id) {
  return tournament.players.find((p) => p.id === id);
}

function isMaster(tournament, body) {
  return body.master && body.master === tournament.master;
}

function fail(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

app.post("/api/create", (req, res) => {
  const db = readDb();
  let invite;

  do {
    invite = token(6);
  } while (db.tournaments[invite]);

  const tournament = {
    invite,
    master: token(),
    phase: "registration",
    stopped: false,
    players: [],
    matches: [],
    createdAt: new Date().toISOString()
  };

  db.tournaments[invite] = tournament;
  saveDb(db);

  res.json({
    invite,
    master: tournament.master
  });
});

app.get("/api/:invite/state", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

  res.json(publicState(tournament));
});

app.post("/api/:invite/join", (req, res) => {
  const tournament = getTournament(req.params.invite);
  const name = req.body.name?.trim();

  if (!tournament) return fail(res, "Tournament not found", 404);
  if (tournament.phase !== "registration") {
    return fail(res, "Registration is closed");
  }

  if (!name) return fail(res, "Enter your name");

  if (
    tournament.players.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    return fail(res, "Choose a unique name");
  }

  const newPlayer = {
    id: token(8),
    key: token(),
    name,
    characters: [],
    points: 100,
    wins: 0,
    losses: 0
  };

  tournament.players.push(newPlayer);
  saveTournament(tournament);

  res.json({
    id: newPlayer.id,
    key: newPlayer.key
  });
});

app.post("/api/:invite/characters", (req, res) => {
  const tournament = getTournament(req.params.invite);
  const characters = req.body.characters;

  if (!tournament) return fail(res, "Tournament not found", 404);

  const currentPlayer = player(tournament, req.body.id);

  if (!currentPlayer || currentPlayer.key !== req.body.key) {
    return fail(res, "Player access required", 403);
  }

  if (
    !Array.isArray(characters) ||
    characters.length !== 5 ||
    characters.some((character) => !String(character).trim())
  ) {
    return fail(res, "Choose exactly five characters");
  }

  currentPlayer.characters = characters.map((character) =>
    String(character).trim()
  );

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/add", (req, res) => {
  const tournament = getTournament(req.params.invite);
  const name = req.body.name?.trim();
  const characters = req.body.characters;

  if (!tournament) return fail(res, "Tournament not found", 404);

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  if (tournament.phase !== "registration") {
    return fail(res, "Registration is closed");
  }

  if (!name) return fail(res, "Enter a name");

  if (
    tournament.players.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    return fail(res, "Choose a unique name");
  }

  if (
    !Array.isArray(characters) ||
    characters.length !== 5 ||
    characters.some((character) => !String(character).trim())
  ) {
    return fail(res, "Enter all five characters for this player");
  }

  const newPlayer = {
    id: token(8),
    key: token(),
    name,
    characters: characters.map((character) => String(character).trim()),
    points: 100,
    wins: 0,
    losses: 0
  };

  tournament.players.push(newPlayer);
  saveTournament(tournament);

  res.json({
    player: {
      ...newPlayer,
      key: undefined
    }
  });
});

app.post("/api/:invite/start", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) return fail(res, "Tournament not found", 404);

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  if (tournament.players.length < 2) {
    return fail(res, "At least two players are needed");
  }

  if (tournament.phase !== "registration") {
    return fail(res, "Tournament has already started");
  }

  tournament.phase = "pools";

  const pairings = [];

  for (let a = 0; a < tournament.players.length; a++) {
    for (let b = a + 1; b < tournament.players.length; b++) {
      pairings.push([
        tournament.players[a].id,
        tournament.players[b].id
      ]);
    }
  }

  // Shuffle matches so the same player is not always first.
  for (let i = pairings.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairings[i], pairings[j]] = [pairings[j], pairings[i]];
  }

  tournament.matches = pairings.map(([a, b]) => ({
    id: token(8),
    a,
    b,
    stage: "pool",
    status: "ready",
    bets: []
  }));

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/go", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) return fail(res, "Tournament not found", 404);

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  const match = tournament.matches.find(
    (m) => m.id === req.body.match
  );

  if (!match || match.status !== "ready") {
    return fail(res, "Match is unavailable");
  }

  const firstPlayer = player(tournament, match.a);
  const secondPlayer = player(tournament, match.b);

  if (
    firstPlayer.characters.length !== 5 ||
    secondPlayer.characters.length !== 5
  ) {
    return fail(
      res,
      "Both players must choose five characters first"
    );
  }

  match.status = "live";
  match.characters = {
    [firstPlayer.id]:
      firstPlayer.characters[
        Math.floor(Math.random() * firstPlayer.characters.length)
      ],
    [secondPlayer.id]:
      secondPlayer.characters[
        Math.floor(Math.random() * secondPlayer.characters.length)
      ]
  };

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/bet", (req, res) => {
  const tournament = getTournament(req.params.invite);
  const stake = Number(req.body.stake);

  if (!tournament) return fail(res, "Tournament not found", 404);

  const match = tournament.matches.find(
    (m) => m.id === req.body.match
  );

  const currentPlayer = player(tournament, req.body.id);

  if (!currentPlayer || currentPlayer.key !== req.body.key) {
    return fail(res, "Player access required", 403);
  }

  if (
    !match ||
    match.status !== "ready" ||
    ![match.a, match.b].includes(req.body.pick) ||
    [match.a, match.b].includes(currentPlayer.id)
  ) {
    return fail(res, "This bet is not allowed");
  }

  if (!Number.isInteger(stake) || stake < 1) {
    return fail(res, "Enter a whole-number stake of at least 1");
  }

  const existingBet = match.bets.find(
    (bet) => bet.player === currentPlayer.id
  );

  const availablePoints =
    currentPlayer.points + (existingBet?.stake || 0);

  if (stake > availablePoints) {
    if (currentPlayer.points === 0) {
      return fail(res, "You have no betting points left.");
    }

    return fail(res, "You do not have enough betting points.");
  }

  // Return a previous bet before replacing it.
  if (existingBet) {
    currentPlayer.points += existingBet.stake;

    match.bets = match.bets.filter(
      (bet) => bet.player !== currentPlayer.id
    );
  }

  // Points are deducted immediately.
  currentPlayer.points -= stake;

  match.bets.push({
    player: currentPlayer.id,
    pick: req.body.pick,
    stake
  });

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/win", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) return fail(res, "Tournament not found", 404);

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  const match = tournament.matches.find(
    (m) => m.id === req.body.match
  );

  if (
    !match ||
    match.status !== "live" ||
    ![match.a, match.b].includes(req.body.winner)
  ) {
    return fail(res, "Invalid result");
  }

  match.status = "done";
  match.winner = req.body.winner;

  const winner = player(tournament, match.winner);
  const loser = player(
    tournament,
    match.a === match.winner ? match.b : match.a
  );

  winner.wins += 1;
  loser.losses += 1;

  // Winning bets pay double the stake; losing stakes stay deducted.
  for (const bet of match.bets) {
    if (bet.pick === winner.id) {
      player(tournament, bet.player).points += bet.stake * 2;
    }
  }

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/stop", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) return fail(res, "Tournament not found", 404);

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  tournament.phase = "stopped";
  tournament.stopped = true;

  saveTournament(tournament);
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("watch", (invite) => {
    socket.join(invite);
  });
});

server.listen(port, () => {
  console.log(`Game Night Live is running on port ${port}`);
});