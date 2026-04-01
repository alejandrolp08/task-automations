# Workspace

This folder contains workspace-level bootstrap and runtime wiring shared by the Park Ministry modules.

Current files:

- `index.js`
  - default workspace entrypoint
- `loadEnv.js`
  - shared environment loading helper
- `operativePaths.js`
  - runtime/output path resolver for each module

This folder is infrastructure for the workspace. Reusable business logic belongs in `Shared/`.
