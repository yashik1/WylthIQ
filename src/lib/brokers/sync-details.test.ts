import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { detailsWithReaderSettings } from "./sync";

const render = (reported: Parameters<typeof detailsWithReaderSettings>[0]) =>
  new PgDialect().sqlToQuery(detailsWithReaderSettings(reported));

describe("what a sync writes to a connection's details", () => {
  it("writes what the broker reported, and keeps the reader's settings from the row as it stands", () => {
    const { sql, params } = render({ accounts: [{ id: "acc", institution: "Questrade", description: "TFSA ···1234", type: "TFSA" }] });
    expect(JSON.parse(params[0] as string)).toEqual({
      accounts: [{ id: "acc", institution: "Questrade", description: "TFSA ···1234", type: "TFSA" }],
    });
    expect(params.slice(1)).toEqual(["confirmQueryId", "confirmQueryId", "accountTypes", "accountTypes"]);
    expect(sql).toContain('"broker_connections"."details" ->');
    expect(sql).toMatch(/^\$1::jsonb \|\| jsonb_strip_nulls\(jsonb_build_object\(/);
  });

  it("never lets a report overwrite a setting the reader chose", () => {
    const { params } = render({ confirmQueryId: "999", accountTypes: { acc: "RRSP" }, accounts: [] });
    expect(JSON.parse(params[0] as string)).toEqual({ accounts: [] });
  });
});
