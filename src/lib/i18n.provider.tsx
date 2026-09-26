import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { dict, type Lang } from "./i18n.dict";
import { I18nContext } from "./i18n";

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("th");

  useEffect(() => {
    const stored = window.localStorage.getItem("phum-lang");
    if (stored === "en" || stored === "th") setLangState(stored);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("phum-lang", l);
    document.documentElement.lang = l;
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: dict[lang] }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
