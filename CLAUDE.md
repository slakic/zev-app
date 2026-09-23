# zev-app — smjernice za agente

## Dizajn sistem

Prije nego što napišeš ili prestilizuješ bilo koju UI komponentu ili stranicu u ovom
projektu, koristi skill `frontend-design` i pročitaj `Plans/design-system.md` — on
opisuje **već isporučen** sistem (tokeni boja u `src/app/globals.css` `@theme`,
tipografska skala, ritam razmaka od 4px, tri nivoa elevacije, šest težina dugmadi, cio
inventar primitiva iz `src/components/ui.tsx` i konvenciju ručno crtanih ikona iz
`src/components/nav-icons.tsx`) i **izvor je istine, ne prijedlog**.

Ponovo upotrijebi njegove tokene i primitive; **ne izmišljaj nove boje, vrijednosti
razmaka, veličine teksta ni tretmane dugmadi** i ne piši ručni markup koji duplira
postojeći primitiv. Posebno:

- Ništa što korisnik mora pročitati ne ide ispod 13px.
- Najviše jedno `primary` dugme po ekranskoj regiji.
- Novo `danger` (puna crvena) dugme se ne dodaje bez izričitog dogovora sa korisnikom, i
  uvijek ide iza `ConfirmAction`.
- Nikad ne ugnježđuj elevaciju (kartica/tabela/panel istog ili jačeg nivoa unutar drugog
  istog nivoa).

Ako zadatak zaista traži obrazac koji sistem nema, **stani i pitaj korisnika** — predloži
ga kao dopunu dizajn sistema (uz razmotrene opcije i obrazloženje, u stilu postojećih
planova u `Plans/`) umjesto da ga tiho improvizuješ na jednoj stranici.

Puna istorija odluka i heuristička evaluacija koja je do ovog sistema dovela je u
`Plans/ui-ux-redesign-plan.md`.
