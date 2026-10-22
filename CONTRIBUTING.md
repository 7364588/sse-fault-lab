# Contributing

Report a concrete reproduction with the Node version, operating system, a small
synthetic JSON fixture and the expected versus observed result. Do not upload
private traces, credentials, unrelated logs or real customer event data.

Run `npm ci --ignore-scripts`, `npm run build`, `npm test`, `npm run smoke` and
`npm run demo` before submitting a change. Keep the generated demo deterministic.
Use `npm pack --ignore-scripts` to inspect the installable artifact.

Protocol changes should cite the relevant WHATWG rule and include a focused
regression test. A server write is not a promise about client read chunks; test
exact chunk boundaries offline and transport behavior with loopback clients.
Keep provider-specific completion policies outside the generic parser.

Small, independently reviewable changes are preferred. New features need a
concrete use case and documented bounds. Do not generate activity-only changes.
