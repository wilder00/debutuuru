// Typed translation keys: `t("git.remote.fetch")` is checked against the
// English file, so a typo or a removed key fails `tsc`.
import "i18next";
import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
    returnNull: false;
  }
}
