// Client bundle build: esbuild with the DSH module-loader banner/footer
// (same pattern as the harness's own client plugins).
import { execSync } from "node:child_process";

console.log("Building deep-learning client bundle...");
const banner = 'window.__ModuleLoader__.load({ id: "deep-learning", factory: (require) => { var module = { exports: {} }; var exports = module.exports;';
const footer = "return module.exports; } });";
execSync(
	`npx esbuild src/client/index.tsx --outfile=client/client.js --platform=browser --format=cjs --target=es2022 --bundle ` +
		`--external:react --external:react-dom --external:react-dom/client --external:react/jsx-runtime ` +
		`--external:@deepseek-ai/dsh-client-ui-slots --external:@deepseek-ai/dsh-client-store ` +
		`--jsx=automatic --loader:.tsx=tsx --banner:js='${banner}' --footer:js='${footer}' --sourcemap`,
	{ stdio: "inherit" },
);
console.log("Client build complete.");
