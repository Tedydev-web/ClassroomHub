import { BaseApiWithErrors, classroomhub } from '$lib/utils/services/api';
import type {
  CreateExerciseFromTemplateRequest,
  CreateAssessmentItemRequest,
  CreateExerciseRequest,
  DeleteExerciseRequest,
  Exercise,
  ExerciseAssignments,
  ExerciseFileUploadCompleteRequest,
  ExerciseFileUploadInitRequest,
  GetExerciseAssignmentsRequest,
  GetExerciseRequest,
  GetAssessmentItemRequest,
  PublishAssessmentItemRequest,
  SubmitExerciseRequest,
  UpdateExerciseAssignmentsRequest,
  UpdateExerciseRequest,
  VideoRecordingPlaybackRequest,
  VideoRecordingUploadCompleteRequest,
  VideoRecordingUploadInitRequest
} from '../utils/types';
import type {
  TExerciseCreate,
  TAssessmentItemCreate,
  TAssessmentItemPublish,
  TExerciseAssignmentUpdate,
  TExerciseFileUploadComplete,
  TExerciseFileUploadInit,
  TExerciseSubmissionCreate,
  TExerciseUpdate,
  TExerciseVideoRecordingUploadComplete,
  TExerciseVideoRecordingUploadInit
} from '@cio/utils/validation/exercise';
import {
  ZExerciseCreate,
  ZAssessmentItemCreate,
  ZAssessmentItemPublish,
  ZExerciseFileUploadComplete,
  ZExerciseFileUploadInit,
  ZExerciseSubmissionCreate,
  ZExerciseUpdate,
  ZExerciseVideoRecordingUploadComplete,
  ZExerciseVideoRecordingUploadInit
} from '@cio/utils/validation/exercise';

import { mapZodErrorsToTranslations } from '$lib/utils/validation';
import { snackbar } from '$features/ui/snackbar/store';
import { toast } from '@cio/ui/base/sonner';
import { t } from '$lib/utils/functions/translations';

function notifyAssessmentItemError(result: unknown) {
  if (typeof result === 'string') {
    snackbar.error(result);
    return;
  }

  if (typeof result === 'object' && result !== null) {
    if ('message' in result && typeof result.message === 'string') {
      snackbar.error(result.message);
      return;
    }

    if ('error' in result && typeof result.error === 'string') {
      snackbar.error(result.error);
      return;
    }
  }

  snackbar.error('snackbar.something');
}

/**
 * API class for exercise operations
 */
export class ExerciseApi extends BaseApiWithErrors {
  exercise = $state<Exercise | null>(null);
  assignments = $state<ExerciseAssignments | null>(null);
  assignmentsError = $state<string | null>(null);

  /**
   * Gets an exercise by ID
   */
  async get(courseId: string, exerciseId: string) {
    await this.execute<GetExerciseRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].$get({
          param: { courseId, exerciseId }
        }),
      logContext: 'fetching exercise',
      onSuccess: (response) => {
        if (response.data) {
          this.exercise = response.data as unknown as Exercise;
          this.success = true;
          this.errors = {};
        }
      },
      onError: (result) => {
        if (typeof result === 'string') {
          snackbar.error('Failed to fetch exercise');
        }
      }
    });
  }

  async getAssessmentItem(courseId: string, exerciseId: string, questionId: number) {
    return this.execute<GetAssessmentItemRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].question[':questionId']['assessment-item'].$get({
          param: { courseId, exerciseId, questionId: String(questionId) }
        }),
      logContext: 'fetching assessment question'
    });
  }

  async createAssessmentItem(courseId: string, exerciseId: string, fields: TAssessmentItemCreate) {
    const result = ZAssessmentItemCreate.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return;
    }

    return this.execute<CreateAssessmentItemRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId']['assessment-item'].$post({
          param: { courseId, exerciseId },
          json: result.data
        }),
      logContext: 'creating assessment question',
      onError: notifyAssessmentItemError
    });
  }

  async publishAssessmentItem(
    courseId: string,
    exerciseId: string,
    questionId: number,
    fields: TAssessmentItemPublish
  ) {
    const result = ZAssessmentItemPublish.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return;
    }

    return this.execute<PublishAssessmentItemRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].question[':questionId']['assessment-item'].$put({
          param: { courseId, exerciseId, questionId: String(questionId) },
          json: result.data
        }),
      logContext: 'publishing assessment question',
      onError: notifyAssessmentItemError
    });
  }

  async getAssignments(courseId: string, exerciseId: string) {
    this.assignments = null;
    this.assignmentsError = null;

    return this.execute<GetExerciseAssignmentsRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].assignment.$get({
          param: { courseId, exerciseId }
        }),
      logContext: 'fetching exercise assignments',
      onSuccess: (response) => {
        this.assignments = response.data;
      },
      onError: () => {
        this.assignmentsError = 'fetch_failed';
      }
    });
  }

  async updateAssignments(courseId: string, exerciseId: string, data: TExerciseAssignmentUpdate) {
    this.assignmentsError = null;

    return this.execute<UpdateExerciseAssignmentsRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].assignment.$put({
          param: { courseId, exerciseId },
          json: data
        }),
      logContext: 'updating exercise assignments',
      onSuccess: (response) => {
        this.assignments = response.data;
      },
      onError: () => {
        this.assignmentsError = 'update_failed';
      }
    });
  }

  /**
   * Notifies all course members that a quiz has been assigned. Runs as a
   * background job; shows a sonner spinner that polls until the job is done.
   */
  async notifyStudents(courseId: string, exerciseId: string) {
    const toastId = toast.loading(t.get('course.navItem.lessons.exercises.all_exercises.notify.sending'), {
      position: 'bottom-right'
    });

    try {
      const res = await classroomhub.course[':courseId'].exercise[':exerciseId'].notify.$post({
        param: { courseId, exerciseId }
      });
      const body = await res.json();

      if (!body.success) {
        throw new Error('Failed to start notification');
      }

      const jobId = body.data.jobId;
      const maxPolls = 60;

      for (let pollCount = 0; pollCount < maxPolls; pollCount++) {
        const statusRes = await classroomhub.course[':courseId'].exercise[':exerciseId'].notify[':jobId'].$get({
          param: { courseId, exerciseId, jobId },
          query: { pollCount: String(pollCount) }
        });
        const statusBody = await statusRes.json();

        if (!statusBody.success) {
          throw new Error('Failed to read notification status');
        }

        const { job, nextPollMs } = statusBody.data;

        if (job.status === 'completed') {
          const notified = (job.result as { notified?: number } | null)?.notified ?? 0;
          toast.success(t.get('course.navItem.lessons.exercises.all_exercises.notify.sent', { count: notified }), {
            id: toastId,
            position: 'bottom-right'
          });
          return;
        }

        if (job.status === 'failed' || job.status === 'canceled') {
          toast.error(t.get('course.navItem.lessons.exercises.all_exercises.notify.failed'), {
            id: toastId,
            position: 'bottom-right'
          });
          return;
        }

        await new Promise((resolve) => setTimeout(resolve, nextPollMs || 2000));
      }

      toast.error(t.get('course.navItem.lessons.exercises.all_exercises.notify.failed'), {
        id: toastId,
        position: 'bottom-right'
      });
    } catch (error) {
      console.error('notifyStudents error:', error);
      toast.error(t.get('course.navItem.lessons.exercises.all_exercises.notify.failed'), {
        id: toastId,
        position: 'bottom-right'
      });
    }
  }

  /**
   * Creates a new exercise
   */
  async create(courseId: string, fields: Omit<TExerciseCreate, 'courseId'>) {
    const result = ZExerciseCreate.safeParse({ ...fields, courseId });
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return;
    }

    await this.execute<CreateExerciseRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise.$post({
          param: { courseId },
          json: result.data
        }),
      logContext: 'creating exercise',
      onSuccess: (response) => {
        if (response.data) {
          this.exercise = response.data as unknown as Exercise;
          snackbar.success('Exercise created successfully');
          this.success = true;
          this.errors = {};
        }
      },
      onError: (result) => {
        if (typeof result === 'string') {
          snackbar.error('Failed to create exercise');
          return;
        }
        if ('error' in result && 'field' in result && result.field) {
          this.errors[result.field] = result.error;
          snackbar.error(result.error);
        } else if ('error' in result) {
          this.errors.general = result.error;
          snackbar.error(result.error);
        }
      }
    });
  }

  /**
   * Updates an exercise
   */
  async update(courseId: string, exerciseId: string, fields: TExerciseUpdate) {
    this.success = false;
    const result = ZExerciseUpdate.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return;
    }
    this.errors = {};
    return this.execute<UpdateExerciseRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].$put({
          param: { courseId, exerciseId },
          json: result.data
        }),
      logContext: 'updating exercise',
      onSuccess: (response) => {
        if (response.data) {
          this.exercise = response.data as unknown as Exercise;
          this.success = true;
          this.errors = {};
        }
      },
      onError: (result) => {
        this.success = false;
        if (typeof result === 'string') {
          snackbar.error('Failed to update exercise');
          return;
        }
        if ('error' in result && 'field' in result && result.field) {
          this.errors[result.field] = result.error;
          snackbar.error(result.error);
        } else if ('error' in result) {
          this.errors.general = result.error;
          snackbar.error(result.error);
        }
      }
    });
  }

  /**
   * Deletes an exercise
   */
  async delete(courseId: string, exerciseId: string) {
    await this.execute<DeleteExerciseRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].$delete({
          param: { courseId, exerciseId }
        }),
      logContext: 'deleting exercise',
      onSuccess: (response) => {
        if (response.data) {
          snackbar.success('Exercise deleted successfully');
          this.success = true;
          this.errors = {};
        }
      },
      onError: (result) => {
        if (typeof result === 'string') {
          snackbar.error('Failed to delete exercise');
        }
      }
    });
  }

  /**
   * Submits an exercise
   */
  async submit(
    courseId: string,
    exerciseId: string,
    answers: TExerciseSubmissionCreate['answers'],
    idempotencyKey: string
  ) {
    const result = ZExerciseSubmissionCreate.safeParse({ exerciseId, answers, idempotencyKey });
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return;
    }

    return await this.execute<SubmitExerciseRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].submission.$post({
          param: { courseId, exerciseId },
          json: result.data
        }),
      logContext: 'submitting exercise',
      onSuccess: (response) => {
        if (response.data) {
          snackbar.success('Exercise submitted successfully');
          this.success = true;
          this.errors = {};
        }
      },
      onError: (result) => {
        if (typeof result === 'string') {
          snackbar.error('Failed to submit exercise');
          return;
        }
        if ('error' in result && 'field' in result && result.field) {
          this.errors[result.field] = result.error;
          snackbar.error(result.error);
        } else if ('error' in result) {
          this.errors.general = result.error;
          snackbar.error(result.error);
        }
      }
    });
  }

  async initVideoRecordingUpload(
    courseId: string,
    exerciseId: string,
    questionId: number | string,
    fields: TExerciseVideoRecordingUploadInit
  ) {
    const result = ZExerciseVideoRecordingUploadInit.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return null;
    }

    return await this.execute<VideoRecordingUploadInitRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].question[':questionId'][
          'video-recording'
        ].upload.init.$post({
          param: { courseId, exerciseId, questionId: String(questionId) },
          json: result.data
        }),
      logContext: 'initializing video recording upload'
    });
  }

  async initExerciseFileUpload(
    courseId: string,
    exerciseId: string,
    questionId: number | string,
    fields: TExerciseFileUploadInit
  ) {
    const result = ZExerciseFileUploadInit.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return null;
    }

    return await this.execute<ExerciseFileUploadInitRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].question[':questionId']['file-upload'].init.$post({
          param: { courseId, exerciseId, questionId: String(questionId) },
          json: result.data
        }),
      logContext: 'initializing exercise file upload'
    });
  }

  async completeExerciseFileUpload(
    courseId: string,
    exerciseId: string,
    questionId: number | string,
    fields: TExerciseFileUploadComplete
  ) {
    const result = ZExerciseFileUploadComplete.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return null;
    }

    return await this.execute<ExerciseFileUploadCompleteRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].question[':questionId']['file-upload'].complete.$post({
          param: { courseId, exerciseId, questionId: String(questionId) },
          json: result.data
        }),
      logContext: 'completing exercise file upload'
    });
  }

  async completeVideoRecordingUpload(
    courseId: string,
    exerciseId: string,
    questionId: number | string,
    fields: TExerciseVideoRecordingUploadComplete
  ) {
    const result = ZExerciseVideoRecordingUploadComplete.safeParse(fields);
    if (!result.success) {
      this.errors = mapZodErrorsToTranslations(result.error, 'exercise');
      return null;
    }

    return await this.execute<VideoRecordingUploadCompleteRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].question[':questionId'][
          'video-recording'
        ].upload.complete.$post({
          param: { courseId, exerciseId, questionId: String(questionId) },
          json: result.data
        }),
      logContext: 'completing video recording upload'
    });
  }

  async getVideoRecordingPlaybackUrl(
    courseId: string,
    exerciseId: string,
    submissionId: string,
    questionId: number | string
  ) {
    return await this.execute<VideoRecordingPlaybackRequest>({
      requestFn: () =>
        classroomhub.course[':courseId'].exercise[':exerciseId'].submission[':submissionId'].question[':questionId'][
          'video-recording'
        ].playback.$get({
          param: { courseId, exerciseId, submissionId, questionId: String(questionId) }
        }),
      logContext: 'getting video recording playback URL'
    });
  }

  /**
   * Creates an exercise from a template
   * @param courseId Course ID
   * @param lessonId Lesson ID
   * @param templateId Template ID
   * @returns The created exercise data or null on error
   */
  async createFromTemplate(
    courseId: string,
    templateId: number | string,
    options: { lessonId?: string; sectionId?: string; order?: number } = {}
  ) {
    const templateIdValue = Number(templateId);
    await this.execute<CreateExerciseFromTemplateRequest>({
      requestFn: () =>
        classroomhub.course[':courseId']['exercise']['from-template'].$post({
          param: { courseId },
          json: {
            lessonId: options.lessonId,
            sectionId: options.sectionId,
            order: options.order,
            templateId: templateIdValue
          }
        }),
      logContext: 'creating exercise from template',
      onSuccess: (response) => {
        if (response.data) {
          this.exercise = response.data as unknown as Exercise;
          snackbar.success('Exercise created successfully');
          this.success = true;
          this.errors = {};
        }
      },
      onError: (result) => {
        if (typeof result === 'string') {
          snackbar.error('Failed to create exercise from template');
          return;
        }
        if ('error' in result && 'field' in result && result.field) {
          this.errors[result.field] = result.error;
          snackbar.error(result.error);
        } else if ('error' in result) {
          this.errors.general = result.error;
          snackbar.error(result.error);
        }
      }
    });
  }

  /**
   * Checks if exercise is completed
   * NOTE: This route does not exist in the API. Use the submission list endpoint instead.
   */
}

export const exerciseApi = /* @__PURE__ */ new ExerciseApi();
