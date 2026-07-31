import { describe, it, expect } from "vitest";
import { DEFAULT_LEDGER_COLUMNS, parseLedgerColumns } from "@/lib/ledger-columns";

describe("parseLedgerColumns", () => {
  it("defaults to every column when the menu was never submitted", () => {
    expect(parseLedgerColumns({ col: undefined, colsSubmitted: undefined })).toEqual(
      new Set(DEFAULT_LEDGER_COLUMNS),
    );
  });

  it("returns an empty set when the menu was submitted with nothing checked", () => {
    expect(parseLedgerColumns({ col: undefined, colsSubmitted: "1" })).toEqual(new Set());
  });

  it("parses a single checked column", () => {
    expect(parseLedgerColumns({ col: "category", colsSubmitted: "1" })).toEqual(new Set(["category"]));
  });

  it("parses multiple checked columns from a repeated param", () => {
    expect(parseLedgerColumns({ col: ["category", "source"], colsSubmitted: "1" })).toEqual(
      new Set(["category", "source"]),
    );
  });

  it("drops an unrecognized column name instead of erroring", () => {
    expect(parseLedgerColumns({ col: ["category", "ghost"], colsSubmitted: "1" })).toEqual(
      new Set(["category"]),
    );
  });
});
