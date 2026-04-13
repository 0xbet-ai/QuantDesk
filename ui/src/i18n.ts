import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import es from "./locales/es.json";
import ja from "./locales/ja.json";
import ko from "./locales/ko.json";
import zh from "./locales/zh.json";

export const supportedLanguages = [
	{ code: "en", label: "EN" },
	{ code: "ko", label: "KO" },
	{ code: "zh", label: "中文" },
	{ code: "ja", label: "JA" },
	{ code: "es", label: "ES" },
] as const;

i18n.use(initReactI18next).init({
	resources: {
		en: { translation: en },
		ko: { translation: ko },
		zh: { translation: zh },
		ja: { translation: ja },
		es: { translation: es },
	},
	lng: localStorage.getItem("quantdesk.lang") ?? "en",
	fallbackLng: "en",
	interpolation: { escapeValue: false },
});

export default i18n;
