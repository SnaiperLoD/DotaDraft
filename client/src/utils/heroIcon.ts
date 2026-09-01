export function heroIconUrl(heroId: number): string {
  return `/icons/${heroId}.png`;
}

export function heroPortraitUrl(heroId: number): string {
  return `/portraits/${heroId}.png`;
}

/** In-game pick-screen splash (`dota_react/heroes/*.png`), not the 32px icon. */
export function heroSplashUrl(heroId: number): string {
  return `/heroes/${heroId}.png`;
}
