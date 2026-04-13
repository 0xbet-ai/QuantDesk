import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./i18n.js";
import "./index.css";
import { App, AuthGate } from "./App.js";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { LiveUpdatesProvider } from "./context/LiveUpdatesContext.js";
import { ThemeProvider } from "./context/ThemeContext.js";

// Set initial theme from localStorage
const stored = localStorage.getItem("quantdesk.theme");
if (stored === "light") {
	document.documentElement.classList.remove("dark");
} else {
	document.documentElement.classList.add("dark");
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<BrowserRouter>
				<ThemeProvider>
					<LiveUpdatesProvider>
						<TooltipProvider>
							<AuthGate>
								<App />
							</AuthGate>
						</TooltipProvider>
					</LiveUpdatesProvider>
				</ThemeProvider>
			</BrowserRouter>
		</StrictMode>,
	);
}
