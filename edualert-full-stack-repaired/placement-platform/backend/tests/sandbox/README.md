# Running the tests without Prisma's native engine (sandbox-only)

Normal usage (your machine / CI) needs none of this:

    npx prisma generate
    TEST_DATABASE_URL=postgresql://postgres:<pw>@localhost:5432/placement_test npm test

`gen-wasm-client.sh` exists because the environment these tests were first run in could not reach
`binaries.prisma.sh`. It generates a second client (`.testclient/`, git-ignored) that runs Prisma's own
bundled WebAssembly query engine over the `pg` driver adapter, and `TEST_PRISMA_MODE=wasm` makes the
tests use it. Application code, SQL and database are unchanged.
