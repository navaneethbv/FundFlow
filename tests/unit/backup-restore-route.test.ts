import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "@/app/api/backup/restore/route";
import { requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";
import { buildBackupArchive } from "@/lib/backup";

vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, requireUser: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), getClientIp: vi.fn(() => "127.0.0.1") }));
vi.mock("@/lib/step-up", () => ({ MAX_STEP_UP_ATTEMPTS_PER_HOUR: 5, verifyStepUp: vi.fn(async () => true) }));

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER = "22222222-2222-2222-2222-222222222222";
const { KEY } = vi.hoisted(() => ({
  KEY: Buffer.from(new Uint8Array(32).fill(7)).toString("base64"),
}));

vi.mock("@/lib/env.server", () => ({
  serverEnv: { backupEncKey: KEY, cronSecret: "test" },
}));

const from = vi.fn();
const uploadReceipt = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from,
    storage: { from: () => ({ upload: uploadReceipt }) },
  }),
}));

function thenable(data: unknown = null, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data, error }),
  };
  for (const method of ["delete", "eq", "insert", "select", "upsert"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function formRequest(file: Buffer | null, fields: Record<string, string>): NextRequest {
  const form = new FormData();
  if (file) {
    form.set("file", new File([new Uint8Array(file)], "backup.json.enc"));
  }
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new NextRequest("http://localhost/api/backup/restore", {
    method: "POST",
    body: form,
  });
}

const PAYLOAD = {
  accounts: [
    { id: "acc-1", name: "Checking", plaid_account_id: "plaid-acc-1", plaid_item_id: "item-1" },
  ],
  goals: [],
};

beforeEach(() => {
  process.env.FUNDFLOW_FEATURE_FLAGS = "backupRestore";
  vi.clearAllMocks();
  from.mockReturnValue(thenable());
  vi.mocked(requireUser).mockResolvedValue({
    user: { id: USER_ID, email: "user@example.com" },
    supabase: {} as never,
  } as never);
  vi.mocked(writeAudit).mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.FUNDFLOW_FEATURE_FLAGS;
});


describe("POST /api/backup/restore", () => {
  it("dry-run returns the plan without executing", async () => {
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dryRun: boolean; plan: { totalRows: number } };
    expect(body.dryRun).toBe(true);
    expect(body.plan.totalRows).toBe(1);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "data_restore_dry_run" }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("commits with step-up and audits both phases", async () => {
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "false", code: "pw" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dryRun: boolean; result: { failedTable: string | null } };
    expect(body.result.failedTable).toBeNull();
    const actions = vi
      .mocked(writeAudit)
      .mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions).toContain("data_restore");
  });

  it("rejects an archive bound to a different user", async () => {
    const archive = buildBackupArchive(PAYLOAD, KEY, OTHER_USER);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a tampered archive", async () => {
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const copy = Buffer.from(archive);
    copy[copy.length - 3] = copy[copy.length - 3] === 65 ? 66 : 65; // flip a byte
    const res = await POST(formRequest(copy, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(400);
  });

  it("rejects garbage files", async () => {
    const res = await POST(
      formRequest(Buffer.from("not an envelope"), { dry_run: "true", code: "000000" }),
    );
    expect(res.status).toBe(400);
  });

  it("401s with a failed step-up before touching data, and audits the failure", async () => {
    const { verifyStepUp } = await import("@/lib/step-up");
    vi.mocked(verifyStepUp).mockResolvedValueOnce(false);
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "wrong" }));
    expect(res.status).toBe(401);
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "data_restore_failed" }),
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("400s when the archive file is missing", async () => {
    const res = await POST(formRequest(null, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(400);
  });

  it("returns the auth response when signed out", async () => {
    vi.mocked(requireUser).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    );
    const res = await POST(formRequest(null, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/backup/restore — guards and validation", () => {
  beforeEach(() => {
    process.env.FUNDFLOW_FEATURE_FLAGS = "backupRestore";
    vi.clearAllMocks();
    from.mockReturnValue(thenable());
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: USER_ID, email: "user@example.com" },
      supabase: {} as never,
    } as never);
    vi.mocked(writeAudit).mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.FUNDFLOW_FEATURE_FLAGS;
  });

  it("429s past the rate limit", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit");
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false as never);
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(429);
  });

  it("400s when backups are not configured", async () => {
    const env = await import("@/lib/env.server");
    const original = env.serverEnv.backupEncKey;
    (env.serverEnv as { backupEncKey?: string }).backupEncKey = undefined;
    try {
      const res = await POST(formRequest(null, { dry_run: "true", code: "000000" }));
      expect(res.status).toBe(400);
    } finally {
      (env.serverEnv as { backupEncKey?: string }).backupEncKey = original;
    }
  });

  it("400s when the step-up code is missing", async () => {
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true" }));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it("400s when the decrypted payload is not an object", async () => {
    const archive = buildBackupArchive("just a string", KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(400);
  });

  it("400s when a section is not a row list", async () => {
    const archive = buildBackupArchive({ accounts: "corrupt" }, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "000000" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when backupRestore flag is off regardless of step-up", async () => {
    process.env.FUNDFLOW_FEATURE_FLAGS = "";
    const { verifyStepUp } = await import("@/lib/step-up");
    const archive = buildBackupArchive(PAYLOAD, KEY, USER_ID);
    const res = await POST(formRequest(archive, { dry_run: "true", code: "wrong" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("disabled");
    expect(verifyStepUp).not.toHaveBeenCalled();
  });
});
