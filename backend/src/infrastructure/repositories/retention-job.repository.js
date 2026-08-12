/**
 * RetentionJobRepository — persistence for retention sweep jobs (FR-040).
 */

const {
  RetentionJobModel,
  RETENTION_JOB_STATUS,
} = require("../models/retention-job.model");

class RetentionJobRepository {
  /** Creates a sweep job in RUNNING state. */
  async create({ jobType, triggeredBy = null }) {
    return RetentionJobModel.create({
      jobType,
      status: RETENTION_JOB_STATUS.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      summary: null,
      triggeredBy: triggeredBy ?? null,
    });
  }

  /** Marks a job COMPLETED with its summary payload. */
  async markCompleted(id, summary) {
    return RetentionJobModel.findByIdAndUpdate(
      id,
      {
        $set: {
          status: RETENTION_JOB_STATUS.COMPLETED,
          finishedAt: new Date(),
          summary: summary ?? null,
        },
      },
      { returnDocument: "after" }
    );
  }

  /** Marks a job FAILED, capturing the error message. */
  async markFailed(id, error) {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return RetentionJobModel.findByIdAndUpdate(
      id,
      {
        $set: {
          status: RETENTION_JOB_STATUS.FAILED,
          finishedAt: new Date(),
          summary: detail ? { error: detail } : null,
        },
      },
      { returnDocument: "after" }
    );
  }

  /** Most recently started job of a given type. */
  async latest(jobType) {
    return RetentionJobModel.findOne({ jobType })
      .sort({ startedAt: -1, _id: -1 })
      .lean();
  }
}

module.exports = { RetentionJobRepository };
