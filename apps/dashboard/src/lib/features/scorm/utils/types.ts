import { classroomhub, type InferResponseType } from '$lib/utils/services/api';

export type ListScormPackagesRequest = (typeof classroomhub.organization.scorm.packages)['$get'];
export type ScormPackage = Extract<InferResponseType<ListScormPackagesRequest>, { success: true }>['data'][number];

export type GetScormPackageRequest = (typeof classroomhub.organization.scorm.packages)[':packageId']['$get'];
export type ScormPackageDetail = Extract<InferResponseType<GetScormPackageRequest>, { success: true }>['data'];

export type CreateScormSourceUploadRequest =
  (typeof classroomhub.organization.scorm.packages)['source-upload']['$post'];
export type ImportScormPackageRequest = (typeof classroomhub.organization.scorm.packages)['$post'];
export type DeleteScormPackageRequest = (typeof classroomhub.organization.scorm.packages)[':packageId']['$delete'];
export type AttachScormPackageRequest =
  (typeof classroomhub.organization.scorm.packages)[':packageId']['attach']['$post'];

export type ListScormReportsRequest = (typeof classroomhub.organization.scorm.reports)['$get'];
export type ScormReports = Extract<InferResponseType<ListScormReportsRequest>, { success: true }>['data'];
