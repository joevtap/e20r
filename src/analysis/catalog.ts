import { Effect, Option, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import YAML from "yaml";
import type { EffectVersion } from "../domain/clone-state.ts";

/**
 * The subset of a pnpm workspace file this application cares about: the
 * default `catalog` map and the named `catalogs` maps.
 */
const PnpmWorkspaceSchema = Schema.Struct({
  catalog: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  catalogs: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String)),
  ),
});

export interface PnpmCatalogs {
  readonly default: Option.Option<EffectVersion>;
  readonly named: Readonly<Record<string, EffectVersion>>;
}

/**
 * Parses the `effect` entries out of a `pnpm-workspace.yaml` catalog
 * definition: the default catalog (`catalog:`) and named catalogs
 * (`catalogs:<name>:`). A missing or malformed file yields no catalogs.
 */
export const parsePnpmCatalogs = (
  workspaceFile: string,
): Effect.Effect<Option.Option<PnpmCatalogs>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const content = yield* Effect.option(fs.readFileString(workspaceFile));
    if (Option.isNone(content)) return Option.none();

    const decoded = Schema.decodeUnknownOption(PnpmWorkspaceSchema)(YAML.parse(content.value));
    if (Option.isNone(decoded)) return Option.none();

    const { catalog, catalogs } = decoded.value;

    const named: Record<string, EffectVersion> = {};
    for (const [name, map] of Object.entries(catalogs ?? {})) {
      const version = map["effect"];
      if (version !== undefined) named[name] = version as EffectVersion;
    }

    const fallback = Option.map(
      Option.fromUndefinedOr(catalog?.["effect"]),
      (version) => version as EffectVersion,
    );

    return Option.some({
      default: fallback,
      named,
    } satisfies PnpmCatalogs);
  });
