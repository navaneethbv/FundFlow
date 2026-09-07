import { describe, expect, it } from "vitest";
import { buildDashboardRecurring } from "@/lib/dashboard-recurring";
import type { RecurringStreamInput } from "@/lib/recurring-page";

const stream: RecurringStreamInput = {
  id: "stream", streamType: "outflow", merchantName: "Utility", description: null,
  averageAmount: 90, userAmount: null, lastAmount: 80, frequency: "MONTHLY",
  status: "MATURE", isActive: true, accountName: "Checking", firstDate: "2026-08-05",
  lastDate: "2026-08-05", predictedNextDate: "2026-09-05", reviewedAt: null,
  dismissedAt: null, matchedTransactions: [], category: "RENT_AND_UTILITIES",
  source: "plaid", detectionEvidence: null,
};
const input = {streams:[stream],manualItems:[],scheduled:[],month:"2026-09",today:"2026-09-06"};

describe("Dashboard recurring projections", () => {
  it("keeps completed occurrences in the calendar but out of the forecast", () => {
    const data = buildDashboardRecurring({...input, streams:[{...stream,matchedTransactions:[{id:"paid",date:"2026-09-05"}]}]});
    expect(data.items.some(row => row.nextDate === "2026-09-05")).toBe(true);
    expect(data.forecastItems.some(row => row.nextDate === "2026-09-05")).toBe(false);
    expect(data.recurringStatuses[0]).toMatchObject({status:"paid", transactionIds:["paid"]});
  });

  it("retains manual income and skips disabled manual items", () => {
    const data = buildDashboardRecurring({...input,manualItems:[
      {id:"income",name:"Allowance",amount:100,frequency:"monthly",itemType:"income",nextDate:"2026-09-08",category:null,enabled:true},
      {id:"disabled",name:"Cancelled",amount:50,frequency:"monthly",itemType:"expense",nextDate:"2026-09-08",category:null,enabled:false},
    ]});
    expect(data.incomeStreams[0]?.amount).toBe(100);
    expect(data.recurringStatuses.find(row => row.name === "Allowance")).toMatchObject({status:"expected",itemType:"income"});
    expect(data.items.some(row => row.name === "Cancelled")).toBe(false);
  });

  it("filters inactive, dismissed, and tombstoned streams", () => {
    const data = buildDashboardRecurring({...input,streams:[{...stream,isActive:false},{...stream,dismissedAt:"2026-09-01"},{...stream,status:"TOMBSTONED"}]});
    expect(data.subscriptions).toHaveLength(0);
    expect(data.items).toHaveLength(0);
  });

  it("uses available amount and date fallbacks without inventing a missing anchor", () => {
    const data = buildDashboardRecurring({...input,streams:[
      {...stream,id:"last",merchantName:null,description:"Last charge",averageAmount:null,predictedNextDate:null},
      {...stream,id:"first",merchantName:null,description:null,averageAmount:null,lastAmount:null,predictedNextDate:null,lastDate:null},
      {...stream,id:"missing",firstDate:null,lastDate:null,predictedNextDate:null},
    ]});
    expect(data.subscriptions.find(row=>row.merchant==="Last charge")?.amount).toBe(80);
    expect(data.subscriptions.find(row=>row.merchant==="Unknown")?.amount).toBe(0);
    expect(data.recurringStatuses.map(row=>row.name)).toEqual(["Last charge","Unknown"]);
  });

  it("preserves zero user corrections and inflow amounts", () => {
    const data = buildDashboardRecurring({...input,streams:[{...stream,streamType:"inflow",userAmount:0}]});
    expect(data.incomeStreams[0]?.amount).toBe(0);
    expect(data.items[0]?.itemType).toBe("income");
  });

  it("shows only this month's scheduled items in reminders and never repeats them", () => {
    const data = buildDashboardRecurring({...input,streams:[],scheduled:[
      {name:"Past",amount:20,itemType:"expense",nextDate:"2026-09-01",frequency:"once"},
      {name:"Due",amount:30,itemType:"expense",nextDate:"2026-09-10",frequency:"once"},
      {name:"Later",amount:40,itemType:"expense",nextDate:"2026-10-20",frequency:"once"},
    ]});
    expect(data.recurringStatuses.map(row=>row.status)).toEqual(["late","expected"]);
    expect(data.items).toHaveLength(3);
  });
});

it("keeps next-week reminders when the week crosses the month boundary", () => {
  const data = buildDashboardRecurring({...input, today:"2026-09-30", streams:[{...stream,predictedNextDate:"2026-10-03"}]});
  expect(data.recurringStatuses.map(row=>row.nextDate)).toEqual(["2026-09-03","2026-10-03"]);
  expect(data.recurringStatuses[1]?.status).toBe("expected");
});
