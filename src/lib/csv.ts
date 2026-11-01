// Čitanje CSV fajla (RFC 4180) za uvoz podataka iz tabele. ČISTO: bez baze i bez ijedne zavisnosti. Fajl je samo
// podatak — ovdje se ništa ne izvršava ni ne tumači osim razdvajanja na redove i ćelije.
// Zna: navodnike, "" kao navodnik u ćeliji, prelom reda unutar navodnika, CRLF/LF/CR i BOM; dekodira UTF-8, a ako bajtovi
// nisu ispravan UTF-8 (stari Excel), Windows-1250. Brojevi redova su FIZIČKI redovi fajla (zaglavlje = 1).

export type CsvDelimiter = ";" | "," | "\t";
export type CsvRow = { line: number; cells: string[] };

/** Tekst fajla; `windows1250` je true kad je fajl bio Windows-1250 (poziva se upozorenje). BOM se odsijeca. */
export function decodeText(bytes: Uint8Array): { text: string; windows1250: boolean } {
  let windows1250 = false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    windows1250 = true;
    text = new TextDecoder("windows-1250").decode(bytes);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, windows1250 };
}

/** Prvi zapis (zaglavlje) bez navodnika: razdjelnik je onaj kojeg ima najviše; kod izjednačenja `;`. */
export function detectDelimiter(text: string): CsvDelimiter {
  const counts: Record<CsvDelimiter, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  // Preskoči prazne redove na početku.
  let i = 0;
  while (i < src.length && (src[i] === "\n" || src[i] === "\r")) i++;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && (ch === ";" || ch === "," || ch === "\t")) counts[ch]++;
  }
  let best: CsvDelimiter = ";";
  for (const d of [",", "\t"] as const) if (counts[d] > counts[best]) best = d;
  return best;
}

/** Razdvaja tekst na zapise; prazni redovi (sve ćelije prazne) se preskaču, ali se računaju u broj reda. */
export function parseCsv(text: string, delimiter: CsvDelimiter): CsvRow[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1; // fizički red u kojem tekući zapis počinje
  let current = 1; // fizički red na kojem se parser nalazi
  let wasQuoted = false;

  const endCell = () => {
    cells.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c.trim() !== "")) rows.push({ line, cells });
    cells = [];
    line = current;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === "\n") current++;
        else if (ch === "\r") {
          if (src[i + 1] === "\n") i++;
          current++;
          cell += "\n";
          continue;
        }
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "" && !wasQuoted) {
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      current++;
      endRecord();
    } else cell += ch;
  }
  if (cell !== "" || cells.length > 0 || wasQuoted) endRecord();
  return rows;
}
