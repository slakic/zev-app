// Which sidebar entry counts as "current" for a pathname (Plans/f2-orijentacija-u-skoljci-plan.md
// F2.1). Pure so it can be unit-tested without rendering the shell.
//
// A link matches its own path exactly or any sub-path (`href + "/"` prefix — never a bare
// prefix, so `/fakture-xyz` is not under `/fakture`). "/" matches only "/". When several
// links match (e.g. `/admin` and `/admin/aktivnosti`), the longest href wins, so exactly
// one entry is ever active.
export function activeHref(pathname: string, hrefs: readonly string[]): string | undefined {
  let best: string | undefined;
  for (const href of hrefs) {
    const matches = pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
    if (matches && (best === undefined || href.length > best.length)) best = href;
  }
  return best;
}
