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

function player(tournament, id) {
  return tournament.players.find((p) => p.id === id);
}

function isMaster(tournament, body) {
  return body.master && body.master === tournament.master;
}

function fail(res, message, status = 400) {
  return res.status(status).json({ error: message });
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

function createMatch(tournament, a, b, stage, bracket, round) {
  const match = {
    id: token(8),
    a,
    b,
    stage,
    bracket,
    round,
    status: "ready",
    bets: []
  };

  tournament.matches.push(match);
  return match;
}

function chooseWeightedCharacter(player) {
  /*
    Each player has their own five-character cycle.

    - At the beginning: every character is 20%.
    - Once picked: that character becomes 10%.
    - The remaining probability is spread evenly over unpicked characters.
    - Once all five have been picked: the cycle resets to 20% each.
  */

  if (!Array.isArray(player.characterHistory)) {
    player.characterHistory = [];
  }

  if (player.characterHistory.length >= player.characters.length) {
    player.characterHistory = [];
  }

  const pickedIndexes = new Set(player.characterHistory);

  const unpickedIndexes = player.characters
    .map((_, index) => index)
    .filter((index) => !pickedIndexes.has(index));

  const pickedCharacterWeight = 0.1;

  const unpickedCharacterWeight =
    (1 - pickedIndexes.size * pickedCharacterWeight) /
    unpickedIndexes.length;

  const weights = player.characters.map((_, index) =>
    pickedIndexes.has(index)
      ? pickedCharacterWeight
      : unpickedCharacterWeight
  );

  let roll = Math.random();
  let chosenIndex = weights.length - 1;

  for (let index = 0; index < weights.length; index += 1) {
    roll -= weights[index];

    if (roll <= 0) {
      chosenIndex = index;
      break;
    }
  }

  player.characterHistory.push(chosenIndex);

  return player.characters[chosenIndex];
}

function seededPairs(players) {
  const pairs = [];
  let left = 0;
  let right = players.length - 1;

  while (left < right) {
    pairs.push([players[left], players[right]]);
    left += 1;
    right -= 1;
  }

  return {
    pairs,
    bye: left === right ? players[left] : null
  };
}

function allDone(tournament, ids) {
  return ids.every(
    (id) =>
      tournament.matches.find((match) => match.id === id)?.status === "done"
  );
}

function createBrackets(tournament) {
  const ranked = [...tournament.players].sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.points - a.points
  );

  const winnerCount = Math.ceil(ranked.length / 2);

  tournament.phase = "brackets";

  tournament.bracket = {
    winnersPending: ranked.slice(0, winnerCount).map((p) => p.id),
    losersPending: ranked.slice(winnerCount).map((p) => p.id),

    winnerRound: 0,
    loserRound: 0,

    winnerRoundIds: [],
    loserRoundIds: [],

    winnerCarry: [],
    loserCarry: [],

    winnerChampion: null,
    loserChampion: null,
    champion: null,

    grandFinalId: null,
    resetFinalId: null
  };

  startWinnerRound(tournament);
  startLoserRound(tournament);
}

function startWinnerRound(tournament) {
  const bracket = tournament.bracket;

  if (bracket.winnerRoundIds.length || bracket.winnerChampion) {
    return;
  }

  const players = bracket.winnersPending.splice(0);

  if (players.length === 1) {
    bracket.winnerChampion = players[0];
    maybeCreateGrandFinal(tournament);
    return;
  }

  if (!players.length) {
    return;
  }

  bracket.winnerRound += 1;

  const { pairs, bye } = seededPairs(players);

  bracket.winnerCarry = bye ? [bye] : [];

  bracket.winnerRoundIds = pairs.map(([a, b]) =>
    createMatch(
      tournament,
      a,
      b,
      `Winners bracket - round ${bracket.winnerRound}`,
      "winners",
      bracket.winnerRound
    ).id
  );
}

function startLoserRound(tournament) {
  const bracket = tournament.bracket;

  if (bracket.loserRoundIds.length || bracket.loserChampion) {
    return;
  }

  const players = bracket.losersPending.splice(0);

  if (players.length === 1) {
    bracket.losersPending.push(players[0]);

    if (bracket.winnerChampion) {
      bracket.loserChampion = players[0];
      bracket.losersPending = [];
      maybeCreateGrandFinal(tournament);
    }

    return;
  }

  if (!players.length) {
    return;
  }

  bracket.loserRound += 1;

  const { pairs, bye } = seededPairs(players);

  bracket.loserCarry = bye ? [bye] : [];

  bracket.loserRoundIds = pairs.map(([a, b]) =>
    createMatch(
      tournament,
      a,
      b,
      `Losers bracket - round ${bracket.loserRound}`,
      "losers",
      bracket.loserRound
    ).id
  );
}

function winnerRoundFinished(tournament) {
  const bracket = tournament.bracket;

  if (
    !bracket.winnerRoundIds.length ||
    !allDone(tournament, bracket.winnerRoundIds)
  ) {
    return false;
  }

  bracket.winnersPending.push(...bracket.winnerCarry);
  bracket.winnerCarry = [];
  bracket.winnerRoundIds = [];

  startWinnerRound(tournament);

  return true;
}

function loserRoundFinished(tournament) {
  const bracket = tournament.bracket;

  if (
    !bracket.loserRoundIds.length ||
    !allDone(tournament, bracket.loserRoundIds)
  ) {
    return false;
  }

  bracket.losersPending.push(...bracket.loserCarry);
  bracket.loserCarry = [];
  bracket.loserRoundIds = [];

  return true;
}

function advanceLosersWhenReady(tournament) {
  const bracket = tournament.bracket;

  if (bracket.loserRoundIds.length) {
    return;
  }

  if (
    bracket.winnerRoundIds.length &&
    !allDone(tournament, bracket.winnerRoundIds)
  ) {
    return;
  }

  startLoserRound(tournament);
}

function maybeCreateGrandFinal(tournament) {
  const bracket = tournament.bracket;

  if (
    !bracket.winnerChampion ||
    !bracket.loserChampion ||
    bracket.grandFinalId
  ) {
    return;
  }

  const match = createMatch(
    tournament,
    bracket.winnerChampion,
    bracket.loserChampion,
    "Grand final - set 1",
    "grand",
    1
  );

  match.note =
    "The winners-bracket champion needs one win. The losers-bracket champion must win twice.";

  bracket.grandFinalId = match.id;
}

function resolveBracketMatch(tournament, match) {
  const bracket = tournament.bracket;
  const loser = match.a === match.winner ? match.b : match.a;

  if (match.bracket === "winners") {
    bracket.winnersPending.push(match.winner);
    bracket.losersPending.push(loser);

    winnerRoundFinished(tournament);
    loserRoundFinished(tournament);
    advanceLosersWhenReady(tournament);
  }

  if (match.bracket === "losers") {
    bracket.losersPending.push(match.winner);

    loserRoundFinished(tournament);
    advanceLosersWhenReady(tournament);
  }
}

function resolveGrandFinal(tournament, match) {
  const bracket = tournament.bracket;

  if (match.bracket === "grand") {
    if (match.winner === bracket.winnerChampion) {
      bracket.champion = bracket.winnerChampion;
      tournament.phase = "completed";
      return;
    }

    const reset = createMatch(
      tournament,
      bracket.winnerChampion,
      bracket.loserChampion,
      "Grand final - reset set",
      "grand-reset",
      2
    );

    reset.note =
      "The losers-bracket champion won set 1. Winner of this set wins the tournament.";

    bracket.resetFinalId = reset.id;
    return;
  }

  bracket.champion = match.winner;
  tournament.phase = "completed";
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
    randomCharacters: req.body.randomCharacters !== false,
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

  if (!name) {
    return fail(res, "Enter your name");
  }

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
    characterHistory: [],
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

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

  const currentPlayer = player(tournament, req.body.id);

  if (!currentPlayer || currentPlayer.key !== req.body.key) {
    return fail(res, "Player access required", 403);
  }

  if (tournament.randomCharacters === false) {
    return fail(res, "This tournament does not use randomized characters");
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

  // Changing the chosen five characters starts a fresh probability cycle.
  currentPlayer.characterHistory = [];

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/add", (req, res) => {
  const tournament = getTournament(req.params.invite);
  const name = req.body.name?.trim();

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  if (tournament.phase !== "registration") {
    return fail(res, "Registration is closed");
  }

  if (!name) {
    return fail(res, "Enter a name");
  }

  if (
    tournament.players.some(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
  ) {
    return fail(res, "Choose a unique name");
  }

  if (
    tournament.randomCharacters !== false &&
    (
      !Array.isArray(req.body.characters) ||
      req.body.characters.length !== 5 ||
      req.body.characters.some((character) => !String(character).trim())
    )
  ) {
    return fail(res, "Enter all five characters for this player");
  }

  const characters =
    tournament.randomCharacters === false
      ? []
      : req.body.characters.map((character) => String(character).trim());

  const newPlayer = {
    id: token(8),
    key: token(),
    name,
    characters,
    characterHistory: [],
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

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

  if (!isMaster(tournament, req.body)) {
    return fail(res, "Game master access required", 403);
  }

  if (tournament.players.length < 4) {
    return fail(res, "At least four players are needed");
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

  for (let i = pairings.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairings[i], pairings[j]] = [pairings[j], pairings[i]];
  }

  tournament.matches = [];

  for (const [a, b] of pairings) {
    createMatch(tournament, a, b, "Pool stage", "pool", 0);
  }

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/go", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

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
    tournament.randomCharacters !== false &&
    (
      firstPlayer.characters.length !== 5 ||
      secondPlayer.characters.length !== 5
    )
  ) {
    return fail(
      res,
      "Both players must choose five characters first"
    );
  }

  match.status = "live";

  if (tournament.randomCharacters !== false) {
    match.characters = {
      [firstPlayer.id]: chooseWeightedCharacter(firstPlayer),
      [secondPlayer.id]: chooseWeightedCharacter(secondPlayer)
    };
  }

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/bet", (req, res) => {
  const tournament = getTournament(req.params.invite);
  const stake = Number(req.body.stake);

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

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
    return fail(
      res,
      currentPlayer.points === 0
        ? "You have no betting points left."
        : "You do not have enough betting points."
    );
  }

  if (existingBet) {
    currentPlayer.points += existingBet.stake;

    match.bets = match.bets.filter(
      (bet) => bet.player !== currentPlayer.id
    );
  }

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

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

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

  for (const bet of match.bets) {
    if (bet.pick === winner.id) {
      player(tournament, bet.player).points += bet.stake * 2;
    }
  }

  const poolMatches = tournament.matches.filter(
    (m) => m.bracket === "pool"
  );

  if (
    match.bracket === "pool" &&
    poolMatches.every((poolMatch) => poolMatch.status === "done")
  ) {
    createBrackets(tournament);
  } else if (
    match.bracket === "winners" ||
    match.bracket === "losers"
  ) {
    resolveBracketMatch(tournament, match);
  } else if (
    match.bracket === "grand" ||
    match.bracket === "grand-reset"
  ) {
    resolveGrandFinal(tournament, match);
  }

  saveTournament(tournament);
  res.json({ ok: true });
});

app.post("/api/:invite/stop", (req, res) => {
  const tournament = getTournament(req.params.invite);

  if (!tournament) {
    return fail(res, "Tournament not found", 404);
  }

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