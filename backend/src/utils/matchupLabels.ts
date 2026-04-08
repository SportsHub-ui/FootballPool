const genericMatchupNames = new Set([
  'WINNING SCORE',
  'LOSING SCORE',
  'HOME TEAM',
  'AWAY TEAM',
  'OPPONENT',
  'PREFERRED TEAM',
  'TEAM'
]);

export const normalizeMatchupName = (value?: string | null): string => String(value ?? '').trim().replace(/\s+/g, ' ');

const toMatchupKey = (value?: string | null): string => normalizeMatchupName(value).toUpperCase();

export const isGenericMatchupName = (value?: string | null): boolean => genericMatchupNames.has(toMatchupKey(value));

export const parseMatchupLabel = (value?: string | null): { homeName: string; awayName: string } | null => {
  const normalized = normalizeMatchupName(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(.*?)\s+(?:vs\.?|v\.?|@|at)\s+(.*?)$/i);
  if (!match) {
    return null;
  }

  const homeName = normalizeMatchupName(match[1]);
  const awayName = normalizeMatchupName(match[2]);

  if (!homeName || !awayName) {
    return null;
  }

  return { homeName, awayName };
};

export const buildMatchupDisplayLabel = (
  homeName?: string | null,
  awayName?: string | null,
  options?: {
    roundLabel?: string | null;
    fallback?: string | null;
  }
): string => {
  const home = normalizeMatchupName(homeName);
  const away = normalizeMatchupName(awayName) || normalizeMatchupName(options?.fallback);

  if (!away) {
    return normalizeMatchupName(options?.fallback) || 'Opponent';
  }

  const hasRoundContext = normalizeMatchupName(options?.roundLabel).length > 0;
  const shouldCombine = hasRoundContext && home && !isGenericMatchupName(home) && toMatchupKey(home) !== toMatchupKey(away);

  return shouldCombine ? `${home} vs ${away}` : away;
};
