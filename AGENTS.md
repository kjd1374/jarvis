## Product context

Read `docs/PRODUCT.md` before proposing features or changing the application. It records the user's product purpose and current constraints. Preserve the current visual design unless requested otherwise. Do not add login, signup, or team management; Jarvis is a personal integrated workspace. Keep company and personal material distinct. Existing screen labels are provisional, and proposed roadmap items are not implemented capabilities.

The workspace now centers conversation, persistent context, and project/task-linked files. Current records and file blobs persist in this browser's IndexedDB, not Supabase. Preserve atomic writes, company/personal isolation, context history, and recovery from storage errors. Actual AI replies/execution and server synchronization remain unconnected; do not simulate those capabilities or expose private work through anonymous database policies.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
