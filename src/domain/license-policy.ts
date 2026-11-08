import type { GithubRepo } from "./github.ts";

/** Exact SPDX metadata accepted by the prototype follow-up population. */
export const acceptedSpdxIds = [
  "MIT",
  "Apache-2.0",
  "AGPL-3.0",
  "GPL-3.0",
  "LGPL-3.0",
  "MPL-2.0",
  "BSL-1.0",
  "Unlicense",
] as const;
export const defaultAcceptedLicenses = acceptedSpdxIds.join(",");

export const parseAcceptedLicenses = (value: string): ReadonlyArray<string> => {
  const ids = value.split(",").map((id) => id.trim());
  if (ids.some((id) => !(acceptedSpdxIds as ReadonlyArray<string>).includes(id))) {
    throw new Error(
      `ACCEPTED_LICENSES must be a nonempty comma-separated subset of ${defaultAcceptedLicenses}`,
    );
  }
  return [...new Set(ids)].sort();
};

export const populationPolicy = (licenses: ReadonlyArray<string>): string =>
  JSON.stringify({ version: "typescript-spdx-v1", acceptedSpdxIds: [...new Set(licenses)].sort() });

export const isEligibleRepository = (repo: GithubRepo, licenses: ReadonlyArray<string>): boolean =>
  repo.language === "TypeScript" &&
  !repo.fork &&
  !repo.archived &&
  !repo.private &&
  repo.visibility === "public" &&
  repo.license !== null &&
  repo.license.spdxId !== null &&
  licenses.includes(repo.license.spdxId);
