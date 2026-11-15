// Izbor veličine teksta (Plans/pristupacni-prikaz-plan.md §3 P1): isti obrazac u kartici „Prikaz”
// („Moji podaci”) i u jednokratnom pitanju na početku. ChoiceCards, jer posljedica izbora mora biti
// vidljiva prije izbora; bez client JS-a.
import { t } from "@/lib/i18n";
import { Btn, ChoiceCards, SubmitBtn } from "@/components/ui";
import { setTextSizeAction } from "@/server/actions/display";

export function DisplayChoiceForm({ large, returnTo, saveLabel }: { large: boolean; returnTo?: string; saveLabel: string }) {
  return (
    <form action={setTextSizeAction} className="space-y-3">
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <ChoiceCards
        name="textSize"
        legend={t("settingsPage.display.legend")}
        defaultValue={large ? "large" : "normal"}
        options={[
          { value: "normal", title: t("settingsPage.display.normalTitle"), allowed: t("settingsPage.display.normalDesc") },
          { value: "large", title: t("settingsPage.display.largeTitle"), allowed: t("settingsPage.display.largeDesc") },
        ]}
      />
      <SubmitBtn>{saveLabel}</SubmitBtn>
    </form>
  );
}

/** Dugme „A+” u gornjoj traci (D-P3 B): prebacuje veličinu teksta u jednom dodiru, za sve školjke. */
export function TextSizeToggle({ large }: { large: boolean }) {
  return (
    <form action={setTextSizeAction}>
      <input type="hidden" name="textSize" value={large ? "normal" : "large"} />
      <Btn
        type="submit"
        variant="secondary"
        aria-pressed={large}
        aria-label={large ? t("settingsPage.display.toggleAriaNormal") : t("settingsPage.display.toggleAriaLarge")}
      >
        <span aria-hidden="true" className="font-bold">{large ? "A−" : "A+"}</span>
        <span className="hidden sm:inline">{large ? t("settingsPage.display.toggleNormal") : t("settingsPage.display.toggleLarge")}</span>
      </Btn>
    </form>
  );
}
