#!/usr/bin/env bash
# Sandbox-only helper. Run from backend/.  Generates .testclient/ (see README.md in this folder).
set -euo pipefail
export PRISMA_SCHEMA_ENGINE_BINARY=/tmp/fake-engine PRISMA_QUERY_ENGINE_LIBRARY=/tmp/fake-engine
touch /tmp/fake-engine && chmod +x /tmp/fake-engine
mkdir -p .tmp
sed 's#provider = "prisma-client-js"#provider = "prisma-client-js"\n  previewFeatures = ["driverAdapters"]\n  output = "../.testclient"#' prisma/schema.prisma > .tmp/schema.prisma
DATABASE_URL=postgresql://x:y@localhost:5432/z npx prisma generate --no-engine --schema .tmp/schema.prisma
cp node_modules/@prisma/client/runtime/query_engine_bg.postgresql.js   .testclient/query_engine_bg.js
cp node_modules/@prisma/client/runtime/query_engine_bg.postgresql.wasm .testclient/query_engine_bg.wasm
python3 - <<'PY'
p='.testclient/wasm.js'; s=open(p).read()
s=s.replace('"copyEngine": false','"copyEngine": true')
s=s.replace("config.engineWasm = undefined","""config.engineWasm = {
  getRuntime: () => require('./query_engine_bg.js'),
  getQueryEngineWasmModule: async () => new WebAssembly.Module(require('fs').readFileSync(require('path').join(__dirname, 'query_engine_bg.wasm')))
}""")
open(p,'w').write(s)
PY
echo "generated .testclient"
