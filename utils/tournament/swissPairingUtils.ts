import blossom from 'edmonds-blossom';

interface Options {
  maxPerRound?: number;
  rematchWeight?: number;
  standingPower?: number;
  seedMultiplier?: number;
}

interface Participant {
  id: string;
  seed: number;
  droppedOut?: boolean;
  differential?: number;
}

interface Match {
  round: number;
  player_1: { id: string; points: number; gameScore?: number };
  player_2: { id: string; points: number; gameScore?: number };
}

interface Mapping {
  id: string | number;
  seed: number;
  droppedOut?: boolean;
  points: number;
  opponents: (string | null)[];
  differential?: number;
}

interface Standing {
  id: string;
  seed: number;
  wins: number;
  losses: number;
  differential: number;
}

interface Matchup {
  player_1: string | null;
  player_2: string | null;
}

function getStandings(round: number, participants: Participant[], matches: Match[]): Standing[] {
  matches = matches.filter(match => match.round < round);
  
  const standings: { [key: string]: { seed: number, wins: number, losses: number, differential: number } } = participants.reduce((standings, participant) => {
    standings[participant.id] = {
      seed: participant.seed,
      wins: 0,
      losses: 0,
      differential: 0 // Calculate differential from match game scores, not stored value
    };
    return standings;
  }, {} as { [key: string]: { seed: number, wins: number, losses: number, differential: number } });
  
  matches.forEach(match => {
    // Use match points (3 for win, 2 for timed win, 1.5 for draw, 0 for loss)
    standings[match.player_1.id].wins += match.player_1.points;
    standings[match.player_1.id].losses += match.player_2.points;
    
    // Calculate differential from game scores if available
    if (match.player_1.gameScore !== undefined && match.player_2.gameScore !== undefined) {
      standings[match.player_1.id].differential += (match.player_1.gameScore - match.player_2.gameScore);
    }
    
    // Handle player 2 (ignore null opponents/BYEs)
    if (match.player_2.id) {
      standings[match.player_2.id].wins += match.player_2.points;
      standings[match.player_2.id].losses += match.player_1.points;
      
      // Calculate differential for player 2
      if (match.player_1.gameScore !== undefined && match.player_2.gameScore !== undefined) {
        standings[match.player_2.id].differential += (match.player_2.gameScore - match.player_1.gameScore);
      }
    }
  });
  
  return Object.entries(standings).reduce((standingsArray, [key, value]) => {
    standingsArray.push({
      id: key,
      seed: value.seed,
      wins: value.wins,
      losses: value.losses,
      differential: value.differential
    });
    return standingsArray;
  }, [] as Standing[]).sort((a, b) => {
    if (a.wins === b.wins) {
      // Primary tiebreaker: differential (higher is better)
      if (a.differential === b.differential) {
        // Final tiebreaker: original seed (lower is better)
        return a.seed - b.seed;
      } else {
        return b.differential - a.differential; // Higher differential ranks better
      }
    } else {
      return b.wins - a.wins;
    }
  });
}

function getMatchups(options: Options, round: number, participants: Participant[], matches: Match[]): Matchup[] {
  matches = matches.filter(match => match.round < round);
  let mappings = getMappings(participants, matches);
  mappings = mappings.filter(m => !m.droppedOut);

  // because ids are strings but the blossom algorithm needs integers
  // we create maps from int-to-id then set the ids to integers
  const mapIds = new Map<number, string | null>();
  let index = 0;
  for (const m of mappings) {
    mapIds.set(index, m.id as string);
    m.id = index++;
  }

  if (mappings.length % 2 === 1) {
    // we simulate the bye having played against every team with a bye
    // that way those teams will not get a bye again unless the matches are
    // ridiculously better if they have another
    // we also want it to bias toward giving byes to teams at the bottom
    // of the standings
    mappings.push({
      id: index,
      points: 0,
      seed: 0,
      opponents: mappings.filter(m => {
        return m.opponents.filter(o => o === null).length > 0;
      }).map(m => mapIds.get(m.id as number) || null)
    } as Mapping);
    mapIds.set(index, null);
  }
  
  // to avoid repeatedly matching the same team up or down repeatedly
  // we shuffle the inputs to the blossom algorithm to counteract
  // any ordering biases it may have
  mappings = shuffle(mappings, round, options.seedMultiplier || 6781);
  
  const arr = mappings.reduce((arr, team, i, orig) => {
    const opps = orig.slice(0, i).concat(orig.slice(i + 1));
    for (const opp of opps) {
      // Calculate pairing weight based on:
      // 1. Point difference (primary factor)
      // 2. Differential difference (secondary factor, increased weight since it's primary tiebreaker)
      // 3. Rematch penalty
      const pointDifference = Math.pow(team.points - opp.points, options.standingPower || 2);
      const differentialDifference = Math.abs((team.differential || 0) - (opp.differential || 0)) * 0.5; // Increased weight for differential
      const rematchPenalty = (options.rematchWeight || 100) * team.opponents.reduce((n, o) => {
        return n + (o === mapIds.get(opp.id as number) ? 1 : 0);
      }, 0);
      
      arr.push([
        team.id as number,
        opp.id as number,
        -1 * (pointDifference + differentialDifference + rematchPenalty)
      ]);
    }
    return arr;
  }, [] as [number, number, number][]);

  const results = blossom(arr, true);
  const matchups: Matchup[] = [];
  
  // Here we sort matchups by standings so that matchups and standings follow
  // roughly the same order - this doesn't impact functionality at all
  // Ordering this in the view layer should be possible, so let's move it there
  // pending review
  const standings = getStandings(round, participants, matches);
  const sortedKeys = [...mapIds.keys()].sort((a, b) => {
    // Float BYEs to the end
    if (mapIds.get(a) === null) {
      return 1;
    } else if (mapIds.get(b) === null) {
      return -1;
    }
    return standings.findIndex(s => s.id === mapIds.get(a)) -
      standings.findIndex(s => s.id === mapIds.get(b));
  });
  
  for (const i of sortedKeys) {
    if (results[i] !== -1 && !matchups.reduce(
      (n, r) => n || r.player_1 === mapIds.get(results[i]),
      false)) {
      matchups.push({
        player_1: mapIds.get(i),
        player_2: mapIds.get(results[i])
      });
    }
  }
  return matchups;
}

function getMappings(participants: Participant[], matches: Match[]): Mapping[] {
  return participants.reduce((acc, participant) => {
    acc.push(matches.filter(match => {
      return match.player_1.id === participant.id ||
        match.player_2.id === participant.id;
    }).reduce((acc, match) => {
      if (match.player_1.id === participant.id) {
        acc.points += match.player_1.points;
        acc.opponents.push(match.player_2.id);
      } else if (match.player_2.id === participant.id) {
        acc.points += match.player_2.points;
        acc.opponents.push(match.player_1.id);
      }
      return acc;
    }, {
      id: participant.id,
      seed: participant.seed,
      droppedOut: participant.droppedOut,
      points: 0,
      opponents: [],
      differential: participant.differential || 0
    } as Mapping));
    return acc;
  }, [] as Mapping[]);
}

// Knuth shuffle from stack overflow
function shuffle(array: Mapping[], seed: number, multiplier: number): Mapping[] {
  let currentIndex = array.length;

  // fast, seeded PRNG from stackoverflow
  let s = seed;
  const random = () => {
    const x = (Math.abs((((s++ * multiplier) / Math.PI) % 4) - 2) - 1) * 10000;
    return x - Math.floor(x);
  };

  while (0 !== currentIndex) {
    const randomIndex = Math.floor(random() * currentIndex--);
    const temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }
  return array;
}

interface SwissPairing {
  getStandings: (round: number, participants: Participant[], matches: Match[]) => Standing[];
  getMatchups: (round: number, participants: Participant[], matches: Match[]) => Matchup[];
  getMappings: (participants: Participant[], matches: Match[]) => Mapping[];
}

export default function createSwissPairing(options?: Options): SwissPairing {
  const opts: Required<Options> = {
    maxPerRound: options?.maxPerRound || 1,
    rematchWeight: options?.rematchWeight || 100,
    standingPower: options?.standingPower || 2,
    seedMultiplier: options?.seedMultiplier || 6781,
  };

  return {
    getStandings: getStandings.bind(null, opts),
    getMatchups: getMatchups.bind(null, opts),
    getMappings: getMappings,
  };
}

// Export individual functions for direct usage
export {
  getStandings,
  getMatchups,
  getMappings,
  convertParticipantsToSwissFormat,
  convertMatchesToSwissFormat,
  convertMatchupsToDbFormat,
  findByePlayer,
  type Options,
  type Participant,
  type Match,
  type Mapping,
  type Standing,
  type Matchup,
  type DatabaseParticipant,
  type DatabaseMatch
};

// Adapter functions to convert between database format and Swiss pairing library format

interface DatabaseParticipant {
  id: string;
  name: string;
  match_points: number;
  differential: number;
  dropped_out: boolean;
}

interface DatabaseMatch {
  id: string;
  round: number;
  player1_id: string;
  player2_id: string;
  player1_score: number;
  player2_score: number;
  player1_match_points: number;
  player2_match_points: number;
  differential: number;
  differential2: number;
}

/**
 * Converts database participants to Swiss pairing format
 */
function convertParticipantsToSwissFormat(dbParticipants: DatabaseParticipant[]): Participant[] {
  return dbParticipants.map((participant, index) => ({
    id: participant.id,
    seed: index + 1, // Use index as seed if no specific seed is provided
    droppedOut: participant.dropped_out,
    differential: participant.differential || 0
  }));
}

/**
 * Converts database matches to Swiss pairing format
 * Properly handles the custom scoring system: 3 points (win), 2 points (timed win), 1.5 points (draw), 0 points (loss)
 */
function convertMatchesToSwissFormat(dbMatches: DatabaseMatch[]): Match[] {
  return dbMatches.map(match => ({
    round: match.round,
    player_1: {
      id: match.player1_id,
      points: match.player1_match_points || 0,
      gameScore: match.player1_score || 0
    },
    player_2: {
      id: match.player2_id,
      points: match.player2_match_points || 0,
      gameScore: match.player2_score || 0
    }
  }));
}

/**
 * Converts Swiss pairing matchups back to database format
 */
function convertMatchupsToDbFormat(
  matchups: Matchup[], 
  tournamentId: string, 
  round: number,
  participantsMap: Map<string, DatabaseParticipant>
): any[] {
  return matchups
    .filter(matchup => matchup.player_1 !== null && matchup.player_2 !== null) // Filter out byes
    .map((matchup, index) => {
      const player1 = participantsMap.get(matchup.player_1!);
      const player2 = participantsMap.get(matchup.player_2!);
      
      return {
        tournament_id: tournamentId,
        round: round,
        player1_id: matchup.player_1,
        player2_id: matchup.player_2,
        player1_score: null,
        player2_score: null,
        player1_match_points: player1?.match_points || 0,
        player2_match_points: player2?.match_points || 0,
        differential: player1?.differential || 0,
        differential2: player2?.differential || 0,
        match_order: index + 1
      };
    });
}

/**
 * Finds the bye player from matchups (player_2 is null)
 */
function findByePlayer(matchups: Matchup[]): string | null {
  const byeMatchup = matchups.find(matchup => matchup.player_1 !== null && matchup.player_2 === null);
  return byeMatchup?.player_1 || null;
}