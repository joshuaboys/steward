import type { Capability } from "./index.ts";

export const registryReleaseRead: Capability<
  { name: string },
  { name: string; latest: string; changelog: string }
> = {
  id: "registry.release.read",
  mutating: false,
  async execute(input, ctx) {
    const pkg = ctx.world.registry[input.name];
    if (!pkg) throw new Error(`package ${input.name} not in registry`);
    return structuredClone(pkg);
  },
};

export const registryChangelogRead: Capability<
  { name: string },
  { name: string; changelog: string }
> = {
  id: "registry.changelog.read",
  mutating: false,
  async execute(input, ctx) {
    const pkg = ctx.world.registry[input.name];
    if (!pkg) throw new Error(`package ${input.name} not in registry`);
    return { name: pkg.name, changelog: pkg.changelog };
  },
};

export const registryCapabilities = [registryReleaseRead, registryChangelogRead];
