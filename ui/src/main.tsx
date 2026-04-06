import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App() {
	return <div>QuantDesk</div>;
}

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<App />
		</StrictMode>,
	);
}
