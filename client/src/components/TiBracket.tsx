import type { TiBracketMatch } from 'shared';
import TeamCrest from './TeamCrest';
import './TiBracket.css';

function groupRounds(matches: TiBracketMatch[], side: TiBracketMatch['bracket']) {
  const rows = matches.filter((m) => m.bracket === side);
  const order: string[] = [];
  for (const match of rows) {
    if (!order.includes(match.round)) order.push(match.round);
  }
  return order.map((round) => ({ round, matches: rows.filter((m) => m.round === round) }));
}

function Seed({ name, winner, playerTeam }: { name: string; winner: string; playerTeam: string | null }) {
  const isWinner = name.length > 0 && name === winner;
  const isLoser = name.length > 0 && winner.length > 0 && name !== winner;
  const isPlayer = Boolean(playerTeam && name === playerTeam);
  return (
    <div
      className={`ti-seed${isWinner ? ' is-winner' : ''}${isLoser ? ' is-loser' : ''}${isPlayer ? ' is-you' : ''}`}
    >
      {name ? <TeamCrest name={name} size={22} /> : <span className="ti-seed-blank" />}
      <span className="ti-seed-name">{name || 'TBD'}</span>
    </div>
  );
}

function MatchCard({
  match,
  current,
  playerTeam,
}: {
  match: TiBracketMatch;
  current: boolean;
  playerTeam: string | null;
}) {
  const trophy = Boolean(
    match.bracket === 'grand' && match.winner && playerTeam && match.winner === playerTeam,
  );
  const empty = !match.teamA && !match.teamB && !match.winner;
  return (
    <article
      className={`ti-match${current ? ' is-current' : ''}${match.winner ? ' is-played' : ''}${trophy ? ' is-trophy' : ''}${empty ? ' is-empty' : ''}`}
      data-match-id={match.id}
    >
      <Seed name={match.teamA} winner={match.winner} playerTeam={playerTeam} />
      <Seed name={match.teamB} winner={match.winner} playerTeam={playerTeam} />
    </article>
  );
}

function Lane({
  label,
  rounds,
  currentMatchId,
  playerTeam,
}: {
  label: string;
  rounds: { round: string; matches: TiBracketMatch[] }[];
  currentMatchId: string | null;
  playerTeam: string | null;
}) {
  if (rounds.length === 0) return null;
  return (
    <div className="ti-lane">
      <div className="ti-lane-label">{label}</div>
      <div className="ti-lane-rounds">
        {rounds.map((col) => (
          <div key={col.round} className="ti-round">
            <div className="ti-round-label">{col.round.replace(/Bracket /g, '')}</div>
            <div className="ti-round-stack">
              {col.matches.map((match) => (
                <MatchCard
                  key={match.id}
                  match={match}
                  current={currentMatchId === match.id}
                  playerTeam={playerTeam}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TiBracket({
  matches,
  currentMatchId,
  playerTeam,
  upperLabel,
  lowerLabel,
  grandLabel,
  finale,
}: {
  matches: TiBracketMatch[];
  currentMatchId: string | null;
  playerTeam: string | null;
  upperLabel: string;
  lowerLabel: string;
  grandLabel: string;
  finale?: 'champion' | 'eliminated' | null;
}) {
  const upper = groupRounds(matches, 'upper');
  const lower = groupRounds(matches, 'lower');
  const grand = matches.filter((m) => m.bracket === 'grand');
  const finaleClass =
    finale === 'champion' ? ' is-champion' : finale === 'eliminated' ? ' is-eliminated' : '';

  return (
    <div className="ti-tree-scroll" data-testid="ti-bracket" data-finale={finale ?? ''}>
      <div className={`ti-tree${finaleClass}`}>
        <div className="ti-tree-body">
          <Lane label={upperLabel} rounds={upper} currentMatchId={currentMatchId} playerTeam={playerTeam} />
          <Lane label={lowerLabel} rounds={lower} currentMatchId={currentMatchId} playerTeam={playerTeam} />
        </div>
        {grand.length > 0 && (
          <div className="ti-tree-grand">
            <div className="ti-lane-label">{grandLabel}</div>
            {grand.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                current={currentMatchId === match.id}
                playerTeam={playerTeam}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
