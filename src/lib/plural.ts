// Oblici množine za brojeve u bosanskom/srpskom (ijekavica): 1, 21, 101 -> "jedan"; 2-4 (osim 12-14) -> "few"; ostalo -> "other".
export function isOneForm(n: number): boolean {
  return Math.abs(n) % 10 === 1 && Math.abs(n) % 100 !== 11;
}

export function isFewForm(n: number): boolean {
  const a = Math.abs(n) % 100;
  return a % 10 >= 2 && a % 10 <= 4 && !(a >= 12 && a <= 14);
}
