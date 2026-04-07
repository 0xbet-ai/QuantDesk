import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		target: "es2022",
	},
	optimizeDeps: {
		esbuildOptions: {
			target: "es2022",
		},
	},
	server: {
		port: 5173,
		proxy: {
			"/api": {
				target: "http://localhost:3000",
				ws: true,
			},
		},
	},
});
