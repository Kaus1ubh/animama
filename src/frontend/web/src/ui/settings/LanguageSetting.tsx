import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { systemPreferredLanguages } from "@animama/product-ui/i18n";
import {
  SUPPORTED_LOCALES,
  isUiLocale,
  localeNativeName,
  resolveLocale,
} from "@animama/runtime-contracts/locale";

import { cn } from "@/lib/utils";
import { useUserSettings } from "@/query/hooks/useUserSettings";
import { useUpdateUserSettings } from "@/query/mutations/useUpdateUserSettings";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/components/select";
import { SettingsRow } from "@/ui/settings/SettingsLayout";

/** Select value standing for "follow the OS or browser language". */
const SYSTEM_LOCALE = "system";

/**
 * Language picker, saved as soon as it changes. "System default" stores no
 * preference so the app follows the OS or browser; every language is named in
 * its own script, so a user who cannot read the active language can still
 * find theirs. Used by App Settings and the first-run Welcome step.
 */
export function LanguageSelect({
  id,
  className,
}: {
  /** Lets a visible `<Label htmlFor>` name the picker. */
  id?: string;
  className?: string;
}) {
  const { t } = useTranslation("settings");
  const { data: settings } = useUserSettings();
  const { mutateAsync: updateUserSettings, isPending } =
    useUpdateUserSettings();
  const saved = isUiLocale(settings?.locale) ? settings.locale : null;
  const systemLocale = resolveLocale({ preferred: systemPreferredLanguages() });

  return (
    <Select
      value={saved ?? SYSTEM_LOCALE}
      disabled={!settings || isPending}
      onValueChange={(value) => {
        const locale = isUiLocale(value) ? value : null;
        void updateUserSettings({ body: { locale } }).catch(() =>
          toast.error(t("language.saveFailed")),
        );
      }}
    >
      <SelectTrigger
        id={id}
        className={cn("w-56", className)}
        aria-label={id ? undefined : t("language.label")}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SYSTEM_LOCALE}>
          {t("language.systemDefaultResolved", {
            language: localeNativeName(systemLocale),
          })}
        </SelectItem>
        {SUPPORTED_LOCALES.map((locale) => (
          <SelectItem key={locale} value={locale} lang={locale}>
            {localeNativeName(locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** The language picker as an App Settings row. */
export function LanguageSetting() {
  const { t } = useTranslation("settings");
  return (
    <SettingsRow label={t("language.label")} control={<LanguageSelect />} />
  );
}
