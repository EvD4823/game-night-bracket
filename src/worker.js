export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/create" && request.method === "POST") {
      const invite = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
      const master = crypto.randomUUID().replaceAll("-", "");
      const stub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(invite));

      return stub.fetch(new Request("https://room/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invite, master })
      }));
    }

    const [, , invite, action = "state"] = url.pathname.split("/");
    const stub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(invite));

    return stub.fetch(new Request(`https://room/${action}`, {
      method: request.method,
      headers: request.headers,
      body: request.body
    }));
  }
};

export class TournamentRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const action = new URL(request.url).pathname.slice(1);
    const body = request.method === "GET" ? {} : await request.json();
    let t = await this.state.storage.get("t");

    if (action === "init") {
      t = {
        ...body,
        phase: "registration",
        players: [],
        matches: [],
        winnerChampion: null,
        loserChampion: null,
        champion: null
      };

      await this.save(t);
      return json({ invite: t.invite, master: t.master });
    }

    if (!t) return json({ error: "Tournament not found" }, 404);
    if (action === "state") return json(this.public(t));

    const isMaster = body.master === t.master;

    if (action === "join") {
      if (t.phase !== "registration") return json({ error: "Registration is closed" }, 400);

      const name = body.name?.trim();

      if (!name || t.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
        return json({ error: "Choose a unique name" }, 400);
      }

      const player = {
        id: crypto.randomUUID(),
        key: crypto.randomUUID(),
        name,
        characters: [],
        points: 100,
        wins: 0,
        losses: 0
      };

      t.players.push(player);
      await this.save(t);

      return json({ id: player.id, key: player.key });
    }

    if (action === "characters") {
      const player = t.players.find((p) => p.id === body.id && p.key === body.key);
      const characters = cleanCharacters(body.characters);

      if (!player || !characters) {
        return json({ error: "Choose exactly five different characters" }, 400);
      }

      player.characters = characters;
      await this.save(t);

      return json({ ok: true });
    }

    if (action === "bet") {
  const player = t.players.find(
    (p) => p.id === body.id && p.key === body.key
  );

  const match = t.matches.find((m) => m.id === body.match);
  const stake = Number(body.stake);

  if (!player) {
    return json({ error: "Player not recognised" }, 400);
  }

  if (player.points <= 0) {
    return json({
      error: "You cannot place a bet because you have no points left."
    }, 400);
  }

  if (!match || match.status !== "ready") {
    return json({ error: "Betting is closed for this match" }, 400);
  }

  if ([match.a, match.b].includes(player.id)) {
    return json({ error: "You cannot bet on your own match" }, 400);
  }

  if (![match.a, match.b].includes(body.pick)) {
    return json({ error: "Choose one of the two players" }, 400);
  }

  if (!Number.isInteger(stake) || stake < 1) {
    return json({ error: "Enter a valid stake" }, 400);
  }

  /* Refund an earlier bet by this player before replacing it. */
  const earlierBet = match.bets.find((bet) => bet.player === player.id);

  if (earlierBet) {
    player.points += earlierBet.stake;
    match.bets = match.bets.filter((bet) => bet.player !== player.id);
  }

  if (stake > player.points) {
    return json({ error: "You do not have enough points for that bet" }, 400);
  }

  /* Stake is paid immediately. */
  player.points -= stake;

  match.bets.push({
    player: player.id,
    pick: body.pick,
    stake
  });

  await this.save(t);
  return json({ ok: true });
}

    if (!isMaster) return json({ error: "Game master access required" }, 403);

    if (action === "stop") {
  t.phase = "stopped";
  t.stoppedAt = new Date().toISOString();

  await this.save(t);

  return json({ ok: true });
}

    if (action === "add") {
      const name = body.name?.trim();
      const characters = cleanCharacters(body.characters);

      if (!name || !characters) {
        return json({ error: "Name and five different characters are required" }, 400);
      }

      t.players.push({
        id: crypto.randomUUID(),
        key: crypto.randomUUID(),
        name,
        characters,
        points: 100,
        wins: 0,
        losses: 0
      });

      await this.save(t);
      return json({ ok: true });
    }

    if (action === "start") {
      if (t.players.length < 4) return json({ error: "At least four players are required" }, 400);
      if (t.players.some((p) => p.characters.length !== 5)) {
        return json({ error: "Every player must choose five characters" }, 400);
      }

      t.phase = "pools";

      const playerIds = shuffle(t.players.map((player) => player.id));

for (const [playerA, playerB, round] of fairPoolSchedule(playerIds)) {
  t.matches.push(match(
    "pool",
    `Pool stage - Round ${round}`,
    playerA,
    playerB,
    round
  ));
}

      await this.save(t);
      return json({ ok: true });
    }

    if (action === "go") {
      const m = t.matches.find((item) => item.id === body.match);

      if (!m || m.status !== "ready") return json({ error: "Match unavailable" }, 400);

      m.status = "live";
      m.characters = {};

      for (const playerId of [m.a, m.b]) {
        const player = t.players.find((p) => p.id === playerId);
        m.characters[playerId] = player.characters[Math.floor(Math.random() * 5)];
      }

      await this.save(t);
      return json({ ok: true });
    }

    if (action === "win") {
      const m = t.matches.find((item) => item.id === body.match);

      if (!m || m.status !== "live" || ![m.a, m.b].includes(body.winner)) {
        return json({ error: "Invalid result" }, 400);
      }

      m.status = "done";
      m.winner = body.winner;
      m.loser = m.a === m.winner ? m.b : m.a;

      t.players.find((p) => p.id === m.winner).wins++;
      t.players.find((p) => p.id === m.loser).losses++;

          for (const bet of m.bets) {
      const bettor = t.players.find((p) => p.id === bet.player);

      /*
        The stake was already deducted when betting.
        Correct prediction: return stake plus equal winnings.
        Incorrect prediction: return nothing.
      */
      if (bet.pick === m.winner) {
        bettor.points += bet.stake * 2;
      }
    }

      this.progress(t, m);
      await this.save(t);

      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 404);
  }

  progress(t, completedMatch) {
  /*
    POOL STAGE COMPLETE:
    Rank all four players, then create the double-elimination final phase.
  */
  if (completedMatch.stage === "pool") {
    const poolMatches = t.matches.filter((match) => match.stage === "pool");

    if (!poolMatches.every((match) => match.status === "done")) {
      return;
    }

    const ranked = [...t.players].sort(
      (a, b) =>
        (b.wins - a.wins) ||
        (a.losses - b.losses) ||
        a.name.localeCompare(b.name)
    );

    t.phase = "brackets";

    /*
      Winners Bracket Final:
      Pool positions 1 and 2.
    */
    t.matches.push(match(
      "winner",
      "Winners Bracket Final",
      ranked[0].id,
      ranked[1].id,
      1
    ));

    /*
      Losers Bracket Semi-final:
      Pool positions 3 and 4.
    */
    t.matches.push(match(
      "loser",
      "Losers Bracket Semi-final",
      ranked[2].id,
      ranked[3].id,
      1
    ));

    return;
  }

  /*
    WINNERS BRACKET FINAL:
    Winner reaches Grand Final immediately.
    Loser drops into the Losers Bracket Final.
  */
  if (
    completedMatch.stage === "winner" &&
    completedMatch.label === "Winners Bracket Final"
  ) {
    t.winnerChampion = completedMatch.winner;
    t.winnersBracketFinalLoser = completedMatch.loser;

    this.createLosersBracketFinalIfReady(t);
    return;
  }

  /*
    LOSERS BRACKET SEMI-FINAL:
    Winner waits for the loser of the Winners Bracket Final.
  */
  if (
    completedMatch.stage === "loser" &&
    completedMatch.label === "Losers Bracket Semi-final"
  ) {
    t.losersBracketSemiWinner = completedMatch.winner;

    this.createLosersBracketFinalIfReady(t);
    return;
  }

  /*
    LOSERS BRACKET FINAL:
    Its winner becomes the Grand Final challenger.
  */
  if (
    completedMatch.stage === "loser" &&
    completedMatch.label === "Losers Bracket Final"
  ) {
    t.loserChampion = completedMatch.winner;
    t.phase = "final";

    t.matches.push(match(
      "final",
      "Grand Final - Set 1",
      t.winnerChampion,
      t.loserChampion,
      1
    ));

    return;
  }

  /*
    GRAND FINAL:
    Winners Bracket champion needs one win.
    Losers Bracket champion must win Set 1 and the reset set.
  */
  if (completedMatch.stage === "final") {
  /*
    Grand Final - Set 1:
    Winners Bracket champion wins once = tournament champion.
    Losers Bracket champion wins = bracket reset.
  */
  if (completedMatch.round === 1) {
    if (completedMatch.winner === t.winnerChampion) {
      t.champion = t.winnerChampion;
      t.phase = "complete";
      return;
    }

    /*
      Losers Bracket champion won Set 1.
      They must win one more set to win the tournament.
    */
    t.matches.push(match(
      "final",
      "Grand Final Reset - Losers champion must win again",
      t.winnerChampion,
      t.loserChampion,
      2
    ));

    return;
  }

  /*
    Grand Final Reset:
    This is the second win required for the Losers Bracket champion.
  */
  if (completedMatch.round === 2) {
    t.champion = completedMatch.winner;
    t.phase = "complete";
  }
}
}

createLosersBracketFinalIfReady(t) {
  /*
    The Losers Bracket Final can only be made when:
    - the Winners Bracket Final has a loser to drop down; and
    - the Losers Bracket Semi-final has a winner.
  */
  if (
    !t.winnersBracketFinalLoser ||
    !t.losersBracketSemiWinner
  ) {
    return;
  }

  const alreadyCreated = t.matches.some(
    (match) =>
      match.stage === "loser" &&
      match.label === "Losers Bracket Final"
  );

  if (alreadyCreated) {
    return;
  }

  t.matches.push(match(
    "loser",
    "Losers Bracket Final",
    t.winnersBracketFinalLoser,
    t.losersBracketSemiWinner,
    2
  ));
}

  createBracket(t, stage, entrants, round = 1) {
    if (entrants.length === 1) {
      t[`${stage}Champion`] = entrants[0];
      return;
    }

    let size = 1;
    while (size < entrants.length) size *= 2;

    const padded = entrants.concat(Array(size - entrants.length).fill(null));
    const created = [];

    for (let index = 0; index < size; index += 2) {
      const a = padded[index];
      const b = padded[index + 1];

      if (!a && !b) continue;

      const item = match(
        stage,
        `${stage === "winner" ? "Winners" : "Losers"} Bracket - Round ${round}`,
        a,
        b,
        round
      );

      if (!a || !b) {
        item.status = "done";
        item.winner = a || b;
      }

      t.matches.push(item);
      created.push(item);
    }

    if (created.every((m) => m.status === "done")) {
      const winners = created.map((m) => m.winner).filter(Boolean);

      if (winners.length === 1) {
        t[`${stage}Champion`] = winners[0];
      } else {
        this.createBracket(t, stage, winners, round + 1);
      }
    }
  }

  public(t) {
    return {
      ...t,
      master: undefined,
      players: t.players.map(({ key, ...player }) => player)
    };
  }

  async save(t) {
    await this.state.storage.put("t", t);
  }
}

function cleanCharacters(value) {
  if (!Array.isArray(value)) return null;

  const characters = value.map((x) => String(x).trim()).filter(Boolean);

  return characters.length === 5 && new Set(characters).size === 5
    ? characters
    : null;
}

function match(stage, label, a, b, round = 1) {
  return {
    id: crypto.randomUUID(),
    stage,
    label,
    round,
    a,
    b,
    status: "ready",
    bets: [],
    characters: null
  };
}

function shuffle(items) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index--) {
    const randomIndex = Math.floor(Math.random() * (index + 1));

    [result[index], result[randomIndex]] = [
      result[randomIndex],
      result[index]
    ];
  }

  return result;
}

function fairPoolSchedule(playerIds) {
  const players = [...playerIds];

  /*
    For an odd player count, add a bye.
    Any pairing containing null is skipped.
  */
  if (players.length % 2 !== 0) {
    players.push(null);
  }

  const gamesPerRound = players.length / 2;
  const totalRounds = players.length - 1;
  const schedule = [];

  for (let round = 1; round <= totalRounds; round++) {
    const roundGames = [];

    for (let position = 0; position < gamesPerRound; position++) {
      const playerA = players[position];
      const playerB = players[players.length - 1 - position];

      if (playerA && playerB) {
        roundGames.push([playerA, playerB, round]);
      }
    }

    /*
      Rotate the order of games within each round.
      This avoids the same people always playing first.
    */
    const shift = (round - 1) % roundGames.length;

    schedule.push(
      ...roundGames.slice(shift),
      ...roundGames.slice(0, shift)
    );

    /*
      Circle-method rotation:
      the first position stays fixed and everyone else rotates.
    */
    players.splice(1, 0, players.pop());
  }

  return schedule;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}