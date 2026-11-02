import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { NodeHttpServer } from "@effect/platform-node";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { Data, Effect, FileSystem, Layer, String as Str } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse, HttpStaticServer } from "effect/http";
import type * as SqlClient from "effect/sql/SqlClient";
import {
  browsableTables,
  fileSorts,
  fileSymbolsCsv,
  fileTable,
  meta,
  overview,
  param,
  parseFilters,
  parsePage,
  parseSort,
  repositories,
  repository,
  repositoryFile,
  repoSorts,
  symbolKinds,
  symbolRepositories,
  symbolSorts,
  symbolTable,
  tablePage,
  type BrowsableTable,
  type FileSearch,
  type SymbolKindFilter,
} from "./queries.ts";

/**
 * `e20r view`: the state database behind a small read-only JSON API, plus
 * the static viewer page that consumes it. The database is opened
 * read-only, so the viewer can watch a run that is still writing (WAL).
 */

/** The static page, next to `src/` and `dist/` alike. */
const viewerRoot = fileURLToPath(new URL("../../viewer/", import.meta.url));

type Handler = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  HttpServerRequest.HttpServerRequest | HttpServerRequest.ParsedSearchParams | SqlClient.SqlClient
>;

/** A request for something that does not exist (missing parameter, unknown id). */
class NotFound extends Data.TaggedError("NotFound")<{}> {}

const notFound = Effect.fail(new NotFound());

/**
 * A JSON endpoint: query parameters in, JSON out. `NotFound` (or a query
 * finding nothing) answers 404; any other failure a 500 with its message.
 */
const endpoint = <Body extends Effect.Effect<unknown, unknown, SqlClient.SqlClient>>(
  // Generic over the whole effect, so a body returning `cond ? query : notFound`
  // (a union of two effect types) is accepted as is.
  body: (params: HttpServerRequest.ParsedSearchParams["Service"]) => Body,
): Handler =>
  Effect.gen(function* () {
    const params = yield* HttpServerRequest.ParsedSearchParams;
    const result = yield* body(params);
    return result === undefined
      ? HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 })
      : HttpServerResponse.jsonUnsafe(result);
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        error instanceof NotFound
          ? HttpServerResponse.jsonUnsafe({ error: "not found" }, { status: 404 })
          : HttpServerResponse.jsonUnsafe({ error: String(error) }, { status: 500 }),
      ),
    ),
  ) as Handler;

const repoId = (params: HttpServerRequest.ParsedSearchParams["Service"]): number =>
  Number(param(params, "id") ?? param(params, "repo") ?? Number.NaN);

const fileSearch = (params: HttpServerRequest.ParsedSearchParams["Service"]): FileSearch => {
  const repo = Number(param(params, "repo"));
  return {
    path: (param(params, "path") ?? "").trim().slice(0, 300),
    uses: (param(params, "uses") ?? "").trim().slice(0, 200),
    ...(Number.isInteger(repo) && repo > 0 ? { repo } : {}),
  };
};

/** The Files view's selection as a CSV download (one line per file × symbol). */
const filesCsv: Handler = Effect.gen(function* () {
  const params = yield* HttpServerRequest.ParsedSearchParams;
  const csv = yield* fileSymbolsCsv(parseFilters(params), fileSearch(params));
  return HttpServerResponse.text(csv, {
    contentType: "text/csv; charset=utf-8",
    headers: { "content-disposition": 'attachment; filename="e20r-file-symbols.csv"' },
  });
}).pipe(
  Effect.catch((error) =>
    Effect.succeed(HttpServerResponse.text(`error: ${String(error)}\n`, { status: 500 })),
  ),
);

/** `sort=column&dir=asc|desc` of the raw table endpoint (column checked by the query). */
const tableSort = (params: HttpServerRequest.ParsedSearchParams["Service"]) => {
  const column = param(params, "sort");
  return column === undefined || column === ""
    ? undefined
    : {
        column: column.slice(0, 64),
        dir: param(params, "dir") === "desc" ? ("desc" as const) : ("asc" as const),
      };
};

const ApiRoutes = HttpRouter.addAll([
  HttpRouter.route(
    "GET",
    "/api/meta",
    endpoint(() => meta),
  ),
  HttpRouter.route(
    "GET",
    "/api/overview",
    endpoint((params) => overview(parseFilters(params))),
  ),
  HttpRouter.route(
    "GET",
    "/api/repos",
    endpoint((params) =>
      repositories(parseFilters(params), parseSort(repoSorts, params, "stars"), parsePage(params)),
    ),
  ),
  HttpRouter.route(
    "GET",
    "/api/repo",
    endpoint((params) => {
      const id = repoId(params);
      return Number.isInteger(id) ? repository(id, parseFilters(params)) : notFound;
    }),
  ),
  HttpRouter.route(
    "GET",
    "/api/file",
    endpoint((params) => {
      const id = repoId(params);
      const file = param(params, "file");
      return Number.isInteger(id) && file !== undefined ? repositoryFile(id, file) : notFound;
    }),
  ),
  HttpRouter.route(
    "GET",
    "/api/files",
    endpoint((params) =>
      fileTable(
        parseFilters(params),
        fileSearch(params),
        parseSort(fileSorts, params, "usages"),
        parsePage(params),
      ),
    ),
  ),
  HttpRouter.route("GET", "/api/files.csv", filesCsv),
  HttpRouter.route(
    "GET",
    "/api/symbols",
    endpoint((params) =>
      symbolTable(
        parseFilters(params),
        (param(params, "search") ?? "").trim().slice(0, 200),
        parseSort(symbolSorts, params, "repos"),
        parsePage(params),
      ),
    ),
  ),
  HttpRouter.route(
    "GET",
    "/api/symbol",
    endpoint((params) => {
      const symbol = param(params, "symbol");
      const kind = param(params, "symbolKind") ?? "all";
      return symbol === undefined
        ? notFound
        : symbolRepositories(
            parseFilters(params),
            symbol,
            ((symbolKinds as ReadonlyArray<string>).includes(kind)
              ? kind
              : "all") as SymbolKindFilter,
          );
    }),
  ),
  HttpRouter.route(
    "GET",
    "/api/table",
    endpoint((params) => {
      const name = param(params, "name");
      return name !== undefined && (browsableTables as ReadonlyArray<string>).includes(name)
        ? tablePage(name as BrowsableTable, parsePage(params, 100), tableSort(params))
        : notFound;
    }),
  ),
]);

const StaticRoutes = HttpStaticServer.layer({ root: viewerRoot, cacheControl: "no-cache" });

export interface ViewOptions {
  readonly database: string;
  readonly host: string;
  readonly port: number;
}

/** Serves the viewer until interrupted. */
export const serveViewer = (options: ViewOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(options.database))) {
      return yield* Effect.fail(
        `No state database at ${options.database}; run \`e20r run\` first (or pass --cache-path)`,
      );
    }
    yield* Effect.log(
      `Viewer: http://${options.host === "0.0.0.0" ? "localhost" : options.host}:${options.port}/ (database ${options.database}, read-only)`,
    );

    const Database = SqliteClient.layer({
      filename: options.database,
      readonly: true,
      transformQueryNames: Str.camelToSnake,
      transformResultNames: Str.snakeToCamel,
    });

    return yield* HttpRouter.serve(Layer.mergeAll(ApiRoutes, StaticRoutes), {
      disableListenLog: true,
      disableLogger: true,
    }).pipe(
      Layer.provide(Database),
      Layer.provide(NodeHttpServer.layer(createServer, { port: options.port, host: options.host })),
      Layer.launch,
    );
  });
