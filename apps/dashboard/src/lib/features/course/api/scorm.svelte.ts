import { BaseApi, classroomio } from '$lib/utils/services/api';
import type {
  CommitScormRequest,
  GetScormContentRequest,
  LaunchScormRequest,
  TerminateScormRequest
} from '../utils/types';

class ScormApi extends BaseApi {
  getContent(courseId: string, lessonId: string) {
    return this.execute<GetScormContentRequest>({
      requestFn: () =>
        classroomio.course[':courseId'].lesson[':lessonId'].scorm.content.$get({
          param: { courseId, lessonId }
        }),
      logContext: 'fetching SCORM lesson content'
    });
  }

  launch(courseId: string, lessonId: string) {
    return this.execute<LaunchScormRequest>({
      requestFn: () =>
        classroomio.course[':courseId'].lesson[':lessonId'].scorm.launch.$post({
          param: { courseId, lessonId }
        }),
      logContext: 'launching SCORM lesson'
    });
  }

  commit(courseId: string, lessonId: string, attemptId: string, values: Record<string, string>) {
    return this.execute<CommitScormRequest>({
      requestFn: () =>
        classroomio.course[':courseId'].lesson[':lessonId'].scorm.commit.$post({
          param: { courseId, lessonId },
          json: { attemptId, values }
        }),
      logContext: 'committing SCORM state'
    });
  }

  terminate(courseId: string, lessonId: string, attemptId: string, values: Record<string, string>) {
    return this.execute<TerminateScormRequest>({
      requestFn: () =>
        classroomio.course[':courseId'].lesson[':lessonId'].scorm.terminate.$post({
          param: { courseId, lessonId },
          json: { attemptId, values }
        }),
      logContext: 'terminating SCORM attempt'
    });
  }
}

export const scormApi = new ScormApi();
