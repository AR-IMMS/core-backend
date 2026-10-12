---
name: module-documentation
description: Use when documenting a NestJS or TypeScript module for onboarding, including public APIs, TSDoc annotations, and a module-level README.
---

# Module Documentation

Document a module so a new engineer can use its public contract without reverse-engineering its internals. Treat the current source and tests as the authority; describe only behavior, defaults, configuration, and guarantees supported by evidence.

## Workflow

1. Read the repository guidance and root README, then check `git status` and preserve unrelated work.
2. Inspect the module tree, its public barrel, exported interfaces/types/tokens/classes, composition modules, relevant tests, and configuration sources. Follow adapters only far enough to explain real operational behavior and boundaries.
3. Identify intended consumers and the common onboarding task. If the target module or audience is unclear and cannot be inferred, ask one focused question; otherwise proceed with the supplied scope.
4. Add TSDoc comments to exported interfaces, DI tokens, services/classes, and modules. Document public properties where their meaning or constraints are not self-evident. For configurable properties and main public methods, include relevant `@param`, `@returns`, `@example`, and `@default` tags. If an option is required and has no default, state `None (required)` instead of inventing one. Constructors need parameter/default/example details but no artificial `@returns`.
5. Add a `README.md` inside the target module (never the root README for this deliverable) with the exact sections below, in this order.
6. Check examples against the actual imports, exports, provider tokens, types, and call signatures. Use complete, copyable snippets for the common use case; label unavoidable app-specific persistence work clearly rather than inventing repository APIs.
7. Run the repository-appropriate non-mutating formatter/linter or documentation checks available in the environment, plus `git diff --check`. Do not change runtime behavior. Report checks that could not run and why.

## Required Module README Sections

Use these headings and order:

1. `## 🚀 Quickstart (30-second Onboarding)` — minimal complete setup/imports and a service usage example for the common case.
2. `## 🗺️ Architecture Overview` — two concise sentences explaining the module's role and its ports/adapters or equivalent boundaries.
3. `## ⚡ Cheat Sheet` — a table with columns `Common Task`, `Service/Port to Inject`, and `Method/Usage`.
4. `## ⚙️ Configuration Reference` — a table with columns `Property`, `Type`, `Default`, `Required`, and `Description`; include actual environment variables and module options affecting the module. Mark test-only settings as test-only.
5. `## ⚠️ Gotchas & Pitfalls` — concrete operational constraints such as transaction/session boundaries, scheduling/lifecycle, DI tokens, retries, idempotency, ordering, or external service requirements when applicable to the module.

Do not add generic or speculative configuration rows. If a section has no applicable items, say so briefly under that section rather than omitting or repurposing the heading.

## TSDoc Rules

- Annotate the declarations exported for consumers, including declarations re-exported from the module barrel. Internal exported helpers may be documented when they are important to module composition or implementation, but do not present them as application-facing APIs if they are not exported through the public surface.
- Explain purpose, ownership, constraints, and lifecycle rather than paraphrasing the declaration name.
- For each configurable property, state its type-level/runtime default and whether it is required. Include an `@example` that uses the real option name and shape.
- For each main public method, include `@param` for meaningful parameters, `@returns` for the observable result, and a compilable or clearly illustrative `@example` using exact source types. Add `@default` when the method has a defaulted parameter.
- For DI tokens, say what port they identify and show the matching `@Inject(TOKEN)` usage with the real port type.
- Do not add comments to every trivial private implementation detail; keep documentation aligned with the public seam.

## Source Accuracy and Common Mistakes

| Risk | Correct practice |
| --- | --- |
| Documentation implies a design is implemented | Verify current source and tests; describe accepted-but-unimplemented behavior as planned only when the task asks for it. |
| Quickstart invents an API or provider | Follow the module barrel and Nest composition code; use exact exported names and constructor/method signatures. |
| Configuration default is guessed | Trace environment parsing and module registration; state `None` when no default exists. |
| Test configuration is presented as production configuration | Mark test-only settings explicitly and explain where they are consumed. |
| Operational guarantees are overstated | Confirm transaction, retry, ordering, idempotency, and scheduling behavior in adapters/tests before claiming them. |
| README becomes an architecture essay | Keep the architecture overview to two sentences and put practical operation in the cheat sheet and gotchas. |
| Documentation-only work causes unrelated churn | Preserve existing changes and avoid runtime edits, dependency changes, and broad formatting. |

## Example TSDoc Shape

```ts
type ModuleRequest = { id: string };
type ModuleResult = { accepted: boolean };

/**
 * Executes an operation using the module's configured boundary.
 * @param input ModuleRequest value supplied by the caller.
 * @returns ModuleResult after the operation completes.
 * @example `await service.execute(input)`
 */
execute(input: ModuleRequest): Promise<ModuleResult>;
```

This snippet illustrates tag shape only; use the target module's exact types and behavior in actual comments. Never copy these example types into production documentation.
