import { writeFileSync } from "node:fs";
import { openApiDocument } from "../packages/contract/src/index.ts";

const document = openApiDocument();
writeFileSync(new URL("../apps/api/openapi.json", import.meta.url), `${JSON.stringify(document, null, 2)}\n`);
console.log(`wrote OpenAPI ${document.openapi} with ${Object.keys(document.paths ?? {}).length} paths`);
