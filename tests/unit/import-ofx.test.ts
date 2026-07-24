import { describe, expect, it } from "vitest";
import { looksLikeOfx, parseOfx } from "@/lib/import-ofx";

/** SGML-style OFX 1.x: field values end at the newline, no closing tags. */
const SGML_FIXTURE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20240115120000[0:GMT]
<TRNAMT>-42.50
<FITID>202401151
<NAME>COFFEE SHOP
<MEMO>Card purchase
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20240116
<TRNAMT>1500.00
<FITID>202401162
<NAME>PAYROLL
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

/** XML-style OFX 2.x: proper closing tags, XML entities. */
const XML_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20240201000000</DTPOSTED>
            <TRNAMT>-9.99</TRNAMT>
            <FITID>abc123</FITID>
            <NAME>Netflix &amp; Co</NAME>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20240203</DTPOSTED>
            <TRNAMT>25.00</TRNAMT>
            <NAME>Refund</NAME>
            <MEMO>Refund</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`;

describe("looksLikeOfx", () => {
  it("recognizes SGML and XML OFX content", () => {
    expect(looksLikeOfx(SGML_FIXTURE)).toBe(true);
    expect(looksLikeOfx(XML_FIXTURE)).toBe(true);
  });

  it("rejects CSV content", () => {
    expect(looksLikeOfx("date,description,amount\n2024-01-01,Coffee,4.50\n")).toBe(false);
  });
});

describe("parseOfx (SGML 1.x)", () => {
  const rows = parseOfx(SGML_FIXTURE);

  it("parses one row per STMTTRN block", () => {
    expect(rows).toHaveLength(2);
  });

  it("flips OFX sign to the Plaid convention (positive = money out)", () => {
    // OFX debit -42.50 → FundFlow +42.50 (money out)
    expect(rows[0]!.amount).toBe(42.5);
    // OFX credit +1500 → FundFlow -1500 (money in)
    expect(rows[1]!.amount).toBe(-1500);
  });

  it("takes the first 8 chars of DTPOSTED as the date", () => {
    expect(rows[0]!.date).toBe("2024-01-15");
    expect(rows[1]!.date).toBe("2024-01-16");
  });

  it("joins NAME and MEMO when both exist and differ", () => {
    expect(rows[0]!.description).toBe("COFFEE SHOP — Card purchase");
    expect(rows[1]!.description).toBe("PAYROLL");
  });

  it("captures FITID", () => {
    expect(rows[0]!.fitid).toBe("202401151");
  });
});

describe("parseOfx (XML 2.x)", () => {
  const rows = parseOfx(XML_FIXTURE);

  it("parses closing-tag style and decodes entities", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toEqual({
      date: "2024-02-01",
      description: "Netflix & Co",
      amount: 9.99,
      fitid: "abc123",
    });
  });

  it("collapses identical NAME/MEMO and yields null fitid when absent", () => {
    expect(rows[1]!.description).toBe("Refund");
    expect(rows[1]!.fitid).toBeNull();
    expect(rows[1]!.amount).toBe(-25);
  });
});

describe("parseOfx (malformed input)", () => {
  it("skips blocks with unparseable dates or amounts and never throws", () => {
    const mixed = `<OFX><BANKTRANLIST>
<STMTTRN>
<DTPOSTED>garbage
<TRNAMT>-5.00
<NAME>Bad Date
</STMTTRN>
<STMTTRN>
<DTPOSTED>20240110
<TRNAMT>not-a-number
<NAME>Bad Amount
</STMTTRN>
<STMTTRN>
<DTPOSTED>20240111
<TRNAMT>-7.25
<NAME>Good Row
</STMTTRN>
</BANKTRANLIST></OFX>`;
    const rows = parseOfx(mixed);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe("Good Row");
    expect(rows[0]!.amount).toBe(7.25);
  });

  it("returns an empty list for junk input", () => {
    expect(parseOfx("complete nonsense")).toEqual([]);
  });
});
