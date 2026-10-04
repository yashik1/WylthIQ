import { describe, expect, it } from "vitest";
import { accountTypeFrom, accountTypeLabel, isAccountType } from "./account-types";

describe("reading a broker's name for an account", () => {
  it("reads the registered accounts however a broker writes them", () => {
    expect(accountTypeFrom(["TFSA"])).toBe("TFSA");
    expect(accountTypeFrom(["ca_tfsa"])).toBe("TFSA");
    expect(accountTypeFrom(["Tax-Free Savings Account"])).toBe("TFSA");
    expect(accountTypeFrom(["RRSP"])).toBe("RRSP");
    expect(accountTypeFrom(["Spousal RRSP"])).toBe("RRSP");
    expect(accountTypeFrom(["RSP"])).toBe("RRSP");
    expect(accountTypeFrom(["First Home Savings Account"])).toBe("FHSA");
    expect(accountTypeFrom(["FHSA"])).toBe("FHSA");
    expect(accountTypeFrom(["RRIF"])).toBe("RRIF");
    expect(accountTypeFrom(["Family RESP"])).toBe("RESP");
  });

  it("puts a locked-in plan with the locked-in, not with the RRSP it came from", () => {
    expect(accountTypeFrom(["LIRA"])).toBe("LOCKED_IN");
    expect(accountTypeFrom(["Locked-In RRSP"])).toBe("LOCKED_IN");
    expect(accountTypeFrom(["LIF"])).toBe("LOCKED_IN");
  });

  it("calls an ordinary account non-registered only for a source that names its registered ones", () => {
    expect(accountTypeFrom(["Margin"], { plainMeansTaxable: true })).toBe("NON_REGISTERED");
    expect(accountTypeFrom(["Cash"], { plainMeansTaxable: true })).toBe("NON_REGISTERED");
    expect(accountTypeFrom(["ca_non_registered"], { plainMeansTaxable: true })).toBe("NON_REGISTERED");
    // IBKR calls its TFSAs cash "Individual" accounts, so from IBKR that says nothing.
    expect(accountTypeFrom(["Individual"])).toBeNull();
    expect(accountTypeFrom(["Cash"])).toBeNull();
  });

  it("takes the broker's own word over a name, and the name when the broker's says nothing", () => {
    expect(accountTypeFrom([null, "Wealthsimple TFSA"])).toBe("TFSA");
    expect(accountTypeFrom(["Margin", "My TFSA"], { plainMeansTaxable: true })).toBe("NON_REGISTERED");
    expect(accountTypeFrom(["Individual", "TFSA"])).toBe("TFSA");
  });

  it("leaves an account it cannot place unknown", () => {
    expect(accountTypeFrom(["Investment"])).toBeNull();
    expect(accountTypeFrom([null, ""])).toBeNull();
    expect(accountTypeLabel(null)).toBe("Type not set");
  });

  it("does not read a type out of an unrelated word", () => {
    expect(accountTypeFrom(["Response account"])).toBeNull();
    expect(accountTypeFrom(["Crisp holdings"])).toBeNull();
  });

  it("knows its own list", () => {
    expect(isAccountType("TFSA")).toBe(true);
    expect(isAccountType("tfsa")).toBe(false);
    expect(isAccountType("SAVINGS")).toBe(false);
  });
});
