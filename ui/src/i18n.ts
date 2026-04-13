import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ko from "./locales/ko.json";

export const supportedLanguages = [
	{ code: "en", label: "EN" },
	{ code: "ko", label: "KO" },
] as const;

i18n.use(initReactI18next).init({
	resources: {
		en: { translation: en },
		ko: { translation: ko },
	},
	lng: localStorage.getItem("quantdesk.lang") ?? "en",
	fallbackLng: "en",
	interpolation: { escapeValue: false },
});

export default i18n;
