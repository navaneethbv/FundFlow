import "server-only";
import PDFDocument from "pdfkit";
import { formatCurrency, titleCase } from "@/lib/format";
import type { WeeklyReportData } from "@/lib/weekly-report";

const PAGE = { width: 612, height: 792, margin: 44 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const COLORS = {
  ink: "#172033",
  muted: "#64748B",
  line: "#E2E8F0",
  surface: "#F8FAFC",
  blue: "#2563EB",
  blueSoft: "#DBEAFE",
  green: "#15803D",
  amber: "#B45309",
  red: "#B91C1C",
  white: "#FFFFFF",
};

function periodLabel(data: WeeklyReportData): string {
  const start = new Date(`${data.period.start}T12:00:00Z`);
  const end = new Date(`${data.period.end}T12:00:00Z`);
  const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" });
  const startMonth = month.format(start);
  const endMonth = month.format(end);
  const year = end.getUTCFullYear();
  return startMonth === endMonth
    ? `${startMonth} ${start.getUTCDate()}-${end.getUTCDate()}, ${year}`
    : `${startMonth} ${start.getUTCDate()} - ${endMonth} ${end.getUTCDate()}, ${year}`;
}

function safeAccountLabel(value: string): string {
  return value.replace(/(?:\s|[-*xX])*(?:\d[\s-]*){4}\s*$/, "").trim() || "Credit card";
}

function trendLabel(data: WeeklyReportData): string {
  if (data.changePercent === null) return "No prior baseline";
  if (data.changePercent === 0) return "No change";
  const direction = data.changePercent < 0 ? "less" : "more";
  return `${Math.abs(data.changePercent * 100).toFixed(0)}% ${direction}`;
}

export function generateWeeklyReportPdf(data: WeeklyReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: {
        top: PAGE.margin,
        right: PAGE.margin,
        bottom: 54,
        left: PAGE.margin,
      },
      bufferPages: true,
      info: {
        Title: `FundFlow weekly insights, ${periodLabel(data)}`,
        Author: "FundFlow",
        Subject: "Aggregated weekly spending insights",
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const ensureSpace = (height: number) => {
      if (doc.y + height <= PAGE.height - 70) return;
      doc.addPage();
      doc.y = PAGE.margin;
    };

    const sectionTitle = (title: string, subtitle?: string) => {
      ensureSpace(subtitle ? 42 : 28);
      const y = doc.y;
      doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(13).text(title, PAGE.margin, y, {
        width: CONTENT_WIDTH,
        lineBreak: false,
      });
      if (subtitle) {
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(subtitle, PAGE.margin, y + 20, {
          width: CONTENT_WIDTH,
        });
      }
      doc.y = y + (subtitle ? 46 : 29);
    };

    const emptyState = (message: string) => {
      ensureSpace(34);
      const y = doc.y;
      doc.roundedRect(PAGE.margin, y, CONTENT_WIDTH, 30, 6).fill(COLORS.surface);
      doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(message, PAGE.margin + 12, y + 10);
      doc.y = y + 40;
    };

    const barRows = (
      rows: Array<{ label: string; amount: number; detail?: string }>,
      emptyMessage: string,
      color = COLORS.blue,
    ) => {
      if (rows.length === 0) {
        emptyState(emptyMessage);
        return;
      }
      const max = Math.max(...rows.map((row) => row.amount), 1);
      for (const row of rows) {
        ensureSpace(38);
        const y = doc.y;
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(row.label, PAGE.margin, y, {
          width: 280,
          ellipsis: true,
          lineBreak: false,
        });
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(9).text(formatCurrency(row.amount), PAGE.margin + 390, y, {
          width: 134,
          align: "right",
          lineBreak: false,
        });
        if (row.detail) {
          doc.fillColor(COLORS.muted).font("Helvetica").fontSize(7.5).text(row.detail, PAGE.margin + 287, y + 1, {
            width: 96,
            align: "right",
            lineBreak: false,
          });
        }
        doc.roundedRect(PAGE.margin, y + 17, CONTENT_WIDTH, 6, 3).fill(COLORS.line);
        // Floor the fill well above the 6pt corner radius: at 6pt a 1% slice
        // renders as a dot that reads as a rendering artifact, not a value.
        doc.roundedRect(PAGE.margin, y + 17, Math.max(16, CONTENT_WIDTH * (row.amount / max)), 6, 3).fill(color);
        doc.y = y + 34;
      }
      doc.moveDown(0.25);
    };

    doc.rect(0, 0, PAGE.width, 128).fill(COLORS.ink);
    doc.roundedRect(PAGE.margin, 35, 30, 30, 8).fill(COLORS.blue);
    doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(14).text("F", PAGE.margin + 10, 42);
    doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(21).text("Weekly insights", PAGE.margin + 44, 35);
    doc.fillColor("#CBD5E1").font("Helvetica").fontSize(9.5).text(periodLabel(data), PAGE.margin + 44, 63);
    doc.fillColor("#94A3B8").font("Helvetica").fontSize(8.5).text(
      "A private, aggregated view of where your money moved.",
      PAGE.margin,
      94,
    );

    doc.y = 148;
    const cardWidth = (CONTENT_WIDTH - 20) / 3;
    const metrics = [
      { label: "SPENT", value: formatCurrency(data.totalSpend), color: COLORS.ink },
      { label: "VS LAST WEEK", value: trendLabel(data), color: data.changeAmount <= 0 ? COLORS.green : COLORS.red },
      { label: "NET CASH FLOW", value: formatCurrency(data.cashFlow.net), color: data.cashFlow.net >= 0 ? COLORS.green : COLORS.red },
    ];
    metrics.forEach((metric, index) => {
      const x = PAGE.margin + index * (cardWidth + 10);
      doc.roundedRect(x, 148, cardWidth, 72, 8).fill(COLORS.surface);
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5).text(metric.label, x + 12, 162, {
        characterSpacing: 0.8,
      });
      doc.fillColor(metric.color).font("Helvetica-Bold").fontSize(index === 1 ? 13 : 16).text(metric.value, x + 12, 184, {
        width: cardWidth - 24,
        ellipsis: true,
        lineBreak: false,
      });
    });
    doc.y = 242;

    sectionTitle("Spending by category", "Share of this week's eligible spending after rules, splits, refunds, and duplicate cleanup.");
    barRows(
      data.categories.slice(0, 8).map((item) => ({
        label: titleCase(item.category),
        amount: item.amount,
        detail: `${Math.round(item.share * 100)}%`,
      })),
      "No eligible spending was recorded for this week.",
    );

    sectionTitle("Bank and card breakdown", "Aggregated spend only; balances, account numbers, and transaction details are excluded. Each card's spend is already counted in its bank's total, so the two columns do not add up.");
    const bankY = doc.y;
    const columnWidth = (CONTENT_WIDTH - 18) / 2;
    const compactList = (
      x: number,
      heading: string,
      rows: Array<{ name: string; amount: number }>,
      sanitize = false,
    ): number => {
      let y = bankY;
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7.5).text(heading, x, y, { characterSpacing: 0.8 });
      y += 18;
      if (rows.length === 0) {
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text("No spending to show", x, y);
        return y + 22;
      }
      rows.slice(0, 5).forEach((row) => {
        const label = sanitize ? safeAccountLabel(row.name) : row.name;
        doc.fillColor(COLORS.ink).font("Helvetica").fontSize(8.5).text(label, x, y, {
          width: columnWidth - 86,
          ellipsis: true,
          lineBreak: false,
        });
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5).text(formatCurrency(row.amount), x + columnWidth - 82, y, {
          width: 82,
          align: "right",
          lineBreak: false,
        });
        y += 20;
      });
      return y;
    };
    const banksEnd = compactList(PAGE.margin, "BANKS", data.banks);
    const cardsEnd = compactList(PAGE.margin + columnWidth + 18, "CREDIT CARDS", data.cards, true);
    doc.y = Math.max(banksEnd, cardsEnd) + 12;

    // Merchants lead the back half: they finish the "where did it go" story that
    // categories and accounts start, so they belong with them rather than stranded
    // behind the budget block.
    sectionTitle("Top merchants");
    barRows(
      data.merchants.slice(0, 5).map((merchant) => ({ label: merchant.merchant, amount: merchant.amount })),
      "No merchant spending was recorded.",
      COLORS.amber,
    );

    sectionTitle("Budget pace");
    if (data.budgets.length === 0) {
      emptyState("No category budgets are configured.");
    } else {
      const statusColor = { "on-track": COLORS.green, "at-risk": COLORS.amber, over: COLORS.red } as const;
      for (const budget of data.budgets.slice(0, 8)) {
        ensureSpace(31);
        const y = doc.y;
        doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5).text(titleCase(budget.category), PAGE.margin, y, {
          width: 210,
          ellipsis: true,
          lineBreak: false,
        });
        doc.fillColor(statusColor[budget.status]).font("Helvetica-Bold").fontSize(8).text(budget.status.toUpperCase(), PAGE.margin + 216, y, {
          width: 74,
          lineBreak: false,
        });
        doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(
          `${formatCurrency(budget.spent)} of ${formatCurrency(budget.weeklyAllowance)}`,
          PAGE.margin + 300,
          y,
          { width: 224, align: "right", lineBreak: false },
        );
        doc.y = y + 25;
      }
      doc.moveDown(0.4);
    }

    sectionTitle("Checking and savings cash flow");
    ensureSpace(62);
    const flowY = doc.y;
    const flow = [
      { label: "INFLOWS", value: data.cashFlow.inflows, color: COLORS.green },
      { label: "OUTFLOWS", value: data.cashFlow.outflows, color: COLORS.red },
      { label: "NET", value: data.cashFlow.net, color: data.cashFlow.net >= 0 ? COLORS.green : COLORS.red },
    ];
    flow.forEach((item, index) => {
      const x = PAGE.margin + index * (cardWidth + 10);
      doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(7).text(item.label, x, flowY, { characterSpacing: 0.8 });
      doc.fillColor(item.color).font("Helvetica-Bold").fontSize(13).text(formatCurrency(item.value), x, flowY + 18, {
        width: cardWidth,
        lineBreak: false,
      });
    });
    doc.y = flowY + 58;

    const range = doc.bufferedPageRange();
    for (let index = 0; index < range.count; index += 1) {
      doc.switchToPage(range.start + index);
      doc.strokeColor(COLORS.line).lineWidth(0.7).moveTo(PAGE.margin, 720).lineTo(PAGE.width - PAGE.margin, 720).stroke();
      doc.fillColor("#94A3B8").font("Helvetica").fontSize(7.5).text(
        "FundFlow weekly insights. Aggregated for your personal use.",
        PAGE.margin,
        727,
        { width: CONTENT_WIDTH - 80, lineBreak: false },
      );
      doc.text(`${index + 1} / ${range.count}`, PAGE.width - PAGE.margin - 70, 727, {
        width: 70,
        align: "right",
        lineBreak: false,
      });
    }

    doc.end();
  });
}
