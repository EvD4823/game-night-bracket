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
        body: JSON.stringify({ invite, master }),
        headers: { "content-type": "application/json" }
      }));
    }

    const [, , invite, action = "state"] = url.pathname.split("/");

    if (!invite) return json({ error: "Missing tournament" }, 400);

    const stub = env.TOURNAMENT.get(env.TOURNAMENT.idFromName(invite));

    return stub.fetch(new Request(`https://room/${action}`, {
      method: request.method,
      body: request.body,
      headers: request.headers
    }));
  }
};

export class TournamentRoom {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname.slice(1);
    const body = request.method === "GET" ? {} : await request.json();
    let tournament = await this.state.storage.get("t");

    if (path === "init") {
      tournament = {
        ...body,
        players: [],
        matches: [],
        phase: "registration"
      };

      await this.save(tournament);
      return json({ invite: body.invite, master: body.master });
    }

    if (!tournament) return json({ error: "Not found" }, 404);

    if (path === "state") {
      return json(this.publicTournament(tournament));
    }

    const isMaster = body.master === tournament.master;

    if (path === "join") {
      if (tournament.phase !== "registration") {
        return json({ error: "Registration is closed" }, 400);
      }

      const name = body.name?.trim();

      if (
        !name ||
        tournament.players.some(
          (player) => player.name.toLowerCase() === name.toLowerCase()
        )
      ) {
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

      tournament.players.push(player);
      await this.save(tournament);

      return json({ id: player.id, key: player.key });
    }

     if (path === "characters") {
    const player = tournament.players.find(
        (item) => item.id === body.id && item.key === body.key
    );

    if (
        !player ||
        !Array.isArray(body.characters) ||
        body.characters.length !== 5 ||
        new Set(body.characters).size !== 5
    ) {
        return json({ error: "Exactly five different characters are required" }, 400);
    }

    player.characters = body.characters;
    await this.save(tournament);

    return json({ ok: true });
    }

    if (!isMaster) {
      return json({ error: "Game master access required" }, 403);
    }

    if (path === "add") {
      const name = body.name?.trim();

      if (!name) return json({ error: "Name required" }, 400);

      const player = {
        id: crypto.randomUUID(),
        key: crypto.randomUUID(),
        name,
        characters: [],
        points: 100,
        wins: 0,
        losses: 0
      };

      tournament.players.push(player);
      await this.save(tournament);

      return json({ player });
    }

    if (path === "start") {
      if (tournament.players.length < 4) {
        return json({ error: "At least 4 players needed" }, 400);
      }

      tournament.phase = "pools";

      for (let first = 0; first < tournament.players.length; first++) {
        for (let second = first + 1; second < tournament.players.length; second++) {
          tournament.matches.push({
            id: crypto.randomUUID(),
            a: tournament.players[first].id,
            b: tournament.players[second].id,
            status: "ready",
            stage: "pool",
            bets: []
          });
        }
      }

      await this.save(tournament);
      return json(this.publicTournament(tournament));
    }

    if (path === "go") {
      const match = tournament.matches.find((item) => item.id === body.match);

      if (!match || match.status !== "ready") {
        return json({ error: "Match unavailable" }, 400);
      }

      if (tournament.players.some((player) => player.characters.length !== 5)) {
        return json({ error: "Everyone needs 5 characters" }, 400);
      }

      match.status = "live";
      match.characters = {};

      for (const playerId of [match.a, match.b]) {
        const player = tournament.players.find((item) => item.id === playerId);
        match.characters[playerId] =
          player.characters[Math.floor(Math.random() * 5)];
      }

      await this.save(tournament);
      return json({ ok: true });
    }

    if (path === "win") {
      const match = tournament.matches.find((item) => item.id === body.match);

      if (
        !match ||
        match.status !== "live" ||
        ![match.a, match.b].includes(body.winner)
      ) {
        return json({ error: "Invalid result" }, 400);
      }

      match.status = "done";
      match.winner = body.winner;

      const loser = match.a === match.winner ? match.b : match.a;

      tournament.players.find((player) => player.id === match.winner).wins++;
      tournament.players.find((player) => player.id === loser).losses++;

      for (const bet of match.bets) {
        const player = tournament.players.find((item) => item.id === bet.player);
        player.points += bet.pick === match.winner ? bet.stake : -bet.stake;
      }

      await this.save(tournament);
      return json({ ok: true });
    }

    if (path === "bet") {
      const match = tournament.matches.find((item) => item.id === body.match);
      const player = tournament.players.find(
        (item) => item.id === body.id && item.key === body.key
      );

      if (
        !match ||
        match.status !== "ready" ||
        !player ||
        ![match.a, match.b].includes(body.pick) ||
        [match.a, match.b].includes(player.id) ||
        body.stake < 1 ||
        body.stake > player.points
      ) {
        return json({ error: "Invalid bet" }, 400);
      }

      match.bets = match.bets.filter((bet) => bet.player !== player.id);
      match.bets.push({
        player: player.id,
        pick: body.pick,
        stake: Number(body.stake)
      });

      await this.save(tournament);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 404);
  }

  publicTournament(tournament) {
    return {
      ...tournament,
      master: undefined,
      players: tournament.players.map(({ key, ...player }) => player)
    };
  }

  async save(tournament) {
    await this.state.storage.put("t", tournament);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}