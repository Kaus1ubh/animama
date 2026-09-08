import type { PyUserFileResponse } from "@/lib/content/catalogTypes";
import {
  resolveUserFileUploadCardStatus,
  type UserFileUploadStatusFile,
} from "@/lib/user-files/upload-card-status";
import { describe, expect, it } from "vitest";

function uppyFile(
  overrides: Partial<UserFileUploadStatusFile> = {},
): UserFileUploadStatusFile {
  const base: UserFileUploadStatusFile = {
    meta: {},
    progress: {
      bytesTotal: 100,
      bytesUploaded: false,
      percentage: 0,
      uploadStarted: null,
    },
  };

  return {
    ...base,
    ...overrides,
    meta: {
      ...base.meta,
      ...overrides.meta,
    },
    progress: {
      ...base.progress,
      ...overrides.progress,
    },
  };
}

function backendFile(
  status: string,
  overrides: Partial<PyUserFileResponse> = {},
): PyUserFileResponse {
  return {
    file_id: "file-1",
    original_filename: "notes.md",
    normalized_extension: ".md",
    status,
    declared_size_bytes: 100,
    ...overrides,
  };
}

describe("resolveUserFileUploadCardStatus", () => {
  it("keeps a saved original idle while optional processing is unavailable", () => {
    expect(
      resolveUserFileUploadCardStatus({
        uppyFile: uppyFile({
          meta: { file_id: "file-1", anima_stage: "uploaded" },
          progress: { uploadComplete: true, percentage: 100 },
        }),
      }),
    ).toMatchObject({
      id: "uploaded",
      label: "Original saved",
      active: false,
      error: null,
      jobStatus: null,
    });
  });
  it("reports upload progress before a Anima file id exists", () => {
    const resolved = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile({
        progress: {
          bytesTotal: 100,
          bytesUploaded: 40,
          percentage: 40,
          uploadStarted: 1000,
        },
      }),
    });

    expect(resolved.id).toBe("uploading");
    expect(resolved.progress).toBe(40);
    expect(resolved.active).toBe(true);
  });

  it("reports finalize and process transient stages", () => {
    expect(
      resolveUserFileUploadCardStatus({
        uppyFile: uppyFile({
          meta: { file_id: "file-1", anima_stage: "finalizing" },
        }),
      }).id,
    ).toBe("finalizing");

    const queued = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile({
        meta: {
          file_id: "file-1",
          anima_process_job_status: "queued",
          anima_stage: "queued",
        },
      }),
    });

    expect(queued.id).toBe("queued");
    expect(queued.jobStatus).toBe("queued");
  });

  it("uses backend processing status when polling has data", () => {
    const resolved = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile({
        meta: { file_id: "file-1", anima_stage: "queued" },
      }),
      backendFile: backendFile("processing", {
        latest_processing_job: {
          attempts: 1,
          job_id: "job-1",
          max_attempts: 3,
          status: "running",
        },
      }),
    });

    expect(resolved.id).toBe("processing");
    expect(resolved.jobStatus).toBe("running");
  });

  it("uses backend ready states when present", () => {
    expect(
      resolveUserFileUploadCardStatus({
        uppyFile: uppyFile({ error: "local stale error" }),
        backendFile: backendFile("ready"),
      }).id,
    ).toBe("ready");

    const keywordOnly = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile(),
      backendFile: backendFile("ready_keyword_only"),
    });

    expect(keywordOnly.id).toBe("ready_keyword_only");
    expect(keywordOnly.tone).toBe("warning");
  });

  it("uses backend failed status and error details when present", () => {
    const resolved = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile(),
      backendFile: backendFile("failed", {
        last_error: "Could not parse document.",
      }),
    });

    expect(resolved.id).toBe("failed");
    expect(resolved.error).toBe("Could not parse document.");
  });

  it("uses backend uploaded status as durable-upload state", () => {
    const resolved = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile({
        meta: { file_id: "file-1", anima_stage: "processing" },
      }),
      backendFile: backendFile("uploaded"),
    });

    expect(resolved.id).toBe("uploaded");
    expect(resolved.active).toBe(false);
  });

  it("uses local errors over non-terminal transient state", () => {
    const resolved = resolveUserFileUploadCardStatus({
      uppyFile: uppyFile({
        error: "Object upload failed.",
        meta: { anima_stage: "uploading" },
      }),
    });

    expect(resolved.id).toBe("failed");
    expect(resolved.error).toBe("Object upload failed.");
  });
});
