import { useState } from 'react';
import { teamInitials } from 'shared';
import { teamLogoUrl } from '../utils/teamLogo';
import './TeamCrest.css';

export default function TeamCrest({
  name,
  size = 32,
  className = '',
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const src = teamLogoUrl(name);
  const [failed, setFailed] = useState(false);
  const initials = teamInitials(name ?? '?');

  if (!name || !src || failed) {
    return (
      <span
        className={`team-crest team-crest--fallback ${className}`.trim()}
        style={{ width: size, height: size, fontSize: Math.max(9, size * 0.32) }}
        aria-hidden="true"
      >
        {initials}
      </span>
    );
  }

  return (
    <img
      className={`team-crest ${className}`.trim()}
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}
