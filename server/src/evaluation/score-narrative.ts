export type ScoreBracket = 'low' | 'mid' | 'high';

export function scoreBracket(score: number): ScoreBracket {
  if (score < 4) return 'low';
  if (score < 7) return 'mid';
  return 'high';
}

type NarrativeSet = Record<ScoreBracket, string>;

export const AXIS_NARRATIVE: Record<string, NarrativeSet> = {
  teamfight: {
    high: 'This team wants to force 5v5 fights and win through raw teamfight power.',
    mid: "This team can hold its own in a teamfight but isn't built to win every engagement.",
    low: 'This team is weak in open teamfights and should avoid grouping for even fights.',
  },
  tempo: {
    high: 'Expect an early, fast-paced game — this draft wants to snowball before the enemy scales.',
    mid: 'This draft has a moderate pace and can play either an early or a patient game.',
    low: 'This draft is slow to get going and will look to avoid early confrontations.',
  },
  scaling: {
    high: 'This team gets significantly stronger in the late game and should prioritize surviving to that point.',
    mid: "This team scales reasonably but isn't a guaranteed late-game powerhouse.",
    low: "This team doesn't scale well into the late game and should look to end it early.",
  },
  mobility: {
    high: 'High mobility lets this team roam the map, secure picks, and reposition quickly in fights.',
    mid: "This team has some mobility tools but isn't especially map-mobile.",
    low: 'Low mobility makes this team vulnerable to being caught out and slow to rotate.',
  },
  map_control: {
    high: 'Strong map control — wards, roaming presence, and vision-granting tools should let this team see ganks coming and set up their own.',
    mid: 'Map control is average — standard warding discipline and positioning will be needed.',
    low: 'Weak map control makes this team vulnerable to ganks and enemy rotations.',
  },
  objectives: {
    high: 'This team pushes lanes and takes structures well, and should look to close games through map control.',
    mid: "This team can take objectives when needed but isn't specialized for pushing.",
    low: 'This team is weak at taking objectives and should focus on picking up kills over pushing.',
  },
  saving: {
    high: 'Strong saving power — healing and defensive tools should keep key heroes alive through bad fights.',
    mid: "Some saving tools are available, but this team can't bail out every bad engagement.",
    low: 'Little in the way of healing or defensive cooldowns — a bad engagement is likely to end in a death.',
  },
  burst: {
    high: 'This team can burst down key targets quickly — a good pick-off window is often lethal.',
    mid: "This team has some burst potential but can't reliably one-shot priority targets.",
    low: 'Low burst damage means this team relies on sustained fighting rather than quick kills.',
  },
  control: {
    high: 'Heavy disable — this team can lock down key targets and dictate when fights happen.',
    mid: 'This team has some disable but not enough to fully control a fight on its own.',
    low: 'Light on disables — this team will struggle to lock down mobile or tanky targets.',
  },
  durability: {
    high: 'This team is tanky and hard to burst down, and can afford to front-line in fights.',
    mid: 'This team has moderate durability but can still be burst down by focused damage.',
    low: 'This team is fragile and vulnerable to burst damage — bad positioning is likely to be punished.',
  },
  initiating: {
    high: 'Strong initiation tools let this team pick when and where fights start, catching opponents out of position.',
    mid: 'This team can start some fights on its own terms, but lacks a dedicated initiation threat.',
    low: 'Weak initiation means this team will usually be reacting to fights rather than starting them.',
  },
  aggression: {
    high: 'This team leans into risk — trading and dying for value rather than playing it safe, which real match data links to a better actual win rate than a pure stat sheet would suggest.',
    mid: 'This team has a moderate risk appetite — not purely passive, but not built around constant fighting either.',
    low: 'This team plays it safe, prioritizing efficient farm over trades — real data suggests that safety can come at the cost of actually winning.',
  },
  farm_priority: {
    high: 'This team leans heavily on personal farm optimization (stacking camps, maximizing CS) — good on the stat sheet, but real data links heavy farm focus to a lower actual win rate.',
    mid: 'This team balances farm efficiency with the rest of its game plan.',
    low: "This team doesn't prioritize personal farm optimization — its value comes from elsewhere.",
  },
};

export const SYNERGY_NARRATIVE: NarrativeSet = {
  high: "This is a well-connected draft — the heroes' kits actively support one another.",
  mid: "This draft has some hero synergy, but the picks don't form a tightly connected game plan.",
  low: "This draft is fairly disconnected — the heroes don't strongly support each other's game plans.",
};

export const COUNTER_NARRATIVE: NarrativeSet = {
  high: 'This team is well-equipped to answer a wide range of common threats.',
  mid: 'This team covers some common threats but has notable gaps.',
  low: 'This team has little in the way of specialized counters and may struggle against common threats like illusions or invisibility.',
};
