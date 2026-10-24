// One e-mail address, validated the same way everywhere a single recipient is typed or stored
// (test e-mail, invoice e-mail delivery — Plans/invoice-email-delivery-plan.md R1).
import { z } from "zod";

export const emailAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Unesite e-mail adresu.")
  .max(254, "E-mail adresa je predugačka.")
  .refine((a) => !/[,;\s<>"]/.test(a), "Unesite tačno jednu e-mail adresu.")
  .pipe(z.email("Unesite ispravnu e-mail adresu."));
